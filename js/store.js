// In-memory copy of all artists and lives, written through to IndexedDB.
// Photos stay in IndexedDB and are loaded on demand.
import * as db from './db.js';
import { uid, today, normTitle } from './util.js';

export const state = { artists: new Map(), lives: new Map() };

export async function load() {
  const [artists, lives] = await Promise.all([db.getAll('artists'), db.getAll('lives')]);
  state.artists = new Map(artists.map(a => [a.id, a]));
  state.lives = new Map(lives.map(l => [l.id, l]));
}

/* ---------- artists ---------- */

export const artistName = id => state.artists.get(id)?.name ?? '(不明)';

export function findArtistByName(name) {
  const n = normTitle(name);
  return [...state.artists.values()].find(a => normTitle(a.name) === n);
}

export async function ensureArtist(name) {
  const found = findArtistByName(name);
  if (found) return found.id;
  const artist = { id: uid(), name: name.trim(), photoId: null, createdAt: Date.now() };
  await saveArtist(artist);
  return artist.id;
}

export async function saveArtist(artist) {
  state.artists.set(artist.id, artist);
  await db.put('artists', artist);
}

export async function deleteArtist(id) {
  const a = state.artists.get(id);
  if (a?.photoId) await deletePhoto(a.photoId);
  state.artists.delete(id);
  await db.del('artists', id);
}

// Moves every reference of `fromId` onto `toId`, then removes `fromId` (used to fix typos).
export async function mergeArtist(fromId, toId) {
  const changed = [];
  for (const l of state.lives.values()) {
    if (!l.artistIds.includes(fromId) && !l.setlist?.some(it => it.artistId === fromId)) continue;
    l.artistIds = [...new Set(l.artistIds.map(id => (id === fromId ? toId : id)))];
    l.setlist = (l.setlist || []).map(it => (it.artistId === fromId ? { ...it, artistId: toId } : it));
    changed.push(l);
  }
  if (changed.length) await db.put('lives', ...changed);
  const from = state.artists.get(fromId);
  const to = state.artists.get(toId);
  if (from?.photoId && !to.photoId) {
    to.photoId = from.photoId;
    from.photoId = null;
    await saveArtist(to);
  }
  await deleteArtist(fromId);
}

/* ---------- lives ---------- */

export async function saveLive(live) {
  live.updatedAt = Date.now();
  state.lives.set(live.id, live);
  await db.put('lives', live);
}

export async function deleteLive(id) {
  const l = state.lives.get(id);
  if (!l) return;
  for (const pid of l.photoIds || []) await deletePhoto(pid);
  state.lives.delete(id);
  await db.del('lives', id);
}

// Today's live already counts as attended.
export const isPast = l => l.date <= today();

export const cmpLive = (a, b) =>
  a.date.localeCompare(b.date) ||
  (a.startTime || a.openTime || '').localeCompare(b.startTime || b.openTime || '') ||
  (a.createdAt || 0) - (b.createdAt || 0);

/** All lives, oldest first. */
export const allLives = () => [...state.lives.values()].sort(cmpLive);

export const livesOfArtist = id => allLives().filter(l => l.artistIds.includes(id));

export const liveTitle = l => l.title?.trim() || l.artistIds.map(artistName).join(' / ') || '(無題)';

/* ---------- songs ---------- */

export const songs = l => (l.setlist || []).filter(it => it.kind === 'song' && it.title?.trim());

// A song without its own artist belongs to the live's main (first) artist.
export const songArtist = (item, live) => item.artistId || live.artistIds[0];

export const songKey = (item, live) => `${songArtist(item, live)}|${normTitle(item.title)}`;

/** liveId -> array aligned with that live's setlist: how many times you had heard each song, including this one. */
export function playCounts() {
  const seen = new Map();
  const counts = new Map();
  for (const l of allLives()) {
    counts.set(
      l.id,
      (l.setlist || []).map(it => {
        if (it.kind !== 'song' || !it.title?.trim()) return 0;
        const k = songKey(it, l);
        const n = (seen.get(k) || 0) + 1;
        seen.set(k, n);
        return n;
      }),
    );
  }
  return counts;
}

/** Songs heard across `lives`, most played first. */
export function songTable(lives) {
  const table = new Map();
  for (const l of lives) {
    for (const it of songs(l)) {
      const key = songKey(it, l);
      let s = table.get(key);
      if (!s) table.set(key, (s = { key, title: it.title.trim(), artistId: songArtist(it, l), count: 0, lives: [] }));
      s.count++;
      if (!s.lives.includes(l)) s.lives.push(l);
    }
  }
  return [...table.values()].sort((a, b) => b.count - a.count || a.title.localeCompare(b.title, 'ja'));
}

/* ---------- photos ---------- */

const urls = new Map();

export async function savePhoto(blob) {
  const id = uid();
  await db.put('photos', { id, blob });
  return id;
}

export async function deletePhoto(id) {
  await db.del('photos', id);
  const u = urls.get(id);
  if (u) URL.revokeObjectURL(u);
  urls.delete(id);
}

export async function photoUrl(id) {
  if (!urls.has(id)) {
    const p = await db.get('photos', id);
    if (!p) return null;
    urls.set(id, URL.createObjectURL(p.blob));
  }
  return urls.get(id);
}

/** Fills every <img data-photo="id"> under `root`. */
export function hydratePhotos(root) {
  root.querySelectorAll('img[data-photo]').forEach(async img => {
    const u = await photoUrl(img.dataset.photo);
    if (u) img.src = u;
  });
}

export async function cleanupOrphanPhotos(keep = []) {
  const used = new Set(keep);
  state.artists.forEach(a => a.photoId && used.add(a.photoId));
  state.lives.forEach(l => (l.photoIds || []).forEach(id => used.add(id)));
  const orphans = (await db.getAllKeys('photos')).filter(id => !used.has(id));
  if (orphans.length) await db.del('photos', ...orphans);
}

export const photoCount = () => db.count('photos');
export const allPhotos = () => db.getAll('photos');

export async function replaceAll({ artists = [], lives = [], photos = [] }) {
  await db.clear('artists', 'lives', 'photos');
  urls.forEach(u => URL.revokeObjectURL(u));
  urls.clear();
  if (artists.length) await db.put('artists', ...artists);
  if (lives.length) await db.put('lives', ...lives);
  if (photos.length) await db.put('photos', ...photos);
  await load();
}
