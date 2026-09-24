// Converts between a setlist and the plain text used by the bulk editor
// (text copied from a setlist image with iPhone's Live Text, a web page, etc.).
import { KIND_LABEL } from './components.js';

const MARKER_RE = /^(MC|EN|ENCORE|アンコール|SE|VCR|映像)\s*\d*\s*(?::\s*(.*))?$/i;
const KIND_OF = { MC: 'mc', EN: 'en', ENCORE: 'en', アンコール: 'en', SE: 'se', VCR: 'vcr', 映像: 'vcr' };

export function parseSetlist(text) {
  const items = [];
  for (const raw of text.split(/\r?\n/)) {
    // Drop leading numbering like "1.", "01 ", "M1", "M-3)".
    const line = raw
      .normalize('NFKC')
      .trim()
      .replace(/^(?:M\s?-?\s?)?\d{1,3}(?:\s*[.):、]\s*|\s+)/i, '')
      .trim();
    if (!line) continue;
    const bare = line.replace(/^[-–—~〜*・[(<【「]+|[-–—~〜*・\])>】」]+$/g, '').trim();
    const m = bare.match(MARKER_RE);
    if (m) items.push({ kind: KIND_OF[m[1].toUpperCase()], title: (m[2] || '').trim(), artist: '' });
    else items.push({ kind: 'song', title: line, artist: '' });
  }
  return items;
}

export function formatSetlist(items) {
  return items
    .map(it => (it.kind === 'song' ? it.title : KIND_LABEL[it.kind] + (it.title ? `: ${it.title}` : '')))
    .filter(s => s.trim())
    .join('\n');
}
