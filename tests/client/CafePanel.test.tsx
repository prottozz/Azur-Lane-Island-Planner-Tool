// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CafePanel } from '../../src/client/components/CafePanel';
import { Shortfalls } from '../../src/client/components/Shortfalls';
import { CafeTab } from '../../src/client/tabs/CafeTab';
import { AppStateContext } from '../../src/client/useAppState';
import type { AppState } from '../../src/client/useAppState';
import { emptyGameData, emptyState } from '../../src/shared/defaults';
import { buildPlan } from '../../src/shared/planner/suggest';
import type { Expansion } from '../../src/shared/planner/expand';
import type { GameData, Result, State } from '../../src/shared/types';

const NOW = new Date(2026, 0, 1, 12, 0, 0);

function item(id: string, name: string, cafeValue: number | null) {
  return { id, name, category: 'dish', idp: null, cafeValue, season: 'permanent' as const, active: true };
}

function makeGd(): GameData {
  const gd = emptyGameData();
  gd.items.tofu = item('tofu', 'Tofu', 10);
  gd.items.bread = item('bread', 'Bread', 5);
  gd.items.milk = item('milk', 'Milk', null);
  gd.items.egg = item('egg', 'Egg', 2);
  gd.buildings.kitchen = { id: 'kitchen', name: 'Golden Koi Restaurant', kind: 'kitchen', pipeline: 'food', slots: 1, season: 'permanent', active: true };
  gd.recipes.tofu = {
    id: 'tofu', buildingId: 'kitchen', inputs: [], outputs: [{ item: 'tofu', qty: 1 }], bonus: [],
    maxRuns: 24, secondsPerRun: 60, stamina: 0, season: 'permanent', active: true,
  };
  gd.cafes.cafe = {
    id: 'cafe', name: 'Café', kitchenBuildingId: 'kitchen', sellable: ['tofu', 'bread', 'milk', 'egg'],
    ranks: [{ name: 'R1', dishSlots: 3, capacityPerDish: 10 }, { name: 'R2', dishSlots: 1, capacityPerDish: 20 }],
    season: 'permanent', active: true,
  };
  return gd;
}

interface Holder { gd: GameData; state: State }

function makeHolder(over: Partial<State> = {}): Holder {
  return { gd: makeGd(), state: { ...emptyState(NOW), requests: { ...emptyState(NOW).requests, dailyCap: 5, weeklyCap: 20 }, ...over } };
}

function Harness({ holder, children }: { holder: Holder; children: React.ReactNode }) {
  const [state, setState] = useState(holder.state);
  const app: AppState = {
    gd: holder.gd, state, plan: buildPlan(holder.gd, state, NOW), now: NOW, warnings: [],
    apply(fn: (s: State, gd: GameData) => Result<State> | State) {
      const r = fn(holder.state, holder.gd);
      if ('ok' in r && typeof r.ok === 'boolean') {
        if (!r.ok) return r.error;
        holder.state = r.value;
      } else holder.state = r as State;
      setState(holder.state);
      return null;
    },
    applyGameData: () => null, undo: () => {}, canUndo: false, saveError: null, loaded: true, loadError: null, retryLoad: () => {},
  };
  return <AppStateContext.Provider value={app}>{children}</AppStateContext.Provider>;
}

// Actions stamp runs with the real clock; pin it to the harness's NOW.
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

const plan3 = [{ cafeId: 'cafe', rankIndex: 0, dishes: ['tofu', 'bread', 'milk'] }];

