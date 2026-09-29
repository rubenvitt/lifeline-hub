import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { spieleAlarmTon } from '../alarm/alarmTon';
import { EINSATZ_KEYS, EINSATZ_STREAM_EVENTS } from '../api/queryKeys';
import { meldeSitzungAbgelaufen } from '../auth/sitzungsEvent';

/**
 * EINE SSE-Verbindung für den gesamten Einsatz-Live-Feed.
 *
 * Der Backend-`LiveHub` multiplext alle Event-Typen auf einen Kanal pro Einsatz; clientseitig
 * wird nach Event-Name auf die Query-Keys verteilt.
 *
 * Warum EINE Verbindung: je Domäne eine `EventSource` sprengt das HTTP/1.1-Limit von 6
 * Verbindungen je Origin, danach hängt JEDER weitere Request (z. B. ein POST) endlos. Das Limit
 * gilt pro Origin über alle Tabs; dagegen hilft `--tls` (HTTP/2, `docs/betrieb-tls.md`),
 * tab-übergreifendes Teilen ist offen (LFH-264).
 *
 * Listener, Invalidierung und lagged-Vollabgleich werden aus `EINSATZ_STREAM_EVENTS`
 * (`api/queryKeys.ts`) abgeleitet; ein neues Live-Modul ist ein Map-Eintrag. Nur Ereignisse
 * mit Seiteneffekt (`sofortmeldung`, Erinnerung, Ablösung) und `lagged` stehen explizit hier.
 */
/**
 * Verbindungsstatus des Live-Feeds, gemeldet per window-CustomEvent `lfh:live-status`, damit
 * der Hook render-state-frei und EINE EventSource bleibt.
 */
export type LiveVerbindungsStatus = 'idle' | 'open' | 'connecting' | 'lost';

/** Exponentieller Backoff (ms) für den manuellen Reconnect, wenn der Browser aufgibt
    (readyState CLOSED) und die Session noch gültig ist. */
const RECONNECT_BACKOFF_MS = [1000, 3000, 10000, 30000];

