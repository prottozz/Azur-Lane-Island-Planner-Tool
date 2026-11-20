// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { Profiler } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from '../../src/client/ErrorBoundary';
import { DataTab } from '../../src/client/tabs/DataTab';
import { StockTab } from '../../src/client/tabs/StockTab';
import { AppStateProvider, useApp, useNow } from '../../src/client/useAppState';
import type { Plan } from '../../src/shared/planner/suggest';
import { emptyGameData, emptyState } from '../../src/shared/defaults';
import type { GameData, State } from '../../src/shared/types';

const T0 = new Date(2026, 10, 20, 10, 0, 0);

function fixtures(): { gd: GameData; state: State } {
  const gd = emptyGameData();
  gd.items.wheat = { id: 'wheat', name: 'Wheat', category: 'crop', idp: null, cafeValue: null, season: 'permanent', active: true };
  gd.buildings.field = { id: 'field', name: 'Field', kind: 'field', pipeline: 'goods', slots: 1, season: 'permanent', active: true };
  gd.buildings.factory = { id: 'factory', name: 'Factory', kind: 'factory', pipeline: 'goods', slots: 1, season: 'permanent', active: true };
  gd.items.plank = { id: 'plank', name: 'Plank', category: 'goods', idp: 10, cafeValue: null, season: 'permanent', active: true };
  gd.recipes.wheat = { id: 'wheat', buildingId: 'field', inputs: [], outputs: [{ item: 'wheat', qty: 10 }], bonus: [],
    maxRuns: 12, secondsPerRun: 600, stamina: 0, season: 'permanent', active: true };
  gd.recipes.plank = { id: 'plank', buildingId: 'factory', inputs: [{ item: 'wheat', qty: 1 }], outputs: [{ item: 'plank', qty: 1 }], bonus: [],
    maxRuns: 5, secondsPerRun: 600, stamina: 0, season: 'permanent', active: true };
  const state: State = {
    ...emptyState(T0),
    stock: { wheat: 3 },
    // The factory is busy for 90 s more.
    jobs: [{ id: 'j', buildingId: 'factory', slot: 0, recipeId: 'plank', runs: 1, startedAt: T0.toISOString(), endsAt: new Date(T0.getTime() + 90_000).toISOString() }],
  };
  return { gd, state };
}

beforeEach(() => {
  vi.useFakeTimers({ now: T0 });
  const { gd, state } = fixtures();
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
    if (init?.method === 'PUT') return json({ ok: true });
    if (url === '/api/gamedata') return json(gd);
    if (url === '/api/state') return json(state);
    return json({ warnings: [] });
  }));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('NowContext', () => {
  it('the 30 s tick re-renders time readers only: Data and Stock tabs stay put; the plan updates when a job becomes ready', async () => {
    const renders = { data: 0, stock: 0, clock: 0 };
    const plans: Plan[] = [];
    function Clock() {
      renders.clock++;
      return <span data-testid="now">{useNow().toISOString()}</span>;
    }
    function PlanProbe() {
      plans.push(useApp().plan);
      return null;
    }
    render(
      <AppStateProvider>
        <Profiler id="data" onRender={() => { renders.data++; }}><DataTab /></Profiler>
        <Profiler id="stock" onRender={() => { renders.stock++; }}><StockTab /></Profiler>
        <Clock />
        <PlanProbe />
      </AppStateProvider>,
    );
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByRole('tab', { name: 'Items' })).toBeTruthy();
    const before = { ...renders };
    const planBefore = plans[plans.length - 1];
    expect(planBefore.suggestions.some(s => s.buildingId === 'factory')).toBe(false);

    // Two ticks (one act each, so each renders), job still running.
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(renders.clock).toBe(before.clock + 2);
    expect(renders.data).toBe(before.data);
    expect(renders.stock).toBe(before.stock);
    expect(plans[plans.length - 1]).toBe(planBefore);
    expect(screen.getByTestId('now').textContent).toBe(new Date(T0.getTime() + 60_000).toISOString());

    await act(async () => { await vi.advanceTimersByTimeAsync(31_000); });   // job ends at +90 s
    const planAfter = plans[plans.length - 1];
    expect(planAfter).not.toBe(planBefore);
    expect(planAfter.suggestions.find(s => s.buildingId === 'factory')).toMatchObject({ recipeId: 'plank', runs: 3 });
  });
});

describe('ErrorBoundary', () => {
  it('shows the error message and how to recover instead of a blank page', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    function Boom(): never { throw new Error('items is not iterable'); }
    render(<ErrorBoundary><Boom /></ErrorBoundary>);
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByTestId('crash-message').textContent).toBe('items is not iterable');
    expect(screen.getByRole('alert').textContent).toMatch(/Data → Import JSON/);
    expect(screen.getByRole('alert').textContent).toMatch(/data\/backups/);
  });

  it('renders children when nothing throws', () => {
    render(<ErrorBoundary><p>fine</p></ErrorBoundary>);
    expect(screen.getByText('fine')).toBeTruthy();
  });
});
