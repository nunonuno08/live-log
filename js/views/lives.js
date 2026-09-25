// Lives tab: the next live as a big card, then every live as a ticket stub (or a photo grid),
// upcoming first then by year.
import { state, allLives, isPast, liveTitle, artistName, venueName, songIdsOf, songTitle, hydratePhotos } from '../store.js';
import { esc, matchKey, fmtDate, daysUntil, today } from '../util.js';
import { liveRow, artistColor, artistStripe } from '../components.js';
import { pickArtist } from '../ui.js';

const MODE_KEY = 'livelog-lives-mode';
let query = '';
let mode = (() => {
  try {
    return localStorage.getItem(MODE_KEY) === 'grid' ? 'grid' : 'list';
  } catch {
    return 'list';
  }
})();

const LIST_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const GRID_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="currentColor"><rect x="3.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.6"/></g></svg>';

export function render(view) {
  const toggle = () =>
    `<button type="button" class="icon-btn" id="mode" aria-label="${mode === 'grid' ? 'リスト表示' : '写真で表示'}">${mode === 'grid' ? LIST_ICON : GRID_ICON}</button>`;
  view.innerHTML = `
    <header class="top"><h1>ライブ</h1>${toggle()}</header>
    <input type="search" id="q" placeholder="検索（ライブ名・会場・曲名など）" value="${esc(query)}">
    <div id="list"></div>`;
  const list = view.querySelector('#list');
  const draw = () => {
    list.innerHTML = listHtml();
    hydratePhotos(list);
  };
  draw();
  view.addEventListener('input', e => {
    if (e.target.id !== 'q') return;
    query = e.target.value;
    draw();
  });
  view.addEventListener('click', e => {
    const b = e.target.closest('#mode');
    if (!b) return;
    mode = mode === 'grid' ? 'list' : 'grid';
    try {
      localStorage.setItem(MODE_KEY, mode);
    } catch {}
    b.outerHTML = toggle();
    draw();
  });
}

export async function addLive() {
  const id = await pickArtist({ title: 'どのアーティストのライブ？' });
  if (id) location.hash = `#/new?artist=${id}`;
}

const haystack = l =>
  matchKey([liveTitle(l), ...l.artistIds.map(artistName), venueName(l.venueId), ...songIdsOf(l).map(songTitle), l.seat, l.memo].join(' '));

/** The next live, big: photo (or the artist's), countdown, date and times. */
function nextLiveCard(l) {
  const days = daysUntil(l.date);
  const count =
    l.date === today() ? '<b>今日</b>' : days === 1 ? '<b>明日</b>' : `<small>あと</small><b>${days}</b><small>日</small>`;
  const photoId = l.photoIds?.[0] || l.artistIds.map(id => state.artists.get(id)?.photoId).find(Boolean);
  const times = [l.openTime && `開場 ${l.openTime}`, l.startTime && `開演 ${l.startTime}`].filter(Boolean).join(' / ');
  const sub = [l.title?.trim() ? l.artistIds.map(artistName).join(' / ') : '', venueName(l.venueId)].filter(Boolean).join(' · ');
  const color = l.artistIds[0] ? artistColor(l.artistIds[0]) : 'var(--accent)';
  return `<a class="next-live" href="#/live/${l.id}" style="--ac:${color};--stripe:${artistStripe(l)}">
    ${photoId ? `<img data-photo="${photoId}" alt="">` : ''}
    <div class="nl-fade"></div>
    <div class="nl-top"><span class="nl-label">NEXT LIVE</span><span class="nl-count">${count}</span></div>
    <div class="nl-body">
      <div class="nl-date">${esc(fmtDate(l.date))}${times ? ` · ${esc(times)}` : ''}</div>
      <div class="nl-title">${esc(liveTitle(l))}</div>
      ${sub ? `<div class="nl-sub">${esc(sub)}</div>` : ''}
    </div>
  </a>`;
}

/** A live as a square photo tile; without a photo, the artist's colour and the title. */
function liveTile(l) {
  const [, m, d] = l.date.split('-');
  const photo = l.photoIds?.[0];
  const color = l.artistIds[0] ? artistColor(l.artistIds[0]) : 'var(--muted)';
  return `<a class="tile ${photo ? '' : 'none'}" href="#/live/${l.id}" style="--ac:${color}">
    ${photo ? `<img data-photo="${photo}" alt="">` : `<span class="tile-title">${esc(liveTitle(l))}</span>`}
    <span class="tile-date">${+m}.${+d}</span>
  </a>`;
}

function listHtml() {
  const lives = allLives();
  if (!lives.length) return `<div class="empty">まだライブの記録がありません。<br>右下の「＋」から追加できます。</div>`;
  const q = matchKey(query);
  const shown = q ? lives.filter(l => haystack(l).includes(q)) : lives;
  if (!shown.length) return '<div class="empty">見つかりません</div>';
  const grid = mode === 'grid';
  const group = items => (grid ? `<div class="tiles">${items.map(liveTile).join('')}</div>` : items.map(liveRow).join(''));
  let upcoming = shown.filter(l => !isPast(l));
  const past = shown.filter(isPast).reverse();
  let html = '';
  if (upcoming.length && !q) {
    html += nextLiveCard(upcoming[0]);
    upcoming = upcoming.slice(1);
  }
  if (upcoming.length) html += `<h3 class="sec">これから <span>${upcoming.length}</span></h3>${group(upcoming)}`;
  const years = [...new Set(past.map(l => l.date.slice(0, 4)))];
  for (const y of years) {
    const items = past.filter(l => l.date.startsWith(y));
    html += `<h3 class="sec">${y} <span>${items.length}本</span></h3>${group(items)}`;
  }
  return html;
}
