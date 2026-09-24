// Spotify: "open in Spotify" links, and turning a setlist into a playlist.
// Playlists use the Web API with the PKCE login flow (no secret needed in the app). Spotify
// only lets Development Mode apps work while the owner has Premium, for up to 5 users.
import { state, liveTitle, artistName, venueName } from './store.js';
import { fmtDate, baseTitle, stripRomaji, matchKey } from './util.js';

// Client ID of the app registered at developer.spotify.com (public; not a secret).
const CLIENT_ID = '';
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

async function findTrack(title, artist) {
  const plain = stripRomaji(baseTitle(title));
  const want = matchKey(artist);
  for (const q of [`track:${plain} artist:${artist}`, `${plain} ${artist}`]) {
    const j = await api(`/search?type=track&limit=5&market=JP&q=${encodeURIComponent(q)}`);
    const items = j.tracks?.items || [];
    const hit = items.find(t => t.artists.some(a => matchKey(a.name) === want)) || (q.startsWith('track:') ? items[0] : null);
    if (hit) return hit.uri;
  }
  return null;
}

/** Creates a private playlist of the live's setlist. Resolves { url, missing: [titles] }. */
export async function createPlaylist(live, onProgress) {
  const songs = (live.setlist || []).filter(it => it.kind === 'song' && state.songs.has(it.songId)).map(it => state.songs.get(it.songId));
  const uris = [];
  const missing = [];
  for (const [i, song] of songs.entries()) {
    onProgress?.(`曲を探しています… ${i + 1}/${songs.length}`);
    const uri = await findTrack(song.title, artistName(song.artistId));
    if (uri) uris.push(uri);
    else missing.push(song.title);
  }
  onProgress?.('プレイリストを作成中…');
  const venue = venueName(live.venueId);
  const playlist = await api('/me/playlists', {
    method: 'POST',
    body: JSON.stringify({
      name: `${fmtDate(live.date, false)} ${liveTitle(live)}`,
      description: `${venue ? `${venue} の` : ''}セットリスト（ライブ記録アプリで作成）`,
      public: false,
    }),
  });
  for (let i = 0; i < uris.length; i += 100) {
    await api(`/playlists/${playlist.id}/items`, { method: 'POST', body: JSON.stringify({ uris: uris.slice(i, i + 100) }) });
  }
  return { url: playlist.external_urls?.spotify, missing };
}
