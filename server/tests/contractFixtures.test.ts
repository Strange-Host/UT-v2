import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { createUser } from '../src/auth/service.js';
import { runMigrations } from '../src/db/migrate.js';
import { createLogger } from '../src/logger.js';
import { makeTestDb, type TestDb } from './helpers.js';
import { loggedIn } from './authHelpers.js';
import { KEY } from './orderHelpers.js';
import { ingestPaybillPayment, recordShopCash } from '../src/orders/payments.js';

// The frontend adapters are tested against recorded answers of THIS server (frontend/src/api/adapters/__fixtures__). This test
// fails when the server's answers stop having the same shape as the recording, so a server change cannot quietly break a screen.
// Re-record on purpose with:  UPDATE_FIXTURES=1 npx vitest run tests/contractFixtures.test.ts
const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../frontend/src/api/adapters/__fixtures__');
const UPDATE = process.env.UPDATE_FIXTURES === '1';

let db: TestDb;
beforeAll(async () => { db = await makeTestDb(); await runMigrations(db.pool); });
afterAll(() => db.drop());

/** The shape of a value: every string becomes "<string>", and so on. Arrays keep the shape of their first element. */
function shape(v: unknown): unknown {
  if (v === null) return '<null>';
  if (Array.isArray(v)) return v.length ? [shape(v[0])] : [];
  if (typeof v === 'object') return Object.fromEntries(Object.entries(v as object).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, shape(x)]));
  return `<${typeof v}>`;
}
/** Dates are strings on the wire; a null where a date may be is the same field. */
const sameShape = (a: unknown, b: unknown): void => { expect(JSON.stringify(shape(a)).replaceAll('"<null>"', '"<string>"')).toBe(JSON.stringify(shape(b)).replaceAll('"<null>"', '"<string>"')); };

function check(name: string, live: unknown): void {
  const file = path.join(DIR, `${name}.json`);
  if (UPDATE || !existsSync(file)) { mkdirSync(DIR, { recursive: true }); writeFileSync(file, `${JSON.stringify(live, null, 2)}\n`); return; }
  sameShape(live, JSON.parse(readFileSync(file, 'utf8')));
}

