import { state, allLives, isPast, liveTitle, artistName, songs, hydratePhotos } from '../store.js';
import { esc, fmtDate, normTitle } from '../util.js';
import { avatar, liveRow } from '../components.js';

export const BACKUP_KEY = 'livelog-last-backup';

// Kept across visits so returning to the home screen restores the same tab.
let tab = 'artists';
let sort = 'recent';
let query = '';

export function render(view) {
  const next = allLives().find(l => !isPast(l));
  view.innerHTML = `
    <header class="top"><h1>ライブ記録</h1></header>
    ${backupBanner()}
    ${next ? `<h3 class="sec">次のライブ</h3>${liveRow(next)}` : ''}
    <div class="search"><input type="search" id="q" placeholder="検索（曲名・会場なども）" value="${esc(query)}"></div>
    <div class="seg">
      <button data-tab="artists" class="${tab === 'artists' ? 'on' : ''}">アーティスト</button>
      <button data-tab="lives" class="${tab === 'lives' ? 'on' : ''}">ライブ一覧</button>
    </div>
    <div id="list"></div>`;

  const list = view.querySelector('#list');
  const draw = () => {
    list.innerHTML = state.lives.size === 0 && state.artists.size === 0 ? emptyHtml() : tab === 'artists' ? artistsHtml() : livesHtml();
    hydratePhotos(list);
  };
  draw();
  hydratePhotos(view);

  view.addEventListener('input', e => {
    if (e.target.id === 'q') {
      query = e.target.value;
      draw();
    }
  });
  view.addEventListener('change', e => {
    if (e.target.id === 'sort') {
      sort = e.target.value;
      draw();
    }
  });
  view.addEventListener('click', e => {
    const t = e.target.closest('[data-tab]');
    if (!t) return;
    tab = t.dataset.tab;
    view.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('on', b === t));
    draw();
  });
}

function emptyHtml() {
  return `<div class="empty">まだ記録がありません。<br>右下の「＋」からライブを追加しましょう。</div>`;
}

function backupBanner() {
  if (state.lives.size < 3) return '';
  const last = Number(localStorage.getItem(BACKUP_KEY)) || 0;
  if (Date.now() - last < 30 * 86400000) return '';
  return `<a class="banner" href="#/settings">${last ? '最後のバックアップから30日以上経っています。' : 'まだバックアップがありません。'}設定から保存しておきましょう →</a>`;
}

function artistsHtml() {
  const stats = new Map([...state.artists.keys()].map(id => [id, { past: 0, upcoming: 0, last: '', latest: '' }]));
  for (const l of allLives()) {
    for (const id of l.artistIds) {
      const s = stats.get(id);
      if (!s) continue;
      if (isPast(l)) {
        s.past++;
        s.last = l.date;
      } else s.upcoming++;
      s.latest = l.date;
    }
  }
  const q = normTitle(query);
  const cmp = {
    recent: (a, b) => stats.get(b.id).latest.localeCompare(stats.get(a.id).latest),
    count: (a, b) => stats.get(b.id).past - stats.get(a.id).past || stats.get(b.id).latest.localeCompare(stats.get(a.id).latest),
    name: (a, b) => a.name.localeCompare(b.name, 'ja'),
  }[sort];
  const artists = [...state.artists.values()].filter(a => !q || normTitle(a.name).includes(q)).sort(cmp);

  const sortSel = `<div class="list-head"><span class="muted small">${artists.length}組</span>
    <select id="sort" class="mini">
      <option value="recent" ${sort === 'recent' ? 'selected' : ''}>最近の順</option>
      <option value="count" ${sort === 'count' ? 'selected' : ''}>参戦回数順</option>
      <option value="name" ${sort === 'name' ? 'selected' : ''}>名前順</option>
    </select></div>`;
  if (!artists.length) return sortSel + '<div class="empty">見つかりません</div>';
  return (
    sortSel +
    `<div class="a-grid">${artists
      .map(a => {
        const s = stats.get(a.id);
        return `<a class="a-card" href="#/artist/${a.id}">
          ${avatar(a, 'lg')}
          <div class="a-name">${esc(a.name)}</div>
          <div class="a-sub">${s.past}回${s.upcoming ? ` · 予定${s.upcoming}` : ''}${s.last ? ` · ${fmtDate(s.last, false)}` : ''}</div>
        </a>`;
      })
      .join('')}</div>`
  );
}

function haystack(l) {
  return normTitle(
    [liveTitle(l), ...l.artistIds.map(artistName), l.venue, ...songs(l).map(s => s.title), ...(l.companions || []), l.memo].join('\n'),
  );
}

function livesHtml() {
  const q = normTitle(query);
  const lives = allLives().filter(l => !q || haystack(l).includes(q));
  if (!lives.length) return '<div class="empty">見つかりません</div>';
  const upcoming = lives.filter(l => !isPast(l));
  const past = lives.filter(isPast).reverse();
  let html = '';
  if (upcoming.length) html += `<h3 class="sec">これから <span>${upcoming.length}</span></h3>` + upcoming.map(liveRow).join('');
  let year = '';
  for (const l of past) {
    const y = l.date.slice(0, 4);
    if (y !== year) {
      year = y;
      html += `<h3 class="sec">${y}年 <span>${past.filter(x => x.date.startsWith(y)).length}</span></h3>`;
    }
    html += liveRow(l);
  }
  return html;
}
