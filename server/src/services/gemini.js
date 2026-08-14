import { GoogleAuth } from 'google-auth-library';
import { config, capabilities } from '../config.js';
import { extractJson } from '../util/json.js';
import { buildQcSystemPrompt, buildQcUserPrompt, buildDetectSystemPrompt, buildDetectUserPrompt } from '../prompts.js';

/**
 * Gemini engine. Two inference paths:
 *   1. Vertex AI (for fine-tuned per-exam models — resource names beginning
 *      with "projects/") and for base inference when GCP is configured.
 *   2. AI Studio API key (lightweight fallback inference + embeddings).
 * Plus the real Vertex supervised fine-tuning pipeline (GCS upload + job).
 */

let auth = null;
let authKeyFile = null;
function getAuth() {
  const keyFile = config.vertex.credentials || undefined;
  if (!auth || authKeyFile !== keyFile) {
    auth = new GoogleAuth({
      scopes: 'https://www.googleapis.com/auth/cloud-platform',
      ...(keyFile ? { keyFile } : {}),
    });
    authKeyFile = keyFile;
  }
  return auth;
}

async function accessToken() {
  const client = await getAuth().getClient();
  const token = await client.getAccessToken();
  return token.token;
}

function vertexHost() {
  return `https://${config.vertex.location}-aiplatform.googleapis.com`;
}

// ── Inference ─────────────────────────────────────────────────────────
async function studioGenerate(system, prompt, model) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.gemini.apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.1, responseMimeType: 'application/json' },
    }),
  });
  if (!res.ok) throw new Error(`Gemini(AI Studio) ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return json.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

async function vertexGenerate(system, prompt, model) {
  // `model` may be a tuned-model resource path or a base model id.
  const modelPath = model.startsWith('projects/')
    ? model
    : `projects/${config.vertex.projectId}/locations/${config.vertex.location}/publishers/google/models/${model}`;
  const url = `${vertexHost()}/v1/${modelPath}:generateContent`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${await accessToken()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.1, responseMimeType: 'application/json' },
    }),
  });
  if (!res.ok) throw new Error(`Vertex ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return json.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

/**
 * Route a generation request. Prefers Vertex for tuned models; uses AI Studio
 * key otherwise. Throws if neither path is available.
 */
async function generate(system, prompt, modelId) {
  const isTuned = typeof modelId === 'string' && modelId.startsWith('projects/');
  if (isTuned || (capabilities.vertexTuning && !capabilities.gemini)) {
    return vertexGenerate(system, prompt, modelId || config.vertex.tuneBaseModel);
  }
  if (capabilities.gemini) {
    return studioGenerate(system, prompt, modelId && !isTuned ? modelId : config.gemini.model);
  }
  if (config.vertex.projectId && config.vertex.credentials) {
    return vertexGenerate(system, prompt, modelId || config.vertex.tuneBaseModel);
  }
  throw new Error('Gemini not configured');
}

export const geminiEngine = {
  available() {
    return capabilities.gemini || (config.vertex.projectId && config.vertex.credentials);
  },

  async analyzeQuestion(question, { exam, rubric, exemplars, modelId }) {
    const system = buildQcSystemPrompt(exam, rubric);
    const user = buildQcUserPrompt(question, exemplars);
    const text = await generate(system, user, modelId);
    const parsed = extractJson(text);
    if (!parsed) throw new Error('Gemini returned unparseable QC output');
    return parsed;
  },

  async detect(text) {
    const out = await generate(buildDetectSystemPrompt(), buildDetectUserPrompt(text), null);
    const parsed = extractJson(out);
    if (!parsed) throw new Error('Gemini returned unparseable detection output');
    return parsed;
  },

  // ── Fine-tuning pipeline ────────────────────────────────────────────
  /** Upload a JSONL dataset to the configured GCS bucket via the JSON API. */
  async uploadDataset(objectName, jsonl) {
    const url = `https://storage.googleapis.com/upload/storage/v1/b/${config.vertex.bucket}/o?uploadType=media&name=${encodeURIComponent(objectName)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await accessToken()}`,
        'Content-Type': 'application/jsonl',
      },
      body: jsonl,
    });
    if (!res.ok) throw new Error(`GCS upload ${res.status}: ${await res.text()}`);
    return `gs://${config.vertex.bucket}/${objectName}`;
  },

  /** Create a real Vertex AI supervised tuning job. Returns the job resource. */
  async createTuningJob({ displayName, trainingUri, baseModel }) {
    const url = `${vertexHost()}/v1/projects/${config.vertex.projectId}/locations/${config.vertex.location}/tuningJobs`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await accessToken()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        baseModel: baseModel || config.vertex.tuneBaseModel,
        tunedModelDisplayName: displayName,
        supervisedTuningSpec: { trainingDatasetUri: trainingUri },
      }),
    });
    if (!res.ok) throw new Error(`Vertex tuningJobs ${res.status}: ${await res.text()}`);
    // Parse as text to preserve large integer job IDs (exceed Number.MAX_SAFE_INTEGER).
    const text = await res.text();
    const job = JSON.parse(text);
    const nameMatch = text.match(/"name"\s*:\s*"([^"]+)"/);
    if (nameMatch) job.name = nameMatch[1];
    return job;
  },

  /** Poll a tuning job by its resource name. */
  async getTuningJob(jobName) {
    const url = `${vertexHost()}/v1/${jobName}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${await accessToken()}` },
    });
    if (!res.ok) throw new Error(`Vertex getTuningJob ${res.status}: ${await res.text()}`);
    return res.json();
  },

  /** List tuning jobs, optionally filtered by display name prefix. */
  async listTuningJobs(prefix) {
    const url = `${vertexHost()}/v1/projects/${config.vertex.projectId}/locations/${config.vertex.location}/tuningJobs`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${await accessToken()}` },
    });
    if (!res.ok) return [];
    const data = await res.json();
    const jobs = data.tuningJobs || [];
    return prefix ? jobs.filter((j) => j.tunedModelDisplayName?.startsWith(prefix)) : jobs;
  },
};
