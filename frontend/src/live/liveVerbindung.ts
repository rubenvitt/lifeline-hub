import { meldeSitzungAbgelaufen } from '../auth/sitzungsEvent';

/**
 * Verbindungsstatus des Live-Feeds, gemeldet per window-CustomEvent `lfh:live-status`, damit
 * die Hooks render-state-frei und bei EINER EventSource bleiben. Es ist immer höchstens ein
 * Strom offen (Einsatz-Strom oder Org-Strom, LFH-734), der Status ist also eindeutig.
 */
export type LiveVerbindungsStatus = 'idle' | 'open' | 'connecting' | 'lost';

/** Exponentieller Backoff (ms) für den manuellen Reconnect, wenn der Browser aufgibt
    (readyState CLOSED) und die Session noch gültig ist. Jede Stufe bekommt einen Zufallsaufschlag
    bis {@link RECONNECT_STREUUNG}, damit Tabs nach einem Neustart verteilt zurückkommen (LFH-922). */
const RECONNECT_BACKOFF_MS = [1000, 3000, 10000, 30000];
const RECONNECT_STREUUNG = 0.5;

/**
 * Schonfrist, bevor ein Neuverbinden des Browsers als „wird wiederhergestellt“ sichtbar wird
 * (LFH-922, design.md D5). Liegt über dem längsten `retry:` des Servers (5 s, LFH-920) plus
 * Verbindungsaufbau: das planmäßige Ende eines Stroms und ein kurzer Funkabriss bleiben so
 * unsichtbar. „Unterbrochen“ (der Browser gibt auf) erscheint weiter sofort.
 */
export const WIEDERAUFBAU_SCHONFRIST_MS = 8000;

export interface LiveVerbindungOptionen {
  url: string;
  /** Ereignisname → Handler; angehängt an jede (auch jede neu aufgebaute) EventSource. */
  listeners: readonly (readonly [string, EventListener])[];
  /**
   * Läuft nach dem `open` einer neuen Verbindung (manueller Neuaufbau nach CLOSED): sie hat keine
   * `Last-Event-ID`, verpasste Ereignisse sind möglich, also Vollabgleich wie bei `lagged`, ohne Ton.
   */
  beiWiederaufbau: () => void;
  /**
   * Läuft, wenn der Browser dieselbe `EventSource` neu verbunden hat (LFH-922, design.md D3). Er
   * schickt die zuletzt bekannte `Last-Event-ID`, der Server liefert nach oder meldet `lagged`.
   * Vorgabe: {@link beiWiederaufbau}.
   */
  beiNachlieferung?: () => void;
  /**
   * Läuft nur beim ersten `open`. Beim Wechsel zwischen Einsatz- und Org-Strom (LFH-734) kann
   * ein Org-Ereignis zwischen beiden Verbindungen verloren gehen; der neue Strom gleicht deshalb
   * gleich zu Beginn die Org-Keys ab (`openspec/changes/archive/2026-10-01-lfh-734-org-live-ereignis/design.md`, D4).
   */
  beimErstenOpen?: () => void;
  /**
   * Nach einem CLOSED-Fehler bei gültiger Sitzung: ist das Ziel endgültig weg (LFH-732, etwa ein
   * gelöschter Einsatz)? Dann kein Reconnect, Status `idle` statt `lost` und `beiEndzustand`.
   */
  istEndzustand?: () => Promise<boolean>;
  beiEndzustand?: () => void;
}

/**
 * Öffnet EINE Live-Verbindung samt sichtbarem Fehlerpfad und liefert die Aufräumfunktion.
 * Gemeinsamer Bau für den Einsatz-Strom und den Org-Strom (LFH-734).
 *
 * - `ersterOpen` ist lokal in diesem Aufruf (im Effekt, kein useRef), sonst hielte ein
 *   StrictMode-Doppelmount den Erst-Open des zweiten Mounts für einen Reconnect.
 * - `onerror` bei CONNECTING → der Browser reconnectet selbst, `connecting` erst nach der
 *   {@link WIEDERAUFBAU_SCHONFRIST_MS}; bei CLOSED hat er aufgegeben (typisch 401) → sofort
 *   `lost`, Auth proben, dann Login-Flow (401) oder manueller Reconnect per Backoff.
 * - Beim Aufräumen meldet sie `idle`: die Betriebszeile bleibt global gemountet, und ohne `idle`
 *   stünde ein früheres `lost` nach dem Verlassen des Stroms weiter da.
 */
