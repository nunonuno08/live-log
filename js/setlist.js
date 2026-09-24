// Turns pasted text or text read from a setlist photo into setlist entries, matching
// each line against the artist's known songs so OCR mistakes and spelling
// differences still land on the right song.
import { songKey, matchKey, similarity } from './util.js';

const ENCORE_RE = /^(?:en|encore|アンコール|w\s?en|wアンコール|ダブルアンコール|double encore)\d*$/i;
const SKIP_RE = /^(?:mc|se|vcr|映像|opening|ending|intro|outro)\d*$/i;
// Headings such as "SETLIST 2026.07.15" or a bare date.
const HEADING_RE = /^(?:set\s?list|セットリスト|セトリ)|^\d{2,4}[./年-]\d{1,2}[./月-]\d{1,2}/i;

/** Lines -> [{ kind: 'en' } | { kind: 'song', raw }]. Numbering like "1.", "M3", "03" is removed. */
export function parseLines(text) {
  const out = [];
  for (const rawLine of String(text).split(/\r?\n/)) {
    let line = rawLine
      .normalize('NFKC')
      .trim()
      .replace(/^(?:M\s?-?\s?)?\d{1,3}(?:\s*[.):、]\s*|\s+)/i, '')
      .trim();
    // OCR puts spaces between Japanese characters.
    line = line.replace(/([々぀-ヿ㐀-鿿])\s+(?=[々぀-ヿ㐀-鿿])/g, '$1');
    const bare = line.replace(/^[-–—~〜*・_=<>[\](){}【】「」]+|[-–—~〜*・_=<>[\](){}【】「」]+$/g, '').trim();
    if (!bare) continue;
    if (ENCORE_RE.test(bare.replace(/\s+/g, ' '))) {
      if (out.length && out.at(-1).kind !== 'en') out.push({ kind: 'en' });
      continue;
    }
    if (SKIP_RE.test(bare) || HEADING_RE.test(bare)) continue;
    if (matchKey(bare).length < 1) continue;
    out.push({ kind: 'song', raw: bare });
  }
  return out;
}

/**
 * Finds the best known song for a line. `candidates` = [{ title, key, artistId, songId?, artwork? }].
 * Returns { candidate, score } where score 1 = exact.
 */
export function bestMatch(raw, candidates) {
  const k = songKey(raw);
  let best = null;
  let score = 0;
  for (const c of candidates) {
    const s = c.key === k ? 1 : similarity(k, c.key);
    if (s > score) {
      score = s;
      best = c;
    }
  }
  return { candidate: best, score };
}

/* ---------- reading a photo ---------- */

let tesseractLoading;
function loadTesseract() {
  tesseractLoading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@7/dist/tesseract.min.js';
    s.onload = () => resolve(window.Tesseract);
    s.onerror = () => {
      tesseractLoading = null;
      reject(new Error('読み取り機能を読み込めませんでした（初回はネット接続が必要です）'));
    };
    document.head.append(s);
  });
  return tesseractLoading;
}

// Only shrinks very large photos (for speed). Upscaling or contrast tricks made
// Tesseract read kanji worse in testing, so the image is otherwise left as is.
function prepare(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, 2400 / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * scale);
      c.height = Math.round(img.naturalHeight * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      resolve(c);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('画像を読み込めませんでした'));
    };
    img.src = url;
  });
}

/**
 * Reads a setlist photo on the phone itself (nothing is uploaded; the first use downloads
 * the reading data). Two passes: Japanese-only reads kanji best, Japanese+English reads
 * symbols like "!!!" best. Returns both texts; `pickLines` combines them.
 */
export async function readImageTexts(file, onProgress) {
  const Tesseract = await loadTesseract();
  const image = await prepare(file);
  const texts = [];
  const passes = [['jpn'], ['eng', 'jpn']];
  for (const [i, langs] of passes.entries()) {
    onProgress?.('読み取りデータを準備中…（初回は少し時間がかかります）');
    const worker = await Tesseract.createWorker(langs, 1, {
      logger: m => m.status === 'recognizing text' && onProgress?.(`読み取り中… ${Math.round(((i + m.progress) / passes.length) * 100)}%`),
    });
    try {
      texts.push((await worker.recognize(image)).data.text);
    } finally {
      await worker.terminate();
    }
  }
  return texts;
}

/** Line by line, keeps whichever reading matches a known song better. */
export function pickLines(texts, candidates) {
  const [a, b] = texts.map(parseLines);
  if (!b || a.length !== b.length || a.some((x, i) => x.kind !== b[i].kind)) return a;
  return a.map((x, i) => {
    if (x.kind !== 'song') return x;
    return bestMatch(b[i].raw, candidates).score > bestMatch(x.raw, candidates).score ? b[i] : x;
  });
}
