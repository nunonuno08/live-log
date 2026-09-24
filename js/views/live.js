import {
  state, saveLive, deleteLive, artistName, liveTitle, isPast, playCounts, songKey, songArtist, hydratePhotos, photoUrl,
} from '../store.js';
import { esc, fmtDate, yen, toast, safeUrl, shareOrDownload } from '../util.js';
import { KIND_LABEL, starsHtml, avatar } from '../components.js';
import { goBack } from '../nav.js';

export function render(view, id) {
  const l = state.lives.get(id);
  if (!l) {
    view.innerHTML = `<header class="top"><button class="icon-btn" data-back="#/">‹</button><h1></h1></header><div class="empty">ライブが見つかりません</div>`;
    return;
  }
  const counts = playCounts().get(id) || [];
  const multi = l.artistIds.length > 1;
  const past = isPast(l);

  let n = 0;
  const setlist = (l.setlist || [])
    .map((it, i) => {
      if (it.kind !== 'song') return `<li class="marker"><b>${KIND_LABEL[it.kind] || it.kind}</b>${esc(it.title || '')}</li>`;
      if (!it.title?.trim()) return '';
      n++;
      const c = counts[i];
      const badge = !past ? '' : c === 1 ? '<span class="badge new">初</span>' : `<span class="cnt">${c}回目</span>`;
      return `<li><span class="no">${n}</span>
        <a class="t" href="#/song/${encodeURIComponent(songKey(it, l))}">${esc(it.title)}${multi ? `<small>${esc(artistName(songArtist(it, l)))}</small>` : ''}</a>
        ${badge}</li>`;
    })
    .join('');
  const firstTimers = past ? counts.filter(c => c === 1).length : 0;

  const expenses = (l.expenses || []).filter(x => Number(x.amount));
  const total = expenses.reduce((s, x) => s + Number(x.amount), 0);
  const time = [l.openTime && `開場 ${l.openTime}`, l.startTime && `開演 ${l.startTime}`].filter(Boolean).join(' / ');
  const links = [
    ['チケット', safeUrl(l.ticketUrl)],
    ['特設サイト', safeUrl(l.siteUrl)],
  ].filter(([, u]) => u);

  const rows = [
    l.seat && ['座席', esc(l.seat)],
    expenses.length && [
      '支出',
      `${expenses.map(x => `<div class="ex-line"><span>${esc(x.category)}</span><span>${yen(x.amount)}</span></div>`).join('')}
       ${expenses.length > 1 ? `<div class="ex-line total"><span>合計</span><span>${yen(total)}</span></div>` : ''}`,
    ],
    l.companions?.length && ['同行者', esc(l.companions.join('、'))],
    l.guests?.length && ['ゲスト', esc(l.guests.join('、'))],
    links.length && ['リンク', links.map(([t, u]) => `<a class="link" href="${esc(u)}" target="_blank" rel="noopener">${t} ↗</a>`).join(' ')],
  ].filter(Boolean);

  view.innerHTML = `
    <header class="top">
      <button class="icon-btn" data-back="#/">‹</button><h1></h1>
      <button class="txt" data-act="share">共有</button>
      <a class="txt primary" href="#/edit/${id}">編集</a>
    </header>
    ${l.photoIds?.length ? `<div class="hero" data-view="${l.photoIds[0]}"><img data-photo="${l.photoIds[0]}" alt=""></div>` : ''}
    <section class="live-head">
      <div class="muted">${fmtDate(l.date)}${l.date && !past ? ' · 予定' : ''}</div>
      <h1>${esc(liveTitle(l))}</h1>
      <div class="meta">
        ${l.venue ? `<span>📍 ${esc(l.venue)}</span>` : ''}
        ${l.type ? `<span>${esc(l.type)}</span>` : ''}
        ${time ? `<span>${time}</span>` : ''}
      </div>
      <div class="chips" style="margin-top:10px">
        ${l.artistIds.map(aid => `<a class="chip artist-chip" href="#/artist/${aid}">${avatar(state.artists.get(aid), 'xs')}${esc(artistName(aid))}</a>`).join('')}
      </div>
      <div class="rate-row">${starsHtml(l.rating || 0)}<button class="fav-btn ${l.favorite ? 'on' : ''}" data-act="fav" aria-label="お気に入り">♥</button></div>
    </section>

    <section class="card">
      <h2>セットリスト <span class="muted small">${n ? `${n}曲` : ''}${firstTimers ? ` · 初めて聴いた曲 ${firstTimers}` : ''}</span></h2>
      ${setlist ? `<ol class="setlist">${setlist}</ol>` : '<p class="muted small">未登録です。「編集」から追加できます。</p>'}
    </section>

    ${rows.length ? `<section class="card"><dl class="kv">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl></section>` : ''}
    ${l.memo?.trim() ? `<section class="card"><h2>感想・メモ</h2><div class="memo">${esc(l.memo)}</div></section>` : ''}
    ${
      l.photoIds?.length
        ? `<section class="card"><h2>写真</h2><div class="ph-grid">${l.photoIds
            .map(pid => `<div class="ph" data-view="${pid}"><img data-photo="${pid}" alt=""></div>`)
            .join('')}</div></section>`
        : ''
    }
    <div class="btn-row" style="margin:16px 0">
      <button data-act="ics">カレンダーに追加</button>
      <button class="danger" data-act="delete">削除</button>
    </div>`;
  hydratePhotos(view);

  view.addEventListener('click', async e => {
    const rate = e.target.closest('[data-rate]');
    if (rate) {
      const v = Number(rate.dataset.rate);
      l.rating = l.rating === v ? 0 : v;
      await saveLive(l);
      view.querySelector('.stars').outerHTML = starsHtml(l.rating);
      return;
    }
    const photo = e.target.closest('[data-view]');
    if (photo) return openViewer(photo.dataset.view);
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'fav') {
      l.favorite = !l.favorite;
      await saveLive(l);
      e.target.closest('[data-act]').classList.toggle('on', l.favorite);
    } else if (act === 'share') share(l);
    else if (act === 'ics') shareOrDownload(new Blob([ics(l)], { type: 'text/calendar' }), 'live.ics');
    else if (act === 'delete') {
      if (!confirm('このライブの記録を削除しますか？（写真も削除されます）')) return;
      await deleteLive(l.id);
      toast('削除しました');
      goBack('#/');
    }
  });
}

