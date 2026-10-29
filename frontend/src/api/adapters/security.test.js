import { describe, it, expect, vi, afterEach } from 'vitest';
import client, { getErrorMessage } from '../client';
import { newSecurityApi } from './security';
import { newAuthApi } from './auth';
import policy from './__fixtures__/security-policy.json';
import saved from './__fixtures__/security-policy-saved.json';
import sessions from './__fixtures__/auth-sessions.json';
import revoked from './__fixtures__/auth-revoke-others.json';
import events from './__fixtures__/security-events.json';
import ended from './__fixtures__/auth-session-ended.json';

// Fixtures are recorded answers of the real new server (server/tests/contractFixtures.test.ts keeps them honest).
afterEach(() => { vi.restoreAllMocks(); });
const ok = (data) => Promise.resolve({ status: 200, data });

describe('the sign-in rules', () => {
  it('come back in the legacy envelope with the names the editor reads', async () => {
    const get = vi.spyOn(client, 'get').mockReturnValue(ok(policy));
    const data = (await newSecurityApi.policy()).data.data; // the page reads r.data.data
    expect(get).toHaveBeenCalledWith('/security/policy');
    for (const k of ['lockout', 'roles', 'unrememberedMaxHours', 'reauthMinutes', 'alerts']) expect(data, k).toHaveProperty(k);
    for (const role of ['cashier', 'manager', 'admin']) for (const k of ['lockMinutes', 'idleSignOutMinutes', 'maxHours']) expect(data.roles[role], `${role}.${k}`).toHaveProperty(k);
    for (const k of ['refundKes', 'stockUnits', 'pricePercent']) expect(data.alerts).toHaveProperty(k);
  });
  it('are saved as the whole form, and the saved policy comes back', async () => {
    const put = vi.spyOn(client, 'put').mockReturnValue(ok(saved));
    const form = JSON.parse(JSON.stringify(policy.policy));
    form.roles.cashier.lockMinutes = 7;
    const res = await newSecurityApi.updatePolicy(form);
    expect(put).toHaveBeenCalledWith('/security/policy', form);
    expect(res.data.data).toEqual(saved.policy); // the page reads saved.data
  });
  it("show the server's reason when a rule is refused", async () => {
    vi.spyOn(client, 'put').mockRejectedValue({ response: { status: 422, data: { error: { code: 'VALIDATION', message: 'cashier: signing out must come after the screen locks (sign-out minutes must be more than lock minutes).' } } } });
    const err = await newSecurityApi.updatePolicy(policy.policy).catch((e) => e);
    expect(getErrorMessage(err, 'Could not save.')).toMatch(/signing out must come after/);
  });
  it('lists the security events as the rows the page shows, newest first', async () => {
    const get = vi.spyOn(client, 'get').mockReturnValue(ok(events));
    const res = await newSecurityApi.events({ limit: 40 });
    expect(get).toHaveBeenCalledWith('/security/events', { params: { limit: 40 } });
    expect(res.data.data).toHaveLength(events.events.length);
    expect(res.data.data[0]).toEqual({ id: events.events[0].id, severity: events.events[0].severity, title: events.events[0].title, detail: events.events[0].detail, created_at: events.events[0].at, ip: events.events[0].ip });
    expect(['urgent', 'warning', 'info']).toContain(res.data.data[0].severity);
    expect(JSON.stringify(res.data)).not.toMatch(/"action"|"actor"/); // only what the row shows
  });
});

describe('the devices list, already in the shape the page reads', () => {
  it('lists devices as { sessions } with the fields the rows show', async () => {
    vi.spyOn(client, 'get').mockReturnValue(ok(sessions));
    const { data } = await newAuthApi.sessions();
    for (const k of ['id', 'current', 'device', 'remember', 'state', 'signedInAt', 'lastActiveAt']) expect(data.sessions[0], k).toHaveProperty(k);
  });
  it('signs a device out, and the others out with a count', async () => {
    const del = vi.spyOn(client, 'delete').mockReturnValue(ok(ended));
    const post = vi.spyOn(client, 'post').mockReturnValue(ok(revoked));
    await newAuthApi.endSession(9);
    const res = await newAuthApi.endOtherSessions();
    expect(del).toHaveBeenCalledWith('/auth/sessions/9');
    expect(post).toHaveBeenCalledWith('/auth/sessions/revoke-others', {});
    expect(res.data.ended).toBe(revoked.ended);
  });
});
