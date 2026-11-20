import { describe, it, expect, afterEach, vi } from 'vitest';
import { newId } from '../../src/shared/ids';

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('newId', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses crypto.randomUUID when available', () => {
    const spy = vi.fn(() => '11111111-1111-4111-8111-111111111111');
    vi.stubGlobal('crypto', { randomUUID: spy, getRandomValues: crypto.getRandomValues.bind(crypto) });
    expect(newId()).toBe('11111111-1111-4111-8111-111111111111');
    expect(spy).toHaveBeenCalled();
  });
  it('falls back to getRandomValues when randomUUID is undefined', () => {
    const real = crypto;
    const grv = vi.fn(<T extends ArrayBufferView<ArrayBuffer>>(a: T) => real.getRandomValues(a));
    vi.stubGlobal('crypto', { randomUUID: undefined, getRandomValues: grv });
    const id = newId();
    expect(id).toMatch(V4);
    expect(grv).toHaveBeenCalled();
  });
  it('produces valid unique v4 ids on both paths', () => {
    for (const stub of [false, true]) {
      if (stub) vi.stubGlobal('crypto', { randomUUID: undefined, getRandomValues: crypto.getRandomValues.bind(crypto) });
      const ids = new Set<string>();
      for (let i = 0; i < 1000; i++) { const id = newId(); expect(id).toMatch(V4); ids.add(id); }
      expect(ids.size).toBe(1000);
      vi.unstubAllGlobals();
    }
  });
});
