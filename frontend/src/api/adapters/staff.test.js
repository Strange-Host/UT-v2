import { describe, it, expect, vi, afterEach } from 'vitest';
import client, { getErrorMessage } from '../client';
import { fetchAll } from '../fetchAll';
import { newStaffApi, newAccessApi, adaptStaff, filterStaff } from './staff';
import list from './__fixtures__/staff-list.json';
import created from './__fixtures__/staff-created.json';
import reset from './__fixtures__/staff-reset.json';
import unlock from './__fixtures__/staff-unlock.json';
import signOut from './__fixtures__/staff-sign-out.json';
import removalCheck from './__fixtures__/staff-removal-check.json';
import permissions from './__fixtures__/staff-permissions.json';
import reactivate from './__fixtures__/staff-reactivate.json';

// Fixtures are recorded answers of the real new server (server/tests/contractFixtures.test.ts keeps them honest).
afterEach(() => { vi.restoreAllMocks(); });
const ok = (data) => Promise.resolve({ status: 200, data });
const refused = (status, code, message) => Promise.reject({ response: { status, data: { error: { code, message } } } });

const cashier = list.users.find((u) => u.role === 'cashier');
const admin = list.users.find((u) => u.role === 'admin');

describe('the person on the Staff page', () => {
  it('becomes the staff row the page reads: name, status word, blank strings for missing contact details', () => {
    expect(adaptStaff(cashier)).toMatchObject({ id: cashier.id, username: 'fixture.cashier', name: 'Fixture Cashier', role: 'cashier', status: 'active', erased: false, email: 'cashier.fixture@shop.test', phone: '0712000111' });
    expect(adaptStaff(admin)).toMatchObject({ email: '', phone: '' }); // the edit form needs strings, never null
    expect(adaptStaff({ ...cashier, active: false })).toMatchObject({ status: 'inactive' });
    expect(adaptStaff({ ...cashier, active: false, erased: true })).toMatchObject({ status: 'inactive', erased: true });
  });
  it('is locked while the password lockout or the PIN lockout is still running, and not after', () => {
    const now = Date.parse('2026-10-29T10:00:00Z');
    const later = '2026-10-29T10:15:00Z';
    const earlier = '2026-10-29T09:00:00Z';
    expect(adaptStaff({ ...cashier, lockedUntil: later }, now).locked).toBe(true);
    expect(adaptStaff({ ...cashier, pinLockedUntil: later }, now).locked).toBe(true);
    expect(adaptStaff({ ...cashier, lockedUntil: earlier, pinLockedUntil: earlier }, now).locked).toBe(false);
    expect(adaptStaff(cashier, now).locked).toBe(false);
  });
  it('never carries a secret', () => {
    expect(JSON.stringify(list.users.map((u) => adaptStaff(u)))).not.toMatch(/password_hash|pin_hash|scrypt|temporaryPassword/i);
  });
});

describe('the staff list', () => {
  it('asks the server once, then filters and pages on this side, in the legacy list shape', async () => {
    const get = vi.spyOn(client, 'get').mockReturnValue(ok(list));
    const res = await newStaffApi.list({ page: 1, limit: 1, pageSize: 1 });
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith('/users');
    expect(res.data).toMatchObject({ page: 1, pageSize: 1, total: list.users.length, totalPages: list.users.length });
    expect(res.data.data).toHaveLength(1);
    expect(res.data.data[0].name).toBe(adaptStaff(list.users[0]).name);
  });
  it('filters by status, role and a search over name, username, email and phone', () => {
    const rows = [...list.users, { ...cashier, id: 99, username: 'old.hand', displayName: 'Old Hand', email: 'old@shop.test', phone: '0799', active: false }].map((u) => adaptStaff(u));
    expect(filterStaff(rows, { status: 'inactive' }).map((r) => r.id)).toEqual([99]);
    expect(filterStaff(rows, { status: 'all' })).toHaveLength(rows.length);
    expect(filterStaff(rows, { status: 'active', role: 'cashier' }).map((r) => r.id)).toEqual([cashier.id]);
    expect(filterStaff(rows, { search: 'OLD.HAND' }).map((r) => r.id)).toEqual([99]);
    expect(filterStaff(rows, { search: '0712000' }).map((r) => r.id)).toEqual([cashier.id]);
    expect(filterStaff(rows, { search: 'shop.test' }).length).toBeGreaterThan(1);
    expect(filterStaff(rows, { search: 'nobody by this name' })).toEqual([]);
  });
  it('reaches every row for the pickers on other pages (Leads, Payroll, Messaging), which walk it with fetchAll', async () => {
    const many = Array.from({ length: 230 }, (_, i) => ({ ...cashier, id: 1000 + i, username: `u${i}`, displayName: `Person ${i}` }));
    vi.spyOn(client, 'get').mockReturnValue(ok({ users: many }));
    const rows = await fetchAll(newStaffApi.list, { status: 'active' });
    expect(rows).toHaveLength(230);
    expect(new Set(rows.map((r) => r.id)).size).toBe(230);
  });
});

