// @vitest-environment-options {"url":"http://localhost:5173"}
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import axios from 'axios';
import client from '../api/client';
import { authApi } from '../api/endpoints';
import { AuthProvider } from '../context/AuthContext';
import { ToastProvider, DialogProvider } from '../context/UIContext';
import Security from '../pages/Security';

// Only `npm run test:e2e-new-server` sets this. The normal run has no server to talk to, so these suites are skipped.
const RUN_E2E = import.meta.env.VITE_E2E_NEW_SERVER === 'true';

// The Security page on the REAL new server: over HTTP, nothing mocked.  (server/: npm run dev:stack, then frontend/: npm run test:e2e-new-server)
const ADMIN = { email: 'admin@shop.test', password: 'Admin-Dev-Passphrase-1' };
const API = import.meta.env.VITE_NEW_API_URL;
const api = async (method, path, body) => (await client({ method, url: path, data: body })).data;
const button = (name) => screen.getByRole('button', { name });
const confirmDialog = () => within(document.body).getByRole('button', { name: /^Confirm$/ });
const otherSignIn = () => axios.post(`${API}/auth/login`, { email: ADMIN.email, password: ADMIN.password });

function Page() {
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ToastProvider><DialogProvider><AuthProvider>
        <MemoryRouter><Security /></MemoryRouter>
      </AuthProvider></DialogProvider></ToastProvider>
    </QueryClientProvider>
  );
}

beforeAll(async () => {
  const health = await client.get('/health').catch((e) => e);
  if (!health?.status) throw new Error(`The new server is not reachable (${health?.message}). Start it with: cd server && npm run dev:stack`);
  await authApi.login(ADMIN.email, ADMIN.password);
}, 30_000);
afterEach(() => { cleanup(); });

describe.skipIf(!RUN_E2E)('the Security page against the real new server', () => {
  it('describes this sign-in and lists this device', async () => {
    render(<Page />);
    expect(await screen.findByText('This device')).toBeInTheDocument();
    expect(screen.getByText(/The screen locks after/)).toBeInTheDocument();
  }, 30_000);

  it('signs another device out, and then all the others', async () => {
    await otherSignIn();
    await otherSignIn();
    render(<Page />);
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Sign out device' }).length).toBeGreaterThanOrEqual(2));
    const before = (await api('get', '/auth/sessions')).sessions.length;
    fireEvent.click(screen.getAllByRole('button', { name: 'Sign out device' })[0]);
    expect(await screen.findByText(/was signed out\./)).toBeInTheDocument();
    await waitFor(async () => expect((await api('get', '/auth/sessions')).sessions.length).toBe(before - 1));

    fireEvent.click(await screen.findByRole('button', { name: 'Sign out all others' }));
    fireEvent.click(await waitFor(confirmDialog));
    expect(await screen.findByText(/Signed out \d+ other device/)).toBeInTheDocument();
    const left = (await api('get', '/auth/sessions')).sessions;
    expect(left).toHaveLength(1);
    expect(left[0].current).toBe(true);
  }, 40_000);

  it('saves a changed sign-in rule, and shows the server reason for one it refuses', async () => {
    render(<Page />);
    const lock = (await screen.findAllByLabelText('Lock screen after (minutes idle)'))[0]; // cashiers
    const was = (await api('get', '/security/policy')).policy.roles.cashier.lockMinutes;
    expect(lock.value).toBe(String(was));
    fireEvent.change(lock, { target: { value: String(was + 1) } });
    fireEvent.click(button('Save security settings'));
    expect(await screen.findByText(/Security settings saved/)).toBeInTheDocument();
    expect((await api('get', '/security/policy')).policy.roles.cashier.lockMinutes).toBe(was + 1);

    fireEvent.change(lock, { target: { value: '500' } }); // more than the sign-out time, and over the allowed range
    fireEvent.click(button('Save security settings'));
    expect(await screen.findByRole('alert')).toHaveTextContent(/cashier: lock screen after \(minutes\) must be a whole number from 1 to 240/);
    expect((await api('get', '/security/policy')).policy.roles.cashier.lockMinutes).toBe(was + 1);
    await api('put', '/security/policy', { roles: { cashier: { lockMinutes: was } } });
  }, 40_000);

  it('lists real security events: a lockout shows as urgent with who it was', async () => {
    const t = Date.now().toString(36);
    await api('post', '/users', { username: `lock.${t}`, displayName: `Lock ${t}`, role: 'cashier' });
    for (let i = 0; i < 5; i += 1) await axios.post(`${API}/auth/login`, { username: `lock.${t}`, password: 'wrong-wrong-1' }).catch(() => null);
    render(<Page />);
    const title = await screen.findByText(`lock.${t} was locked out`);
    const row = title.closest('li');
    expect(within(row).getByText('urgent')).toBeInTheDocument();
    expect(within(row).getByText('Too many wrong passwords.')).toBeInTheDocument();
    expect(screen.queryByText(/not available on the new server/)).toBeNull();
    expect(screen.queryByText(/Nothing yet/)).toBeNull();
  }, 30_000);
});
