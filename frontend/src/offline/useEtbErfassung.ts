import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../api/client';
import { erfasseEtb, type NeuerEintrag } from '../api/etb';
import { einsatzKeys } from '../api/queryKeys';
import { meldeSitzungAbgelaufen } from '../auth/sitzungsEvent';
import {
  abgelehntEntfernen,
  abgelehntHinzufuegen,
  abgelehntLaden,
  queueEinreihen,
  queueEntfernen,
  queueLaden,
  type AbgelehnterEintrag,
  type AusstehenderEintrag,
} from './queue';

/** Entscheidet, ob ein Fehler den Eintrag in der Queue belassen soll (transient → Retry)
 *  oder als endgültige fachliche Ablehnung gilt. Das ETB ist beweissicherndes Tagebuch —
 *  der teuerste Fehlermodus ist stiller Verlust, im Zweifel also behalten:
 *  - `TypeError` = Netzwerkfehler (offline).
 *  - `ApiError` 401 (Session abgelaufen), 408 (Timeout), 429 (Rate-Limit) oder ≥500
 *    (Serverfehler, z. B. SQLITE_BUSY / durchgeschlagener CHECK) → transient.
 *  - 400/403/404/409/422 → fachliche Ablehnung → dequeuen.
 *  - alles andere (Programmier-/Parse-Fehler) → NICHT behalten (kein Offline-Fall). */
function istTransient(e: unknown): boolean {
  if (e instanceof TypeError) return true;
  if (e instanceof ApiError) {
    return e.status === 401 || e.status === 408 || e.status === 429 || e.status >= 500;
  }
  return false;
}

/** Exponentieller Backoff (ms) für den automatischen Retry transient gebliebener Einträge.
 *  Nach der letzten Stufe bleibt es beim Cap. */
const BACKOFF_MS = [1000, 5000, 15000, 30000];

