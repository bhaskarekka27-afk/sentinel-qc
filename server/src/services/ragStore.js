import { nanoid } from 'nanoid';
import { db } from '../store.js';
import { embed, cosine } from './embeddings.js';

/**
 * Per-exam exemplar store — the substrate of per-exam RAG retrieval.
 * Every approved training item becomes a retrievable exemplar carrying the
 * QC team's gold-standard judgement. At analysis time the most similar
 * exemplars for that exam are injected into the prompt (few-shot RAG).
 */
const COLLECTION = 'exemplars';

function exemplarText(item) {
  return [
    item.passage || '',
    item.stem || '',
    (item.options || []).map((o) => `${o.key}. ${o.text}`).join(' '),
  ]
    .filter(Boolean)
    .join('\n');
}

export async function addExemplar(examId, item) {
  const text = exemplarText(item);
  const { vector, method } = await embed(text);
  const doc = {
    id: `ex-${nanoid(8)}`,
    examId,
    passage: item.passage || '',
    stem: item.stem || '',
    options: item.options || [],
    answerKey: item.answerKey || '',
    verdict: item.verdict || 'approved',
    notes: item.notes || '',
    embedding: vector,
    embedMethod: method,
    createdAt: new Date().toISOString(),
  };
  await db.insert(COLLECTION, doc);
  return doc;
}

export async function countExemplars(examId) {
  const items = await db.filter(COLLECTION, (e) => e.examId === examId);
  return items.length;
}

export async function retrieve(examId, queryText, k = 4, excludeId = null) {
  const items = await db.filter(COLLECTION, (e) => e.examId === examId && e.id !== excludeId);
  if (items.length === 0) return [];
  const { vector } = await embed(queryText);
  return items
    .map((e) => ({ item: e, score: cosine(vector, e.embedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map(({ item, score }) => ({ ...item, score }));
}

/** All exemplars for an exam (used by the benchmark harness). */
export async function listExemplars(examId) {
  return db.filter(COLLECTION, (e) => e.examId === examId);
}

export async function removeExemplarsForExam(examId) {
  const items = await db.filter(COLLECTION, (e) => e.examId === examId);
  for (const it of items) await db.remove(COLLECTION, it.id);
  return items.length;
}
