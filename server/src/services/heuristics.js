import { clampScore } from '../util/json.js';

/**
 * Credential-free heuristics. These always run: they give a deterministic
 * baseline QC signal and AI-detection score even with no LLM keys, and they
 * become one voice in the ensemble when keys are present.
 */

// ── Structural QC (deterministic) ─────────────────────────────────────
export function structuralCheck(q) {
  const issues = [];
  const flags = [];
  const options = q.options || [];
  const keys = options.map((o) => o.key);

  if (options.length < 2) {
    issues.push('Fewer than two options detected.');
    flags.push('missing-options');
  }
  if (options.length > 0 && options.length < 4) {
    issues.push(`Only ${options.length} options — expected 4.`);
  }
  if (new Set(keys).size !== keys.length) {
    issues.push('Duplicate option keys.');
    flags.push('duplicate-option-key');
  }
  const texts = options.map((o) => (o.text || '').trim().toLowerCase());
  if (new Set(texts.filter(Boolean)).size !== texts.filter(Boolean).length) {
    issues.push('Two or more options have identical text.');
    flags.push('duplicate-answer');
  }
  if (!q.answerKey) {
    issues.push('No answer key present.');
    flags.push('missing-key');
  } else if (options.length && !keys.includes(q.answerKey)) {
    issues.push(`Answer key "${q.answerKey}" does not match any option.`);
    flags.push('answer-key-mismatch');
  }
  if (!q.stem || q.stem.length < 10) {
    issues.push('Question stem is very short or missing.');
    flags.push('short-stem');
  }
  if (/\b(all|none) of the above\b/i.test(texts.join(' '))) {
    flags.push('all-none-of-above');
  }
  if (/\bnot\b.*\bnot\b/i.test(q.stem || '')) {
    issues.push('Possible double negative in stem.');
    flags.push('double-negative');
  }

  const valid = flags.length === 0;
  return { valid, issues, flags };
}

// ── AI-vs-human heuristics ────────────────────────────────────────────
const AI_MARKERS = [
  'delve', 'tapestry', 'testament', 'furthermore', 'moreover', 'in conclusion',
  'it is important to note', 'it is worth noting', 'democratize', 'elevate',
  'foster', 'streamline', 'robust', 'seamless', 'leverage', 'paradigm',
  'in the realm of', 'navigate the complexities', 'plays a crucial role',
  'a wide range of', 'it is essential', 'landscape',
];

export function detectHeuristic(text) {
  const clean = (text || '').trim();
  if (!clean) {
    return { aiLikelihood: 0, verdict: 'Human', confidence: 10, signals: [], humanSignals: ['No text.'], rationale: 'Empty input.' };
  }

  const sentences = clean.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0);
  const words = clean.toLowerCase().match(/\b[a-z']+\b/g) || [];
  const unique = new Set(words);
  const ttr = words.length ? unique.size / words.length : 0;

  const lens = sentences.map((s) => (s.match(/\b[a-z']+\b/gi) || []).length);
  const mean = lens.reduce((a, b) => a + b, 0) / (lens.length || 1);
  const variance = lens.length > 1 ? lens.reduce((a, l) => a + (l - mean) ** 2, 0) / lens.length : 0;
  const burstiness = Math.sqrt(variance);

  const lower = clean.toLowerCase();
  const markerHits = AI_MARKERS.filter((m) => lower.includes(m));
  const transitionOpeners = sentences.filter((s) =>
    /^(however|furthermore|moreover|in addition|therefore|consequently|thus|firstly|secondly|additionally)/i.test(s.trim()),
  ).length;

  let score = 12;
  const signals = [];
  const humanSignals = [];

  if (markerHits.length) {
    score += Math.min(35, markerHits.length * 9);
    signals.push(`AI-typical phrasing: ${markerHits.slice(0, 6).map((m) => `"${m}"`).join(', ')}.`);
  }
  if (burstiness < 3 && sentences.length > 4) {
    score += 22;
    signals.push(`Low sentence-length variation (burstiness ${burstiness.toFixed(1)}).`);
  } else if (burstiness > 6) {
    humanSignals.push(`Natural sentence-length variation (burstiness ${burstiness.toFixed(1)}).`);
  }
  if (transitionOpeners / (sentences.length || 1) > 0.3) {
    score += 15;
    signals.push('Formulaic transition openers on many sentences.');
  }
  if (ttr < 0.4 && words.length > 40) {
    score += 10;
    signals.push(`Low lexical diversity (TTR ${(ttr * 100).toFixed(0)}%).`);
  } else if (ttr > 0.6) {
    humanSignals.push(`High lexical diversity (TTR ${(ttr * 100).toFixed(0)}%).`);
  }

  score = clampScore(Math.min(95, Math.max(5, score)));

  let verdict = 'Uncertain';
  if (score >= 75) verdict = 'AI-generated';
  else if (score >= 55) verdict = 'Likely AI';
  else if (score <= 25) verdict = 'Human';
  else if (score <= 40) verdict = 'Likely Human';

  return {
    aiLikelihood: score,
    verdict,
    confidence: words.length < 30 ? 30 : 60,
    signals,
    humanSignals,
    rationale: `Heuristic scan of ${sentences.length} sentences / ${words.length} words. Burstiness ${burstiness.toFixed(1)}, TTR ${(ttr * 100).toFixed(0)}%, ${markerHits.length} AI-marker hits.`,
    metrics: { burstiness: Number(burstiness.toFixed(2)), ttr: Number((ttr * 100).toFixed(1)), sentences: sentences.length, words: words.length },
  };
}
