import {
  state, livesOfArtist, isPast, songTable, saveArtist, deleteArtist, mergeArtist,
  findArtistByName, savePhoto, deletePhoto, hydratePhotos,
} from '../store.js';
import { esc, fmtDate, toast, compressImage } from '../util.js';
import { avatar, liveRow } from '../components.js';
import { goBack, nav, replace } from '../nav.js';

export function render(view, id) {
  const a = state.artists.get(id);
  if (!a) {
    view.innerHTML = `<header class="top"><button class="icon-btn" data-back="#/">‹</button><h1></h1></header><div class="empty">アーティストが見つかりません</div>`;
    return;
  }
  const lives = livesOfArtist(id);
  const past = lives.filter(isPast);
  const upcoming = lives.filter(l => !isPast(l));
  const years = [...new Set(past.map(l => l.date.slice(0, 4)))].sort().reverse();
  const topSongs = songTable(past).filter(s => s.artistId === id);
  let filter = 'all';

  view.innerHTML = `
    <header class="top"><button class="icon-btn" data-back="#/">‹</button><h1></h1></header>
    <section class="artist-head">
      <label class="avatar-edit">${avatar(a, 'xl')}<span class="small muted">写真を変更</span><input type="file" accept="image/*" hidden data-photo-input></label>
      <h2>${esc(a.name)}</h2>
      <div class="muted">参戦 ${past.length}回${upcoming.length ? ` · 予定 ${upcoming.length}件` : ''}${topSongs.length ? ` · ${topSongs.length}曲` : ''}</div>
      ${past.length ? `<div class="muted small">初参戦 ${fmtDate(past[0].date, false)} · 前回 ${fmtDate(past.at(-1).date, false)}</div>` : ''}
      <div class="btn-row narrow">
        <button data-act="rename">名前を変更</button>
        ${lives.length ? '' : '<button class="danger" data-act="delete">削除</button>'}
      </div>
    </section>
    <div class="chips filter">
      <button class="chip on" data-filter="all">すべて ${lives.length}</button>
      ${upcoming.length ? `<button class="chip" data-filter="upcoming">予定 ${upcoming.length}</button>` : ''}
      ${years.map(y => `<button class="chip" data-filter="${y}">${y}</button>`).join('')}
      <button class="chip" data-filter="fav">♥</button>
    </div>
    <div id="lives"></div>
    ${
      topSongs.length
        ? `<section class="card"><h2>よく聴いた曲</h2>${topSongs
            .slice(0, 10)
            .map(
              (s, i) => `<a class="rank-row" href="#/song/${encodeURIComponent(s.key)}">
                <span class="rk">${i + 1}</span><div class="rk-body"><div class="t">${esc(s.title)}</div></div>
                <span class="rk-val">${s.count}回</span></a>`,
            )
            .join('')}
            ${topSongs.length > 10 ? `<a class="more" href="#/stats?tab=songs&artist=${id}">すべての曲を見る →</a>` : ''}
          </section>`
        : ''
    }`;

  const listEl = view.querySelector('#lives');
  const draw = () => {
    const shown = lives
      .filter(l =>
        filter === 'all' ? true : filter === 'upcoming' ? !isPast(l) : filter === 'fav' ? l.favorite : isPast(l) && l.date.startsWith(filter),
      )
      .reverse();
    listEl.innerHTML = shown.length ? shown.map(liveRow).join('') : '<div class="empty">該当するライブはありません</div>';
  };
  draw();
  hydratePhotos(view);

  view.addEventListener('click', async e => {
    const f = e.target.closest('[data-filter]');
    if (f) {
      filter = f.dataset.filter;
      view.querySelectorAll('[data-filter]').forEach(b => b.classList.toggle('on', b === f));
      draw();
      return;
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'rename') await rename(a);
    if (act === 'delete' && confirm(`「${a.name}」を削除しますか？`)) {
      await deleteArtist(a.id);
      goBack('#/');
    }
  });

  view.addEventListener('change', async e => {
    if (!e.target.matches('[data-photo-input]') || !e.target.files[0]) return;
    try {
      const blob = await compressImage(e.target.files[0], 800);
      const old = a.photoId;
      a.photoId = await savePhoto(blob);
      await saveArtist(a);
      if (old) await deletePhoto(old);
      nav.rerender();
    } catch (err) {
      toast(err.message);
    }
  });
}

async function rename(a) {
  const name = prompt('アーティスト名', a.name)?.trim();
  if (!name || name === a.name) return;
  const other = findArtistByName(name);
  if (other && other.id !== a.id) {
    if (!confirm(`「${other.name}」はすでに登録されています。2つを1つにまとめますか？`)) return;
    await mergeArtist(a.id, other.id);
    replace(`#/artist/${other.id}`);
    return;
  }
  a.name = name;
  await saveArtist(a);
  nav.rerender();
}
