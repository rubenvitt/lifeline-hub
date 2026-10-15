import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

/**
 * `public/alarm-sw.js` läuft im Service Worker (LFH-1062). Der Test lädt die Datei wie
 * `importScripts` und gibt ihr ein nachgebautes `self`.
 */
const QUELLE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../public/alarm-sw.js'),
  'utf8',
);

type Fenster = {
  url: string;
  focus: ReturnType<typeof vi.fn>;
  postMessage: ReturnType<typeof vi.fn>;
};

function fenster(url: string): Fenster {
  const f: Fenster = { url, focus: vi.fn(async () => f), postMessage: vi.fn() };
  return f;
}

function ladeServiceWorker(offen: Fenster[]) {
  const hoerer = new Map<string, (ev: unknown) => void>();
  const self = {
    addEventListener: (typ: string, f: (ev: unknown) => void) => hoerer.set(typ, f),
    clients: {
      matchAll: vi.fn(async () => offen),
      openWindow: vi.fn(async () => null),
    },
  };
  new Function('self', QUELLE)(self);
  /** Spielt einen Klick ein und wartet, bis `waitUntil` durch ist. */
  const klick = async (data: unknown) => {
    const close = vi.fn();
    let arbeit: Promise<unknown> = Promise.resolve();
    hoerer.get('notificationclick')?.({
      notification: { data, close },
      waitUntil: (p: Promise<unknown>) => {
        arbeit = p;
      },
    });
    await arbeit;
    return { close };
  };
  return { self, klick };
}

const SEITE = 'https://lfh.example/einsatz/1/lage';
const ZIEL = 'https://lfh.example/einsatz/1/meldungen';

describe('alarm-sw.js: Klick auf eine Alarm-Meldung', () => {
  it('holt den Tab der Meldung nach vorn und meldet ihm den Klick', async () => {
    const anderer = fenster('https://lfh.example/einsatz/2/lage');
    const eigener = fenster(SEITE);
    const { self, klick } = ladeServiceWorker([anderer, eigener]);
    const { close } = await klick({ art: 'lfh-alarm', id: 'ab-1', seite: SEITE, ziel: ZIEL });
    expect(close).toHaveBeenCalledOnce();
    expect(self.clients.matchAll).toHaveBeenCalledWith({ type: 'window' });
    expect(eigener.focus).toHaveBeenCalledOnce();
    expect(anderer.focus).not.toHaveBeenCalled();
    // Gemeldet wird jedem Tab: nur der mit dieser ID reagiert. Der nach vorn geholte bekommt das
    // Ziel mit, falls er die ID nicht mehr kennt.
    expect(anderer.postMessage).toHaveBeenCalledWith({ typ: 'lfh-alarm-klick', id: 'ab-1' });
    expect(eigener.postMessage).toHaveBeenCalledWith({
      typ: 'lfh-alarm-klick',
      id: 'ab-1',
      ziel: ZIEL,
      gewaehlt: true,
    });
    expect(self.clients.openWindow).not.toHaveBeenCalled();
  });

  it('nimmt den ersten Tab, wenn keiner mehr auf der Seite der Meldung steht', async () => {
    const erster = fenster('https://lfh.example/einsatz/1/etb');
    const { klick } = ladeServiceWorker([erster, fenster('https://lfh.example/x')]);
    await klick({ art: 'lfh-alarm', id: 'ab-1', seite: SEITE, ziel: ZIEL });
    expect(erster.focus).toHaveBeenCalledOnce();
  });

  it('öffnet die Quelle, wenn es keinen Tab mehr gibt', async () => {
    const { self, klick } = ladeServiceWorker([]);
    await klick({ art: 'lfh-alarm', id: 'ab-1', seite: SEITE, ziel: ZIEL });
    expect(self.clients.openWindow).toHaveBeenCalledWith(ZIEL);
  });

  it('öffnet ohne Quelle die Seite der Meldung', async () => {
    const { self, klick } = ladeServiceWorker([]);
    await klick({ art: 'lfh-alarm', id: 'ab-1', seite: SEITE });
    expect(self.clients.openWindow).toHaveBeenCalledWith(SEITE);
  });

  it('lässt fremde Meldungen unberührt', async () => {
    const f = fenster(SEITE);
    const { self, klick } = ladeServiceWorker([f]);
    const { close } = await klick({ art: 'etwas-anderes' });
    await klick(null);
    expect(close).not.toHaveBeenCalled();
    expect(f.focus).not.toHaveBeenCalled();
    expect(self.clients.openWindow).not.toHaveBeenCalled();
  });

  it('meldet den Klick auch, wenn der Browser das Fokussieren verweigert', async () => {
    const f = fenster(SEITE);
    f.focus.mockRejectedValueOnce(new Error('InvalidAccessError'));
    const { klick } = ladeServiceWorker([f]);
    await klick({ art: 'lfh-alarm', id: 'ab-1', seite: SEITE });
    expect(f.postMessage).toHaveBeenCalledWith({
      typ: 'lfh-alarm-klick',
      id: 'ab-1',
      ziel: undefined,
      gewaehlt: true,
    });
  });
});

