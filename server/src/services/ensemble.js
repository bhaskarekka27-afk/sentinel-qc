import { clampScore } from '../util/json.js';
import { llamaEngine } from './llama.js';
import { structuralCheck, detectHeuristic } from './heuristics.js';

/**
 * The ensemble runs every available engine, then reconciles their outputs into
 * one QC verdict — averaging scores, taking majority votes on answer-key
 * integrity, unioning defect flags, and surfacing engine disagreement (which
 * is itself a strong "needs human review" signal).
 */

const CRITICAL_FLAGS = new Set([
  'answer-key-mismatch',
  'missing-key',
  'missing-options',
  'factual-error',
  'unanswerable',
]);

function normalizeQc(raw, engine) {
  const opts = Array.isArray(raw?.distractors?.perOption) ? raw.distractors.perOption : [];
  return {
    engine,
    structure: {
      valid: Boolean(raw?.structure?.valid),
      issues: raw?.structure?.issues || [],
    },
    keyIntegrity: {
      hasMarkedKey: Boolean(raw?.keyIntegrity?.hasMarkedKey),
      markedKey: (raw?.keyIntegrity?.markedKey || '').toString().toUpperCase().slice(0, 1),
      modelAnswer: (raw?.keyIntegrity?.modelAnswer || '').toString().toUpperCase().slice(0, 1),
      agreesWithKey: raw?.keyIntegrity?.agreesWithKey !== false,
      confidence: clampScore(raw?.keyIntegrity?.confidence, 50),
      rationale: raw?.keyIntegrity?.rationale || '',
    },
    clarity: { score: clampScore(raw?.clarity?.score, 60), issues: raw?.clarity?.issues || [] },
    distractors: { score: clampScore(raw?.distractors?.score, 60), perOption: opts },
    difficulty: {
      level: raw?.difficulty?.level || 'Medium',
      score: clampScore(raw?.difficulty?.score, 50),
      rationale: raw?.difficulty?.rationale || '',
    },
    alignment: {
      topic: raw?.alignment?.topic || '',
      subtopic: raw?.alignment?.subtopic || '',
      onSyllabus: raw?.alignment?.onSyllabus !== false,
      score: clampScore(raw?.alignment?.score, 60),
    },
    flags: Array.isArray(raw?.flags) ? raw.flags : [],
    verdict: {
      status: ['pass', 'review', 'fail'].includes(raw?.verdict?.status) ? raw.verdict.status : 'review',
      score: clampScore(raw?.verdict?.score, 60),
      summary: raw?.verdict?.summary || '',
    },
    fixes: Array.isArray(raw?.fixes) ? raw.fixes : [],
  };
}

function avg(nums) {
  const v = nums.filter((n) => Number.isFinite(n));
  return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null;
}

function majority(values) {
  const counts = {};
  values.filter(Boolean).forEach((v) => (counts[v] = (counts[v] || 0) + 1));
  let best = null;
  let bestN = 0;
  for (const [k, n] of Object.entries(counts)) {
    if (n > bestN) {
      best = k;
      bestN = n;
    }
  }
  return best;
}

const FLAG_FIXES = {
  'missing-options': 'Add the missing answer options — at least 4 choices (A–D) are expected.',
  'duplicate-option-key': 'Remove or relabel the duplicate option key so each option has a unique letter.',
  'duplicate-answer': 'Rewrite duplicate option text so every distractor is distinct.',
  'missing-key': 'Add a marked answer key to this question.',
  'answer-key-mismatch': 'Verify the answer key — it does not match any listed option.',
  'short-stem': 'Expand the question stem to be more specific and self-contained.',
  'double-negative': 'Rewrite the stem to remove the double negative for clarity.',
  'all-none-of-above': 'Consider replacing "all/none of the above" with a concrete distractor.',
  'missing-passage': 'Add the required passage or reading comprehension context for this question.',
  'missing-numerical': 'Add numerical data or calculation elements as expected by the rubric.',
};

function fixesFromFlags(flags, question) {
  const fixes = [];
  for (const f of flags) {
    if (FLAG_FIXES[f]) fixes.push(FLAG_FIXES[f]);
  }
  if (flags.includes('answer-key-mismatch') && question.answerKey) {
    const validKeys = (question.options || []).map((o) => o.key);
    if (validKeys.length) fixes.push(`Valid option keys are: ${validKeys.join(', ')}. Current key "${question.answerKey}" is not among them.`);
  }
  return fixes;
}

