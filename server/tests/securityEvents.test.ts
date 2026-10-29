import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { createUser, resetPassword, unlockAccount } from '../src/auth/service.js';
import { runMigrations } from '../src/db/migrate.js';
import { createLogger } from '../src/logger.js';
import { audit } from '../src/pos/audit.js';
import { loggedIn } from './authHelpers.js';
import { makeTestDb, type TestDb } from './helpers.js';

let db: TestDb;
let app: ReturnType<typeof createApp>;
beforeAll(async () => { db = await makeTestDb(); await runMigrations(db.pool); app = createApp({ pool: db.pool, logger: createLogger('silent'), signInLimit: false }); });
afterAll(() => db.drop());

const events = async (auth: string, q = '') => (await request(app).get(`/api/security/events${q}`).set('Authorization', auth));

describe('GET /api/security/events', () => {
  it('lists a lockout as urgent, with who and why, and the wrong attempts before it as warnings; newest first', async () => {
    const admin = await loggedIn(db.pool, 'admin');
    const { user } = await createUser(db.pool, { username: 'locked.out', displayName: 'Locked Out', role: 'cashier', actor: 'test-setup' });
    for (let i = 0; i < 5; i += 1) await request(app).post('/api/auth/login').send({ username: 'locked.out', password: 'wrong-wrong-1' });
    const res = await events(admin.auth);
    expect(res.status).toBe(200);
    const lock = res.body.events.find((e: { action: string }) => e.action === 'account_locked');
    expect(lock).toMatchObject({ severity: 'urgent', actor: 'locked.out', title: 'locked.out was locked out', detail: 'Too many wrong passwords.' });
    const wrong = res.body.events.filter((e: { action: string }) => e.action === 'login_failed');
    expect(wrong).toHaveLength(4);
    expect(wrong[0]).toMatchObject({ severity: 'warning', title: 'Wrong password for locked.out' });
    const ids: number[] = res.body.events.map((e: { id: number }) => e.id);
    expect(ids).toEqual([...ids].sort((a, b) => b - a));
    await unlockAccount(db.pool, { userId: user.id, actor: { id: admin.user.id, username: admin.username, role: 'admin' } as never });
  });

  it('says who did what for resets and unlocks, and a sign-in for an unknown account', async () => {
    const admin = await loggedIn(db.pool, 'admin');
    const { user } = await createUser(db.pool, { username: 'reset.me', displayName: 'Reset Me', role: 'cashier', actor: 'test-setup' });
    await resetPassword(db.pool, { userId: user.id, actor: { id: admin.user.id, username: admin.username, role: 'admin' } as never });
    await request(app).post('/api/auth/login').send({ username: 'nobody.here', password: 'x-x-x-x-1' });
    const list = (await events(admin.auth)).body.events as { action: string; title: string; detail: string | null }[];
    expect(list.find((e) => e.action === 'password_reset')).toMatchObject({ title: 'Password reset for reset.me', detail: `By ${admin.username}.` });
    expect(list.find((e) => e.action === 'login_failed' && e.title.includes('nobody.here'))?.title).toBe('Sign-in attempt for an account that does not exist: nobody.here');
    expect(list.find((e) => e.action === 'account_unlocked')).toMatchObject({ severity: 'info' });
  });

  it('leaves out routine sign-ins and sign-outs', async () => {
    const admin = await loggedIn(db.pool, 'admin');
    await request(app).post('/api/auth/logout').set('Authorization', admin.auth).send({});
    const again = await loggedIn(db.pool, 'admin');
    const actions = new Set((await events(again.auth)).body.events.map((e: { action: string }) => e.action));
    expect(actions.has('login')).toBe(false);
    expect(actions.has('logout')).toBe(false);
  });

  it('shows refunds, voids and stock changes only at or over the limits on the Security page, and follows a changed limit', async () => {
    const admin = await loggedIn(db.pool, 'admin');
    const who = { actor: 'till.person', role: 'cashier', entityType: 'sale', risk: 2 as const };
    await audit(db.pool, { ...who, action: 'refund', entityId: 9001, amountCents: 299_900 });          // KES 2,999: under the 3,000 default
    await audit(db.pool, { ...who, action: 'refund', entityId: 9002, amountCents: 300_000 });          // KES 3,000: on the limit
    await audit(db.pool, { ...who, action: 'void', entityId: 9003, amountCents: 450_000 });
    await audit(db.pool, { ...who, action: 'stock_adjusted', entityType: 'product', entityId: 1, details: { sku: 'AA-1', delta: -24, reason: 'recount' } });
    await audit(db.pool, { ...who, action: 'stock_adjusted', entityType: 'product', entityId: 1, details: { sku: 'AA-1', delta: -25, reason: 'damaged in storage' } });
    await audit(db.pool, { ...who, action: 'stock_written_off', entityType: 'product', entityId: 1, details: { sku: 'BB-2', quantity: 30, reason: 'water damage' } });
    const titles = async () => ((await events(admin.auth, '?limit=100')).body.events as { title: string }[]).map((e) => e.title);
    let t = await titles();
    expect(t).toContain('Refund of KES 3,000 by till.person');
    expect(t).toContain('Sale of KES 4,500 voided by till.person');
    expect(t).toContain('Stock adjusted by -25 on AA-1 by till.person');
    expect(t).toContain('30 written off on BB-2 by till.person');
    expect(t.some((x) => x.includes('2,999'))).toBe(false);
    expect(t.some((x) => x.includes('-24'))).toBe(false);
    expect((await events(admin.auth, '?limit=100')).body.events.find((e: { title: string }) => e.title.includes('-25')).detail).toBe('damaged in storage');

    await request(app).put('/api/security/policy').set('Authorization', admin.auth).send({ alerts: { refundKes: 2000, stockUnits: 20 } });
    t = await titles();
    expect(t).toContain('Refund of KES 2,999 by till.person');
    expect(t).toContain('Stock adjusted by -24 on AA-1 by till.person');
    expect(t).toContain('The sign-in rules were changed');
  });

  it('gives the address with a reused sign-in, and passes nothing else from a row on', async () => {
    const admin = await loggedIn(db.pool, 'admin');
    await audit(db.pool, { actor: 'reuse.victim', action: 'refresh_token_reuse', entityType: 'user', risk: 2, details: { ip: '203.0.113.9', secret: 'do-not-show' } });
    await audit(db.pool, { actor: admin.username, role: 'admin', action: 'security_policy_changed', entityType: 'settings', risk: 1, details: { before: { x: 1 }, after: { x: 2 } } });
    const body = (await events(admin.auth, '?limit=100')).body;
    expect(body.events.find((e: { action: string }) => e.action === 'refresh_token_reuse')).toMatchObject({ severity: 'urgent', ip: '203.0.113.9', title: 'A signed-out sign-in for reuse.victim was used again' });
    expect(JSON.stringify(body)).not.toMatch(/do-not-show|"before"|"after"|password_hash/);
  });

  it('pages with limit and offset and reports the total', async () => {
    const admin = await loggedIn(db.pool, 'admin');
    const all = (await events(admin.auth, '?limit=100')).body;
    const page = (await events(admin.auth, '?limit=3&offset=2')).body;
    expect(page.total).toBe(all.total);
    expect(page.events.map((e: { id: number }) => e.id)).toEqual(all.events.slice(2, 5).map((e: { id: number }) => e.id));
    expect((await events(admin.auth, '?limit=abc')).status).toBe(422);
  });

  it('is for admins only (the sign-in rules page is)', async () => {
    const manager = await loggedIn(db.pool, 'manager');
    const cashier = await loggedIn(db.pool, 'cashier');
    expect((await events(manager.auth)).status).toBe(403);
    expect((await events(cashier.auth)).status).toBe(403);
    expect((await request(app).get('/api/security/events')).status).toBe(401);
  });
});
