import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  antworteIosHuelle,
  beendeHuelle,
  type IosNachricht,
  starteIosHuelle,
} from '../test/huelle';

/**
 * Init-Skript der iOS-Hülle (`ios/App/Huelle/huelle.js`, Change t39ltxxi, Spec `huellen-vertrag`):
 * es läuft hier wie im WKWebView, gegen einen gestubbten Message-Handler `lifeline`.
 */
function brueckeMit() {
  const nachrichten: IosNachricht[] = [];
  const postMessage = vi.fn((n: IosNachricht) => {
    nachrichten.push(n);
  });
  return { bruecke: { postMessage }, nachrichten, postMessage };
}

const ARTEN = ['success', 'warning', 'error', 'selection', 'tap'];

describe('Init-Skript der iOS-Hülle (t39ltxxi)', () => {
  afterEach(beendeHuelle);

  it('setzt die Kennung vollständig', () => {
    starteIosHuelle({ bruecke: brueckeMit().bruecke, version: '1.0.0-alpha.42' });
    const kennung = window.__LIFELINE_HUELLE__!;
    expect(kennung.platform).toBe('ios');
    expect(kennung.version).toBe('1.0.0-alpha.42');
    expect(kennung.passkey).toBe(false);
    expect(typeof kennung.anmeldungImBrowser).toBe('function');
    expect(typeof kennung.haptics).toBe('function');
    expect(typeof kennung.benachrichtigungZeigen).toBe('function');
    expect(typeof kennung.setAppBadge).toBe('function');
    expect(kennung.push).toBe(true);
    expect(typeof kennung.pushRegister).toBe('function');
    expect(typeof kennung.pushUnregister).toBe('function');
    expect(typeof kennung.pushState).toBe('function');
    expect(Object.isFrozen(kennung)).toBe(true);
  });

  it('bleibt ohne Message-Handler `lifeline` stumm (Browser, Desktop-Hülle)', () => {
    const print = window.print;
    starteIosHuelle();
    expect(window.__LIFELINE_HUELLE__).toBeUndefined();
    expect(window.print).toBe(print);

    (window as unknown as { webkit?: unknown }).webkit = { messageHandlers: {} };
    starteIosHuelle();
    expect(window.__LIFELINE_HUELLE__).toBeUndefined();
    expect(window.print).toBe(print);
  });

  it('setzt keine Version, wenn die Hülle den Platzhalter nicht ersetzt hat', () => {
    starteIosHuelle({ bruecke: brueckeMit().bruecke, version: null });
    expect(window.__LIFELINE_HUELLE__?.platform).toBe('ios');
    expect(window.__LIFELINE_HUELLE__?.version).toBeUndefined();
  });

  it('ergänzt eine schon gesetzte Kennung, ihre eigenen Felder gehen vor', () => {
    window.__LIFELINE_HUELLE__ = { passkey: true, setAppBadge: vi.fn() };
    starteIosHuelle({ bruecke: brueckeMit().bruecke });
    expect(window.__LIFELINE_HUELLE__?.passkey).toBe(false);
    expect(window.__LIFELINE_HUELLE__?.platform).toBe('ios');
  });

  it('eine Antwort an das alte Dokument erfüllt keine Frage des neuen (LLH-2082)', async () => {
    const zufall = vi.spyOn(Math, 'random').mockReturnValueOnce(0.25).mockReturnValueOnce(0.75);
    try {
      const alt = brueckeMit();
      starteIosHuelle({ bruecke: alt.bruecke });
      void window.__LIFELINE_HUELLE__!.anmeldungImBrowser!();
      const altId = alt.nachrichten[0].id!;
      beendeHuelle();

      const neu = brueckeMit();
      starteIosHuelle({ bruecke: neu.bruecke });
      let fertig = false;
      void window.__LIFELINE_HUELLE__!.anmeldungImBrowser!().then(() => {
        fertig = true;
      });
      const neuId = neu.nachrichten[0].id!;
      expect(Number.isSafeInteger(neuId)).toBe(true);
      expect(neuId).not.toBe(altId);

      // Die späte Antwort der Hülle auf das alte Dokument trifft keine offene Frage.
      antworteIosHuelle(altId, null);
      await Promise.resolve();
      expect(fertig).toBe(false);
    } finally {
      zufall.mockRestore();
    }
  });

  it('„Im Browser anmelden“ fragt die Hülle und wartet auf ihre Antwort', async () => {
    const { bruecke, nachrichten } = brueckeMit();
    starteIosHuelle({ bruecke });
    let fertig = false;
    const zusage = window.__LIFELINE_HUELLE__!.anmeldungImBrowser!().then(() => {
      fertig = true;
    });
    expect(nachrichten).toEqual([{ cmd: 'sign_in_with_browser', id: expect.any(Number) }]);
    await Promise.resolve();
    expect(fertig).toBe(false);
    antworteIosHuelle(nachrichten[0].id!, null);
    await zusage;
    expect(fertig).toBe(true);
  });

  it('sendet push_register und löst mit dem Reply auf', async () => {
    const { bruecke, nachrichten } = brueckeMit();
    starteIosHuelle({ bruecke });
    const zusage = window.__LIFELINE_HUELLE__!.pushRegister!();
    expect(nachrichten).toEqual([{ cmd: 'push_register', id: expect.any(Number) }]);
    const reply = { registration_id: 'k-1', token: 'ab', environment: 'sandbox', key: 'sk' };
    antworteIosHuelle(nachrichten[0].id!, null, reply);
    await expect(zusage).resolves.toEqual(reply);
  });

  it('sendet push_unregister und push_state', async () => {
    const { bruecke, nachrichten } = brueckeMit();
    starteIosHuelle({ bruecke });
    const kennung = window.__LIFELINE_HUELLE__!;
    const ab = kennung.pushUnregister!();
    const stand = kennung.pushState!();
    expect(nachrichten).toEqual([
      { cmd: 'push_unregister', id: expect.any(Number) },
      { cmd: 'push_state', id: expect.any(Number) },
    ]);
    antworteIosHuelle(nachrichten[0].id!, null, null);
    antworteIosHuelle(nachrichten[1].id!, null, { permission: 'granted', registration_id: 'k-1' });
    await expect(ab).resolves.toBeNull();
    await expect(stand).resolves.toEqual({ permission: 'granted', registration_id: 'k-1' });
  });

  it('lehnt push_register mit dem Fehlercode der Hülle ab', async () => {
    const { bruecke, nachrichten } = brueckeMit();
    starteIosHuelle({ bruecke });
    const zusage = window.__LIFELINE_HUELLE__!.pushRegister!();
    antworteIosHuelle(nachrichten[0].id!, 'denied');
    await expect(zusage).rejects.toThrow('denied');
  });

  it('reicht eine Ablehnung der Hülle als Fehler weiter', async () => {
    const { bruecke, nachrichten } = brueckeMit();
    starteIosHuelle({ bruecke });
    const zusage = window.__LIFELINE_HUELLE__!.setAppBadge!(3);
    expect(nachrichten).toEqual([{ cmd: 'set_app_badge', id: expect.any(Number), count: 3 }]);
    antworteIosHuelle(nachrichten[0].id!, 'nicht erlaubt');
    await expect(zusage).rejects.toThrow('nicht erlaubt');
  });

  it('ordnet jede Antwort ihrer Nachricht zu und übergeht fremde', async () => {
    const { bruecke, nachrichten } = brueckeMit();
    starteIosHuelle({ bruecke });
    const kennung = window.__LIFELINE_HUELLE__!;
    const erste = kennung.benachrichtigungZeigen!('Neuer Auftrag', 'Auftrag #7');
    const zweite = kennung.benachrichtigungZeigen!('Ohne Text');
    expect(nachrichten).toEqual([
      {
        cmd: 'show_notification',
        id: expect.any(Number),
        title: 'Neuer Auftrag',
        body: 'Auftrag #7',
      },
      { cmd: 'show_notification', id: expect.any(Number), title: 'Ohne Text', body: null },
    ]);
    expect(nachrichten[0].id).not.toBe(nachrichten[1].id);
    antworteIosHuelle(9999, null);
    antworteIosHuelle(nachrichten[1].id!, 'abgelehnt');
    antworteIosHuelle(nachrichten[0].id!, null, 'ok');
    await expect(erste).resolves.toBe('ok');
    await expect(zweite).rejects.toThrow('abgelehnt');
  });

  it('lehnt ab, wenn der Message-Handler selbst wirft', async () => {
    starteIosHuelle({
      bruecke: {
        postMessage: () => {
          throw new Error('kaputt');
        },
      },
    });
    await expect(window.__LIFELINE_HUELLE__!.setAppBadge!(1)).rejects.toThrow('kaputt');
  });

  it('meldet Haptik ohne Antwort und nur für die fünf Arten', () => {
    const { bruecke, nachrichten } = brueckeMit();
    starteIosHuelle({ bruecke });
    const haptics = window.__LIFELINE_HUELLE__!.haptics!;
    for (const kind of ARTEN) expect(haptics(kind)).toBeUndefined();
    haptics('unknown');
    haptics(undefined as unknown as string);
    expect(nachrichten).toEqual(ARTEN.map((kind) => ({ cmd: 'haptics', kind })));
  });

  it('Haptik wirft nie, auch wenn der Message-Handler wirft', () => {
    starteIosHuelle({
      bruecke: {
        postMessage: () => {
          throw new Error('kaputt');
        },
      },
    });
    expect(() => window.__LIFELINE_HUELLE__!.haptics!('success')).not.toThrow();
  });

  it('ersetzt `window.print` durch den Druck der Hülle', async () => {
    const { bruecke, nachrichten } = brueckeMit();
    const konsole = vi.spyOn(console, 'error').mockImplementation(() => {});
    starteIosHuelle({ bruecke });
    expect(window.print()).toBeUndefined();
    expect(nachrichten).toEqual([{ cmd: 'print', id: expect.any(Number) }]);
    // Eine Ablehnung landet in der Konsole, nicht als unbehandelte Zurückweisung.
    antworteIosHuelle(nachrichten[0].id!, 'kein Drucker');
    await vi.waitFor(() => expect(konsole).toHaveBeenCalled());
    konsole.mockRestore();
  });
});
