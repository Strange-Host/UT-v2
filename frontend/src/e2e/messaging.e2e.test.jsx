// @vitest-environment-options {"url":"http://localhost:5173"}
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import client from '../api/client';
import { authApi, ordersApi } from '../api/endpoints';
import { AuthProvider } from '../context/AuthContext';
import { ToastProvider, DialogProvider } from '../context/UIContext';
import { CustomerPaymentDetails, SmsSection } from '../pages/SettingsMessaging';

// Only `npm run test:e2e-new-server` sets this. The normal run has no server to talk to, so these suites are skipped.
const RUN_E2E = import.meta.env.VITE_E2E_NEW_SERVER === 'true';

// Settings > Messaging (customer SMS and how customers pay) on the REAL new server: over HTTP, nothing mocked.
// (server/: npm run dev:stack, then frontend/: npm run test:e2e-new-server). The dev server has no gateway credentials key and no
// SMS gateway, so saving credentials and a real test send are covered by the server's tests and the adapter's recorded answers.
const ADMIN = { email: 'admin@shop.test', password: 'Admin-Dev-Passphrase-1' };
const api = async (method, path, body) => (await client({ method, url: path, data: body })).data;
const options = async () => (await api('get', '/sms/settings')).settings;

const Page = ({ children }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ToastProvider><DialogProvider><AuthProvider><MemoryRouter>{children}</MemoryRouter></AuthProvider></DialogProvider></ToastProvider>
  </QueryClientProvider>
);

beforeAll(async () => {
  const health = await client.get('/health').catch((e) => e);
  if (!health?.status) throw new Error(`The new server is not reachable (${health?.message}). Start it with: cd server && npm run dev:stack`);
  await authApi.login(ADMIN.email, ADMIN.password);
}, 30_000);
afterEach(() => { cleanup(); });

describe.skipIf(!RUN_E2E)('Settings > Messaging against the real new server', () => {
  it('shows SMS as not set up, with no messages yet, and saves what is switched on and how it is worded', async () => {
    await api('put', '/sms/settings', { sms_enabled: '0', sms_send_payment_received: '1', sms_delivery_promise: 'It will be delivered within the next 24 hours.', sms_message_type: 'unicode' });
    render(<Page><SmsSection /></Page>);
    expect(await screen.findByText('Not set up')).toBeInTheDocument();
    expect(screen.getByText(/No messages yet/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send test' })).toBeDisabled(); // nothing to send with yet

    const master = screen.getByLabelText(/Send SMS to customers/);
    expect(master).not.toBeChecked();
    fireEvent.click(master);
    fireEvent.click(screen.getByLabelText(/Payment received/));
    fireEvent.change(screen.getAllByRole('textbox').find((i) => i.value === 'It will be delivered within the next 24 hours.'), { target: { value: 'Within 2 days.' } });
    fireEvent.change(screen.getByDisplayValue('Unicode (safe)'), { target: { value: 'text' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save SMS settings' }));
    expect(await screen.findByText('SMS settings saved.')).toBeInTheDocument();
    expect(await options()).toMatchObject({ sms_enabled: '1', sms_send_payment_received: '0', sms_delivery_promise: 'Within 2 days.', sms_message_type: 'text' });
  }, 40_000);

  it('says why credentials cannot be saved on a server that has no key to keep them with, instead of pretending', async () => {
    render(<Page><SmsSection /></Page>);
    await screen.findByText('Not set up');
    const [userId, , sender] = screen.getAllByRole('textbox').filter((i) => !i.placeholder || i.placeholder !== '0712 345 678');
    fireEvent.change(userId, { target: { value: 'zet-user' } });
    fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'zet-pass-123' } });
    fireEvent.change(sender, { target: { value: 'URBAN' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save credentials' }));
    await waitFor(() => expect(screen.queryByText('SMS credentials saved.')).toBeNull());
    expect(await screen.findByText(/SECRETS_KEY|secret|not configured|Could not save SMS credentials/i)).toBeInTheDocument();
    expect(JSON.stringify(await api('get', '/sms/credentials'))).not.toMatch(/zet-pass-123/);
  }, 40_000);

  it('lists a message that is waiting once an order is made with SMS switched on', async () => {
    await api('put', '/sms/settings', { sms_enabled: '1', sms_send_order_received: '1' });
    const sku = `SMS-${Date.now().toString(36)}`;
    const product = (await api('post', '/products', { sku, name: `SMS shoe ${sku}`, priceCents: 120_000, costCents: 50_000 })).product;
    await api('post', `/products/${product.id}/receive`, { quantity: 5, unitCostCents: 50_000 });
    await ordersApi.create({ customer_name: 'Text Me', customer_phone: `0777${String(100000 + Math.floor(Math.random() * 800000))}`, items: [{ product_id: product.id, quantity: 1 }] });
    render(<Page><SmsSection /></Page>);
    const table = await screen.findByRole('table');
    expect(within(table).getAllByText('Order received').length).toBeGreaterThan(0);
    expect(within(table).getAllByText('queued').length).toBeGreaterThan(0);
    expect(screen.getByText(/Last 7 days:.*waiting/)).toHaveTextContent(/[1-9]\d* waiting/);
    expect(screen.queryByText(/No messages yet/)).toBeNull();
  }, 40_000);

  it('saves the paybill number and account prefix, and says what the number must look like when it is wrong', async () => {
    render(<Page><CustomerPaymentDetails /></Page>);
    await screen.findByText('Paybill number');
    const [paybill, prefix] = screen.getAllByRole('textbox'); // the paybill number, then the account prefix
    fireEvent.change(paybill, { target: { value: '522522' } });
    fireEvent.change(prefix, { target: { value: '8025631#' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save payment details' }));
    expect(await screen.findByText('Payment details saved.')).toBeInTheDocument();
    expect(await options()).toMatchObject({ paybill_number: '522522', kcb_account_prefix: '8025631' }); // the trailing # is dropped

    fireEvent.change(paybill, { target: { value: '12ab' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save payment details' }));
    expect(await screen.findByText(/must be 5 to 10 digits/)).toBeInTheDocument();
    expect((await options()).paybill_number).toBe('522522');
    await api('put', '/sms/settings', { sms_enabled: '0' });
  }, 40_000);
});
