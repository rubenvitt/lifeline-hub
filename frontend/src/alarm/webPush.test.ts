import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { server } from '../test/server';
import {
  ladePushZustand,
  pushAbgleichen,
  pushAusschalten,
  pushEinschalten,
  pushMerker,
  schliessePushMeldungen,
} from './webPush';

/** Öffentlicher Schlüssel der Instanz; Inhalt egal, nur die Bytes zählen. */
const SCHLUESSEL = 'BAECAwQ';
const SCHLUESSEL_BYTES = [4, 1, 2, 3, 4];

type Abo = {
  endpoint: string;
  options: { applicationServerKey: ArrayBuffer | null };
  toJSON: () => unknown;
  unsubscribe: ReturnType<typeof vi.fn>;
};

function abo(endpoint: string, schluessel: number[] = SCHLUESSEL_BYTES): Abo {
  return {
    endpoint,
    options: { applicationServerKey: new Uint8Array(schluessel).buffer },
    toJSON: () => ({ endpoint, keys: { p256dh: 'P256', auth: 'AUTH' } }),
    unsubscribe: vi.fn(async () => true),
  };
}

/** Browser mit Service Worker, PushManager und Notification; `erlaubnis` ist die Antwort. */
function browser(opts: { erlaubnis?: NotificationPermission; vorhanden?: Abo | null } = {}) {
  let aktuell: Abo | null = opts.vorhanden ?? null;
  const pushManager = {
    getSubscription: vi.fn(async () => aktuell),
    subscribe: vi.fn(async (o: { applicationServerKey: Uint8Array; userVisibleOnly: boolean }) => {
      aktuell = abo('https://fcm.googleapis.com/neu', [...o.applicationServerKey]);
      return aktuell;
    }),
  };
  const gezeigt: { tag?: string; data: unknown; close: ReturnType<typeof vi.fn> }[] = [];
  const registration = {
    pushManager,
    getNotifications: vi.fn(async () => gezeigt),
  };
  const notification = {
    permission: 'default' as NotificationPermission,
    requestPermission: vi.fn(async () => {
      notification.permission = opts.erlaubnis ?? 'granted';
      return notification.permission;
    }),
  };
  vi.stubGlobal('Notification', notification);
  vi.stubGlobal('PushManager', function PushManager() {});
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { ready: Promise.resolve(registration), controller: {} },
  });
  return { pushManager, notification, gezeigt, registration, aktuell: () => aktuell };
}

function serverMitPush(angemeldet = false) {
  const anmeldungen: unknown[] = [];
  let abmeldungen = 0;
  server.use(
    http.get('/api/web-push', () => HttpResponse.json({ schluessel: SCHLUESSEL, angemeldet })),
    http.put('/api/web-push/abo', async ({ request }) => {
      anmeldungen.push(await request.json());
      return new HttpResponse(null, { status: 204 });
    }),
    http.delete('/api/web-push/abo', () => {
      abmeldungen++;
      return new HttpResponse(null, { status: 204 });
    }),
  );
  return { anmeldungen, abmeldungen: () => abmeldungen };
}

beforeEach(() => localStorage.clear());

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, 'serviceWorker');
  delete window.__LIFELINE_HUELLE__;
});

describe('webPush: ob der Schalter erscheint (D8)', () => {
  it('fehlt ohne PushManager, in der Hülle und ohne Schalter am Server', async () => {
    serverMitPush();
    expect(await ladePushZustand()).toBe('fehlt');

    browser();
    window.__LIFELINE_HUELLE__ = { passkey: false };
    expect(await ladePushZustand()).toBe('fehlt');
    delete window.__LIFELINE_HUELLE__;

    server.use(http.get('/api/web-push', () => HttpResponse.json({ error: 'x' }, { status: 404 })));
    expect(await ladePushZustand()).toBe('fehlt');
    server.use(http.get('/api/web-push', () => HttpResponse.json({ error: 'x' }, { status: 403 })));
    expect(await ladePushZustand()).toBe('fehlt');
  });

  it('liest an, aus und blockiert', async () => {
    const b = browser();
    serverMitPush(false);
    expect(await ladePushZustand()).toBe('aus');
    serverMitPush(true);
    expect(await ladePushZustand()).toBe('an');
    b.notification.permission = 'denied';
    expect(await ladePushZustand()).toBe('blockiert');
  });
});

