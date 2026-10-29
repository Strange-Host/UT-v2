import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import client, { getErrorMessage } from '../client';
import { newLeadsApi, adaptLead, resetDirectory } from './leads';
import { newProductsApi } from './products';
import list from './__fixtures__/leads-list.json';
import detail from './__fixtures__/lead-detail.json';
import created from './__fixtures__/lead-created.json';
import duplicate from './__fixtures__/lead-duplicate.json';
import lost from './__fixtures__/lead-lost.json';
import converted from './__fixtures__/lead-converted.json';
import products from './__fixtures__/products-list.json';
import staff from './__fixtures__/staff-list.json';

// Fixtures are recorded answers of the real new server (server/tests/contractFixtures.test.ts keeps them honest).
beforeEach(() => resetDirectory());
afterEach(() => { vi.restoreAllMocks(); });
const ok = (data, status = 200) => Promise.resolve({ status, data });
const refused = (status, code, message) => Promise.reject({ response: { status, data: { error: { code, message } } } });
const person = staff.users[0];
const route = (table) => (url) => (table[url] ? table[url]() : Promise.reject(new Error(`unexpected ${url}`)));

describe('a lead on the page', () => {
  it('has the legacy names: cancelled for lost, assigned_staff_name from the staff list, activities from messages', () => {
    const l = adaptLead({ ...detail.lead, status: 'lost', lostReason: 'Bought elsewhere', assignedTo: person.username }, [person]);
    expect(l).toMatchObject({ id: detail.lead.id, name: 'Achieng', status: 'cancelled', lost_reason: 'Bought elsewhere', assigned_staff_name: person.displayName });
    expect(l.activities.map((a) => a.type)).toContain('call');
    expect(l.activities[0]).toHaveProperty('content');
    expect(l.activities[0]).toHaveProperty('created_at');
  });
  it('falls back to the username when the staff list cannot be read', () => {
    expect(adaptLead({ ...detail.lead, assignedTo: 'someone' }, []).assigned_staff_name).toBe('someone');
    expect(adaptLead({ ...detail.lead, assignedTo: null }, []).assigned_staff_name).toBeNull();
  });
});

describe('the list and the numbers', () => {
  it('maps the status filter, pages in limit/offset, and answers in the legacy list shape', async () => {
    const get = vi.spyOn(client, 'get').mockImplementation(route({ '/leads': () => ok(list), '/users': () => refused(403, 'FORBIDDEN', 'No') }));
    const res = await newLeadsApi.list({ page: 2, pageSize: 10, status: 'cancelled', search: 'ach' });
    expect(get).toHaveBeenCalledWith('/leads', { params: { limit: 10, offset: 10, status: 'lost', search: 'ach' } });
    expect(res.data).toMatchObject({ page: 2, pageSize: 10, total: list.total });
    expect(res.data.data[0]).toHaveProperty('assigned_staff_name');
  });
  it('counts each status the page shows with one-row requests', async () => {
    const get = vi.spyOn(client, 'get').mockImplementation((url, cfg) => ok({ leads: [], total: { undefined: 9, new: 4, contacted: 3, converted: 1, lost: 2 }[cfg.params.status] }));
    const { data } = await newLeadsApi.stats();
    expect(data.data).toEqual({ total: 9, new: 4, contacted: 3, converted: 1, cancelled: 2 });
    expect(get.mock.calls.every(([, c]) => c.params.limit === 1)).toBe(true);
  });
  it('opens one lead with its activity', async () => {
    vi.spyOn(client, 'get').mockImplementation(route({ '/leads/5': () => ok(detail), '/users': () => ok(staff) }));
    const { data } = await newLeadsApi.getById(5);
    expect(data.data.activities.length).toBeGreaterThan(0);
  });
});

describe('a new lead', () => {
  it('sends the details, filing referral as other and an email into the notes', async () => {
    vi.spyOn(client, 'get').mockImplementation(route({ '/users': () => ok(staff) }));
    const post = vi.spyOn(client, 'post').mockReturnValue(ok(created, 201));
    const res = await newLeadsApi.create({ name: 'Achieng', phone: '0733000001', email: 'a@x.test', source: 'referral', notes: 'Size 40' });
    expect(post).toHaveBeenCalledWith('/leads', { name: 'Achieng', phone: '0733000001', source: 'other', notes: 'Size 40\nEmail: a@x.test' });
    expect(res.data.data).toMatchObject({ id: created.lead.id, duplicate: false });
  });
  it('assigns in a second step, by username found from the staff id', async () => {
    vi.spyOn(client, 'get').mockImplementation(route({ '/users': () => ok(staff) }));
    vi.spyOn(client, 'post').mockReturnValue(ok(created, 201));
    const put = vi.spyOn(client, 'put').mockReturnValue(ok({ lead: { ...created.lead, assignedTo: person.username } }));
    const res = await newLeadsApi.create({ name: 'A', phone: '0733000001', source: 'whatsapp', assigned_staff_id: String(person.id) });
    expect(put).toHaveBeenCalledWith(`/leads/${created.lead.id}/assignee`, { assignedTo: person.username });
    expect(res.data.data.assigned_staff_name).toBe(person.displayName);
  });
  it('says so when the phone already has an open lead, and does not reassign it', async () => {
    vi.spyOn(client, 'get').mockImplementation(route({ '/users': () => ok(staff) }));
    vi.spyOn(client, 'post').mockReturnValue(ok(duplicate, 200));
    const put = vi.spyOn(client, 'put');
    const res = await newLeadsApi.create({ name: 'A', phone: '0733000001', source: 'whatsapp', assigned_staff_id: String(person.id) });
    expect(res.data.data.duplicate).toBe(true);
    expect(put).not.toHaveBeenCalled();
  });
  it('refuses an assignee it cannot find, before creating anything', async () => {
    vi.spyOn(client, 'get').mockImplementation(route({ '/users': () => ok(staff) }));
    const post = vi.spyOn(client, 'post');
    await expect(newLeadsApi.create({ phone: '0733000009', assigned_staff_id: '99999' })).rejects.toMatchObject({ response: { data: { error: { code: 'LEAD_ASSIGNEE_UNKNOWN' } } } });
    expect(post).not.toHaveBeenCalled();
  });
});

