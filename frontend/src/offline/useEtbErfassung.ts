import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../api/client';
import { erfasseEtb, type NeuerEintrag } from '../api/etb';
import { einsatzKeys } from '../api/queryKeys';
import { meldeSitzungAbgelaufen } from '../auth/sitzungsEvent';
import {
  OFFLINE_QUEUE_EVENT,
  abgelehntEntfernen,
  abgelehntLaden,
  queueAblehnen,
  queueEinreihen,
  queueEntfernen,
  queueLaden,
  type AbgelehnterEintrag,
  type AusstehenderEintrag,
} from './queue';
import { istOfflineTransient } from './fehler';

/** Entscheidet, ob ein Fehler den Eintrag in der Queue belassen soll (transient → Retry)
 *  oder als endgültige fachliche Ablehnung gilt. Das ETB ist beweissicherndes Tagebuch —
 *  der teuerste Fehlermodus ist stiller Verlust, im Zweifel also behalten:
 *  - `TypeError` = Netzwerkfehler (offline).
 *  - `ApiError` 401 (Session abgelaufen), 408 (Timeout), 429 (Rate-Limit) oder ≥500
 *    (Serverfehler, z. B. SQLITE_BUSY / durchgeschlagener CHECK) → transient.
 *  - 400/403/404/409/422 → fachliche Ablehnung → dequeuen.
 *  - alles andere (Programmier-/Parse-Fehler) → NICHT behalten (kein Offline-Fall). */
/** Exponentieller Backoff (ms) für den automatischen Retry transient gebliebener Einträge.
 *  Nach der letzten Stufe bleibt es beim Cap. */
const BACKOFF_MS = [1000, 5000, 15000, 30000];

