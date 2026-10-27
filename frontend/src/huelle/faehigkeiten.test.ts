import { afterEach, describe, expect, it, vi } from 'vitest';
import { beendeHuelle, starteMacHuelle, starteWindowsHuelle } from '../test/huelle';
import {
  huelleAnmeldungImBrowser,
  huelleAppBadge,
  huelleBenachrichtigung,
  huelleSperrtPasskey,
} from './faehigkeiten';

describe('huelleSperrtPasskey (LFH-817)', () => {
  afterEach(beendeHuelle);

  it('sperrt nichts ohne Kennung (Browser)', () => {
    expect(window.__LIFELINE_HUELLE__).toBeUndefined();
    expect(huelleSperrtPasskey()).toBe(false);
  });

  it('sperrt nichts in der Windows-Hülle, die nur die native Meldung einträgt', () => {
    starteWindowsHuelle({ invoke: vi.fn().mockResolvedValue(undefined) });
    expect(window.__LIFELINE_HUELLE__).toBeDefined();
    expect(huelleSperrtPasskey()).toBe(false);
    expect(huelleAnmeldungImBrowser()).toBeNull();
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

describe('huelleBenachrichtigung (Benachrichtigungskonzept D7)', () => {
  afterEach(beendeHuelle);

  it('liefert im Browser nichts', () => {
    expect(huelleBenachrichtigung()).toBeNull();
  });

  it('ruft in der macOS-Hülle den Command mit Titel und Text (ausgelieferte Init-Skripte)', async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    starteMacHuelle({ invoke });
    await huelleBenachrichtigung()!('Auftrag überfällig', 'Auftrag #7');
    expect(invoke).toHaveBeenCalledExactlyOnceWith('benachrichtigung_zeigen', {
      titel: 'Auftrag überfällig',
      text: 'Auftrag #7',
    });
    // Beide Skripte ergänzen dieselbe Kennung, keines verdrängt das andere.
    expect(huelleSperrtPasskey()).toBe(true);
    expect(huelleAnmeldungImBrowser()).not.toBeNull();
  });

  it('ruft den Command auch in der Windows-Hülle, ohne Text mit `null`', async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    starteWindowsHuelle({ invoke });
    await huelleBenachrichtigung()!('Neuer Auftrag');
    expect(invoke).toHaveBeenCalledExactlyOnceWith('benachrichtigung_zeigen', {
      titel: 'Neuer Auftrag',
      text: null,
    });
  });

  it('reicht eine Ablehnung der Hülle weiter', async () => {
    starteMacHuelle({ invoke: vi.fn().mockRejectedValue('nicht erlaubt') });
    await expect(huelleBenachrichtigung()!('Titel')).rejects.toBe('nicht erlaubt');
  });

  it('liefert nichts ohne IPC-Brücke', () => {
    starteMacHuelle();
    expect(huelleBenachrichtigung()).toBeNull();
  });
});

describe('huelleAppBadge (LLH-1423)', () => {
  afterEach(beendeHuelle);

  it('liefert im Browser nichts', () => {
    expect(huelleAppBadge()).toBeNull();
  });

  it('ruft in jeder Hülle den Command mit der Zahl (ausgelieferte Init-Skripte)', async () => {
    for (const starte of [starteMacHuelle, starteWindowsHuelle]) {
      const invoke = vi.fn().mockResolvedValue(undefined);
      starte({ invoke });
      await huelleAppBadge()!(4);
      expect(invoke).toHaveBeenCalledExactlyOnceWith('set_app_badge', { count: 4 });
      beendeHuelle();
    }
  });

  it('reicht eine Ablehnung der Hülle weiter', async () => {
    starteWindowsHuelle({ invoke: vi.fn().mockRejectedValue('nicht erlaubt') });
    await expect(huelleAppBadge()!(1)).rejects.toBe('nicht erlaubt');
  });

  it('liefert nichts ohne IPC-Brücke', () => {
    starteMacHuelle();
    expect(huelleAppBadge()).toBeNull();
  });
});
