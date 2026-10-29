import type { KountAudit } from './types';

/** Words for count_phase (v0.77). The stored tokens (count1 / review / count2 /
 *  final) drive logic and queries and stay as they are; this is only what a
 *  person reads. Before, "count2" and "Advance to count2" reached the screen. */
const PHASE_LABELS: Record<string, string> = {
  count1: 'Count 1',
  review: 'Recount review',
  count2: 'Count 2',
  final:  'Final',
};

export function phaseLabel(phase: string | null | undefined): string {
  if (!phase) return '';
  return PHASE_LABELS[phase] ?? phase;
}

/** One word for where an audit stands: the phase while it is active, else its
 *  status ('submitted' / 'cancelled'), which already reads as a word. */
export function auditStageLabel(a: Pick<KountAudit, 'status' | 'count_phase'>): string {
  return a.status === 'active' ? phaseLabel(a.count_phase) : a.status;
}
