// THROWAWAY parity harness: renders the ORIGINAL page and the REFACTORED page through identical scripted sessions and
// requires the same DOM at every step, the same API calls, and the same toasts / dialogs.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { leadsApi, staffApi } from '../api/endpoints';
import LeadsOld from './LeadsOld';
import StaffOld from './StaffOld';
import LeadsNew from '../pages/Leads';
import StaffNew from '../pages/Staff';

const h = vi.hoisted(() => ({ role: 'admin', modules: { control: true }, log: [], confirmAnswer: true }));

vi.mock('../api/endpoints', () => ({
  leadsApi: { stats: vi.fn(), list: vi.fn(), getById: vi.fn(), create: vi.fn(), changeStatus: vi.fn(), addActivity: vi.fn() },
  staffApi: { list: vi.fn(), update: vi.fn(), create: vi.fn(), reactivate: vi.fn(), unlockAccount: vi.fn(), signOutEverywhere: vi.fn(), resetPassword: vi.fn() },
}));
vi.mock('../api/fetchAll', () => ({ fetchAll: vi.fn(async () => [{ id: 7, name: 'Sam Seller' }, { id: 8, name: 'Tia Telesales' }]) }));
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ hasRole: (...r) => r.includes(h.role), user: { id: 1, role: h.role } }) }));
vi.mock('../context/UIContext', () => ({
  useToast: () => ({ success: (m) => h.log.push(['toast.success', m]), error: (m) => h.log.push(['toast.error', m]) }),
  useDialog: () => ({ confirm: async (o) => { h.log.push(['confirm', typeof o === 'string' ? o : JSON.stringify(o)]); return h.confirmAnswer; } }),
}));
vi.mock('../hooks/useModules', () => ({ default: () => h.modules }));
vi.mock('../components/ConvertLeadSheet', () => ({ default: () => <div data-testid="convert-sheet" /> }));
vi.mock('../components/StaffAccessModal', () => ({ default: ({ staff }) => <div data-testid="access-modal">{staff.name}</div> }));
vi.mock('../components/RemoveAccountSheet', () => ({ default: ({ staff }) => <div data-testid="remove-sheet">{staff.name}</div> }));

// ---- canonical DOM: attribute order and empty text nodes don't matter; form-control state does ----
function canon(node) {
  if (node.nodeType === 3) return node.textContent === '' ? '' : JSON.stringify(node.textContent);
  if (node.nodeType !== 1) return '';
  const attrs = node.tagName === 'BODY' ? '' : [...node.attributes].map((a) => `${a.name}=${JSON.stringify(a.value)}`).sort().join(' ');
  const state = ['INPUT', 'TEXTAREA', 'SELECT'].includes(node.tagName) ? ` ~value=${JSON.stringify(node.value)} ~disabled=${node.disabled}` : '';
  return `<${node.tagName.toLowerCase()} ${attrs}${state}>${[...node.childNodes].map(canon).join('')}</${node.tagName.toLowerCase()}>`;
}
const snap = () => canon(document.body);
const settle = (ms = 40) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const click = async (el) => { await userEvent.click(el); await settle(); };
const type = async (el, text) => { await userEvent.clear(el); if (text) await userEvent.type(el, text); };
const apiErr = (message) => Object.assign(new Error('x'), { response: { data: { error: { message } } } });
const page = (rows) => ({ data: { data: rows, page: 1, pageSize: 25, total: rows.length, totalPages: 1 } });

