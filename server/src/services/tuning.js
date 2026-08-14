import { nanoid } from 'nanoid';
import { db } from '../store.js';
import { config, capabilities } from '../config.js';
import { getExam, updateExam } from './registry.js';
import { geminiEngine } from './gemini.js';
import { buildQcSystemPrompt, buildQcUserPrompt } from '../prompts.js';

/**
 * Real per-exam Gemini fine-tuning via Vertex AI. Approved exemplars become
 * supervised training pairs (QC prompt -> ideal QC judgement JSON). When GCP
 * is not configured the job is recorded as "queued (credentials pending)" so
 * the workflow is intact and activates the moment creds are added.
 */
const JOBS = 'tuningJobs';
const MIN_EXAMPLES = 10; // Vertex recommends >=16; we warn below that.

/** Synthesize the ideal QC output the model should learn to produce. */
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

function mapVertexState(state) {
  switch (state) {
    case 'JOB_STATE_SUCCEEDED':
      return 'succeeded';
    case 'JOB_STATE_FAILED':
    case 'JOB_STATE_CANCELLED':
    case 'JOB_STATE_EXPIRED':
      return 'failed';
    case 'JOB_STATE_PENDING':
    case 'JOB_STATE_QUEUED':
      return 'queued';
    default:
      return 'running';
  }
}

