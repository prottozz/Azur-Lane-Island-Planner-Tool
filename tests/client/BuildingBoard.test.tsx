// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BuildingBoard } from '../../src/client/components/BuildingBoard';
import { AppStateContext, NowContext } from '../../src/client/useAppState';
import type { AppState } from '../../src/client/useAppState';
import { emptyGameData, emptyState } from '../../src/shared/defaults';
import { buildPlan } from '../../src/shared/planner/suggest';
import { hhmm } from '../../src/shared/time';
import type { GameData, Result, State } from '../../src/shared/types';

const NOW = new Date('2026-01-01T12:00:00Z');

function makeGd(): GameData {
  const gd = emptyGameData();
  gd.items.wheat = { id: 'wheat', name: 'Wheat', category: 'crop', idp: null, cafeValue: null, season: 'permanent', active: true };
  gd.items.seed = { id: 'seed', name: 'Wheat Seeds', category: 'seed', idp: null, cafeValue: null, season: 'permanent', active: true };
  gd.buildings.field = { id: 'field', name: 'Wheat Field', kind: 'field', pipeline: 'food', slots: 2, season: 'permanent', active: true };
  gd.buildings.factory = { id: 'factory', name: 'Factory', kind: 'factory', pipeline: 'goods', slots: 1, season: 'permanent', active: true };
  gd.recipes.wheat = {
    id: 'wheat', buildingId: 'field', inputs: [{ item: 'seed', qty: 9 }], outputs: [{ item: 'wheat', qty: 10 }], bonus: [],
    maxRuns: 12, secondsPerRun: 600, stamina: 0, season: 'permanent', active: true,
  };
  gd.cafes.cafe = {
    id: 'cafe', name: 'Café', kitchenBuildingId: 'field', sellable: ['wheat'],
    ranks: [{ name: 'R1', dishSlots: 1, capacityPerDish: 30 }], season: 'permanent', active: true,
  };
  return gd;
}

interface Holder { gd: GameData; state: State; errors: (string | null)[] }

function makeHolder(stock: Record<string, number>, jobs: State['jobs'] = []): Holder {
  return { gd: makeGd(), state: { ...emptyState(NOW), stock, jobs, cafePlans: [{ cafeId: 'cafe', rankIndex: 0, dishes: ['wheat'] }] }, errors: [] };
}

function Harness({ holder, pipeline }: { holder: Holder; pipeline: 'food' | 'goods' }) {
  const app: AppState = {
    gd: holder.gd, state: holder.state, plan: buildPlan(holder.gd, holder.state, NOW), warnings: [],
    apply(fn: (s: State, gd: GameData) => Result<State> | State) {
      const r = fn(holder.state, holder.gd);
      if ('ok' in r && typeof r.ok === 'boolean') {
        if (!r.ok) return r.error;
        holder.state = r.value;
      } else holder.state = r as State;
      return null;
    },
    applyGameData: () => null, applyAll: () => null, undo: () => {}, canUndo: false, saveError: null, loaded: true, loadError: null, retryLoad: () => {},
  };
  return <AppStateContext.Provider value={app}><NowContext.Provider value={NOW}><BuildingBoard pipeline={pipeline} /></NowContext.Provider></AppStateContext.Provider>;
}

afterEach(cleanup);

