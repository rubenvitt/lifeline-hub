import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  desktopPermission,
  fordereDesktopPermission,
  offeneDesktopAlarme,
  schliesseAlleDesktopAlarme,
  schliesseDesktopAlarm,
  schliesseDesktopMeldung,
  zeigeDesktopAlarm,
  zielNavigation,
} from './desktopAlarm';

type StubMeldung = {
  title: string;
  tag: string;
  onclick: (() => void) | null;
  onclose: (() => void) | null;
  close: ReturnType<typeof vi.fn>;
};

function stubNotification(permission: NotificationPermission) {
  const instances: StubMeldung[] = [];
  const Ctor = vi.fn(function (title: string, opts?: NotificationOptions) {
    const inst: StubMeldung = {
      title,
      tag: opts?.tag ?? '',
      onclick: null,
      onclose: null,
      // Wie der Browser: `close()` feuert `close`.
      close: vi.fn(() => inst.onclose?.()),
    };
    instances.push(inst);
    return inst;
  }) as unknown as typeof Notification & {
    permission: NotificationPermission;
    requestPermission: ReturnType<typeof vi.fn>;
  };
  Ctor.permission = permission;
  Ctor.requestPermission = vi.fn(() => Promise.resolve('granted' as NotificationPermission));
  vi.stubGlobal('Notification', Ctor);
  return { Ctor, instances };
}

function setzeHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
}

afterEach(() => {
  schliesseAlleDesktopAlarme();
  vi.unstubAllGlobals();
  setzeHidden(false);
});

describe('zeigeDesktopAlarm', () => {
  it('zeigt keine Notification, wenn der Tab sichtbar ist', () => {
    const { Ctor } = stubNotification('granted');
    setzeHidden(false);
    zeigeDesktopAlarm('Titel');
    expect(Ctor).not.toHaveBeenCalled();
  });

  it('zeigt keine Notification ohne granted-Permission', () => {
    const { Ctor } = stubNotification('denied');
    setzeHidden(true);
    zeigeDesktopAlarm('Titel');
    expect(Ctor).not.toHaveBeenCalled();
  });

  it('zeigt eine Notification bei Hintergrund-Tab + granted', () => {
    const { Ctor } = stubNotification('granted');
    setzeHidden(true);
    zeigeDesktopAlarm('Titel', { koerper: 'Text' });
    expect(Ctor).toHaveBeenCalledWith('Titel', { body: 'Text' });
  });

  it('meldet keine Meldung, wenn der Konstruktor wirft, und gilt danach als nicht verfügbar', () => {
    // Chrome auf Android kennt `Notification`, wirft aber beim Konstruktor (LFH-950).
    const Ctor = vi.fn(function () {
      throw new TypeError('Illegal constructor');
    }) as unknown as typeof Notification & { permission: NotificationPermission };
    Ctor.permission = 'granted';
    vi.stubGlobal('Notification', Ctor);
    setzeHidden(true);
    expect(desktopPermission()).toBe('granted');
    expect(zeigeDesktopAlarm('Titel')).toBeNull();
    expect(desktopPermission()).toBe('unsupported');
  });
});

describe('desktopPermission', () => {
  it('meldet auf Android „unsupported", auch wenn die Permission erteilt ist (LFH-950)', () => {
    const { Ctor } = stubNotification('granted');
    vi.stubGlobal('navigator', {
      ...navigator,
      userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 Chrome/141.0',
    });
    expect(desktopPermission()).toBe('unsupported');
    setzeHidden(true);
    expect(zeigeDesktopAlarm('Titel')).toBeNull();
    expect(Ctor).not.toHaveBeenCalled();
  });

  it('meldet ohne Notification-API „unsupported"', () => {
    vi.stubGlobal('Notification', undefined);
    Reflect.deleteProperty(window, 'Notification');
    expect(desktopPermission()).toBe('unsupported');
  });
});

