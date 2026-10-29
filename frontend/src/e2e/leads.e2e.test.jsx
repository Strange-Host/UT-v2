// @vitest-environment-options {"url":"http://localhost:5173"}
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import client from '../api/client';
import { authApi, leadsApi, productsApi } from '../api/endpoints';
import { AuthProvider } from '../context/AuthContext';
import { ToastProvider, DialogProvider } from '../context/UIContext';
import Leads from '../pages/Leads';

// Only `npm run test:e2e-new-server` sets this. The normal run has no server to talk to, so these suites are skipped.
const RUN_E2E = import.meta.env.VITE_E2E_NEW_SERVER === 'true';

// The Leads page on the REAL new server: over HTTP, nothing mocked.  (server/: npm run dev:stack, then frontend/: npm run test:e2e-new-server)
const ADMIN = { email: 'admin@shop.test', password: 'Admin-Dev-Passphrase-1' };
let n = 0;
const tag = () => `${Date.now().toString(36)}${++n}`;
const phone = () => `0744${String(100000 + ++n + Math.floor(Math.random() * 800000)).slice(0, 6)}`;
const api = async (method, path, body) => (await client({ method, url: path, data: body })).data;
const button = (name) => screen.getByRole('button', { name });

function Page() {
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ToastProvider><DialogProvider><AuthProvider>
        <MemoryRouter><Leads /></MemoryRouter>
      </AuthProvider></DialogProvider></ToastProvider>
    </QueryClientProvider>
  );
}
const lead = async (over = {}) => (await api('post', '/leads', { name: `Lead ${tag()}`, phone: phone(), source: 'whatsapp', ...over })).lead;
async function open(name) {
  fireEvent.change(screen.getByPlaceholderText(/Search name or phone/), { target: { value: name } });
  const row = (await screen.findByText(name)).closest('tr');
  fireEvent.click(within(row).getByRole('button', { name: 'Open' }));
  await screen.findByRole('button', { name: 'Close' });
}

beforeAll(async () => {
  const health = await client.get('/health').catch((e) => e);
  if (!health?.status) throw new Error(`The new server is not reachable (${health?.message}). Start it with: cd server && npm run dev:stack`);
  await authApi.login(ADMIN.email, ADMIN.password);
}, 30_000);
afterEach(() => { cleanup(); });

describe.skipIf(!RUN_E2E)('the Leads page against the real new server', () => {
  it('creates a lead through the form, assigns it, and lists it with its status and assignee', async () => {
    const who = `Created ${tag()}`;
    render(<Page />);
    fireEvent.click(await screen.findByRole('button', { name: '+ New lead' }));
    await screen.findByRole('heading', { name: 'New lead' });
    const inputs = [...document.querySelectorAll('form input')]; // name, phone, email
    fireEvent.change(inputs[0], { target: { value: who } });
    fireEvent.change(inputs[1], { target: { value: phone() } });
    fireEvent.change(inputs[2], { target: { value: 'buyer@shop.test' } });
    const assignee = await waitFor(() => { const s = [...document.querySelectorAll('form select')].find((x) => [...x.options].some((o) => o.text === 'Unassigned')); if (![...s.options].some((o) => /Admin/.test(o.text))) throw new Error('staff not loaded'); return s; });
    fireEvent.change(assignee, { target: { value: [...assignee.options].find((o) => /Admin/.test(o.text)).value } });
    fireEvent.click(button('Create'));
    const row = (await screen.findByText(who)).closest('tr');
    expect(within(row).getByText('New')).toBeInTheDocument();
    expect(within(row).getByText('Admin (sample)')).toBeInTheDocument();
    const stored = (await api('get', '/leads?search=' + encodeURIComponent(who))).leads[0];
    expect(stored).toMatchObject({ source: 'walk_in', assignedTo: 'admin' }); // the form's default source
    expect(stored.notes).toBe('Email: buyer@shop.test');
  }, 40_000);

  it('tells you when the phone already has an open lead, and makes no second one', async () => {
    const l = await lead();
    render(<Page />);
    fireEvent.click(await screen.findByRole('button', { name: '+ New lead' }));
    await screen.findByRole('heading', { name: 'New lead' });
    const inputs = [...document.querySelectorAll('form input')];
    fireEvent.change(inputs[0], { target: { value: 'Same Person' } });
    fireEvent.change(inputs[1], { target: { value: l.phone } });
    fireEvent.click(button('Create'));
    expect(await screen.findByText(/already has an open lead/)).toBeInTheDocument();
    expect((await api('get', `/leads?search=${l.phone.slice(-6)}`)).total).toBe(1);
  }, 30_000);

  it('moves a lead forward, logs a call, and cancels it only with a reason', async () => {
    const l = await lead();
    render(<Page />);
    await open(l.name);
    expect(screen.queryByRole('button', { name: 'Reschedule' })).toBeNull();
    fireEvent.click(button('Contacted'));
    await waitFor(async () => expect((await api('get', `/leads/${l.id}`)).lead.status).toBe('contacted'));
    fireEvent.click(await screen.findByRole('button', { name: 'Qualified' }));
    await waitFor(async () => expect((await api('get', `/leads/${l.id}`)).lead.status).toBe('qualified'));

    fireEvent.change(screen.getByDisplayValue('Call'), { target: { value: 'call' } });
    fireEvent.change(screen.getByPlaceholderText('Log an activity…'), { target: { value: 'Rang, will pay Friday' } });
    fireEvent.click(button('Add'));
    expect(await screen.findByText('Rang, will pay Friday')).toBeInTheDocument();
    expect(screen.getByText(/Call$/)).toBeInTheDocument();

    fireEvent.click(button('Cancelled'));
    const reason = await screen.findByRole('textbox', { name: '' }).catch(() => null) ?? document.querySelector('input[type="text"], textarea');
    fireEvent.change(reason, { target: { value: 'Bought elsewhere' } });
    fireEvent.click(screen.getByRole('button', { name: /^OK$/ }));
    await waitFor(async () => expect((await api('get', `/leads/${l.id}`)).lead).toMatchObject({ status: 'lost', lostReason: 'Bought elsewhere' }));
  }, 40_000);

  it('shows the counts above the list', async () => {
    await lead();
    render(<Page />);
    await waitFor(() => expect(screen.getByText('Total').parentElement.textContent).toMatch(/\d/));
    expect(screen.getAllByText('Cancelled').length).toBeGreaterThan(1); // the count tile and the filter option
  }, 30_000);

  it('converts a lead into an order through the adapter, using a product from the real list', async () => {
    const sku = `E2E-${tag()}`;
    const p = (await api('post', '/products', { sku, name: `E2E shoe ${sku}`, priceCents: 120_000, costCents: 50_000 })).product;
    await api('post', `/products/${p.id}/receive`, { quantity: 5, unitCostCents: 50_000 });
    const rows = (await productsApi.list({ q: sku, pageSize: 20 })).data.data;
    expect(rows[0]).toMatchObject({ id: p.id, sell_price: 120_000 });
    const l = await lead();
    const res = (await leadsApi.convert(l.id, { items: [{ product_id: p.id, quantity: 2 }], city: 'Nairobi', payment_type: 'cod' })).data.data;
    expect(res.order.id).toMatch(/^UT-/);
    const order = (await api('get', `/orders/${res.order.id}`)).order;
    expect(order).toMatchObject({ totalCents: 240_000 });
    expect((await api('get', `/leads/${l.id}`)).lead).toMatchObject({ status: 'converted', convertedOrderRef: res.order.id });
  }, 40_000);
});