describe('a new account', () => {
  it('sends the username and details, and hands back the one-time password for the page to show once', async () => {
    const post = vi.spyOn(client, 'post').mockReturnValue(Promise.resolve({ status: 201, data: created }));
    const res = await newStaffApi.create({ username: ' fixture.cashier ', name: 'Fixture Cashier', phone: '0712000111', email: 'cashier.fixture@shop.test', role: 'cashier', pin: '4829' });
    expect(post).toHaveBeenCalledWith('/users', { username: 'fixture.cashier', displayName: 'Fixture Cashier', role: 'cashier', email: 'cashier.fixture@shop.test', phone: '0712000111', pin: '4829' });
    expect(res.data.data).toMatchObject({ id: created.user.id, name: 'Fixture Cashier', status: 'active', temporaryPassword: created.temporaryPassword });
  });
  it('leaves the PIN out when none was typed', async () => {
    const post = vi.spyOn(client, 'post').mockReturnValue(Promise.resolve({ status: 201, data: created }));
    await newStaffApi.create({ username: 'a.b', name: 'A B', phone: '', email: '', role: 'manager', pin: '' });
    expect(post.mock.calls[0][1]).toEqual({ username: 'a.b', displayName: 'A B', role: 'manager', email: null, phone: null });
  });
  it('refuses a password typed by an admin, and a missing username, without calling the server', async () => {
    const post = vi.spyOn(client, 'post');
    await expect(newStaffApi.create({ username: 'a.b', name: 'A B', role: 'cashier', password: 'Typed-By-Admin-1' })).rejects.toThrow(/Reset password/);
    await expect(newStaffApi.create({ username: '  ', name: 'A B', role: 'cashier' })).rejects.toMatchObject({ response: { data: { error: { code: 'USERNAME_REQUIRED' } } } });
    expect(post).not.toHaveBeenCalled();
  });
  it("shows the server's own reason when the username is taken", async () => {
    vi.spyOn(client, 'post').mockReturnValue(refused(409, 'USERNAME_TAKEN', 'That username is already used.'));
    const err = await newStaffApi.create({ username: 'taken', name: 'T', role: 'cashier' }).catch((e) => e);
    expect(getErrorMessage(err, 'Could not save staff member.')).toBe('That username is already used.');
  });
});

describe('editing an account', () => {
  const payload = { name: 'Fixture Cashier', phone: '0712000111', email: 'cashier.fixture@shop.test', role: 'cashier' };
  it('changes the details with one PATCH, and leaves the PIN alone when none was typed', async () => {
    const patch = vi.spyOn(client, 'patch').mockReturnValue(ok({ user: cashier }));
    const put = vi.spyOn(client, 'put');
    const res = await newStaffApi.update(cashier.id, payload);
    expect(patch).toHaveBeenCalledWith(`/users/${cashier.id}`, { displayName: 'Fixture Cashier', role: 'cashier', email: 'cashier.fixture@shop.test', phone: '0712000111' });
    expect(put).not.toHaveBeenCalled();
    expect(res.data.data.name).toBe('Fixture Cashier');
  });
  it('clears an email or phone that was emptied', async () => {
    const patch = vi.spyOn(client, 'patch').mockReturnValue(ok({ user: cashier }));
    await newStaffApi.update(cashier.id, { ...payload, email: '', phone: '  ' });
    expect(patch.mock.calls[0][1]).toMatchObject({ email: null, phone: null });
  });
  it('sets a typed PIN on its own route after the details', async () => {
    const order = [];
    vi.spyOn(client, 'patch').mockImplementation(() => { order.push('details'); return ok({ user: cashier }); });
    const put = vi.spyOn(client, 'put').mockImplementation(() => { order.push('pin'); return ok({ user: cashier }); });
    await newStaffApi.update(cashier.id, { ...payload, pin: '4829' });
    expect(put).toHaveBeenCalledWith(`/users/${cashier.id}/pin`, { pin: '4829' });
    expect(order).toEqual(['details', 'pin']);
  });
  it('says the details were saved when only the PIN is refused', async () => {
    vi.spyOn(client, 'patch').mockReturnValue(ok({ user: cashier }));
    vi.spyOn(client, 'put').mockReturnValue(refused(422, 'PIN_TOO_WEAK', 'That PIN is too easy to guess (like 1234, 0000 or 1111). Choose another.'));
    const err = await newStaffApi.update(cashier.id, { ...payload, pin: '1234' }).catch((e) => e);
    const message = getErrorMessage(err, 'Could not save staff member.');
    expect(message).toMatch(/other details were saved/);
    expect(message).toMatch(/too easy to guess/);
    expect(err.response.status).toBe(422);
  });
  it('passes the server refusal through untouched when the details themselves are refused', async () => {
    vi.spyOn(client, 'patch').mockReturnValue(refused(409, 'LAST_ADMIN', 'There must always be at least one active admin.'));
    const put = vi.spyOn(client, 'put');
    const err = await newStaffApi.update(admin.id, { ...payload, role: 'cashier', pin: '4829' }).catch((e) => e);
    expect(getErrorMessage(err, 'x')).toBe('There must always be at least one active admin.');
    expect(put).not.toHaveBeenCalled();
  });
  it('refuses a typed password instead of dropping it', async () => {
    await expect(newStaffApi.update(cashier.id, { ...payload, password: 'Typed-By-Admin-1' })).rejects.toThrow(/Reset password/);
  });
});

