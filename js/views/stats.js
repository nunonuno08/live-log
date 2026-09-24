import { state, allLives, isPast, songIdsOf, songTable, artistName, venueName, hydratePhotos } from '../store.js';
import { esc, yen, today, matchKey } from '../util.js';
import { avatar, liveRow, barsHtml, countBy, songArt } from '../components.js';

const TABS = [
  ['overview', '概要'],
  ['artists', 'アーティスト'],
  ['songs', '曲'],
  ['years', '年'],
  ['venues', '会場'],
];

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
    view.querySelector('#song-list').innerHTML = songListHtml(currentSongs);
  });
}

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

function overview(lives) {
  if (!lives.length) return '<div class="empty">この期間の記録はありません</div>';
  const artists = new Set(lives.flatMap(l => l.artistIds));
  const venues = new Set(lives.map(l => l.venueId).filter(Boolean));
  const heard = lives.flatMap(songIdsOf);
  const spend = spendOf(lives);
  const withSpend = lives.filter(l => (l.expenses || []).some(x => Number(x.amount))).length;

  // Spending is attributed to each live's main artist.
  const byArtist = new Map();
  for (const l of lives) {
    const sum = (l.expenses || []).reduce((s, x) => s + (Number(x.amount) || 0), 0);
    if (sum) byArtist.set(l.artistIds[0], (byArtist.get(l.artistIds[0]) || 0) + sum);
  }
  const types = countBy(lives, l => l.type || 'その他');
  const upcoming = allLives().filter(l => !isPast(l));

  return `
    <div class="kpis">
      ${kpi('参戦', lives.length, '本')}${kpi('アーティスト', artists.size, '組')}${kpi('会場', venues.size, 'か所')}
      ${kpi('聴いた曲', heard.length, '曲')}${kpi('曲の種類', new Set(heard).size, '曲')}${kpi('支出', yen(spend.total), '')}
    </div>
    ${
      spend.total
        ? `<section class="card">
            <h2>支出</h2>
            ${withSpend ? `<p class="muted small">1本あたり ${yen(spend.total / withSpend)}（支出を記録した${withSpend}本の平均）</p>` : ''}
            ${barsHtml(spend.byCat.map(([k, v]) => ({ label: k, value: v, text: yen(v) })))}
          </section>`
        : ''
    }
    ${
      byArtist.size
        ? `<section class="card"><h2>アーティスト別の支出</h2>${barsHtml(
            [...byArtist].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([id, v]) => ({ label: artistName(id), value: v, text: yen(v) })),
          )}</section>`
        : ''
    }
    <section class="card"><h2>種別</h2>${barsHtml(types.map(([k, v]) => ({ label: k, value: v, text: `${v}本` })))}</section>
    ${!period && upcoming.length ? `<h3 class="sec">これからのライブ <span>${upcoming.length}</span></h3>${upcoming.slice(0, 3).map(liveRow).join('')}` : ''}`;
}

function artistsTab(lives) {
  if (!lives.length) return '<div class="empty">この期間の記録はありません</div>';
  const ranking = countBy(lives.flatMap(l => l.artistIds), id => id);
  const max = ranking[0][1];
  return `<section class="card">${ranking
    .map(
      ([id, c], i) => `<a class="rank-row" href="#/artist/${id}">
        <span class="rk r${i + 1}">${i + 1}</span>${avatar(state.artists.get(id), 'sm')}
        <div class="rk-body"><div class="t">${esc(artistName(id))}</div><div class="bar"><i style="width:${(c / max) * 100}%"></i></div></div>
        <span class="rk-val">${c}本<small>${Math.round((c / lives.length) * 100)}%</small></span></a>`,
    )
    .join('')}</section>`;
}

let currentSongs = [];

function songListHtml(list) {
  const q = matchKey(songQuery);
  const shown = q ? list.filter(r => matchKey(r.song.title).includes(q)) : list;
  if (!shown.length) return '<div class="empty">曲がありません</div>';
  return shown
    .map(
      r => `<a class="rank-row" href="#/song/${r.song.id}">
        <span class="rk r${r.rank}">${r.rank}</span>${songArt(r.song, 'sm')}
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
  return `
    <div class="row2 tight">
      <select id="song-artist"><option value="">すべてのアーティスト</option>${artistIds
        .map(id => `<option value="${id}" ${id === songArtistId ? 'selected' : ''}>${esc(artistName(id))}</option>`)
        .join('')}</select>
      <input type="search" id="song-q" placeholder="曲名で検索" value="${esc(songQuery)}">
    </div>
    <p class="muted small">${currentSongs.length}曲 · 延べ ${currentSongs.reduce((s, x) => s + x.count, 0)}回</p>
    <section class="card" id="song-list">${songListHtml(currentSongs)}</section>`;
}

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
    <h3 class="sec">${selYear}年</h3>
    <div class="kpis">
      ${kpi('参戦', yPast.length, '本')}${kpi('予定', yUpcoming.length, '本')}${kpi('支出', yen(spend.total), '')}
    </div>
    <section class="card">
      <h2>月別</h2>
      <div class="vbars short">${months
        .map((c, m) => `<div class="vbar ${c ? 'on' : ''}"><em>${c || ''}</em><i style="height:${(c / mMax) * 70}%"></i><span>${m + 1}</span></div>`)
        .join('')}</div>
      ${topArtist ? `<p class="small">いちばん行ったアーティスト: <b>${esc(artistName(topArtist[0]))}</b>（${topArtist[1]}本）</p>` : ''}
      ${topVenue ? `<p class="small">いちばん行った会場: <b>${esc(venueName(topVenue[0]))}</b>（${topVenue[1]}本）</p>` : ''}
    </section>
    ${[...yLives].reverse().map(liveRow).join('')}`;
}

function venuesTab(lives) {
  const ranking = countBy(lives, l => l.venueId);
  if (!ranking.length) return '<div class="empty">会場が記録されたライブがありません</div>';
  return `<section class="card">${ranking
    .map(
      ([id, c], i) => `<a class="rank-row" href="#/venue/${id}">
        <span class="rk r${i + 1}">${i + 1}</span>
        <div class="rk-body"><div class="t">${esc(venueName(id))}</div>${state.venues.get(id)?.area ? `<div class="muted small">${esc(state.venues.get(id).area)}</div>` : ''}</div>
        <span class="rk-val">${c}本</span></a>`,
    )
    .join('')}</section>`;
}