function estimateFromContent(question, structural) {
  const stem = (question.stem || '').trim();
  const opts = question.options || [];
  const optTexts = opts.map((o) => (o.text || '').trim());
  const fl = structural.flags;

  // Clarity: based on stem quality
  let clarity = 70;
  const stemWords = stem.split(/\s+/).length;
  if (stemWords < 5) clarity -= 25;
  else if (stemWords < 10) clarity -= 10;
  else if (stemWords > 25) clarity += 10;
  if (stem.endsWith('?')) clarity += 5;
  if (fl.includes('short-stem')) clarity = Math.min(clarity, 35);
  if (fl.includes('double-negative')) clarity -= 20;

  // Distractors: based on option count, length, and diversity
  let distractors = 70;
  if (opts.length < 4) distractors -= 20;
  if (opts.length < 2) distractors -= 20;
  const avgOptLen = optTexts.reduce((s, t) => s + t.length, 0) / (optTexts.length || 1);
  if (avgOptLen < 5) distractors -= 15;
  else if (avgOptLen > 30) distractors += 10;
  const optLens = optTexts.map((t) => t.length);
  const lenVariance = optLens.length > 1
    ? optLens.reduce((s, l) => s + (l - avgOptLen) ** 2, 0) / optLens.length
    : 0;
  if (lenVariance < 10 && optTexts.length >= 4) distractors += 5; // uniform length = well-crafted
  if (fl.includes('missing-options')) distractors = Math.min(distractors, 30);
  if (fl.includes('duplicate-answer')) distractors = Math.min(distractors, 25);
  if (fl.includes('all-none-of-above')) distractors -= 10;

  // Alignment: passage presence and content signals
  let alignment = 70;
  if (fl.includes('missing-passage')) alignment = 35;
  else if (question.passage) {
    const passageLen = question.passage.trim().length;
    if (passageLen > 200) alignment += 10;
    else if (passageLen < 50) alignment -= 10;
  }
  if (fl.includes('missing-numerical')) alignment = Math.min(alignment, 35);

  // Difficulty: estimate from stem complexity and option similarity
  let difficulty = 50;
  if (stemWords > 30) difficulty += 15;
  if (/\b(not|except|least|false)\b/i.test(stem)) difficulty += 10;
  if (avgOptLen > 40) difficulty += 10;
  if (stemWords < 8 && avgOptLen < 10) difficulty -= 15;

  const clamp = (v) => Math.max(5, Math.min(95, Math.round(v)));
  return { clarity: clamp(clarity), distractors: clamp(distractors), difficulty: clamp(difficulty), alignment: clamp(alignment) };
}