export function useEtbErfassung(einsatzId: number) {
  const qc = useQueryClient();
  const [ausstehend, setAusstehend] = useState<AusstehenderEintrag[]>([]);
  const [abgelehnt, setAbgelehnt] = useState<AbgelehnterEintrag[]>([]);
  const flushtGerade = useRef(false);
  const backoffTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backoffStufe = useRef(0);
  // Ref auf die jeweils aktuelle flush-Funktion, damit der Backoff-Timer sie aufrufen kann,
  // ohne eine Zyklus-Abhängigkeit flush → Backoff → flush im useCallback zu erzeugen.
  const flushRef = useRef<() => Promise<void>>(async () => {});

  const ladeAusstehend = useCallback(async () => {
    setAusstehend(await queueLaden(einsatzId));
  }, [einsatzId]);

  const ladeAbgelehnt = useCallback(async () => {
    setAbgelehnt(await abgelehntLaden(einsatzId));
  }, [einsatzId]);

  useEffect(() => {
    void ladeAusstehend();
    void ladeAbgelehnt();
  }, [ladeAusstehend, ladeAbgelehnt]);

  const flush = useCallback(async () => {
    const durchlauf = async () => {
      const liste = await queueLaden(einsatzId);
      let transientOffen = false;
      for (const a of liste) {
        try {
          await erfasseEtb(einsatzId, a.eintrag);
          await queueEntfernen(a.id!);
        } catch (e) {
          if (istTransient(e)) {
            // 401: Session abgelaufen → die zentrale Sitzungswache (LFH-268) übernimmt den
            // Re-Login. Die Queue wird NICHT geleert: die Einträge sind beweissicherndes
            // Tagebuch und gehen nach dem Anmelden raus.
            if (e instanceof ApiError && e.status === 401) meldeSitzungAbgelaufen();
            transientOffen = true;
            break; // Reihenfolge wahren; Rest beim nächsten Durchlauf
          }
          // Fachliche Ablehnung → aus der Queue nehmen, aber persistent als abgelehnt
          // ablegen (nicht still in flüchtigem State verlieren).
          await queueEntfernen(a.id!);
          await abgelehntHinzufuegen(
            einsatzId,
            a.eintrag,
            e instanceof ApiError ? e.message : 'Abgelehnt',
          );
        }
      }
      await ladeAusstehend();
      await ladeAbgelehnt();
      qc.invalidateQueries({ queryKey: einsatzKeys.etb(einsatzId) });

      if (transientOffen) {
        // Automatischer Retry mit Backoff — zusätzlich zu den online-/mount-Triggern.
        const wartezeit = BACKOFF_MS[Math.min(backoffStufe.current, BACKOFF_MS.length - 1)];
        backoffStufe.current += 1;
        if (backoffTimer.current) clearTimeout(backoffTimer.current);
        backoffTimer.current = setTimeout(() => {
          void flushRef.current();
        }, wartezeit);
      } else {
        backoffStufe.current = 0;
        if (backoffTimer.current) {
          clearTimeout(backoffTimer.current);
          backoffTimer.current = null;
        }
      }
    };

    // Cross-Tab-Serialisierung: die IndexedDB-Queue ist origin-weit, mehrere Tabs feuern
    // beim online-Event parallel. Web Locks stellt sicher, dass nur EIN Tab dieselbe Queue
    // flusht (client_id ist der Idempotenz-Backstop; das Lock spart doppelte Sendeversuche).
    const locks: LockManager | undefined = navigator.locks;
    if (locks) {
      await locks.request(`etb-flush-${einsatzId}`, { ifAvailable: true }, async (lock) => {
        if (!lock) return; // anderer Tab flusht bereits → aussetzen
        await durchlauf();
      });
    } else {
      // Fallback ohne Web Locks API: wenigstens instanzlokal serialisieren.
      if (flushtGerade.current) return;
      flushtGerade.current = true;
      try {
        await durchlauf();
      } finally {
        flushtGerade.current = false;
      }
    }
  }, [einsatzId, qc, ladeAusstehend, ladeAbgelehnt]);

  // flushRef aktuell halten (Backoff-Timer nutzt sie).
  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);

  // Backoff-Timer beim Unmount clearen (kein setState nach Unmount).
  useEffect(() => {
    return () => {
      if (backoffTimer.current) clearTimeout(backoffTimer.current);
    };
  }, []);

  useEffect(() => {
    window.addEventListener('online', flush);
    return () => window.removeEventListener('online', flush);
  }, [flush]);

  // 'online'-Event feuert nur beim Übergang. Beim Mount (z.B. Reload online)
  // einmal selbst flushen, damit Pending-Einträge nicht liegen bleiben.
  useEffect(() => {
    if (navigator.onLine) void flush();
  }, [flush]);

  const erfassen = useCallback(
    async (eintrag: NeuerEintrag) => {
      // EINE stabile client_id vor dem Versuch minten und SOWOHL online senden ALS AUCH
      // (bei transientem Fehler) einreihen — sonst erzeugt ein Timeout-nach-Commit beim
      // Retry ein Duplikat mit neuer lfd_nr.
      const mitId: NeuerEintrag = {
        ...eintrag,
        client_id: eintrag.client_id ?? crypto.randomUUID(),
      };
      try {
        await erfasseEtb(einsatzId, mitId);
        qc.invalidateQueries({ queryKey: einsatzKeys.etb(einsatzId) });
      } catch (e) {
        if (istTransient(e)) {
          if (e instanceof ApiError && e.status === 401) meldeSitzungAbgelaufen();
          await queueEinreihen(einsatzId, mitId);
          await ladeAusstehend();
        } else {
          throw e; // fachliche Ablehnung an den Aufrufer reichen
        }
      }
    },
    [einsatzId, qc, ladeAusstehend],
  );

  // Einen persistent abgelegten abgelehnten Eintrag bewusst verwerfen (Dismiss-UX).
  const abgelehntVerwerfen = useCallback(
    async (id: number) => {
      await abgelehntEntfernen(id);
      await ladeAbgelehnt();
    },
    [ladeAbgelehnt],
  );

  return { erfassen, ausstehend, flush, abgelehnt, abgelehntVerwerfen };
}
