import { config } from '../config.js';
import { extractJson } from '../util/json.js';
import { buildQcSystemPrompt, buildQcUserPrompt, buildDetectSystemPrompt, buildDetectUserPrompt } from '../prompts.js';

/**
 * LLAMA engine — calls the local Python LLAMA service for inference.
 * Supports per-exam LoRA adapters for fine-tuned analysis.
 */

async function callService(endpoint, body) {
  const url = `${config.llama.serviceUrl}${endpoint}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LLAMA service ${res.status}: ${text}`);
  }
  return res.json();
}

export const llamaEngine = {
  async available() {
    try {
      const res = await fetch(`${config.llama.serviceUrl}/status`);
      if (!res.ok) return false;
      const data = await res.json();
      return data.ready === true;
    } catch {
      return false;
    }
  },

  async status() {
    try {
      const res = await fetch(`${config.llama.serviceUrl}/status`);
      if (!res.ok) return null;
      return res.json();
    } catch {
      return null;
    }
  },

  async analyzeQuestion(question, { exam, rubric, exemplars, examSlug }) {
    const system = buildQcSystemPrompt(exam, rubric);
    const user = buildQcUserPrompt(question, exemplars);
    const { text } = await callService('/analyze', {
      system,
      prompt: user,
      exam_slug: examSlug || null,
    });
    const parsed = extractJson(text);
    if (!parsed) throw new Error('LLAMA returned unparseable QC output');
    return parsed;
  },

  async detect(text) {
    const { text: out } = await callService('/detect', {
      system: buildDetectSystemPrompt(),
      prompt: buildDetectUserPrompt(text),
    });
    const parsed = extractJson(out);
    if (!parsed) throw new Error('LLAMA returned unparseable detection output');
    return parsed;
  },

  async embed(text) {
    const data = await callService('/embed', { text });
    return { vector: data.vector, method: data.method || 'local' };
  },

  async train({ examSlug, jsonlData, epochs, learningRate, loraR, loraAlpha }) {
    return callService('/train', {
      exam_slug: examSlug,
      jsonl_data: jsonlData,
      epochs,
      learning_rate: learningRate,
      lora_r: loraR,
      lora_alpha: loraAlpha,
    });
  },

  async getTrainJob(jobId) {
    const res = await fetch(`${config.llama.serviceUrl}/train/${jobId}`);
    if (!res.ok) throw new Error(`Job ${jobId} not found`);
    return res.json();
  },
};
