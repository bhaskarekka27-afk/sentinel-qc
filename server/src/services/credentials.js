import fs from 'node:fs';
import path from 'node:path';
import { config, recalcCapabilities } from '../config.js';
import { resetClient as resetClaudeClient } from './claude.js';

const CREDS_FILE = path.join(config.dataDir, 'credentials.json');

const SA_FILE = path.join(config.dataDir, 'service-account.json');

function resolveServiceAccount(v, stored) {
  if (!v) { config.vertex.credentials = ''; return; }
  // If the value looks like JSON content (not a file path), save it to a file
  // and auto-extract project_id if not already configured.
  const trimmed = v.trim();
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      fs.mkdirSync(path.dirname(SA_FILE), { recursive: true });
      fs.writeFileSync(SA_FILE, trimmed);
      config.vertex.credentials = SA_FILE;
      if (parsed.project_id && !config.vertex.projectId) {
        config.vertex.projectId = parsed.project_id;
        if (stored) stored.GCP_PROJECT_ID = parsed.project_id;
      }
      return;
    } catch { /* not valid JSON, treat as path */ }
  }
  config.vertex.credentials = v;
}

const KEY_MAP = {
  ANTHROPIC_API_KEY: (v) => { config.anthropic.apiKey = v; },
  GEMINI_API_KEY: (v) => { config.gemini.apiKey = v; },
  GCP_PROJECT_ID: (v) => { config.vertex.projectId = v; },
  GOOGLE_APPLICATION_CREDENTIALS: resolveServiceAccount,
  GCS_BUCKET: (v) => { config.vertex.bucket = v; },
};

function readStored() {
  try { return JSON.parse(fs.readFileSync(CREDS_FILE, 'utf-8')); }
  catch { return {}; }
}

function writeStored(creds) {
  fs.mkdirSync(path.dirname(CREDS_FILE), { recursive: true });
  fs.writeFileSync(CREDS_FILE, JSON.stringify(creds, null, 2));
}

function mask(key) {
  if (!key) return '';
  if (key.length <= 8) return '••••••••';
  return key.slice(0, 4) + '••••' + key.slice(-4);
}

export function getCredentialsMasked() {
  return {
    ANTHROPIC_API_KEY: { set: Boolean(config.anthropic.apiKey), masked: mask(config.anthropic.apiKey) },
    GEMINI_API_KEY: { set: Boolean(config.gemini.apiKey), masked: mask(config.gemini.apiKey) },
    GCP_PROJECT_ID: { set: Boolean(config.vertex.projectId), value: config.vertex.projectId || '' },
    GOOGLE_APPLICATION_CREDENTIALS: { set: Boolean(config.vertex.credentials), value: config.vertex.credentials || '' },
    GCS_BUCKET: { set: Boolean(config.vertex.bucket), value: config.vertex.bucket || '' },
  };
}

export function updateCredentials(updates) {
  const stored = readStored();
  let claudeChanged = false;

  for (const [key, value] of Object.entries(updates)) {
    if (!KEY_MAP[key]) continue;
    if (value) {
      stored[key] = value;
      KEY_MAP[key](value, stored);
    } else {
      delete stored[key];
      KEY_MAP[key]('');
    }
    if (key === 'ANTHROPIC_API_KEY') claudeChanged = true;
  }

  writeStored(stored);
  recalcCapabilities();
  if (claudeChanged) resetClaudeClient();

  return getCredentialsMasked();
}

export function loadStoredCredentials() {
  const stored = readStored();

  // Environment variables (set in Railway/Render dashboard) take priority
  // over file-stored credentials — they survive deploys on ephemeral filesystems.
  const ENV_KEYS = ['ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'GCP_PROJECT_ID', 'GOOGLE_APPLICATION_CREDENTIALS', 'GCS_BUCKET'];
  for (const key of ENV_KEYS) {
    if (process.env[key] && !stored[key]) {
      stored[key] = process.env[key];
    }
  }

  for (const [key, value] of Object.entries(stored)) {
    if (KEY_MAP[key] && value) KEY_MAP[key](value, stored);
  }
  // Persist any auto-extracted fields (e.g. project_id from service account JSON).
  writeStored(stored);
  recalcCapabilities();
}
