import { nanoid } from 'nanoid';
import { db } from '../store.js';
import { config } from '../config.js';
import { getExam, updateExam } from './registry.js';
import { llamaEngine } from './llama.js';
import { buildQcSystemPrompt, buildQcUserPrompt } from '../prompts.js';

/**
 * Per-exam LoRA fine-tuning via the local LLAMA service.
 * Exemplars become supervised training pairs (QC prompt -> ideal QC JSON).
 */
const JOBS = 'tuningJobs';
const MIN_EXAMPLES = 10;

function targetOutput(ex, exam) {
  const rejected = ex.verdict === 'rejected';
  const key = (ex.answerKey || '').toUpperCase().slice(0, 1);
  return JSON.stringify({
    structure: { valid: !rejected, issues: rejected && ex.notes ? [ex.notes] : [] },
    keyIntegrity: {
      hasMarkedKey: Boolean(key),
      markedKey: key,
      modelAnswer: key,
      agreesWithKey: !rejected,
      confidence: rejected ? 60 : 95,
      rationale: ex.notes || (rejected ? 'Item did not meet QC standard.' : 'Key verified against stem and options.'),
    },
    clarity: { score: rejected ? 45 : 90, issues: [] },
    distractors: { score: rejected ? 40 : 85, perOption: (ex.options || []).map((o) => ({ key: o.key, role: o.key === key ? 'correct' : 'strong', note: '' })) },
    difficulty: { level: 'Medium', score: 60, rationale: '' },
    alignment: { topic: exam.topics?.[0] || '', subtopic: '', onSyllabus: !rejected, score: rejected ? 55 : 92 },
    flags: rejected ? ['qc-rejected'] : [],
    verdict: { status: rejected ? 'fail' : 'pass', score: rejected ? 40 : 90, summary: ex.notes || (rejected ? 'Rejected by QC.' : 'Meets QC standard.') },
    fixes: [],
  });
}

async function buildJsonl(exam) {
  const exemplars = await db.filter('exemplars', (e) => e.examId === exam.id);
  const system = buildQcSystemPrompt({ name: exam.name, slug: exam.slug }, exam.rubric);
  const lines = exemplars.map((ex) => {
    const user = buildQcUserPrompt({ passage: ex.passage, stem: ex.stem, options: ex.options, answerKey: ex.answerKey }, []);
    return JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [
        { role: 'user', parts: [{ text: user }] },
        { role: 'model', parts: [{ text: targetOutput(ex, exam) }] },
      ],
    });
  });
  return { jsonl: lines.join('\n'), count: lines.length };
}

export async function listJobs(examId) {
  const jobs = await db.all(JOBS);
  return jobs
    .filter((j) => !examId || j.examId === examId)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function launchTuning(examId) {
  const exam = await getExam(examId);
  if (!exam) throw new Error('Exam not found');

  const { jsonl, count } = await buildJsonl(exam);
  const now = new Date().toISOString();

  if (count === 0) {
    throw new Error('No approved exemplars to train on. Add training data first.');
  }

  const llamaReady = await llamaEngine.available();
  const job = {
    id: `job-${nanoid(8)}`,
    examId,
    provider: 'llama',
    exampleCount: count,
    status: 'queued',
    llamaJobId: null,
    adapterPath: null,
    logs: [`[${now}] Prepared ${count} training examples from approved exemplars.`],
    warning: count < MIN_EXAMPLES ? `Only ${count} examples — recommend at least 16 for reliable tuning.` : null,
    error: null,
    createdAt: now,
    updatedAt: now,
  };

  if (!llamaReady) {
    job.status = 'queued';
    job.logs.push('[queued] LLAMA service not running — start it with: python llama_service/app.py');
    await db.insert(JOBS, job);
    await updateExam(examId, { loraStatus: 'queued', lastJobId: job.id });
    return job;
  }

  try {
    const remote = await llamaEngine.train({
      examSlug: exam.slug,
      jsonlData: jsonl,
      epochs: 3,
      learningRate: 2e-4,
      loraR: 16,
      loraAlpha: 32,
    });
    job.llamaJobId = remote.id;
    job.status = remote.status === 'queued' ? 'running' : remote.status;
    job.logs.push(`[llama] Training job started: ${remote.id}`);
  } catch (err) {
    job.status = 'failed';
    job.error = err.message;
    job.logs.push(`[error] ${err.message}`);
  }

  job.updatedAt = new Date().toISOString();
  await db.insert(JOBS, job);
  await updateExam(examId, { loraStatus: job.status, lastJobId: job.id });
  return job;
}

export async function refreshJob(jobId) {
  const job = await db.find(JOBS, (j) => j.id === jobId);
  if (!job) throw new Error('Job not found');
  if (!job.llamaJobId || ['succeeded', 'failed'].includes(job.status)) return job;

  try {
    const remote = await llamaEngine.getTrainJob(job.llamaJobId);
    const patch = {
      status: remote.status,
      updatedAt: new Date().toISOString(),
      logs: [...job.logs, `[poll] ${remote.status}`],
    };

    if (remote.progress) patch.progress = remote.progress;

    if (remote.status === 'succeeded') {
      patch.adapterPath = remote.adapter_path;
      patch.logs.push(`[done] LoRA adapter ready: ${remote.adapter_path}`);
      const exam = await getExam(job.examId);
      if (exam) {
        await updateExam(job.examId, {
          loraAdapter: remote.adapter_path, loraStatus: 'trained', lastJobId: job.id,
        });
      }
    } else if (remote.status === 'failed') {
      patch.error = remote.error || 'Training failed.';
      patch.logs.push(`[failed] ${patch.error}`);
    }

    return db.update(JOBS, jobId, patch);
  } catch (err) {
    return db.update(JOBS, jobId, { logs: [...job.logs, `[poll-error] ${err.message}`] });
  }
}