function reconcile(question, engineResults, structural) {
  const dedupe = (arr) => [...new Set(arr.filter(Boolean))];

  // Answer-key integrity: majority model answer + agreement vote.
  const modelAnswers = engineResults.map((r) => r.keyIntegrity.modelAnswer).filter(Boolean);
  const consensusAnswer = majority(modelAnswers);
  const agreeVotes = engineResults.filter((r) => r.keyIntegrity.agreesWithKey).length;
  const keyAgrees = engineResults.length ? agreeVotes >= engineResults.length / 2 : !structural.flags.includes('answer-key-mismatch');
  const enginesDisagreeOnAnswer = new Set(modelAnswers).size > 1;

  const flags = dedupe([
    ...structural.flags,
    ...engineResults.flatMap((r) => r.flags),
    ...(question.answerKey && consensusAnswer && question.answerKey !== consensusAnswer ? ['answer-key-mismatch'] : []),
  ]);

  // Content-aware heuristic scores when no engines ran
  const heuristic = engineResults.length === 0 ? estimateFromContent(question, structural) : null;
  const scores = {
    clarity: avg(engineResults.map((r) => r.clarity.score)) ?? (heuristic?.clarity ?? 50),
    distractors: avg(engineResults.map((r) => r.distractors.score)) ?? (heuristic?.distractors ?? 50),
    difficulty: avg(engineResults.map((r) => r.difficulty.score)) ?? (heuristic?.difficulty ?? 50),
    alignment: avg(engineResults.map((r) => r.alignment.score)) ?? (heuristic?.alignment ?? 50),
  };
  const overall = avg([
    ...engineResults.map((r) => r.verdict.score),
    scores.clarity,
    scores.distractors,
    scores.alignment,
  ].filter((n) => n !== null)) ?? (structural.valid ? 70 : 45);

  // Engine disagreement on verdict status.
  const statuses = engineResults.map((r) => r.verdict.status);
  const statusDisagree = new Set(statuses).size > 1;

  const disagreements = [];
  if (enginesDisagreeOnAnswer) {
    disagreements.push(
      `Engines disagree on the correct answer (${engineResults
        .map((r) => `${r.engine}:${r.keyIntegrity.modelAnswer || '?'}`)
        .join(', ')}).`,
    );
  }
  if (statusDisagree) {
    disagreements.push(`Engines disagree on verdict (${engineResults.map((r) => `${r.engine}:${r.verdict.status}`).join(', ')}).`);
  }

  // Final status: worst-case escalation on critical flags / disagreement.
  const hasCritical = flags.some((f) => CRITICAL_FLAGS.has(f));
  const nonCriticalFlags = flags.filter((f) => !CRITICAL_FLAGS.has(f));
  let status;
  if (hasCritical || !keyAgrees) status = 'fail';
  else if (statusDisagree || enginesDisagreeOnAnswer) status = 'review';
  else if (engineResults.length === 0) {
    // Structural-only: pass if clean, review only if structural issues found
    status = structural.valid && nonCriticalFlags.length === 0 ? 'pass' : 'review';
  } else if (overall < 65) status = 'review';
  else status = statuses.includes('fail') ? 'review' : majority(statuses) || (overall >= 70 ? 'pass' : 'review');

  // Build actionable review reasons
  const reviewReasons = [];
  if (status === 'review' || status === 'fail') {
    if (hasCritical) {
      const criticals = flags.filter((f) => CRITICAL_FLAGS.has(f));
      reviewReasons.push(...criticals.map((f) => ({
        type: 'critical', flag: f,
        message: f === 'answer-key-mismatch' ? 'Answer key does not match the correct option — verify the marked answer'
          : f === 'missing-key' ? 'No answer key provided — add the correct answer'
          : f === 'missing-options' ? 'Options are missing or incomplete — check option formatting'
          : f === 'factual-error' ? 'Possible factual error detected — verify the content'
          : f === 'unanswerable' ? 'Question may be unanswerable from the given passage/options'
          : `Critical issue: ${f}`,
      })));
    }
    if (!keyAgrees) reviewReasons.push({ type: 'key', message: 'Engines disagree with the marked answer key — verify the correct answer' });
    if (enginesDisagreeOnAnswer) reviewReasons.push({ type: 'disagreement', message: `Engines disagree on the correct answer (${engineResults.map((r) => `${r.engine}: ${r.keyIntegrity.modelAnswer || '?'}`).join(', ')})` });
    if (statusDisagree) reviewReasons.push({ type: 'disagreement', message: `Engines disagree on quality verdict (${engineResults.map((r) => `${r.engine}: ${r.verdict.status}`).join(', ')})` });
    if (scores.clarity !== null && scores.clarity < 70) reviewReasons.push({ type: 'score', message: `Low clarity score (${scores.clarity}/100) — stem may be ambiguous or poorly worded` });
    if (scores.distractors !== null && scores.distractors < 65) reviewReasons.push({ type: 'score', message: `Weak distractors (${scores.distractors}/100) — options may be too obvious or implausible` });
    if (scores.alignment !== null && scores.alignment < 65) reviewReasons.push({ type: 'score', message: `Low syllabus alignment (${scores.alignment}/100) — topic may be off-syllabus` });
    if (nonCriticalFlags.length > 0) {
      const flagMessages = {
        'short-stem': 'Question stem is very short — may lack context',
        'double-negative': 'Double negative detected in stem — may confuse candidates',
        'all-none-of-above': '"All/None of the above" option present — consider replacing with specific options',
        'duplicate-answer': 'Duplicate option text detected — check for copy errors',
        'duplicate-option-key': 'Duplicate option keys — fix option labelling',
        'grammar': 'Grammar issues detected',
        'ambiguous-stem': 'Stem is ambiguous — may have multiple valid interpretations',
      };
      for (const f of nonCriticalFlags) {
        reviewReasons.push({ type: 'flag', flag: f, message: flagMessages[f] || `Flag: ${f}` });
      }
    }
    if (overall < 65 && reviewReasons.length === 0) reviewReasons.push({ type: 'score', message: `Overall quality score is low (${overall}/100)` });
    if (reviewReasons.length === 0) reviewReasons.push({ type: 'general', message: 'Quality scores are borderline — manual review recommended' });
  }

  // Confidence: high when engines agree and multiple ran.
  let confidence = 40;
  if (engineResults.length >= 2) confidence = statusDisagree || enginesDisagreeOnAnswer ? 45 : 85;
  else if (engineResults.length === 1) confidence = 65;
  if (engineResults.length === 0) confidence = 30; // structural only

  return {
    questionId: question.id,
    number: question.number,
    stem: question.stem,
    passage: question.passage,
    options: question.options,
    answerKey: question.answerKey,
    structure: { valid: structural.valid && engineResults.every((r) => r.structure.valid), issues: dedupe([...structural.issues, ...engineResults.flatMap((r) => r.structure.issues)]) },
    keyIntegrity: {
      hasMarkedKey: Boolean(question.answerKey),
      markedKey: question.answerKey || '',
      modelAnswer: consensusAnswer || '',
      agreesWithKey: keyAgrees,
      confidence: avg(engineResults.map((r) => r.keyIntegrity.confidence)) ?? 50,
      rationale: engineResults.map((r) => r.keyIntegrity.rationale).find(Boolean) || '',
    },
    scores,
    difficulty: {
      level: majority(engineResults.map((r) => r.difficulty.level)) || 'Medium',
      score: scores.difficulty ?? 50,
    },
    alignment: {
      topic: engineResults.map((r) => r.alignment.topic).find(Boolean) || '',
      subtopic: engineResults.map((r) => r.alignment.subtopic).find(Boolean) || '',
      onSyllabus: engineResults.every((r) => r.alignment.onSyllabus),
      score: scores.alignment ?? 60,
    },
    distractorDetail: engineResults[0]?.distractors.perOption || [],
    flags,
    fixes: dedupe([
      ...engineResults.flatMap((r) => r.fixes),
      ...fixesFromFlags(flags, question),
    ]),
    disagreements,
    reviewReasons,
    verdict: { status, score: overall, confidence },
    engines: engineResults.map((r) => ({
      engine: r.engine,
      status: r.verdict.status,
      score: r.verdict.score,
      modelAnswer: r.keyIntegrity.modelAnswer,
      summary: r.verdict.summary,
    })),
  };
}

