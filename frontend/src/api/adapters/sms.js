import client from '../client';
import { AdapterError, mapResponse } from './common';

// Settings > Messaging on /api/sms. Three differences the page cannot see:
//  - The server sends times as ISO text; the page's formatter reads "YYYY-MM-DD HH:MM:SS" (UTC), so they are cut to that.
//  - The options (SMS on/off, which messages, wording, paybill number and account prefix) are the server's SMS settings. They are the only
//    keys `settingsApi` knows on the new server for now: the rest of Settings and Settings > System is item 4.1, and a save that
//    includes any other key is refused whole, so nothing is half saved.
//  - Credentials are saved by an administrator who has typed their password lately; the client's re-check prompt handles that and repeats the call.

const when = (iso) => (iso ? String(iso).slice(0, 19).replace('T', ' ') : null);

export const adaptCredentials = (c) => ({ configured: c.configured, source: c.source, has_user_id: c.hasUserId, has_password: c.hasPassword, sender_id: c.senderId ?? '' });
const wrap = (data) => ({ data });

export const adaptMessage = (m) => ({
  id: m.id, to_phone: m.toPhone, template: m.template, body: m.body, status: m.status, attempts: m.attempts,
  last_error: m.lastError, provider_response: m.providerResponse, related_type: m.relatedType, related_id: m.relatedId,
  created_at: when(m.createdAt), sent_at: when(m.sentAt),
});

export const newSmsApi = {
  status: () => mapResponse(client.get('/sms/status'), (d) => wrap({ enabled: d.enabled, credentials: adaptCredentials(d.credentials), last7Days: d.last7Days })),
  getCredentials: () => mapResponse(client.get('/sms/credentials'), (d) => wrap(adaptCredentials(d))),
  saveCredentials: ({ user_id: userId, password, sender_id: senderId } = {}) =>
    mapResponse(client.put('/sms/credentials', { ...(userId ? { userId } : {}), ...(password ? { password } : {}), ...(senderId !== undefined ? { senderId } : {}) }), (d) => wrap(adaptCredentials(d))),
  removeCredentials: () => mapResponse(client.delete('/sms/credentials'), (d) => wrap(adaptCredentials(d))),
  // The page shows { ok, to, error, providerResponse }: exactly what the server says.
  sendTest: (to) => mapResponse(client.post('/sms/test', { to }), wrap),
  outbox: ({ page = 1, limit = 25, status } = {}) =>
    mapResponse(client.get('/sms/outbox', { params: { page, limit, ...(status ? { status } : {}) } }), (d) => ({ data: d.messages.map(adaptMessage), total: d.total, page: d.page, limit: d.limit })),
  retry: (id) => mapResponse(client.post(`/sms/outbox/${encodeURIComponent(id)}/retry`, {}), wrap),
};

const OPTION_KEYS = ['sms_enabled', 'sms_send_order_received', 'sms_send_payment_received', 'sms_message_type', 'sms_delivery_promise', 'sms_catalog_url', 'paybill_number', 'kcb_account_prefix'];

export const newSettingsApi = {
  get: () => mapResponse(client.get('/sms/settings'), (d) => wrap(d.settings)),
  update: async (data = {}) => {
    const other = Object.keys(data).filter((k) => !OPTION_KEYS.includes(k));
    if (other.length > 0) throw new AdapterError('SETTINGS_NOT_AVAILABLE', `These settings are not available on the new server yet: ${other.join(', ')}. Nothing was saved.`);
    return mapResponse(client.put('/sms/settings', data), (d) => wrap(d.settings));
  },
};