async function openViewer(photoId) {
  const url = await photoUrl(photoId);
  if (!url) return;
  const ov = document.createElement('div');
  ov.className = 'viewer';
  ov.innerHTML = `<img src="${url}" alt="">`;
  ov.addEventListener('click', () => ov.remove());
  document.body.append(ov);
}

function shareText(l) {
  const lines = [`${fmtDate(l.date)} ${liveTitle(l)}`];
  if (l.venue) lines.push(`@${l.venue}`);
  if (l.setlist?.length) {
    lines.push('');
    let n = 0;
    for (const it of l.setlist) {
      if (it.kind === 'song') {
        if (it.title?.trim()) lines.push(`${++n}. ${it.title}`);
      } else lines.push(`- ${KIND_LABEL[it.kind]}${it.title ? ' ' + it.title : ''} -`);
    }
  }
  return lines.join('\n');
}

async function share(l) {
  const text = shareText(l);
  if (navigator.share) {
    navigator.share({ text }).catch(() => {});
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    toast('コピーしました');
  } catch {
    toast('共有できませんでした');
  }
}

const icsEsc = s => String(s).replace(/[\\;,]/g, c => '\\' + c).replace(/\n/g, '\\n');

function ics(l) {
  const d = l.date.replaceAll('-', '');
  const time = l.startTime || l.openTime;
  const pad = n => String(n).padStart(2, '0');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  let when;
  if (time) {
    const [y, m, day] = l.date.split('-').map(Number);
    const [h, min] = time.split(':').map(Number);
    const end = new Date(y, m - 1, day, h + 3, min);
    const endStr = `${end.getFullYear()}${pad(end.getMonth() + 1)}${pad(end.getDate())}T${pad(end.getHours())}${pad(end.getMinutes())}00`;
    when = `DTSTART:${d}T${pad(h)}${pad(min)}00\r\nDTEND:${endStr}`;
  } else {
    const [y, m, day] = l.date.split('-').map(Number);
    const next = new Date(y, m - 1, day + 1);
    when = `DTSTART;VALUE=DATE:${d}\r\nDTEND;VALUE=DATE:${next.getFullYear()}${pad(next.getMonth() + 1)}${pad(next.getDate())}`;
  }
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//livelog//JP', 'BEGIN:VEVENT',
    `UID:${l.id}@livelog`, `DTSTAMP:${stamp}`, when,
    `SUMMARY:${icsEsc(liveTitle(l))}`,
    l.venue ? `LOCATION:${icsEsc(l.venue)}` : '',
    l.openTime ? `DESCRIPTION:${icsEsc(`開場 ${l.openTime}${l.startTime ? ` / 開演 ${l.startTime}` : ''}`)}` : '',
    'END:VEVENT', 'END:VCALENDAR',
  ].filter(Boolean).join('\r\n');
}
