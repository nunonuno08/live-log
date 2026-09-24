// Bottom sheets and input helpers shared by the screens.
import { esc, debounce, matchKey, matchScore, addMinutes, toast } from './util.js';
import { state, ensureArtist, findArtist, allLives, hydratePhotos } from './store.js';
import { searchArtists, autoArtistPhoto, catalogFor } from './music.js';
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
      let seq = 0;

      const row = (a, sub, attrs) =>
        `<button type="button" class="pick-row" ${attrs}>${avatar(a, 'sm')}<span class="pick-name">${esc(a.name)}<small>${esc(sub)}</small></span></button>`;

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
          html += `<h3 class="sec">新しく登録</h3>` + fresh.map((r, i) => row({ name: r.name }, r.genre, `data-remote="${i}"`)).join('');
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
        if (my === seq) draw();
      }, 300);

      input.addEventListener('input', () => {
        draw();
        searchRemote();
      });

      list.addEventListener('click', async e => {
        const b = e.target.closest('button');
        if (!b) return;
        let id;
        if (b.dataset.id) id = b.dataset.id;
        else if (b.dataset.remote) {
          const r = list._fresh[Number(b.dataset.remote)];
          id = await ensureArtist(r.name, { itunesId: r.itunesId });
        } else if (b.dataset.manual != null) id = await ensureArtist(input.value.trim());
        if (!id) return;
        if (!b.dataset.id) {
          // Photo and song list arrive in the background.
          autoArtistPhoto(id).catch(() => {});
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

/* ---------- time picker ---------- */

const HOURS = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23];
const MINUTES = ['00', '15', '30', '45'];

/** Two taps: hour, then minute. Resolves '' to clear, null when dismissed. */
export function pickTime({ title, value = '', base = '' }) {
  const [h0, m0] = value ? value.split(':') : ['', ''];
  const quick = base
    ? `<div class="quick-row">${[30, 60]
        .map(min => `<button type="button" class="chip" data-quick="${addMinutes(base, min)}">開場の${min === 60 ? '1時間' : '30分'}後 (${addMinutes(base, min)})</button>`)
        .join('')}</div>`
    : '';
  return openSheet({
    title,
    html: `${quick}
      <p class="muted small">時</p>
      <div class="time-grid hours">${HOURS.map(h => `<button type="button" data-h="${String(h).padStart(2, '0')}">${h}</button>`).join('')}</div>
      <p class="muted small">分</p>
      <div class="time-grid mins">${MINUTES.map(m => `<button type="button" data-m="${m}">${m}</button>`).join('')}</div>
      <div class="time-foot">
        <label class="muted small">細かく指定 <input type="time" value="${esc(value)}"></label>
        <button type="button" class="txt danger" data-clear>クリア</button>
      </div>`,
    onMount(sheet, close) {
      let hour = h0;
      const mark = () => {
        sheet.querySelectorAll('[data-h]').forEach(b => b.classList.toggle('on', b.dataset.h === hour));
        sheet.querySelectorAll('[data-m]').forEach(b => b.classList.toggle('on', hour === h0 && b.dataset.m === m0));
      };
      mark();
      sheet.addEventListener('click', e => {
        const b = e.target.closest('button');
        if (!b) return;
        if (b.dataset.quick) close(b.dataset.quick);
        else if (b.dataset.h) {
          hour = b.dataset.h;
          mark();
        } else if (b.dataset.m) {
          if (!hour) return toast('先に「時」を選んでください');
          close(`${hour}:${b.dataset.m}`);
        } else if (b.dataset.clear != null) close('');
      });
      sheet.querySelector('input[type=time]').addEventListener('change', e => e.target.value && close(e.target.value));
    },
  });
}
