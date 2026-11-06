// Spotify: "open in Spotify" links, and turning a setlist into a playlist.
// Playlists use the Web API with the PKCE login flow (no secret needed in the app). Spotify
// only lets Development Mode apps work while the owner has Premium, for up to 5 users.
import { state, liveTitle, artistName, venueName } from './store.js';
import { fmtDate, baseTitle, stripRomaji, matchKey, songKey, similarity } from './util.js';

// Client ID of the app registered at developer.spotify.com (public; not a secret).
const CLIENT_ID = 'b153e8300f014ee7a45e22cf3c67d8ae';
const REDIRECT_URI = new URL('./', location.href).href;
const SCOPES = 'playlist-modify-private playlist-modify-public';
const TOKEN_KEY = 'livelog-spotify';
const PENDING_KEY = 'livelog-spotify-pending';

export const spotifyAvailable = () => !!CLIENT_ID;

/** Opens Spotify (the app on iPhone) searching for the song. */
export const spotifySearchUrl = (title, artist) => `https://open.spotify.com/search/${encodeURIComponent(`${stripRomaji(baseTitle(title))} ${artist}`)}`;

/* ---------- login ---------- */

const readToken = () => {
  try {
    return JSON.parse(localStorage.getItem(TOKEN_KEY));
  } catch {
    return null;
  }
};
const writeToken = t => localStorage.setItem(TOKEN_KEY, JSON.stringify(t));
export const spotifyConnected = () => !!readToken()?.refresh_token;
export const disconnectSpotify = () => localStorage.removeItem(TOKEN_KEY);

const base64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Goes to Spotify's login page; comes back to `returnHash` and continues there. */
export async function connectSpotify(returnHash) {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  const stateId = base64url(crypto.getRandomValues(new Uint8Array(12)));
  localStorage.setItem(PENDING_KEY, JSON.stringify({ verifier, state: stateId, returnHash }));
  const q = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    scope: SCOPES,
    redirect_uri: REDIRECT_URI,
    code_challenge_method: 'S256',
    code_challenge: challenge,
    state: stateId,
  });
  location.href = `https://accounts.spotify.com/authorize?${q}`;
}

async function tokenRequest(params) {
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, ...params }),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(j.error_description || j.error || 'Spotify にログインできませんでした');
  const old = readToken() || {};
  const token = { ...old, ...j, expires_at: Date.now() + (j.expires_in - 60) * 1000 };
  writeToken(token);
  return token;
}

/**
 * Called at start-up: finishes a Spotify login if we just came back from it.
 * Returns the hash to continue at, or null when there was nothing to do.
 */
export async function finishSpotifyLogin() {
  const q = new URLSearchParams(location.search);
  if (!q.has('code') && !q.has('error')) return null;
  const pending = JSON.parse(localStorage.getItem(PENDING_KEY) || 'null');
  localStorage.removeItem(PENDING_KEY);
  history.replaceState(null, '', location.pathname);
  if (!pending || q.get('state') !== pending.state || q.has('error')) return pending?.returnHash?.replace(/[?&]spotify=1/, '') || '#/';
  await tokenRequest({ grant_type: 'authorization_code', code: q.get('code'), redirect_uri: REDIRECT_URI, code_verifier: pending.verifier });
  return pending.returnHash || '#/';
}

async function accessToken() {
  const t = readToken();
  if (!t?.refresh_token) throw new Error('Spotify に接続されていません');
  if (Date.now() < t.expires_at) return t.access_token;
  return (await tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refresh_token })).access_token;
}

async function api(path, options = {}) {
  const res = await fetch(`https://api.spotify.com/v1${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
  });
  if (res.status === 429) {
    await new Promise(r => setTimeout(r, 1500));
    return api(path, options);
  }
  const j = res.status === 204 ? {} : await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error?.message || `Spotify エラー (${res.status})`);
  return j;
}

/* ---------- playlist ---------- */

// Spotify sometimes spells a name a little differently ("King Gnu" / "KingGnu"), so one
// containing the other counts as the same artist.
function sameArtist(a, b) {
  const x = matchKey(a);
  const y = matchKey(b);
  return x === y || (x.length >= 2 && y.length >= 2 && (x.includes(y) || y.includes(x)));
}

// "Balmy Life - 2023 Remaster" is still "Balmy Life".
function sameTitle(spotifyName, title) {
  const a = songKey(spotifyName);
  const b = songKey(title);
  return a === b || (b.length >= 4 && a.startsWith(b)) || similarity(a, b) >= 0.8;
}

/**
 * Spotify tracks that may be `song`, best first. `ok` means both the artist and the title
 * match; results matching neither are dropped, so a song that isn't on Spotify finds nothing
 * instead of some other artist's track.
 */
async function searchSong(song) {
  const title = stripRomaji(baseTitle(song.title));
  const artist = artistName(song.artistId);
  const found = new Map();
  for (const q of [`track:${title} artist:${artist}`, `${title} ${artist}`]) {
    const j = await api(`/search?type=track&limit=6&market=JP&q=${encodeURIComponent(q)}`);
    for (const t of j.tracks?.items || []) {
      if (found.has(t.uri)) continue;
      const artistOk = t.artists.some(a => sameArtist(a.name, artist));
      const titleOk = sameTitle(t.name, song.title);
      found.set(t.uri, {
        uri: t.uri,
        name: t.name,
        artists: t.artists.map(a => a.name).join(', '),
        album: t.album?.name || '',
        image: t.album?.images?.at(-1)?.url || '',
        ok: artistOk && titleOk,
        rank: (artistOk ? 2 : 0) + (titleOk ? 1 : 0),
      });
    }
    if ([...found.values()].some(c => c.ok)) break;
  }
  return [...found.values()].filter(c => c.rank > 0).sort((a, b) => b.rank - a.rank).slice(0, 6);
}

/**
 * Searches Spotify for each song of the setlist so the user can check the matches before
 * anything is created. Rows: { song, candidates, pick (index, -1 = none), on }.
 */
export async function findSetlistTracks(live, onProgress) {
  const songs = (live.setlist || []).filter(it => it.kind === 'song' && state.songs.has(it.songId)).map(it => state.songs.get(it.songId));
  const rows = [];
  for (const [i, song] of songs.entries()) {
    onProgress?.(`曲を探しています… ${i + 1}/${songs.length}`);
    const candidates = await searchSong(song);
    // An unsure match starts unticked: a missing song is better than a wrong one.
    rows.push({ song, candidates, pick: candidates.length ? 0 : -1, on: !!candidates[0]?.ok });
  }
  return rows;
}

/** Creates a private playlist of the live with the given tracks. Resolves its URL. */
export async function createPlaylist(live, uris) {
  const venue = venueName(live.venueId);
  const playlist = await api('/me/playlists', {
    method: 'POST',
    body: JSON.stringify({
      name: `${fmtDate(live.date, false)} ${liveTitle(live)}`,
      description: `${venue ? `${venue} の` : ''}セットリスト`,
      public: false,
    }),
  });
  for (let i = 0; i < uris.length; i += 100) {
    await api(`/playlists/${playlist.id}/items`, { method: 'POST', body: JSON.stringify({ uris: uris.slice(i, i + 100) }) });
  }
  return playlist.external_urls?.spotify;
}
