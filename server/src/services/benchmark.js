import { listExemplars, retrieve } from './ragStore.js';
import { cosine } from './embeddings.js';
import { analyzeQuestion } from './ensemble.js';
import { analysisContext } from './registry.js';
import { db } from '../store.js';
import { nanoid } from 'nanoid';

const COLLECTION = 'benchmarks';

function round3(n) {
  return Math.round(n * 1000) / 1000;
}

function retrievalBenchmark(exemplars) {
  if (exemplars.length < 2) return { avgSimilarity: 0, perItem: [], coverage: 0 };

  const perItem = [];
  for (const ex of exemplars) {
    const sims = exemplars
      .filter((o) => o.id !== ex.id)
      .map((o) => cosine(ex.embedding, o.embedding))
      .sort((a, b) => b - a);
    const topK = sims.slice(0, Math.min(4, sims.length));
    const avgScore = topK.length
      ? topK.reduce((s, v) => s + v, 0) / topK.length
      : 0;

    perItem.push({
      id: ex.id,
      stem: (ex.stem || '').slice(0, 120),
      verdict: ex.verdict,
      retrievedCount: topK.length,
      avgSimilarity: round3(avgScore),
      topSimilarity: round3(topK[0] || 0),
    });
  }

  const avgSimilarity = round3(
    perItem.reduce((s, p) => s + p.avgSimilarity, 0) / perItem.length,
  );
  const coverage = Math.round(
    (perItem.filter((p) => p.topSimilarity > 0.5).length / perItem.length) *
      100,
  );

  return { avgSimilarity, coverage, perItem };
}

function learningCurve(exemplars) {
  if (exemplars.length < 4) return [];

  const sizes = [];
  for (let s = 2; s < exemplars.length; s *= 2) sizes.push(s);
  sizes.push(exemplars.length);

  const points = [];
  for (const size of sizes) {
    const subset = exemplars.slice(0, size);
    let totalSim = 0;
    let count = 0;

    for (let i = 0; i < subset.length; i++) {
      const sims = [];
      for (let j = 0; j < subset.length; j++) {
        if (i === j) continue;
        sims.push(cosine(subset[i].embedding, subset[j].embedding));
      }
      sims.sort((a, b) => b - a);
      const topK = sims.slice(0, Math.min(4, sims.length));
      if (topK.length > 0) {
        totalSim += topK.reduce((s, v) => s + v, 0) / topK.length;
        count++;
      }
    }

    points.push({
      size,
      avgRetrievalScore: count ? round3(totalSim / count) : 0,
    });
  }

  return points;
}

async function deepBenchmark(examId, exemplars, sampleSize = 8) {
  const ctx = await analysisContext(examId);
  const sample = exemplars.slice(
    0,
    Math.min(sampleSize, exemplars.length),
  );

  const results = [];
  for (const ex of sample) {
    const question = {
      id: ex.id,
      number: 1,
      passage: ex.passage || '',
      stem: ex.stem || '',
      options: ex.options || [],
      answerKey: ex.answerKey || '',
    };

    const exemplarsForRag = await retrieve(
      examId,
      `${ex.passage} ${ex.stem}`,
      4,
      ex.id,
    );

    let withRag, withoutRag;
    try {
      [withRag, withoutRag] = await Promise.all([
        analyzeQuestion(question, {
          exam: ctx.exam,
          rubric: ctx.rubric,
          exemplars: exemplarsForRag,
          modelId: ctx.modelId,
        }),
        analyzeQuestion(question, {
          exam: ctx.exam,
          rubric: ctx.rubric,
          exemplars: [],
          modelId: ctx.modelId,
        }),
      ]);
    } catch {
      continue;
    }

    results.push({
      id: ex.id,
      stem: (ex.stem || '').slice(0, 120),
      markedKey: ex.answerKey,
      withRag: {
        score: withRag.verdict.score,
        status: withRag.verdict.status,
        modelAnswer: withRag.keyIntegrity.modelAnswer,
        keyCorrect: withRag.keyIntegrity.modelAnswer === ex.answerKey,
      },
      withoutRag: {
        score: withoutRag.verdict.score,
        status: withoutRag.verdict.status,
        modelAnswer: withoutRag.keyIntegrity.modelAnswer,
        keyCorrect:
          withoutRag.keyIntegrity.modelAnswer === ex.answerKey,
      },
      ragLift: withRag.verdict.score - withoutRag.verdict.score,
    });
  }

  if (results.length === 0) return null;

  return {
    sampleSize: results.length,
    avgRagLift: round3(
      results.reduce((s, r) => s + r.ragLift, 0) / results.length,
    ),
    keyAccuracyWithRag: Math.round(
      (results.filter((r) => r.withRag.keyCorrect).length /
        results.length) *
        100,
    ),
    keyAccuracyWithoutRag: Math.round(
      (results.filter((r) => r.withoutRag.keyCorrect).length /
        results.length) *
        100,
    ),
    perItem: results,
  };
}

export async function runBenchmark(examId, { deep = false } = {}) {
  const exemplars = await listExemplars(examId);
  if (exemplars.length < 2) {
    throw new Error(
      'Need at least 2 training exemplars to benchmark.',
    );
  }

  const retrieval = retrievalBenchmark(exemplars);
  const curve = learningCurve(exemplars);
  let deepResult = null;
  if (deep) deepResult = await deepBenchmark(examId, exemplars);

  const result = {
    id: `bm-${nanoid(8)}`,
    examId,
    exemplarCount: exemplars.length,
    verdictBreakdown: {
      approved: exemplars.filter((e) => e.verdict === 'approved')
        .length,
      rejected: exemplars.filter((e) => e.verdict === 'rejected')
        .length,
    },
    retrieval,
    learningCurve: curve,
    deep: deepResult,
    createdAt: new Date().toISOString(),
  };

  await db.insert(COLLECTION, result);
  return result;
}

export async function getLatestBenchmark(examId) {
  const all = await db.filter(
    COLLECTION,
    (b) => b.examId === examId,
  );
  if (all.length === 0) return null;
  return all.sort((a, b) =>
    a.createdAt < b.createdAt ? 1 : -1,
  )[0];
}
