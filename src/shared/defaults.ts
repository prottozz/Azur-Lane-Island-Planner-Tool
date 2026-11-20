import type { GameData, State } from './types';
import { lastResetAt, lastWeeklyResetAt, localDay } from './time';

export function emptyGameData(): GameData {
  return { version: 1, items: {}, buildings: {}, recipes: {}, cafes: {}, shop: [], spawns: {} };
}

export function emptyState(now: Date): State {
  const resetTime = '00:00';
  const weeklyResetDay = 1;
  return {
    version: 1,
    stock: {},
    jobs: [],
    cafePlans: [],
    cafeRuns: [],
    requests: {
      dailyCap: 0,
      weeklyCap: 0,
      dailyDone: 0,
      weeklyDone: 0,
      lastDailyReset: localDay(lastResetAt(now, resetTime)),
      lastWeeklyReset: localDay(lastWeeklyResetAt(now, resetTime, weeklyResetDay)),
    },
    reservations: [],
    idp: { earned: 0, target: null },
    settings: { priority: 'money', moneyTarget: null, money: null, season: 5, resetTime, weeklyResetDay },
    spawnsCollectedOn: null,
  };
}
