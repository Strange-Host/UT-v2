// @vitest-environment-options {"url":"http://localhost:5173"}
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import axios from 'axios';
import client from '../api/client';
import { authApi } from '../api/endpoints';
import { AuthProvider } from '../context/AuthContext';
import { ToastProvider, DialogProvider } from '../context/UIContext';
import Staff from '../pages/Staff';

// Only `npm run test:e2e-new-server` sets this. The normal run has no server to talk to, so these suites are skipped.
const RUN_E2E = import.meta.env.VITE_E2E_NEW_SERVER === 'true';

// The Staff page (with Remove account and Access & permissions) on the REAL new server: over HTTP, nothing mocked.
//   terminal 1 (server/):    npm run dev:stack
//   terminal 2 (frontend/):  npm run test:e2e-new-server
const ADMIN = { email: 'admin@shop.test', password: 'Admin-Dev-Passphrase-1' };
const API = import.meta.env.VITE_NEW_API_URL;

let n = 0;
const tag = () => `${Date.now().toString(36)}${++n}`;

function Page() {
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ToastProvider><DialogProvider><AuthProvider>
        <MemoryRouter><Staff /></MemoryRouter>
      </AuthProvider></DialogProvider></ToastProvider>
    </QueryClientProvider>
  );
}

async function api(method, path, body) { const r = await client({ method, url: path, data: body }); return r.data; }
/** An account made straight on the server, so each test starts from a known person. */
const newPerson = async (over = {}) => {
  const t = tag();
  const out = await api('post', '/users', { username: `e2e.${t}`, displayName: `E2E ${t}`, role: 'cashier', email: `e2e.${t}@shop.test`, phone: '0711000000', ...over });
  return { ...out.user, temporaryPassword: out.temporaryPassword };
};
const person = (id) => api('get', `/users/${id}`).then((d) => d.user);
const button = (name) => screen.getByRole('button', { name });
const confirmDialog = () => within(document.body).getByRole('button', { name: /^Confirm$/ });

/** Finds one person in the list by typing their name in the search box, then opens their "More" sheet. */
async function find(name) {
  fireEvent.change(screen.getByPlaceholderText(/Search name, phone, email/), { target: { value: name } });
  return screen.findByText(name);
}
async function openMore(name) {
  await find(name);
  fireEvent.click(await screen.findByRole('button', { name: `More actions for ${name}` }));
  await screen.findByRole('heading', { name });
}

beforeAll(async () => {
  const health = await client.get('/health').catch((e) => e);
  if (!health?.status) throw new Error(`The new server is not reachable (${health?.message}). Start it with: cd server && npm run dev:stack`);
  await authApi.login(ADMIN.email, ADMIN.password);
}, 30_000);
afterEach(() => { cleanup(); });

