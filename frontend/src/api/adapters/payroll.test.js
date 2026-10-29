import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import client, { getErrorMessage } from '../client';
import { newPayrollApi, adaptSummary } from './payroll';
import { resetDirectory } from './directory';
import pay from './__fixtures__/payroll-staff-pay.json';
import none from './__fixtures__/payroll-no-profile.json';
import adjustment from './__fixtures__/payroll-adjustment.json';
import staff from './__fixtures__/staff-list.json';

// Fixtures are recorded answers of the real new server (server/tests/contractFixtures.test.ts keeps them honest).
beforeEach(() => resetDirectory());
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
const ok = (data, status = 200) => Promise.resolve({ status, data });
const refused = (status, code, message) => Promise.reject({ response: { status, data: { error: { code, message } } } });
const person = { id: 77, username: 'pay.fixture', displayName: 'Pay Fixture' };
const directory = { users: [...staff.users, person] };
const route = (table) => (url) => (table[url] ? table[url]() : Promise.reject(new Error(`unexpected ${url}`)));
const period = { from: '2026-10-01', to: '2026-10-31' };

describe('one person\'s pay as the page draws it', () => {
  const s = adaptSummary(pay.item, person, period);
  it('has the names the page reads, in whole cents', () => {
    expect(s.staff.name).toBe('Pay Fixture');
    expect(s.period).toEqual({ start: '2026-10-01', end: '2026-10-31' });
    expect(s.dailyRetainer).toEqual({ daysLoggedIn: 1, total: 100_000 });
    expect(s.commission).toMatchObject({ unitsSold: 0, tier: '<70%', commissionTotal: 0, achievedSales: 0, target: 10_000_000, achievementPercent: 0 });
  });
  it('lists the advance and the loss as deductions, the bonus separately, and each attendance line with its hours or reason', () => {
    expect(s.adjustments.map((a) => [a.type, a.amount, a.notes])).toEqual([['salary_advance', 200_000, 'Advance'], ['loss_deduction', 50_000, 'Till shortfall']]);
    expect(s.bonuses.map((b) => [b.amount, b.notes])).toEqual([[30_000, 'Good month']]);
    expect(s.attendanceDeductions).toMatchObject({ absenceTotal: 100_000, lateTotal: 20_000, missingHoursTotal: 15_000 });
    expect(s.attendanceDeductions.breakdown).toEqual(expect.arrayContaining([
      expect.objectContaining({ date: '2026-10-02', type: 'late', hoursLate: 2, amount: 20_000 }),
      expect.objectContaining({ date: '2026-10-02', type: 'missing_hours', hoursMissing: 3, amount: 15_000 }),
      expect.objectContaining({ date: '2026-10-03', type: 'absence', reason: 'No call, no show', amount: 100_000 }),
    ]));
    expect(new Set([...s.adjustments, ...s.bonuses].map((a) => a.id)).size).toBe(3); // each line has its own key
  });
  it('adds up on the page: what is shown as earned and taken off equals the totals', () => {
    const earned = s.dailyRetainer.total + s.commission.commissionTotal + s.bonuses.reduce((n, b) => n + b.amount, 0);
    const taken = s.attendanceDeductions.absenceTotal + s.attendanceDeductions.lateTotal + s.attendanceDeductions.missingHoursTotal + s.adjustments.reduce((n, a) => n + a.amount, 0);
    expect(earned).toBe(s.grossPay);
    expect(taken).toBe(s.totalDeductions);
    expect(s.grossPay - s.totalDeductions).toBe(s.netPayable);
    expect(s.netPayable).toBeLessThan(0); // the shortfall is shown, in red, not hidden
    expect(s.shortfall).toBe(-s.netPayable);
  });
  it('says "no plan" for someone with no commission plan', () => {
    expect(adaptSummary({ ...pay.item, tier: null }, person, period).commission.tier).toBe('no plan');
  });
});

describe('asking for a summary', () => {
  it('finds the username from the staff id and asks for that person and period', async () => {
    const get = vi.spyOn(client, 'get').mockImplementation(route({ '/users': () => ok(directory), '/payroll/staff/pay.fixture': () => ok(pay) }));
    const res = await newPayrollApi.summary('77', '2026-10-01', '2026-10-31');
    expect(get).toHaveBeenCalledWith('/payroll/staff/pay.fixture', { params: { from: '2026-10-01', to: '2026-10-31' } });
    expect(res.data.data).toMatchObject({ staff: { name: 'Pay Fixture' }, source: 'live', netPayable: pay.item.netCents });
  });
  it('shows the server reason for a person with no pay profile, and for a bad range', async () => {
    vi.spyOn(client, 'get').mockImplementation(route({ '/users': () => ok(directory), '/payroll/staff/pay.fixture': () => refused(404, none.error.code, none.error.message) }));
    const err = await newPayrollApi.summary('77', '2026-10-01', '2026-10-31').catch((e) => e);
    expect(getErrorMessage(err, 'x')).toMatch(/has no pay profile for this period/);
  });
  it('stops on a staff id it cannot find, without asking the server for pay', async () => {
    const get = vi.spyOn(client, 'get').mockImplementation(route({ '/users': () => ok(directory) }));
    await expect(newPayrollApi.summary('424242', '2026-10-01', '2026-10-31')).rejects.toMatchObject({ response: { data: { error: { code: 'STAFF_NOT_FOUND' } } } });
    expect(get).toHaveBeenCalledTimes(1);
  });
});

describe('recording a loss deduction', () => {
  it('files it on today\'s shop date (East Africa Time), in cents, with the reason', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-29T22:30:00Z')); // already the 30th in Nairobi
    vi.spyOn(client, 'get').mockImplementation(route({ '/users': () => ok(directory) }));
    const post = vi.spyOn(client, 'post').mockReturnValue(ok(adjustment, 201));
    const res = await newPayrollApi.lossDeduction({ staff_id: 77, amount: 50_000, notes: ' Till shortfall ' });
    expect(post).toHaveBeenCalledWith('/payroll/adjustments', { staffKey: 'pay.fixture', type: 'loss_deduction', amountCents: 50_000, effectiveDate: '2026-10-30', reason: 'Till shortfall' });
    expect(res.data.data).toMatchObject({ type: 'loss_deduction', amountCents: 50_000 });
  });
  it('needs a reason, because the server keeps one for every deduction', async () => {
    const post = vi.spyOn(client, 'post');
    await expect(newPayrollApi.lossDeduction({ staff_id: 77, amount: 100 })).rejects.toMatchObject({ response: { data: { error: { code: 'ADJUSTMENT_REASON_REQUIRED' } } } });
    expect(post).not.toHaveBeenCalled();
  });
  it('shows why a deduction is refused when the day is in a locked payroll run', async () => {
    vi.spyOn(client, 'get').mockImplementation(route({ '/users': () => ok(directory) }));
    vi.spyOn(client, 'post').mockReturnValue(refused(409, 'PERIOD_LOCKED', 'That date is inside a locked payroll run.'));
    const err = await newPayrollApi.lossDeduction({ staff_id: 77, amount: 100, notes: 'x' }).catch((e) => e);
    expect(getErrorMessage(err, 'x')).toBe('That date is inside a locked payroll run.');
  });
});
