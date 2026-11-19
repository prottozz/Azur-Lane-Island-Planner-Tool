import { describe, expect, test } from 'vitest';
import { formatDuration, lastResetAt, lastWeeklyResetAt, localDay, parseDuration } from '../../src/shared/time';

describe('parseDuration', () => {
  // bare number = minutes
  test.each([['2:15', 8100], ['02:15:00', 8100], ['0:45', 2700], ['45m', 2700], ['1h 30m', 5400], ['1h30m', 5400], ['90', 5400], ['2h', 7200]])
    ('parseDuration(%s) = %i', (s, sec) => expect(parseDuration(s)).toEqual({ ok: true, value: sec }));

  test.each(['', '  ', 'abc', '1:99', '1:2:3:4', '1:30:75', '-5', '0', '0:00', '0m', '1.5h', 'NaN'])
    ('parseDuration(%j) fails', s => {
      const r = parseDuration(s);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toBeTruthy();
    });
});

test('formatDuration', () => {
  expect(formatDuration(3900)).toBe('1:05:00');
  expect(formatDuration(2700)).toBe('0:45:00');
});

test('localDay formats local YYYY-MM-DD', () => {
  expect(localDay(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
});

describe('resets', () => {
  test('lastResetAt before reset time returns yesterday', () => {
    expect(lastResetAt(new Date(2026, 10, 19, 3, 0), '04:00')).toEqual(new Date(2026, 10, 18, 4, 0));
  });
  test('lastResetAt after reset time returns today', () => {
    expect(lastResetAt(new Date(2026, 10, 19, 5, 0), '04:00')).toEqual(new Date(2026, 10, 19, 4, 0));
  });
  test('lastResetAt exactly at reset returns now', () => {
    expect(lastResetAt(new Date(2026, 10, 19, 4, 0), '04:00')).toEqual(new Date(2026, 10, 19, 4, 0));
  });
  test('lastWeeklyResetAt finds most recent Monday reset', () => {
    expect(lastWeeklyResetAt(new Date(2026, 10, 19, 12, 0), '04:00', 1)).toEqual(new Date(2026, 10, 16, 4, 0));
  });
  test('lastWeeklyResetAt on reset weekday before reset time goes back a week', () => {
    expect(lastWeeklyResetAt(new Date(2026, 10, 16, 3, 0), '04:00', 1)).toEqual(new Date(2026, 10, 9, 4, 0));
  });
});
