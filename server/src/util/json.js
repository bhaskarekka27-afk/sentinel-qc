/**
 * Extract a JSON object from an LLM response that may be wrapped in prose or
 * ```json fences. Returns null if nothing parseable is found.
 */
export function extractJson(text) {
  if (!text || typeof text !== 'string') return null;
  let s = text.trim();

  // Strip code fences.
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();

  try {
    return JSON.parse(s);
  } catch {
    /* try to locate the outermost object */
  }

  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start !== -1 && end > start) {
    const candidate = s.slice(start, end + 1);
    try {
      return JSON.parse(candidate);
    } catch {
      return null;
    }
  }
  return null;
}

export function clampScore(n, fallback = 0) {
  const v = Number(n);
  if (Number.isFinite(v)) return Math.max(0, Math.min(100, Math.round(v)));
  return fallback;
}
