import { useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { gibPersonalFrei, ordnePersonalZu } from '../api/einheiten';
import { gibBesatzungFrei, ordneBesatzungZu } from '../api/einsatzFahrzeuge';
import { ordneKraftZu, zieheKraftAb } from '../api/einsatzUhs';
import { updateDisposition, type DispositionPatch } from '../api/einsatzPersonal';
import { einsatzKeys } from '../api/queryKeys';
import type { EinsatzPersonal } from '../api/types';

/** Übernahme einer Zuordnung mit neuem und bisherigem Ziel (`EinheitAngabe`, `FahrzeugAngabe`). */
export type ZuordnungSpeichern = (neu: number | null, alt: number | null) => Promise<void>;

/**
 * Wechsel = ein PUT auf das neue Ziel (exklusiv, der Server löst die alte Zuordnung), Leeren =
 * DELETE mit der bisherigen ID, unverändert = nichts. Kein zweiter Schreibweg neben dem Zielmodul:
 * das Recht hängt am Modul des Ziels (LLH-1060 D3).
 */
async function switchZuordnung(
  neu: number | null,
  alt: number | null,
  zu: (ziel: number) => Promise<unknown>,
  frei: (ziel: number) => Promise<unknown>,
) {
  if (neu === alt) return;
  if (neu != null) await zu(neu);
  else if (alt != null) await frei(alt);
}

/**
 * Die Schreibwege der Einteilung einer Person (LLH-1060, Spec `personal-ansicht`), für Liste und
 * Ansicht gleich: Einheit über `…/einheiten/{eid}/personal/{ep}`, Fahrzeug über
 * `…/fahrzeuge/{ef}/besatzung/{ep}`, UHS über `…/uhs/{uid}/kraefte/{ep}`, die übrigen Angaben über
 * den PATCH der Disposition.
 *
 * Jede Übernahme erfüllt erst, wenn die Personalliste neu im Cache steht (`InlineAngabe` schließt
 * dann mit dem neuen Wert); eine Ablehnung lehnt ab und bleibt am Ort der Handlung. Die übrigen
 * Listen gleicht der Sammler ab; das ETB trägt der Server.
 */
export function useEinteilungSchreiben(einsatzId: number) {
  const qc = useQueryClient();
  return useMemo(() => {
    const syncCache = async (weitere: readonly (readonly unknown[])[]) => {
      for (const k of weitere) void qc.invalidateQueries({ queryKey: k });
      void qc.invalidateQueries({ queryKey: einsatzKeys.etb(einsatzId) });
      await qc.invalidateQueries({ queryKey: einsatzKeys.personal(einsatzId) });
    };
    return {
      einheit:
        (epId: number): ZuordnungSpeichern =>
        async (neu, alt) => {
          await switchZuordnung(
            neu,
            alt,
            (eid) => ordnePersonalZu(einsatzId, eid, epId),
            (eid) => gibPersonalFrei(einsatzId, eid, epId),
          );
          await syncCache([einsatzKeys.einheiten(einsatzId), einsatzKeys.fahrzeuge(einsatzId)]);
        },
      fahrzeug:
        (epId: number): ZuordnungSpeichern =>
        async (neu, alt) => {
          await switchZuordnung(
            neu,
            alt,
            (ef) => ordneBesatzungZu(einsatzId, ef, epId),
            (ef) => gibBesatzungFrei(einsatzId, ef, epId),
          );
          await syncCache([einsatzKeys.fahrzeuge(einsatzId), einsatzKeys.einheiten(einsatzId)]);
        },
      uhs:
        (epId: number): ZuordnungSpeichern =>
        async (neu, alt) => {
          await switchZuordnung(
            neu,
            alt,
            (uid) => ordneKraftZu(einsatzId, uid, epId),
            (uid) => zieheKraftAb(einsatzId, uid, epId),
          );
          await syncCache([einsatzKeys.uhs(einsatzId)]);
        },
      /**
       * Eine Angabe des PATCH (Position, Bemerkung, Einsatzfunktion, Ad-hoc-Angaben). Die Antwort
       * ist die neue Zeile; sie steht sofort im Cache, damit die Angabe mit dem neuen Wert schließt.
       */
      angabe: async (epId: number, felder: DispositionPatch) => {
        const neu = await updateDisposition(einsatzId, epId, felder);
        qc.setQueryData<EinsatzPersonal[]>(einsatzKeys.personal(einsatzId), (liste) =>
          liste?.map((ep) => (ep.id === neu.id ? neu : ep)),
        );
        void qc.invalidateQueries({ queryKey: einsatzKeys.personal(einsatzId) });
        void qc.invalidateQueries({ queryKey: einsatzKeys.etb(einsatzId) });
        return neu;
      },
    };
  }, [qc, einsatzId]);
}