describe('Desktop-Meldungen mit tag schließen (LFH-951)', () => {
  it('übergibt den tag an den Konstruktor und gibt die Meldung zurück', () => {
    const { Ctor, instances } = stubNotification('granted');
    setzeHidden(true);
    const n = zeigeDesktopAlarm('Titel', { koerper: 'Text', tag: 'sofort-3' });
    expect(Ctor).toHaveBeenCalledWith('Titel', { body: 'Text', tag: 'sofort-3' });
    expect(n?.tag).toBe('sofort-3');
    n?.schliessen();
    expect(instances[0].close).toHaveBeenCalledOnce();
  });

  it('gibt null zurück, wenn keine Meldung entsteht', () => {
    stubNotification('granted');
    setzeHidden(false);
    expect(zeigeDesktopAlarm('Titel', { tag: 'sofort-3' })).toBeNull();
  });

  it('schliesseDesktopAlarm(tag) schließt genau diese Meldung', () => {
    const { instances } = stubNotification('granted');
    setzeHidden(true);
    zeigeDesktopAlarm('A', { tag: 'sofort-1' });
    zeigeDesktopAlarm('B', { tag: 'sofort-2' });
    schliesseDesktopAlarm('sofort-1');
    expect(instances[0].close).toHaveBeenCalledOnce();
    expect(instances[1].close).not.toHaveBeenCalled();
    expect(offeneDesktopAlarme()).toBe(1);
  });

  it('eine zweite Meldung zum selben tag ersetzt die erste, statt sich zu stapeln', () => {
    const { instances } = stubNotification('granted');
    setzeHidden(true);
    zeigeDesktopAlarm('A', { tag: 'unwetter-x' });
    zeigeDesktopAlarm('A neu', { tag: 'unwetter-x' });
    expect(instances[0].close).toHaveBeenCalledOnce();
    expect(offeneDesktopAlarme()).toBe(1);
  });

  it('schliesseAlleDesktopAlarme() schließt alle, auch Meldungen ohne tag, und leert das Set', () => {
    const { instances } = stubNotification('granted');
    setzeHidden(true);
    zeigeDesktopAlarm('A', { tag: 'sofort-1' });
    zeigeDesktopAlarm('B');
    expect(offeneDesktopAlarme()).toBe(2);
    schliesseAlleDesktopAlarme();
    expect(instances[0].close).toHaveBeenCalledOnce();
    expect(instances[1].close).toHaveBeenCalledOnce();
    expect(offeneDesktopAlarme()).toBe(0);
  });

  it('schliesseDesktopMeldung trifft nur das Objekt, nicht eine neuere Meldung zum selben tag', () => {
    const { instances } = stubNotification('granted');
    setzeHidden(true);
    const alt = zeigeDesktopAlarm('A', { tag: 'unwetter-x' })!;
    zeigeDesktopAlarm('A neu', { tag: 'unwetter-x' });
    expect(instances[0].close).toHaveBeenCalledOnce();
    schliesseDesktopMeldung(alt);
    expect(instances[0].close).toHaveBeenCalledOnce();
    expect(instances[1].close).not.toHaveBeenCalled();
    expect(offeneDesktopAlarme()).toBe(1);
  });

  it('nach onclose liegt die Meldung nicht mehr im Set', () => {
    const { instances } = stubNotification('granted');
    setzeHidden(true);
    zeigeDesktopAlarm('A', { tag: 'sofort-1' });
    instances[0].onclose?.();
    expect(offeneDesktopAlarme()).toBe(0);
    schliesseDesktopAlarm('sofort-1');
    expect(instances[0].close).not.toHaveBeenCalled();
  });

  it('ein Klick schließt die Meldung und ruft beiKlick', () => {
    const { instances } = stubNotification('granted');
    setzeHidden(true);
    const beiKlick = vi.fn();
    vi.stubGlobal('focus', vi.fn());
    zeigeDesktopAlarm('A', { tag: 'sofort-1', beiKlick });
    instances[0].onclick?.();
    expect(beiKlick).toHaveBeenCalledOnce();
    expect(instances[0].close).toHaveBeenCalledOnce();
    expect(offeneDesktopAlarme()).toBe(0);
  });
});

describe('fordereDesktopPermission', () => {
  it('fragt die Permission an, wenn Status default ist', () => {
    const { Ctor } = stubNotification('default');
    fordereDesktopPermission();
    expect(Ctor.requestPermission).toHaveBeenCalled();
  });

  it('fragt NICHT erneut, wenn bereits entschieden (granted)', () => {
    const { Ctor } = stubNotification('granted');
    fordereDesktopPermission();
    expect(Ctor.requestPermission).not.toHaveBeenCalled();
  });
});

// ── Android: Meldung über den Service Worker (LFH-1062) ─────────────────────────────────

const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 Chrome/141.0';

type SwMeldung = {
  title: string;
  body?: string;
  tag: string;
  data: { art: string; id: string; seite: string; ziel?: string };
  close: ReturnType<typeof vi.fn>;
};

