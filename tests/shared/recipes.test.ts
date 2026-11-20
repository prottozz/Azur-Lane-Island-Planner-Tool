import { describe, it, expect } from 'vitest';
import { fillJob, jobInputs, jobOutputs, jobSeconds, idpPerHour, cafeValuePerHour } from '../../src/shared/recipes';
import type { GameData, Item, Recipe } from '../../src/shared/types';

const wheat: Recipe = { id: 'wheat', buildingId: 'field', inputs: [{ item: '1000', qty: 9 }], outputs: [{ item: '2000', qty: 162 }],
  bonus: [], maxRuns: 12, secondsPerRun: 2400, stamina: 0, season: 'permanent', active: true };
const eggs: Recipe = { id: 'eggs', buildingId: 'hatchery', inputs: [{ item: '3000', qty: 2 }], outputs: [{ item: '2601', qty: 5 }],
  bonus: [{ item: '2602', qty: 4, everyRuns: 3 }], maxRuns: 8, secondsPerRun: 3600, stamina: 0, season: 'permanent', active: true };
const clock: Recipe = { id: 'clock', buildingId: 'factory', inputs: [], outputs: [{ item: 'clock', qty: 1 }],
  bonus: [], maxRuns: 1, secondsPerRun: 21600, stamina: 0, season: 'permanent', active: true };

const item = (id: string, idp: number | null, cafeValue: number | null): Item =>
  ({ id, name: id, category: 'x', idp, cafeValue, season: 'permanent', active: true });
const gd: GameData = { version: 1, buildings: {}, recipes: {}, cafes: {}, shop: [], spawns: {},
  items: { clock: item('clock', 310, null), '2000': item('2000', null, 3), '2601': item('2601', null, null) } };

describe('recipes', () => {
  it('fillJob multiplies inputs by maxRuns', () => {
    expect(fillJob(wheat)).toEqual([{ item: '1000', qty: 108 }]);
  });
  it('jobInputs scales by runs', () => {
    expect(jobInputs(wheat, 2)).toEqual([{ item: '1000', qty: 18 }]);
  });
  it('jobOutputs adds bonus per full everyRuns', () => {
    expect(jobOutputs(eggs, 8)).toEqual([{ item: '2601', qty: 40 }, { item: '2602', qty: 8 }]);
  });
  it('jobOutputs omits zero bonus', () => {
    expect(jobOutputs(eggs, 2)).toEqual([{ item: '2601', qty: 10 }]);
  });
  it('jobOutputs merges bonus into the same item, keeping first-seen order', () => {
    const r: Recipe = { ...eggs, bonus: [{ item: '2601', qty: 1, everyRuns: 2 }] };
    expect(jobOutputs(r, 4)).toEqual([{ item: '2601', qty: 22 }]);
  });
  it('jobSeconds', () => {
    expect(jobSeconds(wheat, 12)).toBe(28800);
  });
  it('idpPerHour', () => {
    expect(idpPerHour(clock, gd)).toBeCloseTo(51.67, 2);
    expect(idpPerHour(wheat, gd)).toBe(0);
  });
  it('cafeValuePerHour', () => {
    expect(cafeValuePerHour(wheat, gd)).toBeCloseTo((162 * 3) / 2400 * 3600, 5);
    expect(cafeValuePerHour(eggs, gd)).toBe(0);
  });
});
