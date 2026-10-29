import { currentPolicy } from './policy.js';
import type { Pool } from '../db/pool.js';

// "Recent security events": the part of the audit trail an admin should read, in plain words. The audit log stays the single record;
// this only chooses which rows matter and says what each one means. Routine sign-ins and sign-outs are left out.

export type Severity = 'urgent' | 'warning' | 'info';
export interface SecurityEvent { id: number; at: Date; severity: Severity; action: string; actor: string; title: string; detail: string | null; ip: string | null }

interface Row { id: string; at: Date; actor: string; action: string; amount_cents: string | null; details: Record<string, unknown> }
type D = Record<string, unknown>;
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const kes = (cents: number) => `KES ${(cents / 100).toLocaleString('en-KE', { maximumFractionDigits: 2 })}`;
const who = (r: Row) => text(r.details.username) ?? r.actor;
const by = (r: Row) => (text(r.details.username) && text(r.details.username) !== r.actor ? `By ${r.actor}.` : null);

interface Rule { severity: Severity; title: (r: Row) => string; detail?: (r: Row) => string | null }
const RULES: Record<string, Rule> = {
  account_locked: { severity: 'urgent', title: (r) => `${r.actor} was locked out`, detail: (r) => `Too many wrong ${r.details.channel === 'pin' ? 'PINs' : 'passwords'}.` },
  refresh_token_reuse: { severity: 'urgent', title: (r) => `A signed-out sign-in for ${r.actor} was used again`, detail: () => 'This can mean a copied sign-in. Changing their password ends every sign-in.' },
  user_erased: { severity: 'urgent', title: (r) => `${who(r)}'s personal data was erased`, detail: by },
  user_deleted: { severity: 'urgent', title: (r) => `${who(r)}'s account was deleted`, detail: by },
  login_blocked: { severity: 'warning', title: (r) => `${r.actor} tried to sign in while locked out` },
  login_failed: {
    severity: 'warning',
    title: (r) => (r.details.reason === 'unknown_user' ? `Sign-in attempt for an account that does not exist: ${r.actor}` : r.details.reason === 'inactive' ? `Sign-in attempt on a deactivated account: ${r.actor}` : `Wrong ${r.details.channel === 'pin' ? 'PIN' : 'password'} for ${r.actor}`),
  },
  password_change_failed: { severity: 'warning', title: (r) => `${r.actor} typed their current password wrong while changing it` },
  password_reset: { severity: 'warning', title: (r) => `Password reset for ${who(r)}`, detail: by },
  user_role_changed: { severity: 'warning', title: (r) => `${who(r)} is now ${String(r.details.to)} (was ${String(r.details.from)})`, detail: by },
  user_deactivated: { severity: 'warning', title: (r) => `${who(r)} was deactivated`, detail: by },
  permissions_changed: { severity: 'warning', title: (r) => `Access changed for ${who(r)}`, detail: by },
  security_policy_changed: { severity: 'warning', title: () => 'The sign-in rules were changed', detail: (r) => `By ${r.actor}.` },
  user_created: { severity: 'info', title: (r) => `Account created for ${who(r)}`, detail: (r) => `A ${String(r.details.role)} account, by ${r.actor}.` },
  user_reactivated: { severity: 'info', title: (r) => `${who(r)} was reactivated`, detail: by },
  user_email_changed: { severity: 'info', title: (r) => `The email for ${who(r)} was changed`, detail: by },
  account_unlocked: { severity: 'info', title: (r) => `${who(r)} was unlocked`, detail: by },
  password_changed: { severity: 'info', title: (r) => `${r.actor} changed their password` },
  pin_set: { severity: 'info', title: (r) => `A register PIN was set for ${who(r)}`, detail: by },
  pin_removed: { severity: 'info', title: (r) => `The register PIN for ${who(r)} was removed`, detail: by },
  signed_out_everywhere: { severity: 'info', title: (r) => `${who(r)} was signed out of every device`, detail: by },
  signed_out_other_devices: { severity: 'info', title: (r) => `${r.actor} signed out their other devices` },
};
const ALWAYS = Object.keys(RULES);

// The amounts and sizes an admin set on the Security page (refund, stock, price): above them, the action is worth a line here.
const LIMIT_RULES: Record<string, Rule> = {
  refund: { severity: 'warning', title: (r) => `Refund of ${kes(Number(r.amount_cents))} by ${r.actor}` },
  void: { severity: 'warning', title: (r) => `Sale of ${kes(Number(r.amount_cents))} voided by ${r.actor}` },
  stock_adjusted: { severity: 'warning', title: (r) => `Stock adjusted by ${Number(r.details.delta) > 0 ? '+' : ''}${String(r.details.delta)} on ${String(r.details.sku)} by ${r.actor}`, detail: (r) => text(r.details.reason) },
  stock_written_off: { severity: 'warning', title: (r) => `${String(r.details.quantity)} written off on ${String(r.details.sku)} by ${r.actor}`, detail: (r) => text(r.details.reason) },
};

export async function listSecurityEvents(db: Pool, opts: { limit: number; offset: number }): Promise<{ events: SecurityEvent[]; total: number }> {
  const { alerts } = await currentPolicy(db);
  const where = `(action = ANY($1)
      OR (action IN ('refund', 'void') AND amount_cents >= $2)
      OR (action = 'stock_adjusted' AND abs(COALESCE((details->>'delta')::numeric, 0)) >= $3)
      OR (action = 'stock_written_off' AND abs(COALESCE((details->>'quantity')::numeric, 0)) >= $3))`;
  const args = [ALWAYS, alerts.refundKes * 100, alerts.stockUnits];
  const total = Number((await db.query<{ n: string }>(`SELECT count(*) AS n FROM audit_log WHERE ${where}`, args)).rows[0]!.n);
  const { rows } = await db.query<Row>(
    `SELECT id, at, actor, action, amount_cents, details FROM audit_log WHERE ${where} ORDER BY id DESC LIMIT ${opts.limit} OFFSET ${opts.offset}`, args);
  const events = rows.map((r): SecurityEvent => {
    const rule = RULES[r.action] ?? LIMIT_RULES[r.action]!;
    // Only what the line says is passed on: the rest of a row's details (before and after values, notes) stays in the audit trail.
    return { id: Number(r.id), at: r.at, severity: rule.severity, action: r.action, actor: r.actor, title: rule.title(r), detail: rule.detail?.(r) ?? null, ip: text((r.details as D).ip) };
  });
  return { events, total };
}
