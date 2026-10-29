/** Reading a typed quantity (v0.77).
 *
 *  Every qty box in the app is an <input type="number">, and those report ''
 *  both when the box is cleared and when what was typed isn't a number. The
 *  callers did `Number(draft)`, and Number('') is 0 — so clearing a cell, or a
 *  typo, quietly saved a count of zero over a real one (Counts entry rows, the
 *  Add-entry card, the Variance edit row).
 *
 *  null means "no usable number": the caller reverts or refuses. A typed "0"
 *  is a real count and comes back as 0. Negative counts are refused here too,
 *  since every caller already rejected them. */
export function parseQtyDraft(draft: string | null | undefined): number | null {
  const s = String(draft ?? '').trim();
  if (s === '') return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}