export function oeffneLiveVerbindung(opt: LiveVerbindungOptionen): () => void {
  const meldeStatus = (status: LiveVerbindungsStatus) =>
    window.dispatchEvent(new CustomEvent('lfh:live-status', { detail: { status } }));

  let ersterOpen = true;
  let abgebrochen = false;
  let backoffStufe = 0;
  let backoffTimer: ReturnType<typeof setTimeout> | null = null;
  let schonfristTimer: ReturnType<typeof setTimeout> | null = null;
  let aktuelle: EventSource | null = null;

  const schonfristBeenden = () => {
    if (schonfristTimer) clearTimeout(schonfristTimer);
    schonfristTimer = null;
  };

  const probeUndReconnect = async (tote: EventSource) => {
    if (abgebrochen) return;
    let sessionGueltig = true;
    try {
      const res = await fetch('/api/auth/me', {
        credentials: 'same-origin',
        signal: AbortSignal.timeout(15_000),
      });
      if (res.status === 401) sessionGueltig = false;
    } catch {
      // Netzfehler bei der Probe → wie gültige Session behandeln und per Backoff weiter versuchen.
    }
    if (abgebrochen) return;
    if (!sessionGueltig) {
      // Session abgelaufen → die Sitzungswache übernimmt (ein 401-Pfad für SSE und HTTP).
      meldeSitzungAbgelaufen();
      return;
    }
    if (opt.istEndzustand) {
      const weg = await opt.istEndzustand();
      if (abgebrochen) return;
      if (weg) {
        tote.close();
        // `idle` statt `lost`: die Seite sagt den Fehler, die Betriebszeile soll keine
        // unterbrochene Leitung danebenstellen (LFH-331 · B3).
        meldeStatus('idle');
        opt.beiEndzustand?.();
        return;
      }
    }
    tote.close();
    const basis = RECONNECT_BACKOFF_MS[Math.min(backoffStufe, RECONNECT_BACKOFF_MS.length - 1)];
    const wartezeit = Math.round(basis * (1 + Math.random() * RECONNECT_STREUUNG));
    backoffStufe += 1;
    backoffTimer = setTimeout(() => {
      if (!abgebrochen) verbinde();
    }, wartezeit);
  };

  const verbinde = () => {
    const quelle = new EventSource(opt.url);
    aktuelle = quelle;
    // Hat DIESE Quelle schon einmal geöffnet? Dann ist der nächste `open` ein Neuaufbau des
    // Browsers mit `Last-Event-ID`, kein neuer Strom.
    let quelleWarOffen = false;
    opt.listeners.forEach(([event, handler]) => quelle.addEventListener(event, handler));
    quelle.onopen = () => {
      schonfristBeenden();
      meldeStatus('open');
      backoffStufe = 0;
      if (ersterOpen) {
        ersterOpen = false;
        opt.beimErstenOpen?.();
      } else if (quelleWarOffen) {
        (opt.beiNachlieferung ?? opt.beiWiederaufbau)();
      } else {
        opt.beiWiederaufbau();
      }
      quelleWarOffen = true;
    };
    quelle.onerror = () => {
      if (quelle.readyState === EventSource.CONNECTING) {
        // Browser reconnectet selbst; sichtbar erst, wenn es länger dauert. Weitere Fehlversuche
        // verlängern die Frist nicht.
        schonfristTimer ??= setTimeout(() => {
          schonfristTimer = null;
          meldeStatus('connecting');
        }, WIEDERAUFBAU_SCHONFRIST_MS);
      } else if (quelle.readyState === EventSource.CLOSED) {
        schonfristBeenden();
        meldeStatus('lost');
        void probeUndReconnect(quelle);
      }
    };
  };

  verbinde();

  return () => {
    abgebrochen = true;
    if (backoffTimer) clearTimeout(backoffTimer);
    schonfristBeenden();
    if (aktuelle) {
      opt.listeners.forEach(([event, handler]) => aktuelle!.removeEventListener(event, handler));
      aktuelle.onopen = null;
      aktuelle.onerror = null;
      aktuelle.close();
    }
    meldeStatus('idle');
  };
}
