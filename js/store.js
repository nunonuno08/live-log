// In-memory copy of all records, written through to IndexedDB. Photos stay in IndexedDB.
//
// Songs and venues are records of their own and lives point at them by id, so the
// same song is counted once even if it was typed differently or came from a
// different release (single / album version). Duplicates can be merged later.
import * as db from './db.js';
import { uid, today, matchKey, songKey, baseTitle, venueKey } from './util.js';

export const state = { artists: new Map(), lives: new Map(), songs: new Map(), venues: new Map() };

export const RECORD_STORES = ['artists', 'lives', 'songs', 'venues'];

/* ---------- change tracking (for cloud sync) ---------- */

// Fires after every local change so sync can schedule itself.
export const changes = new EventTarget();
const changed = () => changes.dispatchEvent(new Event('change'));

const stamp = r => {
  r.updatedAt = Date.now();
  changed();
  return r;
};

// Deleted ids waiting to be sent to the cloud (so other devices delete them too).
const TOMB_KEY = 'livelog-tombstones';
export function readTombs() {
  try {
    return JSON.parse(localStorage.getItem(TOMB_KEY)) || [];
  } catch {
    return [];
  }
}
export function writeTombs(list) {
  try {
    localStorage.setItem(TOMB_KEY, JSON.stringify(list.slice(-5000)));
  } catch {}
}
// Call before removing the record from `state`: a deletion must always be newer than the
// record's last change, even if this phone's clock is a little behind another device's.
function tomb(kind, ...ids) {
  const set = new Set(ids);
  const now = Date.now();
  const entries = ids.map(id => ({ kind, id, at: Math.max(now, (state[kind]?.get(id)?.updatedAt || 0) + 1) }));
  writeTombs([...readTombs().filter(t => !(t.kind === kind && set.has(t.id))), ...entries]);
  changed();
}

/** Stores a record received from the cloud as is (no new timestamp, no change event). */
export async function applyRemote(kind, record) {
  state[kind].set(record.id, record);
  await db.put(kind, record);
}

export async function removeRemote(kind, id) {
  state[kind].delete(id);
  await db.del(kind, id);
}

export const putRemotePhoto = (id, blob) => db.put('photos', { id, blob });
export const hasPhoto = async id => !!(await db.get('photos', id));
export const getPhotoBlob = async id => (await db.get('photos', id))?.blob;

/** Photo ids that records point at. */
export function referencedPhotoIds() {
  const ids = new Set();
  state.artists.forEach(a => a.photoId && ids.add(a.photoId));
  state.lives.forEach(l => (l.photoIds || []).forEach(id => ids.add(id)));
  return ids;
}

export async function load() {
  const [artists, lives, songs, venues] = await Promise.all(RECORD_STORES.map(s => db.getAll(s)));
  state.artists = new Map(artists.map(a => [a.id, a]));
  state.lives = new Map(lives.map(l => [l.id, l]));
  state.songs = new Map(songs.map(s => [s.id, s]));
  state.venues = new Map(venues.map(v => [v.id, v]));
  await migrateV1();
  await rekeySongs();
}

// Bump when the song-matching rules change: existing songs get their keys recomputed and
// songs that now turn out to be the same are merged (in id order, so every device agrees).
const SONG_KEYS_VERSION = 2;
const SONG_KEYS_FLAG = 'livelog-song-keys';

async function rekeySongs() {
  let done = 0;
  try {
    done = Number(localStorage.getItem(SONG_KEYS_FLAG)) || 0;
  } catch {}
  if (done >= SONG_KEYS_VERSION) return;
  for (const s of [...state.songs.values()]) {
    const title = baseTitle(s.title);
    const key = songKey(s.title);
    if (key === s.key && title === s.title) continue;
    const aliases = new Set([...(s.aliases || []), s.key]);
    aliases.delete(key);
    await saveSong({ ...s, title, key, aliases: [...aliases] });
  }
  const first = new Map();
  for (const s of [...state.songs.values()].sort((a, b) => a.id.localeCompare(b.id))) {
    const k = `${s.artistId}|${s.key}`;
    if (first.has(k)) await mergeSong(s.id, first.get(k));
    else first.set(k, s.id);
  }
  try {
    localStorage.setItem(SONG_KEYS_FLAG, String(SONG_KEYS_VERSION));
  } catch {}
}

