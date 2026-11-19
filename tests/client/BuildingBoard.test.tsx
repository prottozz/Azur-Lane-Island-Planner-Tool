// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BuildingBoard } from '../../src/client/components/BuildingBoard';
import { AppStateContext } from '../../src/client/useAppState';
import type { AppState } from '../../src/client/useAppState';
import { emptyGameData, emptyState } from '../../src/shared/defaults';
import { buildPlan } from '../../src/shared/planner/suggest';
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
    gd: holder.gd, state: holder.state, plan: buildPlan(holder.gd, holder.state, NOW), now: NOW, warnings: [],
    apply(fn: (s: State, gd: GameData) => Result<State> | State) {
      const r = fn(holder.state, holder.gd);
      if ('ok' in r && typeof r.ok === 'boolean') {
        if (!r.ok) return r.error;
        holder.state = r.value;
      } else holder.state = r as State;
      return null;
    },
    applyGameData: () => null, undo: () => {}, canUndo: false, saveError: null, loaded: true, loadError: null, retryLoad: () => {},
  };
  return <AppStateContext.Provider value={app}><BuildingBoard pipeline={pipeline} /></AppStateContext.Provider>;
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
    expect(start.title).toMatch(/Wheat Seeds ×\d+/);
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
