import {
  state, saveLive, saveSong, ensureSong, ensureVenue, artistName, venueName, savePhoto, deletePhoto, hydratePhotos, allLives, songCounts,
} from '../store.js';
import { esc, uid, today, toast, compressImage, matchKey, songKey, venueKey, matchScore, similarity, addMinutes, stripRomaji } from '../util.js';
import { TYPES, EXPENSE_CATS, avatar, songArt, notFound } from '../components.js';
import { parseLines, bestMatch, readImageTexts, pickLines } from '../setlist.js';
import { catalogFor, toursFor, searchPlaces, KNOWN_VENUES } from '../music.js';
import { openSheet, suggest, pickArtist, cropImage } from '../ui.js';

// Doors are almost always in the afternoon or evening, and the show usually starts
// two hours later (sometimes one).
const DOOR_WHEEL_START = '15:00';
const SHOW_OFFSET = 120;
import { goBack, replace } from '../nav.js';

// The form is mirrored to localStorage while editing: iOS may reload the app when you
// switch to Photos to copy a setlist, and the draft brings you back where you were.
const DRAFT_PREFIX = 'livelog-draft2:';

export function draftPhotoIds() {
  const ids = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k.startsWith(DRAFT_PREFIX)) ids.push(...(JSON.parse(localStorage.getItem(k)).photoIds || []));
    }
  } catch {}
  return ids;
}

function toDraft(l) {
  return {
    artistIds: [...(l.artistIds || [])],
    title: l.title || '',
    type: l.type || 'ワンマン',
    date: l.date || today(),
    venue: { name: venueName(l.venueId) },
    openTime: l.openTime || '',
    startTime: l.startTime || '',
    setlist: (l.setlist || [])
      .map(it => {
        if (it.kind === 'en') return { kind: 'en' };
        const s = state.songs.get(it.songId);
        return s ? { kind: 'song', songId: s.id, artistId: s.artistId, title: s.title, artwork: s.artwork || '' } : null;
      })
      .filter(Boolean),
    seat: l.seat || '',
    expenses: (l.expenses || []).map(x => ({ category: x.category, amount: String(x.amount ?? '') })),
    memo: l.memo || '',
    photoIds: [...(l.photoIds || [])],
    addedPhotos: [],
    removedPhotos: [],
  };
}

function blankDraft(artistId) {
  const d = toDraft({ artistIds: artistId && state.artists.has(artistId) ? [artistId] : [] });
  d.expenses = [{ category: 'チケット', amount: '' }];
  return d;
}

