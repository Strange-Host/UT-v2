import type { Pool } from '../db/pool.js';
import { withTransaction } from '../db/tx.js';
import { audit } from '../pos/audit.js';
import { HttpError } from '../errors.js';
import { hashPassword } from './password.js';
import { assertStrongPassword } from './passwordPolicy.js';

export interface FirstAdminInput { username?: string; password?: string; name?: string }

/**
 * Creates the first admin from FIRST_ADMIN_USERNAME / FIRST_ADMIN_PASSWORD when, and only when, the shop has no accounts at all.
 * It is a no-op on every later start, so the variables can safely stay set, but remove the password afterwards anyway.
 * The password is the one the owner chose; the account is still forced to change it at first sign-in.
 * Returns what happened so the caller can log it (never the password).
 */
export async function bootstrapFirstAdmin(pool: Pool, input: FirstAdminInput): Promise<'created' | 'skipped-not-configured' | 'skipped-users-exist'> {
  const username = input.username?.trim().toLowerCase();
  if (!username || !input.password) return 'skipped-not-configured';
  if (!/^[a-z0-9][a-z0-9._-]{1,31}$/.test(username)) {
    throw new HttpError(422, 'BAD_USERNAME', 'FIRST_ADMIN_USERNAME must be 2 to 32 characters: lowercase letters, digits, dot, dash or underscore.');
  }
  const displayName = input.name?.trim() || username;
  assertStrongPassword(input.password, { role: 'admin', username, displayName });
  const hash = await hashPassword(input.password);
  return withTransaction(pool, async (c) => {
    // Serialise concurrent starts: only one of them sees an empty table.
    await c.query('LOCK TABLE users IN EXCLUSIVE MODE');
    const { rows } = await c.query<{ n: string }>('SELECT count(*) AS n FROM users');
    if (Number(rows[0]?.n ?? 0) > 0) return 'skipped-users-exist' as const;
    const ins = await c.query<{ id: number }>(
      `INSERT INTO users (username, display_name, role, password_hash, must_change_password, created_by) VALUES ($1, $2, 'admin', $3, true, 'first-admin-env') RETURNING id`,
      [username, displayName, hash]);
    await audit(c, { actor: 'first-admin-env', action: 'user_created', entityType: 'user', entityId: ins.rows[0]!.id, risk: 1, details: { username, role: 'admin', via: 'FIRST_ADMIN_* variables' } });
    return 'created' as const;
  });
}
