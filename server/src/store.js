import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';

/**
 * Minimal file-backed JSON store. One file per collection, held in memory
 * and flushed atomically. Deliberately dependency-free and swappable for a
 * real database later — every access goes through this module.
 */
const cache = new Map();
const writeQueues = new Map();

async function ensureDir() {
  await fs.mkdir(config.dataDir, { recursive: true });
}

function fileFor(collection) {
  return path.join(config.dataDir, `${collection}.json`);
}

async function load(collection) {
  if (cache.has(collection)) return cache.get(collection);
  await ensureDir();
  let data = [];
  try {
    const raw = await fs.readFile(fileFor(collection), 'utf8');
    data = JSON.parse(raw);
    if (!Array.isArray(data)) data = [];
  } catch {
    data = [];
  }
  cache.set(collection, data);
  return data;
}

// Serialise writes per collection so concurrent requests never clobber the file.
async function flush(collection) {
  const prev = writeQueues.get(collection) || Promise.resolve();
  const next = prev.then(async () => {
    await ensureDir();
    const tmp = fileFor(collection) + '.tmp';
    const data = cache.get(collection) || [];
    await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
    await fs.rename(tmp, fileFor(collection));
  });
  writeQueues.set(collection, next.catch(() => {}));
  return next;
}

export const db = {
  async all(collection) {
    return [...(await load(collection))];
  },

  async find(collection, predicate) {
    const items = await load(collection);
    return items.find(predicate) || null;
  },

  async filter(collection, predicate) {
    const items = await load(collection);
    return items.filter(predicate);
  },

  async insert(collection, doc) {
    const items = await load(collection);
    items.push(doc);
    await flush(collection);
    return doc;
  },

  async update(collection, id, patch) {
    const items = await load(collection);
    const idx = items.findIndex((it) => it.id === id);
    if (idx === -1) return null;
    items[idx] = { ...items[idx], ...patch, updatedAt: new Date().toISOString() };
    await flush(collection);
    return items[idx];
  },

  async remove(collection, id) {
    const items = await load(collection);
    const idx = items.findIndex((it) => it.id === id);
    if (idx === -1) return false;
    items.splice(idx, 1);
    await flush(collection);
    return true;
  },
};