function readDraft(key) {
  try {
    const s = localStorage.getItem(key);
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
}

export function render(view, id, params) {
  const existing = id ? state.lives.get(id) : null;
  if (id && !existing) {
    view.innerHTML = notFound('ライブ');
    return;
  }
  // "Duplicate": same tour on another day — keep everything except the date, seat, photo and notes.
  const source = !id && params.get('from') ? state.lives.get(params.get('from')) : null;
  const copyDraft = () => ({ ...toDraft(source), date: '', seat: '', memo: '', photoIds: [] });
  const key = DRAFT_PREFIX + (id || (source ? `copy:${source.id}` : 'new'));
  const initial = JSON.stringify(existing ? toDraft(existing) : source ? copyDraft() : blankDraft(params.get('artist')));
  let draft = readDraft(key);
  if (draft) setTimeout(() => toast('編集途中の内容を復元しました'), 300);
  else {
    draft = JSON.parse(initial);
    if (source) setTimeout(() => toast('複製しました。日付と座席を入れて保存してください'), 300);
  }
  let activeArtist = draft.artistIds[0];

  /* ----- draft persistence ----- */
  let closed = false;
  let saving = false;
  let timer;
  const writeDraft = () => {
    clearTimeout(timer);
    if (closed) return;
    try {
      const s = JSON.stringify(draft);
      if (s === initial) localStorage.removeItem(key);
      else localStorage.setItem(key, s);
    } catch {}
  };
  const persist = () => {
    clearTimeout(timer);
    timer = setTimeout(writeDraft, 300);
  };
  const closeDraft = () => {
    closed = true;
    clearTimeout(timer);
    try {
      localStorage.removeItem(key);
    } catch {}
  };
  const onHide = () => document.visibilityState === 'hidden' && writeDraft();
  document.addEventListener('visibilitychange', onHide);

  view.innerHTML = `
    <header class="top">
      <button class="txt" data-act="cancel">キャンセル</button>
      <h1 class="center">${existing ? 'ライブを編集' : source ? 'ライブを複製' : 'ライブを記録'}</h1>
      <button class="txt primary" data-act="save">保存</button>
    </header>

    <section class="card">
      <div class="field"><span>アーティスト</span><div id="ed-artists" class="chips"></div></div>
      <div class="field"><span>日付</span><input type="date" data-f="date"></div>
      <div class="field"><span>種別</span><div id="ed-type" class="chips"></div></div>
      <div class="field"><span>ライブ名・ツアー名</span>
        <div class="ac"><input data-f="title" placeholder="タップすると候補が出ます（空欄ならアーティスト名）" autocomplete="off" enterkeyhint="done"><div class="sg" id="title-sg"></div></div>
      </div>
      <div class="field"><span>会場</span>
        <div class="ac"><input id="venue-input" placeholder="会場名を入力" autocomplete="off" enterkeyhint="done"><div class="sg" id="venue-sg"></div></div>
      </div>
      <div class="row2">
        <div class="field"><span>開場</span><div class="time-field"><input type="time" data-f="openTime"><button type="button" class="clear-x" data-clear-time="openTime" aria-label="開場をクリア">×</button></div></div>
        <div class="field"><span>開演</span><div class="time-field"><input type="time" data-f="startTime"><button type="button" class="clear-x" data-clear-time="startTime" aria-label="開演をクリア">×</button></div></div>
      </div>
    </section>

    <section class="card">
      <h2>セットリスト <span class="muted small" id="sl-count"></span></h2>
      <ol class="sl-list" id="sl-list"></ol>
      <div id="sl-artist" class="chips small"></div>
      <div class="ac">
        <input id="song-input" placeholder="曲名を入力（候補から選べます）" autocomplete="off" autocapitalize="off" enterkeyhint="enter">
        <div class="sg" id="song-sg"></div>
      </div>
      <div class="sl-tools">
        <button type="button" data-act="encore">＋ アンコール</button>
        <button type="button" data-act="paste">貼り付け</button>
        <label class="btn">画像から読む<input type="file" accept="image/*" hidden id="ocr-file"></label>
      </div>
    </section>

    <section class="card">
      <label class="field"><span>座席</span><input data-f="seat" placeholder="例: アリーナ B3ブロック 12列 5番" autocomplete="off"></label>
      <div class="field"><span>支出</span><div id="ed-expenses"></div>
        <button type="button" class="wide" data-act="add-expense">＋ 支出を追加</button></div>
    </section>

    <section class="card"><h2>写真</h2><div id="ed-photo"></div></section>
    <section class="card"><h2>感想・メモ</h2><textarea data-f="memo" rows="5" placeholder="よかったところ、MCの話など"></textarea></section>`;

  const $ = sel => view.querySelector(sel);
  view.querySelectorAll('[data-f]').forEach(el => (el.value = draft[el.dataset.f] ?? ''));

  /* ----- artists / type / title suggestions ----- */
  function drawArtists() {
    $('#ed-artists').innerHTML =
      draft.artistIds
        .map(
          aid => `<span class="chip artist-chip">${avatar(state.artists.get(aid), 'xs')}${esc(artistName(aid))}
            ${draft.artistIds.length > 1 ? `<button type="button" data-rm-artist="${aid}" aria-label="外す">×</button>` : ''}</span>`,
        )
        .join('') + `<button type="button" class="chip add" data-act="add-artist">${draft.artistIds.length ? '＋ 共演・出演者' : '＋ アーティストを選ぶ'}</button>`;
    hydratePhotos($('#ed-artists'));
    if (!draft.artistIds.includes(activeArtist)) activeArtist = draft.artistIds[0];
    $('#sl-artist').innerHTML =
      draft.artistIds.length > 1
        ? `<span class="muted small">次の曲:</span>` +
          draft.artistIds.map(aid => `<button type="button" class="chip ${aid === activeArtist ? 'on' : ''}" data-active="${aid}">${esc(artistName(aid))}</button>`).join('')
        : '';
  }

  const drawType = () =>
    ($('#ed-type').innerHTML = TYPES.map(t => `<button type="button" class="chip ${draft.type === t ? 'on' : ''}" data-type="${t}">${t}</button>`).join(''));

  /* ----- tour / live name ----- */
  // Suggestions: names you used before for these artists, then tours listed on Wikipedia,
  // with the ones from the live's year first.
  const titleInput = view.querySelector('[data-f=title]');
  const titleSg = suggest(titleInput, $('#title-sg'), {
    async fetch(q) {
      const qk = matchKey(q);
      const year = (draft.date || today()).slice(0, 4);
      const mine = new Map();
      for (const l of allLives()) {
        if (l.id === existing?.id || !l.title?.trim() || !l.artistIds.some(a => draft.artistIds.includes(a))) continue;
        const k = matchKey(l.title);
        const m = mine.get(k) || { title: l.title.trim(), count: 0, year: '' };
        m.count++;
        m.year = l.date.slice(0, 4);
        mine.set(k, m);
      }
      const tours = (await Promise.all(draft.artistIds.map(aid => toursFor(aid).catch(() => [])))).flat();
      const items = [
        ...[...mine.values()].map(m => ({ ...m, sub: `記録済み ${m.count}回` })),
        ...tours.filter(t => !mine.has(matchKey(t.title))).map(t => ({ ...t, sub: t.year ? `${t.year}年` : '' })),
      ];
      const near = it => (it.year === year ? 3 : it.year && Math.abs(it.year - year) === 1 ? 1 : 0);
      return items
        .map(it => ({ it, s: qk ? matchScore(qk, matchKey(it.title)) : 1 }))
        .filter(x => x.s)
        .sort((a, b) => b.s - a.s || near(b.it) - near(a.it) || (b.it.count || 0) - (a.it.count || 0) || (b.it.year || '').localeCompare(a.it.year || ''))
        .slice(0, 6)
        .map(x => x.it);
    },
    render: it => `<span class="sg-main">${esc(it.title)}</span><small>${esc(it.sub)}</small>`,
    onPick(it) {
      titleInput.value = it.title;
      draft.title = it.title;
      titleSg.clear();
      titleInput.blur();
      persist();
    },
  });
  titleInput.addEventListener('focus', () => titleSg.refresh());
  titleInput.addEventListener('blur', () => setTimeout(() => titleSg.clear(), 150));

  /* ----- open / start times (the phone's own time picker, like the date) ----- */
  const openInput = view.querySelector('[data-f=openTime]');
  const startInput = view.querySelector('[data-f=startTime]');
  const drawTimes = () => {
    for (const input of [openInput, startInput]) {
      input.value = draft[input.dataset.f] || '';
      input.closest('.time-field').classList.toggle('empty', !input.value);
    }
  };
  // An empty picker would open at the current time; start it where shows usually are instead.
  const primeTime = input => {
    if (input.value) return;
    input.value = input === openInput ? DOOR_WHEEL_START : draft.openTime ? addMinutes(draft.openTime, SHOW_OFFSET) : '18:00';
    draft[input.dataset.f] = input.value;
    drawTimes();
    persist();
  };
  for (const input of [openInput, startInput]) {
    input.addEventListener('pointerdown', () => primeTime(input));
    input.addEventListener('focus', () => primeTime(input));
  }
  // Doors set -> show two hours later, unless a different start was chosen already.
  let lastOpen = draft.openTime;
  openInput.addEventListener('change', () => {
    const autoStart = lastOpen ? addMinutes(lastOpen, SHOW_OFFSET) : '';
    if (openInput.value && (!draft.startTime || draft.startTime === autoStart)) draft.startTime = addMinutes(openInput.value, SHOW_OFFSET);
    lastOpen = openInput.value;
    drawTimes();
    persist();
  });

  /* ----- venue ----- */
  const venueInput = $('#venue-input');
  venueInput.value = draft.venue.name || '';
  const venueUse = new Map();
  for (const l of state.lives.values()) if (l.venueId) venueUse.set(l.venueId, (venueUse.get(l.venueId) || 0) + 1);

  const venueSg = suggest(venueInput, $('#venue-sg'), {
    delay: 250,
    async fetch(q) {
      const qk = matchKey(q);
      const mine = [...state.venues.values()].map(v => ({ name: v.name, area: v.area, count: venueUse.get(v.id) || 0, key: v.key, aliases: v.aliases || [] }));
      if (!qk) return mine.sort((a, b) => b.count - a.count).slice(0, 5);
      const known = KNOWN_VENUES.filter(n => !mine.some(m => m.key === venueKey(n))).map(name => ({ name, key: venueKey(name), aliases: [] }));
      const local = [...mine, ...known]
        .map(v => ({ v, s: Math.max(matchScore(qk, v.key), ...v.aliases.map(a => matchScore(qk, a))) }))
        .filter(x => x.s)
        .sort((a, b) => b.s - a.s || (b.v.count || 0) - (a.v.count || 0))
        .map(x => x.v)
        .slice(0, 5);
      let remote = [];
      if (q.length >= 2 && navigator.onLine) {
        try {
          remote = (await searchPlaces(q)).filter(p => !local.some(v => v.key === venueKey(p.name))).slice(0, 4);
        } catch {}
      }
      return [...local, ...remote];
    },
    render: v =>
      `<span class="sg-main">${esc(v.name)}</span><small>${v.count ? `${v.count}回` : esc(v.area || (v.lat ? '' : 'よく使われる会場'))}</small>`,
    onPick(v) {
      venueInput.value = v.name;
      draft.venue = { name: v.name, area: v.area || '', lat: v.lat || null, lon: v.lon || null };
      venueSg.clear();
      venueInput.blur();
      persist();
    },
  });
  venueInput.addEventListener('focus', () => venueSg.refresh());
  venueInput.addEventListener('blur', () => setTimeout(() => venueSg.clear(), 150));
  venueInput.addEventListener('input', () => {
    draft.venue = { name: venueInput.value };
    persist();
  });

  /* ----- setlist ----- */
  const candidates = new Map();
  const counts = songCounts();

  async function candidatesFor(aid) {
    if (candidates.has(aid)) return candidates.get(aid);
    const byKey = new Map();
    for (const s of state.songs.values()) {
      if (s.artistId !== aid) continue;
      byKey.set(s.key, { title: s.title, key: s.key, aliases: s.aliases || [], artwork: s.artwork, songId: s.id, count: counts.get(s.id) || 0, artistId: aid });
    }
    const catalog = await catalogFor(aid).catch(() => []);
    for (const c of catalog) {
      const known = byKey.get(c.key) || [...byKey.values()].find(x => x.aliases.includes(c.key));
      if (!known) {
        byKey.set(c.key, { ...c, aliases: [], count: 0, artistId: aid });
        continue;
      }
      const song = state.songs.get(known.songId);
      const patch = {};
      // Songs typed before the catalog was available get their jacket now.
      if (!known.artwork && c.artwork) patch.artwork = known.artwork = c.artwork;
      // v0.6 shortened titles like "燦然 - Sanzen" to "燦然"; show them as iTunes lists them again.
      if (song && song.title !== c.title && song.title === stripRomaji(c.title)) patch.title = known.title = c.title;
      if (song && Object.keys(patch).length) saveSong({ ...song, ...patch }).catch(() => {});
    }
    const list = [...byKey.values()];
    candidates.set(aid, list);
    return list;
  }

  const songInput = $('#song-input');
  const songSg = suggest(songInput, $('#song-sg'), {
    async fetch(q) {
      const qk = matchKey(q);
      if (!qk || !activeArtist) return [];
      const used = new Set(draft.setlist.filter(it => it.kind === 'song' && it.artistId === activeArtist).map(it => songKey(it.title)));
      const list = (await candidatesFor(activeArtist))
        .filter(c => !used.has(c.key))
        .map(c => ({ c, s: Math.max(matchScore(qk, c.key), ...c.aliases.map(a => matchScore(qk, a))) }))
        .filter(x => x.s)
        .sort((a, b) => b.s - a.s || b.c.count - a.c.count)
        .slice(0, 6)
        .map(x => ({ ...x.c, exact: x.s === 4 }));
      if (!list.some(c => c.exact)) list.push({ raw: true, title: q });
      return list;
    },
    render: c =>
      c.raw
        ? `<span class="sg-main">＋「${esc(c.title)}」を追加</span><small>一覧にない曲</small>`
        : `${songArt(c, 'xs')}<span class="sg-main">${esc(c.title)}</span><small>${c.count ? `${c.count}回` : ''}</small>`,
    onPick: c => addSong(c),
  });

  function addSong(c) {
    draft.setlist.push({ kind: 'song', songId: c.songId || null, artistId: activeArtist, title: c.title.trim(), artwork: c.artwork || '' });
    songInput.value = '';
    songSg.clear();
    drawSetlist();
    persist();
    songInput.focus();
  }

  songInput.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    const q = songInput.value.trim();
    if (!q) return;
    const exact = songSg.items.find(c => c.exact);
    addSong(exact || { title: q });
  });

  function drawSetlist() {
    const multi = draft.artistIds.length > 1;
    let n = 0;
    $('#sl-list').innerHTML = draft.setlist
      .map((it, i) => {
        const ops = `<span class="ops">
          <button type="button" data-mv="-1" data-i="${i}" ${i === 0 ? 'disabled' : ''} aria-label="上へ">↑</button>
          <button type="button" data-mv="1" data-i="${i}" ${i === draft.setlist.length - 1 ? 'disabled' : ''} aria-label="下へ">↓</button>
          <button type="button" data-del="${i}" aria-label="削除">✕</button></span>`;
        if (it.kind === 'en') return `<li class="sl-row encore"><span class="enc">ENCORE</span>${ops}</li>`;
        n++;
        return `<li class="sl-row"><span class="no">${n}</span>${songArt(it, 'xs')}
          <span class="t">${esc(it.title)}${multi ? `<small>${esc(artistName(it.artistId))}</small>` : ''}</span>${ops}</li>`;
      })
      .join('');
    $('#sl-count').textContent = n ? `${n}曲` : '';
  }

  /* ----- paste / photo → review ----- */
  async function allCandidates() {
    const all = [];
    for (const aid of draft.artistIds) all.push(...(await candidatesFor(aid)));
    return all;
  }

  // fromPhoto: lines that match no known song are likely misreads, so they start unchecked.
  async function review(lines, title, { fromPhoto = false } = {}) {
    if (!lines.length) return toast('曲名が見つかりませんでした');
    const all = await allCandidates();
    const rows = lines.map(line => {
      if (line.kind === 'en') return { kind: 'en', on: true };
      const { candidate, score } = bestMatch(line.raw, all);
      const ok = candidate && score >= 0.55;
      return {
        kind: 'song',
        on: ok || !fromPhoto || all.length === 0,
        raw: line.raw,
        title: ok ? candidate.title : line.raw,
        artistId: ok ? candidate.artistId : activeArtist,
        songId: ok ? candidate.songId || null : null,
        artwork: ok ? candidate.artwork || '' : '',
        state: !ok ? 'new' : score === 1 ? 'exact' : 'fixed',
      };
    });
    // Songs that look like `text`, for lines that matched nothing (or while retyping one).
    const lookalikes = (text, limit) => {
      const k = songKey(text);
      const typed = matchKey(text);
      return all
        .map(c => ({ c, s: Math.max(similarity(k, c.key), matchScore(typed, c.key) / 4, ...c.aliases.map(a => similarity(k, a))) }))
        .filter(x => x.s >= 0.25 && x.c.key !== k)
        .sort((a, b) => b.s - a.s || (b.c.count || 0) - (a.c.count || 0))
        .slice(0, limit)
        .map(x => x.c);
    };
    rows.forEach(r => (r.hints = r.state === 'new' ? lookalikes(r.raw, 3) : []));

    // Notes and suggestions under a title (redrawn while typing without touching the input,
    // so Japanese input isn't interrupted).
    const extraHtml = (r, i) =>
      `${r.state === 'fixed' ? `<small>読み取り: ${esc(r.raw)}</small>` : ''}
      ${r.state === 'new' ? `<small class="warn">${fromPhoto ? '一覧にない曲（読み間違いかも）' : '一覧にない曲（新しく登録されます）'}</small>` : ''}
      ${
        r.hints.length
          ? `<div class="rv-hints"><span>${r.state === 'new' ? 'もしかして' : '候補'}</span>${r.hints
              .map((c, j) => `<button type="button" class="chip" data-hint="${i}:${j}">${songArt(c, 'xs')}${esc(c.title)}</button>`)
              .join('')}</div>`
          : ''
      }`;
    const rowHtml = (r, i) =>
      r.kind === 'en'
        ? `<label class="rv-row enc" data-row="${i}"><input type="checkbox" data-on="${i}" ${r.on ? 'checked' : ''}><span>ENCORE</span></label>`
        : `<div class="rv-row" data-row="${i}"><input type="checkbox" data-on="${i}" ${r.on ? 'checked' : ''}><span class="rv-art">${songArt(r, 'xs')}</span>
            <div class="rv-main"><input class="rv-title" data-t="${i}" value="${esc(r.title)}" autocomplete="off">
            <div class="rv-extra">${extraHtml(r, i)}</div></div></div>`;
    const hasSongs = draft.setlist.length > 0;
    const picked = await openSheet({
      title,
      tall: true,
      html: `<p class="hint">チェックを外した行は追加されません。曲名はタップして直せます。</p>
        <div class="rv-list">${rows.map(rowHtml).join('')}</div>
        ${hasSongs ? `<div class="chips mode"><label class="chip"><input type="radio" name="mode" value="append" checked> 後ろに追加</label><label class="chip"><input type="radio" name="mode" value="replace"> 置き換える</label></div>` : ''}
        <button type="button" class="wide primary" data-ok>追加する</button>`,
      onMount(sheet, close) {
        const redrawRow = i => {
          const el = sheet.querySelector(`[data-row="${i}"]`);
          el.querySelector('.rv-art').innerHTML = songArt(rows[i], 'xs');
          el.querySelector('.rv-extra').innerHTML = extraHtml(rows[i], i);
          el.querySelector('[data-on]').checked = rows[i].on;
          const input = el.querySelector('.rv-title');
          if (input.value !== rows[i].title) input.value = rows[i].title;
        };
        sheet.addEventListener('change', e => {
          if (e.target.dataset.on != null) rows[Number(e.target.dataset.on)].on = e.target.checked;
        });
        sheet.addEventListener('input', e => {
          if (e.target.dataset.t == null) return;
          const i = Number(e.target.dataset.t);
          const r = rows[i];
          r.title = e.target.value;
          const hit = all.find(c => c.key === songKey(r.title) || c.aliases.includes(songKey(r.title)));
          Object.assign(r, hit ? { songId: hit.songId || null, artistId: hit.artistId, artwork: hit.artwork || '', state: 'exact' } : { songId: null, artwork: '', state: 'new' });
          r.hints = hit || !r.title.trim() ? [] : lookalikes(r.title, 4);
          redrawRow(i);
        });
        // Picking a suggestion fills the row with that song and ticks it.
        sheet.addEventListener('pointerdown', e => e.target.closest('[data-hint]') && e.preventDefault());
        sheet.addEventListener('click', e => {
          const b = e.target.closest('[data-hint]');
          if (!b) return;
          const [i, j] = b.dataset.hint.split(':').map(Number);
          const c = rows[i].hints[j];
          Object.assign(rows[i], { title: c.title, songId: c.songId || null, artistId: c.artistId, artwork: c.artwork || '', state: 'exact', hints: [], on: true });
          redrawRow(i);
        });
        sheet.querySelector('[data-ok]').addEventListener('click', () =>
          close({ rows: rows.filter(r => r.on && (r.kind === 'en' || r.title.trim())), replace: sheet.querySelector('[name=mode]:checked')?.value === 'replace' }),
        );
      },
    });
    if (!picked) return;
    const items = picked.rows.map(r => (r.kind === 'en' ? { kind: 'en' } : { kind: 'song', songId: r.songId, artistId: r.artistId, title: r.title.trim(), artwork: r.artwork }));
    draft.setlist = picked.replace ? items : [...draft.setlist, ...items];
    drawSetlist();
    persist();
  }

  async function pasteText() {
    const text = await openSheet({
      title: 'セトリを貼り付け',
      tall: true,
      html: `<p class="hint">1行に1曲。行頭の番号（1. / M1 など）やMCなどの行は自動で取り除きます。「EN」「アンコール」の行はアンコールの区切りになります。<br>
        セトリ画像の文字は、写真アプリで画像の文字を長押し →「コピー」でも取り出せます。</p>
        <textarea rows="12" placeholder="AIZO&#10;Flash!!!&#10;EN&#10;飛行艇" autocapitalize="off"></textarea>
        <button type="button" class="wide primary" data-ok>次へ</button>`,
      onMount(sheet, close) {
        const ta = sheet.querySelector('textarea');
        sheet.querySelector('[data-ok]').addEventListener('click', () => close(ta.value));
        setTimeout(() => ta.focus(), 50);
      },
    });
    if (text?.trim()) review(parseLines(text), '読み取り結果の確認');
  }

  async function readPhoto(file) {
    const image = await cropImage(file);
    if (!image) return;
    let setStatus;
    let closeProgress;
    openSheet({
      title: '画像から読み取り',
      html: `<p class="center" id="ocr-status">準備中…</p><p class="hint center">写真はこのiPhoneの中だけで処理され、どこにも送信されません。</p>`,
      onMount(sheet, close) {
        setStatus = msg => (sheet.querySelector('#ocr-status').textContent = msg);
        closeProgress = close;
      },
    });
    try {
      const texts = await readImageTexts(image, msg => setStatus?.(msg));
      closeProgress?.();
      review(pickLines(texts, await allCandidates()), '読み取り結果の確認', { fromPhoto: true });
    } catch (err) {
      closeProgress?.();
      toast(err.message);
    }
  }

  /* ----- expenses / photo ----- */
  const drawExpenses = () => {
    $('#ed-expenses').innerHTML = draft.expenses
      .map(
        (x, i) => `<div class="ex-row">
          <select data-exc="${i}">${EXPENSE_CATS.map(c => `<option ${c === x.category ? 'selected' : ''}>${c}</option>`).join('')}</select>
          <input data-exa="${i}" type="number" inputmode="numeric" min="0" value="${esc(x.amount)}" placeholder="金額">
          <span class="muted">円</span>
          <button type="button" class="txt" data-exd="${i}" aria-label="削除">✕</button>
        </div>`,
      )
      .join('');
  };

  // One photo per live keeps the future cloud storage small.
  const drawPhoto = () => {
    const el = $('#ed-photo');
    el.innerHTML = draft.photoIds.length
      ? `<div class="ph-grid">${draft.photoIds.map((pid, i) => `<div class="ph"><img data-photo="${pid}" alt=""><button type="button" data-phd="${i}" aria-label="削除">✕</button></div>`).join('')}</div>`
      : `<label class="ph-add">＋ 写真を1枚選ぶ<input type="file" accept="image/*" hidden data-phadd></label>`;
    hydratePhotos(el);
  };

  async function addPhoto(file) {
    if (!file) return;
    try {
      const pid = await savePhoto(await compressImage(file, 1600, 0.8));
      draft.photoIds.push(pid);
      draft.addedPhotos.push(pid);
      persist();
      drawPhoto();
    } catch (err) {
      toast(err.message);
    }
  }

  async function removePhoto(i) {
    const [pid] = draft.photoIds.splice(i, 1);
    if (draft.addedPhotos.includes(pid)) {
      draft.addedPhotos = draft.addedPhotos.filter(x => x !== pid);
      await deletePhoto(pid);
    } else draft.removedPhotos.push(pid);
    persist();
    drawPhoto();
  }

  /* ----- save / cancel ----- */
  async function save() {
    if (saving) return;
    if (!draft.artistIds.length) return toast('アーティストを選んでください');
    if (!draft.date) return toast('日付を入力してください');
    const pending = songInput.value.trim();
    if (pending) addSong(songSg.items.find(c => c.exact) || { title: pending });
    saving = true;
    try {
      const venueId = draft.venue.name?.trim() ? await ensureVenue(draft.venue.name, draft.venue) : null;
      const setlist = [];
      for (const it of draft.setlist) {
        if (it.kind === 'en') {
          if (setlist.length && setlist.at(-1).kind !== 'en') setlist.push({ kind: 'en' });
          continue;
        }
        const artistId = draft.artistIds.includes(it.artistId) ? it.artistId : draft.artistIds[0];
        const known = it.songId && state.songs.get(it.songId)?.artistId === artistId;
        setlist.push({ kind: 'song', songId: known ? it.songId : await ensureSong(artistId, it.title, { artwork: it.artwork }) });
      }
      while (setlist.at(-1)?.kind === 'en') setlist.pop();
      const live = {
        ...existing,
        id: existing?.id || uid(),
        artistIds: [...draft.artistIds],
        title: draft.title.trim(),
        type: draft.type,
        date: draft.date,
        venueId,
        openTime: draft.openTime,
        startTime: draft.startTime,
        setlist,
        seat: draft.seat.trim(),
        expenses: draft.expenses.filter(x => Number(x.amount) > 0).map(x => ({ category: x.category, amount: Number(x.amount) })),
        memo: draft.memo,
        photoIds: [...draft.photoIds],
        createdAt: existing?.createdAt || Date.now(),
      };
      await saveLive(live);
      for (const pid of draft.removedPhotos) await deletePhoto(pid);
      closeDraft();
      toast('保存しました');
      if (existing) goBack(`#/live/${live.id}`);
      else replace(`#/live/${live.id}`);
    } catch (err) {
      saving = false;
      toast('保存に失敗しました: ' + err.message);
    }
  }

  async function cancel() {
    if (JSON.stringify(draft) !== initial && !confirm('変更を破棄しますか？')) return;
    for (const pid of draft.addedPhotos) await deletePhoto(pid);
    closeDraft();
    goBack(existing ? `#/live/${existing.id}` : source ? `#/live/${source.id}` : draft.artistIds[0] ? `#/artist/${draft.artistIds[0]}` : '#/');
  }

  /* ----- events ----- */
  const onField = e => {
    const t = e.target;
    if (t.dataset.f) draft[t.dataset.f] = t.value;
    else if (t.dataset.exa != null) draft.expenses[Number(t.dataset.exa)].amount = t.value;
    else if (t.dataset.exc != null) draft.expenses[Number(t.dataset.exc)].category = t.value;
    else if (t.matches('[data-phadd]') && e.type === 'change') return addPhoto(t.files[0]);
    else if (t.id === 'ocr-file' && e.type === 'change') {
      if (t.files[0]) readPhoto(t.files[0]);
      t.value = '';
      return;
    } else return;
    persist();
  };
  view.addEventListener('input', onField);
  view.addEventListener('change', onField);

  view.addEventListener('click', async e => {
    const el = e.target.closest('button');
    if (!el) return;
    const d = el.dataset;
    if (d.act === 'save') save();
    else if (d.act === 'cancel') cancel();
    else if (d.act === 'paste') pasteText();
    else if (d.act === 'encore') {
      draft.setlist.push({ kind: 'en' });
      drawSetlist();
    } else if (d.act === 'add-artist') {
      const aid = await pickArtist({ title: draft.artistIds.length ? '出演アーティストを追加' : 'アーティストを選ぶ', exclude: draft.artistIds });
      if (!aid) return;
      draft.artistIds.push(aid);
      if (draft.artistIds.length === 2 && draft.type === 'ワンマン') draft.type = '対バン';
      activeArtist = aid;
      drawArtists();
      drawType();
      drawSetlist();
    } else if (d.rmArtist) {
      draft.artistIds = draft.artistIds.filter(a => a !== d.rmArtist);
      drawArtists();
      drawSetlist();
    } else if (d.active) {
      activeArtist = d.active;
      drawArtists();
      songSg.refresh();
      songInput.focus();
    } else if (d.type) {
      draft.type = d.type;
      drawType();
    } else if (d.clearTime) {
      draft[d.clearTime] = '';
      if (d.clearTime === 'openTime') lastOpen = '';
      drawTimes();
    } else if (d.mv) {
      const i = Number(d.i);
      const j = i + Number(d.mv);
      [draft.setlist[i], draft.setlist[j]] = [draft.setlist[j], draft.setlist[i]];
      drawSetlist();
    } else if (d.del != null) {
      draft.setlist.splice(Number(d.del), 1);
      drawSetlist();
    } else if (d.act === 'add-expense') {
      draft.expenses.push({ category: draft.expenses.length ? 'グッズ' : 'チケット', amount: '' });
      drawExpenses();
      view.querySelector(`[data-exa="${draft.expenses.length - 1}"]`)?.focus();
    } else if (d.exd != null) {
      draft.expenses.splice(Number(d.exd), 1);
      drawExpenses();
    } else if (d.phd != null) return removePhoto(Number(d.phd));
    else return;
    persist();
  });

  drawArtists();
  drawType();
  drawTimes();
  drawSetlist();
  drawExpenses();
  drawPhoto();
  draft.artistIds.forEach(aid => candidatesFor(aid));

  return () => {
    writeDraft();
    document.removeEventListener('visibilitychange', onHide);
  };
}
