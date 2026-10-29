# Parity harness

Proves a page behaves the same before and after a change. Used in the audit to check the Leads and Staff refactors (every DOM snapshot, API call, toast and dialog matched).

- `LeadsOld.jsx`, `StaffOld.jsx`: the **exact original** pages from the old repo (`update` @ 8ccb1a5). In git tag `frontend-original` these two pages are the audit refactor, so these copies are the true originals.
- `parity.test.jsx`: renders the old and the new page through the same scripted session with a mocked API and compares them.

To use it for a restyle:
1. Copy the harness and the original page into `frontend/src/__parity__/` (the original page keeps the same relative imports as `pages/`).
2. Compare **text, roles, labels, API calls, toasts and dialogs**, not class names: in `canon()` drop the `class` attribute, because a restyle changes classes on purpose.
3. Run `npx vitest run src/__parity__`, then delete the folder (it is not part of the app).

## Known, intended differences from the originals
These are changes the build plan asked for, so a parity run should expect them and not count them as regressions:
- **Sign-in codes removed (D5, item 0.6).** `Login.jsx` has no code-entry step, `StaffAccessModal.jsx` has no "Sign-in code by SMS" switch, and the Staff action "Access & permissions" now reads "What they can see and do." (`StaffOld.jsx` still ends with ", and sign-in codes.").
- **Staff wired to the new server (item 1.1).** The new server issues passwords, so `Staff.jsx` has no Password field: a new account shows its one-time password once (the same sheet as "Reset password"), and an edit changes the PIN but not the password. A new account asks for a **Username** (2 to 32 characters, permanent). Each row shows the username under the name. Email stays required on the form, as before. The staff adapter refuses a typed password with a message instead of dropping it. `StaffAccessModal.jsx` lost a comment about sign-in codes.
- **Leads wired to the new server (item 1.2).** The server's pipeline is new, contacted, qualified, converted, lost, so: "Rescheduled" and its follow-up date are gone (there is a "Qualified" step instead); "Cancelled" is the server's `lost` and asks why; the source list drops "referral" (files as other) and adds phone and website; the form's email is added to the lead's notes (the server has no email field); a repeat enquiry from a phone that already has an open lead says so instead of looking like a new lead. A call, message, meeting or note logged on a lead is stored as a message (a meeting is a note starting "Meeting: "). **Convert to order** sends payment type and city in the order's notes, and adding to an existing order is not offered (the server refuses a second active order for a phone). `productsApi.list` now works for the product pickers; the rest of `productsApi` waits for item 2.2.

