import { describe, it, expect, vi, afterEach } from 'vitest';
import client, { getErrorMessage } from '../client';
import { newAttendanceApi, newTelesalesApi, newShiftApi } from './attendance';
import clockedIn from './__fixtures__/attendance-clock-in.json';
import clockedOut from './__fixtures__/attendance-clock-out.json';
import today from './__fixtures__/attendance-today.json';

// Fixtures are recorded answers of the real new server (server/tests/contractFixtures.test.ts keeps them honest).
afterEach(() => { vi.restoreAllMocks(); });
const ok = (data, status = 200) => Promise.resolve({ status, data });
const refused = (status, code, message) => Promise.reject({ response: { status, data: { error: { code, message } } } });

describe('clocking in and out', () => {
  it('clock in sends nothing but the request, and gives the day record', async () => {
    const post = vi.spyOn(client, 'post').mockReturnValue(ok(clockedIn, 201));
    const res = await newAttendanceApi.clockIn();
    expect(post).toHaveBeenCalledWith('/payroll/attendance/clock-in', {});
    expect(res.data.data).toMatchObject({ staff_key: clockedIn.record.staffKey, work_date: clockedIn.record.workDate, clock_in_at: clockedIn.record.clockInAt, clock_out_at: null });
  });
  it('clock out closes the open day', async () => {
    const post = vi.spyOn(client, 'post').mockReturnValue(ok(clockedOut));
    const res = await newAttendanceApi.clockOut();
    expect(post).toHaveBeenCalledWith('/payroll/attendance/clock-out', {});
    expect(res.data.data.clock_out_at).toBe(clockedOut.record.clockOutAt);
  });
  it('shows the server reason when it is refused (already clocked in, or nothing to clock out of)', async () => {
    vi.spyOn(client, 'post').mockReturnValue(refused(409, 'ALREADY_RECORDED', 'Attendance for that person today is already recorded.'));
    const err = await newAttendanceApi.clockIn().catch((e) => e);
    expect(getErrorMessage(err, 'Could not record that.')).toBe('Attendance for that person today is already recorded.');
  });
  it('refuses a handover note rather than dropping it', async () => {
    const post = vi.spyOn(client, 'post');
    await expect(newAttendanceApi.clockOut('left 2 parcels')).rejects.toMatchObject({ response: { data: { error: { code: 'HANDOVER_NOTES_UNAVAILABLE' } } } });
    expect(post).not.toHaveBeenCalled();
  });
});

describe('the team list for today', () => {
  it('has the rows the page reads: staff_id (the account id), name, clock-in and clock-out, and the absence reason', async () => {
    const get = vi.spyOn(client, 'get').mockReturnValue(ok(today));
    const { data } = (await newAttendanceApi.today()).data;
    expect(get).toHaveBeenCalledWith('/payroll/attendance/today', { params: {} });
    expect(data).toHaveLength(today.staff.length);
    const away = data.find((r) => r.absence_reason);
    expect(away).toMatchObject({ name: 'Absent Fixture', clock_in_at: null, absence_reason: 'Sick, called in' });
    const here = data.find((r) => r.clock_in_at);
    expect(here.staff_id).toBe(today.staff.find((s) => s.clockInAt).userId);
  });
  it('passes a chosen date through, and lists only those not in for the absences', async () => {
    const get = vi.spyOn(client, 'get').mockReturnValue(ok(today));
    await newAttendanceApi.today('2026-10-01');
    expect(get).toHaveBeenLastCalledWith('/payroll/attendance/today', { params: { date: '2026-10-01' } });
    const { data } = (await newAttendanceApi.absencesToday()).data;
    expect(data.length).toBe(today.staff.filter((s) => !s.clockInAt).length);
    expect(data.every((r) => r.clock_in_at === null)).toBe(true);
  });
});

describe('what is not on the new server yet', () => {
  it('says so for the handover summary and for reassignment, without a request', async () => {
    const get = vi.spyOn(client, 'get');
    const post = vi.spyOn(client, 'post');
    await expect(newShiftApi.handover()).rejects.toThrow(/not available on the new server yet/);
    await expect(newTelesalesApi.rebalance()).rejects.toThrow(/not available on the new server yet/);
    expect(get).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });
});
