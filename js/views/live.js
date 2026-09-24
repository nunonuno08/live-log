import { state, deleteLive, artistName, liveTitle, isPast, playCounts, venueName, hydratePhotos, photoUrl } from '../store.js';
import { esc, fmtDate, yen, toast } from '../util.js';
import { avatar, songArt, notFound } from '../components.js';
import { goBack } from '../nav.js';

export function render(view, id) {
  const l = state.lives.get(id);
  if (!l) {
    view.innerHTML = notFound('ライブ');
    return;
  }
  const counts = playCounts().get(id) || [];
  const multi = l.artistIds.length > 1;
  const past = isPast(l);
  const main = state.artists.get(l.artistIds[0]);
  const heroPhoto = l.photoIds?.[0] || main?.photoId;

  let n = 0;
  let firstTimers = 0;
  const setlist = (l.setlist || [])
    .map((it, i) => {
      if (it.kind === 'en') return '<li class="encore"><span>ENCORE</span></li>';
      const song = state.songs.get(it.songId);
      if (!song) return '';
      n++;
      const c = counts[i];
      if (past && c === 1) firstTimers++;
      const badge = !past ? '' : c === 1 ? '<span class="badge new">初</span>' : `<span class="cnt">${c}回目</span>`;
      return `<li><span class="no">${n}</span>${songArt(song, 'sm')}
        <a class="t" href="#/song/${song.id}">${esc(song.title)}${multi ? `<small>${esc(artistName(song.artistId))}</small>` : ''}</a>
        ${badge}</li>`;
    })
    .join('');

  const expenses = (l.expenses || []).filter(x => Number(x.amount));
  const total = expenses.reduce((s, x) => s + Number(x.amount), 0);
  const time = [l.openTime && `開場 ${l.openTime}`, l.startTime && `開演 ${l.startTime}`].filter(Boolean).join(' / ');
  const venue = venueName(l.venueId);

  view.innerHTML = `
    <header class="top on-hero">
      <button class="icon-btn" data-back="#/lives" aria-label="戻る">‹</button><h1></h1>
      <button class="icon-btn" data-act="share" aria-label="共有">⤴</button>
      <a class="icon-btn" href="#/edit/${id}" aria-label="編集">✎</a>
    </header>
    <div class="lv-hero ${heroPhoto ? '' : 'plain'}">
      ${heroPhoto ? `<img class="lv-img" data-photo="${heroPhoto}" ${l.photoIds?.[0] ? `data-view="${l.photoIds[0]}"` : ''} alt="">` : ''}
      <div class="lv-fade"></div>
      <div class="lv-head">
        <h1>${esc(liveTitle(l))}</h1>
        <div class="lv-date">${fmtDate(l.date)}${!past ? '<span class="badge">予定</span>' : ''}</div>
        ${venue ? `<a class="lv-line" href="#/venue/${l.venueId}"><span>📍</span>${esc(venue)}</a>` : ''}
        ${l.type ? `<div class="lv-line"><span>🎫</span>${esc(l.type)}</div>` : ''}
        ${time ? `<div class="lv-line times">${l.openTime ? `<span><small>OPEN</small>${l.openTime}</span>` : ''}${l.startTime ? `<span><small>START</small>${l.startTime}</span>` : ''}</div>` : ''}
        <div class="chips">
          ${l.artistIds.map(aid => `<a class="chip artist-chip" href="#/artist/${aid}">${avatar(state.artists.get(aid), 'xs')}${esc(artistName(aid))}</a>`).join('')}
        </div>
      </div>
    </div>

    <section class="card">
      <h2>セットリスト <span class="muted small">${n ? `${n}曲` : ''}${firstTimers ? ` · 初めて聴いた曲 ${firstTimers}` : ''}</span></h2>
      ${setlist ? `<ol class="setlist">${setlist}</ol>` : '<p class="muted small">未登録です。右上の ✎ から追加できます。</p>'}
    </section>

    ${
      l.seat || expenses.length
        ? `<section class="card"><dl class="kv">
            ${l.seat ? `<dt>座席</dt><dd>${esc(l.seat)}</dd>` : ''}
            ${
              expenses.length
                ? `<dt>支出</dt><dd>${expenses.map(x => `<div class="ex-line"><span>${esc(x.category)}</span><span>${yen(x.amount)}</span></div>`).join('')}
                   ${expenses.length > 1 ? `<div class="ex-line total"><span>合計</span><span>${yen(total)}</span></div>` : ''}</dd>`
                : ''
            }
          </dl></section>`
        : ''
    }
    ${l.memo?.trim() ? `<section class="card"><h2>感想・メモ</h2><div class="memo">${esc(l.memo)}</div></section>` : ''}
    ${
      l.photoIds?.length > 1
        ? `<section class="card"><h2>写真</h2><div class="ph-grid">${l.photoIds
            .map(pid => `<div class="ph" data-view="${pid}"><img data-photo="${pid}" alt=""></div>`)
            .join('')}</div></section>`
        : ''
    }
    <button class="wide txt danger" data-act="delete">この記録を削除</button>`;
  hydratePhotos(view);

  view.addEventListener('click', async e => {
    const photo = e.target.closest('[data-view]');
    if (photo) return openViewer(photo.dataset.view);
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'share') share(l);
    else if (act === 'delete') {
      if (!confirm('このライブの記録を削除しますか？（写真も削除されます）')) return;
      await deleteLive(l.id);
      toast('削除しました');
      goBack('#/lives');
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
  const venue = venueName(l.venueId);
  if (venue) lines.push(`@${venue}`);
  if (l.setlist?.length) {
    lines.push('');
    let n = 0;
    for (const it of l.setlist) {
      if (it.kind === 'en') lines.push('- ENCORE -');
      else if (state.songs.has(it.songId)) lines.push(`${++n}. ${state.songs.get(it.songId).title}`);
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