// =========================== LEADS ===========================
const LEADS = [
  { id: 1, name: 'Alice Wanjiru', phone: '0711000001', email: 'a@x.com', source: 'whatsapp', status: 'new', assigned_staff_name: null, form_name: null, notes: 'Wants two pairs\nsize 9', created_at: '2026-10-01', activities: [] },
  { id: 2, name: 'Brian Otieno', phone: '0711000002', email: '', source: 'walk_in', status: 'contacted', assigned_staff_name: 'Sam Seller', form_name: 'Spring sale', interested_product_name: 'Crew Tee', created_at: '2026-10-02',
    activities: [{ id: 1, created_at: '2026-10-02 10:00', staff_name: 'Sam Seller', type: 'call', content: 'Left voicemail' }, { id: 2, created_at: '2026-10-02 11:00', staff_name: null, type: 'status_change', content: '' }] },
  { id: 3, name: 'Carol Njeri', phone: '0711000003', email: 'c@x.com', source: 'referral', status: 'rescheduled', assigned_staff_name: 'Tia Telesales', form_name: 'Crew Tee', interested_product_name: 'Crew Tee', created_at: '2026-10-03', activities: [] },
  { id: 4, name: 'Dan Kamau', phone: '0711000004', email: '', source: 'shopify', status: 'converted', converted_order_id: 55, assigned_staff_name: 'Sam Seller', form_name: 'Hoodie form', created_at: '2026-10-04', activities: [{ id: 3, created_at: '2026-10-04', staff_name: 'Sam Seller', type: 'note', content: 'Order placed' }] },
  { id: 5, name: 'Eve Mwangi', phone: '0711000005', email: 'e@x.com', source: 'other', status: 'cancelled', assigned_staff_name: null, created_at: '2026-10-05' },
];

async function leadsSession(Page) {
  const shots = [];
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  render(<QueryClientProvider client={qc}><Page /></QueryClientProvider>);
  await screen.findByText('Alice Wanjiru'); await settle();
  shots.push(['list', snap()]);

  // filters
  await type(screen.getByPlaceholderText('Search name or phone…'), 'ali'); await settle();
  await userEvent.selectOptions(screen.getAllByRole('combobox')[0], 'contacted'); await settle();
  await type(screen.getByPlaceholderText('Search name or phone…'), ''); await userEvent.selectOptions(screen.getAllByRole('combobox')[0], ''); await settle();

  // create: failing then succeeding
  await click(screen.getByRole('button', { name: '+ New lead' }));
  shots.push(['new-lead-empty', snap()]);
  const dlg = () => document.body;
  await type(dlg().querySelector('input[required]'), 'Zed Zulu');
  await type(screen.getByPlaceholderText('0712345678'), '0799');
  await userEvent.selectOptions(dlg().querySelector('form').querySelectorAll('select')[0], 'referral');
  await userEvent.selectOptions(dlg().querySelector('form').querySelectorAll('select')[1], '8');
  await type(dlg().querySelector('textarea'), 'call back');
  shots.push(['new-lead-filled', snap()]);
  leadsApi.create.mockRejectedValueOnce(apiErr('Phone already used'));
  await click(screen.getByRole('button', { name: 'Create' }));
  shots.push(['new-lead-error', snap()]);
  await click(screen.getByRole('button', { name: 'Create' }));
  shots.push(['after-create', snap()]);
  await click(screen.getByRole('button', { name: '+ New lead' }));
  shots.push(['new-lead-reopened-clean', snap()]);
  await click(screen.getByRole('button', { name: 'Cancel' }));

  // every lead's detail
  for (const lead of LEADS) {
    await click(screen.getAllByRole('button', { name: 'Open' })[lead.id - 1]);
    await screen.findByText('Close'); await settle();
    shots.push([`detail-${lead.id}`, snap()]);
    await click(screen.getByRole('button', { name: 'Close' }));
  }

  // status changes, activities, convert
  await click(screen.getAllByRole('button', { name: 'Open' })[1]); await screen.findByText('Close');
  await click(screen.getByRole('button', { name: 'Cancelled' }));
  shots.push(['after-cancel-click', snap()]);
  leadsApi.changeStatus.mockRejectedValueOnce(apiErr('Not allowed'));
  await click(screen.getByRole('button', { name: 'Cancelled' }));
  shots.push(['after-failed-status', snap()]);
  await click(screen.getByRole('button', { name: 'Close' }));

  await click(screen.getAllByRole('button', { name: 'Open' })[1]); await screen.findByText('Close');
  fireEvent.change(document.querySelector('input[type="date"]'), { target: { value: '2026-11-01' } }); await settle();
  shots.push(['reschedule-date-set', snap()]);
  await click(screen.getByRole('button', { name: 'Reschedule' }));
  shots.push(['after-reschedule', snap()]);

  await userEvent.selectOptions(document.querySelector('form select'), 'meeting');
  await type(screen.getByPlaceholderText('Log an activity…'), 'Met at shop');
  shots.push(['activity-typed', snap()]);
  await click(screen.getByRole('button', { name: 'Close' }));           // closing keeps the typed text in the page's state
  await click(screen.getAllByRole('button', { name: 'Open' })[0]); await screen.findByText('Close');
  shots.push(['activity-text-survives-close', snap()]);
  await click(screen.getByRole('button', { name: 'Add' }));
  shots.push(['after-add-activity', snap()]);
  leadsApi.addActivity.mockRejectedValueOnce(apiErr('Nope'));
  await type(screen.getByPlaceholderText('Log an activity…'), 'again');
  await click(screen.getByRole('button', { name: 'Add' }));
  await type(screen.getByPlaceholderText('Log an activity…'), '');
  await click(screen.getByRole('button', { name: 'Add' }));              // empty content: nothing should be sent
  await click(screen.getByRole('button', { name: 'Convert to order' }));
  shots.push(['convert-open', snap()]);

  const calls = Object.fromEntries(['stats', 'list', 'create', 'changeStatus', 'addActivity'].map((k) => [k, JSON.stringify(leadsApi[k].mock.calls)]));
  calls.getById = leadsApi.getById.mock.calls.length;
  const out = { shots, calls, log: [...h.log] };
  cleanup();
  return out;
}

