import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { spieleAlarmTon } from '../alarm/alarmTon';
import { EINSATZ_KEYS, EINSATZ_STREAM_EVENTS } from '../api/queryKeys';

/**
 * EINE SSE-Verbindung für den gesamten Einsatz-Live-Feed.
 *
 * Der Backend-`LiveHub` multiplext ALLE Event-Typen (uhs, person, schaden, einheit,
 * fahrzeug, abschnitt, lage_zone, …) auf EINEN broadcast-Kanal pro Einsatz; jede
 * `…/stream`-Route leitet den kompletten Kanal verbatim weiter. Deshalb genügt EINE
 * Verbindung (`/etb/stream` als kanonischer Einsatz-Feed); client-seitig wird nach
 * Event-Name auf die betroffenen Query-Keys verteilt.
 *
 * WICHTIG (Grund für die Konsolidierung): Pro Domäne eine eigene `EventSource` zu
 * öffnen, sprengt das HTTP/1.1-Limit von 6 Verbindungen je Origin. Sind alle 6 von
 * langlebigen SSE belegt, hängt JEDER weitere Request (z. B. ein POST zum Anlegen
 * einer Zone) endlos — die Mutation persistiert nie und die Karte aktualisiert nicht.
 * Diese eine Verbindung hält die Lagekarte sicher unter dem Limit.
 *
 * LFH-122: Listener, Invalidierung UND der lagged-Vollabgleich werden aus dem zentralen
 * Registry `EINSATZ_STREAM_EVENTS` (siehe `api/queryKeys.ts`) ABGELEITET — statt an drei
 * Stellen (Handler-Definition, add/removeEventListener, lagged-Liste) manuell gepflegt zu
 * werden. Ein neues Live-Modul ist damit EIN Map-Eintrag, kein Dreifach-Edit, das man
 * vergessen kann. Ausnahmen mit Seiteneffekt (`sofortmeldung`) bzw. Sonderlogik (`lagged`)
 * bleiben bewusst als expliziter Code hier.
 */
/** Verbindungsstatus des Live-Feeds — via window-CustomEvent `lfh:live-status` an einen
 *  sichtbaren Indikator (LiveStatusBanner im EinsatzLayout) gemeldet, damit der Hook
 *  render-state-frei und EINE EventSource bleibt. */
export type LiveVerbindungsStatus = 'open' | 'connecting' | 'lost';

/** Exponentieller Backoff (ms) für den manuellen Reconnect, wenn der Browser aufgibt
 *  (readyState CLOSED) und die Session noch gültig ist. */
const RECONNECT_BACKOFF_MS = [1000, 3000, 10000, 30000];

