import { nanoid } from 'nanoid';
import { extractPdf } from './pdf.js';

/**
 * Parsing layer: converts raw uploads (PDF / TXT / JSON / CSV) into a
 * canonical question shape. Parsing is intentionally separate from analysis —
 * this module never judges quality, it only structures content.
 *
 * Canonical question:
 * { id, number, passage, stem, options:[{key,text}], answerKey, raw }
 */

const NOISE_PATTERNS = [
  /android app|ios app|pw website/i,
  /scan the qr code/i,
  /^\s*page\s*\d+\s*(of\s*\d+)?\s*$/i,
  /^\s*\d+\s*\|\s*p\s*a\s*g\s*e\s*$/i,
  /copyright|all rights reserved/i,
];

function cleanLine(line) {
  const l = line.replace(/\s+/g, ' ').trim();
  if (!l) return '';
  if (NOISE_PATTERNS.some((re) => re.test(l))) return '';
  return l;
}

/**
 * Build a map of question-number -> answer key from a solutions/answer-key text.
 */
export function extractAnswersMap(answerKeyText) {
  const map = {};
  if (!answerKeyText) return map;

  // "Q1 (B)", "10. (C)", "Q 12 - D"
  for (const m of answerKeyText.matchAll(
    /(?:q(?:uestion)?\.?\s*)?(\d{1,3})\s*[).:\-]?\s*[([]?\s*([A-Da-d])\s*[)\]]?/g,
  )) {
    // Only accept when it reads like an answer token (single letter, isolated).
    const num = parseInt(m[1], 10);
    const ans = m[2].toUpperCase();
    if (num > 0 && num < 1000) map[num] = ans;
  }

  // "Correct Answer: (D)" following a "Q12." marker.
  const lines = answerKeyText.split('\n');
  let lastNum = null;
  for (const line of lines) {
    const q = line.match(/(?:q(?:uestion)?\.?\s*)(\d{1,3})\b/i);
    if (q) lastNum = parseInt(q[1], 10);
    const a = line.match(/correct\s*(?:answer|option|ans)\s*[:.\-]?\s*[([]?\s*([A-Da-d])\b/i);
    if (a && lastNum !== null) map[lastNum] = a[1].toUpperCase();
  }
  return map;
}

/**
 * Split lines where two-column PDF extraction merged left+right column text
 * on the same line, producing patterns like "...end of left text Q15 start of right text".
 * Only splits at Q-patterns that look like actual question markers (followed by
 * enough text to be a stem), not at "Q1" meaning "Quarter 1" in data tables.
 */
function splitMergedColumns(lines) {
  const out = [];
  // Q followed by number, then at least one letter-word (not just numbers/units).
  const qStemPattern = /Q\s*\d+\s+[A-Za-z]{2,}/g;
  for (const line of lines) {
    const matches = [...line.matchAll(qStemPattern)];
    const midMatches = matches.filter((m) => m.index > 0);
    if (midMatches.length === 0) { out.push(line); continue; }
    let lastIdx = 0;
    for (const m of midMatches) {
      const before = line.substring(lastIdx, m.index).trim();
      if (before) out.push(before);
      lastIdx = m.index;
    }
    const tail = line.substring(lastIdx).trim();
    if (tail) out.push(tail);
  }
  return out;
}

/**
 * Detect whether text uses Q-prefixed question numbering (Q1, Q.2, Question 3)
 * vs bare-number numbering (1., 2), 3:).
 */
function detectQuestionFormat(lines) {
  let qPrefixed = 0;
  let bareNumbered = 0;
  for (const l of lines) {
    if (/^Q(?:uestion)?\.?\s*\d+/i.test(l)) qPrefixed++;
    else if (/^\d{1,3}\s*[.)]\s+\S/.test(l)) bareNumbered++;
  }
  return qPrefixed >= 3 ? 'q-prefix' : bareNumbered >= 5 ? 'bare' : 'auto';
}

/**
 * Parse freeform text into questions. Handles passages/scenarios, numbered
 * stems, inline and line-start options, and inline answer markers.
 */
