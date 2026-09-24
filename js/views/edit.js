import {
  state, saveLive, ensureArtist, artistName, findArtistByName, savePhoto, deletePhoto, hydratePhotos, allLives, songs, songArtist,
} from '../store.js';
import { esc, uid, today, toast, compressImage, normTitle } from '../util.js';
import { TYPES, KIND_LABEL, EXPENSE_CATS, starsHtml } from '../components.js';
import { parseSetlist, formatSetlist } from '../setlist.js';
import { goBack, replace } from '../nav.js';

// The form is mirrored to localStorage while editing: iOS may reload the app when you
// switch to Photos to copy a setlist, and the draft brings you back where you were.
const DRAFT_PREFIX = 'livelog-draft:';

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
    title: l.title || '',
    type: l.type || 'ワンマン',
    date: l.date || today(),
    venue: l.venue || '',
    openTime: l.openTime || '',
    startTime: l.startTime || '',
    artists: (l.artistIds || []).map(artistName),
    setlist: (l.setlist || []).map(it => ({ kind: it.kind, title: it.title || '', artist: it.artistId ? artistName(it.artistId) : '' })),
    seat: l.seat || '',
    expenses: (l.expenses || []).map(x => ({ category: x.category, amount: String(x.amount ?? '') })),
    ticketUrl: l.ticketUrl || '',
    siteUrl: l.siteUrl || '',
    guests: [...(l.guests || [])],
    companions: [...(l.companions || [])],
    rating: l.rating || 0,
    favorite: !!l.favorite,
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
    view.innerHTML = `<header class="top"><button class="icon-btn" data-back="#/">‹</button><h1></h1></header><div class="empty">ライブが見つかりません</div>`;
    return;
  }
  const key = DRAFT_PREFIX + (id || 'new');
  const initial = JSON.stringify(existing ? toDraft(existing) : blankDraft(params.get('artist')));
  let draft = readDraft(key);
  if (draft) setTimeout(() => toast('編集途中の内容を復元しました'), 300);
  else draft = JSON.parse(initial);

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

  const lives = allLives();
  const venues = [...new Set(lives.map(l => l.venue?.trim()).filter(Boolean))];
  const companions = [...new Set(lives.flatMap(l => l.companions || []))];
  const artistNames = [...state.artists.values()].map(a => a.name).sort((a, b) => a.localeCompare(b, 'ja'));
  const options = list => list.map(v => `<option value="${esc(v)}"></option>`).join('');

  view.innerHTML = `
    <header class="top">
      <button class="txt" data-act="cancel">キャンセル</button>
      <h1 class="center">${existing ? 'ライブを編集' : 'ライブを追加'}</h1>
      <button class="txt primary" data-act="save">保存</button>
    </header>

    <section class="card">
      <h2>基本情報</h2>
      <div class="field"><span>アーティスト <em>*</em></span><div id="ed-artists"></div></div>
      <label class="field"><span>ライブ名</span><input data-f="title" placeholder="ツアー名など（空欄ならアーティスト名）"></label>
      <div class="row2">
        <label class="field"><span>開催日 <em>*</em></span><input type="date" data-f="date"></label>
        <label class="field"><span>種別</span><select data-f="type">${TYPES.map(t => `<option>${t}</option>`).join('')}</select></label>
      </div>
      <label class="field"><span>会場</span><input data-f="venue" list="dl-venues" placeholder="例: 横浜アリーナ"></label>
      <div class="row2">
        <label class="field"><span>開場</span><input type="time" data-f="openTime"></label>
        <label class="field"><span>開演</span><input type="time" data-f="startTime"></label>
      </div>
    </section>

    <section class="card">
      <h2>セットリスト <span class="muted small" id="sl-count"></span></h2>
      <div id="ed-setlist"></div>
      <div class="sl-add">
        <button data-add="song">＋ 曲</button><button data-add="mc">MC</button><button data-add="en">EN</button><button data-add="se">SE</button><button data-add="vcr">VCR</button>
      </div>
      <button class="wide" data-act="bulk">まとめて入力・貼り付け</button>
      <p class="hint">セトリ画像の文字は、写真アプリで画像内の文字を長押し →「コピー」して、「まとめて入力」に貼り付けられます。曲名の入力中に改行すると次の曲に進みます。</p>
    </section>

    <section class="card">
      <h2>詳細</h2>
      <div class="field"><span>評価</span><div id="ed-rating"></div></div>
      <label class="check"><input type="checkbox" data-f="favorite"> お気に入り</label>
      <label class="field"><span>座席</span><input data-f="seat" placeholder="例: アリーナ F20列 74番"></label>
      <div class="field"><span>支出</span><div id="ed-expenses"></div><button class="wide" data-act="add-expense">＋ 支出を追加</button></div>
      <div class="field"><span>同行者</span><div id="ed-companions"></div></div>
      <div class="field"><span>出演ゲスト</span><div id="ed-guests"></div></div>
      <label class="field"><span>チケットURL</span><input type="url" inputmode="url" data-f="ticketUrl" placeholder="https://"></label>
      <label class="field"><span>特設サイト</span><input type="url" inputmode="url" data-f="siteUrl" placeholder="https://"></label>
    </section>

    <section class="card"><h2>写真</h2><div id="ed-photos"></div></section>
    <section class="card"><h2>感想・メモ</h2><textarea data-f="memo" rows="6" placeholder="よかったところ、MCの内容など"></textarea></section>

    <datalist id="dl-artists">${options(artistNames)}</datalist>
    <datalist id="dl-venues">${options(venues)}</datalist>
    <datalist id="dl-companions">${options(companions)}</datalist>
    <datalist id="dl-songs"></datalist>`;

  view.querySelectorAll('[data-f]').forEach(el => {
    const v = draft[el.dataset.f];
    if (el.type === 'checkbox') el.checked = !!v;
    else el.value = v ?? '';
  });

  /* ----- setlist ----- */
  const slEl = view.querySelector('#ed-setlist');
  const artistsNow = () => draft.artists.map(s => s.trim()).filter(Boolean);

  function drawSetlist(focusIndex) {
    const names = artistsNow();
    const multi = names.length > 1;
    let n = 0;
    slEl.innerHTML = draft.setlist.length
      ? draft.setlist
          .map((it, i) => {
            const song = it.kind === 'song';
            if (song) n++;
            const main = !it.artist || normTitle(it.artist) === normTitle(names[0]);
            const sel = song && multi
              ? `<select data-sla="${i}">${names.map((a, j) => `<option value="${esc(a)}" ${(j === 0 ? main : it.artist === a) ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select>`
              : '';
            return `<div class="sl-row ${song ? '' : 'marker'}">
              ${song ? `<span class="sl-no">${n}</span>` : `<span class="sl-tag">${KIND_LABEL[it.kind]}</span>`}
              <div class="sl-main">
                <input data-sl="${i}" value="${esc(it.title)}" placeholder="${song ? '曲名' : 'メモ（任意）'}" ${song ? 'list="dl-songs"' : ''} enterkeyhint="next" autocomplete="off">
                ${sel}
              </div>
              <div class="sl-ops">
                <button type="button" data-mv="-1" data-i="${i}" ${i === 0 ? 'disabled' : ''} aria-label="上へ">↑</button>
                <button type="button" data-mv="1" data-i="${i}" ${i === draft.setlist.length - 1 ? 'disabled' : ''} aria-label="下へ">↓</button>
                <button type="button" data-del="${i}" aria-label="削除">✕</button>
              </div>
            </div>`;
          })
          .join('')
      : '<p class="muted small">まだありません</p>';
    view.querySelector('#sl-count').textContent = n ? `${n}曲` : '';
    if (focusIndex != null) slEl.querySelector(`[data-sl="${focusIndex}"]`)?.focus();
  }

  function updateSongList() {
    const ids = artistsNow().map(n => findArtistByName(n)?.id).filter(Boolean);
    const titles = new Set();
    for (const l of lives) for (const it of songs(l)) if (ids.includes(songArtist(it, l))) titles.add(it.title.trim());
    view.querySelector('#dl-songs').innerHTML = options([...titles]);
  }

  /* ----- chips (artists / companions / guests) ----- */
  function chipEditor(el, list, { placeholder, datalist, onChange }) {
    const draw = () => {
      el.innerHTML = `${list.length ? `<div class="chips">${list.map((v, i) => `<span class="chip">${esc(v)}<button type="button" data-rm="${i}" aria-label="削除">×</button></span>`).join('')}</div>` : ''}
        <div class="chip-input"><input placeholder="${placeholder}" ${datalist ? `list="${datalist}"` : ''} enterkeyhint="done" autocomplete="off"><button type="button" data-addchip>追加</button></div>`;
    };
    const add = () => {
      const input = el.querySelector('input');
      const v = input.value.trim();
      input.value = '';
      if (!v || list.some(x => normTitle(x) === normTitle(v))) return;
      list.push(v);
      onChange();
      draw();
      el.querySelector('input').focus();
    };
    el.addEventListener('click', e => {
      if (e.target.closest('[data-addchip]')) add();
      const rm = e.target.closest('[data-rm]');
      if (rm) {
        list.splice(Number(rm.dataset.rm), 1);
        onChange();
        draw();
      }
    });
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229 && e.target.matches('input')) {
        e.preventDefault();
        add();
      }
    });
    draw();
    // Text typed but never "追加"-ed is still kept on save.
    return () => {
      const v = el.querySelector('input').value.trim();
      if (v && !list.some(x => normTitle(x) === normTitle(v))) list.push(v);
    };
  }

  const commits = [
    chipEditor(view.querySelector('#ed-artists'), draft.artists, {
      placeholder: 'アーティスト名',
      datalist: 'dl-artists',
      onChange: () => {
        drawSetlist();
        updateSongList();
        persist();
      },
    }),
    chipEditor(view.querySelector('#ed-companions'), draft.companions, { placeholder: '同行者の名前', datalist: 'dl-companions', onChange: persist }),
    chipEditor(view.querySelector('#ed-guests'), draft.guests, { placeholder: 'ゲストの名前', datalist: 'dl-artists', onChange: persist }),
  ];

  /* ----- rating / expenses / photos ----- */
  const drawRating = () => (view.querySelector('#ed-rating').innerHTML = starsHtml(draft.rating));

  const exEl = view.querySelector('#ed-expenses');
  const drawExpenses = () => {
    exEl.innerHTML = draft.expenses
      .map(
        (x, i) => `<div class="ex-row">
          <select data-exc="${i}">${EXPENSE_CATS.map(c => `<option ${c === x.category ? 'selected' : ''}>${c}</option>`).join('')}</select>
          <input data-exa="${i}" type="number" inputmode="numeric" min="0" value="${esc(x.amount)}" placeholder="金額">
          <span class="muted">円</span>
          <button type="button" data-exd="${i}" aria-label="削除">✕</button>
        </div>`,
      )
      .join('');
  };

  const phEl = view.querySelector('#ed-photos');
  const drawPhotos = () => {
    phEl.innerHTML = `<div class="ph-grid">
      ${draft.photoIds.map((pid, i) => `<div class="ph"><img data-photo="${pid}" alt=""><button type="button" data-phd="${i}" aria-label="削除">✕</button></div>`).join('')}
      <label class="ph add">＋<input type="file" accept="image/*" multiple hidden data-phadd></label>
    </div>`;
    hydratePhotos(phEl);
  };

  async function addPhotos(files) {
    if (!files.length) return;
    toast('写真を読み込み中…');
    for (const f of files) {
      try {
        const pid = await savePhoto(await compressImage(f));
        draft.photoIds.push(pid);
        draft.addedPhotos.push(pid);
      } catch (err) {
        toast(err.message);
      }
    }
    persist();
    drawPhotos();
  }

  async function removePhoto(i) {
    const [pid] = draft.photoIds.splice(i, 1);
    if (draft.addedPhotos.includes(pid)) {
      draft.addedPhotos = draft.addedPhotos.filter(x => x !== pid);
      await deletePhoto(pid);
    } else draft.removedPhotos.push(pid);
    persist();
    drawPhotos();
  }

  /* ----- bulk setlist editor ----- */
  let sheet = null;
  function openBulk() {
    sheet = document.createElement('div');
    sheet.className = 'modal';
    sheet.innerHTML = `<div class="sheet">
      <h2>セトリをまとめて編集</h2>
      <p class="hint">1行に1曲。「MC」「EN」「SE」「VCR」だけの行は区切りになります。行頭の番号（1. / M1 など）は自動で消えます。</p>
      <textarea spellcheck="false" autocapitalize="off" placeholder="AIZO&#10;Flash!!!&#10;MC&#10;どろん"></textarea>
      <div class="btn-row" style="margin-top:12px"><button data-x>キャンセル</button><button class="primary" data-ok>反映する</button></div>
    </div>`;
    const ta = sheet.querySelector('textarea');
    ta.value = formatSetlist(draft.setlist);
    sheet.addEventListener('click', e => {
      if (e.target.closest('[data-x]')) closeBulk();
      else if (e.target.closest('[data-ok]')) {
        const prevArtist = new Map(draft.setlist.filter(it => it.kind === 'song' && it.artist).map(it => [normTitle(it.title), it.artist]));
        draft.setlist = parseSetlist(ta.value).map(it => ({ ...it, artist: prevArtist.get(normTitle(it.title)) || '' }));
        persist();
        drawSetlist();
        closeBulk();
      }
    });
    document.body.append(sheet);
    document.body.classList.add('modal-open');
  }
  function closeBulk() {
    sheet?.remove();
    sheet = null;
    document.body.classList.remove('modal-open');
  }

  /* ----- save / cancel ----- */
  async function save() {
    if (saving) return;
    commits.forEach(c => c());
    const names = [...new Set(artistsNow())];
    if (!names.length) return toast('アーティストを入力してください');
    if (!draft.date) return toast('開催日を入力してください');
    saving = true;
    try {
      const artistIds = [];
      for (const n of names) {
        const aid = await ensureArtist(n);
        if (!artistIds.includes(aid)) artistIds.push(aid);
      }
      const setlist = [];
      for (const it of draft.setlist) {
        const title = it.title.trim();
        if (it.kind === 'song' && !title) continue;
        const item = { kind: it.kind, title };
        const own = it.kind === 'song' && names.length > 1 && it.artist && names.includes(it.artist) && it.artist !== names[0];
        if (own) item.artistId = await ensureArtist(it.artist);
        setlist.push(item);
      }
      const live = {
        ...existing,
        id: existing?.id || uid(),
        title: draft.title.trim(),
        type: draft.type,
        date: draft.date,
        venue: draft.venue.trim(),
        openTime: draft.openTime,
        startTime: draft.startTime,
        artistIds,
        setlist,
        seat: draft.seat.trim(),
        expenses: draft.expenses
          .filter(x => Number(x.amount) > 0)
          .map(x => ({ category: x.category, amount: Number(x.amount) })),
        ticketUrl: draft.ticketUrl.trim(),
        siteUrl: draft.siteUrl.trim(),
        guests: [...draft.guests],
        companions: [...draft.companions],
        rating: draft.rating,
        favorite: draft.favorite,
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
    goBack(existing ? `#/live/${existing.id}` : '#/');
  }

  /* ----- events ----- */
  const onField = e => {
    const t = e.target;
    if (t.dataset.f) draft[t.dataset.f] = t.type === 'checkbox' ? t.checked : t.value;
    else if (t.dataset.sl != null) draft.setlist[Number(t.dataset.sl)].title = t.value;
    else if (t.dataset.sla != null) draft.setlist[Number(t.dataset.sla)].artist = t.value;
    else if (t.dataset.exa != null) draft.expenses[Number(t.dataset.exa)].amount = t.value;
    else if (t.dataset.exc != null) draft.expenses[Number(t.dataset.exc)].category = t.value;
    else if (t.matches('[data-phadd]') && e.type === 'change') {
      addPhotos([...t.files]);
      return;
    } else return;
    persist();
  };
  view.addEventListener('input', onField);
  view.addEventListener('change', onField);

  view.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
    const t = e.target;
    if (t.dataset.sl == null) return;
    e.preventDefault();
    const i = Number(t.dataset.sl);
    draft.setlist.splice(i + 1, 0, { kind: 'song', title: '', artist: '' });
    persist();
    drawSetlist(i + 1);
  });

  view.addEventListener('click', e => {
    const el = e.target.closest('button');
    if (!el) return;
    const d = el.dataset;
    if (d.act === 'save') save();
    else if (d.act === 'cancel') cancel();
    else if (d.act === 'bulk') openBulk();
    else if (d.act === 'add-expense') {
      draft.expenses.push({ category: draft.expenses.length ? 'グッズ' : 'チケット', amount: '' });
      drawExpenses();
      exEl.querySelector(`[data-exa="${draft.expenses.length - 1}"]`)?.focus();
    } else if (d.add) {
      draft.setlist.push({ kind: d.add, title: '', artist: '' });
      drawSetlist(d.add === 'song' ? draft.setlist.length - 1 : undefined);
    } else if (d.mv) {
      const i = Number(d.i);
      const j = i + Number(d.mv);
      [draft.setlist[i], draft.setlist[j]] = [draft.setlist[j], draft.setlist[i]];
      drawSetlist();
    } else if (d.del != null) {
      draft.setlist.splice(Number(d.del), 1);
      drawSetlist();
    } else if (d.exd != null) {
      draft.expenses.splice(Number(d.exd), 1);
      drawExpenses();
    } else if (d.rate) {
      const v = Number(d.rate);
      draft.rating = draft.rating === v ? 0 : v;
      drawRating();
    } else if (d.phd != null) {
      removePhoto(Number(d.phd));
      return;
    } else return;
    persist();
  });

  drawSetlist();
  updateSongList();
  drawRating();
  drawExpenses();
  drawPhotos();

  return () => {
    writeDraft();
    closeBulk();
    document.removeEventListener('visibilitychange', onHide);
  };
}
