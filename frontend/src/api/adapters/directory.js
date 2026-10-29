import client from '../client';

// The staff accounts, read once and kept for 30 seconds. Screens that pick a person by id (Leads, Payroll) need their username,
// which is what the new server keys records by. A role that may not read the staff list (a cashier) gets an empty list and sees usernames.
let directory = { at: 0, people: [] };
export const resetDirectory = () => { directory = { at: 0, people: [] }; };
export async function people() {
  if (Date.now() - directory.at < 30_000 && directory.people.length) return directory.people;
  try {
    const res = await client.get('/users');
    directory = { at: Date.now(), people: res.data.users };
  } catch { /* the caller falls back to usernames */ }
  return directory.people;
}
