const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ESC[c]);

export const uid = () =>
  crypto.randomUUID?.() ?? Date.now().toString(36) + Math.random().toString(36).slice(2);

const pad = n => String(n).padStart(2, '0');

export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const WEEKDAYS = '日月火水木金土';

function toDate(date) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export const weekday = date => WEEKDAYS[toDate(date).getDay()];

export function fmtDate(date, withWeekday = true) {
  if (!date) return '';
  const s = date.replaceAll('-', '.');
  return withWeekday ? `${s} (${weekday(date)})` : s;
}

export function daysUntil(date) {
  const now = new Date();
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((toDate(date) - base) / 86400000);
}

export function addMinutes(time, minutes) {
  const [h, m] = time.split(':').map(Number);
  const t = (h * 60 + m + minutes + 1440) % 1440;
  return `${pad(Math.floor(t / 60))}:${pad(t % 60)}`;
}

export const yen = n => '¥' + Math.round(Number(n) || 0).toLocaleString('ja-JP');

export function hue(s) {
  let h = 0;
  for (const c of String(s)) h = (h * 31 + c.codePointAt(0)) % 360;
  return h;
}

/* ---------- matching ---------- */

const toHiragana = s => s.replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));

// "ＡＩＺＯ", "aizo", "A I Z O!" and "アイゾ"/"あいぞ" style variants all become the same key.
export const matchKey = s =>
  toHiragana(String(s ?? '').normalize('NFKC').toLowerCase()).replace(/[\s\p{P}\p{S}]/gu, '');

// Words that mark a recording variant rather than a different song.
const VERSION_RE =
  /ver\b|ver\.|version|バージョン|ヴァージョン|remaster|album|single|edit|mix|size|\btv\b|live|ライブ|acoustic|アコースティック|mono|stereo|bonus|short|full|original|オリジナル|inst|demo|session|take/i;
const BRACKETED = /\s*[([（【〔［][^)\]）】〕］]*[)\]）】〕］]/g;

const HAS_JAPANESE = /[぀-ヿ㐀-鿿]/;

/**
 * Title without "(ALBUM ver.)", " - Single Version", "feat. X" and similar suffixes. Japanese
 * titles also lose a trailing romanization / edition tag in plain ASCII, e.g. "燦然 - Sanzen"
 * or "ひたむき (AA1)", which is how some of them appear on iTunes.
 */
export function baseTitle(title) {
  let t = String(title ?? '').normalize('NFKC').trim();
  t = t.replace(/\s*[([]\s*(?:feat|ft|with)\.?\s[^)\]]*[)\]]/gi, '').replace(/\s+(?:feat|ft)\.?\s.*$/i, '');
  t = t.replace(BRACKETED, m => (VERSION_RE.test(m) ? '' : m));
  t = t.replace(/\s+[-–—~〜]\s+[^-–—~〜]*$/, m => (VERSION_RE.test(m) ? '' : m));
  const cut = t.replace(/\s*(?:[-–—~〜]\s*[\x20-\x7e]+|[([][\x20-\x7e]*[)\]])\s*$/, '');
  if (HAS_JAPANESE.test(cut) && cut !== t) t = cut;
  return t.trim() || String(title ?? '').trim();
}

export const songKey = title => matchKey(baseTitle(title)) || String(title ?? '').trim();

// Venues: "Zepp DiverCity (TOKYO)" and "Zepp DiverCity" are the same place.
export const venueKey = name => matchKey(String(name ?? '').normalize('NFKC').replace(BRACKETED, '')) || matchKey(name);

// Characters shared regardless of order, 0..1. Only meaningful for short titles.
function charOverlap(A, B) {
  const pool = [...B];
  let hit = 0;
  for (const c of A) {
    const i = pool.indexOf(c);
    if (i >= 0) {
      hit++;
      pool.splice(i, 1);
    }
  }
  return (2 * hit) / (A.length + B.length);
}

/**
 * 0..1 similarity of two keys (bigram Dice coefficient). Tolerates small typos and OCR mistakes;
 * short Japanese titles also count shared characters, so "雨爆々" still finds "雨燦々".
 */
export function similarity(a, b) {
  if (a === b) return 1;
  const A = [...a];
  const B = [...b];
  const short = Math.max(A.length, B.length) <= 4 && A.length >= 2 && B.length >= 2 ? charOverlap(A, B) * 0.85 : 0;
  if (A.length < 2 || B.length < 2) return 0;
  return Math.max(short, bigramDice(A, B));
}

function bigramDice(A, B) {
  const grams = new Map();
  for (let i = 0; i < A.length - 1; i++) {
    const g = A[i] + A[i + 1];
    grams.set(g, (grams.get(g) || 0) + 1);
  }
  let hit = 0;
  for (let i = 0; i < B.length - 1; i++) {
    const g = B[i] + B[i + 1];
    const n = grams.get(g);
    if (n) {
      hit++;
      grams.set(g, n - 1);
    }
  }
  return (2 * hit) / (A.length - 1 + B.length - 1);
}

/** How well `key` answers what the user typed (`q`, already a key). 0 = no match. */
export function matchScore(q, key) {
  if (!q) return 0;
  if (key === q) return 4;
  if (key.startsWith(q)) return 3;
  if (key.includes(q)) return 2;
  const s = similarity(q, key);
  return s >= 0.5 ? s : 0;
}

/* ---------- misc ---------- */

export const safeUrl = u => (/^https?:\/\//i.test(u || '') ? u : null);

let toastTimer;
export function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}

export function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// Shrinks a photo before storing it so it stays small on the phone and in the cloud later.
export function compressImage(file, max = 1600, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const url = typeof file === 'string' ? file : URL.createObjectURL(file);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (typeof file !== 'string') URL.revokeObjectURL(url);
      const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(b => (b ? resolve(b) : reject(new Error('画像の変換に失敗しました'))), 'image/jpeg', quality);
    };
    img.onerror = () => {
      if (typeof file !== 'string') URL.revokeObjectURL(url);
      reject(new Error('画像を読み込めませんでした'));
    };
    img.src = url;
  });
}

export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

// On iPhone the share sheet lets the user pick "ファイルに保存" etc. Falls back to a plain download.
// Returns false only when the user explicitly cancelled the share sheet.
export async function shareOrDownload(blob, filename) {
  const file = new File([blob], filename, { type: blob.type });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return true;
    } catch (e) {
      if (e.name === 'AbortError') return false;
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  return true;
}
