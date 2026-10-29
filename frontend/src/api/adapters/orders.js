import client from '../client';
import { AdapterError, mapResponse, notImplemented, toLegacyPage, toLimitOffset } from './common';
import { people } from './directory';

// The Orders page, on the new server. The new engine models an order differently from the legacy app, so this file does three jobs:
//   1. reshape what the server sends into what the page reads (ids, snake_case, one combined legacy status, history lines);
//   2. turn the page's calls into the new server's calls (and enforce, here, the few things the page used to leave to the old backend);
//   3. refuse, with a clear message, what the new engine deliberately does not do (see PAYMENT_ELSEWHERE).
// The page's `id` for an order is its reference (UT-XXXXXXXX): the page treats ids as opaque, and the new server addresses orders by reference.

const SENT = ['dispatched', 'delivered'];

/** The one status the legacy page shows: delivery and payment together. */
export function legacyStatus(o) {
  if (o.status === 'awaiting_dispatch' || o.status === 'cancelled') return o.status;
  if (SENT.includes(o.status)) return { unpaid: 'dispatched_unpaid', part_paid: 'dispatched_partial', paid: 'dispatched_paid' }[o.paymentStatus] || 'dispatched_unpaid';
  if (o.status === 'returning') return 'returned_in_transit';
  if (o.status === 'returned') {
    const problem = o.returnProblem ?? (o.returned ? o.returned.damaged + o.returned.missing > 0 : false);
    return problem ? 'returned_damaged' : 'returned_resellable';
  }
  return o.status;
}

/** What is still owed on the order. Cancelled and returned orders owe nothing: the unpaid part was taken off sales. */
const outstanding = (o) => (['cancelled', 'returned'].includes(o.status) ? 0 : Math.max(o.balanceCents ?? 0, 0));

export function adaptOrderSummary(o) {
  return {
    id: o.orderRef,
    product_code: o.orderRef,
    channel: 'manual', // Shopify / WooCommerce orders arrive with the integrations (Phase F)
    income_source_name: null,
    customer_name: o.customerName,
    customer_phone: o.customerPhone,
    customer_risk_flag: null,
    dispute_status: null,
    status: legacyStatus(o),
    total: o.totalCents,
    amount_paid: o.paidCents ?? 0,
    outstanding: outstanding(o),
    courier_name: o.courierName ?? null,
    created_at: o.createdAt,
    dispatched_at: o.dispatchedAt ?? null,
  };
}

const kes = (cents) => `KES ${(cents / 100).toLocaleString('en-KE', { minimumFractionDigits: cents % 100 ? 2 : 0 })}`;

/** One line of the order's history, in words. The page prints `notes` when from and to are the same. */
export function describeEvent(e) {
  const d = e.data || {};
  switch (e.type) {
    case 'created': return 'Order created';
    case 'confirmed': return 'Confirmed with the customer';
    case 'dispatched': return `Dispatched with ${d.courier || 'a courier'}${d.package_fee_cents !== undefined ? ` (package fee ${kes(d.package_fee_cents)})` : ''}`;
    case 'delivery_delivered': return 'Delivered';
    case 'delivery_not_claimed': return `Not claimed${d.reason ? `: ${d.reason}` : ''}`;
    case 'delivery_refused': return `Refused${d.reason ? `: ${d.reason}` : ''}`;
    case 'delivery_rescheduled': return `Delivery rescheduled${d.reschedule_for ? ` to ${d.reschedule_for}` : ''}${d.reason ? `: ${d.reason}` : ''}`;
    case 'returning': return 'Parcel is coming back';
    case 'returned': return `Returned parcel counted in: ${d.restocked ?? 0} restocked, ${d.damaged ?? 0} damaged, ${d.missing ?? 0} missing`;
    case 'cancelled': return `Cancelled${d.reason ? `: ${d.reason}` : ''}`;
    case 'payment_received': return `Payment received${d.amount_cents ? ` (${kes(d.amount_cents)})` : ''}`;
    case 'suspense_applied': return `Unmatched payment applied${d.amount_cents ? ` (${kes(d.amount_cents)})` : ''}`;
    case 'shop_cash_recorded': return `Cash taken at the shop${d.amount_cents ? ` (${kes(d.amount_cents)})` : ''}${d.reason ? `: ${d.reason}` : ''}`;
    case 'collected_by_organization': return `Collected by the courier organization${d.amount_cents ? ` (${kes(d.amount_cents)})` : ''}`;
    default: return e.type.replace(/_/g, ' ');
  }
}

