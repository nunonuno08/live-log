import { state, allLives, isPast, songs, songKey, songTable, artistName, hydratePhotos } from '../store.js';
import { esc, fmtDate, yen, today, normTitle } from '../util.js';
import { avatar, liveRow, barsHtml, countBy } from '../components.js';

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
    const years = [...new Set(allLives().filter(isPast).map(l => l.date.slice(0, 4)))].sort().reverse();
    if (period && !years.includes(period)) period = '';
    const lives = allLives().filter(l => isPast(l) && (!period || l.date.startsWith(period)));
    const periodSel =
      tab === 'years'
        ? ''
        : `<div class="list-head"><span class="muted small">期間</span><select id="period" class="mini">
            <option value="">すべて</option>${years.map(y => `<option ${y === period ? 'selected' : ''}>${y}</option>`).join('')}
          </select></div>`;
    if (!allLives().some(isPast)) {
      body.innerHTML = '<div class="empty">参戦済みのライブを記録すると、ここに統計が表示されます。</div>';
      return;
    }
    const html = { overview, artists: artistsTab, songs: songsTab, years: yearsTab, venues: venuesTab }[tab](lives);
    body.innerHTML = periodSel + html;
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
  const venues = new Set(lives.map(l => l.venue?.trim()).filter(Boolean));
  const heard = lives.flatMap(l => songs(l).map(s => songKey(s, l)));
  const rated = lives.filter(l => l.rating);
  const avg = rated.length ? (rated.reduce((s, l) => s + l.rating, 0) / rated.length).toFixed(1) : '-';
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
      ${kpi('参戦', lives.length, '回')}${kpi('アーティスト', artists.size, '組')}${kpi('会場', venues.size, 'か所')}
      ${kpi('聴いた曲', heard.length, '曲')}${kpi('曲の種類', new Set(heard).size, '曲')}${kpi('平均評価', avg, '')}
    </div>
    <section class="card">
      <h2>支出</h2>
      <div class="big">${yen(spend.total)}</div>
      ${withSpend ? `<div class="muted small">1回あたり ${yen(spend.total / withSpend)}（支出を記録した${withSpend}回の平均）</div>` : ''}
      ${barsHtml(spend.byCat.map(([k, v]) => ({ label: k, value: v, text: yen(v) })))}
    </section>
    ${
      byArtist.size
        ? `<section class="card"><h2>アーティスト別の支出</h2>${barsHtml(
            [...byArtist].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([id, v]) => ({ label: artistName(id), value: v, text: yen(v) })),
          )}</section>`
        : ''
    }
    <section class="card"><h2>種別</h2>${barsHtml(types.map(([k, v]) => ({ label: k, value: v, text: `${v}回` })))}</section>
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
        <span class="rk-val">${c}回<small>${Math.round((c / lives.length) * 100)}%</small></span></a>`,
    )
    .join('')}</section>`;
}

let currentSongs = [];

function songListHtml(list) {
  const q = normTitle(songQuery);
  const shown = q ? list.filter(s => normTitle(s.title).includes(q)) : list;
  if (!shown.length) return '<div class="empty">曲がありません</div>';
  return shown
    .map(
      s => `<a class="rank-row" href="#/song/${encodeURIComponent(s.key)}">
        <span class="rk r${s.rank}">${s.rank}</span>
        <div class="rk-body"><div class="t">${esc(s.title)}</div><div class="muted small">${esc(artistName(s.artistId))}</div></div>
        <span class="rk-val">${s.count}回</span></a>`,
    )
    .join('');
}

