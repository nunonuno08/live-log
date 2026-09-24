import { esc, hue, weekday, daysUntil, today } from './util.js';
import { state, artistName, liveTitle, isPast, venueName } from './store.js';

export const TYPES = ['ワンマン', '対バン', 'フェス', 'イベント', '配信'];
export const EXPENSE_CATS = ['チケット', 'グッズ', 'ドリンク', '交通費', '宿泊費', 'その他'];

export function avatar(artist, cls = '') {
  if (artist?.photoId) return `<div class="avatar ${cls}"><img data-photo="${artist.photoId}" alt=""></div>`;
  const name = artist?.name?.trim() || '?';
  return `<div class="avatar ${cls}" style="--h:${hue(name)}"><span>${esc([...name][0])}</span></div>`;
}

export function songArt(song, cls = '') {
  return song?.artwork
    ? `<img class="art ${cls}" src="${esc(song.artwork)}" crossorigin="anonymous" loading="lazy" alt="">`
    : `<span class="art ${cls} none">♪</span>`;
}

/** A live as a ticket stub. */
export function liveRow(l) {
  const [y, m, d] = l.date.split('-');
  let side = '';
  if (l.date === today()) side = '<span class="badge hot">今日</span>';
  else if (!isPast(l)) side = `<span class="badge">あと${daysUntil(l.date)}日</span>`;
  const artists = l.artistIds.map(artistName).join(' / ');
  const venue = venueName(l.venueId);
  const sub = [l.title?.trim() ? artists : '', venue].filter(Boolean).join(' · ');
  return `<a class="ticket ${isPast(l) ? '' : 'upcoming'}" href="#/live/${l.id}">
    <div class="t-date"><span class="t-y">${y}</span><b>${+m}.${+d}</b><span class="t-w">${weekday(l.date)}</span></div>
    <div class="t-body">
      <div class="t-title">${esc(liveTitle(l))}</div>
      ${sub ? `<div class="t-sub">${esc(sub)}</div>` : ''}
      ${side ? `<div class="t-badge">${side}</div>` : ''}
    </div>
    ${l.photoIds?.[0] ? `<img class="t-thumb" data-photo="${l.photoIds[0]}" alt="">` : ''}
  </a>`;
}

export function barsHtml(items) {
  const max = Math.max(1, ...items.map(i => i.value));
  return items
    .map(
      i => `<div class="bar-row"><span>${esc(i.label)}</span><span class="muted">${esc(i.text)}</span>
      <div class="bar"><i style="width:${(i.value / max) * 100}%"></i></div></div>`,
    )
    .join('');
}

/** [[key, count], ...] sorted by count, largest first. */
export function countBy(list, keyFn) {
  const m = new Map();
  for (const x of list) {
    const k = keyFn(x);
    if (k) m.set(k, (m.get(k) || 0) + 1);
  }
  return [...m].sort((a, b) => b[1] - a[1]);
}

export const backHeader = (fallback, right = '') =>
  `<header class="top"><button class="icon-btn" data-back="${fallback}" aria-label="戻る">‹</button><h1></h1>${right}</header>`;

export const notFound = (what, fallback = '#/') => `${backHeader(fallback)}<div class="empty">${what}が見つかりません</div>`;

export const artistById = id => state.artists.get(id);
