import { state, allLives, isPast, songIdsOf, songTable, artistName, venueName, hydratePhotos } from '../store.js';
import { esc, yen, today, matchKey, daysUntil } from '../util.js';
import { avatar, liveRow, countBy, songArt } from '../components.js';
import { artworkAt } from '../music.js';

const TABS = [
  ['overview', '概要'],
  ['artists', 'アーティスト'],
  ['songs', '曲'],
  ['years', '年'],
  ['venues', '会場'],
];

// Chart colours (fixed, readable on both light and dark backgrounds).
const COLORS = ['#e2462b', '#f0a02c', '#2a9d8f', '#3d7be0', '#8b5cf6', '#e0529a', '#5aa84a'];
const OTHER = '#a9a398';

// Kept across visits.
let tab = 'overview';
let period = '';
let songArtistId = '';
let songQuery = '';
let selYear = '';

export function render(view, params) {
  if (params.get('tab')) tab = params.get('tab');
  if (params.has('artist')) songArtistId = params.get('artist');

  view.innerHTML = `
    <header class="top"><h1>統計</h1></header>
    <div class="seg">${TABS.map(([k, t]) => `<button data-tab="${k}" class="${tab === k ? 'on' : ''}">${t}</button>`).join('')}</div>
    <div id="body"></div>`;
  const body = view.querySelector('#body');

  const draw = () => {
    const past = allLives().filter(isPast);
    if (!past.length) {
      body.innerHTML = '<div class="empty">参戦済みのライブを記録すると、ここに統計が表示されます。</div>';
      return;
    }
    const years = [...new Set(past.map(l => l.date.slice(0, 4)))].sort().reverse();
    if (period && !years.includes(period)) period = '';
    const lives = past.filter(l => !period || l.date.startsWith(period));
    const periodSel =
      tab === 'years'
        ? ''
        : `<div class="list-head"><span class="muted small">期間</span><select id="period" class="mini">
            <option value="">すべて</option>${years.map(y => `<option ${y === period ? 'selected' : ''}>${y}</option>`).join('')}
          </select></div>`;
    body.innerHTML = periodSel + { overview, artists: artistsTab, songs: songsTab, years: yearsTab, venues: venuesTab }[tab](lives);
    hydratePhotos(body);
  };
  draw();

  view.addEventListener('click', e => {
    const t = e.target.closest('[data-tab]');
    if (t) {
      tab = t.dataset.tab;
      view.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('on', b === t));
      draw();
    }
    const y = e.target.closest('[data-year]');
    if (y) {
      selYear = y.dataset.year;
      draw();
    }
  });
  view.addEventListener('change', e => {
    if (e.target.id === 'period') period = e.target.value;
    else if (e.target.id === 'song-artist') songArtistId = e.target.value;
    else return;
    draw();
  });
  view.addEventListener('input', e => {
    if (e.target.id !== 'song-q') return;
    songQuery = e.target.value;
    // While searching, the top-3 cards step aside and the list shows every match.
    const list = view.querySelector('#song-list');
    list.innerHTML = songListHtml(songQuery ? currentSongs : currentSongs.slice(3));
    list.hidden = !list.innerHTML;
    const top = view.querySelector('.top-songs');
    if (top) top.hidden = !!songQuery;
  });
}

const empty = '<div class="empty">この期間の記録はありません</div>';
const kpi = (label, value, unit) => `<div class="kpi"><b>${value}<small>${unit}</small></b><span>${label}</span></div>`;

function spendOf(lives) {
  const byCat = new Map();
  let total = 0;
  for (const l of lives) {
    for (const x of l.expenses || []) {
      const a = Number(x.amount) || 0;
      if (!a) continue;
      byCat.set(x.category, (byCat.get(x.category) || 0) + a);
      total += a;
    }
  }
  return { byCat: [...byCat].sort((a, b) => b[1] - a[1]), total };
}

/* ---------- overview ---------- */

