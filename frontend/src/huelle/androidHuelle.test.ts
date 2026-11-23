import { afterEach, describe, expect, it, vi } from 'vitest';
import { antworteAndroidHuelle, beendeHuelle, starteAndroidHuelle } from '../test/huelle';

/**
 * Init-Skript der Android-Hülle (`android/app/src/main/assets/huelle.js`, LLH-1989): es läuft hier
 * wie im WebView, gegen ein gestubbtes `window.lifeline` (Objekt von `addWebMessageListener`).
 */
interface Nachricht {
  cmd: string;
  id?: number;
  [feld: string]: unknown;
}

function createBruecke() {
  const nachrichten: Nachricht[] = [];
  const postMessage = vi.fn((text: string) => {
    nachrichten.push(JSON.parse(text) as Nachricht);
  });
  return { bruecke: { postMessage }, nachrichten, postMessage };
}

const ARTEN = ['success', 'warning', 'error', 'selection', 'tap'];

describe('Init-Skript der Android-Hülle (LLH-1989)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    beendeHuelle();
  });

  it('setzt die Kennung vollständig und ohne setAppBadge', () => {
    starteAndroidHuelle({ bruecke: createBruecke().bruecke, version: '1.0.0-alpha.42' });
    const kennung = window.__LIFELINE_HUELLE__!;
    expect(kennung.platform).toBe('android');
    expect(kennung.version).toBe('1.0.0-alpha.42');
    expect(kennung.passkey).toBe(false);
    expect(typeof kennung.anmeldungImBrowser).toBe('function');
    expect(typeof kennung.haptics).toBe('function');
    expect(typeof kennung.benachrichtigungZeigen).toBe('function');
    expect(kennung.setAppBadge).toBeUndefined();
    expect(Object.isFrozen(kennung)).toBe(true);
  });

  it('bleibt ohne `window.lifeline` stumm (Browser, andere Hüllen)', () => {
    const print = window.print;
    starteAndroidHuelle();
    expect(window.__LIFELINE_HUELLE__).toBeUndefined();
    expect(window.print).toBe(print);
  });

  it('setzt keine Version, wenn die Hülle den Platzhalter nicht ersetzt hat', () => {
    starteAndroidHuelle({ bruecke: createBruecke().bruecke, version: null });
    expect(window.__LIFELINE_HUELLE__?.platform).toBe('android');
    expect(window.__LIFELINE_HUELLE__?.version).toBeUndefined();
  });

  it('„Im Browser anmelden“ fragt die Hülle und wartet auf ihre Antwort', async () => {
    const { bruecke, nachrichten } = createBruecke();
    starteAndroidHuelle({ bruecke });
    let fertig = false;
    const zusage = window.__LIFELINE_HUELLE__!.anmeldungImBrowser!().then(() => {
      fertig = true;
    });
    expect(nachrichten).toEqual([{ cmd: 'sign_in_with_browser', id: expect.any(Number) }]);
    await Promise.resolve();
    expect(fertig).toBe(false);
    antworteAndroidHuelle(nachrichten[0].id!, null);
    await zusage;
    expect(fertig).toBe(true);
  });

  it('`benachrichtigungZeigen` erfüllt oder lehnt ab nach der Antwort und ordnet sie zu', async () => {
    const { bruecke, nachrichten } = createBruecke();
    starteAndroidHuelle({ bruecke });
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
    antworteAndroidHuelle(9999, null);
    antworteAndroidHuelle(nachrichten[1].id!, 'abgelehnt');
    antworteAndroidHuelle(nachrichten[0].id!, null, true);
    await expect(erste).resolves.toBe(true);
    await expect(zweite).rejects.toThrow('abgelehnt');
  });

  it('übergeht Nachrichten, die keine Antwort im Wire-Format sind', async () => {
    const { bruecke, nachrichten } = createBruecke();
    starteAndroidHuelle({ bruecke });
    const zusage = window.__LIFELINE_HUELLE__!.anmeldungImBrowser!();
    const lifeline = (window as unknown as { lifeline: EventTarget }).lifeline;
    for (const data of ['kein json', 'null', '"text"']) {
      lifeline.dispatchEvent(Object.assign(new Event('message'), { data }));
    }
    antworteAndroidHuelle(nachrichten[0].id!, null);
    await expect(zusage).resolves.toBeNull();
  });

  it('lehnt ab, wenn die Brücke selbst wirft', async () => {
    starteAndroidHuelle({
      bruecke: {
        postMessage: () => {
          throw new Error('kaputt');
        },
      },
    });
    await expect(window.__LIFELINE_HUELLE__!.anmeldungImBrowser!()).rejects.toThrow('kaputt');
  });

  it('meldet Haptik ohne Antwort und nur für die fünf Arten', () => {
    const { bruecke, nachrichten } = createBruecke();
    starteAndroidHuelle({ bruecke });
    const haptics = window.__LIFELINE_HUELLE__!.haptics!;
    for (const kind of ARTEN) expect(haptics(kind)).toBeUndefined();
    haptics('unknown');
    haptics(undefined as unknown as string);
    expect(nachrichten).toEqual(ARTEN.map((kind) => ({ cmd: 'haptics', kind })));
  });

  it('Haptik wirft nie, auch wenn die Brücke wirft', () => {
    starteAndroidHuelle({
      bruecke: {
        postMessage: () => {
          throw new Error('kaputt');
        },
      },
    });
    expect(() => window.__LIFELINE_HUELLE__!.haptics!('success')).not.toThrow();
  });

  it('ersetzt `window.print` durch den Druck der Hülle', async () => {
    const { bruecke, nachrichten } = createBruecke();
    const konsole = vi.spyOn(console, 'error').mockImplementation(() => {});
    starteAndroidHuelle({ bruecke });
    expect(window.print()).toBeUndefined();
    expect(nachrichten).toEqual([{ cmd: 'print', id: expect.any(Number) }]);
    // Eine Ablehnung landet in der Konsole, nicht als unbehandelte Zurückweisung.
    antworteAndroidHuelle(nachrichten[0].id!, 'kein Drucker');
    await vi.waitFor(() => expect(konsole).toHaveBeenCalled());
    konsole.mockRestore();
  });

  it('blob-Download geht als download_blob an die Hülle', async () => {
    const { bruecke, nachrichten } = createBruecke();
    starteAndroidHuelle({ bruecke });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ blob: async () => new Blob(['a;b\n1;2\n'], { type: 'text/csv' }) })),
    );
    const anker = document.createElement('a');
    anker.href = 'blob:https://lifeline.example/abc-123';
    anker.download = 'liste.csv';
    document.body.appendChild(anker);
    const klick = new MouseEvent('click', { bubbles: true, cancelable: true });
    anker.dispatchEvent(klick);
    anker.remove();
    expect(klick.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(nachrichten).toHaveLength(1));
    expect(nachrichten[0]).toEqual({
      cmd: 'download_blob',
      id: expect.any(Number),
      name: 'liste.csv',
      data: btoa('a;b\n1;2\n'),
    });
  });

  it('nennt einen Download ohne Namen „Download“ und lässt andere Anker in Ruhe', async () => {
    const { bruecke, nachrichten } = createBruecke();
    starteAndroidHuelle({ bruecke });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ blob: async () => new Blob(['x']) })),
    );
    const mit = (href: string, download: string | null) => {
      const anker = document.createElement('a');
      anker.href = href;
      if (download != null) anker.setAttribute('download', download);
      document.body.appendChild(anker);
      // Das Skript hört in der Capture-Phase; was bis hierher verhindert ist, war es durch das
      // Skript. Danach verhindern wir selbst, damit jsdom nicht navigiert.
      let verhindert = false;
      anker.addEventListener('click', (e) => {
        verhindert = e.defaultPrevented;
        e.preventDefault();
      });
      anker.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      anker.remove();
      return verhindert;
    };
    expect(mit('https://lifeline.example/datei', 'datei.pdf')).toBe(false);
    expect(mit('blob:https://lifeline.example/ohne-attribut', null)).toBe(false);
    expect(mit('blob:https://lifeline.example/leer', '')).toBe(true);
    await vi.waitFor(() => expect(nachrichten).toHaveLength(1));
    expect(nachrichten[0]).toMatchObject({ cmd: 'download_blob', name: 'Download' });
  });
});
