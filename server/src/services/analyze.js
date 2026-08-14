import { nanoid } from 'nanoid';
import { db } from '../store.js';
import { analyzeQuestion } from './ensemble.js';
import { analysisContext } from './registry.js';
import { retrieve } from './ragStore.js';

/** Run async mapper over items with bounded concurrency. */
async function mapLimit(items, limit, fn, onEach) {
  const results = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx], idx);
      if (onEach) onEach(idx + 1, items.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function summarize(results) {
  const counts = { pass: 0, review: 0, fail: 0 };
  const difficulty = { Easy: 0, Medium: 0, Hard: 0 };
  const topics = {};
  const flagTally = {};
  let keyMismatches = 0;
  let scoreSum = 0;

  for (const r of results) {
    counts[r.verdict.status] = (counts[r.verdict.status] || 0) + 1;
    difficulty[r.difficulty.level] = (difficulty[r.difficulty.level] || 0) + 1;
    if (r.alignment.topic) topics[r.alignment.topic] = (topics[r.alignment.topic] || 0) + 1;
    if (!r.keyIntegrity.agreesWithKey) keyMismatches++;
    r.flags.forEach((f) => (flagTally[f] = (flagTally[f] || 0) + 1));
    scoreSum += r.verdict.score;
  }

  return {
    total: results.length,
    verdictCounts: counts,
    difficulty,
    topics,
    flagTally,
    keyMismatches,
    avgQuality: results.length ? Math.round(scoreSum / results.length) : 0,
    passRate: results.length ? Math.round((counts.pass / results.length) * 100) : 0,
    needsReview: counts.review + counts.fail,
  };
}

/**
 * Analyse a full document's questions for one exam. Persists and returns the
 * report. `onProgress(done,total,phase)` streams progress to callers.
 */
export async function analyzeDocument({ examId, fileName, format, questions, meta }, onProgress) {
  const ctx = await analysisContext(examId);

  const results = await mapLimit(
    questions,
    4,
    async (q) => {
      const exemplars = await retrieve(examId, `${q.passage} ${q.stem}`, 4);
      return analyzeQuestion(q, { exam: ctx.exam, rubric: ctx.rubric, exemplars, modelId: ctx.modelId });
    },
    (done, total) => onProgress && onProgress(done, total, 'analyzing'),
  );

  const summary = summarize(results);
  const now = new Date().toISOString();
  const modes = [...new Set(results.map((r) => r.mode))];
  const record = {
    id: `an-${nanoid(8)}`,
    examId,
    examName: ctx.exam?.name || 'Unassigned',
    fileName: fileName || 'Untitled',
    format: format || meta?.format || 'text',
    questionCount: questions.length,
    summary,
    results,
    meta,
    mode: modes.includes('ensemble') ? 'ensemble' : modes[0] || 'structural-only',
    usedTunedModel: Boolean(ctx.modelId),
    createdAt: now,
  };
  await db.insert('analyses', record);
  return record;
}

export async function listAnalyses() {
  const all = await db.all('analyses');
  return all
    .map(({ results, ...rest }) => ({ ...rest, resultCount: results?.length || 0 }))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function getAnalysis(id) {
  return db.find('analyses', (a) => a.id === id);
}

export async function deleteAnalysis(id) {
  return db.remove('analyses', id);
}