function resetLeadsMocks() {
  vi.clearAllMocks(); h.log.length = 0; h.role = 'admin';
  leadsApi.stats.mockResolvedValue({ data: { data: { total: 5, new: 1, contacted: 1, converted: 1, cancelled: 1 } } });
  leadsApi.list.mockResolvedValue(page(LEADS));
  leadsApi.getById.mockImplementation(async (id) => ({ data: { data: LEADS.find((l) => l.id === id) } }));
  leadsApi.create.mockResolvedValue({ data: {} });
  leadsApi.changeStatus.mockResolvedValue({ data: {} });
  leadsApi.addActivity.mockResolvedValue({ data: {} });
}

describe('Leads: refactored page behaves exactly like the original', () => {
  it('admin session (can assign)', async () => {
    resetLeadsMocks(); const before = await leadsSession(LeadsOld);
    resetLeadsMocks(); const after = await leadsSession(LeadsNew);
    expect(after.shots.map((s) => s[0])).toEqual(before.shots.map((s) => s[0]));
    for (let i = 0; i < before.shots.length; i++) expect(after.shots[i][1], `DOM differs at step "${before.shots[i][0]}"`).toBe(before.shots[i][1]);
    const { getById: gb1, ...c1 } = before.calls; const { getById: gb2, ...c2 } = after.calls;
    expect(c2).toEqual(c1);
    expect(after.log).toEqual(before.log);
    console.log(`LEADS admin: ${before.shots.length} DOM snapshots identical; getById requests old=${gb1} new=${gb2}`);
    expect(gb2).toBeLessThanOrEqual(gb1);
  }, 120000);

  it('cashier session (cannot assign: no staff dropdown)', async () => {
    resetLeadsMocks(); h.role = 'cashier'; const before = await leadsSession(LeadsOld).catch((e) => ({ err: String(e) }));
    resetLeadsMocks(); h.role = 'cashier'; const after = await leadsSession(LeadsNew).catch((e) => ({ err: String(e) }));
    // the script above picks the staff dropdown, which a cashier does not have: both versions must fail the same way
    expect(Boolean(after.err)).toBe(Boolean(before.err));
  }, 120000);
});

