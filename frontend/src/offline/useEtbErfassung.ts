import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '../api/client';
import { erfasseEtb, type NeuerEintrag } from '../api/etb';
import {
  queueEinreihen,
  queueEntfernen,
  queueLaden,
  type AusstehenderEintrag,
} from './queue';

/** Netzwerkfehler (offline) sind keine ApiError-Instanzen — fetch wirft TypeError.
 *  So lässt sich „kein Netz" von einer fachlichen Server-Ablehnung trennen. */
function istNetzwerkfehler(e: unknown): boolean {
  return !(e instanceof ApiError);
}

export function useEtbErfassung(einsatzId: number) {
  const qc = useQueryClient();
  const [ausstehend, setAusstehend] = useState<AusstehenderEintrag[]>([]);

  const ladeAusstehend = useCallback(async () => {
    setAusstehend(await queueLaden(einsatzId));
  }, [einsatzId]);

  useEffect(() => {
    void ladeAusstehend();
  }, [ladeAusstehend]);

  const flush = useCallback(async () => {
    const liste = await queueLaden(einsatzId);
    for (const a of liste) {
      try {
        await erfasseEtb(einsatzId, a.eintrag);
        await queueEntfernen(a.id!);
      } catch (e) {
        if (istNetzwerkfehler(e)) break; // weiterhin offline → später erneut versuchen
        await queueEntfernen(a.id!); // fachlich abgelehnt → verwerfen, sonst Dauerschleife
      }
    }
    await ladeAusstehend();
    qc.invalidateQueries({ queryKey: ['etb', einsatzId] });
  }, [einsatzId, qc, ladeAusstehend]);

  useEffect(() => {
    window.addEventListener('online', flush);
    return () => window.removeEventListener('online', flush);
  }, [flush]);

  const erfassen = useCallback(
    async (eintrag: NeuerEintrag) => {
      try {
        await erfasseEtb(einsatzId, eintrag);
        qc.invalidateQueries({ queryKey: ['etb', einsatzId] });
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

  return { erfassen, ausstehend, flush };
}