/** Donut of lives per artist, with each artist's photo placed next to their slice. */
function ringHtml(ranking, liveCount) {
  const total = ranking.reduce((s, [, c]) => s + c, 0);
  const segs = ranking.slice(0, COLORS.length).map(([id, c], i) => ({ id, c, color: COLORS[i] }));
  const rest = total - segs.reduce((s, x) => s + x.c, 0);
  if (rest) segs.push({ id: null, c: rest, color: OTHER });
  const SIZE = 280;
  const MID = SIZE / 2;
  const R = 86;
  const C = 2 * Math.PI * R;
  const gap = segs.length > 1 ? 4 : 0;
  let acc = 0;
  let arcs = '';
  let faces = '';
  for (const s of segs) {
    const len = (s.c / total) * C;
    arcs += `<circle cx="${MID}" cy="${MID}" r="${R}" fill="none" stroke="${s.color}" stroke-width="22"
      stroke-dasharray="${Math.max(len - gap, 0.5)} ${C}" stroke-dashoffset="${-acc}" transform="rotate(-90 ${MID} ${MID})"/>`;
    if (s.id && s.c / total >= 0.05) {
      const angle = ((acc + len / 2) / C) * 2 * Math.PI - Math.PI / 2;
      const x = ((MID + 118 * Math.cos(angle)) / SIZE) * 100;
      const y = ((MID + 118 * Math.sin(angle)) / SIZE) * 100;
      faces += `<a class="ring-face" href="#/artist/${s.id}" style="left:${x}%;top:${y}%;--c:${s.color}">${avatar(state.artists.get(s.id), 'sm')}</a>`;
    }
    acc += len;
  }
  return `<section class="card ring-card">
    <div class="ring">
      <svg viewBox="0 0 ${SIZE} ${SIZE}" aria-hidden="true">${arcs}</svg>
      ${faces}
      <div class="ring-center"><small>TOTAL</small><b>${liveCount}</b><span>本のライブ · ${ranking.length}組</span></div>
    </div>
    <div class="legend">${segs
      .map(s => `<span><i style="background:${s.color}"></i>${esc(s.id ? artistName(s.id) : 'その他')} <b>${s.c}</b></span>`)
      .join('')}</div>
  </section>`;
}

function overview(lives) {
  if (!lives.length) return empty;
  const ranking = countBy(lives.flatMap(l => l.artistIds), id => id);
  const topSong = songTable(lives)[0];
  const topVenue = countBy(lives, l => l.venueId)[0];
  const heard = lives.flatMap(songIdsOf);
  const spend = spendOf(lives);
  const withSpend = lives.filter(l => (l.expenses || []).some(x => Number(x.amount))).length;
  const spanDays = -daysUntil(lives[0].date) + daysUntil(lives.at(-1).date);
  const pace = lives.length > 1 ? Math.max(1, Math.round(spanDays / (lives.length - 1))) : null;
  const types = countBy(lives, l => l.type || 'その他');
  const upcoming = allLives().filter(l => !isPast(l));
  const topArtist = state.artists.get(ranking[0][0]);

  const highlights = [
    `<a class="hl photo" href="#/artist/${topArtist.id}">
      ${topArtist.photoId ? `<img data-photo="${topArtist.photoId}" alt="">` : ''}
      <div><small>いちばん行った</small><b>${esc(topArtist.name)}</b><span>${ranking[0][1]}本</span></div></a>`,
    topSong
      ? `<a class="hl photo" href="#/song/${topSong.song.id}">
          ${topSong.song.artwork ? `<img src="${esc(artworkAt(topSong.song.artwork, 300))}" crossorigin="anonymous" alt="">` : ''}
          <div><small>いちばん聴いた曲</small><b>${esc(topSong.song.title)}</b><span>${topSong.count}回</span></div></a>`
      : '',
    topVenue
      ? `<a class="hl tint" href="#/venue/${topVenue[0]}"><div><small>よく行く会場</small><b>${esc(venueName(topVenue[0]))}</b><span>${topVenue[1]}回</span></div></a>`
      : '',
    `<div class="hl tint2"><div><small>ライブのペース</small><b>${pace ? `${pace}日に1本` : '1本目！'}</b><span>初参戦から${-daysUntil(lives[0].date)}日</span></div></div>`,
  ].join('');

  return `
    ${ringHtml(ranking, lives.length)}
    <div class="hl-grid">${highlights}</div>
    <div class="kpis">
      ${kpi('聴いた曲（延べ）', heard.length, '曲')}${kpi('曲の種類', new Set(heard).size, '曲')}${kpi('会場', new Set(lives.map(l => l.venueId).filter(Boolean)).size, 'か所')}
    </div>
    ${
      spend.total
        ? `<section class="card">
            <h2>支出 <span class="big-inline">${yen(spend.total)}</span></h2>
            ${withSpend ? `<p class="muted small">1本あたり ${yen(spend.total / withSpend)}</p>` : ''}
            <div class="stack">${spend.byCat.map(([, v], i) => `<i style="width:${(v / spend.total) * 100}%;background:${COLORS[i % COLORS.length]}"></i>`).join('')}</div>
            <div class="legend left">${spend.byCat.map(([k, v], i) => `<span><i style="background:${COLORS[i % COLORS.length]}"></i>${esc(k)} <b>${yen(v)}</b></span>`).join('')}</div>
          </section>`
        : ''
    }
    <section class="card"><h2>種別</h2><div class="legend left">${types
      .map(([k, v], i) => `<span class="pill" style="--c:${COLORS[i % COLORS.length]}">${esc(k)} <b>${v}</b></span>`)
      .join('')}</div></section>
    ${!period && upcoming.length ? `<h3 class="sec">これからのライブ <span>${upcoming.length}</span></h3>${upcoming.slice(0, 3).map(liveRow).join('')}` : ''}`;
}