export function parseQuestionsFromText(text) {
  if (!text || typeof text !== 'string') return [];
  const rawLines = text.split(/\r?\n/).map(cleanLine).filter(Boolean);

  // Pre-process: split lines where column merging put Q-patterns mid-line.
  const lines = splitMergedColumns(rawLines);
  const format = detectQuestionFormat(lines);

  const questions = [];
  let cur = null;
  let passage = '';
  let inPassage = false;

  const commit = () => {
    if (!cur) return;
    if (passage) cur.passage = passage.trim();
    if (cur.options.length === 0) cur.flags = ['no-options-detected'];
    questions.push(cur);
    cur = null;
    passage = '';
  };

  const pushOptions = (segment, target) => {
    const matches = [...segment.matchAll(/(?:^|\s)\(?([A-Da-d])[).\-]\s+/g)];
    for (let i = 0; i < matches.length; i++) {
      const key = matches[i][1].toUpperCase();
      const start = matches[i].index + matches[i][0].length;
      const end = i + 1 < matches.length ? matches[i + 1].index : segment.length;
      const optText = segment.slice(start, end).trim();
      if (optText && !target.some((o) => o.key === key)) {
        target.push({ key, text: optText });
      }
    }
    return matches.length;
  };

  const isQuestionStart = (line) => {
    // Q-prefixed: Q1, Q.2, Q 3, Question 4 — separator optional
    if (/^Q(?:uestion)?\.?\s*\d+\b/i.test(line)) return true;
    // Bare numbered: 1., 2), 3: — only when format suggests it
    if (format !== 'q-prefix' && /^\d{1,3}\s*[.):\-]\s+\S/.test(line)) {
      const num = parseInt(line.match(/^\d+/)[0], 10);
      // Avoid matching numbered sub-items (1-6 range) when Q-prefix questions exist
      if (format === 'auto' && num <= 6) return false;
      return true;
    }
    return false;
  };

  const extractQNumber = (line) => {
    const m = line.match(/^Q(?:uestion)?\.?\s*(\d+)/i) || line.match(/^(\d+)/);
    return m ? parseInt(m[1], 10) : null;
  };

  const stripQPrefix = (line) =>
    line.replace(/^Q(?:uestion)?\.?\s*\d+\s*[.):\-]?\s*/i, '')
      .replace(/^\d{1,3}\s*[.):\-]\s*/, '')
      .trim();

  for (const line of lines) {
    // Passage / scenario / directions block.
    if (/^(passage|scenario|context|case study|directions?\s*\(?\d)/i.test(line)) {
      commit();
      passage = line.replace(/^(passage|scenario|context|case study|directions?\s*\(?\d[^)]*\)?)\s*[:.\-]?\s*/i, '').trim();
      inPassage = true;
      continue;
    }

    const startsQ = isQuestionStart(line);
    const startsOptions = /^\(?[A-Da-d][).\-]\s+/.test(line);

    if (inPassage && !startsQ && !startsOptions) {
      passage += '\n' + line;
      continue;
    }

    if (startsQ) {
      inPassage = false;
      commit();
      const num = extractQNumber(line);
      const stem = stripQPrefix(line);
      cur = {
        id: `q-${nanoid(8)}`,
        number: num || questions.length + 1,
        passage: '',
        stem,
        options: [],
        answerKey: '',
        raw: line,
      };
      // Inline options on the stem line.
      const optIdx = stem.search(/\(?[A-D][).\-]\s+/);
      if (optIdx > 0) {
        cur.stem = stem.slice(0, optIdx).trim();
        pushOptions(stem.slice(optIdx), cur.options);
      }
      continue;
    }

    if (!cur) continue;

    // Answer marker.
    const ans = line.match(/(?:correct\s*)?(?:answer|ans|key|option)\s*[:.\-]?\s*[([]?\s*([A-Da-d])\b/i);
    if (ans) {
      cur.answerKey = ans[1].toUpperCase();
      const residue = line.replace(ans[0], '').trim();
      if (!residue) continue;
    }

    // Options (line-start, possibly several on one line).
    if (startsOptions || /\(?[A-D][).\-]\s+/.test(line)) {
      const n = pushOptions(line, cur.options);
      if (n > 0) continue;
    }

    // Otherwise, continuation of the stem.
    cur.stem = (cur.stem + ' ' + line).trim();
  }
  commit();

  // De-duplicate: if the same question number appears multiple times, keep the
  // one with the most options (likely the real question, not a data-table artefact).
  const byNum = new Map();
  for (const q of questions) {
    if (!q.stem || q.stem.length <= 3) continue;
    const existing = byNum.get(q.number);
    if (!existing || q.options.length > existing.options.length || (q.options.length === existing.options.length && q.stem.length > existing.stem.length)) {
      byNum.set(q.number, q);
    }
  }
  return [...byNum.values()].sort((a, b) => a.number - b.number);
}

export function parseQuestionsFromJSON(jsonString) {
  const data = JSON.parse(jsonString);
  const arr = Array.isArray(data) ? data : data.questions || [];
  return arr.map((q, idx) => {
    let options = [];
    if (Array.isArray(q.options)) {
      options = q.options.map((opt, i) => {
        if (typeof opt === 'string') {
          const m = opt.match(/^\s*\(?([A-Da-d])[).\-]\s*(.*)$/);
          return m
            ? { key: m[1].toUpperCase(), text: m[2].trim() }
            : { key: String.fromCharCode(65 + i), text: opt.trim() };
        }
        return { key: opt.key || String.fromCharCode(65 + i), text: opt.text || '' };
      });
    }
    return {
      id: q.id || `q-${nanoid(8)}`,
      number: q.number || idx + 1,
      passage: q.passage || q.context || '',
      stem: q.stem || q.questionText || q.question || '',
      options,
      answerKey: (q.answerKey || q.correctAnswer || q.answer || '').toString().toUpperCase().slice(0, 1),
      raw: JSON.stringify(q),
    };
  });
}

function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === ',' && !quoted) {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

export function parseQuestionsFromCSV(csv) {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]).map((h) => h.toLowerCase());
  const col = (names) => headers.findIndex((h) => names.some((n) => h.includes(n)));
  const iQ = col(['question', 'stem']);
  const iA = col(['option a', 'a)']);
  const iB = col(['option b', 'b)']);
  const iC = col(['option c', 'c)']);
  const iD = col(['option d', 'd)']);
  const iAns = col(['answer', 'correct', 'key']);
  const iPassage = col(['passage', 'context']);

  return lines.slice(1).map((line, idx) => {
    const cells = splitCsvLine(line);
    const options = [];
    [
      [iA, 'A'],
      [iB, 'B'],
      [iC, 'C'],
      [iD, 'D'],
    ].forEach(([i, key]) => {
      if (i >= 0 && cells[i]) options.push({ key, text: cells[i] });
    });
    return {
      id: `q-${nanoid(8)}`,
      number: idx + 1,
      passage: iPassage >= 0 ? cells[iPassage] || '' : '',
      stem: iQ >= 0 ? cells[iQ] || '' : cells[0] || '',
      options,
      answerKey: iAns >= 0 ? (cells[iAns] || '').toUpperCase().slice(0, 1) : '',
      raw: line,
    };
  }).filter((q) => q.stem);
}

