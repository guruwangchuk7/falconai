/**
 * Extract the JSON object from a model reply, tolerating markdown code fences / surrounding prose.
 * Models (e.g. Haiku 4.5) frequently wrap replies in ```json … ``` despite "reply with ONLY JSON",
 * which makes a bare JSON.parse throw — the failure mode that silently zeroed out live extraction
 * (found 2026-09-03). Slice from the first '{' to the last '}'. Returns null if no object is present.
 * Shared by every model-output parser so the tolerance can't drift between them.
 */
export function sliceJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  return text.slice(start, end + 1);
}
