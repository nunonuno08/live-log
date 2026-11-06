// Sharing lives with a friend (hidden tools in 設定): all lives go out as one small file
// without memos and photos; the friend picks the lives they also went to and imports those.
// Records are written by name, so artists, songs and venues the friend already has are reused.
import { state, allLives, artistName, ensureArtist, ensureVenue, ensureSong, saveLive } from './store.js';
import { esc, uid, today, fmtDate, matchKey, shareOrDownload } from './util.js';
import { openSheet } from './ui.js';
import { autoArtistPhoto, catalogFor } from './music.js';

const APP = 'livelog-share';

const artistRef = id => {
  const a = state.artists.get(id);
  return { name: a?.name || '', itunesId: a?.itunesId || null };
};

/** Writes every live (no memo, no photos) to one file and opens the share sheet. */
export async function exportShareFile() {
  const lives = allLives().map(l => {
    const v = state.venues.get(l.venueId);
    return {
      date: l.date,
      title: l.title || '',
      type: l.type || '',
      openTime: l.openTime || '',
      startTime: l.startTime || '',
      seat: l.seat || '',
      expenses: l.expenses || [],
      artists: l.artistIds.map(artistRef).filter(a => a.name),
      venue: v ? { name: v.name, area: v.area || '', lat: v.lat || null, lon: v.lon || null } : null,
      setlist: (l.setlist || [])
        .map(it => {
          if (it.kind === 'en') return { kind: 'en' };
          const s = state.songs.get(it.songId);
          return s && { kind: 'song', title: s.title, artist: artistRef(s.artistId), artwork: s.artwork || '' };
        })
        .filter(Boolean),
    };
  });
  const blob = new Blob([JSON.stringify({ app: APP, version: 1, exportedAt: new Date().toISOString(), lives })], { type: 'application/json' });
  return shareOrDownload(blob, `live-share-${today()}.json`);
}

/** Reads a share file, lets the user pick lives, and adds them. Resolves how many were added. */
export async function importShareFile(file) {
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    throw new Error('ファイルを読み込めませんでした');
  }
  if (data?.app !== APP || !Array.isArray(data.lives)) throw new Error('共有用に書き出したファイルではありません');
  const rows = data.lives
    .filter(l => l?.date && Array.isArray(l.artists))
    .map(l => ({ live: l, on: false, dup: alreadyHave(l) }))
    .sort((a, b) => b.live.date.localeCompare(a.live.date));
  if (!rows.length) throw new Error('ライブが入っていません');
  const picked = await pickLives(rows);
  if (!picked?.length) return 0;
  const before = new Set(state.artists.keys());
  for (const l of picked) await addLive(l);
  // Newly added artists get a photo and song list, as when registered by hand.
  for (const id of state.artists.keys()) {
    if (before.has(id)) continue;
    autoArtistPhoto(id).catch(() => {});
    catalogFor(id).catch(() => {});
  }
  return picked.length;
}

// Same day and at least one of the same artists: most likely the same live.
function alreadyHave(l) {
  const names = new Set(l.artists.map(a => matchKey(a.name)));
  return allLives().some(m => m.date === l.date && m.artistIds.some(id => names.has(matchKey(artistName(id)))));
}

async function addLive(l) {
  const artistIds = [];
  for (const a of l.artists) artistIds.push(await ensureArtist(a.name, { itunesId: a.itunesId || undefined }));
  const venueId = l.venue?.name ? await ensureVenue(l.venue.name, { area: l.venue.area, lat: l.venue.lat, lon: l.venue.lon }) : null;
  const setlist = [];
  for (const it of l.setlist || []) {
    if (it.kind === 'en') setlist.push({ kind: 'en' });
    else if (it.title && it.artist?.name) {
      const artistId = await ensureArtist(it.artist.name, { itunesId: it.artist.itunesId || undefined });
      setlist.push({ kind: 'song', songId: await ensureSong(artistId, it.title, { artwork: it.artwork }) });
    }
  }
  await saveLive({
    id: uid(),
    artistIds: [...new Set(artistIds)],
    title: l.title || '',
    type: l.type || '',
    date: l.date,
    venueId,
    openTime: l.openTime || '',
    startTime: l.startTime || '',
    setlist,
    seat: l.seat || '',
    expenses: Array.isArray(l.expenses) ? l.expenses : [],
    memo: '',
    photoIds: [],
    createdAt: Date.now(),
  });
}

/** Checklist of the file's lives by year, all unticked; lives already here are marked. */
function pickLives(rows) {
  const rowHtml = (r, i) => {
    const l = r.live;
    const sub = [l.title ? l.artists.map(a => a.name).join(' / ') : '', l.venue?.name].filter(Boolean).join(' · ');
    return `<label class="imp-row">
      <input type="checkbox" data-i="${i}" ${r.on ? 'checked' : ''}>
      <span class="imp-main">
        <b>${esc(l.title || l.artists.map(a => a.name).join(' / ') || '(無題)')}</b>
        <small>${esc(fmtDate(l.date))}${sub ? ` · ${esc(sub)}` : ''}</small>
        ${r.dup ? '<em>登録済みかも（同じ日・同じアーティスト）</em>' : ''}
      </span>
    </label>`;
  };
  let year = '';
  const list = rows
    .map((r, i) => {
      const y = r.live.date.slice(0, 4);
      const head = y !== year ? `<h3 class="sec">${y}</h3>` : '';
      year = y;
      return head + rowHtml(r, i);
    })
    .join('');
  const count = () => rows.filter(r => r.on).length;
  return openSheet({
    title: 'ほかの人の記録を取り込む',
    tall: true,
    html: `<p class="hint">自分も行ったライブにチェックを付けてください。メモと写真は入っていません。座席や支出は、取り込んだあとに直せます。「すべて選ぶ」では、登録済みかもしれないライブは選ばれません。</p>
      <div class="btn-row imp-bulk"><button type="button" data-all="1">すべて選ぶ</button><button type="button" data-all="0">すべて外す</button></div>
      <div class="imp-list">${list}</div>
      <button type="button" class="wide primary" data-ok disabled>取り込む</button>`,
    onMount(sheet, close) {
      const ok = sheet.querySelector('[data-ok]');
      const refresh = () => {
        const n = count();
        ok.textContent = n ? `${n}本を取り込む` : '取り込むライブを選んでください';
        ok.disabled = !n;
      };
      refresh();
      sheet.addEventListener('change', e => {
        if (e.target.dataset.i == null) return;
        rows[Number(e.target.dataset.i)].on = e.target.checked;
        refresh();
      });
      sheet.addEventListener('click', e => {
        const all = e.target.closest('[data-all]');
        if (all) {
          // "Select all" leaves out lives that look already registered (tick those by hand).
          rows.forEach(r => (r.on = all.dataset.all === '1' && !r.dup));
          sheet.querySelectorAll('[data-i]').forEach(cb => (cb.checked = rows[Number(cb.dataset.i)].on));
          refresh();
        }
        if (e.target.closest('[data-ok]')) close(rows.filter(r => r.on).map(r => r.live));
      });
    },
  });
}
