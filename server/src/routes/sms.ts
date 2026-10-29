import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { requireAuth, requirePermission, requireRecentAuth } from '../auth/middleware.js';
import type { Pool } from '../db/pool.js';
import { HttpError } from '../errors.js';
import { handler } from '../http.js';
import { audit } from '../pos/audit.js';
import { getSafeCredentials, getSmsOptions, listOutbox, removeCredentials, retryMessage, saveCredentials, saveSmsOptions, sendTest, smsStatus, type SmsCtx } from '../sms/sms.js';

const adminOnly: RequestHandler = (req, _res, next) => (req.user?.role === 'admin' ? next() : next(new HttpError(403, 'FORBIDDEN', 'Only an administrator can do this.')));

const credentialsBody = z.object({ userId: z.string().trim().min(1).max(100).optional(), password: z.string().min(1).max(200).optional(), senderId: z.string().trim().max(20).optional() }).strict();
const flag = z.enum(['0', '1']);
const optionsBody = z.object({
  sms_enabled: flag, sms_send_order_received: flag, sms_send_payment_received: flag, sms_message_type: z.enum(['unicode', 'text']),
  sms_delivery_promise: z.string().trim().max(300), sms_catalog_url: z.string().trim().max(300).regex(/^(https?:\/\/\S+)?$/, 'must start with http:// or https://'),
  paybill_number: z.string().trim().regex(/^([0-9]{5,10})?$/, 'must be 5 to 10 digits'), kcb_account_prefix: z.string().trim().regex(/^[A-Za-z0-9_-]{0,20}$/, 'may use letters, digits, - and _ (up to 20)'),
}).partial().strict();
const testBody = z.object({ to: z.string().trim().min(1).max(30) }).strict();
const parse = <T>(schema: z.ZodType<T>, body: unknown): T => {
  const r = schema.safeParse(body ?? {});
  if (!r.success) throw new HttpError(422, 'VALIDATION', r.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '));
  return r.data;
};

/** Customer text messages: what is being sent, what failed, and the gateway credentials (administrators only, and never shown back). */
export function smsRouter(pool: Pool, ctx: Omit<SmsCtx, 'pool'>): Router {
  const r = Router();
  const c = { ...ctx, pool };
  r.use(requireAuth(pool));

  r.get('/status', requirePermission('sms.view'), handler(async (_req, res) => { res.json(await smsStatus(c)); }));

  r.get('/outbox', requirePermission('sms.view'), handler(async (req, res) => {
    const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '25'), 10) || 25, 1), 100);
    const page = Math.max(parseInt(String(req.query.page ?? '1'), 10) || 1, 1);
    const status = typeof req.query.status === 'string' && req.query.status ? req.query.status : undefined;
    if (status && !['queued', 'sending', 'sent', 'failed', 'expired'].includes(status)) throw new HttpError(422, 'VALIDATION', 'Unknown status.');
    res.json({ ...(await listOutbox(pool, { status, limit, offset: (page - 1) * limit })), page, limit });
  }));

  r.post('/outbox/:id/retry', requirePermission('sms.view'), handler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) throw new HttpError(422, 'VALIDATION', 'Bad message id.');
    const out = await retryMessage(pool, id);
    await audit(pool, { actor: req.user!.username, role: req.user!.role, action: 'sms_retried', entityType: 'sms_outbox', entityId: id });
    res.json(out);
  }));

  // What is sent and how customers are told to pay. Seeing it is for anyone who can see the messages; changing it is for administrators.
  r.get('/settings', requirePermission('sms.view'), handler(async (_req, res) => { res.json({ settings: await getSmsOptions(pool) }); }));

  r.put('/settings', adminOnly, requireRecentAuth(), handler(async (req, res) => {
    const { options, changed } = await saveSmsOptions(pool, parse(optionsBody, req.body), req.user!.username);
    if (Object.keys(changed).length > 0) await audit(pool, { actor: req.user!.username, role: req.user!.role, action: 'sms_settings_changed', entityType: 'settings', risk: 1, details: { changed } });
    res.json({ settings: options });
  }));

  // Credentials: flags only, never the values.
  r.get('/credentials', adminOnly, handler(async (_req, res) => { res.json(await getSafeCredentials(c)); }));

  r.put('/credentials', adminOnly, requireRecentAuth(), handler(async (req, res) => {
    const out = await saveCredentials(c, { ...parse(credentialsBody, req.body), actor: req.user!.username });
    await audit(pool, { actor: req.user!.username, role: req.user!.role, action: 'sms_credentials_updated', entityType: 'sms_credentials', risk: 2, details: { credentials_updated: true } });
    res.json(out);
  }));

  r.delete('/credentials', adminOnly, requireRecentAuth(), handler(async (req, res) => {
    const out = await removeCredentials(c);
    await audit(pool, { actor: req.user!.username, role: req.user!.role, action: 'sms_credentials_removed', entityType: 'sms_credentials', risk: 2, details: { credentials_removed: true } });
    res.json(out);
  }));

  // A test costs real credit and reaches a third party.
  r.post('/test', adminOnly, requireRecentAuth(), handler(async (req, res) => {
    const out = await sendTest(c, parse(testBody, req.body).to);
    await audit(pool, { actor: req.user!.username, role: req.user!.role, action: 'sms_test_sent', entityType: 'sms_outbox', risk: 1, details: { to: out.to, ok: out.ok } });
    res.json(out);
  }));

  return r;
}
