// @vitest-environment-options {"url":"http://localhost:5173"}
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import client, { getErrorMessage } from '../api/client';
import { authApi, ordersApi } from '../api/endpoints';
import { AuthProvider } from '../context/AuthContext';
import { ToastProvider, DialogProvider } from '../context/UIContext';
import PullOnlineOrders from '../components/PullOnlineOrders';

// Only `npm run test:e2e-new-server` sets this. The normal run has no server to talk to, so these suites are skipped.
const RUN_E2E = import.meta.env.VITE_E2E_NEW_SERVER === 'true';

// Making an order by hand, and the Pull online orders box, on the REAL new server: over HTTP, nothing mocked.
// (server/: npm run dev:stack, then frontend/: npm run test:e2e-new-server). The dev server has no online store connected,
// so the box shows its "no store" state; a real pull from a store is covered by the server's own tests and the adapter's recorded answers.
const ADMIN = { email: 'admin@shop.test', password: 'Admin-Dev-Passphrase-1' };
const api = async (method, path, body) => (await client({ method, url: path, data: body })).data;
let n = 0;
const phone = () => `0766${String(100000 + ++n * 7 + Math.floor(Math.random() * 500000)).slice(0, 6)}`;

beforeAll(async () => {
  const health = await client.get('/health').catch((e) => e);
  if (!health?.status) throw new Error(`The new server is not reachable (${health?.message}). Start it with: cd server && npm run dev:stack`);
  await authApi.login(ADMIN.email, ADMIN.password);
}, 30_000);
afterEach(() => { cleanup(); });

describe.skipIf(!RUN_E2E)('making an order by hand, against the real new server', () => {
  it('creates an order from a product id, shows it in the Orders list, and refuses a second active order for the same phone', async () => {
    const sku = `E2E-${Date.now().toString(36)}`;
    const product = (await api('post', '/products', { sku, name: `Order shoe ${sku}`, priceCents: 150_000, costCents: 60_000 })).product;
    await api('post', `/products/${product.id}/receive`, { quantity: 10, unitCostCents: 60_000 });
    const customerPhone = phone();

    const res = await ordersApi.create({ customer_name: 'E2E Customer', customer_phone: customerPhone, items: [{ product_id: product.id, quantity: 2 }], discount: 10_000, notes: 'By phone' });
    const order = res.data.data;
    expect(order.id).toMatch(/^UT-/);
    expect(order.customer).toMatchObject({ name: 'E2E Customer', phone: customerPhone });
    expect(Number(order.total)).toBe(290_000); // 2 x 1,500.00 less 100.00
    expect(order.items[0]).toMatchObject({ product_name: `Order shoe ${sku}` });

    const listed = (await ordersApi.list({ search: customerPhone })).data.data;
    expect(listed.map((o) => o.id)).toContain(order.id);

    const err = await ordersApi.create({ customer_name: 'E2E Customer', customer_phone: customerPhone, items: [{ product_id: product.id, quantity: 1 }] }).catch((e) => e);
    expect(getErrorMessage(err, 'x')).toBe('This phone number already has an active order.');
    expect(err.response.data.details.existingOrderRef).toBe(order.id);
  }, 30_000);

  it('says why an order is refused when a line is missing its product', async () => {
    const err = await ordersApi.create({ customer_name: 'No Items', customer_phone: phone(), items: [] }).catch((e) => e);
    expect(getErrorMessage(err, 'x')).toBe('Add at least one item.');
  });
});

describe.skipIf(!RUN_E2E)('the Pull online orders box, against the real new server', () => {
  const Page = () => (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ToastProvider><DialogProvider><AuthProvider><MemoryRouter><PullOnlineOrders /></MemoryRouter></AuthProvider></DialogProvider></ToastProvider>
    </QueryClientProvider>
  );
  it('opens and says no store is connected yet, instead of failing', async () => {
    render(<Page />);
    fireEvent.click(await screen.findByRole('button', { name: 'Pull online orders' }));
    expect(await screen.findByText('No store connected yet')).toBeInTheDocument();
  }, 30_000);

  it('asking a store that does not exist for orders gives the server reason', async () => {
    const err = await ordersApi.pullOnline(987654, 30).catch((e) => e);
    expect(getErrorMessage(err, 'FALLBACK')).not.toBe('FALLBACK');
  }, 30_000);
});