/* ---------- artists ---------- */

export const artistName = id => state.artists.get(id)?.name ?? '(不明)';

export function findArtist(name, itunesId) {
  const k = matchKey(name);
  return [...state.artists.values()].find(a => (itunesId && a.itunesId === itunesId) || matchKey(a.name) === k);
}

export async function ensureArtist(name, extra = {}) {
  const found = findArtist(name, extra.itunesId);
  if (found) {
    if (extra.itunesId && !found.itunesId) await saveArtist({ ...found, itunesId: extra.itunesId });
    return found.id;
  }
  const artist = { id: uid(), name: name.trim(), itunesId: extra.itunesId || null, photoId: null, createdAt: Date.now() };
  await saveArtist(artist);
  return artist.id;
}

export async function saveArtist(a) {
  state.artists.set(a.id, stamp(a));
  await db.put('artists', a);
}

export async function deleteArtist(id) {
  const a = state.artists.get(id);
  if (a?.photoId) await deletePhoto(a.photoId);
  const songs = [...state.songs.values()].filter(s => s.artistId === id);
  if (songs.length) {
    tomb('songs', ...songs.map(s => s.id));
    songs.forEach(s => state.songs.delete(s.id));
    await db.del('songs', ...songs.map(s => s.id));
  }
  tomb('artists', id);
  state.artists.delete(id);
  await db.del('artists', id);
  await db.del('catalogs', id, `tours:${id}`);
}

/** Moves lives and songs of `fromId` onto `toId` (used to fix duplicate artists). */
export async function mergeArtist(fromId, toId) {
  const lives = [];
  for (const l of state.lives.values()) {
    if (!l.artistIds.includes(fromId)) continue;
    l.artistIds = [...new Set(l.artistIds.map(id => (id === fromId ? toId : id)))];
    lives.push(stamp(l));
  }
  if (lives.length) await db.put('lives', ...lives);
  for (const s of [...state.songs.values()].filter(s => s.artistId === fromId)) {
    const same = findSong(toId, s.title);
    if (same) await mergeSong(s.id, same.id);
    else await saveSong({ ...s, artistId: toId });
  }
  const from = state.artists.get(fromId);
  const to = state.artists.get(toId);
  if (from?.photoId && !to.photoId) {
    to.photoId = from.photoId;
    from.photoId = null;
  }
  if (from?.itunesId && !to.itunesId) to.itunesId = from.itunesId;
  await saveArtist(to);
  await deleteArtist(fromId);
}

/* ---------- songs ---------- */

export const songTitle = id => state.songs.get(id)?.title ?? '(不明な曲)';

export function findSong(artistId, title) {
  const k = songKey(title);
  return [...state.songs.values()].find(s => s.artistId === artistId && (s.key === k || s.aliases?.includes(k)));
}

export async function ensureSong(artistId, title, extra = {}) {
  const found = findSong(artistId, title);
  if (found) {
    if (extra.artwork && !found.artwork) await saveSong({ ...found, artwork: extra.artwork });
    return found.id;
  }
  const song = {
    id: uid(),
    artistId,
    title: baseTitle(title),
    key: songKey(title),
    aliases: [],
    artwork: extra.artwork || '',
    createdAt: Date.now(),
  };
  await saveSong(song);
  return song.id;
}

export async function saveSong(s) {
  state.songs.set(s.id, stamp(s));
  await db.put('songs', s);
}

export async function renameSong(id, title) {
  const s = state.songs.get(id);
  const k = songKey(title);
  const aliases = new Set([...(s.aliases || []), s.key]);
  aliases.delete(k);
  await saveSong({ ...s, title: title.trim(), key: k, aliases: [...aliases] });
}

