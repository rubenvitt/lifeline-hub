import { meldeSitzungAbgelaufen } from '../auth/sitzungsEvent';

/**
 * Verbindungsstatus des Live-Feeds, gemeldet per window-CustomEvent `lfh:live-status`, damit
 * die Hooks render-state-frei und bei EINER EventSource bleiben. Es ist immer höchstens ein
 * Strom offen (Einsatz-Strom oder Org-Strom, LFH-734), der Status ist also eindeutig.
 */
export type LiveVerbindungsStatus = 'idle' | 'open' | 'connecting' | 'lost';

/** Exponentieller Backoff (ms) für den manuellen Reconnect, wenn der Browser aufgibt
    (readyState CLOSED) und die Session noch gültig ist. */
const RECONNECT_BACKOFF_MS = [1000, 3000, 10000, 30000];

export interface LiveVerbindungOptionen {
  url: string;
  /** Ereignisname → Handler; angehängt an jede (auch jede neu aufgebaute) EventSource. */
  listeners: readonly (readonly [string, EventListener])[];
  /**
   * Läuft nach jedem `open` außer dem ersten: verpasste Ereignisse sind möglich, also
   * Vollabgleich wie bei `lagged`, ohne Ton.
   */
  beiWiederaufbau: () => void;
  /**
   * Läuft nur beim ersten `open`. Beim Wechsel zwischen Einsatz- und Org-Strom (LFH-734) kann
   * ein Org-Ereignis zwischen beiden Verbindungen verloren gehen; der neue Strom gleicht deshalb
   * gleich zu Beginn die Org-Keys ab (design.md D4 der Change `lfh-734-org-live-ereignis`).
   */
  beimErstenOpen?: () => void;
}

/**
 * Öffnet EINE Live-Verbindung samt sichtbarem Fehlerpfad und liefert die Aufräumfunktion.
 * Gemeinsamer Bau für den Einsatz-Strom und den Org-Strom (LFH-734).
 *
 * - `ersterOpen` ist lokal in diesem Aufruf (im Effekt, kein useRef), sonst hielte ein
 *   StrictMode-Doppelmount den Erst-Open des zweiten Mounts für einen Reconnect.
 * - `onerror` bei CONNECTING → der Browser reconnectet selbst; bei CLOSED hat er aufgegeben
 *   (typisch 401) → Auth proben, dann Login-Flow (401) oder manueller Reconnect per Backoff.
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
  let aktuelle: EventSource | null = null;

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
    tote.close();
    const wartezeit = RECONNECT_BACKOFF_MS[Math.min(backoffStufe, RECONNECT_BACKOFF_MS.length - 1)];
    backoffStufe += 1;
    backoffTimer = setTimeout(() => {
      if (!abgebrochen) verbinde();
    }, wartezeit);
  };

  const verbinde = () => {
    const quelle = new EventSource(opt.url);
    aktuelle = quelle;
    opt.listeners.forEach(([event, handler]) => quelle.addEventListener(event, handler));
    quelle.onopen = () => {
      meldeStatus('open');
      backoffStufe = 0;
      if (ersterOpen) {
        ersterOpen = false;
        opt.beimErstenOpen?.();
      } else {
        opt.beiWiederaufbau();
      }
    };
    quelle.onerror = () => {
      if (quelle.readyState === EventSource.CONNECTING) {
        meldeStatus('connecting'); // Browser reconnectet selbst
      } else if (quelle.readyState === EventSource.CLOSED) {
        meldeStatus('lost');
        void probeUndReconnect(quelle);
      }
    };
  };

  verbinde();

  return () => {
    abgebrochen = true;
    if (backoffTimer) clearTimeout(backoffTimer);
    if (aktuelle) {
      opt.listeners.forEach(([event, handler]) => aktuelle!.removeEventListener(event, handler));
      aktuelle.onopen = null;
      aktuelle.onerror = null;
      aktuelle.close();
    }
    meldeStatus('idle');
  };
}