/* ---------- artists ---------- */

function artistsTab(lives) {
  if (!lives.length) return empty;
  const ranking = countBy(lives.flatMap(l => l.artistIds), id => id);
  const max = ranking[0][1];
  const podiumOrder = [1, 0, 2].filter(i => ranking[i]);
  const podium = `<div class="podium">${podiumOrder
    .map(i => {
      const [id, c] = ranking[i];
      return `<a class="pod p${i + 1}" href="#/artist/${id}">
        <span class="pod-face">${avatar(state.artists.get(id), 'lg')}<em>${i + 1}</em></span>
        <b>${esc(artistName(id))}</b><span>${c}本</span></a>`;
    })
    .join('')}</div>`;
  const rest = ranking
    .slice(3)
    .map(
      ([id, c], i) => `<a class="rank-row" href="#/artist/${id}">
        <span class="rk">${i + 4}</span>${avatar(state.artists.get(id), 'sm')}
        <div class="rk-body"><div class="t">${esc(artistName(id))}</div><div class="bar"><i style="width:${(c / max) * 100}%"></i></div></div>
        <span class="rk-val">${c}本<small>${Math.round((c / lives.length) * 100)}%</small></span></a>`,
    )
    .join('');
  return podium + (rest ? `<section class="card">${rest}</section>` : '');
}

/* ---------- songs ---------- */

let currentSongs = [];

function songListHtml(list) {
  const q = matchKey(songQuery);
  const shown = q ? list.filter(r => matchKey(r.song.title).includes(q)) : list;
  if (!shown.length) return q ? '<div class="empty">曲がありません</div>' : '';
  return shown
    .map(
      r => `<a class="rank-row" href="#/song/${r.song.id}">
        <span class="rk">${r.rank}</span>${songArt(r.song, 'sm')}
        <div class="rk-body"><div class="t">${esc(r.song.title)}</div><div class="muted small">${esc(artistName(r.song.artistId))}</div></div>
        <span class="rk-val">${r.count}回</span></a>`,
    )
    .join('');
}

function songsTab(lives) {
  const table = songTable(lives);
  const artistIds = [...new Set(table.map(r => r.song.artistId))].sort((a, b) => artistName(a).localeCompare(artistName(b), 'ja'));
  if (songArtistId && !artistIds.includes(songArtistId)) songArtistId = '';
  // Equal counts share the same rank.
  let rank = 0;
  let prev = null;
  currentSongs = table
    .filter(r => !songArtistId || r.song.artistId === songArtistId)
    .map((r, i) => {
      if (r.count !== prev) rank = i + 1;
      prev = r.count;
      return { ...r, rank };
    });
  const top = currentSongs.slice(0, 3);
  const topHtml = top.length
    ? `<div class="top-songs" ${songQuery ? 'hidden' : ''}>${top
        .map(
          r => `<a class="top-song" href="#/song/${r.song.id}">
            <span class="ts-art">${
              r.song.artwork ? `<img src="${esc(artworkAt(r.song.artwork, 300))}" crossorigin="anonymous" alt="">` : '<span class="art none">♪</span>'
            }<em>${r.rank}</em></span>
            <b>${esc(r.song.title)}</b><span>${esc(artistName(r.song.artistId))} · ${r.count}回</span></a>`,
        )
        .join('')}</div>`
    : '';
  const rest = songListHtml(songQuery ? currentSongs : currentSongs.slice(3));
  return `
    <div class="row2 tight">
      <select id="song-artist"><option value="">すべてのアーティスト</option>${artistIds
        .map(id => `<option value="${id}" ${id === songArtistId ? 'selected' : ''}>${esc(artistName(id))}</option>`)
        .join('')}</select>
      <input type="search" id="song-q" placeholder="曲名で検索" value="${esc(songQuery)}">
    </div>
    <p class="muted small">${currentSongs.length}曲 · 延べ ${currentSongs.reduce((s, x) => s + x.count, 0)}回</p>
    ${topHtml}
    <section class="card" id="song-list" ${rest ? '' : 'hidden'}>${rest}</section>`;
}

