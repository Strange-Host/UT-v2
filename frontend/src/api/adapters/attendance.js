import client from '../client';
import { AdapterError, mapResponse, notImplemented } from './common';

// Attendance on the new server (/api/payroll/attendance). The server records a clock-in/out per person per shop day (East Africa Time).
//  - The team list ("Today") is every active staff account, with their clock-in and clock-out, or the reason they were marked absent.
//  - There is no handover note on clock-out, no shift handover summary and no automatic telesales reassignment yet
//    (the shift widget is item 2.4, reassignment 4.6): those calls say "not available" instead of reaching for a route that is not there.

const wrap = (data) => ({ data });
const adaptRecord = (r) => ({ staff_key: r.staffKey, work_date: r.workDate, clock_in_at: r.clockInAt, clock_out_at: r.clockOutAt, absence_reason: r.absenceReason });
export const adaptTeamRow = (s) => ({
  staff_id: s.userId, staff_key: s.staffKey, name: s.name, role: s.role,
  clock_in_at: s.clockInAt, clock_out_at: s.clockOutAt, absence_reason: s.absenceReason,
});

export const newAttendanceApi = {
  clockIn: () => mapResponse(client.post('/payroll/attendance/clock-in', {}), (d) => wrap(adaptRecord(d.record))),
  clockOut: async (handoverNotes) => {
    if (handoverNotes) throw new AdapterError('HANDOVER_NOTES_UNAVAILABLE', 'Handover notes are not available on the new server yet. Clock out without a note.');
    return mapResponse(client.post('/payroll/attendance/clock-out', {}), (d) => wrap(adaptRecord(d.record)));
  },
  today: (date) => mapResponse(client.get('/payroll/attendance/today', { params: date ? { date } : {} }), (d) => wrap(d.staff.map(adaptTeamRow))),
  // Who has not clocked in: the same list, narrowed (a person marked absent with a reason is in it, with the reason).
  absencesToday: (date) => mapResponse(client.get('/payroll/attendance/today', { params: date ? { date } : {} }), (d) => wrap(d.staff.filter((s) => !s.clockInAt).map(adaptTeamRow))),
};

export const newTelesalesApi = { rebalance: notImplemented('telesalesApi.rebalance') };
export const newShiftApi = { handover: notImplemented('shiftApi.handover') };