/**
 * Top-level dispatcher. Returns { questions, meta }.
 */
export async function parseDocument({ buffer, filename }, onProgress) {
  const name = (filename || '').toLowerCase();
  const ext = name.split('.').pop();

  if (ext === 'pdf') {
    const extracted = await extractPdf(buffer, onProgress);
    const questions = parseQuestionsFromText(extracted.questionText || extracted.fullText);
    const answers = extractAnswersMap(extracted.answerKeyText);
    // Align keys by sequential question number.
    questions.forEach((q, idx) => {
      const byNum = answers[q.number] || answers[idx + 1];
      if (byNum && !q.answerKey) q.answerKey = byNum;
    });
    return {
      questions,
      meta: {
        format: 'pdf',
        pageCount: extracted.pageCount,
        charCount: extracted.fullText.length,
        hasAnswerKey: Object.keys(answers).length > 0,
        pages: extracted.pages,
      },
    };
  }

  const text = buffer.toString('utf8');
  if (ext === 'json') {
    return { questions: parseQuestionsFromJSON(text), meta: { format: 'json' } };
  }
  if (ext === 'csv') {
    return { questions: parseQuestionsFromCSV(text), meta: { format: 'csv' } };
  }
  return { questions: parseQuestionsFromText(text), meta: { format: 'txt', charCount: text.length } };
}