/** Every setlist entry of `fromId` becomes `toId`; the old spelling is remembered as an alias. */
export async function mergeSong(fromId, toId) {
  const from = state.songs.get(fromId);
  const to = state.songs.get(toId);
  const lives = [];
  for (const l of state.lives.values()) {
    if (!l.setlist?.some(it => it.songId === fromId)) continue;
    l.setlist = l.setlist.map(it => (it.songId === fromId ? { ...it, songId: toId } : it));
    lives.push(stamp(l));
  }
  if (lives.length) await db.put('lives', ...lives);
  const aliases = new Set([...(to.aliases || []), from.key, ...(from.aliases || [])]);
  aliases.delete(to.key);
  await saveSong({ ...to, aliases: [...aliases], artwork: to.artwork || from.artwork });
  tomb('songs', fromId);
  state.songs.delete(fromId);
  await db.del('songs', fromId);
}

/* ---------- venues ---------- */

export const venueName = id => state.venues.get(id)?.name ?? '';

export function findVenue(name) {
  const k = venueKey(name);
  return [...state.venues.values()].find(v => v.key === k || v.aliases?.includes(k));
}

export async function ensureVenue(name, extra = {}) {
  const found = findVenue(name);
  if (found) {
    if (extra.lat && !found.lat) await saveVenue({ ...found, lat: extra.lat, lon: extra.lon, area: extra.area || found.area });
    return found.id;
  }
  const venue = { id: uid(), name: name.trim(), key: venueKey(name), aliases: [], area: extra.area || '', lat: extra.lat || null, lon: extra.lon || null, createdAt: Date.now() };
  await saveVenue(venue);
  return venue.id;
}

export async function saveVenue(v) {
  state.venues.set(v.id, stamp(v));
  await db.put('venues', v);
}

export async function renameVenue(id, name) {
  const v = state.venues.get(id);
  const k = venueKey(name);
  const aliases = new Set([...(v.aliases || []), v.key]);
  aliases.delete(k);
  await saveVenue({ ...v, name: name.trim(), key: k, aliases: [...aliases] });
}

export async function mergeVenue(fromId, toId) {
  const from = state.venues.get(fromId);
  const to = state.venues.get(toId);
  const lives = [];
  for (const l of state.lives.values()) {
    if (l.venueId !== fromId) continue;
    l.venueId = toId;
    lives.push(stamp(l));
  }
  if (lives.length) await db.put('lives', ...lives);
  const aliases = new Set([...(to.aliases || []), from.key, ...(from.aliases || [])]);
  aliases.delete(to.key);
  await saveVenue({ ...to, aliases: [...aliases], lat: to.lat || from.lat, lon: to.lon || from.lon, area: to.area || from.area });
  tomb('venues', fromId);
  state.venues.delete(fromId);
  await db.del('venues', fromId);
}

/* ---------- lives ---------- */

export async function saveLive(live) {
  state.lives.set(live.id, stamp(live));
  await db.put('lives', live);
}

