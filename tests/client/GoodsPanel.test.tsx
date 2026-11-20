// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { GoodsPanel } from '../../src/client/components/GoodsPanel';
import { GoodsTab } from '../../src/client/tabs/GoodsTab';
import { AppStateContext, NowContext } from '../../src/client/useAppState';
import type { AppState } from '../../src/client/useAppState';
import { emptyGameData, emptyState } from '../../src/shared/defaults';
import { buildPlan } from '../../src/shared/planner/suggest';
import type { GameData, Result, State } from '../../src/shared/types';

const NOW = new Date(2026, 0, 1, 12, 0, 0);

function item(id: string, name: string, idp: number | null) {
  return { id, name, category: 'goods', idp, cafeValue: null, season: 'permanent' as const, active: true };
}

function recipe(id: string, out: string, secondsPerRun: number) {
  return {
    id, buildingId: 'factory', inputs: [], outputs: [{ item: out, qty: 1 }], bonus: [],
    maxRuns: 10, secondsPerRun, stamina: 0, season: 'permanent' as const, active: true,
  };
}

function makeGd(): GameData {
  const gd = emptyGameData();
  gd.items.clock = item('clock', 'Clock', 310);
  gd.items.gear = item('gear', 'Gear', 100);
  gd.items.tofu = item('tofu', 'Tofu', null);
  gd.buildings.factory = { id: 'factory', name: 'Factory', kind: 'factory', pipeline: 'goods', slots: 1, season: 'permanent', active: true };
  // gear: 100 IDP in 1h; clock: 310 IDP in 2h => 155/h. Gear listed first on purpose.
  gd.recipes.gear = recipe('gear', 'gear', 3600);
  gd.recipes.clock = recipe('clock', 'clock', 7200);
  return gd;
}

interface Holder { gd: GameData; state: State }

function makeHolder(over: Partial<State> = {}): Holder {
  return { gd: makeGd(), state: { ...emptyState(NOW), ...over } };
}