describe.skipIf(!RUN_E2E)('the Staff page against the real new server', () => {
  it('lists the accounts with their usernames, and filters by role and by search', async () => {
    const p = await newPerson({ role: 'manager' });
    render(<Page />);
    expect(await screen.findByText(p.displayName)).toBeInTheDocument();
    expect(screen.getByText(p.username)).toBeInTheDocument();
    expect(screen.getByText('Admin (sample)')).toBeInTheDocument();
    fireEvent.change(screen.getByDisplayValue('All roles'), { target: { value: 'cashier' } });
    await waitFor(() => expect(screen.queryByText(p.displayName)).toBeNull());
    fireEvent.change(screen.getByDisplayValue('cashier'), { target: { value: '' } });
    await find(p.displayName);
    await waitFor(() => expect(screen.queryByText('Admin (sample)')).toBeNull());
  }, 30_000);

  it('creates an account through the form and shows its one-time password exactly once', async () => {
    const t = tag();
    render(<Page />);
    fireEvent.click(await screen.findByRole('button', { name: '+ Add staff' }));
    const sheet = await screen.findByRole('heading', { name: 'New staff member' });
    expect(sheet).toBeInTheDocument();
    expect(screen.queryByText(/^Password$/)).toBeNull(); // the server issues it
    const inputs = [...document.querySelectorAll('form input')]; // name, username, phone, email, PIN
    fireEvent.change(inputs[0], { target: { value: `Created ${t}` } });
    fireEvent.change(inputs[1], { target: { value: `created.${t}` } });
    fireEvent.change(inputs[2], { target: { value: '0722000111' } });
    fireEvent.change(inputs[3], { target: { value: `created.${t}@shop.test` } });
    fireEvent.click(button('Save'));
    expect(await screen.findByRole('heading', { name: 'Temporary password' })).toBeInTheDocument();
    const shown = document.querySelector('.select-all').textContent;
    expect(shown.length).toBeGreaterThanOrEqual(10);
    const made = (await api('get', '/users')).users.find((u) => u.username === `created.${t}`);
    expect(made).toMatchObject({ displayName: `Created ${t}`, role: 'cashier', active: true, mustChangePassword: true, phone: '0722000111' });
    fireEvent.click(button('Done'));
    expect(screen.queryByText(shown)).toBeNull(); // gone, and nowhere else on the page
    expect(await screen.findByText(`Created ${t}`)).toBeInTheDocument();
  }, 40_000);

  it('says why a username that is taken is refused, and keeps the form open', async () => {
    const p = await newPerson();
    render(<Page />);
    fireEvent.click(await screen.findByRole('button', { name: '+ Add staff' }));
    await screen.findByRole('heading', { name: 'New staff member' });
    const inputs = [...document.querySelectorAll('form input')];
    fireEvent.change(inputs[0], { target: { value: 'Someone Else' } });
    fireEvent.change(inputs[1], { target: { value: p.username } });
    fireEvent.change(inputs[2], { target: { value: '0722000222' } });
    fireEvent.change(inputs[3], { target: { value: `else.${tag()}@shop.test` } });
    fireEvent.click(button('Save'));
    expect(await screen.findByText('That username is already used.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'New staff member' })).toBeInTheDocument();
  }, 30_000);

  it('edits the details and sets a PIN; a PIN that is too easy is refused after the details are saved', async () => {
    const p = await newPerson();
    render(<Page />);
    await find(p.displayName);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    await screen.findByRole('heading', { name: 'Edit staff member' });
    const inputs = () => [...document.querySelectorAll('form input')];
    expect(inputs()).toHaveLength(4); // name, phone, email, PIN: no username (it cannot change) and no password
    fireEvent.change(inputs()[0], { target: { value: `${p.displayName} Jr` } });
    fireEvent.change(inputs()[3], { target: { value: '1234' } });
    fireEvent.click(button('Save'));
    expect(await screen.findByText(/other details were saved, but the PIN was not changed/)).toBeInTheDocument();
    expect((await person(p.id)).displayName).toBe(`${p.displayName} Jr`);
    expect((await person(p.id)).hasPin).toBe(false);

    fireEvent.change(inputs()[3], { target: { value: '4826' } });
    fireEvent.click(button('Save'));
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Edit staff member' })).toBeNull());
    expect((await person(p.id)).hasPin).toBe(true);
    expect(await screen.findByText(`${p.displayName} Jr`)).toBeInTheDocument();
  }, 40_000);

  it('deactivates from Remove account, finds the person under Inactive, and reactivates them', async () => {
    const p = await newPerson();
    render(<Page />);
    await openMore(p.displayName);
    fireEvent.click(button(/^Remove account/));
    await screen.findByRole('heading', { name: `Remove ${p.displayName}` });
    fireEvent.click(await screen.findByRole('button', { name: 'Deactivate' }));
    expect(await screen.findByText(`${p.displayName} was deactivated.`)).toBeInTheDocument();
    expect((await person(p.id)).active).toBe(false);

    fireEvent.click(screen.getByRole('radio', { name: 'Inactive' }));
    await find(p.displayName);
    fireEvent.click(await screen.findByRole('button', { name: 'Reactivate' }));
    expect(await screen.findByText(`${p.displayName} can sign in again.`)).toBeInTheDocument();
    expect((await person(p.id)).active).toBe(true);
  }, 40_000);

  it('deletes an account that never did anything, only after its name is typed', async () => {
    const p = await newPerson();
    render(<Page />);
    await openMore(p.displayName);
    fireEvent.click(button(/^Remove account/));
    await screen.findByRole('heading', { name: `Remove ${p.displayName}` });
    const del = await screen.findByRole('button', { name: 'Delete permanently' });
    expect(del).toBeDisabled();
    fireEvent.change(screen.getAllByRole('textbox').at(-1), { target: { value: p.displayName } }); // the confirm box; the page's search box is the first
    expect(del).not.toBeDisabled();
    fireEvent.click(del);
    expect(await screen.findByText(`${p.displayName} was deleted.`)).toBeInTheDocument();
    await expect(person(p.id)).rejects.toMatchObject({ response: { status: 404 } });
  }, 40_000);

  it('does not offer to remove your own account', async () => {
    render(<Page />);
    await openMore('Admin (sample)');
    expect(screen.queryByRole('button', { name: /^Remove account/ })).toBeNull();
    expect(screen.getByRole('button', { name: /^Reset password/ })).toBeInTheDocument();
  }, 30_000);

  it('resets a password and shows the new one-time password', async () => {
    const p = await newPerson();
    render(<Page />);
    await openMore(p.displayName);
    fireEvent.click(button(/^Reset password/));
    fireEvent.click(await waitFor(confirmDialog));
    expect(await screen.findByRole('heading', { name: 'Temporary password' })).toBeInTheDocument();
    const shown = document.querySelector('.select-all').textContent;
    expect(shown).not.toBe(p.temporaryPassword);
    expect(shown.length).toBeGreaterThanOrEqual(10);
  }, 30_000);

  it('signs a person out of every device, and says when there were none', async () => {
    const p = await newPerson();
    render(<Page />);
    await openMore(p.displayName);
    fireEvent.click(button(/^Sign out of all devices/));
    fireEvent.click(await waitFor(confirmDialog));
    expect(await screen.findByText(`${p.displayName} was not signed in anywhere.`)).toBeInTheDocument();
  }, 30_000);

  it('shows a locked account and unlocks it', async () => {
    const p = await newPerson();
    await api('post', `/users/${p.id}/reset-password`, {}); // gives a password we can get wrong
    for (let i = 0; i < 5; i += 1) await axios.post(`${API}/auth/login`, { email: p.email, password: 'definitely-wrong-1' }).catch(() => null);
    expect((await person(p.id)).lockedUntil).toBeTruthy();
    render(<Page />);
    await find(p.displayName);
    const row = (await screen.findByText(p.displayName)).closest('tr');
    expect(within(row).getByText('locked')).toBeInTheDocument();
    await openMore(p.displayName);
    fireEvent.click(button(/^Unlock account/));
    expect(await screen.findByText(`${p.displayName}'s account is unlocked.`)).toBeInTheDocument();
    expect((await person(p.id)).lockedUntil).toBeNull();
    await waitFor(() => expect(within((screen.getByText(p.displayName)).closest('tr')).queryByText('locked')).toBeNull());
  }, 40_000);

  it('Access & permissions: saves an override and shows it next time; an admin\'s own sheet cannot be edited', async () => {
    const p = await newPerson();
    render(<Page />);
    await openMore(p.displayName);
    fireEvent.click(button(/^Access & permissions/));
    await screen.findByRole('heading', { name: `Access for ${p.displayName}` });
    const select = await screen.findByLabelText('View reports and dashboard figures');
    expect(select.value).toBe('default');
    fireEvent.change(select, { target: { value: 'allow' } });
    fireEvent.click(button('Save 1 change'));
    expect(await screen.findByText(/Permissions saved/)).toBeInTheDocument();
    const after = await api('get', `/users/${p.id}/permissions`);
    expect(after.permissions.find((x) => x.key === 'reports.view')).toMatchObject({ override: true, effective: true });

    await openMore(p.displayName);
    fireEvent.click(button(/^Access & permissions/));
    expect((await screen.findByLabelText('View reports and dashboard figures')).value).toBe('allow');
    fireEvent.click(button('Close'));

    await openMore('Admin (sample)'); // the signed-in admin: unrestricted by rule, and nobody changes their own access
    fireEvent.click(button(/^Access & permissions/));
    expect(await screen.findByText(/Admins always have every permission/)).toBeInTheDocument();
    expect(screen.getByLabelText('View reports and dashboard figures')).toBeDisabled();
  }, 50_000);
});
