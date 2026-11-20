// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyGameData, emptyState } from '../../src/shared/defaults';
import { useAppState } from '../../src/client/useAppState';

const gd = emptyGameData();
const stateFile = emptyState(new Date());

let fetchMock: ReturnType<typeof vi.fn>;
let putFails = false;
/** When set, PUTs wait until the test resolves them. */
let holdPuts: (() => void)[] | null = null;

function puts(url: string) {
  return fetchMock.mock.calls.filter(([u, init]) => u === url && (init as RequestInit | undefined)?.method === 'PUT');
}

beforeEach(() => {
  vi.useFakeTimers();
  putFails = false;
  holdPuts = null;
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    if (init?.method === 'PUT' && holdPuts) await new Promise<void>(resolve => holdPuts!.push(resolve));
    if (init?.method === 'PUT') return putFails ? json({ ok: false, error: 'disk full' }, 400) : json({ ok: true });
    if (url === '/api/gamedata') return json(gd);
    if (url === '/api/state') return json(stateFile);
    if (url === '/api/health') return json({ warnings: ['recovered from backup'] });
    return json({ ok: false }, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function loaded() {
  const hook = renderHook(() => useAppState());
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(hook.result.current.loaded).toBe(true);
  return hook;
}

describe('useAppState', () => {
  it('loads both files and health warnings', async () => {
    const { result } = await loaded();
    expect(result.current.warnings).toEqual(['recovered from backup']);
    expect(result.current.canUndo).toBe(false);
  });

  it('returns the error of a failing transition and leaves state unchanged', async () => {
    const { result } = await loaded();
    const before = result.current.state;
    let err: string | null = null;
    act(() => { err = result.current.apply(() => ({ ok: false, error: 'Not enough Tofu' })); });
    expect(err).toBe('Not enough Tofu');
    expect(result.current.state).toBe(before);
    expect(result.current.canUndo).toBe(false);
  });

  it('undo restores the previous state after a successful apply', async () => {
    const { result } = await loaded();
    const before = result.current.state;
    act(() => { expect(result.current.apply(s => ({ ok: true, value: { ...s, idp: { ...s.idp, earned: 7 } } }))).toBeNull(); });
    expect(result.current.state.idp.earned).toBe(7);
    expect(result.current.canUndo).toBe(true);
    act(() => result.current.undo());
    expect(result.current.state).toBe(before);
    expect(result.current.canUndo).toBe(false);
  });

  it('PUTs only the changed file, debounced 300 ms', async () => {
    const { result } = await loaded();
    act(() => { result.current.apply(s => ({ ...s, spawnsCollectedOn: '2026-01-01' })); });
    await act(async () => { await vi.advanceTimersByTimeAsync(299); });
    expect(puts('/api/state')).toHaveLength(0);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(puts('/api/state')).toHaveLength(1);
    expect(puts('/api/gamedata')).toHaveLength(0);
    expect(JSON.parse((puts('/api/state')[0][1] as RequestInit).body as string).spawnsCollectedOn).toBe('2026-01-01');
  });

  it('saves gamedata separately, and undo of a gamedata change saves again', async () => {
    const { result } = await loaded();
    act(() => { result.current.applyGameData(g => ({ ...g, shop: [{ item: '1', price: 5, currency: 'coin', shop: 'x' }] })); });
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(puts('/api/gamedata')).toHaveLength(1);
    expect(puts('/api/state')).toHaveLength(0);
    act(() => result.current.undo());
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(puts('/api/gamedata')).toHaveLength(2);
    expect(JSON.parse((puts('/api/gamedata')[1][1] as RequestInit).body as string).shop).toEqual([]);
  });

  it('surfaces a failed save, keeps local state, and retries on the next change', async () => {
    const { result } = await loaded();
    putFails = true;
    act(() => { result.current.apply(s => ({ ...s, idp: { ...s.idp, earned: 1 } })); });
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(result.current.saveError).toBe('disk full');
    expect(result.current.state.idp.earned).toBe(1);
    putFails = false;
    act(() => { result.current.apply(s => ({ ...s, idp: { ...s.idp, earned: 2 } })); });
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(result.current.saveError).toBeNull();
    expect(puts('/api/state')).toHaveLength(2);
  });

  it('never has two PUTs of a file in flight: a change during a save is sent after it completes', async () => {
    const { result } = await loaded();
    holdPuts = [];
    act(() => { result.current.apply(s => ({ ...s, idp: { ...s.idp, earned: 1 } })); });
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(puts('/api/state')).toHaveLength(1);
    act(() => { result.current.apply(s => ({ ...s, idp: { ...s.idp, earned: 2 } })); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(puts('/api/state')).toHaveLength(1);
    const pending = holdPuts;
    holdPuts = null;
    await act(async () => { pending.forEach(r => r()); await vi.advanceTimersByTimeAsync(0); });
    expect(puts('/api/state')).toHaveLength(2);
    expect(JSON.parse((puts('/api/state')[1][1] as RequestInit).body as string).idp.earned).toBe(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(puts('/api/state')).toHaveLength(2);
  });

  it('retries a failed save every 5 s without another edit, and stops once it succeeds', async () => {
    const { result } = await loaded();
    putFails = true;
    act(() => { result.current.apply(s => ({ ...s, idp: { ...s.idp, earned: 3 } })); });
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(result.current.saveError).toBe('disk full');
    await act(async () => { await vi.advanceTimersByTimeAsync(4999); });
    expect(puts('/api/state')).toHaveLength(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(puts('/api/state')).toHaveLength(2);
    expect(result.current.saveError).toBe('disk full');
    putFails = false;
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(puts('/api/state')).toHaveLength(3);
    expect(result.current.saveError).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(puts('/api/state')).toHaveLength(3);
  });

  it('flushes a pending change on pagehide with keepalive, without waiting for the debounce', async () => {
    const { result } = await loaded();
    act(() => { result.current.apply(s => ({ ...s, idp: { ...s.idp, earned: 4 } })); });
    act(() => { window.dispatchEvent(new Event('pagehide')); });
    expect(puts('/api/state')).toHaveLength(1);
    expect((puts('/api/state')[0][1] as RequestInit).keepalive).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(puts('/api/state')).toHaveLength(1);
    act(() => { window.dispatchEvent(new Event('pagehide')); });
    expect(puts('/api/state')).toHaveLength(1);   // nothing dirty: nothing sent
  });

  it('drops keepalive for bodies too large for the browser keepalive limit', async () => {
    const { result } = await loaded();
    const big = Object.fromEntries(Array.from({ length: 5000 }, (_, i) => [`item-${i}-padding-padding`, i]));
    act(() => { result.current.apply(s => ({ ...s, stock: big })); });
    act(() => { window.dispatchEvent(new Event('pagehide')); });
    expect(puts('/api/state')).toHaveLength(1);
    expect((puts('/api/state')[0][1] as RequestInit).keepalive).toBeUndefined();
  });
});