// The courier picked on the page before dispatch. The new server takes the courier and the fee together, at dispatch, so the
// choice is held here until then.
const chosenCourier = new Map();

export function adaptOrderDetail(o) {
  const status = legacyStatus(o);
  const courierId = o.dispatch?.courierId ?? chosenCourier.get(o.orderRef) ?? null;
  return {
    id: o.orderRef,
    product_code: o.orderRef,
    status,
    delivery_status: o.status, // 'dispatched' until an outcome is recorded; 'delivered' after
    channel: 'manual',
    customer: { name: o.customerName, phone: o.customerPhone, city: null, prepay_required: 0 },
    delivery_zone: null,
    items: o.items.map((i) => ({ id: i.id, quantity: i.quantity, product_name: i.name, line_total: i.lineTotalCents, unit_price: i.unitPriceCents })),
    // The package fee is what the courier is paid, not something the customer is charged, so it is not shown as a delivery charge.
    delivery_fee: 0,
    package_fee: o.dispatch ? o.dispatch.packageFeeCents : null,
    courier: o.dispatch ? { id: o.dispatch.courierId, name: o.dispatch.courierName } : null,
    courier_id: courierId,
    total: o.totalCents,
    amount_paid: o.paidCents,
    outstanding: outstanding(o),
    // An order with money already in is prepaid; anything else is collected on delivery, and needs the confirming call first.
    payment_type: o.paidCents > 0 ? 'prepaid' : 'cod',
    cod_confirmed_at: o.confirmedAt ?? null,
    owner_decision: null,
    dispute_status: null,
    attempts: o.attempts,
    returned: o.returned ?? null,
    status_history: o.events.map((e, i) => ({
      id: i + 1, from_status: status, to_status: status, changed_at: e.at, changed_by_name: e.actor, notes: describeEvent(e),
    })),
    created_at: o.createdAt,
  };
}

/** Legacy status filter -> the new server's filters. null means nothing can match (that state does not exist on the new server). */
export function statusFilter(legacy) {
  if (!legacy) return {};
  switch (legacy) {
    case 'awaiting_dispatch': return { status: 'awaiting_dispatch' };
    case 'dispatched_unpaid': return { status: 'dispatched,delivered', paymentStatus: 'unpaid' };
    case 'dispatched_partial': return { status: 'dispatched,delivered', paymentStatus: 'part_paid' };
    case 'dispatched_paid': return { status: 'dispatched,delivered', paymentStatus: 'paid' };
    case 'returned_in_transit': return { status: 'returning' };
    case 'returned_resellable': return { status: 'returned', returnProblem: 'false' };
    case 'returned_damaged': return { status: 'returned', returnProblem: 'true' };
    case 'cancelled': return { status: 'cancelled' };
    default: return null; // returned_awaiting_inspection: arrival and counting are one step now
  }
}

const empty = (page, pageSize) => ({ status: 200, data: { ...toLegacyPage([], 0, { page, pageSize }), summary: { outstanding: 0 } } });
const refOf = (id) => encodeURIComponent(String(id));

