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
