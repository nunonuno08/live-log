// Free public music / place data, called straight from the phone:
//   iTunes Search API  - artist candidates, each artist's songs and jacket art
//   Deezer API (JSONP) - artist photos
//   Photon (OpenStreetMap) - venue search
import { state, getCatalog, putCatalog, savePhoto, deletePhoto, saveArtist } from './store.js';
import { matchKey, songKey, baseTitle, similarity, compressImage } from './util.js';

const ITUNES = 'https://itunes.apple.com';
const CATALOG_MAX_AGE = 30 * 86400000;
// Bump when song-title cleaning changes so cached song lists are rebuilt.
const CATALOG_VERSION = 3;

async function getJson(url, signal) {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// iTunes artwork URLs end in "/100x100bb.jpg"; any size can be requested.
export const artworkAt = (url, size) => (url ? url.replace(/\/\d+x\d+bb\./, `/${size}x${size}bb.`) : '');

export async function searchArtists(term, signal) {
  const j = await getJson(`${ITUNES}/search?term=${encodeURIComponent(term)}&entity=musicArtist&country=JP&lang=ja_jp&limit=8`, signal);
  return j.results.map(a => ({ itunesId: a.artistId, name: a.artistName, genre: a.primaryGenreName || '' }));
}

/** Song list of an artist (deduplicated so single/album versions are one entry). Cached for 30 days. */
export async function catalogFor(artistId, { refresh = false } = {}) {
  const artist = state.artists.get(artistId);
  if (!artist?.itunesId) return [];
  const cached = await getCatalog(artistId).catch(() => null);
  if (cached && !refresh && cached.version === CATALOG_VERSION && Date.now() - cached.fetchedAt < CATALOG_MAX_AGE) return cached.items;
  if (!navigator.onLine) return cached?.items || [];
  try {
    const [byId, byName] = await Promise.all([
      getJson(`${ITUNES}/lookup?id=${artist.itunesId}&entity=song&limit=200&country=JP&lang=ja_jp`),
      getJson(`${ITUNES}/search?term=${encodeURIComponent(artist.name)}&entity=song&attribute=artistTerm&limit=200&country=JP&lang=ja_jp`),
    ]);
    const byKey = new Map();
    for (const t of [...byId.results, ...byName.results]) {
      if (t.wrapperType !== 'track' || t.artistId !== artist.itunesId) continue;
      const key = songKey(t.trackName);
      const title = baseTitle(t.trackName);
      const prev = byKey.get(key);
      // Prefer the plainest title and keep the first artwork seen.
      if (!prev) byKey.set(key, { title, key, artwork: t.artworkUrl100 || '' });
      else if (title.length < prev.title.length) prev.title = title;
    }
    const items = [...byKey.values()];
    await putCatalog(artistId, items, CATALOG_VERSION);
    return items;
  } catch {
    return cached?.items || [];
  }
}

/* ---------- tour names (Japanese Wikipedia) ---------- */

const WIKI = 'https://ja.wikipedia.org/w/api.php?format=json&origin=*';
const TOUR_WORD = /tour|ツアー|live|ライブ|ワンマン|公演|concert|コンサート|arena|hall|dome|ドーム|アリーナ|fes|フェス|gig/i;
// Video releases and TV programmes also mention "LIVE"; skip them.
const NOT_TOUR = /video|dvd|blu-?ray|viewing|cdtv|関ジャム|mステ|music station|\btv\b|テレビ|番組/i;

async function wikiText(title) {
  const j = await getJson(`${WIKI}&action=parse&prop=wikitext&redirects=1&page=${encodeURIComponent(title)}`);
  return j.parse?.wikitext?.['*'] || '';
}

// Finds the artist's article and makes sure it is about a musician.
async function artistWikiText(name) {
  const isMusician = t => /Infobox[ _]Musician|Infobox[ _]音楽|アーティスト|バンド|歌手/.test(t.slice(0, 3000));
  const direct = await wikiText(name).catch(() => '');
  if (direct && isMusician(direct)) return direct;
  const j = await getJson(`${WIKI}&action=query&list=search&srlimit=3&srsearch=${encodeURIComponent(name)}`);
  const k = matchKey(name);
  for (const hit of j.query?.search || []) {
    if (!matchKey(hit.title).startsWith(k)) continue;
    const t = await wikiText(hit.title).catch(() => '');
    if (t && isMusician(t)) return t;
  }
  return '';
}

const cleanWiki = s =>
  s
    .replace(/<ref[^>]*\/>|<ref[^>]*>[\s\S]*?<\/ref>|<[^>]+>/g, '')
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/'{2,}/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/** Tour / live titles mentioned in the artist's article: [{ title, year }]. */
export function extractTours(wikitext) {
  const byKey = new Map();
  for (const rawLine of wikitext.split('\n')) {
    const line = cleanWiki(rawLine);
    const lineYear = line.match(/(19|20)\d{2}/)?.[0] || '';
    // 「Title」, 『Title』 and bold '''Title''' entries in tour lists.
    const found = [
      ...[...line.matchAll(/[「『]([^」』]{4,90})[」』]/g)].map(m => m[1]),
      ...[...rawLine.matchAll(/'''(?:\[\[(?:[^\]|]*\|)?)?([^'\]]{4,90})(?:\]\])?'''/g)].map(m => cleanWiki(m[1])),
    ];
    for (const found1 of found) {
      const title = found1.trim();
      if (!TOUR_WORD.test(title) || NOT_TOUR.test(title) || /https?:|\.jp|。/.test(title)) continue;
      const key = matchKey(title);
      if (!byKey.has(key)) byKey.set(key, { title, year: title.match(/(19|20)\d{2}/)?.[0] || lineYear });
    }
  }
  return [...byKey.values()];
}

/** Tour names for an artist, cached for 30 days next to the song list. */
export async function toursFor(artistId) {
  const artist = state.artists.get(artistId);
  if (!artist) return [];
  const cacheId = `tours:${artistId}`;
  const cached = await getCatalog(cacheId).catch(() => null);
  if (cached && Date.now() - cached.fetchedAt < CATALOG_MAX_AGE) return cached.items;
  if (!navigator.onLine) return cached?.items || [];
  try {
    const items = extractTours(await artistWikiText(artist.name));
    await putCatalog(cacheId, items);
    return items;
  } catch {
    return cached?.items || [];
  }
}

/* ---------- artist photos ---------- */

const pictureCache = new Map();

/**
 * Pictures for iTunes search results, to show while choosing: the Deezer artist photo when the
 * name matches exactly, otherwise the newest jacket. Resolves to Map(itunesId -> { thumb, big }).
 */
export async function artistPictures(results) {
  const todo = results.filter(r => !pictureCache.has(r.itunesId));
  if (todo.length) {
    const albums = getJson(`${ITUNES}/lookup?id=${todo.map(r => r.itunesId).join(',')}&entity=album&limit=1&country=JP`)
      .then(j => new Map(j.results.filter(x => x.wrapperType === 'collection').map(x => [x.artistId, x.artworkUrl100])))
      .catch(() => new Map());
    const photos = await Promise.all(todo.map(r => deezerSearch(r.name, 3)));
    const jackets = await albums;
    todo.forEach((r, i) => {
      const k = matchKey(r.name);
      const hit = photos[i].find(a => matchKey(a.name) === k);
      const jacket = jackets.get(r.itunesId);
      pictureCache.set(
        r.itunesId,
        hit ? { thumb: hit.picture_medium, big: hit.picture_big || hit.picture_medium } : jacket ? { thumb: artworkAt(jacket, 200), big: artworkAt(jacket, 600) } : null,
      );
    });
  }
  return new Map(results.map(r => [r.itunesId, pictureCache.get(r.itunesId)]));
}

function deezerSearch(name, limit = 6) {
  return new Promise(resolve => {
    const cb = `__dz${Date.now()}${Math.floor(Math.random() * 1e6)}`;
    const script = document.createElement('script');
    const done = v => {
      clearTimeout(timer);
      delete window[cb];
      script.remove();
      resolve(v);
    };
    const timer = setTimeout(() => done([]), 8000);
    window[cb] = j => done((j?.data || []).filter(a => a.picture_medium && !a.picture_medium.includes('/artist//')));
    script.onerror = () => done([]);
    script.src = `https://api.deezer.com/search/artist?q=${encodeURIComponent(name)}&limit=${limit}&output=jsonp&callback=${cb}`;
    document.head.append(script);
  });
}

async function albumArtworks(itunesId) {
  if (!itunesId) return [];
  try {
    const j = await getJson(`${ITUNES}/lookup?id=${itunesId}&entity=album&limit=12&country=JP`);
    return j.results.filter(r => r.wrapperType === 'collection' && r.artworkUrl100).map(r => artworkAt(r.artworkUrl100, 600));
  } catch {
    return [];
  }
}

/** Image candidates for an artist: Deezer artist photos (best match first), then album jackets. */
export async function photoCandidates(artist) {
  const [dz, albums] = await Promise.all([deezerSearch(artist.name), albumArtworks(artist.itunesId)]);
  const k = matchKey(artist.name);
  const photos = dz
    .map(a => ({ url: a.picture_big || a.picture_medium, score: matchKey(a.name) === k ? 2 : similarity(matchKey(a.name), k) }))
    .sort((a, b) => b.score - a.score);
  return { photos, albums };
}

/**
 * Sets the artist's image: `preferredUrl` (the picture shown in the search list) if given,
 * otherwise an exactly matching artist photo, otherwise the newest jacket.
 */
export async function autoArtistPhoto(artistId, preferredUrl) {
  const artist = state.artists.get(artistId);
  if (!artist || artist.photoId || !navigator.onLine) return;
  let url = preferredUrl;
  if (!url) {
    const { photos, albums } = await photoCandidates(artist);
    url = photos.find(p => p.score >= 0.8)?.url || albums[0];
  }
  if (url) await setArtistPhotoFromUrl(artistId, url);
}

export async function setArtistPhotoFromUrl(artistId, url) {
  const blob = await compressImage(url, 600, 0.85);
  await setArtistPhoto(artistId, blob);
}

export async function setArtistPhoto(artistId, blob) {
  const artist = state.artists.get(artistId);
  const old = artist.photoId;
  artist.photoId = await savePhoto(blob);
  await saveArtist(artist);
  if (old) await deletePhoto(old);
}

/* ---------- venues ---------- */

export async function searchPlaces(q, signal) {
  const j = await getJson(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=6&bbox=122,20,154,46`, signal);
  return j.features
    .filter(f => f.properties.countrycode === 'JP' && f.properties.name)
    .map(f => ({
      name: f.properties.name,
      area: [f.properties.state, f.properties.city].filter(Boolean).join(' '),
      lat: f.geometry.coordinates[1],
      lon: f.geometry.coordinates[0],
    }));
}

// Well-known venues, suggested even offline before you have any history.
export const KNOWN_VENUES = [
  '東京ドーム', '日本武道館', '横浜アリーナ', 'さいたまスーパーアリーナ', '有明アリーナ', '東京ガーデンシアター',
  '国立代々木競技場 第一体育館', '幕張メッセ', 'ぴあアリーナMM', 'Kアリーナ横浜', 'LaLa arena TOKYO-BAY',
  '武蔵野の森総合スポーツプラザ', '東京国際フォーラム ホールA', 'NHKホール', '東京体育館', '日比谷野外大音楽堂',
  '両国国技館', 'LINE CUBE SHIBUYA', 'TOKYO DOME CITY HALL', '日本青年館ホール', '昭和女子大学 人見記念講堂',
  'Zepp Haneda (TOKYO)', 'Zepp DiverCity (TOKYO)', 'Zepp Shinjuku (TOKYO)', 'KT Zepp Yokohama', 'Zepp Osaka Bayside',
  'Zepp Namba (OSAKA)', 'Zepp Nagoya', 'Zepp Fukuoka', 'Zepp Sapporo', '豊洲PIT', 'Spotify O-EAST', 'Spotify O-WEST',
  'Spotify O-Crest', 'LIQUIDROOM', '恵比寿ザ・ガーデンホール', '渋谷CLUB QUATTRO', '渋谷WWW', '渋谷WWW X',
  '下北沢SHELTER', '新宿LOFT', '新宿BLAZE', 'ベルーナドーム', '横浜スタジアム', '味の素スタジアム', '日産スタジアム',
  'ZOZOマリンスタジアム', '京セラドーム大阪', '大阪城ホール', '大阪城音楽堂', 'フェスティバルホール', 'なんばHatch',
  '梅田CLUB QUATTRO', 'BIGCAT', 'インテックス大阪', 'ロームシアター京都', 'GLION ARENA KOBE', '神戸ワールド記念ホール',
  'バンテリンドーム ナゴヤ', '日本ガイシホール', 'Aichi Sky Expo', '名古屋国際会議場 センチュリーホール', 'DIAMOND HALL',
  'みずほPayPayドーム福岡', 'マリンメッセ福岡', '福岡サンパレス', '大和ハウス プレミストドーム', '北海きたえーる',
  '真駒内セキスイハイムアイスアリーナ', '宮城セキスイハイムスーパーアリーナ', '仙台GIGS', '広島グリーンアリーナ', 'エコパアリーナ',
];