export function useEinsatzLiveStream(einsatzId: number): void {
  const qc = useQueryClient();
  useEffect(() => {
    if (!Number.isFinite(einsatzId)) return;
    const inval = (key: string) => qc.invalidateQueries({ queryKey: [key, einsatzId] });
    const invalAlle = (keys: readonly string[]) => keys.forEach(inval);
    const meldeStatus = (status: LiveVerbindungsStatus) =>
      window.dispatchEvent(new CustomEvent('lfh:live-status', { detail: { status } }));

    // Aus dem Registry abgeleitet: je Wire-Event ein Handler, der die deklarierten Keys
    // invalidiert.
    const listeners: [string, EventListener][] = Object.entries(EINSATZ_STREAM_EVENTS).map(
      ([event, keys]) => [event, () => invalAlle(keys)],
    );

    // lagged (Reconnect/Overflow) → konservativ ALLE Registry-Keys refetchen (dedupliziert).
    // Bewusst OHNE Ton — sonst Fehlalarm ohne neue Sofortmeldung; der Refetch + die
    // persistente Server-Hervorhebung (ist_ueberfaellig/eskaliert) tragen.
    const alleKeys = [...new Set(Object.values(EINSATZ_STREAM_EVENTS).flat())];
    listeners.push(['lagged', () => invalAlle(alleKeys)]);

    // Sofortmeldung (LFH-97): Escape-Hatch mit Seiteneffekten — Meldungs-Listen aktualisieren
    // UND unübersehbar alarmieren (Ton + Toast). Der Toast wird einsatzweit über ein
    // window-CustomEvent aufgelöst (AlarmZentrale im Layout lauscht), damit der Hook ohne
    // Render-State auskommt und EINE EventSource bleibt. NICHT im lagged-Fan-out.
    const onSofort = (ev: MessageEvent) => {
      invalAlle(EINSATZ_STREAM_EVENTS.meldung);
      spieleAlarmTon('alarm');
      let detail: unknown = {};
      try { detail = JSON.parse(ev.data); } catch { /* Payload optional */ }
      window.dispatchEvent(new CustomEvent('lfh:sofortmeldung', { detail }));
    };
    listeners.push(['sofortmeldung', onSofort as EventListener]);

    // Erinnerung-Side-Effect (LFH-118): NEBEN der Registry-Invalidierung (deckt 'erinnerung'
    // bereits ab) alarmiert dieser zweite Listener abgestuft und modulübergreifend. bezug_typ
    // ist der Diskriminator: 'meldung' wird übersprungen (der sofortmeldung-Pfad alarmiert diese
    // Meldung schon → kein Doppel-Alarm), 'auftrag' → Alarmton + auftraege-Invalidierung, sonst
    // dezenter Ton. Der Toast wird einsatzweit über ein window-CustomEvent aufgelöst (AlarmZentrale
    // lauscht) — der Hook bleibt render-state-frei und EINE EventSource.
    const onErinnerung = (ev: MessageEvent) => {
      let detail: {
        einsatz_id?: number;
        erinnerung_id?: number;
        bezug_typ?: 'auftrag' | 'meldung' | 'etb' | null;
        bezug_id?: number | null;
      } = {};
      try { detail = JSON.parse(ev.data); } catch { /* Payload optional */ }
      // Nur scheduler-gefeuerte Fälligkeit alarmiert: die CRUD-Route (routes/erinnerung.rs) sendet
      // dasselbe `erinnerung`-Event mit nur {einsatz_id} als Listen-Refresh — ohne erinnerung_id.
      // Die Registry-Invalidierung von einsatz-erinnerungen (separater Listener) trägt diesen Fall.
      if (detail.erinnerung_id == null) return;
      if (detail.bezug_typ === 'meldung') return; // Doppel-Alarm-Guard
      if (detail.bezug_typ === 'auftrag') {
        spieleAlarmTon('alarm');
        inval(EINSATZ_KEYS.auftraege);
      } else {
        spieleAlarmTon('dezent');
      }
      window.dispatchEvent(new CustomEvent('lfh:erinnerung-alarm', { detail }));
    };
    listeners.push(['erinnerung', onErinnerung as EventListener]);

    // Reconnect-Resync + sichtbarer Fehlerpfad (F14/LFH-263):
    // - `ersterOpen` ist EFFEKT-lokal (kein useRef): pro Verbindung/Mount neu, sonst würde ein
    //   StrictMode-/e2e-Doppelmount den Erst-Open des zweiten Mounts fälschlich als Reconnect
    //   invalidieren. Erst-Open = frischer GET hat die Lage schon → kein Voll-Invalidate; jeder
    //   FOLGE-Open (Browser-Auto-Reconnect ODER manueller Reconnect) resynct wie `lagged`.
    // - `onerror` bei readyState CONNECTING → der Browser reconnectet selbst (nur Status melden);
    //   bei CLOSED hat der Browser aufgegeben (typisch non-200, z. B. 401) → Auth proben und
    //   entweder in den Login-Flow (401) oder per Backoff manuell neu verbinden.
    let ersterOpen = true;
    let abgebrochen = false;
    let backoffStufe = 0;
    let backoffTimer: ReturnType<typeof setTimeout> | null = null;
    let aktuelle: EventSource | null = null;

    const probeUndReconnect = async (tote: EventSource) => {
      if (abgebrochen) return;
      let sessionGueltig = true;
      try {
        const res = await fetch('/api/auth/me', { credentials: 'same-origin' });
        if (res.status === 401) sessionGueltig = false;
      } catch {
        // Netzfehler bei der Probe → Session-Status unbekannt, wie gültig behandeln und
        // per Backoff weiter versuchen (der nächste Reconnect deckt einen echten 401 auf).
      }
      if (abgebrochen) return;
      if (!sessionGueltig) {
        // Session abgelaufen → der Browser reconnectet nicht selbst; Login-Flow übernimmt.
        window.dispatchEvent(new CustomEvent('lfh:live-auth-verloren'));
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
      const quelle = new EventSource(`/api/einsaetze/${einsatzId}/etb/stream`);
      aktuelle = quelle;
      listeners.forEach(([event, handler]) => quelle.addEventListener(event, handler));
      quelle.onopen = () => {
        meldeStatus('open');
        backoffStufe = 0;
        if (ersterOpen) {
          ersterOpen = false;
        } else {
          // Reconnect (Browser-Auto oder manuell): verpasste Events sind möglich → Voll-Resync
          // über alle Registry-Keys, wie `lagged` (bewusst ohne Ton).
          invalAlle(alleKeys);
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
        listeners.forEach(([event, handler]) => aktuelle!.removeEventListener(event, handler));
        aktuelle.onopen = null;
        aktuelle.onerror = null;
        aktuelle.close();
      }
    };
  }, [einsatzId, qc]);
}
