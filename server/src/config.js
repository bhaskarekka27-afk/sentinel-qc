import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Central runtime configuration. Every credential is optional — the
 * services degrade gracefully to heuristic/queued modes when a key or
 * project is missing, so the tool is always runnable.
 */
export const config = {
  port: Number(process.env.PORT) || 8787,
  corsOrigins: (process.env.CORS_ORIGIN || 'http://localhost:5173,http://localhost:5188')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  dataDir: path.resolve(__dirname, '..', 'data'),

  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY || '',
    model: process.env.CLAUDE_MODEL || 'claude-sonnet-5',
  },

  gemini: {
    apiKey: process.env.GEMINI_API_KEY || '',
    model: process.env.GEMINI_MODEL || 'gemini-3.5-flash',
    embedModel: process.env.GEMINI_EMBED_MODEL || 'gemini-embedding-001',
  },

  vertex: {
    projectId: process.env.GCP_PROJECT_ID || '',
    location: process.env.GCP_LOCATION || 'us-central1',
    credentials: process.env.GOOGLE_APPLICATION_CREDENTIALS || '',
    tuneBaseModel: process.env.VERTEX_TUNE_BASE_MODEL || 'gemini-3.5-flash',
    bucket: process.env.GCS_BUCKET || '',
  },
};

export const capabilities = {
  claude: Boolean(config.anthropic.apiKey),
  gemini: Boolean(config.gemini.apiKey),
  embeddings: Boolean(config.gemini.apiKey),
  vertexTuning: Boolean(
    config.vertex.projectId && config.vertex.credentials && config.vertex.bucket,
  ),
};

export function recalcCapabilities() {
  capabilities.claude = Boolean(config.anthropic.apiKey);
  capabilities.gemini = Boolean(config.gemini.apiKey);
  capabilities.embeddings = Boolean(config.gemini.apiKey);
  capabilities.vertexTuning = Boolean(
    config.vertex.projectId && config.vertex.credentials && config.vertex.bucket,
  );
}

export function capabilitySummary() {
  return {
    claude: capabilities.claude,
    gemini: capabilities.gemini,
    embeddings: capabilities.embeddings,
    vertexTuning: capabilities.vertexTuning,
    ensemble: capabilities.claude && capabilities.gemini,
  };
}
