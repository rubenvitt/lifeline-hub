/**
 * Stumme `EventSource`-Attrappe für Seiten mit Live-Stream: sie öffnet, empfängt aber nichts, bis
 * ein Test über {@link FakeEventSource.emit} ein Ereignis einspielt. Einsetzen per
 * `vi.stubGlobal('EventSource', FakeEventSource)`.
 */
export class FakeEventSource {
  /** Alle seit dem letzten {@link FakeEventSource.zuruecksetzen} geöffneten Quellen. */
  static instanzen: FakeEventSource[] = [];
  url: string;
  closed = false;
  private listeners: Record<string, ((e: MessageEvent) => void)[]> = {};
  constructor(url: string) {
    this.url = url;
    FakeEventSource.instanzen.push(this);
  }
  addEventListener(typ: string, cb: (e: MessageEvent) => void) {
    (this.listeners[typ] ??= []).push(cb);
  }
  removeEventListener(typ: string, cb: (e: MessageEvent) => void) {
    this.listeners[typ] = (this.listeners[typ] ?? []).filter((l) => l !== cb);
  }
  close() {
    this.closed = true;
  }
  /** Spielt ein Ereignis ein, als käme es vom Server. */
  emit(typ: string, data = '') {
    (this.listeners[typ] ?? []).forEach((cb) => cb(new MessageEvent(typ, { data })));
  }
  static zuruecksetzen() {
    FakeEventSource.instanzen = [];
  }
}
