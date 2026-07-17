import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { spieleAlarmTon } from '../einsatz/alarmTon';
import { EINSATZ_STREAM_EVENTS } from '../api/queryKeys';

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
export function useEinsatzLiveStream(einsatzId: number): void {
  const qc = useQueryClient();
  useEffect(() => {
    if (!Number.isFinite(einsatzId)) return;
    const quelle = new EventSource(`/api/einsaetze/${einsatzId}/etb/stream`);
    const inval = (key: string) => qc.invalidateQueries({ queryKey: [key, einsatzId] });
    const invalAlle = (keys: readonly string[]) => keys.forEach(inval);

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
    // window-CustomEvent aufgelöst (SofortAlarm im Layout lauscht), damit der Hook ohne
    // Render-State auskommt und EINE EventSource bleibt. NICHT im lagged-Fan-out.
    const onSofort = (ev: MessageEvent) => {
      invalAlle(EINSATZ_STREAM_EVENTS.meldung);
      spieleAlarmTon('alarm');
      let detail: unknown = {};
      try { detail = JSON.parse(ev.data); } catch { /* Payload optional */ }
      window.dispatchEvent(new CustomEvent('lfh:sofortmeldung', { detail }));
    };
    listeners.push(['sofortmeldung', onSofort as EventListener]);

    listeners.forEach(([event, handler]) => quelle.addEventListener(event, handler));
    return () => {
      listeners.forEach(([event, handler]) => quelle.removeEventListener(event, handler));
      quelle.close();
    };
  }, [einsatzId, qc]);
}
