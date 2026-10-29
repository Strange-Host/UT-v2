import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { createUser, updateUser } from '../src/auth/service.js';
import { runMigrations } from '../src/db/migrate.js';
import { createLogger } from '../src/logger.js';
import { markAbsent } from '../src/payroll/attendance.js';
import { shopDate } from '../src/payroll/time.js';
import { loggedIn } from './authHelpers.js';
import { makeTestDb, type TestDb } from './helpers.js';

let db: TestDb;
let app: ReturnType<typeof createApp>;
beforeAll(async () => { db = await makeTestDb(); await runMigrations(db.pool); app = createApp({ pool: db.pool, logger: createLogger('silent'), signInLimit: false }); });
afterAll(() => db.drop());
const today = () => shopDate(new Date());

describe('GET /api/payroll/attendance/today', () => {
  it('lists every active account with what is recorded today: in, out, absent with a reason, or nothing', async () => {
    const manager = await loggedIn(db.pool, 'manager');
    const cashier = await loggedIn(db.pool, 'cashier');
    const { user: away } = await createUser(db.pool, { username: 'away.today', displayName: 'Away Today', role: 'cashier', actor: 'test-setup' });
    const { user: gone } = await createUser(db.pool, { username: 'left.shop', displayName: 'Left Shop', role: 'cashier', actor: 'test-setup' });
    await updateUser(db.pool, { userId: gone.id, active: false, actor: { id: manager.user.id, username: manager.username, role: 'manager' } as never });
    await request(app).post('/api/payroll/attendance/clock-in').set('Authorization', cashier.auth).send({});
    await markAbsent(db.pool, { staffKey: away.username, workDate: today(), reason: 'Sick, called in', actor: manager.username });

    const res = await request(app).get('/api/payroll/attendance/today').set('Authorization', manager.auth);
    expect(res.status).toBe(200);
    expect(res.body.date).toBe(today());
    const by = (key: string) => res.body.staff.find((s: { staffKey: string }) => s.staffKey === key);
    expect(by(cashier.username)).toMatchObject({ userId: cashier.user.id, role: 'cashier', clockOutAt: null, absenceReason: null });
    expect(by(cashier.username).clockInAt).toBeTruthy();
    expect(by('away.today')).toMatchObject({ clockInAt: null, absenceReason: 'Sick, called in' });
    expect(by(manager.username)).toMatchObject({ clockInAt: null, clockOutAt: null, absenceReason: null });
    expect(by('left.shop')).toBeUndefined(); // deactivated
    const names: string[] = res.body.staff.map((s: { name: string }) => s.name.toLowerCase());
    expect(names).toEqual([...names].sort());
  });

  it('shows the clock-out once they clock out, and any other day by date', async () => {
    const manager = await loggedIn(db.pool, 'manager');
    const cashier = await loggedIn(db.pool, 'cashier');
    await request(app).post('/api/payroll/attendance/clock-in').set('Authorization', cashier.auth).send({});
    await request(app).post('/api/payroll/attendance/clock-out').set('Authorization', cashier.auth).send({});
    const now = (await request(app).get('/api/payroll/attendance/today').set('Authorization', manager.auth)).body.staff;
    expect(now.find((s: { staffKey: string }) => s.staffKey === cashier.username).clockOutAt).toBeTruthy();
    const past = await request(app).get('/api/payroll/attendance/today?date=2020-01-02').set('Authorization', manager.auth);
    expect(past.body.date).toBe('2020-01-02');
    expect(past.body.staff.every((s: { clockInAt: unknown }) => s.clockInAt === null)).toBe(true);
    expect((await request(app).get('/api/payroll/attendance/today?date=yesterday').set('Authorization', manager.auth)).status).toBe(422);
  });

  it('is for people who may see the team (a cashier may not), and needs a sign-in', async () => {
    const cashier = await loggedIn(db.pool, 'cashier');
    expect((await request(app).get('/api/payroll/attendance/today').set('Authorization', cashier.auth)).status).toBe(403);
    expect((await request(app).get('/api/payroll/attendance/today')).status).toBe(401);
  });
});