// Why a payment cannot be typed in against an order any more, in the words the page shows.
/** The page's item lines -> the server's: it wants the code, name and unit price, so a product is read when only its id is given. */
async function toLines(items) {
  if (!Array.isArray(items) || items.length === 0) throw new AdapterError('ORDER_NO_ITEMS', 'Add at least one item.');
  return Promise.all(items.map(async (i) => {
    const quantity = Math.max(1, Math.floor(Number(i.quantity) || 1));
    const discountCents = Number.isInteger(i.discount) && i.discount > 0 ? { discountCents: i.discount } : {};
    if (i.name && Number.isInteger(i.unit_price)) return { ...(i.sku ? { sku: i.sku } : {}), name: i.name, quantity, unitPriceCents: i.unit_price, ...discountCents };
    const { data } = await client.get(`/products/${encodeURIComponent(String(i.product_id))}`);
    return { sku: data.product.sku, name: data.product.name, quantity, unitPriceCents: i.unit_price ?? data.product.priceCents, ...discountCents };
  }));
}

/** What a pull did, as the "Pull online orders" box words it. */
export function adaptPull(r, days) {
  const notes = [];
  if (r.needsReview > 0) notes.push(`${r.needsReview} order${r.needsReview === 1 ? '' : 's'} could not be taken as they stand and ${r.needsReview === 1 ? 'is' : 'are'} kept for a person to look at.`);
  if (r.needsAttention > 0) notes.push(`${r.needsAttention} cancelled in the store ${r.needsAttention === 1 ? 'is' : 'are'} not cancelled here: money was paid on ${r.needsAttention === 1 ? 'it' : 'them'} or ${r.needsAttention === 1 ? 'it is' : 'they are'} already out for delivery.`);
  return {
    found: r.found, imported: r.imported, cancelled: r.cancelled, skipped: r.unchanged, ignored: r.ignored,
    failed: r.failed + r.needsReview, errors: r.errors, days: days ?? null, ...(notes.length ? { hint: notes.join(' ') } : {}),
  };
}

export const PAYMENT_ELSEWHERE = 'M-Pesa, bank and card payments arrive on their own and are matched to the order under Finance > Reconciliation. Only cash taken at the shop can be recorded here.';

const RETURN_REASON_TEXT = { rejected: 'Customer rejected the parcel', damaged: 'Parcel arrived damaged', wrong_item: 'Wrong item sent' };

