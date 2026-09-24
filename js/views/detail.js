// Single song and single venue pages, including fixing duplicates (rename / merge).
import { state, allLives, isPast, songIdsOf, artistName, renameSong, mergeSong, findSong, renameVenue, mergeVenue, findVenue, hydratePhotos } from '../store.js';
import { esc, fmtDate, matchKey, matchScore, toast } from '../util.js';
import { avatar, liveRow, songArt, notFound } from '../components.js';
import { artworkAt } from '../music.js';
import { openSheet } from '../ui.js';
import { nav, replace } from '../nav.js';

const kpi = (label, value) => `<div class="kpi"><b>${value}</b><span>${label}</span></div>`;

/* ---------- song ---------- */

export function renderSong(view, id) {
  const song = state.songs.get(id);
  if (!song) {
    view.innerHTML = notFound('曲', '#/stats');
    return;
  }
  const lives = allLives().filter(l => isPast(l) && songIdsOf(l).includes(id));
  const rows = [...lives].reverse().map(l => {
    const ids = songIdsOf(l);
    return { l, pos: ids.indexOf(id) + 1, total: ids.length };
  });

  view.innerHTML = `
    <header class="top"><button class="icon-btn" data-back="#/stats" aria-label="戻る">‹</button><h1></h1>
      <button class="icon-btn" data-act="menu" aria-label="メニュー">⋯</button></header>
    <section class="song-head">
      ${song.artwork ? `<img class="art xl" src="${esc(artworkAt(song.artwork, 300))}" crossorigin="anonymous" alt="">` : '<span class="art xl none">♪</span>'}
      <h1>${esc(song.title)}</h1>
      <a class="chip artist-chip" href="#/artist/${song.artistId}">${avatar(state.artists.get(song.artistId), 'xs')}${esc(artistName(song.artistId))}</a>
    </section>
    <div class="kpis">
      ${kpi('聴いた回数', `${lives.length}<small>回</small>`)}
      ${kpi('初めて', lives.length ? fmtDate(lives[0].date, false) : '-')}
      ${kpi('最後', lives.length ? fmtDate(lives.at(-1).date, false) : '-')}
    </div>
    ${rows.length ? '' : '<div class="empty">まだ参戦済みのライブで聴いていません</div>'}
    ${rows.map(({ l, pos, total }) => `<div class="song-live">${liveRow(l)}<span class="muted small">${pos}曲目 / 全${total}曲</span></div>`).join('')}`;
  hydratePhotos(view);

  view.addEventListener('click', async e => {
    if (e.target.closest('[data-act=menu]')) songMenu(song);
  });
}

async function songMenu(song) {
  const choice = await menuSheet(song.title, [
    ['rename', '曲名を変更'],
    ['merge', '別の曲とまとめる（同じ曲が2つあるとき）'],
  ]);
  if (choice === 'rename') {
    const title = prompt('曲名', song.title)?.trim();
    if (!title || title === song.title) return;
    const other = findSong(song.artistId, title);
    if (other && other.id !== song.id) {
      if (!confirm(`「${other.title}」がすでにあります。2つを1つにまとめますか？`)) return;
      await mergeSong(song.id, other.id);
      replace(`#/song/${other.id}`);
      return;
    }
    await renameSong(song.id, title);
    nav.rerender();
  }
  if (choice === 'merge') {
    const others = [...state.songs.values()].filter(s => s.artistId === song.artistId && s.id !== song.id);
    const to = await pickFrom('まとめる先の曲', others.map(s => ({ id: s.id, label: s.title, key: s.key, art: s })));
    if (!to || !confirm(`「${song.title}」を「${state.songs.get(to).title}」にまとめます。よろしいですか？`)) return;
    await mergeSong(song.id, to);
    toast('まとめました');
    replace(`#/song/${to}`);
  }
}

/* ---------- venue ---------- */

