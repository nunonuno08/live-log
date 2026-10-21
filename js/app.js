import { state, load, cleanupOrphanPhotos } from './store.js';
import { nav } from './nav.js';
import { closeAllSheets } from './ui.js';
import { initSync, status, statusEvents, pendingCount } from './sync.js';
import { finishSpotifyLogin } from './spotify.js';
import { toast } from './util.js';
import * as welcome from './views/welcome.js';
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

const signedIn = () => status.state !== 'signedOut';
const hasData = () => state.artists.size > 0 || state.lives.size > 0;

/* ---------- sync notice at the top of the main tabs ---------- */

function ago(ms) {
  const min = Math.floor((Date.now() - ms) / 60000);
  if (min < 60) return `${Math.max(min, 1)}分前`;
  if (min < 1440) return `${Math.floor(min / 60)}時間前`;
  return `${Math.floor(min / 1440)}日前`;
}

function syncNoticeHtml() {
  if (!signedIn()) {
    return hasData() ? 'ログインしていません。記録はこの端末の中だけに保存されています。設定からログインできます →' : '';
  }
  if (status.state === 'syncing') return '';
  const n = pendingCount();
  // Offline for a while at a venue is normal; say something once it has lasted a day, or when
  // the cloud itself answers with an error.
  const stale = !status.lastSync || Date.now() - status.lastSync > 86400000;
  if (!n || (status.state !== 'error' && !stale)) return '';
  const when = status.lastSync ? `最後に保存できたのは${ago(status.lastSync)}` : 'まだ一度も保存できていません';
  return `<b>まだクラウドに保存されていない変更が${n}件あります</b>（${when}）。設定で確認できます →`;
}

let noticeSlot = false;
function refreshSyncNotice() {
  const view = root.querySelector('.view');
  if (!view || !noticeSlot) return;
  const html = syncNoticeHtml();
  let el = view.querySelector('#sync-notice');
  if (!html) return el?.remove();
  if (!el) {
    el = document.createElement('a');
    el.id = 'sync-notice';
    el.href = '#/settings';
    const header = view.querySelector('header.top');
    header ? header.after(el) : view.prepend(el);
  }
  el.className = `banner${signedIn() ? ' warn' : ''}`;
  el.innerHTML = html;
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

  // A phone with nothing on it starts from the cloud copy (or the user chooses to go without).
  if (!signedIn() && !hasData() && !welcome.localOnly()) {
    noticeSlot = false;
    welcome.render(view, () => {
      history.replaceState(null, '', '#/');
      route();
    });
    document.body.classList.add('editing');
    fab.hidden = true;
    return;
  }

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
      live.render(view, id, params);
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
      cleanup = settings.render(view) || null;
      tab = 'settings';
      break;
    default:
      location.replace('#/');
      return;
  }

  document.body.classList.toggle('editing', !tab);
  document.querySelectorAll('#tabbar a').forEach(a => a.classList.toggle('on', a.dataset.tab === tab));
  fab.hidden = !fabAction;
  noticeSlot = [undefined, 'lives', 'stats'].includes(name);
  refreshSyncNotice();
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
  // Coming back from Spotify's login page (…/live-log/?code=…): finish it, then carry on.
  try {
    const next = await finishSpotifyLogin();
    if (next) history.replaceState(null, '', next);
  } catch (err) {
    toast(err.message);
  }
  // Show data that arrived from other devices, but never pull the page out from under an
  // open form or sheet (or the first-launch login, which opens the app itself when done).
  statusEvents.addEventListener('received', () => {
    const busy = /^#\/(new|edit)/.test(location.hash) || document.body.classList.contains('modal-open') || root.querySelector('.welcome');
    if (!busy) nav.rerender();
  });
  statusEvents.addEventListener('change', refreshSyncNotice);
  // Before the first screen, so it already knows whether this phone is logged in.
  initSync();
  route();
  cleanupOrphanPhotos(edit.draftPhotoIds()).catch(() => {});
  if ('serviceWorker' in navigator && location.hostname !== 'localhost') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
