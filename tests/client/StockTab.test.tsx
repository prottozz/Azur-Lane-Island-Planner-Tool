// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { StockTab } from '../../src/client/tabs/StockTab';
import { AppStateContext } from '../../src/client/useAppState';
import type { AppState } from '../../src/client/useAppState';
import { emptyGameData, emptyState } from '../../src/shared/defaults';
import { buildPlan } from '../../src/shared/planner/suggest';
import type { GameData, Result, State } from '../../src/shared/types';

const NOW = new Date(2026, 0, 1, 12, 0, 0);

function item(id: string, name: string) {
  return { id, name, category: 'x', idp: null, cafeValue: null, season: 'permanent' as const, active: true };
}

function makeGd(): GameData {
  const gd = emptyGameData();
  gd.items.tofu = item('tofu', 'Tofu');
  gd.items.soy = item('soy', 'Soybean');
  gd.items.rice = item('rice', 'Rice');
  gd.buildings.kitchen = { id: 'kitchen', name: 'Kitchen', kind: 'kitchen', pipeline: 'food', slots: 1, season: 'permanent', active: true };
  gd.recipes.tofu = {
    id: 'tofu', buildingId: 'kitchen', inputs: [{ item: 'soy', qty: 1 }], outputs: [{ item: 'tofu', qty: 1 }], bonus: [],
    maxRuns: 5, secondsPerRun: 60, stamina: 0, season: 'permanent', active: true,
  };
  return gd;
}

interface Holder { gd: GameData; state: State }

function Harness({ holder }: { holder: Holder }) {
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
  return <AppStateContext.Provider value={app}><StockTab /></AppStateContext.Provider>;
}

function setup(stock: Record<string, number>) {
  const holder: Holder = { gd: makeGd(), state: { ...emptyState(NOW), stock } };
  render(<Harness holder={holder} />);
  return holder;
}

const cells = (id: string) => [...(screen.getByTestId(`stock-${id}`) as HTMLTableRowElement).cells].map(c => c.textContent);

afterEach(cleanup);

describe('StockTab', () => {
  it('shows an error for -3 and keeps the old quantity', () => {
    const holder = setup({ tofu: 5 });
    const input = screen.getByLabelText('Stock Tofu') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '-3' } });
    fireEvent.blur(input);
    expect(within(screen.getByTestId('stock-tofu')).getByRole('alert')).toBeTruthy();
    expect(holder.state.stock.tofu).toBe(5);
  });

  it('commits on Enter, not per keystroke, and Escape reverts', () => {
    const holder = setup({ tofu: 5 });
    const input = screen.getByLabelText('Stock Tofu') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '12' } });
    expect(holder.state.stock.tofu).toBe(5);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(holder.state.stock.tofu).toBe(12);
    fireEvent.change(input, { target: { value: '99' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect((screen.getByLabelText('Stock Tofu') as HTMLInputElement).value).toBe('12');
    expect(holder.state.stock.tofu).toBe(12);
  });

  it('rejects empty and non-integer input', () => {
    const holder = setup({ tofu: 5 });
    const input = screen.getByLabelText('Stock Tofu') as HTMLInputElement;
    for (const bad of ['', '1.5', 'abc']) {
      fireEvent.change(input, { target: { value: bad } });
      fireEvent.blur(input);
      expect(screen.getByRole('alert')).toBeTruthy();
      expect(holder.state.stock.tofu).toBe(5);
    }
  });

  it('filters by name case-insensitively and hides zero stock until toggled', () => {
    setup({ tofu: 5, soy: 2 });
    expect(screen.queryByTestId('stock-rice')).toBeNull();
    fireEvent.click(screen.getByLabelText('Show zero stock'));
    expect(screen.getByTestId('stock-rice')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Search stock'), { target: { value: 'SOY' } });
    expect(screen.getByTestId('stock-soy')).toBeTruthy();
    expect(screen.queryByTestId('stock-tofu')).toBeNull();
    expect(screen.queryByTestId('stock-rice')).toBeNull();
  });

  it('shows made-in and used-in names', () => {
    setup({ tofu: 5, soy: 2 });
    expect(cells('tofu')[4]).toBe('Kitchen');
    expect(cells('soy')[5]).toBe('Tofu');
  });

  it('adding a reservation reduces free; removing restores it', () => {
    const holder = setup({ tofu: 5 });
    expect(cells('tofu').slice(2, 4)).toEqual(['0', '5']);
    fireEvent.change(screen.getByLabelText('Reservation item'), { target: { value: 'tofu' } });
    fireEvent.change(screen.getByLabelText('Reservation quantity'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Reservation source'), { target: { value: 'quest' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add reservation' }));
    expect(holder.state.reservations).toHaveLength(1);
    expect(holder.state.reservations[0]).toMatchObject({ item: 'tofu', qty: 2, source: 'quest' });
    expect(cells('tofu').slice(2, 4)).toEqual(['2', '3']);
    fireEvent.click(screen.getByRole('button', { name: 'Remove reservation Tofu' }));
    expect(cells('tofu').slice(2, 4)).toEqual(['0', '5']);
  });

  it('rejects a non-positive reservation quantity', () => {
    const holder = setup({ tofu: 5 });
    fireEvent.change(screen.getByLabelText('Reservation quantity'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add reservation' }));
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(holder.state.reservations).toHaveLength(0);
  });
});
