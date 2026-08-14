import { config, capabilities } from '../config.js';

/**
 * Text embeddings for retrieval. Uses Gemini's embedding model when a key is
 * present; otherwise falls back to a deterministic hashed bag-of-words vector
 * so retrieval still works (lexically) with no credentials.
 */
const FALLBACK_DIM = 256;

function tokenize(text) {
  return (text.toLowerCase().match(/\b[a-z0-9']{2,}\b/g) || []);
}

function hashedVector(text) {
  const vec = new Array(FALLBACK_DIM).fill(0);
  for (const tok of tokenize(text)) {
    let h = 0;
    for (let i = 0; i < tok.length; i++) h = (h * 31 + tok.charCodeAt(i)) | 0;
    vec[Math.abs(h) % FALLBACK_DIM] += 1;
  }
  const norm = Math.sqrt(vec.reduce((a, b) => a + b * b, 0)) || 1;
  return vec.map((v) => v / norm);
}

async function geminiEmbed(text) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.gemini.embedModel}:embedContent?key=${config.gemini.apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: `models/${config.gemini.embedModel}`,
      content: { parts: [{ text: text.slice(0, 8000) }] },
    }),
  });
  if (!res.ok) throw new Error(`Embedding failed: ${res.status}`);
  const json = await res.json();
  return json.embedding?.values || null;
}

export async function embed(text) {
  if (capabilities.embeddings) {
    try {
      const v = await geminiEmbed(text);
      if (v) return { vector: v, method: 'gemini' };
    } catch {
      /* fall through to lexical */
    }
  }
  return { vector: hashedVector(text), method: 'lexical' };
}

export function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}
