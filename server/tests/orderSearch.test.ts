import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listOrders } from '../src/orders/list.js';
import { makeEnv, newOrder, type Env } from './orderHelpers.js';

let env: Env;
beforeAll(async () => { env = await makeEnv(); });
afterAll(() => env.db.drop());
const find = async (search: string) => (await listOrders(env.db.pool, { search, limit: 50, offset: 0 })).orders.map((o) => o.orderRef);

describe('searching orders by phone number', () => {
  it('finds the order however the number is typed: in full, with spaces, in international form, or just its last digits', async () => {
    const o = await newOrder(env, { customerName: 'Searchable Customer', customerPhone: '0712 345 678' });
    for (const typed of ['0712345678', '0712 345 678', '+254 712 345 678', '254712345678', '712345678', '345678', '0712-345-678']) {
      expect(await find(typed), typed).toContain(o.orderRef);
    }
  });
  it('does not match a different number, and still finds by name and by reference', async () => {
    const o = await newOrder(env, { customerName: 'Another Person', customerPhone: '0722 111 222' });
    expect(await find('0733 999 000')).not.toContain(o.orderRef);
    expect(await find('Another Person')).toContain(o.orderRef);
    expect(await find(o.orderRef)).toContain(o.orderRef);
  });
  it('ignores a search with fewer than three digits for phones (so "07" does not match every order)', async () => {
    const a = await newOrder(env, { customerName: 'Short One', customerPhone: '0744 000 001' });
    expect(await find('07')).not.toContain(a.orderRef);
  });
});
