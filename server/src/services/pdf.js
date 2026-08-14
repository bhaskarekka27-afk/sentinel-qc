import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);

/**
 * Server-side PDF text extraction using pdfjs-dist (legacy Node build).
 * Reconstructs reading order from glyph coordinates so that multi-column
 * exam layouts and separate answer-key pages come out accurately.
 */
let pdfjsLib = null;
async function getPdfjs() {
  if (pdfjsLib) return pdfjsLib;
  // Legacy build runs in Node without a browser worker.
  pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  try {
    // Node's ESM loader needs a file:// URL, not a bare Windows path.
    pdfjsLib.GlobalWorkerOptions.workerSrc = pathToFileURL(
      require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs'),
    ).href;
  } catch {
    /* worker optional in Node */
  }
  return pdfjsLib;
}

/**
 * Turn a page's text items into readable lines, honouring columns.
 * Items are grouped into rows by their Y coordinate, each row sorted by X,
 * then the page is split into columns when a consistent horizontal gap
 * exists (common in two-column question papers).
 */
function itemsToText(items, pageWidth) {
  const glyphs = items
    .filter((it) => it.str && it.str.trim())
    .map((it) => ({
      str: it.str,
      x: it.transform[4],
      y: it.transform[5],
      w: it.width || 0,
    }));
  if (glyphs.length === 0) return '';

  // Group into rows (same baseline within a tolerance).
  glyphs.sort((a, b) => b.y - a.y || a.x - b.x);
  const rows = [];
  let current = [];
  let lastY = null;
  for (const g of glyphs) {
    if (lastY === null || Math.abs(g.y - lastY) <= 3) {
      current.push(g);
    } else {
      rows.push(current);
      current = [g];
    }
    lastY = g.y;
  }
  if (current.length) rows.push(current);

  const mid = pageWidth / 2;
  const gapThreshold = pageWidth * 0.05;

  // Per-row: find the largest gap near the middle of the page.
  const rowGaps = rows.map((row) => {
    const sorted = [...row].sort((a, b) => a.x - b.x);
    let bestGap = 0;
    let bestIdx = -1;
    for (let i = 1; i < sorted.length; i++) {
      const gap = sorted[i].x - (sorted[i - 1].x + sorted[i - 1].w);
      const gapCenter = (sorted[i - 1].x + sorted[i - 1].w + sorted[i].x) / 2;
      if (gap > bestGap && gapCenter > pageWidth * 0.2 && gapCenter < pageWidth * 0.8) {
        bestGap = gap;
        bestIdx = i;
      }
    }
    return { gap: bestGap, idx: bestIdx, sorted };
  });

  const splitVotes = rowGaps.filter((r) => r.gap > gapThreshold).length;
  const twoColumn = splitVotes >= Math.min(3, rows.length * 0.12) && rows.length > 3;

  const renderGlyphs = (glyphList) => {
    const sorted = [...glyphList].sort((a, b) => a.x - b.x);
    let text = '';
    let prevEnd = null;
    for (const g of sorted) {
      if (prevEnd !== null) {
        const gap = g.x - prevEnd;
        if (gap > 1.5 && !text.endsWith(' ')) text += ' ';
      }
      text += g.str;
      prevEnd = g.x + g.w;
    }
    return text.trim();
  };

  if (!twoColumn) {
    return rows.map((r) => renderGlyphs(r)).filter(Boolean).join('\n');
  }

  // Two-column: split each row at its largest mid-page gap, then read left
  // column top-to-bottom followed by right column top-to-bottom.
  const left = [];
  const right = [];
  for (let i = 0; i < rows.length; i++) {
    const { gap, idx, sorted } = rowGaps[i];
    if (gap > gapThreshold && idx > 0) {
      const l = sorted.slice(0, idx);
      const r = sorted.slice(idx);
      if (l.length) left.push(renderGlyphs(l));
      if (r.length) right.push(renderGlyphs(r));
    } else {
      // No clear gap — assign entire row to the column containing the leftmost glyph.
      const minX = Math.min(...rows[i].map((g) => g.x));
      if (minX < mid) left.push(renderGlyphs(rows[i]));
      else right.push(renderGlyphs(rows[i]));
    }
  }
  return [...left, ...right].filter(Boolean).join('\n');
}

/**
 * Extract text from a PDF buffer, page by page, classifying each page as
 * question content vs. answer-key/solutions so answers can be aligned later.
 * @returns {Promise<{pageCount:number, questionText:string, answerKeyText:string, fullText:string, pages:Array}>}
 */
export async function extractPdf(buffer, onProgress) {
  const pdfjs = await getPdfjs();
  const data = new Uint8Array(buffer);
  const doc = await pdfjs.getDocument({
    data,
    useSystemFonts: true,
    isEvalSupported: false,
  }).promise;

  let questionText = '';
  let answerKeyText = '';
  let fullText = '';
  const pages = [];
  let reachedSolutions = false;

  for (let n = 1; n <= doc.numPages; n++) {
    if (onProgress) onProgress(n, doc.numPages);
    const page = await doc.getPage(n);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const text = itemsToText(content.items, viewport.width);
    const lower = text.toLowerCase();

    const isAnswerKey =
      /\banswer\s*key\b/.test(lower) ||
      /\bhints?\s*&?\s*solutions?\b/.test(lower) ||
      /\btext\s*solution\b/.test(lower);

    if (isAnswerKey) reachedSolutions = true;

    fullText += text + '\n';
    if (reachedSolutions) {
      answerKeyText += text + '\n';
      pages.push({ page: n, kind: 'solution' });
    } else {
      questionText += text + '\n';
      pages.push({ page: n, kind: 'questions' });
    }
  }

  await doc.destroy();
  return {
    pageCount: doc.numPages,
    questionText: questionText.trim(),
    answerKeyText: answerKeyText.trim(),
    fullText: fullText.trim(),
    pages,
  };
}
