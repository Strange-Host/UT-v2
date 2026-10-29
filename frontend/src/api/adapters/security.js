import client from '../client';
import { mapResponse, notImplemented } from './common';

// The Security page's admin section. The server keeps the sign-in rules under the same names the page already uses
// ({ lockout, roles: { cashier|manager|admin: { lockMinutes, idleSignOutMinutes, maxHours } }, unrememberedMaxHours, reauthMinutes, alerts }),
// so the policy only needs the legacy { data } envelope. Devices (authApi.sessions / endSession / endOtherSessions) already match.
const wrap = (d) => ({ data: d.policy });

export const newSecurityApi = {
  policy: () => mapResponse(client.get('/security/policy'), wrap),
  // Saving asks for the password again if it was not typed lately; the client's re-check prompt handles that and repeats the save.
  updatePolicy: (data) => mapResponse(client.put('/security/policy', data), wrap),
  // The server keeps an audit trail but has no route that lists it for this page yet.
  events: notImplemented('securityApi.events'),
};