export function renderVenue(view, id) {
  const venue = state.venues.get(id);
  if (!venue) {
    view.innerHTML = notFound('会場', '#/stats');
    return;
  }
  const lives = allLives().filter(l => l.venueId === id).reverse();
  const seats = lives.filter(l => l.seat?.trim());
  view.innerHTML = `
    <header class="top"><button class="icon-btn" data-back="#/stats" aria-label="戻る">‹</button><h1></h1>
      <button class="icon-btn" data-act="menu" aria-label="メニュー">⋯</button></header>
    <section class="song-head">
      <span class="art xl none">📍</span>
      <h1>${esc(venue.name)}</h1>
      ${venue.area ? `<p class="muted">${esc(venue.area)}</p>` : ''}
      ${venue.lat ? `<a class="more" href="https://maps.apple.com/?ll=${venue.lat},${venue.lon}&q=${encodeURIComponent(venue.name)}" target="_blank" rel="noopener">地図で開く ↗</a>` : ''}
    </section>
    <div class="kpis">${kpi('行った回数', `${lives.filter(isPast).length}<small>回</small>`)}${kpi('予定', `${lives.filter(l => !isPast(l)).length}<small>本</small>`)}${kpi('座席の記録', `${seats.length}<small>件</small>`)}</div>
    ${
      seats.length
        ? `<section class="card"><h2>これまでの座席</h2>${seats
            .map(l => `<div class="seat-row"><span class="muted small">${fmtDate(l.date, false)}</span><span>${esc(l.seat)}</span></div>`)
            .join('')}</section>`
        : ''
    }
    ${lives.map(liveRow).join('')}`;
  hydratePhotos(view);

  view.addEventListener('click', async e => {
    if (!e.target.closest('[data-act=menu]')) return;
    const choice = await menuSheet(venue.name, [
      ['rename', '会場名を変更'],
      ['merge', '別の会場とまとめる（同じ会場が2つあるとき）'],
    ]);
    if (choice === 'rename') {
      const name = prompt('会場名', venue.name)?.trim();
      if (!name || name === venue.name) return;
      const other = findVenue(name);
      if (other && other.id !== venue.id) {
        if (!confirm(`「${other.name}」がすでにあります。2つを1つにまとめますか？`)) return;
        await mergeVenue(venue.id, other.id);
        replace(`#/venue/${other.id}`);
        return;
      }
      await renameVenue(venue.id, name);
      nav.rerender();
    }
    if (choice === 'merge') {
      const others = [...state.venues.values()].filter(v => v.id !== venue.id);
      const to = await pickFrom('まとめる先の会場', others.map(v => ({ id: v.id, label: v.name, key: v.key })));
      if (!to || !confirm(`「${venue.name}」を「${state.venues.get(to).name}」にまとめます。よろしいですか？`)) return;
      await mergeVenue(venue.id, to);
      toast('まとめました');
      replace(`#/venue/${to}`);
    }
  });
}

/* ---------- helpers ---------- */

function menuSheet(title, items) {
  return openSheet({
    title,
    html: `<div class="menu">${items.map(([v, label]) => `<button type="button" data-v="${v}">${esc(label)}</button>`).join('')}</div>`,
    onMount: (sheet, close) => sheet.addEventListener('click', e => e.target.dataset.v && close(e.target.dataset.v)),
  });
}

function pickFrom(title, options) {
  return openSheet({
    title,
    tall: true,
    html: `<input type="search" class="sheet-search" placeholder="検索" autocomplete="off"><div class="pick-list"></div>`,
    onMount(sheet, close) {
      const input = sheet.querySelector('input');
      const list = sheet.querySelector('.pick-list');
      const draw = () => {
        const q = matchKey(input.value);
        const shown = q ? options.filter(o => matchScore(q, o.key)).sort((a, b) => matchScore(q, b.key) - matchScore(q, a.key)) : options;
        list.innerHTML = shown.length
          ? shown.map(o => `<button type="button" class="pick-row" data-id="${o.id}">${o.art ? songArt(o.art, 'xs') : ''}<span class="pick-name">${esc(o.label)}</span></button>`).join('')
          : '<p class="empty small">見つかりません</p>';
      };
      input.addEventListener('input', draw);
      list.addEventListener('click', e => {
        const b = e.target.closest('[data-id]');
        if (b) close(b.dataset.id);
      });
      draw();
    },
  });
}
