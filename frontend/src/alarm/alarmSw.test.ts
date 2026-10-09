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