export async function analyzeQuestion(question, ctx) {
  const structural = structuralCheck(question, ctx?.rubric);
  const tasks = [];
  const llamaReady = await llamaEngine.available();
  if (llamaReady) {
    tasks.push(
      llamaEngine
        .analyzeQuestion(question, { ...ctx, examSlug: ctx?.exam?.slug })
        .then((r) => normalizeQc(r, 'llama'))
        .catch((e) => ({ engine: 'llama', error: e.message })),
    );
  }
  const settled = await Promise.all(tasks);
  const ok = settled.filter((r) => r && !r.error);
  const errors = settled.filter((r) => r && r.error);
  const result = reconcile(question, ok, structural);
  result.engineErrors = errors;
  result.mode = ok.length === 0 ? 'structural-only' : 'single-engine';
  if (ok.length === 0 && ctx?.exam?.name) {
    result.structuralNote = `Running in structural-only mode — the LLAMA service is not running. Start it with: python llama_service/app.py`;
  }
  return result;
}

// ── AI detection ensemble ─────────────────────────────────────────────
function normalizeDetect(raw, engine) {
  return {
    engine,
    aiLikelihood: clampScore(raw?.aiLikelihood, 50),
    verdict: raw?.verdict || 'Uncertain',
    confidence: clampScore(raw?.confidence, 50),
    signals: raw?.signals || [],
    humanSignals: raw?.humanSignals || [],
    rationale: raw?.rationale || '',
    metrics: raw?.metrics,
  };
}

export async function detect(text) {
  const results = [normalizeDetect(detectHeuristic(text), 'heuristic')];
  const tasks = [];
  const llamaReady = await llamaEngine.available();
  if (llamaReady) {
    tasks.push(llamaEngine.detect(text).then((r) => normalizeDetect(r, 'llama')).catch((e) => ({ engine: 'llama', error: e.message })));
  }
  const settled = await Promise.all(tasks);
  const ok = settled.filter((r) => r && !r.error);
  results.push(...ok);

  // LLM engines weighted higher than the heuristic baseline.
  const weighted = results.map((r) => ({ r, w: r.engine === 'heuristic' ? 0.5 : 1 }));
  const totalW = weighted.reduce((a, x) => a + x.w, 0);
  const aiLikelihood = Math.round(weighted.reduce((a, x) => a + x.r.aiLikelihood * x.w, 0) / totalW);

  let verdict = 'Uncertain';
  if (aiLikelihood >= 75) verdict = 'AI-generated';
  else if (aiLikelihood >= 55) verdict = 'Likely AI';
  else if (aiLikelihood <= 25) verdict = 'Human';
  else if (aiLikelihood <= 40) verdict = 'Likely Human';

  const spread = Math.max(...results.map((r) => r.aiLikelihood)) - Math.min(...results.map((r) => r.aiLikelihood));
  const confidence = clampScore(ok.length >= 1 ? (spread > 40 ? 55 : 85) : 55 - spread / 4);

  return {
    aiLikelihood,
    verdict,
    confidence,
    signals: [...new Set(results.flatMap((r) => r.signals))].slice(0, 12),
    humanSignals: [...new Set(results.flatMap((r) => r.humanSignals))].slice(0, 8),
    engines: results.map((r) => ({ engine: r.engine, aiLikelihood: r.aiLikelihood, verdict: r.verdict, rationale: r.rationale })),
    metrics: results.find((r) => r.metrics)?.metrics,
    mode: ok.length === 0 ? 'heuristic-only' : 'ensemble',
    engineErrors: settled.filter((r) => r && r.error),
  };
}
