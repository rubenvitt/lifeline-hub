import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DESKTOP_TEST_VERSION,
  beendeHuelle,
  type IosNachricht,
  starteAndroidHuelle,
  starteIosHuelle,
  starteMacHuelle,
  starteWindowsHuelle,
} from '../test/huelle';
import {
  huelleAnmeldungImBrowser,
  huelleAppBadge,
  huelleBenachrichtigung,
  huelleHaptics,
  huelleIstApp,
  huellePlatform,
  huelleSperrtPasskey,
  huelleVersion,
} from './faehigkeiten';

describe('huelleIstApp (LLH-2071)', () => {
  afterEach(beendeHuelle);

  it('ist im Browser und in den Desktop-Hüllen falsch', () => {
    expect(huelleIstApp()).toBe(false);
    starteMacHuelle();
    expect(huelleIstApp()).toBe(false);
    beendeHuelle();
    starteWindowsHuelle();
    expect(huelleIstApp()).toBe(false);
  });

  it('ist in der iOS- und der Android-App wahr (ausgelieferte Init-Skripte)', () => {
    starteIosHuelle({ bruecke: { postMessage: vi.fn() } });
    expect(huelleIstApp()).toBe(true);
    beendeHuelle();
    starteAndroidHuelle({ bruecke: { postMessage: vi.fn() } });
    expect(huelleIstApp()).toBe(true);
  });
});

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

describe('huellePlatform und huelleVersion (t39ltxxi)', () => {
  afterEach(beendeHuelle);

  it('liefern im Browser nichts', () => {
    expect(huellePlatform()).toBeNull();
    expect(huelleVersion()).toBeNull();
  });

  it('liefern in einer Desktop-Hülle vor LLH-1982 nichts, die beide Felder nicht setzt', () => {
    starteMacHuelle({ invoke: vi.fn().mockResolvedValue(undefined) }, { ohneKennung: true });
    expect(huellePlatform()).toBeNull();
    expect(huelleVersion()).toBeNull();
  });

  it('nennen in der macOS- und der Windows-Hülle Plattform und Version (LLH-1982)', () => {
    starteMacHuelle({ invoke: vi.fn().mockResolvedValue(undefined) });
    expect(huellePlatform()).toBe('macos');
    expect(huelleVersion()).toBe(DESKTOP_TEST_VERSION);
    beendeHuelle();
    starteWindowsHuelle();
    expect(huellePlatform()).toBe('windows');
    expect(huelleVersion()).toBe(DESKTOP_TEST_VERSION);
  });

  it('nennen in der iOS-Hülle Plattform und Version (ausgeliefertes Init-Skript)', () => {
    starteIosHuelle({ bruecke: { postMessage: vi.fn() }, version: '1.0.0-alpha.42' });
    expect(huellePlatform()).toBe('ios');
    expect(huelleVersion()).toBe('1.0.0-alpha.42');
  });

  it('übergehen Felder in fremder Form', () => {
    window.__LIFELINE_HUELLE__ = { platform: 7, version: {} } as never;
    expect(huellePlatform()).toBeNull();
    expect(huelleVersion()).toBeNull();
  });
});

describe('huelleHaptics (t39ltxxi, Spec huellen-vertrag)', () => {
  afterEach(beendeHuelle);

  it('tut im Browser nichts und wirft nicht', () => {
    expect(() => huelleHaptics('success')).not.toThrow();
  });

  it('tut in der Desktop-Hülle ohne `haptics` nichts', () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    starteMacHuelle({ invoke });
    huelleHaptics('success');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('meldet in der iOS-Hülle die Art genau einmal (ausgeliefertes Init-Skript)', () => {
    const nachrichten: IosNachricht[] = [];
    starteIosHuelle({ bruecke: { postMessage: (n) => nachrichten.push(n) } });
    expect(huelleHaptics('selection')).toBeUndefined();
    expect(nachrichten).toEqual([{ cmd: 'haptics', kind: 'selection' }]);
  });

  it('wirft nie, auch wenn die Hülle wirft oder ablehnt', async () => {
    const unbehandelt = vi.fn();
    process.on('unhandledRejection', unbehandelt);
    try {
      window.__LIFELINE_HUELLE__ = {
        haptics: () => {
          throw new Error('kaputt');
        },
      };
      expect(() => huelleHaptics('error')).not.toThrow();
      window.__LIFELINE_HUELLE__ = { haptics: () => Promise.reject(new Error('abgelehnt')) };
      expect(() => huelleHaptics('error')).not.toThrow();
      await new Promise((fertig) => setTimeout(fertig, 0));
      expect(unbehandelt).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unbehandelt);
    }
  });

  it('wartet nicht auf die Hülle', () => {
    const haptics = vi.fn(() => new Promise(() => {}));
    window.__LIFELINE_HUELLE__ = { haptics };
    expect(huelleHaptics('tap')).toBeUndefined();
    expect(haptics).toHaveBeenCalledExactlyOnceWith('tap');
  });
});
