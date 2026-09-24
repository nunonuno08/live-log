// Bottom sheets and input helpers shared by the screens.
import { esc, debounce, matchKey, matchScore, toast } from './util.js';
import { state, ensureArtist, findArtist, allLives, hydratePhotos } from './store.js';
import { searchArtists, artistPictures, autoArtistPhoto, catalogFor } from './music.js';
import { avatar } from './components.js';

/* ---------- bottom sheet ---------- */

/** Opens a sheet; resolves with the value passed to `close(value)` (null when dismissed). */
export function openSheet({ title, html, onMount, tall = false }) {
  return new Promise(resolve => {
    const ov = document.createElement('div');
    ov.className = 'sheet-backdrop';
    ov.innerHTML = `<div class="sheet ${tall ? 'tall' : ''}" role="dialog" aria-label="${esc(title)}">
      <div class="sheet-head"><h2>${esc(title)}</h2><button type="button" class="txt" data-close>閉じる</button></div>
      <div class="sheet-body">${html}</div>
    </div>`;
    let done = false;
    const close = value => {
      if (done) return;
      done = true;
      ov.remove();
      if (!document.querySelector('.sheet-backdrop')) document.body.classList.remove('modal-open');
      resolve(value ?? null);
    };
    ov.addEventListener('click', e => {
      if (e.target === ov || e.target.closest('[data-close]')) close(null);
    });
    ov.close = close;
    document.body.append(ov);
    document.body.classList.add('modal-open');
    onMount?.(ov.querySelector('.sheet'), close);
  });
}

export const closeAllSheets = () => document.querySelectorAll('.sheet-backdrop').forEach(s => s.close?.(null));

/* ---------- suggestions under an input ---------- */

/**
 * Shows `fetch(query)` results under `input` in `box`. Tapping one calls onPick(item).
 * Taps don't blur the input, so the keyboard stays up for the next entry.
 */
export function suggest(input, box, { fetch, render, onPick, delay = 0 }) {
  let items = [];
  let seq = 0;
  const run = async () => {
    const my = ++seq;
    const res = await fetch(input.value.trim());
    if (my !== seq) return;
    items = res;
    box.innerHTML = res.map((it, i) => `<button type="button" class="sg-item" data-sg="${i}">${render(it)}</button>`).join('');
  };
  const trigger = delay ? debounce(run, delay) : run;
  input.addEventListener('input', trigger);
  box.addEventListener('pointerdown', e => e.target.closest('[data-sg]') && e.preventDefault());
  box.addEventListener('click', e => {
    const b = e.target.closest('[data-sg]');
    if (b) onPick(items[Number(b.dataset.sg)]);
  });
  return {
    refresh: run,
    clear() {
      seq++;
      items = [];
      box.innerHTML = '';
    },
    get items() {
      return items;
    },
  };
}

/* ---------- artist picker ---------- */

function artistStats() {
  const s = new Map();
  for (const l of allLives()) for (const id of l.artistIds) s.set(id, { count: (s.get(id)?.count || 0) + 1, last: l.date });
  return s;
}

/**
 * Lets the user choose a registered artist or register a new one from iTunes candidates.
 * Resolves with the artist id (new artists get a photo and song list fetched in the background).
 */
export function pickArtist({ title = 'アーティストを選ぶ', exclude = [], registeredFirst = true } = {}) {
  const stats = artistStats();
  const registered = [...state.artists.values()]
    .filter(a => !exclude.includes(a.id))
    .sort((a, b) => (stats.get(b.id)?.last || '').localeCompare(stats.get(a.id)?.last || '') || a.name.localeCompare(b.name, 'ja'));

  return openSheet({
    title,
    tall: true,
    html: `<input type="search" class="sheet-search" placeholder="アーティスト名で検索" autocomplete="off" enterkeyhint="search">
      <div class="pick-list"></div>`,
    onMount(sheet, close) {
      const input = sheet.querySelector('input');
      const list = sheet.querySelector('.pick-list');
      let remote = [];
      let pictures = new Map();
      let seq = 0;

      const pic = url => `<div class="avatar sm"><img src="${esc(url)}" crossorigin="anonymous" alt=""></div>`;
      const row = (a, sub, attrs, picture) =>
        `<button type="button" class="pick-row" ${attrs}>${picture ? pic(picture) : avatar(a, 'sm')}<span class="pick-name">${esc(a.name)}<small>${esc(sub)}</small></span></button>`;

      const draw = () => {
        const q = matchKey(input.value);
        const local = q
          ? registered.map(a => ({ a, s: matchScore(q, matchKey(a.name)) })).filter(x => x.s).sort((x, y) => y.s - x.s).map(x => x.a)
          : registeredFirst ? registered : [];
        const localIds = new Set([...state.artists.values()].map(a => a.itunesId).filter(Boolean));
        const fresh = remote.filter(r => !localIds.has(r.itunesId));
        let html = '';
        if (local.length) {
          html += `<h3 class="sec">登録済み</h3>` + local.map(a => row(a, stats.get(a.id) ? `${stats.get(a.id).count}回` : '', `data-id="${a.id}"`)).join('');
        }
        if (fresh.length) {
          html += `<h3 class="sec">新しく登録</h3>` + fresh.map((r, i) => row({ name: r.name }, r.genre, `data-remote="${i}"`, pictures.get(r.itunesId)?.thumb)).join('');
        }
        if (input.value.trim() && !findArtist(input.value.trim()) && !fresh.some(r => matchKey(r.name) === q)) {
          html += `<button type="button" class="pick-row plain" data-manual>＋「${esc(input.value.trim())}」を手入力で登録</button>`;
        }
        if (!html) html = `<p class="empty small">${q ? '検索中…' : 'アーティスト名を入力すると、候補が表示されます'}</p>`;
        list.innerHTML = html;
        hydratePhotos(list);
        list._fresh = fresh;
      };

      const searchRemote = debounce(async () => {
        const q = input.value.trim();
        const my = ++seq;
        if (!q) {
          remote = [];
          return draw();
        }
        try {
          const res = await searchArtists(q);
          if (my === seq) remote = res;
        } catch {
          if (my === seq) remote = [];
        }
        if (my !== seq) return;
        draw();
        // Names first, pictures as soon as they arrive.
        const got = await artistPictures(remote).catch(() => new Map());
        if (my !== seq) return;
        pictures = new Map([...pictures, ...got]);
        draw();
      }, 300);

      input.addEventListener('input', () => {
        draw();
        searchRemote();
      });

      list.addEventListener('click', async e => {
        const b = e.target.closest('button');
        if (!b) return;
        let id;
        let chosenPicture;
        if (b.dataset.id) id = b.dataset.id;
        else if (b.dataset.remote) {
          const r = list._fresh[Number(b.dataset.remote)];
          id = await ensureArtist(r.name, { itunesId: r.itunesId });
          chosenPicture = pictures.get(r.itunesId)?.big;
        } else if (b.dataset.manual != null) id = await ensureArtist(input.value.trim());
        if (!id) return;
        if (!b.dataset.id) {
          // Photo (the one shown in the list) and song list arrive in the background.
          autoArtistPhoto(id, chosenPicture).catch(() => {});
          catalogFor(id).catch(() => {});
          toast(`「${state.artists.get(id).name}」を登録しました`);
        }
        close(id);
      });

      draw();
      setTimeout(() => input.focus(), 50);
    },
  });
}

