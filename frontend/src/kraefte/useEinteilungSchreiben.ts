import { useMemo, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { gibPersonalFrei, ordnePersonalZu } from '../api/einheiten';
import { gibBesatzungFrei, ordneBesatzungZu } from '../api/einsatzFahrzeuge';
import { ordneKraftZu, zieheKraftAb } from '../api/einsatzUhs';
import {
  listeEinsatzPersonal,
  updateDisposition,
  type DispositionErwartet,
  type DispositionPatch,
} from '../api/einsatzPersonal';
import { POSITION_LABELS } from '../api/personal';
import { einsatzKeys } from '../api/queryKeys';
import type { EinsatzPersonal } from '../api/types';
import { ausschnitt, ausschnittLeer, ausschnittText } from '../components/feldVermerk';
import { useFeldKonflikt } from '../components/useFeldKonflikt';
import { ohneBeleg } from './useStatusQuittung';

/** Altwert einer Einzelangabe (Feld-CAS, LLH-1945): Name der Angabe und Wert beim Öffnen. */
export interface AngabeAltwert {
  etikett: string;
  erwartet: DispositionErwartet;
}

/** Die Angaben der Disposition in der Wire-Form des PATCH: Vergleichswert nach einem 409. */
function personalWire(ep: EinsatzPersonal): Record<string, unknown> {
  return {
    staerke_position: ep.staerke_position ?? null,
    bemerkung: ep.bemerkung ?? null,
    einsatzfunktion: ep.einsatzfunktion ?? null,
    name: ep.name,
    funktion: ep.funktion ?? null,
    traegerorganisation: ep.traegerorganisation ?? null,
  };
}

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
 * `…/fahrzeuge/{ef}/besatzung/{ep}`, UHS über `…/uhs/{uid}/forces/{ep}`, die übrigen Angaben über
 * den PATCH der Disposition.
 *
 * Jede Übernahme erfüllt erst, wenn die Personalliste neu im Cache steht (`InlineAngabe` schließt
 * dann mit dem neuen Wert); eine Ablehnung lehnt ab und bleibt am Ort der Handlung. Die übrigen
 * Listen gleicht der Sammler ab; das ETB trägt der Server.
 */
export function useEinteilungSchreiben(einsatzId: number) {
  const qc = useQueryClient();
  // Die Rückfrage braucht den App-Kontext; `useFeldKonflikt` liefert je Render eine neue Funktion,
  // über die Ref bleibt der Schreibweg stabil (Muster `fernmeldewesen/useSkizzenAktionen.ts`).
  const konflikt = useFeldKonflikt();
  const konfliktRef = useRef(konflikt);
  konfliktRef.current = konflikt;
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
       *
       * Mit `alt` (Wert beim Öffnen) prüft der Server auf zwischenzeitliche Änderung (Feld-CAS,
       * LLH-1945); ein 409 fragt über `useFeldKonflikt`. Liefert dessen Ergebnis: `OFFEN_LASSEN`
       * (Eingabe bleibt offen) oder `VERWORFEN` (nichts gespeichert, der frische Stand im Cache).
       */
      angabe: (epId: number, felder: DispositionPatch, alt?: AngabeAltwert) =>
        konfliktRef.current({
          etikett: alt?.etikett ?? 'Angabe',
          erwartet: alt?.erwartet,
          speichern: async (erwartet) => {
            // Ohne Beleg in den Cache: die Einteilung quittiert keinen Statuswechsel (LLH-1986).
            const neu = ohneBeleg(await updateDisposition(einsatzId, epId, felder, erwartet));
            qc.setQueryData<EinsatzPersonal[]>(einsatzKeys.personal(einsatzId), (liste) =>
              liste?.map((ep) => (ep.id === neu.id ? neu : ep)),
            );
            void qc.invalidateQueries({ queryKey: einsatzKeys.personal(einsatzId) });
            void qc.invalidateQueries({ queryKey: einsatzKeys.etb(einsatzId) });
          },
          ladeFrisch: async () => {
            const liste = await qc.fetchQuery({
              queryKey: einsatzKeys.personal(einsatzId),
              queryFn: () => listeEinsatzPersonal(einsatzId),
              staleTime: 0,
            });
            return liste.find((ep) => ep.id === epId);
          },
          // Eine inzwischen entlassene Kraft fehlt in der Liste: dann kein Feldkonflikt, der Grund
          // des Servers steht an der Angabe.
          aktuell: (frisch) =>
            frisch && {
              wert: ausschnitt(personalWire(frisch), felder) as DispositionErwartet,
              anzeige:
                'staerke_position' in felder && frisch.staerke_position
                  ? POSITION_LABELS[frisch.staerke_position]
                  : undefined,
            },
          text: ausschnittText,
          leer: ausschnittLeer,
        }),
    };
  }, [qc, einsatzId]);
}
