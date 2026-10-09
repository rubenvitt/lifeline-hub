import { afterEach, describe, expect, it, vi } from 'vitest';
import { oeffneLiveVerbindung, pausiereLiveStroeme } from './liveVerbindung';

/** Zeichnet Verbindungen auf; `oeffne` spielt das `open` ein. */
class FakeEventSource {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;
  static instanzen: FakeEventSource[] = [];
  static offene(): FakeEventSource[] {
    return FakeEventSource.instanzen.filter((q) => q.readyState !== FakeEventSource.CLOSED);
  }
  readyState = FakeEventSource.CONNECTING;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: string) {
    FakeEventSource.instanzen.push(this);
  }
  addEventListener() {}
  removeEventListener() {}
  close() {
    this.readyState = FakeEventSource.CLOSED;
  }
  oeffne() {
    this.readyState = FakeEventSource.OPEN;
    this.onopen?.();
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  FakeEventSource.instanzen = [];
});

function verbinde() {
  vi.stubGlobal('EventSource', FakeEventSource);
  const beiWiederaufbau = vi.fn();
  const beimErstenOpen = vi.fn();
  const schliessen = oeffneLiveVerbindung({
    url: '/api/live',
    listeners: [],
    beiWiederaufbau,
    beimErstenOpen,
  });
  return { schliessen, beiWiederaufbau, beimErstenOpen };
}

describe('pausiereLiveStroeme (LFH-1105)', () => {
  it('liefert null, wenn kein Strom offen ist', () => {
    expect(pausiereLiveStroeme()).toBeNull();
  });

  it('schließt den offenen Strom synchron und baut ihn beim Fortsetzen neu auf, mit Abgleich', () => {
    const { schliessen, beiWiederaufbau, beimErstenOpen } = verbinde();
    FakeEventSource.instanzen[0].oeffne();
    expect(beimErstenOpen).toHaveBeenCalledTimes(1);

    const fortsetzen = pausiereLiveStroeme();
    expect(FakeEventSource.offene()).toHaveLength(0);

    fortsetzen!();
    fortsetzen!();
    expect(FakeEventSource.instanzen).toHaveLength(2);
    expect(FakeEventSource.offene()).toHaveLength(1);
    FakeEventSource.instanzen[1].oeffne();
    // Neue Verbindung ohne `Last-Event-ID`: Vollabgleich wie jeder Neuaufbau.
    expect(beiWiederaufbau).toHaveBeenCalledTimes(1);
    schliessen();
  });

  it('baut nach dem Aufräumen während der Pause nichts mehr auf', () => {
    const { schliessen } = verbinde();
    const fortsetzen = pausiereLiveStroeme();
    schliessen();
    fortsetzen!();
    expect(FakeEventSource.instanzen).toHaveLength(1);
    expect(pausiereLiveStroeme()).toBeNull();
  });

  it('lässt einen aufgegebenen Strom (CLOSED) liegen', () => {
    const { schliessen } = verbinde();
    FakeEventSource.instanzen[0].close();
    expect(pausiereLiveStroeme()).toBeNull();
    schliessen();
  });
});
