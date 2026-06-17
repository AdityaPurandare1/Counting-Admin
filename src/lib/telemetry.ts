import { supabase } from './supabase';
import { APP_VERSION } from './version';

/* ───────────────────────────────────────────────────────────────────────
   Client error telemetry (v0.37)

   Best-effort capture of prod errors into the `kount_client_errors` table
   (migration 0041, anon-INSERT RLS). No external SaaS. The whole thing is
   wrapped so it can NEVER throw or recurse back into itself — a broken
   logger must not take down the screen it's meant to be reporting on.

   Design:
     - throttle + dedupe: a `context|message` signature is suppressed if it
       fired within THROTTLE_MS, so a render loop or repeated rejection
       can't flood the table.
     - session cap: hard ceiling of MAX_PER_SESSION inserts per page load.
     - reentrancy guard: if an error fires while we're inside the logger
       (e.g. the insert path itself throws synchronously), we bail rather
       than re-enter.
     - fire-and-forget: the insert promise is `void`-ed, never awaited.
   ─────────────────────────────────────────────────────────────────────── */

const THROTTLE_MS = 60_000;
const MAX_PER_SESSION = 25;
const MSG_MAX = 1000;
const STACK_MAX = 4000;

/** Module-side current user email, set by the app once auth resolves so
 *  window-level handlers can attribute errors. */
let currentUserEmail: string | null = null;

/** Last-seen timestamp per `context|message` signature (dedupe window). */
const lastSeen = new Map<string, number>();
let sessionCount = 0;
let inFlight = false;

export function setTelemetryUser(email: string | null): void {
  currentUserEmail = email ?? null;
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) : s;
}

/** Pull a human-ish message + stack out of an unknown thrown value. */
function describe(err: unknown): { message: string; stack: string | null } {
  if (err instanceof Error) {
    return { message: err.message || err.name || 'Error', stack: err.stack ?? null };
  }
  if (typeof err === 'string') return { message: err, stack: null };
  if (err == null) return { message: '(no error object)', stack: null };
  try {
    return { message: JSON.stringify(err), stack: null };
  } catch {
    return { message: String(err), stack: null };
  }
}

export function logClientError(
  context: string,
  err?: unknown,
  extra?: { level?: 'error' | 'warn'; userEmail?: string | null },
): void {
  if (inFlight) return;
  inFlight = true;
  try {
    if (sessionCount >= MAX_PER_SESSION) return;

    const { message, stack } = describe(err);
    const signature = `${context}|${message}`;
    const now = Date.now();
    const prev = lastSeen.get(signature);
    if (prev !== undefined && now - prev < THROTTLE_MS) return;
    lastSeen.set(signature, now);
    sessionCount++;

    const row = {
      app: 'admin',
      app_version: APP_VERSION,
      level: extra?.level ?? 'error',
      context,
      message: truncate(message, MSG_MAX),
      stack: stack ? truncate(stack, STACK_MAX) : null,
      url: typeof location !== 'undefined' ? location.href : null,
      user_email: extra?.userEmail ?? currentUserEmail ?? null,
      venue_id: null, // admin isn't venue-scoped
      user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
    };

    // Fire-and-forget: never await-block the caller, and swallow any
    // rejection so a failed insert can't surface as another error.
    void supabase
      .from('kount_client_errors')
      .insert(row)
      .then(() => {}, () => {});
  } catch {
    /* telemetry must never throw */
  } finally {
    inFlight = false;
  }
}
