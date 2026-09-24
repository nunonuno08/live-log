import { load, cleanupOrphanPhotos } from './store.js';
import { nav } from './nav.js';
import { closeAllSheets } from './ui.js';
import * as home from './views/home.js';
import * as lives from './views/lives.js';
import * as artist from './views/artist.js';
import * as live from './views/live.js';
import * as edit from './views/edit.js';
import * as stats from './views/stats.js';
import * as detail from './views/detail.js';
import * as settings from './views/settings.js';

const root = document.getElementById('app');
const fab = document.getElementById('fab');
const scrollPos = new Map();
let cleanup = null;
let fabAction = null;

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
  closeAllSheets();
  const { parts, params } = parseHash();
  const [name, id] = parts;
  const view = document.createElement('div');
  view.className = 'view';
  root.replaceChildren(view);

  // tab: which bottom tab is lit (null hides the tab bar); fabAction: what "+" does.
  let tab = 'home';
  fabAction = null;
  switch (name) {
    case undefined:
      home.render(view);
      fabAction = home.addArtist;
      break;
    case 'lives':
      lives.render(view);
      tab = 'lives';
      fabAction = lives.addLive;
      break;
    case 'artist':
      artist.render(view, id);
      break;
    case 'live':
      live.render(view, id);
      tab = 'lives';
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
      detail.renderSong(view, id);
      tab = 'stats';
      break;
    case 'venue':
      detail.renderVenue(view, id);
      tab = 'stats';
      break;
    case 'settings':
      settings.render(view);
      tab = 'settings';
      break;
    default:
      location.replace('#/');
      return;
  }

  document.body.classList.toggle('editing', !tab);
  document.querySelectorAll('#tabbar a').forEach(a => a.classList.toggle('on', a.dataset.tab === tab));
  fab.hidden = !fabAction;
  window.scrollTo(0, scrollPos.get(location.hash || '#/') || 0);
}

fab.addEventListener('click', () => fabAction?.());

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
