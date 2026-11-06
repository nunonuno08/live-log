import { state, deleteLive, artistName, liveTitle, isPast, playCounts, venueName, hydratePhotos, photoUrl } from '../store.js';
import { esc, fmtDate, yen, toast, shareOrDownload } from '../util.js';
import { avatar, songArt, notFound, SPOTIFY_ICON } from '../components.js';
import { spotifySearchUrl, spotifyAvailable, spotifyConnected, connectSpotify, findSetlistTracks, createPlaylist } from '../spotify.js';
import { liveCard } from '../share.js';
import { openSheet } from '../ui.js';
import { goBack } from '../nav.js';

export function render(view, id, params = new URLSearchParams()) {
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

  // With several artists (対バン・フェス), each artist's part gets a heading and its own numbering.
  let n = 0;
  const perArtist = new Map(); // each artist keeps counting after an encore
  let songTotal = 0;
  let firstTimers = 0;
  let current = null;
  const setlist = (l.setlist || [])
    .map((it, i) => {
      if (it.kind === 'en') return '<li class="encore"><span>ENCORE</span></li>';
      const song = state.songs.get(it.songId);
      if (!song) return '';
      let head = '';
      if (multi && song.artistId !== current) {
        current = song.artistId;
        n = perArtist.get(current) || 0;
        head = `<li class="sl-group"><a href="#/artist/${song.artistId}">${avatar(state.artists.get(song.artistId), 'sm')}<b>${esc(artistName(song.artistId))}</b></a></li>`;
      }
      n++;
      perArtist.set(current, n);
      songTotal++;
      const c = counts[i];
      if (past && c === 1) firstTimers++;
      const badge = !past ? '' : c === 1 ? '<span class="badge new">初</span>' : `<span class="cnt">${c}回目</span>`;
      return `${head}<li><span class="no">${n}</span>${songArt(song, 'sm')}
        <a class="t" href="#/song/${song.id}">${esc(song.title)}</a>
        ${badge}
        <a class="sp-link" href="${esc(spotifySearchUrl(song.title, artistName(song.artistId)))}" target="_blank" rel="noopener" aria-label="Spotifyで開く">${SPOTIFY_ICON}</a></li>`;
    })
    .join('');

  const expenses = (l.expenses || []).filter(x => Number(x.amount));
  const total = expenses.reduce((s, x) => s + Number(x.amount), 0);
  const time = [l.openTime && `開場 ${l.openTime}`, l.startTime && `開演 ${l.startTime}`].filter(Boolean).join(' / ');
  const venue = venueName(l.venueId);

  view.innerHTML = `
    <header class="top on-hero">
      <button class="icon-btn" data-back="#/lives" aria-label="戻る">‹</button><h1></h1>
      <a class="icon-btn" href="#/new?from=${id}" aria-label="このライブを複製">⧉</a>
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
      <h2>セットリスト <span class="muted small">${songTotal ? `${songTotal}曲` : ''}${firstTimers ? ` · 初めて聴いた曲 ${firstTimers}` : ''}</span></h2>
      ${setlist ? `<ol class="setlist">${setlist}</ol>` : '<p class="muted small">未登録です。右上の ✎ から追加できます。</p>'}
      ${songTotal && spotifyAvailable() ? `<button class="wide spotify-btn" data-act="playlist">${SPOTIFY_ICON}Spotify でプレイリストを作る</button>` : ''}
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
    if (act === 'share') shareSheet(l);
    else if (act === 'playlist') playlist(l);
    else if (act === 'delete') {
      if (!confirm('このライブの記録を削除しますか？（写真も削除されます）')) return;
      await deleteLive(l.id);
      toast('削除しました');
      goBack('#/lives');
    }
  });

  // Back from Spotify's login page: carry on with the playlist.
  if (params.get('spotify') === '1' && spotifyConnected()) {
    history.replaceState(null, '', `#/live/${id}`); // no re-render, so the progress sheet stays
    playlist(l);
  }
}

async function playlist(l) {
  if (!spotifyConnected()) {
    if (!confirm('Spotify にログインして、このセトリのプレイリストを作ります。よろしいですか？')) return;
    return connectSpotify(`#/live/${l.id}?spotify=1`);
  }
  let setStatus = () => {};
  let closeProgress = () => {};
  const progress = msg =>
    openSheet({
      title: 'Spotify',
      html: `<p class="center" id="sp-status">${esc(msg)}</p>`,
      onMount(sheet, close) {
        setStatus = text => (sheet.querySelector('#sp-status').textContent = text);
        closeProgress = close;
      },
    });
  progress('準備中…');
  try {
    const rows = await findSetlistTracks(l, msg => setStatus(msg));
    closeProgress();
    // Nothing is created until the user has checked what Spotify found.
    const uris = await confirmTracks(rows);
    if (!uris) return;
    progress('プレイリストを作成中…');
    const url = await createPlaylist(l, uris);
    closeProgress();
    const left = rows.filter(r => !r.on || r.pick < 0).map(r => r.song.title);
    await openSheet({
      title: 'プレイリストを作成しました',
      html: `<p>Spotify の「ライブラリ」に非公開のプレイリストとして追加しました。</p>
        ${left.length ? `<p class="hint">入れなかった曲: ${left.map(esc).join('、')}</p>` : ''}
        <a class="btn wide spotify-btn" href="${esc(url || 'https://open.spotify.com/')}" target="_blank" rel="noopener">${SPOTIFY_ICON}Spotify で開く</a>`,
    });
  } catch (err) {
    closeProgress();
    toast(err.message);
  }
}