function songsTab(lives) {
  const table = songTable(lives);
  const artistIds = [...new Set(table.map(s => s.artistId))].sort((a, b) => artistName(a).localeCompare(artistName(b), 'ja'));
  if (songArtistId && !artistIds.includes(songArtistId)) songArtistId = '';
  // Equal counts share the same rank.
  let rank = 0;
  let prev = null;
  currentSongs = table
    .filter(s => !songArtistId || s.artistId === songArtistId)
    .map((s, i) => {
      if (s.count !== prev) rank = i + 1;
      prev = s.count;
      return { ...s, rank };
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
  const topVenue = countBy(yPast, l => l.venue?.trim())[0];
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
      ${kpi('参戦', yPast.length, '回')}${kpi('予定', yUpcoming.length, '件')}${kpi('支出', yen(spend.total), '')}
    </div>
    <section class="card">
      <h2>月別</h2>
      <div class="vbars short">${months
        .map((c, m) => `<div class="vbar ${c ? 'on' : ''}"><em>${c || ''}</em><i style="height:${(c / mMax) * 70}%"></i><span>${m + 1}</span></div>`)
        .join('')}</div>
      ${topArtist ? `<p class="small">最も多く行ったアーティスト: <b>${esc(artistName(topArtist[0]))}</b>（${topArtist[1]}回）</p>` : ''}
      ${topVenue ? `<p class="small">最も多く行った会場: <b>${esc(topVenue[0])}</b>（${topVenue[1]}回）</p>` : ''}
    </section>
    ${[...yLives].reverse().map(liveRow).join('')}`;
}

function venuesTab(lives) {
  const byVenue = new Map();
  for (const l of lives) {
    const v = l.venue?.trim();
    if (!v) continue;
    if (!byVenue.has(v)) byVenue.set(v, []);
    byVenue.get(v).push(l);
  }
  if (!byVenue.size) return '<div class="empty">会場が記録されたライブがありません</div>';
  const ranking = [...byVenue].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], 'ja'));
  return `<p class="muted small">タップすると、その会場での日付と座席が見られます。</p><section class="card">${ranking
    .map(
      ([v, ls], i) => `<details class="venue">
        <summary class="rank-row"><span class="rk r${i + 1}">${i + 1}</span><div class="rk-body"><div class="t">${esc(v)}</div></div><span class="rk-val">${ls.length}回</span></summary>
        <div class="venue-lives">${[...ls]
          .reverse()
          .map(
            l => `<a href="#/live/${l.id}" class="venue-live"><span class="muted small">${fmtDate(l.date, false)}</span>
              <span>${esc(l.title?.trim() || l.artistIds.map(artistName).join(' / '))}</span>
              ${l.seat ? `<span class="seat">💺 ${esc(l.seat)}</span>` : ''}</a>`,
          )
          .join('')}</div>
      </details>`,
    )
    .join('')}</section>`;
}

/* ---------- a single song ---------- */

export function renderSong(view, key) {
  const s = songTable(allLives().filter(isPast)).find(x => x.key === key);
  if (!s) {
    view.innerHTML = `<header class="top"><button class="icon-btn" data-back="#/stats">‹</button><h1></h1></header><div class="empty">まだ参戦したライブで聴いていない曲です</div>`;
    return;
  }
  const rows = [...s.lives].reverse().map(l => {
    let n = 0;
    let pos = 0;
    for (const it of songs(l)) {
      n++;
      if (songKey(it, l) === key) {
        pos = n;
        break;
      }
    }
    return { l, pos, total: songs(l).length };
  });
  view.innerHTML = `
    <header class="top"><button class="icon-btn" data-back="#/stats">‹</button><h1></h1></header>
    <section class="live-head">
      <h1>${esc(s.title)}</h1>
      <a class="chip artist-chip" href="#/artist/${s.artistId}">${avatar(state.artists.get(s.artistId), 'xs')}${esc(artistName(s.artistId))}</a>
      <div class="kpis" style="margin-top:14px">
        ${kpi('聴いた回数', s.count, '回')}${kpi('初めて', fmtDate(s.lives[0].date, false).slice(0, 7), '')}${kpi('最後', fmtDate(s.lives.at(-1).date, false).slice(0, 7), '')}
      </div>
    </section>
    ${rows
      .map(
        ({ l, pos, total }) => `<div class="song-live">${liveRow(l)}<span class="muted small">${pos}曲目 / 全${total}曲</span></div>`,
      )
      .join('')}`;
  hydratePhotos(view);
}
