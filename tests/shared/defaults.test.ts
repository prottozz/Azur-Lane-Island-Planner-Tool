import { expect, test } from 'vitest';
import { emptyGameData, emptyState } from '../../src/shared/defaults';

test('emptyGameData is empty v1', () => {
  expect(emptyGameData()).toEqual({ version: 1, items: {}, buildings: {}, recipes: {}, cafes: {}, shop: [], spawns: {} });
});

test('emptyState uses specified defaults', () => {
  const s = emptyState(new Date(2026, 10, 19, 12, 0));
  expect(s.settings).toMatchObject({ priority: 'money', season: 5, resetTime: '00:00', weeklyResetDay: 1 });
  expect(s.requests).toMatchObject({ dailyCap: 0, weeklyCap: 0, lastDailyReset: '2026-11-19', lastWeeklyReset: '2026-11-16' });
  expect(s.jobs).toEqual([]);
});
