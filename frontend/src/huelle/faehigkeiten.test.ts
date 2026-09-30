import { afterEach, describe, expect, it } from 'vitest';
import { beendeHuelle, starteMacHuelle } from '../test/huelle';
import { huelleSperrtPasskey } from './faehigkeiten';

describe('huelleSperrtPasskey (LFH-817)', () => {
  afterEach(beendeHuelle);

  it('sperrt nichts ohne Kennung (Browser, Windows-Hülle)', () => {
    expect(window.__LIFELINE_HUELLE__).toBeUndefined();
    expect(huelleSperrtPasskey()).toBe(false);
  });

  it('sperrt den Passkey in der macOS-Hülle (ausgeliefertes Init-Skript)', () => {
    starteMacHuelle();
    expect(huelleSperrtPasskey()).toBe(true);
  });

  it('sperrt nur bei ausdrücklichem `passkey: false`, nicht bei fehlendem oder anderem Wert', () => {
    window.__LIFELINE_HUELLE__ = {};
    expect(huelleSperrtPasskey()).toBe(false);
    window.__LIFELINE_HUELLE__ = { passkey: true };
    expect(huelleSperrtPasskey()).toBe(false);
  });

  it('liest beim Aufruf, nicht beim Laden des Moduls', () => {
    expect(huelleSperrtPasskey()).toBe(false);
    starteMacHuelle();
    expect(huelleSperrtPasskey()).toBe(true);
    beendeHuelle();
    expect(huelleSperrtPasskey()).toBe(false);
  });
});