describe('CafePanel', () => {
  it('offers only as many dish pickers as the rank has slots (4th dish prevented)', () => {
    const holder = makeHolder({ cafePlans: plan3 });
    render(<Harness holder={holder}><CafePanel /></Harness>);
    expect(screen.getAllByLabelText(/^Dish \d/)).toHaveLength(3);
  });

  it('does not offer an already-chosen dish in another picker', () => {
    const holder = makeHolder({ cafePlans: [{ cafeId: 'cafe', rankIndex: 0, dishes: ['tofu'] }] });
    render(<Harness holder={holder}><CafePanel /></Harness>);
    const second = screen.getByLabelText('Dish 2') as HTMLSelectElement;
    expect([...second.options].map(o => o.text)).not.toContain('Tofu');
    expect([...second.options].map(o => o.text)).toContain('Bread');
  });

  it('picking a dish writes the café plan; changing to a smaller rank drops extras', () => {
    const holder = makeHolder();
    render(<Harness holder={holder}><CafePanel /></Harness>);
    fireEvent.change(screen.getByLabelText('Dish 1'), { target: { value: 'tofu' } });
    fireEvent.change(screen.getByLabelText('Dish 2'), { target: { value: 'bread' } });
    expect(holder.state.cafePlans).toEqual([{ cafeId: 'cafe', rankIndex: 0, dishes: ['tofu', 'bread'] }]);
    fireEvent.change(screen.getByLabelText('Rank'), { target: { value: '1' } });
    expect(holder.state.cafePlans[0]).toEqual({ cafeId: 'cafe', rankIndex: 1, dishes: ['tofu'] });
    expect(screen.getAllByLabelText(/^Dish \d/)).toHaveLength(1);
  });

  it('shows have/need per dish and est. income as sum of value × qty', () => {
    const holder = makeHolder({ cafePlans: plan3, stock: { tofu: 4, bread: 10 } });
    render(<Harness holder={holder}><CafePanel /></Harness>);
    const tofu = screen.getByTestId('dish-tofu');
    expect(tofu.textContent).toMatch(/qty 10/);
    expect(tofu.textContent).toMatch(/have 4/);
    expect(tofu.textContent).toMatch(/need 6/);
    expect(screen.getByTestId('dish-milk').textContent).toMatch(/no value/);
    // tofu 10×10 + bread 5×10 + milk 0
    expect(screen.getByTestId('est-income').textContent).toMatch(/150/);
  });

  it('Start run is disabled with the missing list when stock is short', () => {
    const holder = makeHolder({ cafePlans: plan3, stock: { tofu: 4, bread: 10, milk: 10 } });
    render(<Harness holder={holder}><CafePanel /></Harness>);
    const start = screen.getByRole('button', { name: 'Start run' }) as HTMLButtonElement;
    expect(start.disabled).toBe(true);
    expect(screen.getByTestId('missing').textContent).toMatch(/Tofu ×6/);
  });

  it('Start run deducts dishes; a second start the same day shows the error', () => {
    const holder = makeHolder({ cafePlans: plan3, stock: { tofu: 25, bread: 10, milk: 10 } });
    render(<Harness holder={holder}><CafePanel /></Harness>);
    fireEvent.click(screen.getByRole('button', { name: 'Start run' }));
    expect(holder.state.stock).toMatchObject({ tofu: 15, bread: 0, milk: 0 });
    expect(holder.state.cafeRuns).toHaveLength(1);
    expect(holder.state.cafeRuns[0].dishes).toContainEqual({ item: 'tofu', qty: 10 });
    expect(screen.getByText(/Running since/)).toBeTruthy();
    // top up so the button is enabled, then try again
    holder.state = { ...holder.state, stock: { tofu: 15, bread: 10, milk: 10 } };
    fireEvent.change(screen.getByLabelText('Rank'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start run' }));
    expect(screen.getByRole('alert').textContent).toMatch(/already has a run/);
    expect(holder.state.cafeRuns).toHaveLength(1);
  });

  it('Finish returns leftovers and logs income', () => {
    const holder = makeHolder({ cafePlans: plan3, stock: { tofu: 10, bread: 10, milk: 10 }, settings: { ...emptyState(NOW).settings, money: 100 } });
    render(<Harness holder={holder}><CafePanel /></Harness>);
    fireEvent.click(screen.getByRole('button', { name: 'Start run' }));
    fireEvent.change(screen.getByLabelText('Leftover Tofu'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('Income'), { target: { value: '250' } });
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
    expect(holder.state.cafeRuns[0]).toMatchObject({ status: 'done', income: 250 });
    expect(holder.state.stock.tofu).toBe(3);
    expect(holder.state.settings.money).toBe(350);
    expect(screen.getByText(/Done/).textContent).toMatch(/250/);
  });
});

describe('CafeTab', () => {
  it('shows run status and request counters with + / − and editable caps', () => {
    const holder = makeHolder({ cafePlans: plan3 });
    holder.state = { ...holder.state, requests: { ...holder.state.requests, dailyDone: 3, weeklyDone: 8 } };
    render(<Harness holder={holder}><CafeTab /></Harness>);
    expect(screen.getByText(/Café run: not started/)).toBeTruthy();
    expect(screen.getByTestId('requests').textContent).toContain('Requests: 3/5 daily · 8/20 weekly');
    fireEvent.click(screen.getByRole('button', { name: '+' }));
    expect(holder.state.requests).toMatchObject({ dailyDone: 4, weeklyDone: 9 });
    fireEvent.click(screen.getByRole('button', { name: '−' }));
    expect(holder.state.requests).toMatchObject({ dailyDone: 3, weeklyDone: 8 });
    fireEvent.change(screen.getByLabelText('Daily cap'), { target: { value: '7' } });
    expect(holder.state.requests.dailyCap).toBe(7);
    fireEvent.change(screen.getByLabelText('Weekly cap'), { target: { value: '-2' } });
    expect(holder.state.requests.weeklyCap).toBe(20);
  });
});

describe('Shortfalls', () => {
  const expansion: Expansion = {
    steps: [
      { recipeId: 'tofu', runs: 10, forItem: 'tofu' },
      { recipeId: 'tofu', runs: 14, forItem: 'bread' },
    ],
    purchases: [
      { item: 'egg', qty: 5, cost: 100, currency: 'coin' },
      { item: 'milk', qty: 3, cost: 60, currency: 'coin' },
    ],
    unobtainable: [{ item: 'bread', qty: 2 }],
    shortfalls: [],
  };

  it('groups steps by building, totals costs and Bought adds to stock', () => {
    const holder = makeHolder();
    render(<Harness holder={holder}><Shortfalls expansion={expansion} /></Harness>);
    expect(screen.getByText('Golden Koi Restaurant: Tofu × 24 runs')).toBeTruthy();
    expect(screen.getByTestId('total-coin').textContent).toMatch(/160/);
    expect(screen.getByTestId('unobtainable').textContent).toMatch(/Bread/);
    const row = screen.getByTestId('purchase-egg');
    fireEvent.click(within(row).getByRole('button', { name: 'Bought' }));
    expect(holder.state.stock.egg).toBe(5);
  });

  it('empty expansion says nothing missing', () => {
    const holder = makeHolder();
    render(<Harness holder={holder}><Shortfalls expansion={{ steps: [], purchases: [], unobtainable: [], shortfalls: [] }} /></Harness>);
    expect(screen.getByText('Nothing missing')).toBeTruthy();
  });
});
