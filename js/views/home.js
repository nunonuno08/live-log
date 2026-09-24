// Artists tab (the start screen).
import { state, allLives, isPast, hydratePhotos } from '../store.js';
import { esc, matchKey, today } from '../util.js';
import { avatar, liveRow } from '../components.js';
import { pickArtist } from '../ui.js';

export const BACKUP_KEY = 'livelog-last-backup';

let sort = 'recent';
let query = '';

export function render(view) {
  const lives = allLives();
  const past = lives.filter(isPast);
  const thisYear = past.filter(l => l.date.startsWith(today().slice(0, 4))).length;
  const next = lives.find(l => !isPast(l));

  view.innerHTML = `
    <header class="top"><h1>アーティスト</h1></header>
    ${backupBanner()}
    <div class="hello">
      <div><b>${past.length}</b><span>通算</span></div>
      <div><b>${thisYear}</b><span>${today().slice(0, 4)}年</span></div>
      <div><b>${state.artists.size}</b><span>アーティスト</span></div>
    </div>
    ${next ? `<h3 class="sec">次のライブ</h3>${liveRow(next)}` : ''}
    <div class="list-head">
      <input type="search" id="q" class="grow" placeholder="絞り込み" value="${esc(query)}">
      <select id="sort" class="mini">
        <option value="recent" ${sort === 'recent' ? 'selected' : ''}>最近</option>
        <option value="count" ${sort === 'count' ? 'selected' : ''}>回数</option>
        <option value="name" ${sort === 'name' ? 'selected' : ''}>名前</option>
      </select>
    </div>
    <div id="grid"></div>`;

  const grid = view.querySelector('#grid');
  const draw = () => {
    grid.innerHTML = gridHtml();
    hydratePhotos(grid);
  };
  draw();
  hydratePhotos(view);

  view.addEventListener('input', e => {
    if (e.target.id !== 'q') return;
    query = e.target.value;
    draw();
  });
  view.addEventListener('change', e => {
    if (e.target.id !== 'sort') return;
    sort = e.target.value;
    draw();
  });
}

export async function addArtist() {
  const id = await pickArtist({ title: 'アーティストを追加', registeredFirst: false });
  if (id) location.hash = `#/artist/${id}`;
}

function backupBanner() {
  if (state.lives.size < 3) return '';
  const last = Number(localStorage.getItem(BACKUP_KEY)) || 0;
  if (Date.now() - last < 30 * 86400000) return '';
  return `<a class="banner" href="#/settings">${last ? '最後のバックアップから30日以上経っています。' : 'まだバックアップがありません。'}設定から保存しておきましょう →</a>`;
}

function gridHtml() {
  if (!state.artists.size) {
    return `<div class="empty">まずはアーティストを登録しましょう。<br>右下の「＋」から検索できます。</div>`;
  }
  const stats = new Map([...state.artists.keys()].map(id => [id, { past: 0, upcoming: 0, latest: '' }]));
  for (const l of allLives()) {
    for (const id of l.artistIds) {
      const s = stats.get(id);
      if (!s) continue;
      if (isPast(l)) s.past++;
      else s.upcoming++;
      s.latest = l.date;
    }
  }
  const q = matchKey(query);
  const cmp = {
    recent: (a, b) => stats.get(b.id).latest.localeCompare(stats.get(a.id).latest) || (b.createdAt || 0) - (a.createdAt || 0),
    count: (a, b) => stats.get(b.id).past - stats.get(a.id).past || a.name.localeCompare(b.name, 'ja'),
    name: (a, b) => a.name.localeCompare(b.name, 'ja'),
  }[sort];
  const artists = [...state.artists.values()].filter(a => !q || matchKey(a.name).includes(q)).sort(cmp);
  if (!artists.length) return '<div class="empty">見つかりません</div>';
  return `<div class="a-grid">${artists
    .map(a => {
      const s = stats.get(a.id);
      return `<a class="a-card" href="#/artist/${a.id}">
        ${avatar(a, 'lg')}
        <div class="a-name">${esc(a.name)}</div>
        <div class="a-sub">${s.past ? `${s.past}回` : 'まだなし'}${s.upcoming ? ` · 予定${s.upcoming}` : ''}</div>
      </a>`;
    })
    .join('')}</div>`;
}
