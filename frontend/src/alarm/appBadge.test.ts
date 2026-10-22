import { afterEach, describe, expect, it, vi } from 'vitest';
import { setzeAppBadge } from './appBadge';

describe('App-Badge (LLH-1062)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('setzt die Zahl und nimmt sie bei 0 weg', () => {
    const setAppBadge = vi.fn(async () => undefined);
    const clearAppBadge = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { ...navigator, setAppBadge, clearAppBadge });
    setzeAppBadge(3);
    expect(setAppBadge).toHaveBeenCalledExactlyOnceWith(3);
    setzeAppBadge(0);
    expect(clearAppBadge).toHaveBeenCalledOnce();
  });

  it('ohne Badging API bleibt es still', () => {
    vi.stubGlobal('navigator', {});
    expect(() => setzeAppBadge(2)).not.toThrow();
  });

  it('eine abgelehnte Zusage wirft nicht', async () => {
    vi.stubGlobal('navigator', { setAppBadge: vi.fn(async () => Promise.reject(new Error('x'))) });
    expect(() => setzeAppBadge(1)).not.toThrow();
    await Promise.resolve();
  });
});
