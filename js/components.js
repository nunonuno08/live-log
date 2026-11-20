import { esc, hue, weekday, daysUntil, today } from './util.js';
import { state, artistName, liveTitle, isPast, venueName } from './store.js';

export const SPOTIFY_ICON =
  '<svg class="sp-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="12" fill="#1ed760"/><path d="M6.2 9.3c3.9-1.2 8.3-.8 11.6 1.1M7 12.4c3.2-.9 6.7-.6 9.5 1M7.8 15.3c2.5-.7 5.1-.4 7.3.8" fill="none" stroke="#000" stroke-width="1.6" stroke-linecap="round"/></svg>';

export const TYPES =['ワンマン', '対バン', 'フェス', 'イベント', '配信'];
export const EXPENSE_CATS = ['チケット', 'グッズ', 'ドリンク', '交通費', '宿泊費', 'その他'];

export function avatar(artist, cls = '') {
  if (artist?.photoId) return `<div class="avatar ${cls}"><img data-photo="${artist.photoId}" alt=""></div>`;
  const name = artist?.name?.trim() || '?';
  return `<div class="avatar ${cls}" style="--h:${hue(name)}"><span>${esc([...name][0])}</span></div>`;
}

export function songArt(song, cls = '') {
  return song?.artwork
    ? `<img class="art ${cls}" src="${esc(song.artwork)}" crossorigin="anonymous" loading="lazy" alt="" onerror="this.removeAttribute('src')">`
    : `<span class="art ${cls} none">♪</span>`;
}

/**
 * Each artist's own colour, the same on every screen and device (derived from the id, so
 * renaming keeps it). 12 hues spaced apart so neighbours stay distinguishable.
 */
export const artistColor = id => `hsl(${(hue(id) % 12) * 30 + 8} 68% 56%)`;

/** Vertical colour strip for a live: one band per artist (up to 4). */
export function artistStripe(l) {
  const ids = l.artistIds.slice(0, 4);
  if (!ids.length) return 'var(--line)';
  const step = 100 / ids.length;
  return `linear-gradient(${ids.map((id, i) => `${artistColor(id)} ${i * step}% ${(i + 1) * step}%`).join(', ')})`;
}

const PIN_ICON =
  '<svg class="t-pin" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="10" r="2.3" fill="currentColor"/></svg>';

// A fes can have dozens of acts; the card names the first few and counts the rest.
const CARD_ARTISTS = 3;

/** Artist names, each led by a small round photo. */
function artistLine(ids, cls) {
  const shown = ids.slice(0, CARD_ARTISTS);
  const more = ids.length - shown.length;
  return `<div class="t-artists ${cls}">${shown
    .map(id => `<span class="t-ar">${avatar(state.artists.get(id), 'xxs')}<span>${esc(artistName(id))}</span></span>`)
    .join('')}${more > 0 ? `<span class="t-more">ほか${more}組</span>` : ''}</div>`;
}

/** A live as a ticket stub: title, then artists, then venue, each on its own line. */
export function liveRow(l) {
  const [y, m, d] = l.date.split('-');
  let side = '';
  if (l.date === today()) side = '<span class="badge hot">今日</span>';
  else if (!isPast(l)) side = `<span class="badge">あと${daysUntil(l.date)}日</span>`;
  const venue = venueName(l.venueId);
  const titled = !!l.title?.trim();
  const color = l.artistIds[0] ? artistColor(l.artistIds[0]) : 'var(--muted)';
  // Without a tour name the artists themselves are the title, so they aren't repeated below.
  const head =
    titled || !l.artistIds.length
      ? `<div class="t-title">${esc(liveTitle(l))}</div>${titled && l.artistIds.length ? artistLine(l.artistIds, '') : ''}`
      : artistLine(l.artistIds, 'as-title');
  return `<a class="ticket ${isPast(l) ? '' : 'upcoming'}" href="#/live/${l.id}" style="--ac:${color};--stripe:${artistStripe(l)}">
    <div class="t-date"><span class="t-y">${y}</span><b>${+m}.${+d}</b><span class="t-w">${weekday(l.date)}</span></div>
    <div class="t-body">
      ${head}
      ${venue ? `<div class="t-venue">${PIN_ICON}<span>${esc(venue)}</span></div>` : ''}
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
