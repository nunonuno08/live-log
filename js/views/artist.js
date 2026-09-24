import { state, livesOfArtist, isPast, songTable, saveArtist, deleteArtist, mergeArtist, findArtist, hydratePhotos } from '../store.js';
import { esc, fmtDate, toast, compressImage } from '../util.js';
import { avatar, liveRow, songArt, notFound } from '../components.js';
import { photoCandidates, setArtistPhoto, setArtistPhotoFromUrl, catalogFor } from '../music.js';
import { openSheet, pickArtist } from '../ui.js';
import { goBack, nav, replace } from '../nav.js';

export function render(view, id) {
  const a = state.artists.get(id);
  if (!a) {
    view.innerHTML = notFound('アーティスト');
    return;
  }
  const lives = livesOfArtist(id);
  const past = lives.filter(isPast);
  const upcoming = lives.filter(l => !isPast(l));
  const years = [...new Set(past.map(l => l.date.slice(0, 4)))].sort().reverse();
  const songs = songTable(past).filter(r => r.song.artistId === id);
  let filter = 'all';

  view.innerHTML = `
    <header class="top"><button class="icon-btn" data-back="#/" aria-label="戻る">‹</button><h1></h1>
      <button class="icon-btn" data-act="menu" aria-label="メニュー">⋯</button></header>
    <section class="artist-head">
      <button type="button" class="avatar-btn" data-act="photo" aria-label="写真を変更">${avatar(a, 'xl')}</button>
      <h2>${esc(a.name)}</h2>
      <div class="stat-line">
        <span><b>${past.length}</b>回</span>
        <span><b>${songs.length}</b>曲</span>
        ${past.length ? `<span>初参戦 <b>${fmtDate(past[0].date, false)}</b></span>` : ''}
      </div>
      <a class="btn primary big" href="#/new?artist=${id}">＋ ライブを記録</a>
    </section>
    ${
      lives.length
        ? `<div class="chips filter">
            <button class="chip on" data-filter="all">すべて ${lives.length}</button>
            ${upcoming.length ? `<button class="chip" data-filter="upcoming">予定 ${upcoming.length}</button>` : ''}
            ${years.map(y => `<button class="chip" data-filter="${y}">${y}</button>`).join('')}
          </div>`
        : ''
    }
    <div id="lives"></div>
    ${
      songs.length
        ? `<section class="card"><h2>よく聴いた曲</h2>${songs
            .slice(0, 10)
            .map(
              (r, i) => `<a class="rank-row" href="#/song/${r.song.id}">
                <span class="rk r${i + 1}">${i + 1}</span>${songArt(r.song, 'sm')}
                <div class="rk-body"><div class="t">${esc(r.song.title)}</div></div>
                <span class="rk-val">${r.count}回</span></a>`,
            )
            .join('')}
            ${songs.length > 10 ? `<a class="more" href="#/stats?tab=songs&artist=${id}">すべての曲を見る →</a>` : ''}
          </section>`
        : ''
    }`;

  const listEl = view.querySelector('#lives');
  const draw = () => {
    const shown = lives
      .filter(l => (filter === 'all' ? true : filter === 'upcoming' ? !isPast(l) : isPast(l) && l.date.startsWith(filter)))
      .reverse();
    listEl.innerHTML = shown.length ? shown.map(liveRow).join('') : lives.length ? '<div class="empty">該当するライブはありません</div>' : '';
  };
  draw();
  hydratePhotos(view);
  // Warm the song list so the setlist editor has suggestions right away.
  catalogFor(id).catch(() => {});

  view.addEventListener('click', async e => {
    const f = e.target.closest('[data-filter]');
    if (f) {
      filter = f.dataset.filter;
      view.querySelectorAll('[data-filter]').forEach(b => b.classList.toggle('on', b === f));
      draw();
      return;
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'photo') changePhoto(a);
    if (act === 'menu') menu(a, lives.length);
  });
}

async function menu(a, liveCount) {
  const choice = await openSheet({
    title: a.name,
    html: `<div class="menu">
      <button type="button" data-v="photo">写真を変更</button>
      <button type="button" data-v="rename">名前を変更</button>
      <button type="button" data-v="merge">別のアーティストとまとめる</button>
      ${liveCount ? '' : '<button type="button" class="danger" data-v="delete">削除</button>'}
    </div>`,
    onMount: (sheet, close) => sheet.addEventListener('click', e => e.target.dataset.v && close(e.target.dataset.v)),
  });
  if (choice === 'photo') changePhoto(a);
  if (choice === 'rename') rename(a);
  if (choice === 'merge') {
    const to = await pickArtist({ title: 'まとめる先のアーティスト', exclude: [a.id] });
    if (!to || !confirm(`「${a.name}」を「${state.artists.get(to).name}」にまとめます。よろしいですか？`)) return;
    await mergeArtist(a.id, to);
    toast('まとめました');
    replace(`#/artist/${to}`);
  }
  if (choice === 'delete' && confirm(`「${a.name}」を削除しますか？`)) {
    await deleteArtist(a.id);
    goBack('#/');
  }
}

async function rename(a) {
  const name = prompt('アーティスト名', a.name)?.trim();
  if (!name || name === a.name) return;
  const other = findArtist(name);
  if (other && other.id !== a.id) {
    if (!confirm(`「${other.name}」はすでに登録されています。2つを1つにまとめますか？`)) return;
    await mergeArtist(a.id, other.id);
    replace(`#/artist/${other.id}`);
    return;
  }
  await saveArtist({ ...a, name });
  nav.rerender();
}

function changePhoto(a) {
  openSheet({
    title: '写真を変更',
    tall: true,
    html: `<label class="btn wide">カメラロールから選ぶ<input type="file" accept="image/*" hidden></label>
      <p class="muted small" id="cand-status">候補を探しています…</p>
      <div class="cand-grid"></div>`,
    async onMount(sheet, close) {
      sheet.querySelector('input[type=file]').addEventListener('change', async e => {
        const file = e.target.files[0];
        if (!file) return;
        await setArtistPhoto(a.id, await compressImage(file, 800));
        close();
        nav.rerender();
      });
      sheet.querySelector('.cand-grid').addEventListener('click', async e => {
        const img = e.target.closest('[data-url]');
        if (!img) return;
        try {
          await setArtistPhotoFromUrl(a.id, img.dataset.url);
          close();
          nav.rerender();
        } catch (err) {
          toast(err.message);
        }
      });
      if (!navigator.onLine) {
        sheet.querySelector('#cand-status').textContent = 'オフラインのため候補を表示できません';
        return;
      }
      const { photos, albums } = await photoCandidates(a);
      const urls = [...photos.map(p => p.url), ...albums];
      sheet.querySelector('#cand-status').textContent = urls.length ? 'タップして選ぶ（アーティスト写真 → ジャケット写真）' : '候補が見つかりませんでした';
      sheet.querySelector('.cand-grid').innerHTML = urls
        .map(u => `<button type="button" class="cand" data-url="${esc(u)}"><img src="${esc(u)}" crossorigin="anonymous" alt=""></button>`)
        .join('');
    },
  });
}
