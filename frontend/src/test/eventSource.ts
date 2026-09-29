/**
 * Stumme `EventSource`-Attrappe für Seiten mit Live-Stream: sie öffnet, empfängt aber nie
 * etwas. Einsetzen per `vi.stubGlobal('EventSource', FakeEventSource)`.
 */
export class FakeEventSource {
  url: string;
  closed = false;
  constructor(url: string) {
    this.url = url;
  }
  addEventListener() {}
  removeEventListener() {}
  close() {
    this.closed = true;
  }
}
