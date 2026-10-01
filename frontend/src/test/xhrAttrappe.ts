import { vi } from 'vitest';

/**
 * Attrappe für `XMLHttpRequest` (LFH-654). jsdom und msw melden keinen echten
 * Upload-Fortschritt; die Tests von `apiUploadMitFortschritt` steuern ihn deshalb von Hand.
 *
 * `installiereXhrAttrappe()` ersetzt den globalen Konstruktor (`vi.stubGlobal`) und liefert die
 * Liste der erzeugten Anfragen. Aufräumen über `vi.unstubAllGlobals()`.
 */
export class XhrAttrappe extends EventTarget {
  readonly upload = new EventTarget();
  methode = '';
  url = '';
  koepfe: Record<string, string> = {};
  body: unknown = undefined;
  timeout = 0;
  withCredentials = false;
  status = 0;
  responseText = '';
  gesendet = false;

  open(methode: string, url: string) {
    this.methode = methode;
    this.url = url;
  }

  setRequestHeader(name: string, wert: string) {
    this.koepfe[name] = wert;
  }

  send(body: unknown) {
    this.body = body;
    this.gesendet = true;
  }

  // ── Steuerung aus dem Test ──
  fortschritt(loaded: number, total: number, lengthComputable = true) {
    this.upload.dispatchEvent(
      Object.assign(new Event('progress'), { loaded, total, lengthComputable }),
    );
  }

  /** Letztes Byte übertragen — der Server prüft ab jetzt. */
  uebertragen() {
    this.upload.dispatchEvent(new Event('load'));
  }

  antworten(status: number, body: unknown) {
    this.status = status;
    this.responseText = typeof body === 'string' ? body : JSON.stringify(body);
    this.dispatchEvent(new Event('load'));
  }

  netzfehler() {
    this.dispatchEvent(new Event('error'));
  }

  zeitlimit() {
    this.dispatchEvent(new Event('timeout'));
  }
}

export function installiereXhrAttrappe(): XhrAttrappe[] {
  const anfragen: XhrAttrappe[] = [];
  vi.stubGlobal(
    'XMLHttpRequest',
    class extends XhrAttrappe {
      constructor() {
        super();
        anfragen.push(this);
      }
    },
  );
  return anfragen;
}
