import Anthropic from '@anthropic-ai/sdk';
import { config, capabilities } from '../config.js';
import { extractJson } from '../util/json.js';
import { buildQcSystemPrompt, buildQcUserPrompt, buildDetectSystemPrompt, buildDetectUserPrompt } from '../prompts.js';

/**
 * Claude engine. Per-exam "learning" is achieved via retrieval-augmented
 * few-shot: the exam's approved exemplars are injected into the prompt by the
 * caller, so Claude's judgement is calibrated to that vertical's gold standard.
 */
let client = null;
function getClient() {
  if (!client) client = new Anthropic({ apiKey: config.anthropic.apiKey });
  return client;
}

async function complete(system, user) {
  const msg = await getClient().messages.create({
    model: config.anthropic.model,
    max_tokens: 2048,
    temperature: 0.1,
    system,
    messages: [{ role: 'user', content: user }],
  });
  return msg.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}

export function resetClient() { client = null; }

export const claudeEngine = {
  available() {
    return capabilities.claude;
  },

  async analyzeQuestion(question, { exam, rubric, exemplars }) {
    const system = buildQcSystemPrompt(exam, rubric);
    const user = buildQcUserPrompt(question, exemplars);
    const text = await complete(system, user);
    const parsed = extractJson(text);
    if (!parsed) throw new Error('Claude returned unparseable QC output');
    return parsed;
  },

  async detect(text) {
    const out = await complete(buildDetectSystemPrompt(), buildDetectUserPrompt(text));
    const parsed = extractJson(out);
    if (!parsed) throw new Error('Claude returned unparseable detection output');
    return parsed;
  },
};
