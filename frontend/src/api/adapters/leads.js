import client from '../client';
import { AdapterError, mapResponse, notImplemented, toLegacyPage, toLimitOffset } from './common';

// Leads on the new server. Differences from the legacy pipeline (see docs/parity-harness/README.md):
//  - Statuses: new, contacted, qualified, converted, and "cancelled" (the server's `lost`, which needs a reason). There is no "rescheduled".
//  - Someone is assigned by username; the page picks by staff id, so people are looked up in /users (best effort: a cashier cannot read it).
//  - No email field: an email typed on a new lead is added to its notes. "referral" is not a source; it files as "other".
//  - A call/message/note on a lead is a message with a direction and channel.
//  - Convert: the server takes items, prices and a name. Payment type and city go into the order notes; merging into an existing order is not offered.

const SOURCE_OUT = { referral: 'other' };
export const toServerStatus = (s) => (s === 'cancelled' ? 'lost' : s);
export const toPageStatus = (s) => (s === 'lost' ? 'cancelled' : s);

let directory = { at: 0, people: [] };
export const resetDirectory = () => { directory = { at: 0, people: [] }; };
async function people() {
  if (Date.now() - directory.at < 30_000 && directory.people.length) return directory.people;
  try {
    const res = await client.get('/users');
    directory = { at: Date.now(), people: res.data.users };
  } catch { /* a role without staff.view just sees usernames */ }
  return directory.people;
}
const nameOf = (list, username) => (username ? (list.find((u) => u.username === username)?.displayName ?? username) : null);

const activityType = (m) => (m.channel === 'call' ? 'call' : m.direction === 'note' ? 'note' : 'message');

export function adaptLead(l, list = []) {
  return {
    id: l.id, name: l.name ?? '', phone: l.phone, email: null, source: l.source,
    form_name: null, interested_product_name: l.productInterest ?? null,
    notes: l.notes ?? '', status: toPageStatus(l.status), lost_reason: l.lostReason ?? null,
    assigned_to: l.assignedTo ?? null, assigned_staff_name: nameOf(list, l.assignedTo),
    converted_order_id: l.convertedOrderRef ?? null,
    created_at: l.createdAt, updated_at: l.updatedAt,
    ...(l.messages ? { activities: l.messages.map((m) => ({ id: m.id, type: activityType(m), content: m.body, created_at: m.at, staff_name: nameOf(list, m.actor) })) } : {}),
  };
}

const ACTIVITY_OUT = {
  call: { direction: 'note', channel: 'call' },
  message: { direction: 'outbound', channel: 'whatsapp' },
  meeting: { direction: 'note', channel: 'internal', prefix: 'Meeting: ' },
  note: { direction: 'note', channel: 'internal' },
};

