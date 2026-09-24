import { esc, hue, weekday, daysUntil, today } from './util.js';
import { artistName, liveTitle, isPast } from './store.js';

export const TYPES = ['ワンマン', '対バン', 'フェス', 'イベント', '配信', 'その他'];
export const KIND_LABEL = { mc: 'MC', en: 'EN', se: 'SE', vcr: 'VCR' };
export const EXPENSE_CATS = ['チケット', 'グッズ', '交通費', '宿泊費', '飲食', 'その他'];

export function avatar(artist, cls = '') {
  if (artist?.photoId) return `<div class="avatar ${cls}"><img data-photo="${artist.photoId}" alt=""></div>`;
  const name = artist?.name?.trim() || '?';
  return `<div class="avatar ${cls}" style="background:hsl(${hue(name)} 40% 30%)"><span>${esc([...name][0])}</span></div>`;
}

export function liveRow(l) {
  const [y, m, d] = l.date.split('-');
  let side = '';
  if (l.date === today()) side = '<span class="badge">今日</span>';
  else if (!isPast(l)) side = `<span class="badge">あと${daysUntil(l.date)}日</span>`;
  else if (l.rating) side = `<span class="lr-rate">★${l.rating}</span>`;
  const artists = l.artistIds.map(artistName).join(' / ');
  const sub = [l.title?.trim() ? artists : '', l.venue].filter(Boolean).join(' · ');
  return `<a class="live-row" href="#/live/${l.id}">
    <div class="lr-date"><span class="lr-md">${+m}/${+d}</span><span class="lr-sub">${y} ${weekday(l.date)}</span></div>
    <div class="lr-body">
      <div class="lr-title">${l.favorite ? '<span class="fav">♥</span>' : ''}${esc(liveTitle(l))}</div>
      ${sub ? `<div class="lr-sub">${esc(sub)}</div>` : ''}
    </div>
    ${side}
  </a>`;
}

export function starsHtml(n) {
  return `<div class="stars">${[1, 2, 3, 4, 5]
    .map(i => `<button type="button" data-rate="${i}" class="${i <= n ? 'on' : ''}" aria-label="${i}">★</button>`)
    .join('')}</div>`;
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