/** Shows each setlist song next to what Spotify found. Resolves the track URIs to use, or nothing if closed. */
function confirmTracks(rows) {
  const chosen = r => (r.on && r.pick >= 0 ? r.candidates[r.pick] : null);
  const trackHtml = c =>
    `${c.image ? `<img class="sp-art" src="${esc(c.image)}" alt="" loading="lazy">` : '<span class="sp-art none">♪</span>'}
    <span class="sp-track"><b>${esc(c.name)}</b><small>${esc(c.artists)}${c.album ? ` · ${esc(c.album)}` : ''}</small></span>`;
  const rowHtml = (r, i) => {
    const c = r.candidates[r.pick];
    const others = r.candidates.length - 1;
    return `<div class="sp-row" data-row="${i}">
      <input type="checkbox" data-on="${i}" ${r.on ? 'checked' : ''} ${c ? '' : 'disabled'} aria-label="${esc(r.song.title)}をプレイリストに入れる">
      <div class="sp-main">
        <div class="sp-want"><span>${i + 1}</span>${esc(r.song.title)}</div>
        ${c ? `<div class="sp-got">${trackHtml(c)}</div>` : ''}
        ${c && !c.ok ? '<small class="warn">アーティスト名か曲名が違います。合っているか確かめてください</small>' : ''}
        ${c ? '' : '<small class="warn">Spotify で見つかりませんでした（入りません）</small>'}
        ${others > 0 ? `<button type="button" class="txt small sp-more" data-more="${i}">ほかの候補（${others}）</button>
          <div class="sp-alts" hidden>${r.candidates
            .map((a, j) => (j === r.pick ? '' : `<button type="button" class="sp-alt" data-alt="${i}:${j}">${trackHtml(a)}</button>`))
            .join('')}</div>` : ''}
      </div>
    </div>`;
  };
  const okLabel = () => `${rows.filter(chosen).length}曲でプレイリストを作る`;
  return openSheet({
    title: 'Spotify の検索結果',
    tall: true,
    html: `<p class="hint">上がセトリの曲名、その下が Spotify で見つかった曲です。違う曲はチェックを外すか、「ほかの候補」から選び直してください。</p>
      <div class="sp-list">${rows.map(rowHtml).join('')}</div>
      <button type="button" class="wide spotify-btn" data-ok>${SPOTIFY_ICON}<span>${okLabel()}</span></button>`,
    onMount(sheet, close) {
      const ok = sheet.querySelector('[data-ok]');
      const refresh = () => {
        ok.querySelector('span').textContent = okLabel();
        ok.disabled = !rows.some(chosen);
      };
      refresh();
      sheet.addEventListener('change', e => {
        if (e.target.dataset.on == null) return;
        rows[Number(e.target.dataset.on)].on = e.target.checked;
        refresh();
      });
      sheet.addEventListener('click', e => {
        const more = e.target.closest('[data-more]');
        if (more) {
          const alts = more.nextElementSibling;
          alts.hidden = !alts.hidden;
          return;
        }
        // Choosing another candidate means the user checked it, so it is ticked.
        const alt = e.target.closest('[data-alt]');
        if (alt) {
          const [i, j] = alt.dataset.alt.split(':').map(Number);
          Object.assign(rows[i], { pick: j, on: true });
          sheet.querySelector(`[data-row="${i}"]`).outerHTML = rowHtml(rows[i], i);
          refresh();
          return;
        }
        if (e.target.closest('[data-ok]')) close(rows.map(chosen).filter(Boolean).map(c => c.uri));
      });
    },
  });
}

async function shareSheet(l) {
  let url = '';
  let blob = null;
  await openSheet({
    title: '共有',
    tall: true,
    html: `<div class="card-preview"><p class="muted small center">画像を作成中…</p></div>
      <div class="btn-row"><button type="button" data-text>テキストで共有</button><button type="button" class="primary" data-image disabled>画像を保存・共有</button></div>`,
    async onMount(sheet) {
      blob = await liveCard(l);
      url = URL.createObjectURL(blob);
      sheet.querySelector('.card-preview').innerHTML = `<img src="${url}" alt="セトリ画像">`;
      sheet.querySelector('[data-image]').disabled = false;
      sheet.querySelector('[data-image]').addEventListener('click', () => shareOrDownload(blob, `setlist-${l.date}.png`));
      sheet.querySelector('[data-text]').addEventListener('click', () => share(l));
    },
  });
  if (url) URL.revokeObjectURL(url);
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
