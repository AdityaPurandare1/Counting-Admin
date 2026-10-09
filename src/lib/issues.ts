/** One definition of "this entry still has an open issue".
 *
 *  An entry carries a flag (issue) and, from migration 0004, a resolution
 *  trail (issue_resolved*). Before v0.65 the Summary tile, the Variance tile
 *  and the Counts "Flagged" filter all tested the flag alone, so an issue
 *  someone had resolved kept counting and kept its orange row tint. The
 *  Issues screen already filtered on issue_resolved; now everything does. */
export interface IssueFields {
  issue?: string | null;
  issue_resolved?: boolean | null;
}

/** Flagged with a real issue kind ('none' and empty mean no issue). */
export function hasIssue(e: IssueFields): boolean {
  return !!e.issue && e.issue !== 'none';
}

/** Flagged and not yet resolved — what every count/filter/badge should show. */
export function isOpenIssue(e: IssueFields): boolean {
  return hasIssue(e) && !e.issue_resolved;
}