export function useEinsatzLiveStream(einsatzId: number): void {
  const qc = useQueryClient();
  useEffect(() => {
    const inval = (key: string) => qc.invalidateQueries({ queryKey: [key, einsatzId] });
    const invalAlle = (keys: readonly string[]) => keys.forEach(inval);
    const meldeStatus = (status: LiveVerbindungsStatus) =>
      window.dispatchEvent(new CustomEvent('lfh:live-status', { detail: { status } }));

    const listeners: [string, EventListener][] = Object.entries(EINSATZ_STREAM_EVENTS).map(
      ([event, keys]) => [event, () => invalAlle(keys)],
    );

    // lagged (Reconnect/Overflow) → alle Registry-Keys refetchen. Bewusst OHNE Ton, sonst
    // Fehlalarm ohne neue Sofortmeldung.
    const alleKeys = [...new Set(Object.values(EINSATZ_STREAM_EVENTS).flat())];
    listeners.push(['lagged', () => invalAlle(alleKeys)]);

    // Sofortmeldung: Listen aktualisieren UND alarmieren (Ton + Toast). Der Toast läuft über ein
    // window-CustomEvent (AlarmZentrale im Layout). NICHT im lagged-Fan-out.
    const onSofort = (ev: MessageEvent) => {
      invalAlle(EINSATZ_STREAM_EVENTS.meldung);
      spieleAlarmTon('alarm');
      let detail: unknown = {};
      try {
        detail = JSON.parse(ev.data);
      } catch {
        /* Payload optional */
      }
      window.dispatchEvent(new CustomEvent('lfh:sofortmeldung', { detail }));
    };
    listeners.push(['sofortmeldung', onSofort as EventListener]);

    // Erinnerung: zusätzlich zur Registry-Invalidierung abgestuft alarmieren. `bezug_typ`
    // 'meldung' wird übersprungen (der sofortmeldung-Pfad alarmiert schon), 'auftrag' → Alarmton +
    // auftraege-Invalidierung, sonst dezent. Toast über window-CustomEvent (AlarmZentrale).
    const onErinnerung = (ev: MessageEvent) => {
      let detail: {
        einsatz_id?: number;
        erinnerung_id?: number;
        bezug_typ?: 'auftrag' | 'meldung' | 'etb' | 'abloesung' | 'abloesung_vorwarnung' | null;
        bezug_id?: number | null;
      } = {};
      try {
        detail = JSON.parse(ev.data);
      } catch {
        /* Payload optional */
      }
      // Nur scheduler-gefeuerte Fälligkeit alarmiert; die CRUD-Route sendet dasselbe Event ohne
      // `erinnerung_id` als reinen Listen-Refresh.
      if (detail.erinnerung_id == null) return;
      if (detail.bezug_typ === 'meldung') return; // Doppel-Alarm-Guard
      // Ablösungsfristen alarmieren über das eigene `abloesung`-Ereignis, hier nicht ein zweites Mal.
      if (detail.bezug_typ === 'abloesung' || detail.bezug_typ === 'abloesung_vorwarnung') return;
      if (detail.bezug_typ === 'auftrag') {
        spieleAlarmTon('alarm');
        inval(EINSATZ_KEYS.auftraege);
      } else {
        spieleAlarmTon('dezent');
      }
      window.dispatchEvent(new CustomEvent('lfh:erinnerung-alarm', { detail }));
    };
    listeners.push(['erinnerung', onErinnerung as EventListener]);

    // Ablösung: alarmiert nur, wenn `art` gesetzt ist — das setzt ausschließlich der Scheduler;
    // die CRUD-Routen senden dasselbe Ereignis nur als Refresh.
    const onAbloesung = (ev: MessageEvent) => {
      let detail: { art?: 'vorwarnung' | 'faellig' } = {};
      try {
        detail = JSON.parse(ev.data);
      } catch {
        /* Payload optional */
      }
      if (detail.art !== 'vorwarnung' && detail.art !== 'faellig') return;
      spieleAlarmTon(detail.art === 'faellig' ? 'alarm' : 'dezent');
      window.dispatchEvent(new CustomEvent('lfh:abloesung-alarm', { detail }));
    };
    listeners.push(['abloesung', onAbloesung as EventListener]);

    // Reconnect-Resync + sichtbarer Fehlerpfad:
    // - `ersterOpen` ist EFFEKT-lokal (kein useRef), sonst hielte ein StrictMode-Doppelmount den
    //   Erst-Open des zweiten Mounts für einen Reconnect. Der Erst-Open invalidiert nicht; jeder
    //   Folge-Open resynct wie `lagged`.
    // - `onerror` bei CONNECTING → der Browser reconnectet selbst; bei CLOSED hat er aufgegeben
    //   (typisch 401) → Auth proben, dann Login-Flow (401) oder manueller Reconnect per Backoff.
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
      const wartezeit =
        RECONNECT_BACKOFF_MS[Math.min(backoffStufe, RECONNECT_BACKOFF_MS.length - 1)];
      backoffStufe += 1;
      backoffTimer = setTimeout(() => {
        if (!abgebrochen) verbinde();
      }, wartezeit);
    };

    const verbinde = () => {
      const quelle = new EventSource(`/api/einsaetze/${einsatzId}/live`);
      aktuelle = quelle;
      listeners.forEach(([event, handler]) => quelle.addEventListener(event, handler));
      quelle.onopen = () => {
        meldeStatus('open');
        backoffStufe = 0;
        if (ersterOpen) {
          ersterOpen = false;
        } else {
          // Reconnect: verpasste Events sind möglich → Voll-Resync wie `lagged`, ohne Ton.
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
      // Die Betriebszeile bleibt global gemountet; ohne `idle` stünde ein früheres `lost` nach
      // Verlassen des Einsatzes auf `/profil` oder `/admin` weiter da.
      meldeStatus('idle');
    };
  }, [einsatzId, qc]);
}
