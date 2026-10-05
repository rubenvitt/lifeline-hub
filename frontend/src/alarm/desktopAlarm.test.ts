import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  desktopPermission,
  fordereDesktopPermission,
  offeneDesktopAlarme,
  schliesseAlleDesktopAlarme,
  schliesseDesktopAlarm,
  schliesseDesktopMeldung,
  zeigeDesktopAlarm,
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
    expect(n).toBe(instances[0]);
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
