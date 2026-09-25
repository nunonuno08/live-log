// Draws a live as a portrait "setlist card" (1080x1920, story size) for sharing on social media.
import { state, liveTitle, artistName, venueName, isPast, playCounts, photoUrl } from './store.js';
import { fmtDate } from './util.js';

const W = 1080;
const H = 1920;
const PAD = 84;
const FONT = '-apple-system, "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", "Yu Gothic UI", sans-serif';
const INK = '#f4f1ea';
const MUTED = '#a8a296';
const ACCENT = '#ff6547';
const BG = '#121113';

const font = (weight, size) => `${weight} ${size}px ${FONT}`;

function loadImage(url) {
  return new Promise(resolve => {
    if (!url) return resolve(null);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

// Breaks text into lines that fit `width` (character by character, so Japanese wraps too).
function wrap(ctx, text, width, maxLines) {
  const lines = [];
  let line = '';
  for (const ch of text) {
    if (ctx.measureText(line + ch).width > width && line) {
      lines.push(line);
      line = ch.trim() ? ch : '';
      if (lines.length === maxLines) break;
    } else line += ch;
  }
  if (lines.length < maxLines && line) lines.push(line);
  if (lines.length === maxLines && lines.join('').length < text.length) {
    let last = lines[maxLines - 1];
    while (last && ctx.measureText(last + '…').width > width) last = last.slice(0, -1);
    lines[maxLines - 1] = last + '…';
  }
  return lines;
}

function fit(ctx, text, width) {
  if (ctx.measureText(text).width <= width) return text;
  let t = text;
  while (t && ctx.measureText(t + '…').width > width) t = t.slice(0, -1);
  return t + '…';
}

function drawCover(ctx, img, x, y, w, h) {
  const s = Math.max(w / img.width, h / img.height);
  const sw = w / s;
  const sh = h / s;
  ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, x, y, w, h);
}

/** PNG blob of the setlist card for `live`. */
export async function liveCard(live) {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);

  // Photo on top, fading into the background.
  const photoId = live.photoIds?.[0] || state.artists.get(live.artistIds[0])?.photoId;
  const img = await loadImage(photoId ? await photoUrl(photoId) : null);
  const photoH = 820;
  if (img) {
    drawCover(ctx, img, 0, 0, W, photoH);
    const g = ctx.createLinearGradient(0, photoH * 0.35, 0, photoH);
    g.addColorStop(0, 'rgba(18,17,19,0)');
    g.addColorStop(1, BG);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, photoH);
  }

  // Heading (with a soft shadow so it stays readable over bright photos).
  let y = img ? photoH - 250 : 180;
  ctx.textBaseline = 'alphabetic';
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = 18;
  ctx.fillStyle = ACCENT;
  ctx.font = font(800, 40);
  ctx.fillText(fmtDate(live.date), PAD, y);
  y += 26;
  ctx.fillStyle = INK;
  ctx.font = font(900, 76);
  for (const line of wrap(ctx, liveTitle(live), W - PAD * 2, 2)) {
    y += 88;
    ctx.fillText(line, PAD, y);
  }
  const sub = [live.artistIds.map(artistName).join(' / '), venueName(live.venueId)].filter(Boolean).join('  ·  ');
  ctx.fillStyle = MUTED;
  ctx.font = font(700, 36);
  y += 64;
  ctx.fillText(fit(ctx, sub, W - PAD * 2), PAD, y);
  ctx.shadowBlur = 0;
  ctx.shadowColor = 'transparent';

  // Setlist.
  const counts = playCounts().get(live.id) || [];
  const past = isPast(live);
  // Several artists: a heading where the artist changes; each artist has its own numbering.
  const multi = live.artistIds.length > 1;
  const rows = [];
  let n = 0;
  const perArtist = new Map();
  let total = 0;
  let current = null;
  (live.setlist || []).forEach((it, i) => {
    if (it.kind === 'en') return rows.push({ encore: true });
    const song = state.songs.get(it.songId);
    if (!song) return;
    if (multi && song.artistId !== current) {
      current = song.artistId;
      n = perArtist.get(current) || 0;
      rows.push({ group: artistName(song.artistId) });
    }
    total++;
    rows.push({ no: ++n, title: song.title, first: past && counts[i] === 1 });
    perArtist.set(current, n);
  });

  y += 70;
  ctx.fillStyle = ACCENT;
  ctx.fillRect(PAD, y, 64, 6);
  ctx.font = font(900, 30);
  ctx.fillStyle = INK;
  ctx.fillText('SETLIST', PAD + 84, y + 12);
  y += 50;

  const top = y;
  const bottom = H - 150;
  // One column while it fits at a readable size, otherwise two; short setlists get bigger text.
  const columns = rows.length * 56 <= bottom - top ? 1 : 2;
  const perColumn = Math.ceil(rows.length / columns);
  const rowH = Math.min(84, (bottom - top) / Math.max(perColumn, 1));
  const size = Math.max(22, Math.min(50, rowH * 0.6));
  const colW = (W - PAD * 2 - (columns - 1) * 40) / columns;
  rows.forEach((r, i) => {
    const col = Math.floor(i / perColumn);
    const x = PAD + col * (colW + 40);
    const ry = top + (i % perColumn) * rowH + rowH * 0.72;
    if (r.encore) {
      ctx.fillStyle = ACCENT;
      ctx.font = font(900, size * 0.7);
      ctx.fillText('— ENCORE —', x, ry);
      return;
    }
    if (r.group) {
      ctx.fillStyle = ACCENT;
      ctx.font = font(900, size * 0.78);
      ctx.fillText(fit(ctx, r.group, colW), x, ry);
      return;
    }
    ctx.fillStyle = MUTED;
    ctx.font = font(800, size * 0.8);
    const no = String(r.no).padStart(2, '0');
    ctx.fillText(no, x, ry);
    const tx = x + size * 1.7;
    ctx.fillStyle = INK;
    ctx.font = font(700, size);
    const maxW = colW - size * 1.7 - (r.first ? size * 1.4 : 0);
    const title = fit(ctx, r.title, maxW);
    ctx.fillText(title, tx, ry);
    if (r.first) {
      const bx = tx + ctx.measureText(title).width + size * 0.35;
      ctx.fillStyle = '#f0b43c';
      ctx.font = font(900, size * 0.62);
      ctx.fillText('初', bx, ry - size * 0.05);
    }
  });

  // Footer.
  const firsts = rows.filter(r => r.first).length;
  ctx.fillStyle = MUTED;
  ctx.font = font(700, 28);
  ctx.fillText(`${total}曲${firsts ? `  ·  初めて聴いた曲 ${firsts}` : ''}`, PAD, H - 80);
  ctx.textAlign = 'right';
  ctx.fillStyle = ACCENT;
  ctx.font = font(900, 28);
  ctx.fillText('LIVE LOG', W - PAD, H - 80);
  ctx.textAlign = 'left';

  return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
}
