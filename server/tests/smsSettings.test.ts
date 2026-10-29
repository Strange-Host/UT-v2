import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { createLogger } from '../src/logger.js';
import { runMigrations } from '../src/db/migrate.js';
import { smsStatus } from '../src/sms/sms.js';
import { loggedIn } from './authHelpers.js';
import { makeTestDb, type TestDb } from './helpers.js';

let db: TestDb;
let app: ReturnType<typeof createApp>;
beforeAll(async () => { db = await makeTestDb(); await runMigrations(db.pool); app = createApp({ pool: db.pool, logger: createLogger('silent'), signInLimit: false }); });
afterAll(() => db.drop());

describe('the SMS options (what is sent, how customers are told to pay)', () => {
  it('start at the defaults: switched off, both messages on, unicode, the usual delivery promise', async () => {
    const mgr = await loggedIn(db.pool, 'manager');
    const res = await request(app).get('/api/sms/settings').set('Authorization', mgr.auth);
    expect(res.status).toBe(200);
    expect(res.body.settings).toEqual({
      sms_enabled: '0', sms_send_order_received: '1', sms_send_payment_received: '1', sms_message_type: 'unicode',
      sms_delivery_promise: 'It will be delivered within the next 24 hours.', sms_catalog_url: '', paybill_number: '', kcb_account_prefix: '',
    });
  });

  it('saves only what is sent, leaves the rest, and the status and the next read show it', async () => {
    const admin = await loggedIn(db.pool, 'admin');
    const put = await request(app).put('/api/sms/settings').set('Authorization', admin.auth).send({ sms_enabled: '1', paybill_number: ' 522522 ', kcb_account_prefix: '8025631' });
    expect(put.status).toBe(200);
    expect(put.body.settings).toMatchObject({ sms_enabled: '1', paybill_number: '522522', kcb_account_prefix: '8025631', sms_message_type: 'unicode' });
    const again = await request(app).get('/api/sms/settings').set('Authorization', admin.auth);
    expect(again.body.settings).toEqual(put.body.settings);
    expect((await smsStatus({ pool: db.pool })).enabled).toBe(true);

    await request(app).put('/api/sms/settings').set('Authorization', admin.auth).send({ sms_delivery_promise: 'Within 2 days.', sms_catalog_url: 'https://shop.example.com/catalog', sms_message_type: 'text', sms_send_payment_received: '0' });
    const now = (await request(app).get('/api/sms/settings').set('Authorization', admin.auth)).body.settings;
    expect(now).toMatchObject({ sms_enabled: '1', paybill_number: '522522', sms_delivery_promise: 'Within 2 days.', sms_catalog_url: 'https://shop.example.com/catalog', sms_message_type: 'text', sms_send_payment_received: '0' });
  });

  it('records what changed in the audit trail, and nothing when nothing changed', async () => {
    const admin = await loggedIn(db.pool, 'admin');
    const count = async () => Number((await db.pool.query(`SELECT count(*) AS n FROM audit_log WHERE action = 'sms_settings_changed'`)).rows[0].n);
    const before = await count();
    await request(app).put('/api/sms/settings').set('Authorization', admin.auth).send({ paybill_number: '600100' });
    expect(await count()).toBe(before + 1);
    const row = (await db.pool.query(`SELECT actor, risk, details FROM audit_log WHERE action = 'sms_settings_changed' ORDER BY id DESC LIMIT 1`)).rows[0];
    expect(row).toMatchObject({ actor: admin.username, risk: 1, details: { changed: { paybill_number: ['522522', '600100'] } } });
    await request(app).put('/api/sms/settings').set('Authorization', admin.auth).send({ paybill_number: '600100' }); // same value again
    expect(await count()).toBe(before + 1);
  });

  it.each([
    [{ sms_enabled: 'yes' }, /sms_enabled/],
    [{ sms_message_type: 'binary' }, /sms_message_type/],
    [{ paybill_number: '12ab' }, /5 to 10 digits/],
    [{ sms_catalog_url: 'shop.example.com' }, /http/],
    [{ kcb_account_prefix: 'has space' }, /letters, digits/],
    [{ sms_sender_id: 'NEW' }, /sms_sender_id|Unrecognized/],
    [{ business_name: 'Other' }, /business_name|Unrecognized/],
  ])('refuses %j', async (body, reason) => {
    const admin = await loggedIn(db.pool, 'admin');
    const res = await request(app).put('/api/sms/settings').set('Authorization', admin.auth).send(body);
    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body)).toMatch(reason);
  });

  it('can be seen by a manager, but only an administrator changes it; a cashier sees nothing', async () => {
    const mgr = await loggedIn(db.pool, 'manager');
    const cashier = await loggedIn(db.pool, 'cashier');
    expect((await request(app).put('/api/sms/settings').set('Authorization', mgr.auth).send({ sms_enabled: '0' })).status).toBe(403);
    expect((await request(app).get('/api/sms/settings').set('Authorization', cashier.auth)).status).toBe(403);
    expect((await request(app).get('/api/sms/settings')).status).toBe(401);
  });
});