describe('BuildingBoard', () => {
  it('lists only buildings of the pipeline', () => {
    const holder = makeHolder({ seed: 108 });
    render(<Harness holder={holder} pipeline="food" />);
    expect(screen.getByText('Wheat Field')).toBeTruthy();
    expect(screen.queryByText('Factory')).toBeNull();
  });

  it('idle slot shows the suggestion reason and Start creates the job in one click', () => {
    const holder = makeHolder({ seed: 108 });
    const sug = buildPlan(holder.gd, holder.state, NOW).suggestions.find(x => x.buildingId === 'field' && x.slot === 0);
    expect(sug).toBeTruthy();
    render(<Harness holder={holder} pipeline="food" />);
    expect(screen.getAllByText(sug!.reason).length).toBeGreaterThan(0);
    const row = screen.getByTestId('slot-field-0');
    fireEvent.click(within(row).getByRole('button', { name: 'Start' }));
    expect(holder.state.jobs).toHaveLength(1);
    expect(holder.state.jobs[0]).toMatchObject({ buildingId: 'field', slot: 0, recipeId: 'wheat', runs: sug!.runs });
  });

  it('disables Start and lists missing items when stock is short', () => {
    const holder = makeHolder({ seed: 5 });
    const sug = buildPlan(holder.gd, holder.state, NOW).suggestions.find(x => x.buildingId === 'field' && x.slot === 0);
    expect(sug?.missing.length).toBeGreaterThan(0);
    render(<Harness holder={holder} pipeline="food" />);
    const start = within(screen.getByTestId('slot-field-0')).getByRole('button', { name: 'Start' }) as HTMLButtonElement;
    expect(start.disabled).toBe(true);
    expect(within(screen.getByTestId('slot-field-0')).getByTestId('blockers').textContent).toMatch(/Missing: Wheat Seeds ×\d+/);
  });

  it('running job shows Finish; one click adds the outputs', () => {
    const holder = makeHolder({}, [{
      id: 'j1', buildingId: 'field', slot: 0, recipeId: 'wheat', runs: 12,
      startedAt: NOW.toISOString(), endsAt: new Date(NOW.getTime() + 3600_000).toISOString(),
    }]);
    render(<Harness holder={holder} pipeline="food" />);
    const row = screen.getByTestId('slot-field-0');
    expect(within(row).getByText('12/12')).toBeTruthy();
    expect(within(row).getByText('1:00:00')).toBeTruthy();
    fireEvent.click(within(row).getByRole('button', { name: 'Finish' }));
    expect(holder.state.jobs).toHaveLength(0);
    expect(holder.state.stock.wheat).toBe(120);
  });

  it('ready slot shows Ready, Finish and the next suggestion', () => {
    const holder = makeHolder({ seed: 108 }, [{
      id: 'j1', buildingId: 'field', slot: 0, recipeId: 'wheat', runs: 1,
      startedAt: NOW.toISOString(), endsAt: new Date(NOW.getTime() - 1000).toISOString(),
    }]);
    render(<Harness holder={holder} pipeline="food" />);
    const row = screen.getByTestId('slot-field-0');
    expect(within(row).getByText('Ready')).toBeTruthy();
    expect(within(row).getByRole('button', { name: 'Finish' })).toBeTruthy();
    expect(within(row).getByText(/Next:/)).toBeTruthy();
    expect(within(row).queryByRole('button', { name: 'Start' })).toBeNull();
  });

  it('Cancel on a running job refunds inputs after confirm', () => {
    const holder = makeHolder({}, [{
      id: 'j1', buildingId: 'field', slot: 0, recipeId: 'wheat', runs: 12,
      startedAt: NOW.toISOString(), endsAt: new Date(NOW.getTime() + 3600_000).toISOString(),
    }]);
    vi.stubGlobal('confirm', () => true);
    render(<Harness holder={holder} pipeline="food" />);
    fireEvent.click(within(screen.getByTestId('slot-field-0')).getByRole('button', { name: 'Cancel' }));
    vi.unstubAllGlobals();
    expect(holder.state.jobs).toHaveLength(0);
    expect(holder.state.stock.seed).toBe(108);
  });
});

describe('Cancel declined', () => {
  it('keeps the job and refunds nothing when confirm returns false', () => {
    const holder = makeHolder({}, [{
      id: 'j1', buildingId: 'field', slot: 0, recipeId: 'wheat', runs: 12,
      startedAt: NOW.toISOString(), endsAt: new Date(NOW.getTime() + 3600_000).toISOString(),
    }]);
    vi.stubGlobal('confirm', () => false);
    render(<Harness holder={holder} pipeline="food" />);
    fireEvent.click(within(screen.getByTestId('slot-field-0')).getByRole('button', { name: 'Cancel' }));
    vi.unstubAllGlobals();
    expect(holder.state.jobs).toHaveLength(1);
    expect(holder.state.stock.seed ?? 0).toBe(0);
  });
});