export const newOrdersApi = {
  list: (params = {}) => {
    const { page, pageSize, limit, channel, status, search } = params;
    const size = pageSize ?? limit;
    const filters = statusFilter(status);
    // Shopify and WooCommerce orders arrive with the integrations (Phase F); until then those tabs are simply empty.
    if (filters === null || channel === 'shopify' || channel === 'wordpress') return Promise.resolve(empty(page, size));
    const q = { ...toLimitOffset({ page, pageSize: size }), search: search || undefined, ...filters };
    return mapResponse(client.get('/orders', { params: q }), (d) => ({
      ...toLegacyPage(d.orders.map(adaptOrderSummary), d.total, { page, pageSize: q.limit }),
      summary: { outstanding: d.summary?.outstandingCents ?? 0 },
    }));
  },
  get: (id) => mapResponse(client.get(`/orders/${refOf(id)}`), (d) => ({ data: adaptOrderDetail(d.order) })),

  // "Confirm with customer"
  confirmCod: (id) => client.post(`/orders/${refOf(id)}/confirm`, {}),

  // The Boda / G4S buttons are gone: the new engine dispatches with a named rider or organization. Picking one is remembered here until dispatch.
  setCourier: notImplemented('ordersApi.setCourier'),
  assignCourier: (id, courierId) => { chosenCourier.set(String(id), Number(courierId)); return Promise.resolve({ status: 200, data: { data: { id, courier_id: Number(courierId) } } }); },

  // The package fee is entered by hand at every dispatch (Rule 11): the page passes it as { packageFee: { cents, zeroReason } }.
  dispatch: (id, opts = {}) => {
    const courierId = chosenCourier.get(String(id));
    if (!courierId) return Promise.reject(new AdapterError('DISPATCH_NEEDS_COURIER', 'Choose the rider or organization this is going with before dispatching.'));
    const fee = opts.packageFee;
    if (!fee || !Number.isInteger(fee.cents) || fee.cents < 0) return Promise.reject(new AdapterError('DISPATCH_NEEDS_FEE', 'Enter the package fee for this dispatch.'));
    return client.post(`/orders/${refOf(id)}/dispatch`, { courierId, packageFee: { amountCents: fee.cents, ...(fee.zeroReason ? { zeroReason: fee.zeroReason } : {}) } })
      .then((res) => { chosenCourier.delete(String(id)); return res; });
  },

  // A reason is required (it is kept with the order).
  cancel: (id, notes) => client.post(`/orders/${refOf(id)}/cancel`, { reason: notes }),

  // Delivery outcomes: delivered, not claimed, refused, rescheduled. New on the page.
  recordOutcome: (id, { outcome, reason, rescheduleFor }) => client.post(`/orders/${refOf(id)}/attempts`, { outcome, ...(reason ? { reason } : {}), ...(rescheduleFor ? { rescheduleFor } : {}) }),

  // "Parcel is coming back": the customer did not take it.
  returnedInTransit: (id, data = {}) => client.post(`/orders/${refOf(id)}/attempts`, { outcome: 'refused', reason: RETURN_REASON_TEXT[data.reason_code] || 'The customer did not take the parcel' }),

  // Counting the returned parcel in, line by line (replaces "arrived" + "inspect"). New on the page.
  receiveReturn: (id, { items, notes }) => client.post(`/orders/${refOf(id)}/returned`, { items, ...(notes ? { notes } : {}) }),
  returnedAwaitingInspection: notImplemented('ordersApi.returnedAwaitingInspection'),
  inspect: notImplemented('ordersApi.inspect'),

  // Cash over the counter is the one payment a person records by hand (a manager, with a reason). Everything else is matched.
  recordPayment: (id, { method, amount, reference }) => {
    if (method !== 'cash') return Promise.reject(new AdapterError('PAYMENT_ARRIVES_ELSEWHERE', PAYMENT_ELSEWHERE, 409));
    return client.post(`/orders/${refOf(id)}/shop-cash`, { amountCents: amount, reason: reference || 'Cash paid at the shop' });
  },

  // Adding items to an order that is still waiting to leave the shop (the merge when a phone number already has an active order).
  mergeItems: async (id, items) => mapResponse(client.post(`/orders/${refOf(id)}/items`, { items: await toLines(items) }), (d) => ({ data: adaptOrderDetail(d.order) })),

  // A new order made by hand. Items are { product_id, quantity } (the product's code, name and price are read here) or
  // { sku, name, unit_price, quantity } in cents; `discount` is in cents. A phone that already has an active order is refused with
  // the server's message (the reference of that order is in the error's details).
  create: async ({ customer_name: name, customer_phone: phone, items, discount, notes, assigned_staff_id: staffId } = {}) => {
    let assignedTo;
    if (staffId) {
      assignedTo = (await people()).find((u) => String(u.id) === String(staffId))?.username;
      if (!assignedTo) throw new AdapterError('STAFF_NOT_FOUND', 'That staff member could not be found.');
    }
    const body = { customerName: name, customerPhone: phone, items: await toLines(items), ...(discount ? { discountCents: discount } : {}), ...(notes ? { notes } : {}), ...(assignedTo ? { assignedTo } : {}) };
    return mapResponse(client.post('/orders', body), (d) => ({ data: adaptOrderDetail(d.order) }));
  },
  // The stores that can be pulled from: [{ id, name, platform }].
  onlineSources: () => mapResponse(client.get('/online-orders/connections'), (d) => ({ data: d.connections })),
  // Brings in what still needs shipping. Orders the server keeps for a person to look at count with the ones that could not be added.
  pullOnline: (sourceId, days) => mapResponse(client.post('/online-orders/pull', { sourceId, ...(days ? { days } : {}) }), (d) => ({ data: adaptPull(d, days) })),
  ownerDecision: notImplemented('ordersApi.ownerDecision'),
  pendingOwnerDecision: notImplemented('ordersApi.pendingOwnerDecision'),
  openDispute: notImplemented('ordersApi.openDispute'),
  resolveDispute: notImplemented('ordersApi.resolveDispute'),
};
