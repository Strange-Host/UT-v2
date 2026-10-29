import { describe, it, expect } from 'vitest';
import { getErrorMessage } from './client';

const failure = (data) => ({ response: { status: 422, data } });

describe('the message shown for a failed request', () => {
  it('is the server message', () => {
    expect(getErrorMessage(failure({ error: { code: 'X', message: 'That username is already used.' } }), 'fallback')).toBe('That username is already used.');
  });
  it('adds the reasons the server lists for a request it could not accept', () => {
    const data = { error: { code: 'VALIDATION', message: 'Some fields are missing or not valid.' }, details: [{ field: '', message: 'The end cannot be before the start.' }] };
    expect(getErrorMessage(failure(data))).toBe('Some fields are missing or not valid. The end cannot be before the start.');
  });
  it('shows at most three reasons, and skips empty ones', () => {
    const details = [{ message: 'A.' }, { message: '' }, { message: 'B.' }, { message: 'C.' }, { message: 'D.' }];
    expect(getErrorMessage(failure({ error: { message: 'Bad.' }, details }))).toBe('Bad. A. B. C.');
  });
  it('falls back when there is no server message (no connection, or a page error)', () => {
    expect(getErrorMessage(new Error('Network Error'), 'Could not save.')).toBe('Could not save.');
    expect(getErrorMessage(failure({}), 'Could not save.')).toBe('Could not save.');
  });
});
