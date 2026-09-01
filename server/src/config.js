import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const config = {
  port: Number(process.env.PORT) || 8787,
  corsOrigins: (process.env.CORS_ORIGIN || 'http://localhost:5173,http://localhost:5188')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  dataDir: process.env.DATA_DIR || path.resolve(__dirname, '..', 'data'),

  llama: {
    serviceUrl: process.env.LLAMA_SERVICE_URL || 'http://localhost:8788',
  },
};

export const capabilities = {
  llama: false,
  embeddings: false,
};

export async function refreshCapabilities() {
  try {
    const res = await fetch(`${config.llama.serviceUrl}/status`);
    if (res.ok) {
      const data = await res.json();
      capabilities.llama = data.ready === true;
      capabilities.embeddings = data.ready === true;
    }
  } catch {
    capabilities.llama = false;
    capabilities.embeddings = false;
  }
}

export function capabilitySummary() {
  return {
    llama: capabilities.llama,
    embeddings: capabilities.embeddings,
  };
}
