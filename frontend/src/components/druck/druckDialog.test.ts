import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { oeffneLiveVerbindung } from '../../live/liveVerbindung';
import { DRUCK_LIVE_FRIST_MS, oeffneDruckdialog } from './druckDialog';

/**
 * Nachbau des Safari-Verhaltens (LFH-1105): solange eine Quelle offen ist, stellt `print` zurück;
 * schließt die letzte, kommt der zurückgestellte Druck sofort.
 */
class FakeEventSource {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;
  static instanzen: FakeEventSource[] = [];
  static beiSchliessen: (() => void) | null = null;
  static offene(): FakeEventSource[] {
    return FakeEventSource.instanzen.filter((q) => q.readyState !== FakeEventSource.CLOSED);
  }
  readyState = FakeEventSource.OPEN;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: string) {
    FakeEventSource.instanzen.push(this);
  }
  addEventListener() {}
  removeEventListener() {}
  close() {
    this.readyState = FakeEventSource.CLOSED;
    FakeEventSource.beiSchliessen?.();
  }
}

/** Der Druck wie im Browser: `beforeprint`, Dialog, `afterprint`, alles synchron. */
const dialog = vi.fn();
function druckeJetzt() {
  window.dispatchEvent(new Event('beforeprint'));
  dialog();
  window.dispatchEvent(new Event('afterprint'));
}

let schliessen: () => void;
beforeEach(() => {
  vi.stubGlobal('EventSource', FakeEventSource);
  schliessen = oeffneLiveVerbindung({ url: '/api/live', listeners: [], beiWiederaufbau: () => {} });
});

afterEach(() => {
  schliessen();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  dialog.mockReset();
  FakeEventSource.instanzen = [];
  FakeEventSource.beiSchliessen = null;
});

describe('oeffneDruckdialog (LFH-1105)', () => {
  it('Chromium/Firefox: druckt sofort und lässt den Live-Strom offen', () => {
    vi.spyOn(window, 'print').mockImplementation(druckeJetzt);
    oeffneDruckdialog();
    expect(dialog).toHaveBeenCalledTimes(1);
    expect(FakeEventSource.instanzen).toHaveLength(1);
    expect(FakeEventSource.offene()).toHaveLength(1);
  });

  it('Safari: schließt den Strom, der zurückgestellte Druck kommt, danach ein neuer Strom', () => {
    let zurueckgestellt = false;
    vi.spyOn(window, 'print').mockImplementation(() => {
      if (FakeEventSource.offene().length > 0) zurueckgestellt = true;
      else druckeJetzt();
    });
    const offenBeimDruck: number[] = [];
    dialog.mockImplementation(() => offenBeimDruck.push(FakeEventSource.offene().length));
    FakeEventSource.beiSchliessen = () => {
      if (zurueckgestellt && FakeEventSource.offene().length === 0) {
        zurueckgestellt = false;
        druckeJetzt();
      }
    };

    oeffneDruckdialog();

    expect(dialog).toHaveBeenCalledTimes(1);
    expect(offenBeimDruck).toEqual([0]);
    expect(FakeEventSource.instanzen).toHaveLength(2);
    expect(FakeEventSource.offene()).toHaveLength(1);
  });

  it('Safari, Druck weiter zurückgestellt: neuer Strom erst nach afterprint', () => {
    vi.useFakeTimers();
    vi.spyOn(window, 'print').mockImplementation(() => {});
    oeffneDruckdialog();
    expect(FakeEventSource.offene()).toHaveLength(0);

    druckeJetzt();
    expect(FakeEventSource.offene()).toHaveLength(1);
    vi.advanceTimersByTime(DRUCK_LIVE_FRIST_MS);
    expect(FakeEventSource.instanzen).toHaveLength(2);
  });

  it('Safari, Druck kommt nie: neuer Strom nach der Frist', () => {
    vi.useFakeTimers();
    vi.spyOn(window, 'print').mockImplementation(() => {});
    oeffneDruckdialog();
    vi.advanceTimersByTime(DRUCK_LIVE_FRIST_MS - 1);
    expect(FakeEventSource.offene()).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(FakeEventSource.offene()).toHaveLength(1);

    window.dispatchEvent(new Event('afterprint'));
    expect(FakeEventSource.instanzen).toHaveLength(2);
  });
});