export async function deleteLive(id) {
  const l = state.lives.get(id);
  if (!l) return;
  for (const pid of l.photoIds || []) await deletePhoto(pid);
  tomb('lives', id);
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

/** Song ids of a live's setlist, in order (encore markers skipped). */
export const songIdsOf = l => (l.setlist || []).filter(it => it.kind === 'song' && state.songs.has(it.songId)).map(it => it.songId);

/** liveId -> array aligned with that live's setlist: how many times you had heard each song, including this one. */
export function playCounts() {
  const seen = new Map();
  const counts = new Map();
  for (const l of allLives()) {
    counts.set(
      l.id,
      (l.setlist || []).map(it => {
        if (it.kind !== 'song') return 0;
        const n = (seen.get(it.songId) || 0) + 1;
        seen.set(it.songId, n);
        return n;
      }),
    );
  }
  return counts;
}

/** Songs heard across `lives`, most played first: [{ song, count, lives }]. */
export function songTable(lives) {
  const table = new Map();
  for (const l of lives) {
    for (const id of songIdsOf(l)) {
      let row = table.get(id);
      if (!row) table.set(id, (row = { song: state.songs.get(id), count: 0, lives: [] }));
      row.count++;
      if (!row.lives.includes(l)) row.lives.push(l);
    }
  }
  return [...table.values()].sort((a, b) => b.count - a.count || a.song.title.localeCompare(b.song.title, 'ja'));
}

/** How many past lives each song was played at. */
export function songCounts() {
  const counts = new Map();
  for (const l of state.lives.values()) if (isPast(l)) for (const id of new Set(songIdsOf(l))) counts.set(id, (counts.get(id) || 0) + 1);
  return counts;
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
  tomb('photos', id);
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

/* ---------- catalogs (cached iTunes song lists) ---------- */

export const getCatalog = artistId => db.get('catalogs', artistId);
// `name` is the artist name the list was fetched with; a renamed artist gets a fresh list.
export const putCatalog = (artistId, items, version = 1, name = '') => db.put('catalogs', { id: artistId, fetchedAt: Date.now(), items, version, name });

/* ---------- backup ---------- */

export const FORCE_PUSH_KEY = 'livelog-sync-force';

/**
 * Restores a backup (or wipes everything with {}).
 * toCloud: records not in the new data are deleted from the cloud too, and everything is
 * uploaded again. Without it (logged out) only this phone changes: nothing is queued for the
 * cloud, and the next login downloads the cloud's data afresh.
 */
export async function replaceAll({ artists = [], lives = [], songs = [], venues = [], photos = [] }, { toCloud = true } = {}) {
  if (toCloud) {
    const incoming = { artists, lives, songs, venues };
    for (const kind of RECORD_STORES) {
      const keep = new Set(incoming[kind].map(r => r.id));
      const gone = [...state[kind].keys()].filter(id => !keep.has(id));
      if (gone.length) tomb(kind, ...gone);
    }
    const keepPhotos = new Set(photos.map(p => p.id));
    const gonePhotos = (await db.getAllKeys('photos')).filter(id => !keepPhotos.has(id));
    if (gonePhotos.length) tomb('photos', ...gonePhotos);
  }
  try {
    if (toCloud) localStorage.setItem(FORCE_PUSH_KEY, '1');
    else {
      writeTombs([]);
      ['livelog-sync', 'livelog-uploaded-photos', FORCE_PUSH_KEY].forEach(k => localStorage.removeItem(k));
    }
  } catch {}
  await db.clear(...RECORD_STORES, 'photos', 'catalogs');
  urls.forEach(u => URL.revokeObjectURL(u));
  urls.clear();
  const puts = { artists, lives, songs, venues, photos };
  for (const [store, list] of Object.entries(puts)) if (list.length) await db.put(store, ...list);
  await load();
  changed();
}

/* ---------- migration from the first version ---------- */

// v1 stored song titles and venue names directly on each live, plus MC/SE/VCR markers.
async function migrateV1() {
  const changed = [];
  for (const l of state.lives.values()) {
    let dirty = false;
    if (typeof l.venue === 'string') {
      if (l.venue.trim() && !l.venueId) l.venueId = await ensureVenue(l.venue);
      delete l.venue;
      dirty = true;
    }
    if (l.setlist?.some(it => (it.kind === 'song' && !it.songId) || !['song', 'en'].includes(it.kind))) {
      const out = [];
      for (const it of l.setlist) {
        if (it.kind === 'en') out.push({ kind: 'en' });
        else if (it.kind === 'song' && it.songId) out.push(it);
        else if (it.kind === 'song' && it.title?.trim()) out.push({ kind: 'song', songId: await ensureSong(it.artistId || l.artistIds[0], it.title) });
      }
      l.setlist = out;
      dirty = true;
    }
    if (dirty) changed.push(l);
  }
  if (changed.length) await db.put('lives', ...changed);
}