describe('what the staff screens read from the server', () => {
  it('keeps the sign-in, refresh, who-am-I, unlock and devices answers in the shape the recorded fixtures have', async () => {
    const app = createApp({ pool: db.pool, logger: createLogger('silent') });
    const { temporaryPassword } = await createUser(db.pool, { username: 'fixture.manager', displayName: 'Fixture Manager', role: 'manager', email: 'fixture@shop.test', actor: 'test-setup' });
    const first = await request(app).post('/api/auth/login').send({ email: 'fixture@shop.test', password: temporaryPassword });
    const pw = 'Violet-Harbour-2291'; // must satisfy the password rules, and not contain the account's own name
    await request(app).post('/api/auth/change-password').set('Authorization', `Bearer ${first.body.token}`).send({ currentPassword: temporaryPassword, newPassword: pw });

    const login = await request(app).post('/api/auth/login').send({ email: 'fixture@shop.test', password: pw, remember: true });
    const cookie = ([] as string[]).concat(login.headers['set-cookie'] ?? []).find((c) => c.startsWith('ut_refresh_token='))!.split(';')[0]!;
    const auth = `Bearer ${login.body.token}`;
    const refresh = await request(app).post('/api/auth/refresh').set('Cookie', cookie);
    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${refresh.body.token}`);
    const unlock = await request(app).post('/api/auth/unlock').set('Authorization', `Bearer ${refresh.body.token}`).send({ password: pw });
    const sessions = await request(app).get('/api/auth/sessions').set('Authorization', `Bearer ${refresh.body.token}`);
    const wrong = await request(app).post('/api/auth/login').send({ email: 'fixture@shop.test', password: 'wrong-wrong-1' });
    expect([login.status, refresh.status, me.status, unlock.status, sessions.status, wrong.status]).toEqual([200, 200, 200, 200, 200, 401]);
    void auth;

    const scrub = (b: Record<string, unknown>) => ({ ...b, ...(b.token ? { token: 'ACCESS_TOKEN' } : {}) });
    check('auth-login', scrub(login.body));
    check('auth-refresh', scrub(refresh.body));
    check('auth-me', me.body);
    check('auth-unlock', unlock.body);
    check('auth-sessions', sessions.body);
    check('auth-error', wrong.body);
  });
});

describe('what the Orders screen reads from the server', () => {
  it('keeps the list, an order out for delivery, a returned order and the courier list in the recorded shape', async () => {
    const app = createApp({ pool: db.pool, logger: createLogger('silent'), orderRefKey: KEY });
    const mgr = await loggedIn(db.pool, 'manager');
    const as = (r: request.Test) => r.set('Authorization', mgr.auth);
    const rider = (await as(request(app).post('/api/couriers/riders')).send({ name: 'Peter Rider', phone: '0700123456' })).body.courier;
    const make = async (phone: string) => (await as(request(app).post('/api/orders')).send({ customerName: 'Wanjiku', customerPhone: phone, items: [{ sku: 'FX-1', name: 'Canvas shoe', quantity: 2, unitPriceCents: 250_000 }] })).body.order.orderRef as string;
    const sent = await make('0755000001');
    await as(request(app).post(`/api/orders/${sent}/confirm`)).send({});
    await as(request(app).post(`/api/orders/${sent}/dispatch`)).send({ courierId: rider.id, packageFee: { amountCents: 30_000 } });
    const back = await make('0755000002');
    await as(request(app).post(`/api/orders/${back}/confirm`)).send({});
    await as(request(app).post(`/api/orders/${back}/dispatch`)).send({ courierId: rider.id, packageFee: { amountCents: 30_000 } });
    await as(request(app).post(`/api/orders/${back}/attempts`)).send({ outcome: 'refused', reason: 'Customer rejected the parcel' });
    const detail = (await as(request(app).get(`/api/orders/${back}`))).body.order;
    await as(request(app).post(`/api/orders/${back}/returned`)).send({ items: [{ orderItemId: detail.items[0].id, restockQuantity: 1, damagedQuantity: 1 }], notes: 'One pair scuffed' });

    const list = await as(request(app).get('/api/orders?limit=50'));
    const out = await as(request(app).get(`/api/orders/${sent}`));
    const returned = await as(request(app).get(`/api/orders/${back}`));
    const couriers = await as(request(app).get('/api/couriers?active=true'));
    expect([list.status, out.status, returned.status, couriers.status]).toEqual([200, 200, 200, 200]);
    expect(returned.body.order.status).toBe('returned');
    check('orders-list', list.body);
    check('order-out-for-delivery', out.body);
    check('order-returned', returned.body);
    check('couriers-list', couriers.body);
  });
});

describe('what the Finance screens read from the server', () => {
  it('keeps the receipts list, a suspense item with its suggestions, and the cash held in the recorded shape', async () => {
    const app = createApp({ pool: db.pool, logger: createLogger('silent'), orderRefKey: KEY });
    const mgr = await loggedIn(db.pool, 'manager');
    const as = (r: request.Test) => r.set('Authorization', mgr.auth);
    const make = async (phone: string) => (await as(request(app).post('/api/orders')).send({ customerName: 'Wanjiku', customerPhone: phone, items: [{ sku: 'FX-1', name: 'Canvas shoe', quantity: 2, unitPriceCents: 250_000 }] })).body.order.orderRef as string;
    const paid = await make('0755000011');
    const cashOrder = await make('0755000012');
    const waiting = await make('0755000013');
    await ingestPaybillPayment({ pool: db.pool }, { transCode: 'FIX0000001', amountCents: 200_000, payerName: 'Wanjiku', accountRef: paid });
    await ingestPaybillPayment({ pool: db.pool }, { transCode: 'FIX0000002', amountCents: 500_000, payerName: 'A friend', accountRef: 'no such code' });
    await recordShopCash({ pool: db.pool }, { orderRef: cashOrder, amountCents: 100_000, reason: 'Paid at the counter', actor: mgr.username });

    const receipts = await as(request(app).get('/api/payments?limit=50'));
    const suspense = await as(request(app).get('/api/payments/suspense'));
    const suggestions = await as(request(app).get(`/api/payments/suspense/${suspense.body.items[0].exceptionId}/suggestions`));
    const custody = await as(request(app).get('/api/custody'));
    expect([receipts.status, suspense.status, suggestions.status, custody.status]).toEqual([200, 200, 200, 200]);
    expect(suggestions.body.suggestions.map((s: { orderRef: string }) => s.orderRef)).toContain(waiting);
    check('payments-list', receipts.body);
    check('payments-suspense', suspense.body);
    check('payments-suggestions', suggestions.body);
    check('custody-list', custody.body);
  });
});

describe('what the Staff screens read from the server', () => {
  it('keeps the staff list, a new account with its one-time password, a reset, the removal check, permissions and sign-out in the recorded shape', async () => {
    const app = createApp({ pool: db.pool, logger: createLogger('silent') });
    const admin = await loggedIn(db.pool, 'admin');
    const as = (r: request.Test) => r.set('Authorization', admin.auth);

    const created = await as(request(app).post('/api/users')).send({ username: 'fixture.cashier', displayName: 'Fixture Cashier', role: 'cashier', email: 'cashier.fixture@shop.test', phone: '0712000111', pin: '4829' });
    const id = created.body.user.id as number;
    const list = await as(request(app).get('/api/users'));
    const one = await as(request(app).get(`/api/users/${id}`));
    const reset = await as(request(app).post(`/api/users/${id}/reset-password`)).send({});
    const unlock = await as(request(app).post(`/api/users/${id}/unlock-account`)).send({});
    const signedOut = await as(request(app).post(`/api/users/${id}/sign-out-everywhere`)).send({});
    const sessions = await as(request(app).get(`/api/users/${id}/sessions`));
    const check_ = await as(request(app).get(`/api/users/${id}/removal-check`));
    const perms = await as(request(app).get(`/api/users/${id}/permissions`));
    const changed = await as(request(app).put(`/api/users/${id}/permissions`)).send({ overrides: { 'reports.view': true } });
    const reactivate = await as(request(app).post(`/api/users/${id}/reactivate`)).send({});
    expect([created.status, list.status, one.status, reset.status, unlock.status, signedOut.status, sessions.status, check_.status, perms.status, changed.status, reactivate.status])
      .toEqual([201, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200]);
    expect(changed.body.permissions.find((p: { key: string }) => p.key === 'reports.view').override).toBe(true);

    // Passwords never appear in a person's own record, only in the two answers that issue one.
    expect(JSON.stringify([list.body, one.body, unlock.body])).not.toMatch(/temporaryPassword|password_hash|pin_hash|scrypt/i);
    const scrub = (b: Record<string, unknown>) => ({ ...b, ...(b.temporaryPassword ? { temporaryPassword: 'ONE-TIME-PASSWORD' } : {}) });
    check('staff-list', list.body);
    check('staff-created', scrub(created.body));
    check('staff-reset', scrub(reset.body));
    check('staff-unlock', unlock.body);
    check('staff-sign-out', signedOut.body);
    check('staff-sessions', sessions.body);
    check('staff-removal-check', check_.body);
    check('staff-permissions', changed.body);
    check('staff-reactivate', reactivate.body);
  });
});

describe('what the Leads screens read from the server', () => {
  it('keeps the lead list, one lead with its messages, a repeat enquiry, a conversion and the product list in the recorded shape', async () => {
    const app = createApp({ pool: db.pool, logger: createLogger('silent'), orderRefKey: KEY });
    const mgr = await loggedIn(db.pool, 'manager');
    const as = (r: request.Test) => r.set('Authorization', mgr.auth);
    const product = (await as(request(app).post('/api/products')).send({ sku: 'LD-1', name: 'Lead shoe', category: 'Shoes', priceCents: 250_000, costCents: 100_000 })).body.product;
    await as(request(app).post(`/api/products/${product.id}/receive`)).send({ quantity: 10, unitCostCents: 100_000 });

    const made = await as(request(app).post('/api/leads')).send({ name: 'Achieng', phone: '0733000001', source: 'whatsapp', notes: 'Wants size 40' });
    const again = await as(request(app).post('/api/leads')).send({ phone: '0733000001', message: 'Still interested' });
    const id = made.body.lead.id as number;
    await as(request(app).post(`/api/leads/${id}/messages`)).send({ direction: 'note', channel: 'call', body: 'Called, no answer' });
    await as(request(app).put(`/api/leads/${id}/status`)).send({ status: 'contacted' });
    await as(request(app).put(`/api/leads/${id}/assignee`)).send({ assignedTo: mgr.username });
    const list = await as(request(app).get('/api/leads?limit=25'));
    const one = await as(request(app).get(`/api/leads/${id}`));
    const second = (await as(request(app).post('/api/leads')).send({ name: 'Otieno', phone: '0733000002' })).body.lead.id as number;
    const lost = await as(request(app).put(`/api/leads/${second}/status`)).send({ status: 'lost', lostReason: 'Bought elsewhere' });
    const converted = await as(request(app).post(`/api/leads/${id}/convert`)).send({ items: [{ sku: 'LD-1', name: 'Lead shoe', quantity: 1, unitPriceCents: 250_000 }], notes: 'Payment: cod' });
    const products = await as(request(app).get('/api/products?limit=50&active=true'));
    expect([made.status, again.status, list.status, one.status, lost.status, converted.status, products.status]).toEqual([201, 200, 200, 200, 200, 201, 200]);
    expect(again.body.duplicate).toBe(true);
    check('leads-list', list.body);
    check('lead-detail', one.body);
    check('lead-created', made.body);
    check('lead-duplicate', again.body);
    check('lead-lost', lost.body);
    check('lead-converted', converted.body);
    check('products-list', products.body);
  });
});