// =========================== STAFF ===========================
const STAFF = [
  { id: 1, name: 'Ada Admin', email: 'ada@x.com', phone: '0711', role: 'admin', status: 'active' },
  { id: 2, name: 'Mo Manager', email: 'mo@x.com', phone: '', role: 'manager', status: 'active', locked: true },
  { id: 3, name: 'Cy Cashier', email: 'cy@x.com', phone: '0733', role: 'cashier', status: 'active' },
  { id: 4, name: 'Ina Inactive', email: 'ina@x.com', phone: '0744', role: 'cashier', status: 'inactive' },
  { id: 5, name: 'Former Staff #5', email: '', phone: '', role: 'cashier', status: 'inactive', erased: true },
];

async function staffSession(Page) {
  const shots = [];
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  render(<QueryClientProvider client={qc}><Page /></QueryClientProvider>);
  await screen.findByText('Ada Admin'); await settle();
  shots.push(['list', snap()]);

  await type(screen.getByPlaceholderText('Search name, phone, email…'), 'mo'); await settle();
  await userEvent.selectOptions(screen.getAllByRole('combobox')[0], 'manager'); await settle();
  await click(screen.getByRole('radio', { name: 'Inactive' }));
  await click(screen.getByRole('radio', { name: 'All' }));
  await type(screen.getByPlaceholderText('Search name, phone, email…'), ''); await userEvent.selectOptions(screen.getAllByRole('combobox')[0], '');
  await click(screen.getByRole('radio', { name: 'Active' }));

  // create: fail, then succeed
  await click(screen.getByRole('button', { name: '+ Add staff' }));
  shots.push(['new-staff-empty', snap()]);
  const f = () => document.body;
  await type(f().querySelector('input[required]'), 'New Hire');
  await type(screen.getByPlaceholderText('0712345678'), '0722');
  await type(f().querySelector('input[type="email"]'), 'new@x.com');
  await userEvent.selectOptions(f().querySelector('form select'), 'manager');
  await type(f().querySelector('input[type="password"]'), 'Str0ng-Pass-123');
  await type(screen.getByPlaceholderText('not 1234 or 0000'), '12ab34567');   // digits only, max 6
  shots.push(['new-staff-filled-manager', snap()]);
  staffApi.create.mockRejectedValueOnce(apiErr('Email already used'));
  await click(screen.getByRole('button', { name: 'Save' }));
  shots.push(['new-staff-error', snap()]);
  await click(screen.getByRole('button', { name: 'Save' }));
  shots.push(['after-create', snap()]);

  // edit: blank password/pin vs typed
  await click(screen.getByRole('button', { name: '+ Add staff' }));       // state must be reset to empty
  shots.push(['new-staff-reopened-clean', snap()]);
  await click(screen.getByRole('button', { name: 'Cancel' }));
  const editBtns = () => screen.getAllByRole('button', { name: 'Edit' });
  await click(editBtns()[1]);
  shots.push(['edit-manager', snap()]);
  await click(screen.getByRole('button', { name: 'Save' }));              // no password/pin -> not in payload
  await click(editBtns()[1]);
  await type(f().querySelector('input[type="password"]'), 'NewPass-9999');
  await type(screen.getByPlaceholderText('not 1234 or 0000'), '5555');
  await click(screen.getByRole('button', { name: 'Save' }));              // with both -> in payload
  await click(editBtns()[2]);
  shots.push(['edit-cashier', snap()]);
  staffApi.update.mockRejectedValueOnce(apiErr('Nope'));
  await click(screen.getByRole('button', { name: 'Save' }));
  shots.push(['edit-error', snap()]);
  await click(screen.getByRole('button', { name: 'Cancel' }));

  // the "More" sheet for every kind of account, with and without the access module
  for (const control of [true, false]) {
    h.modules = { control };
    for (const s of STAFF) {
      await click(screen.getByRole('button', { name: `More actions for ${s.name}` }));
      shots.push([`more-${s.id}-control-${control}`, snap()]);
      await click(screen.getByRole('button', { name: 'Close' }));
    }
  }
  h.modules = { control: true };

  // actions
  const more = async (name) => click(screen.getByRole('button', { name: `More actions for ${name}` }));
  await more('Mo Manager'); await click(screen.getByRole('button', { name: /Unlock account/ }));
  staffApi.unlockAccount.mockRejectedValueOnce(apiErr('cannot unlock'));
  await more('Mo Manager'); await click(screen.getByRole('button', { name: /Unlock account/ }));
  await more('Cy Cashier'); await click(screen.getByRole('button', { name: /Access & permissions/ }));
  shots.push(['access-modal', snap()]);
  await more('Cy Cashier'); await click(screen.getByRole('button', { name: /Reset password/ }));
  shots.push(['temp-password', snap()]);
  await click(screen.getByRole('button', { name: 'Done' }));
  h.confirmAnswer = false;
  await more('Cy Cashier'); await click(screen.getByRole('button', { name: /Reset password/ }));
  await more('Cy Cashier'); await click(screen.getByRole('button', { name: /Sign out of all devices/ }));
  h.confirmAnswer = true;
  for (const n of [2, 1, 0]) {
    staffApi.signOutEverywhere.mockResolvedValueOnce({ data: { data: { ended: n } } });
    await more('Cy Cashier'); await click(screen.getByRole('button', { name: /Sign out of all devices/ }));
  }
  staffApi.signOutEverywhere.mockRejectedValueOnce(apiErr('boom'));
  await more('Cy Cashier'); await click(screen.getByRole('button', { name: /Sign out of all devices/ }));
  staffApi.signOutEverywhere.mockResolvedValueOnce({ data: {} });          // malformed answer -> caught as a failure
  await more('Cy Cashier'); await click(screen.getByRole('button', { name: /Sign out of all devices/ }));
  staffApi.resetPassword.mockRejectedValueOnce(apiErr('no reset'));
  await more('Cy Cashier'); await click(screen.getByRole('button', { name: /Reset password/ }));
  await click(screen.getByRole('button', { name: 'Reactivate' }));         // table button on the inactive row
  staffApi.reactivate.mockRejectedValueOnce(apiErr('no'));
  await click(screen.getByRole('button', { name: 'Reactivate' }));
  await more('Ina Inactive'); await click(screen.getByRole('button', { name: /Let them sign in again/ }));
  await more('Cy Cashier'); await click(screen.getByRole('button', { name: /Remove account/ }));
  shots.push(['remove-sheet', snap()]);

  const calls = Object.fromEntries(['list', 'create', 'update', 'reactivate', 'unlockAccount', 'signOutEverywhere', 'resetPassword'].map((k) => [k, JSON.stringify(staffApi[k].mock.calls)]));
  const out = { shots, calls, log: [...h.log] };
  cleanup();
  return out;
}

