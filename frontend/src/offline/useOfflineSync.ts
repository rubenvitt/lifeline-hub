import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';
import { ApiError } from '../api/client';
import { erfasseEtb } from '../api/etb';
import { legePersonAn } from '../api/einsatzPerson';
import { legeMeldungAn } from '../api/meldungen';
import { einsatzKeys } from '../api/queryKeys';
import type { Person } from '../api/types';
import { meldeSitzungAbgelaufen } from '../auth/sitzungsEvent';
import { meldeOfflineSchreibaktionGesendet } from './ereignisse';
import { istOfflineTransient } from './fehler';
import {
  OFFLINE_QUEUE_EVENT,
  queueAblehnen,
  queueAlleLaden,
  queueEntfernen,
  queueLaden,
  schreibaktionAblehnen,
  schreibaktionEntfernen,
  schreibaktionPersonAbschliessen,
  schreibaktionenLaden,
  type AusstehendeSchreibaktion,
  type AusstehenderEintrag,
} from './queue';

const BACKOFF_MS = [1_000, 5_000, 15_000, 30_000];

type QueueElement =
  | { art: 'etb'; wert: AusstehenderEintrag }
  | { art: 'schreiben'; wert: AusstehendeSchreibaktion };

function fehlermeldung(e: unknown): string {
  return e instanceof ApiError ? e.message : 'Abgelehnt';
}

/** Globaler Queue-Flush für genau die aktuell angemeldete, datenbankweit
 * eindeutige Benutzer-ID. Fremde und unzugeordnete Legacy-Zeilen werden weder
 * geladen noch automatisch gesendet. */