export function useEtbErfassung(einsatzId: number, benutzerId?: number) {
  const qc = useQueryClient();
  const scopeKey = `${benutzerId ?? 'anonym'}:${einsatzId}`;
  const [ausstehendStand, setAusstehendStand] = useState<{
    scope: string;
    werte: AusstehenderEintrag[];
  }>({ scope: scopeKey, werte: [] });
  const [abgelehntStand, setAbgelehntStand] = useState<{
    scope: string;
    werte: AbgelehnterEintrag[];
  }>({ scope: scopeKey, werte: [] });
  const aktiverScope = useRef({ key: scopeKey, generation: 0 });
  if (aktiverScope.current.key !== scopeKey) {
    aktiverScope.current = {
      key: scopeKey,
      generation: aktiverScope.current.generation + 1,
    };
  }
  const montiert = useRef(true);
  const flushtGerade = useRef(false);
  const backoffTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backoffStufe = useRef(0);
  // Ref auf die jeweils aktuelle flush-Funktion, damit der Backoff-Timer sie aufrufen kann,
  // ohne eine Zyklus-Abhängigkeit flush → Backoff → flush im useCallback zu erzeugen.
  const flushRef = useRef<() => Promise<void>>(async () => {});

  const ladeAusstehend = useCallback(async () => {
    const generation = aktiverScope.current.generation;
    if (aktiverScope.current.key !== scopeKey) return;
    if (benutzerId == null) {
      setAusstehendStand({ scope: scopeKey, werte: [] });
      return;
    }
    const geladen = await queueLaden(benutzerId, einsatzId);
    if (
      montiert.current &&
      aktiverScope.current.key === scopeKey &&
      aktiverScope.current.generation === generation
    ) setAusstehendStand({ scope: scopeKey, werte: geladen });
  }, [benutzerId, einsatzId, scopeKey]);

  const ladeAbgelehnt = useCallback(async () => {
    const generation = aktiverScope.current.generation;
    if (aktiverScope.current.key !== scopeKey) return;
    if (benutzerId == null) {
      setAbgelehntStand({ scope: scopeKey, werte: [] });
      return;
    }
    const geladen = await abgelehntLaden(benutzerId, einsatzId);
    if (
      montiert.current &&
      aktiverScope.current.key === scopeKey &&
      aktiverScope.current.generation === generation
    ) setAbgelehntStand({ scope: scopeKey, werte: geladen });
  }, [benutzerId, einsatzId, scopeKey]);

  useEffect(() => {
    void ladeAusstehend();
    void ladeAbgelehnt();
  }, [ladeAusstehend, ladeAbgelehnt]);

  useEffect(() => {
    const neuLaden = () => {
      void ladeAusstehend();
      void ladeAbgelehnt();
    };
    window.addEventListener(OFFLINE_QUEUE_EVENT, neuLaden);
    return () => window.removeEventListener(OFFLINE_QUEUE_EVENT, neuLaden);
  }, [ladeAusstehend, ladeAbgelehnt]);

  const flush = useCallback(async () => {
    if (
      benutzerId == null ||
      !navigator.onLine ||
      aktiverScope.current.key !== scopeKey
    ) return;
    const generation = aktiverScope.current.generation;
    const durchlauf = async () => {
      const darfFortsetzen = () =>
        montiert.current &&
        aktiverScope.current.key === scopeKey &&
        aktiverScope.current.generation === generation;
      if (!darfFortsetzen()) return;
      // Erst innerhalb des Locks lesen: ein wartender Tab darf nicht mit einem
      // veralteten Snapshot weiterarbeiten.
      const liste = await queueLaden(benutzerId, einsatzId);
      let transientOffen = false;
      for (const a of liste) {
        if (!darfFortsetzen()) break;
        try {
          await erfasseEtb(einsatzId, a.eintrag, {
            offlineQueueBenutzerId: benutzerId,
          });
          if (!darfFortsetzen()) break;
          await queueEntfernen(benutzerId, a.id!);
        } catch (e) {
          if (!darfFortsetzen()) break;
          if (istOfflineTransient(e)) {
            // 401: Session abgelaufen → die zentrale Sitzungswache (LFH-268) übernimmt den
            // Re-Login. Die Queue wird NICHT geleert: die Einträge sind beweissicherndes
            // Tagebuch und gehen nach dem Anmelden raus.
            if (e instanceof ApiError && e.status === 401) meldeSitzungAbgelaufen();
            transientOffen = true;
            break; // Reihenfolge wahren; Rest beim nächsten Durchlauf
          }
          // Fachliche Ablehnung → aus der Queue nehmen, aber persistent als abgelehnt
          // ablegen (nicht still in flüchtigem State verlieren).
          await queueAblehnen(
            benutzerId,
            a,
            e instanceof ApiError ? e.message : 'Abgelehnt',
          );
        }
      }
      if (!darfFortsetzen()) return;
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
      await locks.request(`offline-flush-${einsatzId}`, durchlauf);
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
  }, [benutzerId, einsatzId, qc, ladeAusstehend, ladeAbgelehnt, scopeKey]);

  // flushRef aktuell halten (Backoff-Timer nutzt sie).
  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);

  // Backoff-Timer beim Unmount clearen (kein setState nach Unmount).
  useEffect(() => {
    montiert.current = true;
    return () => {
      montiert.current = false;
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
      if (benutzerId == null) throw new Error('Nicht angemeldet');
      try {
        await erfasseEtb(einsatzId, mitId, {
          offlineQueueBenutzerId: benutzerId,
        });
        qc.invalidateQueries({ queryKey: einsatzKeys.etb(einsatzId) });
      } catch (e) {
        if (istOfflineTransient(e)) {
          if (e instanceof ApiError && e.status === 401) meldeSitzungAbgelaufen();
          await queueEinreihen(benutzerId, einsatzId, mitId);
          await ladeAusstehend();
        } else {
          throw e; // fachliche Ablehnung an den Aufrufer reichen
        }
      }
    },
    [benutzerId, einsatzId, qc, ladeAusstehend],
  );

  // Einen persistent abgelegten abgelehnten Eintrag bewusst verwerfen (Dismiss-UX).
  const abgelehntVerwerfen = useCallback(
    async (id: number) => {
      if (benutzerId == null) return;
      await abgelehntEntfernen(benutzerId, id);
      await ladeAbgelehnt();
    },
    [benutzerId, ladeAbgelehnt],
  );

  return {
    erfassen,
    ausstehend: ausstehendStand.scope === scopeKey ? ausstehendStand.werte : [],
    flush,
    abgelehnt: abgelehntStand.scope === scopeKey ? abgelehntStand.werte : [],
    abgelehntVerwerfen,
  };
}