function resetStaffMocks() {
  vi.clearAllMocks(); h.log.length = 0; h.role = 'admin'; h.modules = { control: true }; h.confirmAnswer = true;
  staffApi.list.mockResolvedValue(page(STAFF));
  staffApi.create.mockResolvedValue({ data: {} });
  staffApi.update.mockResolvedValue({ data: {} });
  staffApi.reactivate.mockResolvedValue({ data: {} });
  staffApi.unlockAccount.mockResolvedValue({ data: {} });
  staffApi.signOutEverywhere.mockResolvedValue({ data: { data: { ended: 3 } } });
  staffApi.resetPassword.mockResolvedValue({ data: { data: { temporaryPassword: 'Tmp-Pass-42' } } });
}

describe('Staff: refactored page behaves exactly like the original', () => {
  it('full admin session', async () => {
    resetStaffMocks(); const before = await staffSession(StaffOld);
    resetStaffMocks(); const after = await staffSession(StaffNew);
    expect(after.shots.map((s) => s[0])).toEqual(before.shots.map((s) => s[0]));
    for (let i = 0; i < before.shots.length; i++) expect(after.shots[i][1], `DOM differs at step "${before.shots[i][0]}"`).toBe(before.shots[i][1]);
    expect(after.calls).toEqual(before.calls);
    expect(after.log).toEqual(before.log);
    console.log(`STAFF: ${before.shots.length} DOM snapshots identical; ${before.log.length} toasts/dialogs identical; API calls identical`);
  }, 180000);
});