export function useOfflineSync(benutzerId?: number): void {
  const qc = useQueryClient();
  const flusht = useRef(false);
  const erneutAngefordert = useRef(false);
  const aktiverBenutzer = useRef(benutzerId);
  aktiverBenutzer.current = benutzerId;
  const montiert = useRef(true);
  const backoffStufe = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushRef = useRef<() => Promise<void>>(async () => {});

  const verarbeiteEinsatz = useCallback(async (
    aktuellerBenutzerId: number,
    elemente: QueueElement[],
  ) => {
    let transientOffen = false;
    for (const element of elemente) {
      if (!montiert.current || aktiverBenutzer.current !== aktuellerBenutzerId) break;
      try {
        if (element.art === 'etb') {
          await erfasseEtb(element.wert.einsatz_id, element.wert.eintrag, {
            offlineQueueBenutzerId: aktuellerBenutzerId,
          });
          if (!montiert.current || aktiverBenutzer.current !== aktuellerBenutzerId) break;
          await queueEntfernen(aktuellerBenutzerId, element.wert.id!);
          void qc.invalidateQueries({ queryKey: einsatzKeys.etb(element.wert.einsatz_id) });
        } else if (element.wert.aktion.art === 'person') {
          const person = await legePersonAn(
            element.wert.einsatz_id,
            element.wert.aktion.daten,
            { offlineQueueBenutzerId: aktuellerBenutzerId },
          );
          if (!montiert.current || aktiverBenutzer.current !== aktuellerBenutzerId) break;
          const quittung = await schreibaktionPersonAbschliessen(
            aktuellerBenutzerId,
            element.wert,
            person,
          );
          // Ein konkurrierender Tab kann dieselbe Pending-Zeile zwischen HTTP-Antwort
          // und Transaktion bereits abgeschlossen haben. Dessen persistente Quittung
          // ist dann die einzige UI-Wahrheit; hier wird kein zweites Signal erzeugt.
          if (!quittung) continue;
          qc.setQueryData<Person[]>(einsatzKeys.personen(element.wert.einsatz_id), (alt) => {
            if (!alt) return alt;
            const ohne = alt.filter((wert) => wert.id !== person.id);
            return [...ohne, person];
          });
          void qc.invalidateQueries({
            queryKey: einsatzKeys.personen(element.wert.einsatz_id),
            refetchType: 'none',
          });
          void qc.invalidateQueries({ queryKey: einsatzKeys.etb(element.wert.einsatz_id) });
          // Der Anlege-Request kann zugleich den UHS-Eintritt enthalten (LFH-458).
          // Auch ohne funktionierenden Live-Stream muss die gerade offene UHS nachladen.
          const uhsId = element.wert.aktion.daten.uhs_id;
          if (uhsId != null) {
            void qc.invalidateQueries({ queryKey: einsatzKeys.uhs(element.wert.einsatz_id) });
            void qc.invalidateQueries({ queryKey: einsatzKeys.uhsDetail(element.wert.einsatz_id, uhsId) });
          }
          meldeOfflineSchreibaktionGesendet({
            art: 'person',
            benutzerId: aktuellerBenutzerId,
            einsatzId: element.wert.einsatz_id,
            clientId: quittung.client_id,
            daten: person,
            sicht: quittung.sicht,
          });
        } else {
          const meldung = await legeMeldungAn(
            element.wert.einsatz_id,
            element.wert.aktion.daten,
            { offlineQueueBenutzerId: aktuellerBenutzerId },
          );
          if (!montiert.current || aktiverBenutzer.current !== aktuellerBenutzerId) break;
          await schreibaktionEntfernen(aktuellerBenutzerId, element.wert.id!);
          void qc.invalidateQueries({ queryKey: einsatzKeys.meldungen(element.wert.einsatz_id) });
          void qc.invalidateQueries({ queryKey: einsatzKeys.etb(element.wert.einsatz_id) });
          const clientId = element.wert.aktion.daten.client_id;
          if (clientId) {
            meldeOfflineSchreibaktionGesendet({
              art: 'meldung',
              benutzerId: aktuellerBenutzerId,
              einsatzId: element.wert.einsatz_id,
              clientId,
              daten: meldung,
            });
          }
        }
      } catch (e) {
        if (!montiert.current || aktiverBenutzer.current !== aktuellerBenutzerId) break;
        if (istOfflineTransient(e)) {
          if (e instanceof ApiError && e.status === 401) meldeSitzungAbgelaufen();
          transientOffen = true;
          break; // Reihenfolge innerhalb eines Einsatzes wahren
        }
        if (element.art === 'etb') {
          await queueAblehnen(aktuellerBenutzerId, element.wert, fehlermeldung(e));
        } else {
          await schreibaktionAblehnen(aktuellerBenutzerId, element.wert, fehlermeldung(e));
        }
      }
    }
    return transientOffen;
  }, [qc]);

  const flush = useCallback(async () => {
    if (!montiert.current || benutzerId == null || !navigator.onLine) return;
    if (flusht.current) {
      erneutAngefordert.current = true;
      return;
    }
    flusht.current = true;
    let transientOffen = false;
    try {
      do {
        erneutAngefordert.current = false;
        if (aktiverBenutzer.current !== benutzerId || !navigator.onLine) break;

        // Diese erste Sicht bestimmt nur die Einsatz-IDs. Die eigentlichen
        // Elemente werden erst nach Erhalt des Cross-Tab-Locks neu geladen.
        const [etb, schreiben] = await Promise.all([
          queueAlleLaden(benutzerId),
          schreibaktionenLaden(benutzerId),
        ]);
        const einsatzIds = new Set([
          ...etb.map((wert) => wert.einsatz_id),
          ...schreiben.map((wert) => wert.einsatz_id),
        ]);

        for (const einsatzId of einsatzIds) {
          const durchlauf = async () => {
            if (!montiert.current || aktiverBenutzer.current !== benutzerId) return false;
            const [aktuelleEtb, aktuelleSchreibaktionen] = await Promise.all([
              queueLaden(benutzerId, einsatzId),
              schreibaktionenLaden(benutzerId, einsatzId),
            ]);
            const elemente: QueueElement[] = [
              ...aktuelleEtb.map((wert): QueueElement => ({ art: 'etb', wert })),
              ...aktuelleSchreibaktionen.map((wert): QueueElement => ({ art: 'schreiben', wert })),
            ];
            elemente.sort((a, b) =>
              a.wert.erstellt_at.localeCompare(b.wert.erstellt_at) ||
              (a.wert.id ?? 0) - (b.wert.id ?? 0));
            return verarbeiteEinsatz(benutzerId, elemente);
          };

          const locks: LockManager | undefined = navigator.locks;
          const einsatzTransient = locks
            ? await locks.request(`offline-flush-${einsatzId}`, durchlauf)
            : await durchlauf();
          // `durchlauf` muss auch ausgeführt werden, wenn ein vorheriger Einsatz
          // transient war; deshalb kein kurzschließendes ||= mit await.
          transientOffen = transientOffen || einsatzTransient;
        }
      } while (
        erneutAngefordert.current &&
        montiert.current &&
        aktiverBenutzer.current === benutzerId &&
        navigator.onLine
      );
    } finally {
      flusht.current = false;
    }

    if (!montiert.current) return;
    if (aktiverBenutzer.current !== benutzerId) {
      void flushRef.current();
      return;
    }
    if (transientOffen) {
      const wartezeit = BACKOFF_MS[Math.min(backoffStufe.current, BACKOFF_MS.length - 1)];
      backoffStufe.current += 1;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flushRef.current(), wartezeit);
    } else {
      backoffStufe.current = 0;
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    }
  }, [benutzerId, verarbeiteEinsatz]);

  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);

  useEffect(() => {
    montiert.current = true;
    return () => {
      montiert.current = false;
    };
  }, []);

  useEffect(() => {
    const anfordern = () => void flushRef.current();
    window.addEventListener('online', anfordern);
    window.addEventListener(OFFLINE_QUEUE_EVENT, anfordern);
    if (navigator.onLine) void flush();
    return () => {
      window.removeEventListener('online', anfordern);
      window.removeEventListener(OFFLINE_QUEUE_EVENT, anfordern);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [flush]);
}
