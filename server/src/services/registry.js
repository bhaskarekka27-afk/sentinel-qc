import { nanoid } from 'nanoid';
import { db } from '../store.js';
import { config } from '../config.js';
import { countExemplars } from './ragStore.js';

/**
 * Exam registry. Each exam is a self-contained content category with its OWN
 * model: a Gemini tuned-model id (once trained) and a Claude RAG exemplar
 * store, plus a QC rubric that calibrates both engines for that vertical.
 */
const COLLECTION = 'exams';

const DEFAULT_EXAMS = [
  {
    slug: 'clat',
    name: 'CLAT — Common Law Admission Test',
    description: 'Legal reasoning, logical reasoning, English, GK, quantitative techniques.',
    topics: ['Legal Reasoning', 'Logical Reasoning', 'English Language', 'Current Affairs & GK', 'Quantitative Techniques'],
    rubric:
      '- Legal-reasoning items must state the governing principle in the passage and be answerable from it alone.\n- Distractors should encode common misapplications of the principle, not random errors.\n- Reject items where two options are defensibly correct or the key is arguable.\n- Passage and question must be internally consistent; no outside knowledge beyond the passage for principle-fact items.',
  },
  {
    slug: 'ca',
    name: 'CA Final — Accounting & Audit',
    description: 'Financial reporting, SFM, advanced auditing, corporate law, tax.',
    topics: ['Financial Reporting', 'Strategic Financial Management', 'Advanced Auditing', 'Corporate & Economic Laws', 'Direct Tax', 'Indirect Tax'],
    rubric:
      '- Numerical items must be arithmetically verifiable; recompute and confirm the key.\n- Standards/section references (Ind AS, SA, Companies Act) must be current and correctly cited.\n- Distractors should reflect plausible method confusions (e.g. expected-value vs most-likely).\n- Reject items relying on ambiguous or superseded provisions.',
  },
  {
    slug: 'design',
    name: 'Design & Architecture — UCEED / NATA / NID',
    description: 'Visualization, spatial ability, observation, environmental awareness, colour & perspective.',
    topics: ['Visualization & Spatial Ability', 'Observation & Design Sensitivity', 'Environmental & Social Awareness', 'Analytical & Logical Reasoning', 'Colour Theory & Perspective'],
    rubric:
      '- Spatial/geometry items must have a single unambiguous figure interpretation; verify the count/answer.\n- Avoid culturally narrow references in observation items.\n- Distractors for spatial items should map to specific visualization errors.',
  },
];

function baseExam(seed) {
  const now = new Date().toISOString();
  return {
    id: `exam-${nanoid(8)}`,
    slug: seed.slug || nanoid(6),
    name: seed.name,
    description: seed.description || '',
    topics: seed.topics || [],
    rubric: seed.rubric || '',
    gemini: { tunedModel: null, baseModel: config.vertex.tuneBaseModel, status: 'untrained', lastJobId: null },
    createdAt: now,
    updatedAt: now,
  };
}

export async function seedDefaults() {
  const existing = await db.all(COLLECTION);
  if (existing.length > 0) return existing;
  for (const seed of DEFAULT_EXAMS) {
    await db.insert(COLLECTION, baseExam(seed));
  }
  return db.all(COLLECTION);
}

export async function listExams() {
  const exams = await db.all(COLLECTION);
  return Promise.all(
    exams.map(async (e) => ({ ...e, exemplarCount: await countExemplars(e.id) })),
  );
}

export async function getExam(id) {
  const exam = await db.find(COLLECTION, (e) => e.id === id || e.slug === id);
  if (!exam) return null;
  return { ...exam, exemplarCount: await countExemplars(exam.id) };
}

export async function createExam(data) {
  if (!data.name) throw new Error('Exam name is required');
  return db.insert(COLLECTION, baseExam(data));
}

export async function updateExam(id, patch) {
  const allowed = {};
  ['name', 'description', 'topics', 'rubric', 'slug'].forEach((k) => {
    if (patch[k] !== undefined) allowed[k] = patch[k];
  });
  if (patch.gemini) allowed.gemini = patch.gemini;
  return db.update(COLLECTION, id, allowed);
}

export async function deleteExam(id) {
  return db.remove(COLLECTION, id);
}

/** Resolve the analysis context (rubric + tuned model id) for an exam. */
export async function analysisContext(examId) {
  const exam = await getExam(examId);
  if (!exam) return { exam: null, rubric: '', modelId: null };
  return {
    exam: { name: exam.name, slug: exam.slug },
    rubric: exam.rubric,
    modelId: exam.gemini?.tunedModel || null,
  };
}
