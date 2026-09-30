import { afterEach, describe, expect, it, vi } from 'vitest';
import { beendeHuelle, starteMacHuelle } from '../test/huelle';
import { huelleAnmeldungImBrowser, huelleSperrtPasskey } from './faehigkeiten';

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

describe('huelleAnmeldungImBrowser (LFH-818)', () => {
  afterEach(beendeHuelle);

  it('liefert im Browser nichts', () => {
    expect(huelleAnmeldungImBrowser()).toBeNull();
  });

  it('ruft in der macOS-Hülle den Command der Hülle (ausgeliefertes Init-Skript)', async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    starteMacHuelle({ invoke });
    const anmelden = huelleAnmeldungImBrowser();
    expect(anmelden).not.toBeNull();
    await anmelden!();
    expect(invoke).toHaveBeenCalledWith('anmeldung_im_browser');
  });

  it('reicht eine Ablehnung der Hülle weiter', async () => {
    starteMacHuelle({ invoke: vi.fn().mockRejectedValue('nicht erlaubt') });
    await expect(huelleAnmeldungImBrowser()!()).rejects.toBe('nicht erlaubt');
  });

  it('liefert nichts ohne IPC-Brücke oder ohne Feld', () => {
    starteMacHuelle();
    expect(huelleAnmeldungImBrowser()).toBeNull();
    window.__LIFELINE_HUELLE__ = { passkey: false };
    expect(huelleAnmeldungImBrowser()).toBeNull();
  });
});