describe('JobDialog', () => {
  function open() {
    const holder = makeHolder({ seed: 108 });
    render(<Harness holder={holder} pipeline="food" />);
    fireEvent.click(within(screen.getByTestId('slot-field-1')).getByRole('button', { name: 'Other…' }));
    return holder;
  }

  it('shows "to fill" quantities for wheat', () => {
    open();
    expect(screen.getByText(/to fill: 108 Wheat Seeds/)).toBeTruthy();
  });

  it('rejects an unparseable time and disables Confirm', () => {
    open();
    fireEvent.change(screen.getByLabelText('Time shown in game'), { target: { value: 'abc' } });
    expect(screen.getByRole('alert').textContent).toMatch(/abc/);
    expect((screen.getByRole('button', { name: 'Confirm' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('confirms with a typed time and shows live input table', () => {
    const holder = open();
    expect(screen.getByRole('table').textContent).toContain('Wheat Seeds');
    fireEvent.change(screen.getByLabelText('Time shown in game'), { target: { value: '1:30:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(holder.state.jobs).toHaveLength(1);
    const j = holder.state.jobs[0];
    expect(Date.parse(j.endsAt) - Date.parse(j.startedAt)).toBe(5400_000);
  });

  it('disables Confirm for invalid runs', () => {
    open();
    fireEvent.change(screen.getByLabelText('Runs'), { target: { value: '99' } });
    expect((screen.getByRole('button', { name: 'Confirm' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows the apply error with the missing list inline', () => {
    const holder = makeHolder({ seed: 10 });
    render(<Harness holder={holder} pipeline="food" />);
    fireEvent.click(within(screen.getByTestId('slot-field-1')).getByRole('button', { name: 'Other…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(screen.getByRole('alert').textContent).toMatch(/Not enough stock/);
    expect(holder.state.jobs).toHaveLength(0);
  });
});

describe('waiting for running jobs, and orphan jobs', () => {
  function soyGd(): GameData {
    const gd = emptyGameData();
    const it = (id: string, name: string) => ({ id, name, category: 'x', idp: null, cafeValue: null, season: 'permanent' as const, active: true });
    gd.items.soy = it('soy', 'Soybean');
    gd.items.tofu = it('tofu', 'Tofu');
    gd.items.seeds = it('seeds', 'Soy Seeds');
    gd.buildings.field = { id: 'field', name: 'Soy Field', kind: 'field', pipeline: 'food', slots: 1, season: 'permanent', active: true };
    gd.buildings.koi = { id: 'koi', name: 'Golden Koi', kind: 'kitchen', pipeline: 'food', slots: 1, season: 'permanent', active: true };
    gd.recipes.r_soy = { id: 'r_soy', buildingId: 'field', inputs: [{ item: 'seeds', qty: 1 }], outputs: [{ item: 'soy', qty: 10 }], bonus: [],
      maxRuns: 12, secondsPerRun: 600, stamina: 0, season: 'permanent', active: true };
    gd.recipes.r_tofu = { id: 'r_tofu', buildingId: 'koi', inputs: [{ item: 'soy', qty: 15 }], outputs: [{ item: 'tofu', qty: 1 }], bonus: [],
      maxRuns: 50, secondsPerRun: 600, stamina: 0, season: 'permanent', active: true };
    gd.cafes.cafe = { id: 'cafe', name: 'Café', kitchenBuildingId: 'koi', sellable: ['tofu'],
      ranks: [{ name: 'R1', dishSlots: 1, capacityPerDish: 6 }], season: 'permanent', active: true };
    return gd;
  }
  const job = (id: string, over: Partial<State['jobs'][number]> = {}) => ({
    id, buildingId: 'field', slot: 0, recipeId: 'r_soy', runs: 10,
    startedAt: new Date(NOW.getTime() - 7200_000).toISOString(), endsAt: new Date(NOW.getTime() - 60_000).toISOString(), ...over,
  });

  /** Re-renders on every apply, like the real provider. */
  function Live({ holder }: { holder: Holder }) {
    const [state, setState] = useState(holder.state);
    const app: AppState = {
      gd: holder.gd, state, plan: buildPlan(holder.gd, state, NOW), warnings: [],
      apply(fn) {
        const r = fn(holder.state, holder.gd);
        if ('ok' in r && typeof r.ok === 'boolean') {
          if (!r.ok) return r.error;
          holder.state = r.value;
        } else holder.state = r as State;
        setState(holder.state);
        return null;
      },
      applyGameData: () => null, applyAll: () => null, undo: () => {}, canUndo: false, saveError: null, loaded: true, loadError: null, retryLoad: () => {},
    };
    return <AppStateContext.Provider value={app}><NowContext.Provider value={NOW}><BuildingBoard pipeline="food" /></NowContext.Provider></AppStateContext.Provider>;
  }
  const live = (stock: Record<string, number>, jobs: State['jobs']) => {
    const holder: Holder = { gd: soyGd(), state: { ...emptyState(NOW), stock, jobs, cafePlans: [{ cafeId: 'cafe', rankIndex: 0, dishes: ['tofu'] }] }, errors: [] };
    render(<Live holder={holder} />);
    return holder;
  };

  it('Tofu waits for the running soy job: Start disabled with inline text; after Finish, Start works in one click', () => {
    const soyJob = job('j1');
    const holder = live({}, [soyJob]);
    const koi = () => screen.getByTestId('slot-koi-0');
    const start = () => within(koi()).getByRole('button', { name: 'Start' }) as HTMLButtonElement;
    expect(start().disabled).toBe(true);
    expect(within(koi()).getByTestId('blockers').textContent).toBe(`Waiting for Soybean (ready ${hhmm(new Date(soyJob.endsAt))})`);
    fireEvent.click(start());
    expect(holder.state.jobs).toHaveLength(1);

    fireEvent.click(within(screen.getByTestId('slot-field-0')).getByRole('button', { name: 'Finish' }));
    expect(holder.state.stock.soy).toBe(100);
    expect(start().disabled).toBe(false);
    expect(within(koi()).queryByTestId('blockers')).toBeNull();
    fireEvent.click(start());
    expect(holder.state.jobs).toEqual([expect.objectContaining({ buildingId: 'koi', recipeId: 'r_tofu', runs: 6 })]);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows both waiting and missing parts inline', () => {
    live({}, [job('j1', { runs: 1, endsAt: new Date(NOW.getTime() + 600_000).toISOString() })]);
    const text = within(screen.getByTestId('slot-koi-0')).getByTestId('blockers').textContent;
    expect(text).toContain('Waiting for Soybean (ready');
    expect(text).toContain('Missing: Soybean ×80');
  });

  it('lists jobs on a missing building or a removed slot under "Other running jobs" with Finish and Remove', () => {
    vi.stubGlobal('confirm', () => true);
    const holder = live({}, [job('gone', { buildingId: 'old-building' }), job('extra', { slot: 3 })]);
    const list = screen.getByTestId('orphan-jobs');
    expect(within(list).getByText(/unknown building old-building/)).toBeTruthy();
    expect(within(screen.getByTestId('orphan-extra')).getByText(/Soy Field, slot 4/)).toBeTruthy();
    fireEvent.click(within(screen.getByTestId('orphan-gone')).getByRole('button', { name: 'Finish' }));
    expect(holder.state.stock.soy).toBe(100);
    fireEvent.click(within(screen.getByTestId('orphan-extra')).getByRole('button', { name: 'Remove' }));
    vi.unstubAllGlobals();
    expect(holder.state.jobs).toEqual([]);
    expect(holder.state.stock.seeds).toBe(10);   // recipe still exists: inputs refunded
    expect(screen.queryByTestId('orphan-jobs')).toBeNull();
  });

  it('a job whose recipe was deleted offers Remove (no refund) instead of Finish', () => {
    vi.stubGlobal('confirm', () => true);
    const holder = live({}, [job('j1', { recipeId: 'deleted' })]);
    const row = screen.getByTestId('slot-field-0');
    expect(within(row).queryByRole('button', { name: 'Finish' })).toBeNull();
    expect(within(row).getByText(/recipe deleted/)).toBeTruthy();
    fireEvent.click(within(row).getByRole('button', { name: 'Remove' }));
    vi.unstubAllGlobals();
    expect(holder.state.jobs).toEqual([]);
    expect(holder.state.stock).toEqual({});
  });
});
