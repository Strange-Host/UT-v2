import client from '../client';
import { AdapterError, mapResponse, snakeKeys, toLegacyPage } from './common';

// The Staff screens (Staff, Remove account, Access & permissions) on the new server's /api/users routes.
//
// What the legacy screens read: every answer is { data: <payload> }, and a list is { data: [rows], page, pageSize, total, totalPages }.
// What the new server sends: plain objects ({ users }, { user }, { ended }), the whole staff list at once, camelCase.
//
// Differences the screens cannot hide (see docs/parity-harness/README.md, "Known, intended differences"):
//  - A new account needs a username, and the server issues the one-time password. A password typed by an admin is refused here
//    rather than dropped, so nobody believes they set one.
//  - The server has no search/role/status filter or paging on the staff list, so they are applied here.

const WORD = (s) => String(s ?? '').toLowerCase();
const stillLocked = (until, now) => Boolean(until) && new Date(until).getTime() > now;

/** The new server's person -> the staff row the screens read. `locked` is true while either the password or the PIN lockout runs. */
export function adaptStaff(u, now = Date.now()) {
  return {
    id: u.id,
    username: u.username,
    name: u.displayName,
    email: u.email ?? '',
    phone: u.phone ?? '',
    role: u.role,
    status: u.active ? 'active' : 'inactive',
    erased: Boolean(u.erased),
    locked: stillLocked(u.lockedUntil, now) || stillLocked(u.pinLockedUntil, now),
    has_pin: Boolean(u.hasPin),
    must_change_password: u.mustChangePassword ? 1 : 0,
    last_login_at: u.lastLoginAt ?? null,
    created_at: u.createdAt ?? null,
  };
}

const wrap = (data) => ({ data });
const refuseTypedPassword = (password) => {
  if (password) throw new AdapterError('PASSWORD_NOT_SETTABLE', 'Passwords are issued by the system. Use "Reset password" to create a temporary one.');
};
const blank = (v) => (v === undefined ? undefined : (String(v).trim() || null));

/** Search (name, username, email, phone), role and status, the way the legacy list filtered. */
export function filterStaff(rows, { search, role, status } = {}) {
  const q = WORD(search).trim();
  return rows.filter((s) => {
    if (role && s.role !== role) return false;
    if (status && status !== 'all' && s.status !== status) return false;
    if (!q) return true;
    return [s.name, s.username, s.email, s.phone].some((f) => WORD(f).includes(q));
  });
}

export const newStaffApi = {
  list: async (params = {}) => {
    const res = await client.get('/users');
    const rows = filterStaff(res.data.users.map((u) => adaptStaff(u)), params);
    const size = Math.max(1, Number(params.pageSize ?? params.limit) || 50);
    const page = Math.max(1, Number(params.page) || 1);
    return { ...res, data: toLegacyPage(rows.slice((page - 1) * size, page * size), rows.length, { page, pageSize: size }) };
  },
  getById: (id) => mapResponse(client.get(`/users/${id}`), (d) => wrap(adaptStaff(d.user))),

  // The one-time password is in the answer (`temporaryPassword`) and nowhere else: the page shows it once.
  create: async ({ username, name, phone, email, role, password, pin }) => {
    refuseTypedPassword(password);
    if (!String(username ?? '').trim()) throw new AdapterError('USERNAME_REQUIRED', 'Enter a username for the new account.');
    const body = { username: String(username).trim(), displayName: name, role, email: blank(email) ?? null, phone: blank(phone) ?? null, ...(pin ? { pin } : {}) };
    return mapResponse(client.post('/users', body), (d) => wrap({ ...adaptStaff(d.user), temporaryPassword: d.temporaryPassword }));
  },

  // The details first, then the PIN (its own route). If only the PIN is refused, the message says the details were saved.
  update: async (id, { name, phone, email, role, password, pin } = {}) => {
    refuseTypedPassword(password);
    const body = {
      ...(name !== undefined ? { displayName: name } : {}),
      ...(role !== undefined ? { role } : {}),
      ...(email !== undefined ? { email: blank(email) } : {}),
      ...(phone !== undefined ? { phone: blank(phone) } : {}),
    };
    let res = Object.keys(body).length ? await client.patch(`/users/${id}`, body) : null;
    if (pin) {
      try {
        res = await client.put(`/users/${id}/pin`, { pin });
      } catch (err) {
        const e = err?.response?.data?.error;
        if (res && e) throw new AdapterError(e.code, `The other details were saved, but the PIN was not changed: ${e.message}`, err.response.status);
        throw err;
      }
    }
    return { ...(res ?? { status: 200 }), data: wrap(res ? adaptStaff(res.data.user) : null) };
  },

  // "Remove" on the legacy screens means deactivate; deleting and erasing have their own calls below.
  remove: (id) => mapResponse(client.patch(`/users/${id}`, { active: false }), (d) => wrap(adaptStaff(d.user))),
  reactivate: (id) => mapResponse(client.post(`/users/${id}/reactivate`, {}), wrap),
  unlockAccount: (id) => mapResponse(client.post(`/users/${id}/unlock-account`, {}), (d) => wrap(adaptStaff(d.user))),
  signOutEverywhere: (id) => mapResponse(client.post(`/users/${id}/sign-out-everywhere`, {}), (d) => wrap({ ended: d.ended })),
  resetPassword: (id) => mapResponse(client.post(`/users/${id}/reset-password`, {}), (d) => wrap({ temporaryPassword: d.temporaryPassword, user: adaptStaff(d.user) })),
  removalCheck: (id) => mapResponse(client.get(`/users/${id}/removal-check`), wrap),
  permanentDelete: (id, confirmName) => mapResponse(client.post(`/users/${id}/permanent-delete`, { confirmName }), wrap),
  erasePersonalData: (id, confirmName) => mapResponse(client.post(`/users/${id}/erase-personal-data`, { confirmName }), wrap),
  // No screen reads this today; the sessions keep the server's names.
  sessions: (id) => mapResponse(client.get(`/users/${id}/sessions`), (d) => wrap(d.sessions)),
};

// "Access & permissions": each key with its group, label, role default (`role_default`), the override (true, false or null) and the effective value.
export const newAccessApi = {
  getPermissions: (staffId) => mapResponse(client.get(`/users/${staffId}/permissions`), (d) => wrap(snakeKeys(d))),
  setPermissions: (staffId, overrides) => mapResponse(client.put(`/users/${staffId}/permissions`, { overrides }), (d) => wrap(snakeKeys(d))),
};
