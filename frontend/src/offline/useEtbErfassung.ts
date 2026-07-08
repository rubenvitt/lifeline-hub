import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../api/client';
import { erfasseEtb, type NeuerEintrag } from '../api/etb';
import { einsatzKeys } from '../api/queryKeys';
import {
  queueEinreihen,
  queueEntfernen,
  queueLaden,
  type AusstehenderEintrag,
} from './queue';

/** Netzwerkfehler (offline) erkennt man am TypeError, den fetch bei einem
 *  Verbindungsfehler wirft. So lässt sich „kein Netz" von einer fachlichen
 *  Server-Ablehnung (ApiError) UND von Programmier-/Parse-Fehlern trennen —
 *  letztere dürfen NICHT als „offline" eingereiht werden. */
function istNetzwerkfehler(e: unknown): boolean {
  return e instanceof TypeError;
}

export function useEtbErfassung(einsatzId: number) {
  const qc = useQueryClient();
  const [ausstehend, setAusstehend] = useState<AusstehenderEintrag[]>([]);
  const [abgelehnt, setAbgelehnt] = useState<{ eintrag: NeuerEintrag; grund: string }[]>([]);
  const flushtGerade = useRef(false);

  const ladeAusstehend = useCallback(async () => {
    setAusstehend(await queueLaden(einsatzId));
  }, [einsatzId]);

  useEffect(() => {
    void ladeAusstehend();
  }, [ladeAusstehend]);

  const flush = useCallback(async () => {
    if (flushtGerade.current) return; // Re-Entrancy-Guard gegen Doppelversand
    flushtGerade.current = true;
    try {
      const liste = await queueLaden(einsatzId);
      const neuAbgelehnt: { eintrag: NeuerEintrag; grund: string }[] = [];
      for (const a of liste) {
        try {
          await erfasseEtb(einsatzId, a.eintrag);
          await queueEntfernen(a.id!);
        } catch (e) {
          if (istNetzwerkfehler(e)) break; // weiter offline → später erneut
          await queueEntfernen(a.id!); // fachlich abgelehnt → NICHT still verwerfen:
          neuAbgelehnt.push({
            eintrag: a.eintrag,
            grund: e instanceof ApiError ? e.message : 'Abgelehnt',
          });
        }
      }
      if (neuAbgelehnt.length > 0) setAbgelehnt((prev) => [...prev, ...neuAbgelehnt]);
      await ladeAusstehend();
      qc.invalidateQueries({ queryKey: einsatzKeys.etb(einsatzId) });
    } finally {
      flushtGerade.current = false;
    }
  }, [einsatzId, qc, ladeAusstehend]);

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
      try {
        await erfasseEtb(einsatzId, eintrag);
        qc.invalidateQueries({ queryKey: einsatzKeys.etb(einsatzId) });
      } catch (e) {
        if (istNetzwerkfehler(e)) {
          await queueEinreihen(einsatzId, eintrag);
          await ladeAusstehend();
        } else {
          throw e; // fachliche Ablehnung an den Aufrufer reichen
        }
      }
    },
    [einsatzId, qc, ladeAusstehend],
  );

  return { erfassen, ausstehend, flush, abgelehnt };
}
