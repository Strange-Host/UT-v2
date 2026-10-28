import { useState } from 'react';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { staffApi } from '../api/endpoints';
import { getErrorMessage } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast, useDialog } from '../context/UIContext';
import StaffAccessModal from '../components/StaffAccessModal';
import useModules from '../hooks/useModules';
import Pager, { usePager } from '../components/Pager';
import { Segmented } from '../components/Picker';
import RemoveAccountSheet from '../components/RemoveAccountSheet';
import { passwordHint } from '../utils/passwordRules';

import Sheet from '../components/Sheet';
import { FormLabel, FormInput, FormSelect, ErrorBanner } from '../components/FormUI';
const emptyForm = { name: '', phone: '', email: '', password: '', pin: '', role: 'cashier' };
const ROLES = ['admin', 'manager', 'cashier'];
const ROW_BUTTON = 'min-h-[44px] sm:min-h-[36px] px-3 rounded-lg border border-line text-xs font-medium hover:border-text-muted';

// What an edit sends: the password and PIN only when something was typed, so leaving them blank keeps the current ones.
function updatePayload({ name, phone, email, role, password, pin }) {
  const payload = { name, phone, email, role };
  if (password) payload.password = password;
  if (pin) payload.pin = pin;
  return payload;
}

export default function Staff() {
  const toast = useToast();
  const dialog = useDialog();
  const { user: currentUser } = useAuth();
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('active');   // active | inactive | all
  const [actionsFor, setActionsFor] = useState(null);           // the "more actions" sheet
  const [removing, setRemoving] = useState(null);               // the "remove this account" sheet
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');
  const [tempPassword, setTempPassword] = useState(null);
  const [accessFor, setAccessFor] = useState(null);
  const modules = useModules();
  const queryClient = useQueryClient();

  const pager = usePager(25);
  const { data, isLoading } = useQuery({
    queryKey: ['staff', { search, roleFilter, statusFilter, page: pager.page, size: pager.pageSize }],
    queryFn: () => staffApi.list({ ...pager.params, search: search || undefined, role: roleFilter || undefined, status: statusFilter === 'all' ? undefined : statusFilter }).then((r) => r.data),
    placeholderData: keepPreviousData,
  });
  const staff = data?.data || [];

  function refreshStaff() {
    queryClient.invalidateQueries({ queryKey: ['staff'] });
  }

  function openNew() {
    setForm(emptyForm);
    setError('');
    setEditing({});
  }

  function openEdit(s) {
    setForm({ name: s.name, phone: s.phone || '', email: s.email, password: '', pin: '', role: s.role });
    setError('');
    setEditing(s);
  }

  async function handleSave(e) {
    e.preventDefault();
    setError('');
    try {
      await (editing.id ? staffApi.update(editing.id, updatePayload(form)) : staffApi.create(form));
      refreshStaff();
      setEditing(null);
    } catch (err) {
      setError(getErrorMessage(err, 'Could not save staff member.'));
    }
  }

  // Every account action has the same shape: call the API, do `onDone` with the answer, or say why it failed.
  async function runAccountAction(call, failureMessage, onDone) {
    try {
      onDone(await call());
    } catch (err) {
      toast.error(getErrorMessage(err, failureMessage));
    }
  }

  function handleReactivate(s) {
    return runAccountAction(() => staffApi.reactivate(s.id), 'Could not reactivate.', () => {
      refreshStaff();
      toast.success(`${s.name} can sign in again.`);
    });
  }

  function handleUnlock(s) {
    return runAccountAction(() => staffApi.unlockAccount(s.id), 'Could not unlock.', () => {
      refreshStaff();
      toast.success(`${s.name}'s account is unlocked.`);
    });
  }

  async function handleSignOutEverywhere(s) {
    if (!(await dialog.confirm({ message: `Sign ${s.name} out of every device they are using?`, danger: true }))) return;
    await runAccountAction(() => staffApi.signOutEverywhere(s.id), 'Could not sign them out.', ({ data }) => {
      const { ended } = data.data;
      toast.success(ended ? `Signed out of ${ended} device${ended === 1 ? '' : 's'}.` : `${s.name} was not signed in anywhere.`);
    });
  }

  async function handleResetPassword(s) {
    if (!(await dialog.confirm(`Generate a temporary password for ${s.name}?`))) return;
    await runAccountAction(() => staffApi.resetPassword(s.id), 'Could not reset password.', ({ data }) => {
      setTempPassword({ name: s.name, password: data.data.temporaryPassword });
    });
  }

  return (
    <div className="p-4 md:p-8 max-w-5xl">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="font-display font-700 text-2xl">Staff</h1>
          <p className="text-text-muted text-sm mt-1">{staff.length} staff member{staff.length === 1 ? '' : 's'}</p>
        </div>
        <button
          onClick={openNew}
          className="px-4 py-2.5 rounded-lg bg-ink text-white text-sm font-medium hover:bg-ink-soft transition-colors whitespace-nowrap"
        >
          + Add staff
        </button>
      </div>

      <Segmented
        value={statusFilter} onChange={(v) => { setStatusFilter(v); pager.reset(); }} aria-label="Which accounts to show" className="mb-3 max-w-sm"
        options={[{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }, { value: 'all', label: 'All' }]}
      />

      <div className="flex flex-wrap gap-2 mb-4">
        <input
          value={search} onChange={(e) => { setSearch(e.target.value); pager.reset(); }}
          placeholder="Search name, phone, email…"
          className="flex-1 min-w-[200px] px-3 py-2 rounded-lg border border-line outline-none focus:border-accent text-sm"
        />
        <select
          value={roleFilter} onChange={(e) => { setRoleFilter(e.target.value); pager.reset(); }}
          className="px-3 py-2 rounded-lg border border-line outline-none focus:border-accent text-sm"
        >
          <option value="">All roles</option>
          {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>

      <div className="bg-surface border border-line rounded-xl overflow-hidden scroll-x">
        <table className="stack-sm w-full text-sm min-w-[640px]">
          <thead>
            <tr className="border-b border-line text-left text-text-muted">
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Contact</th>
              <th className="px-4 py-3 font-medium">Role</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={5} className="px-4 py-8 text-center text-text-muted">Loading…</td></tr>}
            {!isLoading && staff.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-text-muted">No staff found.</td></tr>
            )}
            {staff.map((s) => (
              <tr key={s.id} className="border-b border-line last:border-0">
                <td className="px-4 py-3 font-medium whitespace-nowrap">{s.name}</td>
                <td className="px-4 py-3 text-text-muted whitespace-nowrap">
                  <div>{s.email}</div>
                  {s.phone && <div className="text-xs">{s.phone}</div>}
                </td>
                <td className="px-4 py-3 capitalize">{s.role}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-1 rounded-full ${s.status === 'active' ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger'}`}>
                    {s.erased ? 'erased' : s.status}
                  </span>
                  {s.locked && <span className="ml-1.5 text-xs px-2 py-1 rounded-full bg-accent/25 text-ink">locked</span>}
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  <div className="flex gap-2 justify-start sm:justify-end">
                    {!s.erased && s.status === 'inactive' && (
                      <button onClick={() => handleReactivate(s)} className={ROW_BUTTON}>Reactivate</button>
                    )}
                    {!s.erased && (
                      <button onClick={() => openEdit(s)} className={ROW_BUTTON}>Edit</button>
                    )}
                    <button onClick={() => setActionsFor(s)} className={ROW_BUTTON} aria-label={`More actions for ${s.name}`}>More ▾</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Pager pager={pager} data={data} noun="staff members" />

      {editing !== null && (
        <StaffFormSheet editing={editing} form={form} setForm={setForm} error={error} onSubmit={handleSave} onClose={() => setEditing(null)} />
      )}

      {actionsFor && (
        <StaffActionsSheet
          staff={actionsFor} currentUserId={currentUser?.id} canManageAccess={modules.control}
          onClose={() => setActionsFor(null)}
          onUnlock={handleUnlock} onAccess={setAccessFor} onResetPassword={handleResetPassword}
          onSignOutEverywhere={handleSignOutEverywhere} onReactivate={handleReactivate} onRemove={setRemoving}
        />
      )}

      {removing && <RemoveAccountSheet staff={removing} onClose={() => setRemoving(null)} />}

      {accessFor && modules.control && <StaffAccessModal staff={accessFor} isSelf={accessFor.id === currentUser?.id} onClose={() => setAccessFor(null)} />}

      {tempPassword && <TempPasswordSheet tempPassword={tempPassword} onClose={() => setTempPassword(null)} />}
    </div>
  );
}

function StaffFormSheet({ editing, form, setForm, error, onSubmit, onClose }) {
  const set = (field) => (e) => setForm({ ...form, [field]: e.target.value });
  return (
    <Sheet onClose={onClose} size="sm" as="form" onSubmit={onSubmit}>
      <h2 className="font-display font-700 text-lg mb-4">{editing.id ? 'Edit staff member' : 'New staff member'}</h2>
      <ErrorBanner>{error}</ErrorBanner>

      <FormLabel>Name</FormLabel>
      <FormInput required autoFocus value={form.name} onChange={set('name')} />

      <FormLabel>Phone</FormLabel>
      <FormInput required value={form.phone} onChange={set('phone')} placeholder="0712345678" />

      <FormLabel>Email</FormLabel>
      <FormInput required type="email" autoCapitalize="none" autoCorrect="off" spellCheck="false" value={form.email} onChange={set('email')} />

      <FormLabel>Role</FormLabel>
      <FormSelect value={form.role} onChange={set('role')}>
        {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
      </FormSelect>

      <FormLabel>
        {editing.id ? 'New password (leave blank to keep current)' : 'Password'}
      </FormLabel>
      <FormInput required={!editing.id} type="password" value={form.password} onChange={set('password')} autoComplete="new-password" spacing="mb-1" />
      <p className="text-xs text-text-muted mb-3">{passwordHint(form.role)}</p>

      <FormLabel>
        {editing.id ? 'New register PIN (optional)' : 'Register PIN (optional, 4-6 digits)'}
        {form.role !== 'cashier' && <span className="font-normal"> — only cashiers can use a PIN</span>}
      </FormLabel>
      <FormInput value={form.pin} onChange={(e) => setForm({ ...form, pin: e.target.value.replace(/\D/g, '').slice(0, 6) })}
        inputMode="numeric" autoComplete="off" placeholder="not 1234 or 0000" spacing="mb-5" />

      <div className="flex gap-2">
        <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-lg border border-line text-sm font-medium">Cancel</button>
        <button type="submit" className="flex-1 py-2.5 rounded-lg bg-ink text-white text-sm font-medium hover:bg-ink-soft">Save</button>
      </div>
    </Sheet>
  );
}

// The "More ▾" sheet: which actions appear depends on the account's state (locked, erased, active/inactive) and on who is looking.
function StaffActionsSheet({
  staff: s, currentUserId, canManageAccess, onClose, onUnlock, onAccess, onResetPassword, onSignOutEverywhere, onReactivate, onRemove,
}) {
  const act = (label, hint, fn, tone) => (
    <button key={label} type="button" onClick={() => { onClose(); fn(); }}
      className={`w-full text-left min-h-[56px] px-4 py-2 rounded-xl border hover:border-text-muted ${tone === 'danger' ? 'border-danger/40' : 'border-line'}`}>
      <span className={`block text-sm font-medium ${tone === 'danger' ? 'text-danger' : ''}`}>{label}</span>
      <span className="block text-xs text-text-muted">{hint}</span>
    </button>
  );
  return (
    <Sheet onClose={onClose} size="sm" label={`Actions for ${s.name}`}>
      <h2 className="font-display font-700 text-lg mb-1">{s.name}</h2>
      <p className="text-sm text-text-muted mb-3 capitalize">{s.erased ? 'Erased account' : `${s.role} · ${s.status}`}</p>
      <div className="space-y-2 mb-4">
        {s.locked && act('Unlock account', 'They were locked out after wrong passwords or PINs.', () => onUnlock(s))}
        {!s.erased && s.status === 'active' && canManageAccess && act('Access & permissions', 'What they can see and do, and sign-in codes.', () => onAccess(s))}
        {!s.erased && s.status === 'active' && act('Reset password', 'Create a temporary password they must change.', () => onResetPassword(s))}
        {!s.erased && act('Sign out of all devices', 'Ends every sign-in this person has right now.', () => onSignOutEverywhere(s))}
        {!s.erased && s.status === 'inactive' && act('Reactivate', 'Let them sign in again.', () => onReactivate(s))}
        {s.id !== currentUserId && !(s.erased) && act('Remove account…', 'Deactivate, delete (unused accounts) or erase personal data.', () => onRemove(s), 'danger')}
        {s.erased && <p className="text-sm text-text-muted px-1">This account's personal data was erased. Their records are kept as “{s.name}”.</p>}
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={onClose} className="flex-1 min-h-[44px] rounded-lg border border-line text-sm font-medium">Close</button>
      </div>
    </Sheet>
  );
}

function TempPasswordSheet({ tempPassword, onClose }) {
  return (
    <Sheet onClose={onClose} size="sm">
      <h2 className="font-display font-700 text-lg mb-3">Temporary password</h2>
      <p className="text-sm text-text-muted mb-3">
        Share this with {tempPassword.name} directly — it won't be shown again, and there's no email/SMS delivery in this build.
      </p>
      <div className="font-mono text-lg px-3 py-2 rounded-lg bg-paper border border-line mb-5 text-center select-all">
        {tempPassword.password}
      </div>
      <button onClick={onClose} className="w-full py-2.5 rounded-lg bg-ink text-white text-sm font-medium">Done</button>
    </Sheet>
  );
}