/**
 * Stubt `navigator.serviceWorker` samt Registrierung. `showNotification` legt die Meldung in
 * eine Liste, `getNotifications` liest sie wie der Browser (Filter nach `tag`), `close()` nimmt
 * sie heraus. `nachricht` spielt eine Nachricht des Service Workers an die Seite ein.
 */
function stubServiceWorker({ controller = true, antwortet = true, ua = ANDROID_UA } = {}) {
  const offeneSw: SwMeldung[] = [];
  const hoerer: ((ev: MessageEvent) => void)[] = [];
  const registrierung = {
    showNotification: vi.fn(async (title: string, opts: NotificationOptions = {}) => {
      // Wie der Browser erst nach einer Weile da: ein zu frühes Schließen ginge ins Leere.
      await new Promise((fertig) => setTimeout(fertig, 0));
      // Wie der Browser: dieselbe `tag` ersetzt die ältere Meldung.
      const tag = opts.tag ?? '';
      if (tag) {
        const alt = offeneSw.findIndex((m) => m.tag === tag);
        if (alt >= 0) offeneSw.splice(alt, 1);
      }
      const m: SwMeldung = {
        title,
        body: opts.body,
        tag,
        data: opts.data as SwMeldung['data'],
        close: vi.fn(() => {
          const i = offeneSw.indexOf(m);
          if (i >= 0) offeneSw.splice(i, 1);
        }),
      };
      offeneSw.push(m);
    }),
    getNotifications: vi.fn(async (filter?: GetNotificationOptions) =>
      offeneSw.filter((m) => !filter?.tag || m.tag === filter.tag),
    ),
  };
  const nachricht = (data: unknown) => {
    for (const f of hoerer) f(new MessageEvent('message', { data }));
  };
  // Der Worker mit `alarm-sw.js` beantwortet die Nachfrage, ein älterer schweigt.
  const steuernd = {
    postMessage: vi.fn((m: { typ?: string }) => {
      if (antwortet && m.typ === 'lfh-alarm-nachfrage') {
        setTimeout(() => nachricht({ typ: 'lfh-alarm-antwort' }), 0);
      }
    }),
  };
  const serviceWorker = {
    controller: controller ? steuernd : null,
    ready: Promise.resolve(registrierung),
    addEventListener: vi.fn((typ: string, f: (ev: MessageEvent) => void) => {
      if (typ === 'message') hoerer.push(f);
    }),
  };
  vi.stubGlobal('navigator', { ...navigator, userAgent: ua, serviceWorker });
  return { registrierung, offeneSw, nachricht, steuernd };
}

/** Fragt beim Service Worker nach und wartet die Antwort ab. */
async function bestaetige() {
  desktopPermission();
  await abwarten();
}

/** Lässt die Promise-Kette der Service-Worker-Schritte ablaufen. */
async function abwarten() {
  for (let i = 0; i < 5; i++) await new Promise((fertig) => setTimeout(fertig, 0));
}