describe('alarm-sw.js: Nachfrage der Seite', () => {
  it('beantwortet die Nachfrage und nichts sonst', () => {
    const hoerer = new Map<string, (ev: unknown) => void>();
    const self = {
      addEventListener: (typ: string, f: (ev: unknown) => void) => hoerer.set(typ, f),
      clients: {},
    };
    new Function('self', QUELLE)(self);
    const quelle = { postMessage: vi.fn() };
    hoerer.get('message')?.({ data: { typ: 'SKIP_WAITING' }, source: quelle });
    expect(quelle.postMessage).not.toHaveBeenCalled();
    hoerer.get('message')?.({ data: { typ: 'lfh-alarm-nachfrage' }, source: quelle });
    expect(quelle.postMessage).toHaveBeenCalledWith({ typ: 'lfh-alarm-antwort' });
  });
});

describe('alarm-sw.js: Web Push (LLH-1223)', () => {
  type Meldung = { titel: string; optionen: Record<string, unknown>; close: () => void };

  function ladeMitPush(tabs: { focused: boolean }[]) {
    const hoerer = new Map<string, (ev: unknown) => void>();
    const gezeigt: Meldung[] = [];
    const registration = {
      scope: 'https://lfh.example/',
      showNotification: vi.fn(async (titel: string, optionen: Record<string, unknown>) => {
        const m: Meldung = {
          titel,
          optionen,
          close: vi.fn(() => gezeigt.splice(gezeigt.indexOf(m), 1)),
        };
        gezeigt.push(m);
      }),
      getNotifications: vi.fn(async ({ tag }: { tag: string }) =>
        gezeigt.filter((m) => m.optionen.tag === tag),
      ),
    };
    const self = {
      addEventListener: (typ: string, f: (ev: unknown) => void) => hoerer.set(typ, f),
      registration,
      clients: { matchAll: vi.fn(async () => tabs), openWindow: vi.fn() },
    };
    new Function('self', QUELLE)(self);
    const push = async (nutzlast: unknown) => {
      let arbeit: Promise<unknown> = Promise.resolve();
      hoerer.get('push')?.({
        data:
          nutzlast === undefined
            ? null
            : {
                json: () => {
                  if (typeof nutzlast === 'string') throw new SyntaxError('kein JSON');
                  return nutzlast;
                },
              },
        waitUntil: (p: Promise<unknown>) => {
          arbeit = p;
        },
      });
      await arbeit;
    };
    return { push, gezeigt, registration };
  }

  const EREIGNIS = {
    einsatz_id: 7,
    benachrichtigung_id: 42,
    art: 'sofortmeldung',
    stufe: 'alarm',
    bezug_typ: 'meldung',
    bezug_id: 3,
    quittiert: false,
  };

  function serverAntwort(antwort: Response | Error) {
    const f = vi.fn(async () => {
      if (antwort instanceof Error) throw antwort;
      return antwort;
    });
    vi.stubGlobal('fetch', f);
    return f;
  }

  it('holt den Text beim Server und zeigt die Meldung mit Sprung', async () => {
    const f = serverAntwort(
      new Response(
        JSON.stringify({
          titel: 'Sofortmeldung',
          detail: 'Meldung #3',
          pfad: '/einsaetze/7/meldungen?meldung=3',
        }),
      ),
    );
    const { push, gezeigt } = ladeMitPush([]);
    await push(EREIGNIS);
    expect(f).toHaveBeenCalledWith('/api/benachrichtigungen/42', expect.anything());
    expect(gezeigt).toHaveLength(1);
    expect(gezeigt[0]!.titel).toBe('Sofortmeldung');
    expect(gezeigt[0]!.optionen).toMatchObject({
      body: 'Meldung #3',
      tag: '7-b-42',
      requireInteraction: true,
      data: {
        art: 'lfh-alarm',
        id: 'push-42',
        benachrichtigung_id: 42,
        ziel: 'https://lfh.example/einsaetze/7/meldungen?meldung=3',
      },
    });
    vi.unstubAllGlobals();
  });

  it('zeigt ohne Antwort des Servers den Titel der Stufe', async () => {
    serverAntwort(new TypeError('Failed to fetch'));
    const { push, gezeigt } = ladeMitPush([]);
    await push(EREIGNIS);
    expect(gezeigt[0]!.titel).toBe('Alarm');
    expect(gezeigt[0]!.optionen.body).toBeUndefined();
    expect((gezeigt[0]!.optionen.data as { ziel: string }).ziel).toBe(
      'https://lfh.example/einsaetze/7',
    );

    serverAntwort(new Response('', { status: 401 }));
    const zweiter = ladeMitPush([]);
    await zweiter.push({ ...EREIGNIS, stufe: 'hinweis', art: 'auftrag_erteilt' });
    expect(zweiter.gezeigt[0]!.titel).toBe('Neue Benachrichtigung');
    expect(zweiter.gezeigt[0]!.optionen.requireInteraction).toBe(false);
    vi.unstubAllGlobals();
  });

  it('schließt die Meldung sofort, wenn ein Tab der App fokussiert ist', async () => {
    serverAntwort(new Response(JSON.stringify({ titel: 'Sofortmeldung', pfad: '/einsaetze/7' })));
    const { push, gezeigt, registration } = ladeMitPush([{ focused: false }, { focused: true }]);
    await push(EREIGNIS);
    expect(registration.showNotification).toHaveBeenCalledOnce();
    expect(gezeigt).toHaveLength(0);
    vi.unstubAllGlobals();
  });

  it('schließt die Meldung sofort, wenn sie schon quittiert ist', async () => {
    serverAntwort(
      new Response(
        JSON.stringify({ titel: 'Sofortmeldung', pfad: '/einsaetze/7', quittiert_at: 'x' }),
      ),
    );
    const { push, gezeigt, registration } = ladeMitPush([{ focused: false }]);
    await push(EREIGNIS);
    expect(registration.showNotification).toHaveBeenCalledOnce();
    expect(gezeigt).toHaveLength(0);
    vi.unstubAllGlobals();
  });

  it('übergeht leere, kaputte und fremde Nutzlasten', async () => {
    const f = serverAntwort(new Response('{}'));
    const { push, registration } = ladeMitPush([]);
    await push(undefined);
    await push('kaputt');
    await push({ etwas: 'anderes' });
    await push({ ...EREIGNIS, quittiert: true });
    expect(f).not.toHaveBeenCalled();
    expect(registration.showNotification).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
