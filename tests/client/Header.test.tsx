// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { Header } from '../../src/client/components/Header';
import { AppStateContext, NowContext } from '../../src/client/useAppState';
import type { AppState } from '../../src/client/useAppState';
import { emptyGameData, emptyState } from '../../src/shared/defaults';
import { buildPlan } from '../../src/shared/planner/suggest';
import type { GameData, State } from '../../src/shared/types';

const NOW = new Date(2026, 10, 20, 9, 5, 0);

function setup() {
  const gd: GameData = emptyGameData();
  const holder = { state: emptyState(NOW), applies: 0 };
  function Harness() {
    const [state, setState] = useState(holder.state);
    const app: AppState = {
      gd, state, plan: buildPlan(gd, state, NOW), warnings: [],
      apply(fn) {
        const r = fn(holder.state, gd);
        if ('ok' in r && typeof r.ok === 'boolean') {
          if (!r.ok) return r.error;
          holder.state = r.value;
        } else holder.state = r as State;
        holder.applies++;
        setState(holder.state);
        return null;
      },
      applyGameData: () => null, applyAll: () => null, undo: () => {}, canUndo: false, saveError: null, loaded: true, loadError: null, retryLoad: () => {},
    };
    return <AppStateContext.Provider value={app}><NowContext.Provider value={NOW}><Header /></NowContext.Provider></AppStateContext.Provider>;
  }
  render(<Harness />);
  return holder;
}

const input = (label: string) => screen.getByRole('textbox', { name: label }) as HTMLInputElement;
const type = (label: string, value: string) => fireEvent.change(input(label), { target: { value } });

afterEach(cleanup);

describe('Header', () => {
  it('shows the current time as HH:MM', () => {
    setup();
    expect(screen.getByTestId('clock').textContent).toBe('09:05');
  });

  it('money and target commit once on blur/Enter (one undo entry per edit); blank means untracked', () => {
    const holder = setup();
    type('Money', '1');
    type('Money', '12');
    type('Money', '1200');
    expect(holder.applies).toBe(0);
    fireEvent.blur(input('Money'));
    expect(holder.applies).toBe(1);
    expect(holder.state.settings.money).toBe(1200);
    type('Target', '5000');
    fireEvent.keyDown(input('Target'), { key: 'Enter' });
    expect(holder.state.settings.moneyTarget).toBe(5000);
    type('Money', '');
    fireEvent.blur(input('Money'));
    expect(holder.state.settings.money).toBeNull();
    expect(holder.applies).toBe(3);
  });

  it('rejects bad money inline and Escape reverts', () => {
    const holder = setup();
    type('Money', '-5');
    fireEvent.blur(input('Money'));
    expect(screen.getByRole('alert').textContent).toMatch(/Money must be a number/);
    expect(holder.state.settings.money).toBeNull();
    fireEvent.keyDown(input('Money'), { key: 'Escape' });
    expect(input('Money').value).toBe('');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('season can be cleared and retyped before committing', () => {
    const holder = setup();
    type('Season', '');
    expect(input('Season').value).toBe('');
    type('Season', '6');
    fireEvent.blur(input('Season'));
    expect(holder.state.settings.season).toBe(6);
    type('Season', '0');
    fireEvent.blur(input('Season'));
    expect(holder.state.settings.season).toBe(6);
    expect(screen.getByRole('alert').textContent).toMatch(/Season must be a whole number/);
  });

  it('daily reset accepts H:MM / HH:MM and rejects other text', () => {
    const holder = setup();
    type('Daily reset', '5:00');
    fireEvent.blur(input('Daily reset'));
    expect(holder.state.settings.resetTime).toBe('05:00');
    type('Daily reset', '25:00');
    fireEvent.blur(input('Daily reset'));
    expect(holder.state.settings.resetTime).toBe('05:00');
    expect(screen.getByRole('alert').textContent).toMatch(/Daily reset must be a time/);
  });
});
