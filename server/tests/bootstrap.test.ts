import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { bootstrapFirstAdmin } from '../src/auth/bootstrap.js';
import { runMigrations } from '../src/db/migrate.js';
import { createLogger } from '../src/logger.js';
import { makeTestDb, type TestDb } from './helpers.js';

let db: TestDb;
const STRONG = 'Correct-Horse-Battery-77';
beforeAll(async () => { db = await makeTestDb(); await runMigrations(db.pool); });
afterAll(() => db.drop());

describe('first admin from variables', () => {
  it('does nothing when not configured', async () => {
    expect(await bootstrapFirstAdmin(db.pool, {})).toBe('skipped-not-configured');
    expect(await bootstrapFirstAdmin(db.pool, { username: 'owner' })).toBe('skipped-not-configured');
  });
  it('refuses a weak password and a bad username, creating nothing', async () => {
    await expect(bootstrapFirstAdmin(db.pool, { username: 'owner', password: 'password123' })).rejects.toThrow();
    await expect(bootstrapFirstAdmin(db.pool, { username: 'Bad Name!', password: STRONG })).rejects.toThrow();
    const { rows } = await db.pool.query('SELECT count(*)::int AS n FROM users');
    expect(rows[0].n).toBe(0);
  });
  it('creates an admin who can sign in with the chosen password and must change it', async () => {
    expect(await bootstrapFirstAdmin(db.pool, { username: 'Owner', password: STRONG, name: 'Martha' })).toBe('created');
    const res = await request(createApp({ pool: db.pool, logger: createLogger('silent') })).post('/api/auth/login').send({ username: 'owner', password: STRONG });
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).toMatch(/mustChangePassword"?:\s*true/);
  });
  it('is a no-op once any account exists', async () => {
    expect(await bootstrapFirstAdmin(db.pool, { username: 'second', password: STRONG })).toBe('skipped-users-exist');
    const { rows } = await db.pool.query('SELECT count(*)::int AS n FROM users');
    expect(rows[0].n).toBe(1);
  });
});