describe('Desktop-Meldung über den Service Worker (LFH-1062)', () => {
  it('meldet auf Android mit Service Worker die Permission statt „unsupported"', async () => {
    stubNotification('granted');
    const { steuernd } = stubServiceWorker();
    const zustand = vi.fn();
    window.addEventListener('lfh:desktop-zustand', zustand);
    // Bis der Worker antwortet, gilt der Weg als nicht da.
    expect(desktopPermission()).toBe('unsupported');
    expect(steuernd.postMessage).toHaveBeenCalledWith({ typ: 'lfh-alarm-nachfrage' });
    await abwarten();
    window.removeEventListener('lfh:desktop-zustand', zustand);
    expect(zustand).toHaveBeenCalledOnce();
    expect(desktopPermission()).toBe('granted');
    expect(steuernd.postMessage).toHaveBeenCalledOnce();
  });

  it('bleibt bei „unsupported", solange ein älterer Worker ohne Alarm-Teil steuert', async () => {
    stubNotification('granted');
    const { registrierung } = stubServiceWorker({ antwortet: false });
    await bestaetige();
    expect(desktopPermission()).toBe('unsupported');
    setzeHidden(true);
    expect(zeigeDesktopAlarm('Titel')).toBeNull();
    await abwarten();
    expect(registrierung.showNotification).not.toHaveBeenCalled();
  });

  it('bleibt auf Android ohne steuernden Service Worker bei „unsupported"', () => {
    stubNotification('granted');
    stubServiceWorker({ controller: false });
    expect(desktopPermission()).toBe('unsupported');
    setzeHidden(true);
    expect(zeigeDesktopAlarm('Titel')).toBeNull();
  });

  it('zeigt die Meldung über showNotification statt über den Konstruktor', async () => {
    const { Ctor } = stubNotification('granted');
    const { registrierung, offeneSw } = stubServiceWorker();
    await bestaetige();
    setzeHidden(true);
    const n = zeigeDesktopAlarm('Titel', {
      koerper: 'Text',
      tag: '1-sofort-3',
      ziel: '/einsatz/1/meldungen',
    });
    await abwarten();
    expect(Ctor).not.toHaveBeenCalled();
    expect(n?.tag).toBe('1-sofort-3');
    expect(registrierung.showNotification).toHaveBeenCalledWith('Titel', {
      body: 'Text',
      tag: '1-sofort-3',
      data: {
        art: 'lfh-alarm',
        id: expect.any(String),
        seite: window.location.href,
        ziel: new URL('/einsatz/1/meldungen', window.location.href).href,
      },
    });
    expect(offeneSw).toHaveLength(1);
    expect(offeneDesktopAlarme()).toBe(1);
  });

  it('zeigt nichts, solange der Tab sichtbar ist', async () => {
    stubNotification('granted');
    const { registrierung } = stubServiceWorker();
    await bestaetige();
    setzeHidden(false);
    expect(zeigeDesktopAlarm('Titel')).toBeNull();
    await abwarten();
    expect(registrierung.showNotification).not.toHaveBeenCalled();
  });

  it('schliesseDesktopAlarm(tag) schließt die Meldung im Service Worker', async () => {
    stubNotification('granted');
    const { offeneSw } = stubServiceWorker();
    await bestaetige();
    setzeHidden(true);
    zeigeDesktopAlarm('A', { tag: 'sofort-1' });
    zeigeDesktopAlarm('B', { tag: 'sofort-2' });
    await abwarten();
    const [a, b] = offeneSw;
    schliesseDesktopAlarm('sofort-1');
    await abwarten();
    expect(a.close).toHaveBeenCalledOnce();
    expect(b.close).not.toHaveBeenCalled();
    expect(offeneDesktopAlarme()).toBe(1);
  });

  it('schließt auch, wenn das Schließen vor dem Erscheinen kommt', async () => {
    stubNotification('granted');
    const { offeneSw } = stubServiceWorker();
    await bestaetige();
    setzeHidden(true);
    const n = zeigeDesktopAlarm('A', { tag: 'sofort-1' })!;
    schliesseDesktopMeldung(n);
    await abwarten();
    expect(offeneSw).toHaveLength(0);
    expect(offeneDesktopAlarme()).toBe(0);
  });

  it('schließt eine Meldung ohne tag, ohne andere ohne tag mitzunehmen', async () => {
    stubNotification('granted');
    const { offeneSw } = stubServiceWorker();
    await bestaetige();
    setzeHidden(true);
    const a = zeigeDesktopAlarm('A')!;
    zeigeDesktopAlarm('B');
    await abwarten();
    schliesseDesktopMeldung(a);
    await abwarten();
    expect(offeneSw.map((m) => m.title)).toEqual(['B']);
  });

  it('eine zweite Meldung zum selben tag ersetzt die erste und bleibt selbst offen', async () => {
    stubNotification('granted');
    const { offeneSw } = stubServiceWorker();
    await bestaetige();
    setzeHidden(true);
    const alt = zeigeDesktopAlarm('A', { tag: 'unwetter-x' })!;
    zeigeDesktopAlarm('A neu', { tag: 'unwetter-x' });
    await abwarten();
    expect(offeneSw.map((m) => m.title)).toEqual(['A neu']);
    // Das alte Objekt schließt nicht die neuere Meldung zum selben tag.
    schliesseDesktopMeldung(alt);
    await abwarten();
    expect(offeneSw.map((m) => m.title)).toEqual(['A neu']);
    expect(offeneDesktopAlarme()).toBe(1);
  });

  it('schliesseAlleDesktopAlarme() schließt alle, auch ohne tag', async () => {
    stubNotification('granted');
    const { offeneSw } = stubServiceWorker();
    await bestaetige();
    setzeHidden(true);
    zeigeDesktopAlarm('A', { tag: 'sofort-1' });
    zeigeDesktopAlarm('B');
    await abwarten();
    expect(offeneSw).toHaveLength(2);
    schliesseAlleDesktopAlarme();
    await abwarten();
    expect(offeneSw).toHaveLength(0);
    expect(offeneDesktopAlarme()).toBe(0);
  });

  it('ein Klick, den der Service Worker meldet, ruft beiKlick und räumt die Meldung ab', async () => {
    stubNotification('granted');
    const { offeneSw, nachricht } = stubServiceWorker();
    await bestaetige();
    setzeHidden(true);
    const beiKlick = vi.fn();
    const andere = vi.fn();
    zeigeDesktopAlarm('A', { tag: 'sofort-1', beiKlick });
    zeigeDesktopAlarm('B', { tag: 'sofort-2', beiKlick: andere });
    await abwarten();
    nachricht({ typ: 'lfh-alarm-klick', id: offeneSw[0].data.id });
    expect(beiKlick).toHaveBeenCalledOnce();
    expect(andere).not.toHaveBeenCalled();
    expect(offeneDesktopAlarme()).toBe(1);
    // Ein zweites Mal (oder eine fremde Nachricht) tut nichts.
    nachricht({ typ: 'lfh-alarm-klick', id: offeneSw[0].data.id });
    nachricht({ typ: 'etwas-anderes', id: offeneSw[1].data.id });
    expect(beiKlick).toHaveBeenCalledOnce();
    expect(andere).not.toHaveBeenCalled();
  });

  it('der Klick führt zur Quelle, auch wenn der sichtbare Tab die Meldung schon abgeräumt hat', async () => {
    // Der Service Worker holt den Tab nach vorn, bevor er den Klick meldet; der sichtbare Tab
    // schließt seine Meldungen (LFH-951) und darf das Ziel dabei nicht vergessen.
    stubNotification('granted');
    const { offeneSw, nachricht } = stubServiceWorker();
    await bestaetige();
    setzeHidden(true);
    const beiKlick = vi.fn();
    zeigeDesktopAlarm('A', { tag: 'sofort-1', beiKlick });
    await abwarten();
    const id = offeneSw[0].data.id;
    schliesseAlleDesktopAlarme();
    nachricht({ typ: 'lfh-alarm-klick', id });
    expect(beiKlick).toHaveBeenCalledOnce();
    nachricht({ typ: 'lfh-alarm-klick', id });
    expect(beiKlick).toHaveBeenCalledOnce();
  });

  it('kennt der Tab die Meldung nicht mehr (neu geladen), lädt der gewählte Tab die Quelle', async () => {
    stubNotification('granted');
    const { nachricht } = stubServiceWorker();
    await bestaetige();
    const oeffne = vi.spyOn(zielNavigation, 'oeffne').mockImplementation(() => {});
    const ziel = 'https://lfh.example/einsaetze/1/meldungen';
    nachricht({ typ: 'lfh-alarm-klick', id: 'frueher-1', ziel });
    expect(oeffne).not.toHaveBeenCalled();
    nachricht({ typ: 'lfh-alarm-klick', id: 'frueher-1', ziel, gewaehlt: true });
    expect(oeffne).toHaveBeenCalledWith(ziel);
    oeffne.mockRestore();
  });

  it('wirft der Konstruktor außerhalb von Android, geht die Meldung über den Service Worker', async () => {
    const Ctor = vi.fn(function () {
      throw new TypeError('Illegal constructor');
    }) as unknown as typeof Notification & { permission: NotificationPermission };
    Ctor.permission = 'granted';
    vi.stubGlobal('Notification', Ctor);
    const { registrierung } = stubServiceWorker({ ua: 'Mozilla/5.0 (X11; Linux x86_64)' });
    setzeHidden(true);
    // Der erste Wurf fragt beim Worker nach; die Meldung trägt bis zur Antwort der Toast.
    expect(zeigeDesktopAlarm('Titel', { tag: 't' })).toBeNull();
    expect(desktopPermission()).toBe('unsupported');
    await abwarten();
    expect(desktopPermission()).toBe('granted');
    expect(zeigeDesktopAlarm('Titel', { tag: 't' })).not.toBeNull();
    await abwarten();
    expect(registrierung.showNotification).toHaveBeenCalledOnce();
  });

  it('scheitert showNotification, gilt die Meldung nicht als offen', async () => {
    stubNotification('granted');
    const { registrierung } = stubServiceWorker();
    await bestaetige();
    registrierung.showNotification.mockRejectedValueOnce(new TypeError('keine Erlaubnis'));
    setzeHidden(true);
    zeigeDesktopAlarm('A', { tag: 'sofort-1' });
    await abwarten();
    expect(offeneDesktopAlarme()).toBe(0);
  });
});