/* ---------- crop ---------- */

const MAX_OCR_SIDE = 2400;

/**
 * Shows the photo with a draggable frame; resolves with a canvas of the framed part
 * (or null when dismissed). Drag the corners to resize, the inside to move.
 */
export function cropImage(file) {
  const url = URL.createObjectURL(file);
  return openSheet({
    title: '読み取る範囲を選ぶ',
    tall: true,
    html: `<p class="hint">四隅をドラッグして、曲名の部分だけを囲むと精度が上がります。</p>
      <div class="crop-stage"><div class="crop-wrap"><img src="${url}" alt="" draggable="false">
        <div class="crop-box"><i data-h="nw"></i><i data-h="ne"></i><i data-h="sw"></i><i data-h="se"></i></div></div></div>
      <div class="btn-row"><button type="button" data-all>全体を使う</button><button type="button" class="primary" data-ok>この範囲を読み取る</button></div>`,
    onMount(sheet, close) {
      const wrap = sheet.querySelector('.crop-wrap');
      const img = wrap.querySelector('img');
      const box = wrap.querySelector('.crop-box');
      // Frame in 0..1 of the image.
      const r = { x: 0.06, y: 0.06, w: 0.88, h: 0.88 };
      const MIN = 0.08;
      const draw = () => Object.assign(box.style, { left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` });
      draw();

      let drag = null;
      wrap.addEventListener('pointerdown', e => {
        const rect = wrap.getBoundingClientRect();
        drag = { mode: e.target.dataset.h || (e.target === box ? 'move' : null), sx: e.clientX, sy: e.clientY, rect, start: { ...r } };
        if (!drag.mode) return (drag = null);
        wrap.setPointerCapture(e.pointerId);
        e.preventDefault();
      });
      wrap.addEventListener('pointermove', e => {
        if (!drag) return;
        const dx = (e.clientX - drag.sx) / drag.rect.width;
        const dy = (e.clientY - drag.sy) / drag.rect.height;
        const s = drag.start;
        const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
        if (drag.mode === 'move') {
          r.x = clamp(s.x + dx, 0, 1 - s.w);
          r.y = clamp(s.y + dy, 0, 1 - s.h);
        } else {
          const left = drag.mode.includes('w') ? clamp(s.x + dx, 0, s.x + s.w - MIN) : s.x;
          const right = drag.mode.includes('e') ? clamp(s.x + s.w + dx, s.x + MIN, 1) : s.x + s.w;
          const top = drag.mode.includes('n') ? clamp(s.y + dy, 0, s.y + s.h - MIN) : s.y;
          const bottom = drag.mode.includes('s') ? clamp(s.y + s.h + dy, s.y + MIN, 1) : s.y + s.h;
          Object.assign(r, { x: left, y: top, w: right - left, h: bottom - top });
        }
        draw();
      });
      const end = () => (drag = null);
      wrap.addEventListener('pointerup', end);
      wrap.addEventListener('pointercancel', end);

      const output = area => {
        const sx = area.x * img.naturalWidth;
        const sy = area.y * img.naturalHeight;
        const sw = area.w * img.naturalWidth;
        const sh = area.h * img.naturalHeight;
        const scale = Math.min(1, MAX_OCR_SIDE / Math.max(sw, sh));
        const c = document.createElement('canvas');
        c.width = Math.round(sw * scale);
        c.height = Math.round(sh * scale);
        c.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
        close(c);
      };
      sheet.querySelector('[data-ok]').addEventListener('click', () => output(r));
      sheet.querySelector('[data-all]').addEventListener('click', () => output({ x: 0, y: 0, w: 1, h: 1 }));
    },
  }).finally(() => URL.revokeObjectURL(url));
}
