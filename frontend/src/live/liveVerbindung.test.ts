import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  HEARTBEAT_TIMEOUT_MS,
  oeffneLiveVerbindung,
  pausiereLiveStroeme,
  type LiveVerbindungsStatus,
} from './liveVerbindung';

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
  private lauscher: Record<string, EventListener[]> = {};
  constructor(readonly url: string) {
    FakeEventSource.instanzen.push(this);
  }
  addEventListener(typ: string, cb: EventListener) {
    (this.lauscher[typ] ??= []).push(cb);
  }
  removeEventListener(typ: string, cb: EventListener) {
    this.lauscher[typ] = (this.lauscher[typ] ?? []).filter((l) => l !== cb);
  }
  close() {
    this.readyState = FakeEventSource.CLOSED;
  }
  oeffne() {
    this.readyState = FakeEventSource.OPEN;
    this.onopen?.();
  }
  /** Spielt ein Ereignis ein, wie es eine offene Quelle ihren Listenern meldet. */
  sende(typ: string, data = '{}') {
    (this.lauscher[typ] ?? []).forEach((cb) => cb(new MessageEvent(typ, { data })));
  }
  fehler(readyState: number) {
    this.readyState = readyState;
    this.onerror?.();
  }
}

/** Zeichnet die gemeldeten Zustände auf (`lfh:live-status`). */
const gemeldet: LiveVerbindungsStatus[] = [];
const statusMerken = (e: Event) =>
  gemeldet.push((e as CustomEvent<{ status: LiveVerbindungsStatus }>).detail.status);
window.addEventListener('lfh:live-status', statusMerken);

/** Der zuletzt gemeldete Zustand. */
const zuletzt = () => gemeldet[gemeldet.length - 1];

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  FakeEventSource.instanzen = [];
  gemeldet.length = 0;
});

function verbinde(listeners: readonly (readonly [string, EventListener])[] = []) {
  vi.stubGlobal('EventSource', FakeEventSource);
  const beiWiederaufbau = vi.fn();
  const beimErstenOpen = vi.fn();
  const schliessen = oeffneLiveVerbindung({
    url: '/api/live',
    listeners,
    beiWiederaufbau,
    beimErstenOpen,
    positionsEreignis: 'position',
  });
  return { schliessen, beiWiederaufbau, beimErstenOpen };
}

describe('Erst-Open nach Fehlversuch (LLH-1839)', () => {
  it('meldet dem Erst-Open, ob vorher ein Versuch scheiterte', () => {
    const { schliessen, beimErstenOpen } = verbinde();
    FakeEventSource.instanzen[0].oeffne();
    expect(beimErstenOpen).toHaveBeenCalledWith(false);
    schliessen();
  });

  it('nach einem gescheiterten Versuch vor dem ersten open heißt es: es lag Zeit dazwischen', () => {
    const { schliessen, beimErstenOpen } = verbinde();
    const quelle = FakeEventSource.instanzen[0];
    quelle.fehler(FakeEventSource.CONNECTING);
    quelle.oeffne();
    expect(beimErstenOpen).toHaveBeenCalledWith(true);
    schliessen();
  });
});

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

