import { afterEach, describe, expect, it, vi } from 'vitest';
import { fordereDesktopPermission, zeigeDesktopAlarm } from './desktopAlarm';

function stubNotification(permission: NotificationPermission) {
  const instances: Array<{ title: string; onclick: (() => void) | null; close: () => void }> = [];
  const Ctor = vi.fn(function (this: Record<string, unknown>, title: string) {
    const inst = { title, onclick: null as (() => void) | null, close: vi.fn() };
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