function Harness({ holder, children }: { holder: Holder; children: React.ReactNode }) {
  const [state, setState] = useState(holder.state);
  const app: AppState = {
    gd: holder.gd, state, plan: buildPlan(holder.gd, state, NOW), warnings: [],
    apply(fn: (s: State, gd: GameData) => Result<State> | State) {
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
  return <AppStateContext.Provider value={app}><NowContext.Provider value={NOW}>{children}</NowContext.Provider></AppStateContext.Provider>;
}

afterEach(cleanup);

describe('GoodsPanel', () => {
  it('ranks recipes by IDP/h descending with feasible runs', () => {
    const holder = makeHolder();
    render(<Harness holder={holder}><GoodsPanel /></Harness>);
    const rows = within(screen.getByTestId('ranked-goods')).getAllByRole('row').slice(1)
      .map(r => [...(r as HTMLTableRowElement).cells].map(c => c.textContent));
    expect(rows.map(r => r[0])).toEqual(['Clock', 'Gear']);
    expect(rows[0][1]).toBe('Factory');
    expect(rows[0][2]).toBe('155.0');
    expect(rows[1][2]).toBe('100.0');
    expect(rows[0][3]).toMatch(/^[1-9]\d* runs$/);
  });

  it('converting 2 Clocks raises earned by 620 and removes them from stock', () => {
    const holder = makeHolder({ stock: { clock: 5, gear: 1 } });
    render(<Harness holder={holder}><GoodsPanel /></Harness>);
    const convert = screen.getByRole('button', { name: 'Convert' }) as HTMLButtonElement;
    expect(convert.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Convert Clock'), { target: { value: '2' } });
    expect(screen.getByTestId('convert-clock').textContent).toContain('620');
    expect(convert.disabled).toBe(false);
    fireEvent.click(convert);
    expect(holder.state.idp.earned).toBe(620);
    expect(holder.state.stock.clock).toBe(3);
    expect(holder.state.stock.gear).toBe(1);
    expect((screen.getByLabelText('Convert Clock') as HTMLInputElement).value).toBe('0');
    expect(convert.disabled).toBe(true);
  });

  it('removes the row when the whole stack is converted', () => {
    const holder = makeHolder({ stock: { clock: 2 } });
    render(<Harness holder={holder}><GoodsPanel /></Harness>);
    fireEvent.change(screen.getByLabelText('Convert Clock'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Convert' }));
    expect(screen.queryByTestId('convert-clock')).toBeNull();
  });

  it('does not list items without an IDP value or with zero stock', () => {
    const holder = makeHolder({ stock: { tofu: 9, gear: 0, clock: 1 } });
    render(<Harness holder={holder}><GoodsPanel /></Harness>);
    expect(screen.queryByTestId('convert-tofu')).toBeNull();
    expect(screen.queryByTestId('convert-gear')).toBeNull();
    expect(screen.getByTestId('convert-clock')).toBeTruthy();
  });

  it('clamps the quantity to what is in stock', () => {
    const holder = makeHolder({ stock: { clock: 2 } });
    render(<Harness holder={holder}><GoodsPanel /></Harness>);
    fireEvent.change(screen.getByLabelText('Convert Clock'), { target: { value: '9' } });
    fireEvent.click(screen.getByRole('button', { name: 'Convert' }));
    expect(holder.state.idp.earned).toBe(620);
    expect(holder.state.stock.clock).toBe(0);
  });
});

describe('GoodsTab', () => {
  it('shows only earned without a target, and earned / target with a progress bar once set', () => {
    const holder = makeHolder({ idp: { earned: 620, target: null } });
    render(<Harness holder={holder}><GoodsTab /></Harness>);
    expect(screen.getByTestId('idp-progress').textContent).toContain('IDP: 620');
    expect(screen.getByTestId('idp-progress').textContent).not.toContain('/');
    expect(screen.queryByLabelText('IDP progress')).toBeNull();
    fireEvent.change(screen.getByLabelText('IDP target'), { target: { value: '1000' } });
    expect(holder.state.idp.target).toBeNull();                         // nothing until blur/Enter
    fireEvent.keyDown(screen.getByLabelText('IDP target'), { key: 'Enter' });
    expect(holder.state.idp.target).toBe(1000);
    expect(screen.getByTestId('idp-progress').textContent).toContain('IDP: 620 / 1000');
    const bar = screen.getByLabelText('IDP progress') as HTMLProgressElement;
    expect(bar.max).toBe(1000);
    expect(bar.value).toBe(620);
    fireEvent.change(screen.getByLabelText('IDP target'), { target: { value: '' } });
    fireEvent.blur(screen.getByLabelText('IDP target'));
    expect(holder.state.idp.target).toBeNull();
  });

  it('shows an alert when the target edit fails and clears it on the next success', () => {
    const holder = makeHolder();
    let fail = true;
    const app: AppState = {
      gd: holder.gd, state: holder.state, plan: buildPlan(holder.gd, holder.state, NOW), warnings: [],
      apply: () => (fail ? 'cannot save target' : null),
      applyGameData: () => null, applyAll: () => null, undo: () => {}, canUndo: false, saveError: null, loaded: true, loadError: null, retryLoad: () => {},
    };
    render(<AppStateContext.Provider value={app}><NowContext.Provider value={NOW}><GoodsTab /></NowContext.Provider></AppStateContext.Provider>);
    fireEvent.change(screen.getByLabelText('IDP target'), { target: { value: '500' } });
    fireEvent.blur(screen.getByLabelText('IDP target'));
    expect(screen.getByRole('alert').textContent).toBe('cannot save target');
    fail = false;
    fireEvent.change(screen.getByLabelText('IDP target'), { target: { value: '600' } });
    fireEvent.blur(screen.getByLabelText('IDP target'));
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.change(screen.getByLabelText('IDP target'), { target: { value: '1.5' } });
    fireEvent.blur(screen.getByLabelText('IDP target'));
    expect(screen.getByRole('alert').textContent).toMatch(/whole number/);
  });
});
