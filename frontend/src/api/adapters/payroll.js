import client from '../client';
import { AdapterError, mapResponse } from './common';
import { people } from './directory';

// The Payroll page (one person's pay for a period, and recording a loss deduction) on /api/payroll.
// The page picks a person by id; the server keys pay by username, so the staff list is read to find it.
// A person with no pay profile for the period is a 404 with its own message; the page shows it.
// If a locked payroll run covers exactly the period, the server answers with that run's frozen figures instead of calculating again.

const shopToday = () => new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10); // East Africa Time, like the server

async function usernameOf(staffId) {
  const person = (await people()).find((u) => String(u.id) === String(staffId));
  if (!person) throw new AdapterError('STAFF_NOT_FOUND', 'That staff member could not be found. Reload the page and try again.');
  return person;
}

const lineKinds = (lines, ...kinds) => lines.filter((l) => kinds.includes(l.kind));

/** The server's PayItem -> the summary the page draws. Money is whole cents; hours are whole hours. */
export function adaptSummary(item, person, period) {
  const attendanceLines = lineKinds(item.lines, 'late', 'absence', 'missing_hours');
  const adjustmentLine = (l, i) => ({ id: `${l.kind}-${l.refDate}-${i}`, type: l.kind, notes: l.refText ?? '', amount: l.amountCents, date: l.refDate });
  return {
    staff: { name: person.displayName, username: person.username },
    period: { start: period.from, end: period.to },
    dailyRetainer: { daysLoggedIn: item.daysWorked, total: item.retainerCents },
    commission: {
      unitsSold: item.unitsSold, tier: item.tier ?? 'no plan', commissionTotal: item.commissionCents,
      achievedSales: item.achievedSalesCents, target: item.targetCents, achievementPercent: item.achievementBp / 100,
    },
    bonuses: lineKinds(item.lines, 'bonus').map(adjustmentLine),
    grossPay: item.grossCents,
    attendanceDeductions: {
      absenceTotal: item.absenceCents, lateTotal: item.lateCents, missingHoursTotal: item.missingHoursCents,
      breakdown: attendanceLines.map((l) => ({
        date: l.refDate, type: l.kind, amount: l.amountCents,
        ...(l.kind === 'late' ? { hoursLate: l.quantity } : {}), ...(l.kind === 'missing_hours' ? { hoursMissing: l.quantity } : {}),
        ...(l.kind === 'absence' && l.refText ? { reason: l.refText } : {}),
      })),
    },
    adjustments: lineKinds(item.lines, 'salary_advance', 'loss_deduction').map(adjustmentLine),
    totalDeductions: item.deductionsCents,
    netPayable: item.netCents,
    shortfall: item.shortfallCents,
  };
}

export const newPayrollApi = {
  summary: async (staffId, from, to) => {
    const person = await usernameOf(staffId);
    return mapResponse(
      client.get(`/payroll/staff/${encodeURIComponent(person.username)}`, { params: { from, to } }),
      (d) => ({ data: { ...adaptSummary(d.item, person, { from, to }), source: d.source } }),
    );
  },
  // `amount` is in cents. The server needs a reason, and files the deduction on today's date.
  lossDeduction: async ({ staff_id: staffId, amount, notes }) => {
    if (!String(notes ?? '').trim()) throw new AdapterError('ADJUSTMENT_REASON_REQUIRED', 'Say what happened.');
    const person = await usernameOf(staffId);
    return mapResponse(
      client.post('/payroll/adjustments', { staffKey: person.username, type: 'loss_deduction', amountCents: amount, effectiveDate: shopToday(), reason: String(notes).trim() }),
      (d) => ({ data: d.adjustment }),
    );
  },
};
