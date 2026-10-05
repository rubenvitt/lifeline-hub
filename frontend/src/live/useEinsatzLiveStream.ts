import { hashKey, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { spieleAlarmTon } from '../alarm/alarmTon';
import { EINSATZ_KEYS, EINSATZ_STREAM_EVENTS, einsatzKeys } from '../api/queryKeys';
import { meldeEinsatzStrom } from './einsatzStromStore';
import { oeffneLiveVerbindung } from './liveVerbindung';
import { invalidiereOrgLiveKeys, orgListener } from './orgListener';

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
 *
 * Der Strom trägt auch die Org-Ereignisse `einsatzliste` und `stammdaten` (LFH-734): im Einsatz
 * bleibt es bei dieser einen Verbindung, der Org-Strom `/api/live` ruht so lange
 * (`einsatzStromStore.ts`). `lagged` und jeder Wiederaufbau frischen auch die Org-Keys auf.
 * Verbindungsbau, Backoff und Status: `liveVerbindung.ts`.
 */
export function useEinsatzLiveStream(einsatzId: number): void {
  const qc = useQueryClient();
  useEffect(() => {
    const inval = (key: string) => qc.invalidateQueries({ queryKey: [key, einsatzId] });
    const invalAlle = (keys: readonly string[]) => keys.forEach(inval);

    const listeners: [string, EventListener][] = Object.entries(EINSATZ_STREAM_EVENTS).map(
      ([event, keys]) => [event, () => invalAlle(keys)],
    );

    // lagged (Reconnect/Overflow) → alle Registry-Keys refetchen. Bewusst OHNE Ton, sonst
    // Fehlalarm ohne neue Sofortmeldung.
    const alleKeys = [...new Set(Object.values(EINSATZ_STREAM_EVENTS).flat())];
    const vollabgleich = () => {
      invalAlle(alleKeys);
      invalidiereOrgLiveKeys(qc);
    };
    listeners.push(['lagged', vollabgleich]);
    // Org-Ereignisse auf derselben Verbindung (LFH-734).
    listeners.push(...orgListener(qc));

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

    // Endzustand (LFH-732, LFH-910): bei gültiger Sitzung fragt eine zweite Probe den Einsatz
    // selbst ab. Die Detailroute steht hinter demselben Lese-Gate wie `/live`
    // (`EinsatzLesezugriff`), ihr Status ist also der des Feeds. Ein 404 (hart gelöscht, etwa beim
    // Entfernen der Demo-Daten, oder vom Aufbewahrungs-Purge) und ein 403 (Mitgliedschaft
    // entzogen, Lesefrist abgelaufen) sind kein Netzproblem: dann kein Reconnect mehr. Beide
    // behandelt auch der Query-Cache am Einsatzkopf gleich (`api/queryClient.ts`,
    // `raeumeNachRechteentzug`).
    const einsatzUnerreichbar = async (): Promise<boolean> => {
      try {
        const res = await fetch(`/api/einsaetze/${einsatzId}`, {
          credentials: 'same-origin',
          signal: AbortSignal.timeout(15_000),
        });
        return res.status === 404 || res.status === 403;
      } catch {
        // Netzfehler → kein Beleg für einen Endzustand, weiter per Backoff.
        return false;
      }
    };

    // Ein 403 kann sich umkehren (Zugriff wieder gewährt). Dann lädt der Einsatzkopf wieder,
    // etwa über „Wiederholen" in der Sackgasse, und der Rahmen zeigt den Einsatz — ohne
    // Neustart stünde er still ohne Live-Feed da, und die Betriebszeile sagte es nicht (`idle`).
    // Erst ein ABGERUFENER Kopf belegt den Zugriff, ein von Hand gesetzter (`manual`) nicht.
    const kopfHash = hashKey(einsatzKeys.einsatz(einsatzId));
    let schliessen: () => void = () => {};
    let wartenBeenden: (() => void) | null = null;
    const aufWiedergewaehrenWarten = () => {
      wartenBeenden = qc.getQueryCache().subscribe((ereignis) => {
        if (
          ereignis.type !== 'updated' ||
          ereignis.action.type !== 'success' ||
          ereignis.action.manual === true ||
          ereignis.query.queryHash !== kopfHash
        ) {
          return;
        }
        wartenBeenden?.();
        wartenBeenden = null;
        // Zwischen Endzustand und Neustart sind Ereignisse verloren: der Erst-Open dieser
        // Verbindung gleicht deshalb ab wie ein Wiederaufbau.
        verbinde(vollabgleich);
      });
    };

    // Reconnect-Resync: jeder Folge-Open gleicht ab wie `lagged`. Der Erst-Open lädt nur die
    // Org-Keys nach (die Einsatz-Abfragen laden beim Mount ohnehin): ein Org-Ereignis kann beim
    // Wechsel aus dem Org-Strom zwischen beiden Verbindungen verloren gehen (LFH-734).
    const verbinde = (beimErstenOpen: () => void) => {
      schliessen = oeffneLiveVerbindung({
        url: `/api/einsaetze/${einsatzId}/live`,
        listeners,
        beiWiederaufbau: vollabgleich,
        beimErstenOpen,
        istEndzustand: einsatzUnerreichbar,
        beiEndzustand: () => {
          aufWiedergewaehrenWarten();
          // Den Weg in die Sackgasse öffnet der neu geholte Einsatzkopf, dessen 403/404
          // `EinsatzLayout` dorthin führt.
          inval(EINSATZ_KEYS.einsatz);
        },
      });
    };
    verbinde(() => invalidiereOrgLiveKeys(qc));
    const abmelden = meldeEinsatzStrom();
    return () => {
      wartenBeenden?.();
      schliessen();
      abmelden();
    };
  }, [einsatzId, qc]);
}
