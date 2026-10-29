import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requirePermission, requireRecentAuth } from '../auth/middleware.js';
import { listSecurityEvents } from '../auth/events.js';
import { currentPolicy, updatePolicy } from '../auth/policy.js';
import type { Pool } from '../db/pool.js';
import { handler, paging, parse } from '../http.js';

const role = z.object({ lockMinutes: z.number().optional(), idleSignOutMinutes: z.number().optional(), maxHours: z.number().optional() }).strict();
const body = z.object({
  lockout: z.object({ attempts: z.number().optional(), minutes: z.number().optional() }).strict().optional(),
  roles: z.object({ cashier: role.optional(), manager: role.optional(), admin: role.optional() }).strict().optional(),
  unrememberedMaxHours: z.number().optional(),
  reauthMinutes: z.number().optional(),
  alerts: z.object({ refundKes: z.number().optional(), stockUnits: z.number().optional(), pricePercent: z.number().optional() }).strict().optional(),
}).strict();

export function securityRouter(pool: Pool): Router {
  const r = Router();
  // Admin only. Reading is free; changing the rules needs the password typed recently.
  r.use(requireAuth(pool), requirePermission('policy.manage'));
  r.get('/policy', handler(async (_req, res) => { res.json({ policy: await currentPolicy(pool) }); }));
  // What an admin should read in the audit trail, newest first: lockouts, resets, role and access changes, and refunds, voids and stock changes over the limits set on the Security page.
  r.get('/events', handler(async (req, res) => { res.json(await listSecurityEvents(pool, paging(req.query))); }));
  r.put('/policy', requireRecentAuth(), handler(async (req, res) => { res.json({ policy: await updatePolicy(pool, parse(body, req.body), req.user!) }); }));
  return r;
}
