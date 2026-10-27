import { afterEach, describe, expect, it, vi } from 'vitest';
import { beendeHuelle, starteMacHuelle, starteWindowsHuelle } from '../test/huelle';
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

describe('App-Badge in der Desktop-App (LLH-1423)', () => {
  afterEach(() => {
    beendeHuelle();
    vi.unstubAllGlobals();
  });

  it('setzt die Zahl über die Hülle, 0 nimmt sie weg; die Badging API bleibt unberührt', () => {
    const setAppBadge = vi.fn(async () => undefined);
    const clearAppBadge = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { ...navigator, setAppBadge, clearAppBadge });
    const invoke = vi.fn().mockResolvedValue(undefined);
    starteMacHuelle({ invoke });
    setzeAppBadge(3);
    setzeAppBadge(0);
    expect(invoke.mock.calls).toEqual([
      ['set_app_badge', { count: 3 }],
      ['set_app_badge', { count: 0 }],
    ]);
    expect(setAppBadge).not.toHaveBeenCalled();
    expect(clearAppBadge).not.toHaveBeenCalled();
  });

  it('eine Ablehnung der Hülle wirft nicht', async () => {
    const invoke = vi.fn().mockRejectedValue('nicht erlaubt');
    starteWindowsHuelle({ invoke });
    expect(() => setzeAppBadge(2)).not.toThrow();
    await Promise.resolve();
    expect(invoke).toHaveBeenCalledOnce();
  });

  it('eine Hülle, die beim Aufruf selbst wirft, bleibt still', () => {
    starteWindowsHuelle({
      invoke: () => {
        throw new Error('kaputt');
      },
    });
    expect(() => setzeAppBadge(2)).not.toThrow();
  });
});