export async function listJobs(examId) {
  const jobs = await db.all(JOBS);
  return jobs
    .filter((j) => !examId || j.examId === examId)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

/**
 * Discover already-completed tuning jobs on Vertex for a given exam slug.
 * Returns the tuned model endpoint if one exists, null otherwise.
 */
async function findExistingTunedModel(examSlug) {
  if (!capabilities.vertexTuning) return null;
  try {
    const allJobs = await geminiEngine.listTuningJobs(`qc-${examSlug}`);
    const succeeded = allJobs
      .filter((j) => j.state === 'JOB_STATE_SUCCEEDED' && j.tunedModel?.model)
      .sort((a, b) => (a.updateTime < b.updateTime ? 1 : -1));
    return succeeded.length ? { model: succeeded[0].tunedModel.model, jobName: succeeded[0].name } : null;
  } catch {
    return null;
  }
}

/**
 * On startup, scan Vertex for all completed tuning jobs and sync any
 * tuned models back into the local exam registry. Avoids retraining
 * after a fresh deploy when the tuned models already exist on Vertex.
 */
export async function syncTunedModelsFromVertex() {
  if (!capabilities.vertexTuning) return;
  try {
    const allJobs = await geminiEngine.listTuningJobs();
    const succeeded = allJobs.filter((j) => j.state === 'JOB_STATE_SUCCEEDED' && j.tunedModel?.model);
    if (!succeeded.length) return;

    const { listExams } = await import('./registry.js');
    const exams = await listExams();

    for (const exam of exams) {
      if (exam.gemini?.tunedModel) continue;
      const match = succeeded
        .filter((j) => j.tunedModelDisplayName?.startsWith(`qc-${exam.slug}`))
        .sort((a, b) => (a.updateTime < b.updateTime ? 1 : -1))[0];
      if (match) {
        const tuned = match.tunedModel.model;
        await updateExam(exam.id, {
          gemini: { ...exam.gemini, tunedModel: tuned, status: 'trained' },
        });

        const now = new Date().toISOString();
        const existingLocal = (await db.all(JOBS)).find(
          (j) => j.examId === exam.id && j.tunedModel === tuned,
        );
        if (!existingLocal) {
          await db.insert(JOBS, {
            id: `job-${nanoid(8)}`,
            examId: exam.id,
            provider: 'gemini',
            exampleCount: 0,
            status: 'succeeded',
            vertexJobName: match.name,
            tunedModel: tuned,
            datasetUri: match.supervisedTuningSpec?.trainingDatasetUri || null,
            baseModel: config.vertex.tuneBaseModel,
            logs: [`[synced] Discovered existing tuned model from Vertex: ${tuned}`],
            warning: null,
            error: null,
            progress: extractProgress(match),
            createdAt: match.createTime || now,
            updatedAt: now,
          });
        }
        console.log(`[tuning] Synced existing tuned model for ${exam.slug}: ${tuned}`);
      }
    }
  } catch (err) {
    console.warn('[tuning] Failed to sync tuned models from Vertex:', err.message);
  }
}

export async function launchTuning(examId) {
  const exam = await getExam(examId);
  if (!exam) throw new Error('Exam not found');

  // Check if a tuned model already exists on Vertex for this exam
  const existing = await findExistingTunedModel(exam.slug);
  if (existing && !exam.gemini?.tunedModel) {
    const now = new Date().toISOString();
    await updateExam(examId, {
      gemini: { ...exam.gemini, tunedModel: existing.model, status: 'trained' },
    });
    const job = {
      id: `job-${nanoid(8)}`,
      examId,
      provider: 'gemini',
      exampleCount: 0,
      status: 'succeeded',
      vertexJobName: existing.jobName,
      tunedModel: existing.model,
      datasetUri: null,
      baseModel: exam.gemini?.baseModel || config.vertex.tuneBaseModel,
      logs: [
        `[${now}] Found existing tuned model on Vertex — skipping retrain to save cost.`,
        `[reused] Model: ${existing.model}`,
      ],
      warning: null,
      error: null,
      createdAt: now,
      updatedAt: now,
    };
    await db.insert(JOBS, job);
    return job;
  }

  const { jsonl, count } = await buildJsonl(exam);
  const now = new Date().toISOString();
  const job = {
    id: `job-${nanoid(8)}`,
    examId,
    provider: 'gemini',
    exampleCount: count,
    status: 'queued',
    vertexJobName: null,
    tunedModel: null,
    datasetUri: null,
    baseModel: exam.gemini?.baseModel || config.vertex.tuneBaseModel,
    logs: [`[${now}] Prepared ${count} training examples from approved exemplars.`],
    warning: count < MIN_EXAMPLES ? `Only ${count} examples — Vertex recommends at least 16 for reliable tuning.` : null,
    error: null,
    createdAt: now,
    updatedAt: now,
  };

  if (!capabilities.vertexTuning) {
    job.status = 'queued';
    job.logs.push('[queued] GCP/Vertex or GCS bucket not configured — job will activate when credentials are added.');
    await db.insert(JOBS, job);
    await updateExam(examId, { gemini: { ...exam.gemini, status: 'queued', lastJobId: job.id } });
    return job;
  }

  if (count === 0) {
    throw new Error('No approved exemplars to train on. Add training data first.');
  }

  try {
    const objectName = `tuning/${exam.slug}/${job.id}.jsonl`;
    const uri = await geminiEngine.uploadDataset(objectName, jsonl);
    job.datasetUri = uri;
    job.logs.push(`[upload] Dataset uploaded to ${uri}.`);

    const vertexJob = await geminiEngine.createTuningJob({
      displayName: `qc-${exam.slug}-${job.id}`,
      trainingUri: uri,
      baseModel: job.baseModel,
    });
    job.vertexJobName = vertexJob.name;
    job.status = mapVertexState(vertexJob.state);
    job.logs.push(`[vertex] Tuning job created: ${vertexJob.name} (${vertexJob.state}).`);
  } catch (err) {
    job.status = 'failed';
    job.error = err.message;
    job.logs.push(`[error] ${err.message}`);
  }

  job.updatedAt = new Date().toISOString();
  await db.insert(JOBS, job);
  await updateExam(examId, { gemini: { ...exam.gemini, status: job.status, lastJobId: job.id } });
  return job;
}

function extractProgress(remote) {
  const progress = {};
  if (remote.startTime) progress.startTime = remote.startTime;
  if (remote.updateTime) progress.updateTime = remote.updateTime;
  if (remote.endTime) progress.endTime = remote.endTime;
  const spec = remote.supervisedTuningSpec;
  if (spec?.hyperParameters?.epochCount) {
    progress.totalEpochs = parseInt(spec.hyperParameters.epochCount, 10);
  }
  const stats = remote.tuningDataStats?.supervisedTuningDataStats;
  if (stats) {
    progress.exampleCount = parseInt(stats.tuningDatasetExampleCount, 10) || 0;
    progress.totalTokens = parseInt(stats.totalBillableTokenCount, 10) || 0;
  }
  if (remote.experiment) progress.experiment = remote.experiment;
  if (remote.tunedModel?.model) progress.tunedModel = remote.tunedModel.model;
  // Estimate completion: running time vs typical ~1-3hr for tuning
  if (remote.startTime && !remote.endTime) {
    const elapsed = Date.now() - new Date(remote.startTime).getTime();
    progress.elapsedMinutes = Math.round(elapsed / 60000);
  }
  return progress;
}

export async function refreshJob(jobId) {
  const job = await db.find(JOBS, (j) => j.id === jobId);
  if (!job) throw new Error('Job not found');
  if (!job.vertexJobName || ['succeeded', 'failed'].includes(job.status)) return job;
  if (!capabilities.vertexTuning) return job;

  // If stored job name was truncated (JS number precision), try to find the real one.
  let jobName = job.vertexJobName;

  try {
    let remote;
    try {
      remote = await geminiEngine.getTuningJob(jobName);
    } catch (pollErr) {
      if (pollErr.message.includes('404') || pollErr.message.includes('does not exist')) {
        const prefix = `qc-${job.id.replace('job-', '')}`;
        const allJobs = await geminiEngine.listTuningJobs();
        const match = allJobs.find((j) =>
          j.tunedModelDisplayName?.includes(job.id.replace('job-', '')) ||
          j.supervisedTuningSpec?.trainingDatasetUri?.includes(job.id),
        );
        if (match) {
          jobName = match.name;
          remote = match;
        } else {
          throw pollErr;
        }
      } else {
        throw pollErr;
      }
    }

    const status = mapVertexState(remote.state);
    const progress = extractProgress(remote);
    const patch = { status, progress, updatedAt: new Date().toISOString() };
    if (jobName !== job.vertexJobName) patch.vertexJobName = jobName;
    const logs = [...job.logs, `[poll] ${remote.state}`];

    if (status === 'succeeded') {
      const tuned = remote.tunedModel?.model || remote.tunedModel?.endpoint || null;
      patch.tunedModel = tuned;
      logs.push(`[done] Tuned model ready: ${tuned}`);
      const exam = await getExam(job.examId);
      if (exam && tuned) {
        await updateExam(job.examId, { gemini: { ...exam.gemini, tunedModel: tuned, status: 'trained', lastJobId: job.id } });
      }
    } else if (status === 'failed') {
      patch.error = remote.error?.message || 'Tuning failed.';
      logs.push(`[failed] ${patch.error}`);
    }
    patch.logs = logs;
    return db.update(JOBS, jobId, patch);
  } catch (err) {
    return db.update(JOBS, jobId, { logs: [...job.logs, `[poll-error] ${err.message}`] });
  }
}
