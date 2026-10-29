import { describe, it, expect, vi, afterEach } from 'vitest';
import client, { getErrorMessage } from '../client';
import { newSmsApi, newSettingsApi } from './sms';
import status from './__fixtures__/sms-status.json';
import credentials from './__fixtures__/sms-credentials.json';
import outbox from './__fixtures__/sms-outbox.json';
import testSend from './__fixtures__/sms-test.json';
import retried from './__fixtures__/sms-retry.json';
import options from './__fixtures__/sms-settings.json';

// Fixtures are recorded answers of the real new server (server/tests/contractFixtures.test.ts keeps them honest).
afterEach(() => { vi.restoreAllMocks(); });
const ok = (data) => Promise.resolve({ status: 200, data });
const refused = (status, code, message) => Promise.reject({ response: { status, data: { error: { code, message } } } });

describe('SMS status and credentials', () => {
  it('give the page the names it reads, and never a secret', async () => {
    vi.spyOn(client, 'get').mockReturnValue(ok(status));
    const { data } = (await newSmsApi.status()).data;
    expect(data).toEqual({ enabled: true, credentials: { configured: true, source: 'database', has_user_id: true, has_password: true, sender_id: 'URBAN' }, last7Days: { queued: 1, failed: 1 } });
    vi.spyOn(client, 'get').mockReturnValue(ok(credentials));
    expect((await newSmsApi.getCredentials()).data.data).toMatchObject({ configured: true, has_user_id: true });
    expect(JSON.stringify([status, credentials])).not.toMatch(/zet-pass|zet-user/);
  });
  it('save only what was typed: a blank user id or password leaves the saved one alone', async () => {
    const put = vi.spyOn(client, 'put').mockReturnValue(ok(credentials));
    await newSmsApi.saveCredentials({ user_id: '', password: '', sender_id: 'URBAN' });
    expect(put).toHaveBeenLastCalledWith('/sms/credentials', { senderId: 'URBAN' });
    await newSmsApi.saveCredentials({ user_id: 'zet-user', password: 'p', sender_id: '' });
    expect(put).toHaveBeenLastCalledWith('/sms/credentials', { userId: 'zet-user', password: 'p', senderId: '' });
  });
  it('remove the credentials, and show why a first save is refused', async () => {
    const del = vi.spyOn(client, 'delete').mockReturnValue(ok({ ...credentials, configured: false }));
    expect((await newSmsApi.removeCredentials()).data.data.configured).toBe(false);
    expect(del).toHaveBeenCalledWith('/sms/credentials');
    vi.spyOn(client, 'put').mockReturnValue(refused(422, 'SMS_CREDENTIALS_INCOMPLETE', 'Both the Zettatel user ID and password are needed the first time you save credentials.'));
    const err = await newSmsApi.saveCredentials({ sender_id: 'X' }).catch((e) => e);
    expect(getErrorMessage(err, 'x')).toMatch(/needed the first time/);
  });
});

describe('the test message', () => {
  it('answers with what the page shows: ok, the masked number, any error and the gateway reply', async () => {
    const post = vi.spyOn(client, 'post').mockReturnValue(ok(testSend));
    const res = await newSmsApi.sendTest('0712345678');
    expect(post).toHaveBeenCalledWith('/sms/test', { to: '0712345678' });
    expect(res.data.data).toEqual(testSend);
    expect(res.data.data).toMatchObject({ ok: true, to: expect.stringContaining('****'), providerResponse: expect.any(String) });
  });
});

describe('recent messages', () => {
  it('are rows the page reads, with the time in the form its formatter parses', async () => {
    const get = vi.spyOn(client, 'get').mockReturnValue(ok({ ...outbox, page: 1, limit: 10 }));
    const res = await newSmsApi.outbox({ limit: 10 });
    expect(get).toHaveBeenCalledWith('/sms/outbox', { params: { page: 1, limit: 10 } });
    const [failed, queued] = res.data.data;
    expect(failed).toMatchObject({ id: 2, to_phone: '254722345678', template: 'payment_received', status: 'failed', attempts: 5, last_error: 'gateway said no', sent_at: null });
    expect(failed.created_at).toMatch(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/);
    expect(new Date(`${failed.created_at.replace(' ', 'T')}Z`).getTime()).toBe(new Date(outbox.messages[0].createdAt).getTime() - (new Date(outbox.messages[0].createdAt).getMilliseconds()));
    expect(queued).toMatchObject({ status: 'queued', related_type: 'order', related_id: 'UT-1' });
    expect(res.data.total).toBe(outbox.total);
  });
  it('can be filtered by status, and a failed one can be retried', async () => {
    const get = vi.spyOn(client, 'get').mockReturnValue(ok({ ...outbox, page: 1, limit: 25 }));
    await newSmsApi.outbox({ status: 'failed' });
    expect(get).toHaveBeenCalledWith('/sms/outbox', { params: { page: 1, limit: 25, status: 'failed' } });
    const post = vi.spyOn(client, 'post').mockReturnValue(ok(retried));
    expect((await newSmsApi.retry(2)).data.data).toEqual({ id: retried.id, status: 'queued' });
    expect(post).toHaveBeenCalledWith('/sms/outbox/2/retry', {});
  });
  it('show why a message cannot be retried', async () => {
    vi.spyOn(client, 'post').mockReturnValue(refused(409, 'SMS_NOT_RETRYABLE', 'Only failed or expired messages can be retried (this one is "sent").'));
    const err = await newSmsApi.retry(1).catch((e) => e);
    expect(getErrorMessage(err, 'x')).toMatch(/Only failed or expired/);
  });
});

describe('the settings the Messaging page saves', () => {
  it('reads the options under the legacy key names the page already uses', async () => {
    vi.spyOn(client, 'get').mockReturnValue(ok(options));
    const { data } = (await newSettingsApi.get()).data;
    expect(Object.keys(data).sort()).toEqual(['kcb_account_prefix', 'paybill_number', 'sms_catalog_url', 'sms_delivery_promise', 'sms_enabled', 'sms_message_type', 'sms_send_order_received', 'sms_send_payment_received']);
    expect(data.sms_enabled).toBe('1');
  });
  it('saves a card at a time, and the card keeps only its own keys', async () => {
    const put = vi.spyOn(client, 'put').mockReturnValue(ok(options));
    await newSettingsApi.update({ paybill_number: '522522', kcb_account_prefix: '' });
    expect(put).toHaveBeenCalledWith('/sms/settings', { paybill_number: '522522', kcb_account_prefix: '' });
  });
  it('refuses a save that includes a setting this server does not have yet, saving nothing', async () => {
    const put = vi.spyOn(client, 'put');
    const err = await newSettingsApi.update({ sms_enabled: '1', business_name: 'Urban Trends', currency: 'KES' }).catch((e) => e);
    expect(getErrorMessage(err, 'x')).toBe('These settings are not available on the new server yet: business_name, currency. Nothing was saved.');
    expect(put).not.toHaveBeenCalled();
  });
  it("shows the server's reason for a value it refuses", async () => {
    vi.spyOn(client, 'put').mockRejectedValue({ response: { status: 422, data: { error: { code: 'VALIDATION', message: 'Some fields are missing or not valid.' }, details: [{ field: 'paybill_number', message: 'must be 5 to 10 digits' }] } } });
    const err = await newSettingsApi.update({ paybill_number: '12ab' }).catch((e) => e);
    expect(getErrorMessage(err, 'x')).toMatch(/must be 5 to 10 digits/);
  });
});