export const newLeadsApi = {
  list: async (params = {}) => {
    const { limit, offset } = toLimitOffset(params);
    const q = { limit, offset, ...(params.status ? { status: toServerStatus(params.status) } : {}), ...(params.search ? { search: params.search } : {}) };
    const [res, list] = await Promise.all([client.get('/leads', { params: q }), people()]);
    return { ...res, data: toLegacyPage(res.data.leads.map((l) => adaptLead(l, list)), res.data.total, { page: params.page, pageSize: limit }) };
  },
  // The server has no counts; one tiny request per number the page shows.
  stats: async () => {
    const count = (status) => client.get('/leads', { params: { limit: 1, ...(status ? { status } : {}) } }).then((r) => r.data.total);
    const [total, n, contacted, converted, lost] = await Promise.all([count(), count('new'), count('contacted'), count('converted'), count('lost')]);
    return { status: 200, data: { data: { total, new: n, contacted, converted, cancelled: lost } } };
  },
  getById: async (id) => {
    const [res, list] = await Promise.all([client.get(`/leads/${id}`), people()]);
    return { ...res, data: { data: adaptLead(res.data.lead, list) } };
  },
  create: async ({ name, phone, email, source, notes, assigned_staff_id: staffId }) => {
    const note = [String(notes ?? '').trim(), email ? `Email: ${String(email).trim()}` : ''].filter(Boolean).join('\n');
    let username = null;
    if (staffId) {
      username = (await people()).find((u) => String(u.id) === String(staffId))?.username;
      if (!username) throw new AdapterError('LEAD_ASSIGNEE_UNKNOWN', 'That staff member could not be found.');
    }
    const res = await client.post('/leads', { name: name || undefined, phone, source: SOURCE_OUT[source] ?? source ?? 'manual', ...(note ? { notes: note } : {}) });
    let lead = res.data.lead;
    // Assigned in a second step: the server's create has no assignee. A repeat enquiry (duplicate) keeps whoever has it.
    if (username && !res.data.duplicate) lead = (await client.put(`/leads/${lead.id}/assignee`, { assignedTo: username })).data.lead;
    return { ...res, data: { data: { ...adaptLead(lead, await people()), duplicate: Boolean(res.data.duplicate) } } };
  },
  update: async (id, { name, notes } = {}) => {
    const body = { ...(name !== undefined ? { name } : {}), ...(notes !== undefined ? { notes } : {}) };
    return mapResponse(client.patch(`/leads/${id}`, body), (d) => ({ data: adaptLead(d.lead) }));
  },
  // `reason` is the fourth argument: cancelling needs one. There is no follow-up date, and converting is its own call.
  changeStatus: async (id, status, followUpDate, reason) => {
    if (status === 'rescheduled') throw new AdapterError('LEAD_NO_RESCHEDULE', 'Leads cannot be rescheduled on the new server. Log a note instead.');
    if (status === 'converted') throw new AdapterError('LEAD_USE_CONVERT', 'Use "Convert to order" to make an order from this lead.');
    const body = { status: toServerStatus(status), ...(status === 'cancelled' ? { lostReason: String(reason ?? '').trim() } : {}) };
    if (status === 'cancelled' && !body.lostReason) throw new AdapterError('LEAD_LOST_REASON_REQUIRED', 'Say why this lead was cancelled.');
    return mapResponse(client.put(`/leads/${id}/status`, body), (d) => ({ data: adaptLead(d.lead) }));
  },
  addActivity: (id, { type = 'note', content }) => {
    const m = ACTIVITY_OUT[type] ?? ACTIVITY_OUT.note;
    return mapResponse(client.post(`/leads/${id}/messages`, { direction: m.direction, channel: m.channel, body: `${m.prefix ?? ''}${content}` }), (d) => ({ data: adaptLead(d.lead) }));
  },
  remove: notImplemented('leadsApi.remove'),

  // items: [{ product_id, quantity }] -> the server wants name and price, so the products are read first.
  convert: async (id, { items = [], city, payment_type: paymentType, merge_into_order_id: mergeInto }) => {
    if (mergeInto) throw new AdapterError('LEAD_NO_MERGE', 'Adding to an existing order is not available on the new server yet. Finish or cancel that order first.');
    const found = [];
    for (let offset = 0; ; offset += 100) {
      const { data } = await client.get('/products', { params: { limit: 100, offset } });
      found.push(...data.products);
      if (found.length >= data.total || !data.products.length) break;
    }
    const lines = items.map((i) => {
      const p = found.find((x) => x.id === Number(i.product_id));
      if (!p) throw new AdapterError('PRODUCT_NOT_FOUND', 'One of the products could not be found. Reload and try again.');
      return { sku: p.sku, name: p.name, quantity: Number(i.quantity), unitPriceCents: p.priceCents };
    });
    const notes = [paymentType ? `Payment: ${paymentType}` : '', city ? `City: ${city}` : ''].filter(Boolean).join(' · ');
    const res = await client.post(`/leads/${id}/convert`, { items: lines, ...(notes ? { notes } : {}) });
    return { ...res, data: { data: { order: { ...res.data.order, id: res.data.order.orderRef }, merged: false } } };
  },
};
