// Lives tab: every live as a ticket stub, upcoming first then by year.
import { allLives, isPast, liveTitle, artistName, venueName, songIdsOf, songTitle } from '../store.js';
import { esc, matchKey } from '../util.js';
import { liveRow } from '../components.js';
import { pickArtist } from '../ui.js';

let query = '';

export function render(view) {
  view.innerHTML = `
    <header class="top"><h1>ライブ</h1></header>
    <input type="search" id="q" placeholder="検索（ライブ名・会場・曲名など）" value="${esc(query)}">
    <div id="list"></div>`;
  const list = view.querySelector('#list');
  const draw = () => (list.innerHTML = listHtml());
  draw();
  view.addEventListener('input', e => {
    if (e.target.id !== 'q') return;
    query = e.target.value;
    draw();
  });
}

export async function addLive() {
  const id = await pickArtist({ title: 'どのアーティストのライブ？' });
  if (id) location.hash = `#/new?artist=${id}`;
}

const haystack = l =>
  matchKey([liveTitle(l), ...l.artistIds.map(artistName), venueName(l.venueId), ...songIdsOf(l).map(songTitle), l.seat, l.memo].join(' '));

function listHtml() {
  const lives = allLives();
  if (!lives.length) return `<div class="empty">まだライブの記録がありません。<br>右下の「＋」から追加できます。</div>`;
  const q = matchKey(query);
  const shown = q ? lives.filter(l => haystack(l).includes(q)) : lives;
  if (!shown.length) return '<div class="empty">見つかりません</div>';
  const upcoming = shown.filter(l => !isPast(l));
  const past = shown.filter(isPast).reverse();
  let html = upcoming.length ? `<h3 class="sec">これから <span>${upcoming.length}</span></h3>${upcoming.map(liveRow).join('')}` : '';
  let year = '';
  for (const l of past) {
    const y = l.date.slice(0, 4);
    if (y !== year) {
      year = y;
      html += `<h3 class="sec">${y} <span>${past.filter(x => x.date.startsWith(y)).length}本</span></h3>`;
    }
    html += liveRow(l);
  }
  return html;
}
