// @vitest-environment-options {"url":"http://localhost:5173"}
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import client from '../api/client';
import { authApi } from '../api/endpoints';
import { AuthProvider } from '../context/AuthContext';
import { ToastProvider, DialogProvider } from '../context/UIContext';
import Attendance from '../pages/Attendance';

// Only `npm run test:e2e-new-server` sets this. The normal run has no server to talk to, so these suites are skipped.
const RUN_E2E = import.meta.env.VITE_E2E_NEW_SERVER === 'true';

// The Attendance page on the REAL new server: over HTTP, nothing mocked.  (server/: npm run dev:stack, then frontend/: npm run test:e2e-new-server)
const ADMIN = { email: 'admin@shop.test', password: 'Admin-Dev-Passphrase-1' };
const api = async (method, path, body) => (await client({ method, url: path, data: body })).data;
const button = (name) => screen.getByRole('button', { name });

function Page() {
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ToastProvider><DialogProvider><AuthProvider>
        <MemoryRouter><Attendance /></MemoryRouter>
      </AuthProvider></DialogProvider></ToastProvider>
    </QueryClientProvider>
  );
}
const rowOf = async (name) => (await screen.findByText(name)).closest('tr');

beforeAll(async () => {
  const health = await client.get('/health').catch((e) => e);
  if (!health?.status) throw new Error(`The new server is not reachable (${health?.message}). Start it with: cd server && npm run dev:stack`);
  await authApi.login(ADMIN.email, ADMIN.password);
}, 30_000);
afterEach(() => { cleanup(); });

describe.skipIf(!RUN_E2E)('the Attendance page against the real new server', () => {
  it('lists the team, clocks you in and out, and shows the change in the table', async () => {
    const today = () => api('get', '/payroll/attendance/today');
    const mine = async () => (await today()).staff.find((s) => s.staffKey === 'admin');
    if ((await mine()).clockInAt) throw new Error('This dev database already has a clock-in for the admin today. Restart npm run dev:stack for a clean one.');
    render(<Page />);
    expect(await screen.findByText('Today · team')).toBeInTheDocument();
    expect(screen.getByText('Not clocked in yet today.')).toBeInTheDocument();
    const row = await rowOf('Admin (sample)');
    expect(within(row).getByText('Absent')).toBeInTheDocument();
    expect(screen.queryByText(/Run reassignment now/)).toBeNull(); // not on the new server yet

    fireEvent.click(button('Clock in'));
    expect(await screen.findByText('Clocked in.')).toBeInTheDocument();
    expect((await mine()).clockInAt).toBeTruthy();
    await waitFor(async () => expect(within(await rowOf('Admin (sample)')).getByText('Present')).toBeInTheDocument());
    expect(screen.getByText(/still clocked in/)).toBeInTheDocument();

    fireEvent.click(button('Clock in')); // a second clock-in the same day is refused, with the server's reason
    expect(await screen.findByText('Attendance for that person today is already recorded.')).toBeInTheDocument();

    fireEvent.click(button('Clock out'));
    expect(await screen.findByText('Clocked out.')).toBeInTheDocument();
    expect((await mine()).clockOutAt).toBeTruthy();
    await waitFor(async () => expect(within(await rowOf('Admin (sample)')).getByText('Shift ended')).toBeInTheDocument());

    fireEvent.click(button('Clock out')); // nothing open any more
    expect(await screen.findByText('There is no open clock-in to clock out of.')).toBeInTheDocument();
  }, 40_000);

  it('shows someone marked absent with their reason, and the not-clocked-in banner without the reassignment offer', async () => {
    const t = Date.now().toString(36);
    await api('post', '/users', { username: `abs.${t}`, displayName: `Absent ${t}`, role: 'cashier' });
    const date = (await api('get', '/payroll/attendance/today')).date;
    await api('post', '/payroll/attendance/absences', { staffKey: `abs.${t}`, workDate: date, reason: 'Family emergency' });
    render(<Page />);
    const row = await rowOf(`Absent ${t}`);
    expect(within(row).getByText('Absent · Family emergency')).toBeInTheDocument();
    expect(screen.getByText(/not clocked in today:/).parentElement).toHaveTextContent(`Absent ${t}`);
    expect(screen.queryByText(/reassigned automatically/)).toBeNull();
  }, 30_000);
});