describe('moving a lead', () => {
  it('sends the server status, and cancelling needs a reason', async () => {
    const put = vi.spyOn(client, 'put').mockReturnValue(ok(lost));
    const res = await newLeadsApi.changeStatus(7, 'cancelled', undefined, ' Bought elsewhere ');
    expect(put).toHaveBeenCalledWith('/leads/7/status', { status: 'lost', lostReason: 'Bought elsewhere' });
    expect(res.data.data.status).toBe('cancelled');
    await expect(newLeadsApi.changeStatus(7, 'cancelled')).rejects.toThrow(/why/i);
    await newLeadsApi.changeStatus(7, 'qualified');
    expect(put).toHaveBeenLastCalledWith('/leads/7/status', { status: 'qualified' });
  });
  it('refuses rescheduling and a direct jump to converted, with a way forward', async () => {
    const put = vi.spyOn(client, 'put');
    await expect(newLeadsApi.changeStatus(7, 'rescheduled', '2026-11-02')).rejects.toThrow(/note/);
    await expect(newLeadsApi.changeStatus(7, 'converted')).rejects.toThrow(/Convert to order/);
    expect(put).not.toHaveBeenCalled();
  });
  it('shows the server reason when a lead cannot go backwards', async () => {
    vi.spyOn(client, 'put').mockReturnValue(refused(409, 'LEAD_STATUS_BACKWARDS', 'A qualified lead cannot go back to new.'));
    const err = await newLeadsApi.changeStatus(7, 'new').catch((e) => e);
    expect(getErrorMessage(err, 'x')).toBe('A qualified lead cannot go back to new.');
  });
});

describe('activity', () => {
  it.each([
    ['call', { direction: 'note', channel: 'call', body: 'rang' }],
    ['message', { direction: 'outbound', channel: 'whatsapp', body: 'rang' }],
    ['meeting', { direction: 'note', channel: 'internal', body: 'Meeting: rang' }],
    ['note', { direction: 'note', channel: 'internal', body: 'rang' }],
  ])('logs a %s as a message', async (type, body) => {
    const post = vi.spyOn(client, 'post').mockReturnValue(ok(detail, 201));
    await newLeadsApi.addActivity(5, { type, content: 'rang' });
    expect(post).toHaveBeenCalledWith('/leads/5/messages', body);
  });
});

describe('Convert to order', () => {
  const lines = [{ product_id: products.products[0].id, quantity: '2' }];
  it('reads the product for its name and price, and notes the payment type and city', async () => {
    vi.spyOn(client, 'get').mockReturnValue(ok(products));
    const post = vi.spyOn(client, 'post').mockReturnValue(ok(converted, 201));
    const res = await newLeadsApi.convert(5, { items: lines, city: 'Nairobi', payment_type: 'cod' });
    const p = products.products[0];
    expect(post).toHaveBeenCalledWith('/leads/5/convert', { items: [{ sku: p.sku, name: p.name, quantity: 2, unitPriceCents: p.priceCents }], notes: 'Payment: cod · City: Nairobi' });
    expect(res.data.data).toMatchObject({ merged: false, order: { id: converted.order.orderRef } });
  });
  it('refuses a merge into an existing order instead of ignoring it', async () => {
    const post = vi.spyOn(client, 'post');
    await expect(newLeadsApi.convert(5, { items: lines, merge_into_order_id: 'UT-1' })).rejects.toMatchObject({ response: { data: { error: { code: 'LEAD_NO_MERGE' } } } });
    expect(post).not.toHaveBeenCalled();
  });
  it('stops on a product that is gone, and passes the server refusal through', async () => {
    vi.spyOn(client, 'get').mockReturnValue(ok(products));
    await expect(newLeadsApi.convert(5, { items: [{ product_id: 424242, quantity: 1 }] })).rejects.toMatchObject({ response: { data: { error: { code: 'PRODUCT_NOT_FOUND' } } } });
    vi.spyOn(client, 'post').mockReturnValue(refused(409, 'DUPLICATE_ACTIVE_ORDER', 'This phone number already has an active order.'));
    const err = await newLeadsApi.convert(5, { items: lines }).catch((e) => e);
    expect(getErrorMessage(err, 'x')).toMatch(/already has an active order/);
  });
});

describe('the product list for pickers', () => {
  it('gives the legacy row: sell_price in cents, search as q, paged in the legacy shape', async () => {
    const get = vi.spyOn(client, 'get').mockReturnValue(ok(products));
    const res = await newProductsApi.list({ q: 'shoe', page: 1, pageSize: 20 });
    expect(get).toHaveBeenCalledWith('/products', { params: { limit: 20, offset: 0, active: 'true', search: 'shoe' } });
    expect(res.data.data[0]).toMatchObject({ id: products.products[0].id, name: products.products[0].name, sell_price: products.products[0].priceCents });
    expect(res.data.total).toBe(products.total);
  });
  it('says "not available" for what belongs to the Products page', async () => {
    await expect(newProductsApi.create({})).rejects.toThrow(/not available on the new server yet/);
  });
});