// Spec `live-abgleich`, „Eine stumme Live-Leitung gilt als abgerissen“ (LLH-1935, Change
// `l39v43md-sse-herzschlag`, design.md D3).
describe('Wache gegen eine stumme Leitung (LLH-1935)', () => {
  it('meldet nach 45 s Stille sofort „connecting“ und baut eine neue Verbindung auf', () => {
    vi.useFakeTimers();
    const { schliessen, beiWiederaufbau, beimErstenOpen } = verbinde();
    const erste = FakeEventSource.instanzen[0];
    erste.oeffne();
    expect(beimErstenOpen).toHaveBeenCalledTimes(1);
    expect(HEARTBEAT_TIMEOUT_MS).toBe(45_000);

    vi.advanceTimersByTime(HEARTBEAT_TIMEOUT_MS - 1);
    expect(FakeEventSource.instanzen).toHaveLength(1);
    expect(zuletzt()).toBe('open');

    vi.advanceTimersByTime(1);
    expect(zuletzt()).toBe('connecting');
    expect(erste.readyState).toBe(FakeEventSource.CLOSED);
    expect(FakeEventSource.instanzen).toHaveLength(2);
    expect(FakeEventSource.offene()).toHaveLength(1);

    FakeEventSource.instanzen[1].oeffne();
    expect(zuletzt()).toBe('open');
    // Die neue Verbindung hat keine `Last-Event-ID`: Vollabgleich, genau einmal.
    expect(beiWiederaufbau).toHaveBeenCalledTimes(1);
    expect(beimErstenOpen).toHaveBeenCalledTimes(1);
    schliessen();
  });

  it('hält die Leitung, solange Lebenszeichen, Position oder Fach-Ereignisse eintreffen', () => {
    vi.useFakeTimers();
    const etb = vi.fn();
    const { schliessen } = verbinde([['etb', etb]]);
    const quelle = FakeEventSource.instanzen[0];
    quelle.oeffne();
    const schritt = HEARTBEAT_TIMEOUT_MS - 1000;
    for (const typ of ['heartbeat', 'position', 'etb', 'heartbeat', 'heartbeat']) {
      vi.advanceTimersByTime(schritt);
      quelle.sende(typ);
    }
    expect(etb).toHaveBeenCalledTimes(1);
    expect(FakeEventSource.instanzen).toHaveLength(1);
    expect(gemeldet).not.toContain('connecting');

    vi.advanceTimersByTime(HEARTBEAT_TIMEOUT_MS);
    expect(zuletzt()).toBe('connecting');
    schliessen();
  });

  it('meldet vor dem ersten „open“ keinen Abriss wegen Stille (Kaltstart)', () => {
    vi.useFakeTimers();
    const { schliessen } = verbinde();
    vi.advanceTimersByTime(HEARTBEAT_TIMEOUT_MS * 3);
    expect(gemeldet).toEqual([]);
    expect(FakeEventSource.instanzen).toHaveLength(1);
    schliessen();
  });

  it('übergibt nach einem Fehler an den Neuaufbau des Browsers und wacht nach dessen „open“ wieder', () => {
    vi.useFakeTimers();
    const { schliessen } = verbinde();
    const quelle = FakeEventSource.instanzen[0];
    quelle.oeffne();
    vi.advanceTimersByTime(HEARTBEAT_TIMEOUT_MS - 1000);
    quelle.fehler(FakeEventSource.CONNECTING);
    vi.advanceTimersByTime(HEARTBEAT_TIMEOUT_MS * 2);
    // Nur die Schonfrist des Browser-Neuaufbaus meldet sich, die Wache baut nichts eigenes auf.
    expect(FakeEventSource.instanzen).toHaveLength(1);
    expect(gemeldet.filter((s) => s === 'connecting')).toHaveLength(1);

    quelle.oeffne();
    vi.advanceTimersByTime(HEARTBEAT_TIMEOUT_MS);
    expect(FakeEventSource.instanzen).toHaveLength(2);
    schliessen();
  });

  // design.md D6: ein Weg, der öffnet, aber nie liefert (puffernder Proxy), läuft nicht in eine
  // Schleife aus Neuaufbau und Vollabgleich alle 45 s.
  it('staffelt den Neuaufbau, solange neue Leitungen nie ein Ereignis liefern', () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const { schliessen } = verbinde();
    const ablaufen = (i: number) => {
      FakeEventSource.instanzen[i].oeffne();
      vi.advanceTimersByTime(HEARTBEAT_TIMEOUT_MS);
    };

    ablaufen(0);
    // Der erste stumme Ablauf baut sofort neu auf.
    expect(FakeEventSource.instanzen).toHaveLength(2);

    ablaufen(1);
    expect(zuletzt()).toBe('connecting');
    expect(FakeEventSource.instanzen).toHaveLength(2);
    vi.advanceTimersByTime(999);
    expect(FakeEventSource.instanzen).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(FakeEventSource.instanzen).toHaveLength(3);

    ablaufen(2);
    vi.advanceTimersByTime(2999);
    expect(FakeEventSource.instanzen).toHaveLength(3);
    vi.advanceTimersByTime(1);
    expect(FakeEventSource.instanzen).toHaveLength(4);

    // Liefert die Leitung wieder, beginnt die Staffel von vorn: der nächste Ablauf baut sofort neu auf.
    FakeEventSource.instanzen[3].oeffne();
    FakeEventSource.instanzen[3].sende('heartbeat');
    vi.advanceTimersByTime(HEARTBEAT_TIMEOUT_MS);
    expect(FakeEventSource.instanzen).toHaveLength(5);
    schliessen();
  });

  it('baut nach dem Aufräumen während der gestaffelten Wartezeit nichts mehr auf', () => {
    vi.useFakeTimers();
    const { schliessen } = verbinde();
    FakeEventSource.instanzen[0].oeffne();
    vi.advanceTimersByTime(HEARTBEAT_TIMEOUT_MS);
    FakeEventSource.instanzen[1].oeffne();
    vi.advanceTimersByTime(HEARTBEAT_TIMEOUT_MS);
    expect(FakeEventSource.instanzen).toHaveLength(2);
    schliessen();
    vi.advanceTimersByTime(60_000);
    expect(FakeEventSource.instanzen).toHaveLength(2);
  });

  it('feuert nach dem Pausieren und nach dem Aufräumen nicht mehr', () => {
    vi.useFakeTimers();
    const { schliessen } = verbinde();
    FakeEventSource.instanzen[0].oeffne();
    const fortsetzen = pausiereLiveStroeme();
    vi.advanceTimersByTime(HEARTBEAT_TIMEOUT_MS * 2);
    expect(FakeEventSource.instanzen).toHaveLength(1);
    expect(gemeldet).not.toContain('connecting');

    fortsetzen!();
    FakeEventSource.instanzen[1].oeffne();
    schliessen();
    vi.advanceTimersByTime(HEARTBEAT_TIMEOUT_MS * 2);
    expect(FakeEventSource.instanzen).toHaveLength(2);
    expect(gemeldet).not.toContain('connecting');
  });
});
