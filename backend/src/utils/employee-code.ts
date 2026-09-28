/**
 * V1.9: Employee IDs are compared without case and punctuation, so
 * 2026/SEP/06, 2026/sep/06 and 2026-sep-06 are the same person.
 * (STWI format: yyyy/mmm/code, month in upper or lower case.)
 */
export function codeKey(code: string | null | undefined) {
  return String(code ?? '').replace(/[^a-z0-9]/gi, '').toLowerCase();
}
