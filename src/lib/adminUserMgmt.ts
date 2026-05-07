// Client wrapper around the admin-user-mgmt Edge Function.
//
// All admin actions that touch auth.users (invite / reset / disable /
// enable / delete) MUST go through this wrapper rather than calling the
// Supabase Auth Admin API directly — the service-role key required for
// those calls cannot ship to a browser.
//
// Caller's identity comes from the Supabase session. The Edge Function
// re-validates the JWT on the server, then re-checks app_users.role ===
// 'corporate' before doing anything privileged. So even if a manager
// somehow learned the function URL, they can't bypass.

import { supabase, SUPABASE_URL } from './supabase';
import type { Role } from './types';

const FUNCTION_URL = SUPABASE_URL + '/functions/v1/admin-user-mgmt';

export interface InviteArgs {
  email: string;
  name?: string;
  role: Role;
  venue_ids?: string[];
  redirect_to?: string;  // where the invite link sends the user (defaults to current origin)
}

export interface UpdateProfileArgs {
  email: string;
  name?: string;
  role?: Role;
  venue_ids?: string[];
  is_active?: boolean;
}

interface OkResponse {
  ok: true;
  email?: string;
  action: string;
  user_id?: string;
  updated_fields?: string[];
  action_link?: string | null;
  note?: string;
  // True when invite resolved against an existing auth.users row (likely
  // from a sibling app on the same Supabase project) — we just added the
  // user to app_users; no invite email was sent because they already
  // have credentials.
  linked_existing_user?: boolean;
  // Sibling apps the user is also tagged with via auth.users.user_metadata.apps.
  // Surfaced on link-existing AND on smart-delete so admin can see the
  // cross-app context.
  other_apps?: string[];
  // True on delete when the auth.users account was preserved because the
  // user is multi-app — we only removed app_users + stripped the kount tag.
  kept_auth_account?: boolean;

  // migrate_legacy fields
  dry_run?: boolean;
  total_active?: number;
  already_authed?: number;
  would_invite_count?: number;
  would_invite?: Array<{ email: string; name: string | null; role: string }>;
  invited?: number;
  failed?: number;
  results?: Array<{ email: string; ok: boolean; user_id?: string; error?: string }>;
}

interface ErrorResponse {
  error: string;
}

class AdminFunctionError extends Error {
  status: number;
  detail: string;
  constructor(status: number, detail: string) {
    super('admin-user-mgmt ' + status + ': ' + detail);
    this.status = status;
    this.detail = detail;
  }
}

async function callAdminFunction(payload: Record<string, unknown>): Promise<OkResponse> {
  // Pull the live session every call — autoRefreshToken can rotate the
  // access_token mid-session, and a stale token will 401.
  const { data: { session }, error: sessionErr } = await supabase.auth.getSession();
  if (sessionErr) throw new AdminFunctionError(401, 'Failed to read session: ' + sessionErr.message);
  if (!session) throw new AdminFunctionError(401, 'Sign in via Supabase Auth required for this action.');

  let res: Response;
  try {
    res = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + session.access_token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    throw new AdminFunctionError(0, 'Network error: ' + ((e as Error).message || 'unreachable'));
  }

  let body: OkResponse | ErrorResponse;
  try {
    body = await res.json() as OkResponse | ErrorResponse;
  } catch {
    throw new AdminFunctionError(res.status, 'Non-JSON response (HTTP ' + res.status + ')');
  }

  if (!res.ok || ('error' in body)) {
    const detail = ('error' in body) ? body.error : 'unknown';
    throw new AdminFunctionError(res.status, detail);
  }

  return body;
}

export const adminUserMgmt = {
  invite(args: InviteArgs) {
    const redirect = args.redirect_to || window.location.origin;
    return callAdminFunction({ action: 'invite', ...args, redirect_to: redirect });
  },

  disable(email: string) {
    return callAdminFunction({ action: 'disable', email });
  },

  enable(email: string) {
    return callAdminFunction({ action: 'enable', email });
  },

  delete(email: string) {
    return callAdminFunction({ action: 'delete', email });
  },

  resetPassword(email: string, redirectTo?: string) {
    const redirect = redirectTo || window.location.origin;
    return callAdminFunction({ action: 'reset_password', email, redirect_to: redirect });
  },

  updateProfile(args: UpdateProfileArgs) {
    return callAdminFunction({ action: 'update_profile', ...args });
  },

  // Phase 5 one-shot tool: invites every active app_users row that
  // doesn't yet have a Supabase Auth account. Always dry-run first to
  // confirm the candidate list before sending real invite emails.
  migrateLegacy(opts: { dryRun: boolean; redirectTo?: string }) {
    const redirect = opts.redirectTo || window.location.origin;
    return callAdminFunction({
      action: 'migrate_legacy',
      dry_run: opts.dryRun,
      redirect_to: redirect,
    });
  },
};

export { AdminFunctionError };