describe('the account actions, in the answers the page reads', () => {
  it('deactivate is a PATCH active:false', async () => {
    const patch = vi.spyOn(client, 'patch').mockReturnValue(ok({ user: { ...cashier, active: false } }));
    const res = await newStaffApi.remove(cashier.id);
    expect(patch).toHaveBeenCalledWith(`/users/${cashier.id}`, { active: false });
    expect(res.data.data.status).toBe('inactive');
  });
  it('reactivate and unlock call their routes', async () => {
    const post = vi.spyOn(client, 'post').mockImplementation((url) => ok(url.endsWith('unlock-account') ? unlock : reactivate));
    await newStaffApi.reactivate(5);
    const res = await newStaffApi.unlockAccount(5);
    expect(post.mock.calls.map((c) => c[0])).toEqual(['/users/5/reactivate', '/users/5/unlock-account']);
    expect(res.data.data).toMatchObject({ id: 5, locked: false });
  });
  it('reset password answers { data: { temporaryPassword } }', async () => {
    const post = vi.spyOn(client, 'post').mockReturnValue(ok(reset));
    const res = await newStaffApi.resetPassword(5);
    expect(post).toHaveBeenCalledWith('/users/5/reset-password', {});
    expect(res.data.data.temporaryPassword).toBe(reset.temporaryPassword);
  });
  it('sign out everywhere answers { data: { ended } }', async () => {
    const post = vi.spyOn(client, 'post').mockReturnValue(ok({ ...signOut, ended: 3 }));
    const res = await newStaffApi.signOutEverywhere(5);
    expect(post).toHaveBeenCalledWith('/users/5/sign-out-everywhere', {});
    expect(res.data.data).toEqual({ ended: 3 });
  });
  it('the removal check keeps every field the Remove account sheet reads', async () => {
    vi.spyOn(client, 'get').mockReturnValue(ok(removalCheck));
    const { data } = (await newStaffApi.removalCheck(5)).data;
    for (const k of ['active', 'erased', 'hasActivity', 'activity', 'canDeletePermanently', 'canErase', 'eraseNeedsDeactivation', 'reasons']) expect(data, k).toHaveProperty(k);
  });
  it('permanent delete and erase send the typed name', async () => {
    const post = vi.spyOn(client, 'post').mockReturnValue(ok({ deleted: true }));
    await newStaffApi.permanentDelete(5, 'Peter Mwangi');
    await newStaffApi.erasePersonalData(5, 'Peter Mwangi');
    expect(post.mock.calls).toEqual([['/users/5/permanent-delete', { confirmName: 'Peter Mwangi' }], ['/users/5/erase-personal-data', { confirmName: 'Peter Mwangi' }]]);
  });
  it('one account by id, adapted', async () => {
    vi.spyOn(client, 'get').mockReturnValue(ok({ user: cashier }));
    expect((await newStaffApi.getById(5)).data.data.name).toBe('Fixture Cashier');
  });
});

describe('Access & permissions', () => {
  it('reads each permission with role_default and override, the names the modal uses', async () => {
    const get = vi.spyOn(client, 'get').mockReturnValue(ok(permissions));
    const { data } = (await newAccessApi.getPermissions(5)).data;
    expect(get).toHaveBeenCalledWith('/users/5/permissions');
    expect(data.locked).toBe(false);
    const p = data.permissions.find((x) => x.key === 'reports.view');
    expect(p).toMatchObject({ group: 'Reports', override: true, role_default: false, effective: true });
    expect(p).not.toHaveProperty('roleDefault');
    expect(data.permissions.map((x) => x.key)).toContain('payroll.view'); // keys are values, not renamed
  });
  it('saves only the overrides it is given: true, false, or null to go back to the role default', async () => {
    const put = vi.spyOn(client, 'put').mockReturnValue(ok(permissions));
    await newAccessApi.setPermissions(5, { 'reports.view': true, 'payroll.view': false, 'staff.view': null });
    expect(put).toHaveBeenCalledWith('/users/5/permissions', { overrides: { 'reports.view': true, 'payroll.view': false, 'staff.view': null } });
  });
  it('shows why an admin cannot be restricted', async () => {
    vi.spyOn(client, 'put').mockReturnValue(refused(409, 'ADMIN_UNRESTRICTED', 'Admins always have every permission and cannot be restricted.'));
    const err = await newAccessApi.setPermissions(admin.id, { 'reports.view': false }).catch((e) => e);
    expect(getErrorMessage(err, 'Could not save permissions.')).toMatch(/cannot be restricted/);
  });
});