/* ---------- years ---------- */

function yearsTab() {
  const all = allLives();
  const thisYear = today().slice(0, 4);
  const first = Number(all[0].date.slice(0, 4));
  const last = Math.max(Number(thisYear), Number(all.at(-1).date.slice(0, 4)));
  const years = [];
  for (let y = first; y <= last; y++) years.push(String(y));
  if (!years.includes(selYear)) selYear = thisYear;

  const pastCount = y => all.filter(l => isPast(l) && l.date.startsWith(y)).length;
  const max = Math.max(1, ...years.map(pastCount));
  const yLives = all.filter(l => l.date.startsWith(selYear));
  const yPast = yLives.filter(isPast);
  const yUpcoming = yLives.filter(l => !isPast(l));
  const months = Array.from({ length: 12 }, (_, m) => yPast.filter(l => Number(l.date.slice(5, 7)) === m + 1).length);
  const mMax = Math.max(1, ...months);
  const topArtist = countBy(yPast.flatMap(l => l.artistIds), id => id)[0];
  const topVenue = countBy(yPast, l => l.venueId)[0];
  const topSong = songTable(yPast)[0];
  const spend = spendOf(yPast);

  return `
    <section class="card">
      <div class="vbars">${years
        .map(y => {
          const c = pastCount(y);
          return `<button class="vbar ${y === selYear ? 'on' : ''}" data-year="${y}"><em>${c || ''}</em><i style="height:${(c / max) * 75}%"></i><span>${y}</span></button>`;
        })
        .join('')}</div>
    </section>
    <h3 class="sec">${selYear}年のまとめ</h3>
    <div class="kpis">
      ${kpi('参戦', yPast.length, '本')}${kpi('予定', yUpcoming.length, '本')}${kpi('支出', yen(spend.total), '')}
    </div>
    <div class="hl-grid">
      ${topArtist ? `<a class="hl tint" href="#/artist/${topArtist[0]}"><div><small>いちばん行った</small><b>${esc(artistName(topArtist[0]))}</b><span>${topArtist[1]}本</span></div></a>` : ''}
      ${topSong ? `<a class="hl tint2" href="#/song/${topSong.song.id}"><div><small>いちばん聴いた曲</small><b>${esc(topSong.song.title)}</b><span>${topSong.count}回</span></div></a>` : ''}
      ${topVenue ? `<a class="hl tint2" href="#/venue/${topVenue[0]}"><div><small>よく行った会場</small><b>${esc(venueName(topVenue[0]))}</b><span>${topVenue[1]}回</span></div></a>` : ''}
    </div>
    <section class="card">
      <h2>月別</h2>
      <div class="vbars short">${months
        .map((c, m) => `<div class="vbar ${c ? 'on' : ''}"><em>${c || ''}</em><i style="height:${(c / mMax) * 70}%"></i><span>${m + 1}</span></div>`)
        .join('')}</div>
    </section>
    ${[...yLives].reverse().map(liveRow).join('')}`;
}

/* ---------- venues ---------- */

function venuesTab(lives) {
  const ranking = countBy(lives, l => l.venueId);
  if (!ranking.length) return '<div class="empty">会場が記録されたライブがありません</div>';
  const max = ranking[0][1];
  return `<section class="card">${ranking
    .map(
      ([id, c], i) => `<a class="rank-row" href="#/venue/${id}">
        <span class="rk ${i < 3 ? 'top' : ''}">${i + 1}</span>
        <div class="rk-body"><div class="t">${esc(venueName(id))}</div>${state.venues.get(id)?.area ? `<div class="muted small">${esc(state.venues.get(id).area)}</div>` : ''}
          <div class="bar"><i style="width:${(c / max) * 100}%"></i></div></div>
        <span class="rk-val">${c}回</span></a>`,
    )
    .join('')}</section>`;
}
