import { load, cleanupOrphanPhotos } from './store.js';
import { nav } from './nav.js';
import * as home from './views/home.js';
import * as artist from './views/artist.js';
import * as live from './views/live.js';
import * as edit from './views/edit.js';
import * as stats from './views/stats.js';
import * as settings from './views/settings.js';

const root = document.getElementById('app');
const fab = document.getElementById('fab');
const scrollPos = new Map();
let cleanup = null;

function parseHash() {
  const [path, qs] = (location.hash || '#/').slice(1).split('?');
  return {
    parts: path.split('/').filter(Boolean).map(decodeURIComponent),
    params: new URLSearchParams(qs || ''),
  };
}

function route() {
  cleanup?.();
  cleanup = null;
  const { parts, params } = parseHash();
  const [name, id] = parts;
  const view = document.createElement('div');
  view.className = 'view';
  root.replaceChildren(view);

  let tab = 'home';
  let fabHref = '#/new';
  switch (name) {
    case undefined:
      home.render(view);
      break;
    case 'artist':
      artist.render(view, id);
      fabHref = `#/new?artist=${id}`;
      break;
    case 'live':
      live.render(view, id);
      fabHref = null;
      break;
    case 'new':
    case 'edit':
      cleanup = edit.render(view, name === 'edit' ? id : null, params) || null;
      tab = null;
      break;
    case 'stats':
      stats.render(view, params);
      tab = 'stats';
      break;
    case 'song':
      stats.renderSong(view, id);
      tab = 'stats';
      fabHref = null;
      break;
    case 'settings':
      settings.render(view);
      tab = 'settings';
      fabHref = null;
      break;
    default:
      location.replace('#/');
      return;
  }

  document.body.classList.toggle('editing', !tab);
  document.querySelectorAll('#tabbar a').forEach(a => a.classList.toggle('on', a.dataset.tab === tab));
  fab.hidden = !fabHref || !tab;
  if (fabHref) fab.href = fabHref;
  window.scrollTo(0, scrollPos.get(location.hash || '#/') || 0);
}

nav.rerender = () => {
  const y = window.scrollY;
  route();
  window.scrollTo(0, y);
};

window.addEventListener('hashchange', e => {
  scrollPos.set(new URL(e.oldURL).hash || '#/', window.scrollY);
  if (nav.replacing) nav.replacing = false;
  else nav.hasHistory = true;
  route();
});

document.addEventListener('click', e => {
  const back = e.target.closest('[data-back]');
  if (!back) return;
  e.preventDefault();
  if (nav.hasHistory) history.back();
  else {
    nav.replacing = true;
    location.replace(back.dataset.back || '#/');
  }
});

(async () => {
  try {
    await load();
  } catch (err) {
    root.innerHTML = `<div class="empty">データを読み込めませんでした。<br>${String(err.message || err)}</div>`;
    return;
  }
  route();
  cleanupOrphanPhotos(edit.draftPhotoIds()).catch(() => {});
  if ('serviceWorker' in navigator && location.hostname !== 'localhost') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
