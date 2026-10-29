// @vitest-environment-options {"url":"http://localhost:5173"}
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import client from '../api/client';
import { authApi } from '../api/endpoints';
import { AuthProvider } from '../context/AuthContext';
import { ToastProvider, DialogProvider } from '../context/UIContext';
import Payroll from '../pages/Payroll';

// Only `npm run test:e2e-new-server` sets this. The normal run has no server to talk to, so these suites are skipped.
const RUN_E2E = import.meta.env.VITE_E2E_NEW_SERVER === 'true';

// The Payroll page on the REAL new server: over HTTP, nothing mocked.  (server/: npm run dev:stack, then frontend/: npm run test:e2e-new-server)
const ADMIN = { email: 'admin@shop.test', password: 'Admin-Dev-Passphrase-1' };
const api = async (method, path, body) => (await client({ method, url: path, data: body })).data;

function Page() {
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ToastProvider><DialogProvider><AuthProvider>
        <MemoryRouter><Payroll /></MemoryRouter>
      </AuthProvider></DialogProvider></ToastProvider>
    </QueryClientProvider>
  );
}
async function choose(label) {
  const picker = screen.getAllByRole('combobox')[0];
  const option = await waitFor(() => { const o = [...picker.options].find((x) => x.text.startsWith(label)); if (!o) throw new Error(`no ${label} in the picker yet`); return o; });
  fireEvent.change(picker, { target: { value: option.value } });
}

beforeAll(async () => {
  const health = await client.get('/health').catch((e) => e);
  if (!health?.status) throw new Error(`The new server is not reachable (${health?.message}). Start it with: cd server && npm run dev:stack`);
  await authApi.login(ADMIN.email, ADMIN.password);
}, 30_000);
afterEach(() => { cleanup(); });

describe.skipIf(!RUN_E2E)('the Payroll page against the real new server', () => {
  it('shows one person\'s pay with their absence, advance and bonus, then records a loss deduction', async () => {
    const t = Date.now().toString(36);
    const name = `Paid ${t}`;
    await api('post', '/users', { username: `paid.${t}`, displayName: name, role: 'cashier' });
    const plan = (await api('post', '/payroll/plans', { name: `Plan ${t}`, targetCents: 5_000_000, rateBelow70Cents: 5_000, rate70Cents: 7_500, rate80Cents: 10_000 })).plan;
    await api('post', '/payroll/profiles', { staffKey: `paid.${t}`, effectiveFrom: '2020-01-01', dailyRetainerCents: 100_000, commissionPlanId: plan.id, absenceFeeCents: 100_000 });
    const monthStart = `${(await api('get', '/payroll/attendance/today')).date.slice(0, 7)}-01`;
    await api('post', '/payroll/attendance/absences', { staffKey: `paid.${t}`, workDate: monthStart, reason: 'Sick' });
    await api('post', '/payroll/adjustments', { staffKey: `paid.${t}`, type: 'salary_advance', amountCents: 200_000, effectiveDate: monthStart, reason: 'Advance' });
    await api('post', '/payroll/adjustments', { staffKey: `paid.${t}`, type: 'bonus', amountCents: 30_000, effectiveDate: monthStart, reason: 'Good month' });

    render(<Page />);
    expect(screen.getByText(/Pick a staff member and a date range/)).toBeInTheDocument();
    await choose(name);
    expect(await screen.findByText(/Daily retainer/)).toBeInTheDocument();
    expect(screen.getByText(/0 days/)).toBeInTheDocument();
    expect(screen.getByText(/0 units · <70% tier/)).toBeInTheDocument();
    expect(screen.getByText('Absences')).toBeInTheDocument();
    expect(screen.getByText('Salary advance')).toBeInTheDocument();
    expect(screen.getByText(/Bonus/)).toBeInTheDocument();
    expect(screen.getByText('Net payable').parentElement).toHaveTextContent(/−|-/); // the advance and the absence outweigh the bonus
    const before = (await api('get', `/payroll/staff/paid.${t}?from=${monthStart}&to=${monthStart}`)).item.netCents;
    expect(before).toBe(-270_000); // 0 retainer + 30,000 bonus - 100,000 absence - 200,000 advance

    fireEvent.change(screen.getByPlaceholderText('Amount'), { target: { value: '1500.00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record' }));
    expect(await screen.findByText('Say what happened.')).toBeInTheDocument(); // the server keeps a reason for every deduction

    fireEvent.change(screen.getByPlaceholderText('What happened?'), { target: { value: 'Till short on Friday' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record' }));
    expect(await screen.findByText(/Loss deduction/)).toBeInTheDocument();
    expect(screen.getByText(/Till short on Friday/)).toBeInTheDocument();
    const adjustments = (await api('get', `/payroll/adjustments?staffKey=paid.${t}&from=2020-01-01&to=2100-01-01`)).adjustments;
    expect(adjustments.find((a) => a.type === 'loss_deduction')).toMatchObject({ amountCents: 150_000, reason: 'Till short on Friday' });
  }, 40_000);

  it('says why there is no summary for someone with no pay profile, instead of showing nothing', async () => {
    render(<Page />);
    await choose('Admin (sample)');
    expect(await screen.findByText(/has no pay profile for this period/)).toBeInTheDocument();
    expect(screen.queryByText('Net payable')).toBeNull();
  }, 30_000);

  it('says why a range that ends before it starts is refused', async () => {
    render(<Page />);
    await choose('Admin (sample)');
    const [from, to] = [...document.querySelectorAll('input[type="date"]')];
    fireEvent.change(from, { target: { value: '2026-10-20' } });
    fireEvent.change(to, { target: { value: '2026-10-10' } });
    expect(await screen.findByText(/end cannot be before the start/i)).toBeInTheDocument();
  }, 30_000);
});