describe('webPush: einschalten und ausschalten', () => {
  it('fragt die Erlaubnis, abonniert mit dem Serverschlüssel und meldet das Abo an', async () => {
    const b = browser();
    const s = serverMitPush();
    expect(await pushEinschalten(7)).toBe('an');
    expect(b.notification.requestPermission).toHaveBeenCalledOnce();
    expect(b.pushManager.subscribe).toHaveBeenCalledWith({
      userVisibleOnly: true,
      applicationServerKey: new Uint8Array(SCHLUESSEL_BYTES),
    });
    expect(s.anmeldungen).toEqual([
      { endpoint: 'https://fcm.googleapis.com/neu', p256dh: 'P256', auth: 'AUTH' },
    ]);
    expect(localStorage.getItem(pushMerker(7))).toBe('1');
  });

  it('nimmt ein vorhandenes Abo mit demselben Schlüssel, ersetzt eins mit fremdem', async () => {
    const gleich = abo('https://fcm.googleapis.com/alt');
    const b = browser({ vorhanden: gleich });
    const s = serverMitPush();
    await pushEinschalten(7);
    expect(b.pushManager.subscribe).not.toHaveBeenCalled();
    expect(s.anmeldungen).toEqual([expect.objectContaining({ endpoint: gleich.endpoint })]);

    const fremd = abo('https://fcm.googleapis.com/fremd', [4, 9, 9]);
    const c = browser({ vorhanden: fremd });
    await pushEinschalten(7);
    expect(fremd.unsubscribe).toHaveBeenCalledOnce();
    expect(c.pushManager.subscribe).toHaveBeenCalledOnce();
  });

  it('verweigerte Erlaubnis: blockiert, nichts abonniert', async () => {
    const b = browser({ erlaubnis: 'denied' });
    const s = serverMitPush();
    expect(await pushEinschalten(7)).toBe('blockiert');
    expect(b.pushManager.subscribe).not.toHaveBeenCalled();
    expect(s.anmeldungen).toEqual([]);
    expect(localStorage.getItem(pushMerker(7))).toBeNull();
  });

  it('weggeklickte Erlaubnis: bleibt aus', async () => {
    browser({ erlaubnis: 'default' });
    serverMitPush();
    expect(await pushEinschalten(7)).toBe('aus');
  });

  it('ausschalten meldet ab, kündigt das Browser-Abo und nimmt den Merker weg', async () => {
    const vorhanden = abo('https://fcm.googleapis.com/alt');
    browser({ vorhanden });
    const s = serverMitPush(true);
    localStorage.setItem(pushMerker(7), '1');
    expect(await pushAusschalten(7)).toBe('aus');
    expect(s.abmeldungen()).toBe(1);
    expect(vorhanden.unsubscribe).toHaveBeenCalledOnce();
    expect(localStorage.getItem(pushMerker(7))).toBeNull();
  });
});

describe('webPush: Wiederanmeldung nach einer neuen Sitzung', () => {
  it('meldet mit Merker und Erlaubnis das Abo dieser Person neu an', async () => {
    const vorhanden = abo('https://fcm.googleapis.com/alt');
    const b = browser({ vorhanden });
    b.notification.permission = 'granted';
    const s = serverMitPush(false);
    localStorage.setItem(pushMerker(7), '1');
    await pushAbgleichen(7);
    expect(s.anmeldungen).toEqual([expect.objectContaining({ endpoint: vorhanden.endpoint })]);
    expect(b.notification.requestPermission).not.toHaveBeenCalled();
  });

  it('tut nichts für eine andere Person, ohne Erlaubnis oder ohne Schalter am Server', async () => {
    const b = browser({ vorhanden: abo('https://fcm.googleapis.com/alt') });
    const s = serverMitPush(false);
    localStorage.setItem(pushMerker(7), '1');

    b.notification.permission = 'granted';
    await pushAbgleichen(8);
    b.notification.permission = 'default';
    await pushAbgleichen(7);
    expect(s.anmeldungen).toEqual([]);

    b.notification.permission = 'granted';
    server.use(http.get('/api/web-push', () => HttpResponse.json({ error: 'x' }, { status: 404 })));
    await expect(pushAbgleichen(7)).resolves.toBeUndefined();
    expect(s.anmeldungen).toEqual([]);
  });

  it('wirft nie', async () => {
    const b = browser();
    b.notification.permission = 'granted';
    b.pushManager.getSubscription.mockRejectedValue(new Error('kaputt'));
    serverMitPush(false);
    localStorage.setItem(pushMerker(7), '1');
    await expect(pushAbgleichen(7)).resolves.toBeUndefined();
  });
});

describe('webPush: Quittieren schließt die Push-Meldung (D7)', () => {
  it('schließt die Meldungen des Workers zu dieser Benachrichtigung', async () => {
    const b = browser();
    const passend = { data: { art: 'lfh-alarm', benachrichtigung_id: 42 }, close: vi.fn() };
    const andere = { data: { art: 'lfh-alarm', benachrichtigung_id: 43 }, close: vi.fn() };
    const eigene = { data: { art: 'lfh-alarm', id: 'tab-1' }, close: vi.fn() };
    b.gezeigt.push(passend, andere, eigene);
    await schliessePushMeldungen(42);
    expect(passend.close).toHaveBeenCalledOnce();
    expect(andere.close).not.toHaveBeenCalled();
    expect(eigene.close).not.toHaveBeenCalled();
  });

  it('tut ohne Service Worker nichts', async () => {
    await expect(schliessePushMeldungen(42)).resolves.toBeUndefined();
  });
});
