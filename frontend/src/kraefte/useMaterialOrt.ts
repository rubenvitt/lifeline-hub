import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import type { ZuruecknahmeFilter } from '../api/einheiten';
import { listEinsatzMaterial, teileAuf, updateDisposition } from '../api/einsatzMaterial';
import { einsatzKeys } from '../api/queryKeys';
import { useFeldKonflikt } from '../components/useFeldKonflikt';
import { ortPatch, ortSpalten, ortVon, type MaterialOrtRef } from './materialPosten';
import type { OrtPosten } from './materialOrtWahl';

/**
 * Der EINE Schreibweg für den Ort eines Materialpostens (LLH-1225, design.md D2; LLH-1224 D9 „Der
 * Ort gehört dem Material“): jede Ansicht, die einen Ort setzt, wechselt oder löst, ruft
 * {@link useMaterialOrt}`().setOrt` — derselbe PATCH an die Disposition mit dem Recht Material,
 * nie der Weg eines Zielmoduls. Gleicher Ort sendet nichts. Eine Teilmenge an einen Ort geht über
 * `teileAufNach`: das Aufteilen mit denselben Ort-Feldern (t1hvaqzu, design.md D1).
 *
 * Erfüllt erst, wenn die Materialliste neu im Cache steht (eine `InlineAngabe` schließt dann mit
 * dem neuen Wert); die übrigen Orte gleichen ohne Warten ab. Eine Ablehnung geht an den Aufrufer,
 * der sie am Ort der Handlung zeigt (LFH-1077).
 */
export function useMaterialOrt(einsatzId: number) {
  const qc = useQueryClient();
  const konflikt = useFeldKonflikt();
  /** Die Einheit trägt ihr Material im DTO, UHS und Bereitstellungsraum im Detail. */
  const syncOrte = useCallback(
    async (orte: readonly (MaterialOrtRef | null)[]): Promise<void> => {
      void qc.invalidateQueries({ queryKey: einsatzKeys.einheiten(einsatzId) });
      void qc.invalidateQueries({ queryKey: einsatzKeys.uhs(einsatzId) });
      for (const ort of orte) {
        if (ort?.art === 'uhs') {
          void qc.invalidateQueries({ queryKey: einsatzKeys.uhsDetail(einsatzId, ort.id) });
        } else if (ort?.art === 'bereitstellungsraum') {
          void qc.invalidateQueries({ queryKey: einsatzKeys.brDetail(einsatzId, ort.id) });
        }
      }
      void qc.invalidateQueries({ queryKey: einsatzKeys.etb(einsatzId) });
      await qc.invalidateQueries({ queryKey: einsatzKeys.material(einsatzId) });
    },
    [einsatzId, qc],
  );
  /**
   * `optionen.nurWennFrei` für das Rückgängig nach dem Lösen (LLH-1924): liegt der Posten
   * inzwischen woanders, lehnt der Server ab, statt ihn dort wegzunehmen.
   *
   * `optionen.beimOeffnen` ist der Ort, den die Einzelangabe beim Öffnen zeigte (Feld-CAS,
   * LLH-1945): er geht mit allen vier Spalten als Altwert mit, ein 409 fragt über
   * `useFeldKonflikt` (`ortText` nennt den aktuellen Ort lesbar). Liefert dann deren Ergebnis
   * (`OFFEN_LASSEN`, `VERWORFEN`). Handlungen ohne offenes Feld (Lösen, Rückgängig, Zuordnen im
   * Dialog) schicken keinen.
   */
  const setOrt = useCallback(
    async (
      em: OrtPosten,
      ziel: MaterialOrtRef | null,
      optionen?: Pick<ZuruecknahmeFilter, 'nurWennFrei'> & {
        beimOeffnen?: MaterialOrtRef | null;
        ortText?: (ort: MaterialOrtRef | null) => string;
      },
    ) => {
      const vorher = ortVon(em);
      const patch = ortPatch(ziel, vorher);
      if (patch == null) return;
      const { beimOeffnen, ortText, nurWennFrei } = optionen ?? {};
      const ergebnis = await konflikt({
        etikett: 'Ort',
        erwartet: beimOeffnen === undefined ? undefined : ortSpalten(beimOeffnen),
        speichern: async (erwartet) => {
          await updateDisposition(einsatzId, em.id, patch, {
            nurWennFrei,
            ...(erwartet && { erwartet: { ort: erwartet } }),
          });
        },
        ladeFrisch: async () => {
          const liste = await qc.fetchQuery({
            queryKey: einsatzKeys.material(einsatzId),
            queryFn: () => listEinsatzMaterial(einsatzId),
            staleTime: 0,
          });
          return liste.find((p) => p.id === em.id);
        },
        // Ein inzwischen herausgenommener Posten fehlt in der Liste: dann kein Feldkonflikt.
        aktuell: (frisch) =>
          frisch && {
            wert: ortSpalten(ortVon(frisch)),
            anzeige: ortText?.(ortVon(frisch)),
          },
        text: (w) => ortText?.(ortVon(w)) ?? 'ein anderer Ort',
        leer: (w) => ortVon(w) == null,
      });
      // Verworfen: nichts geschrieben, die Orte gleichen trotzdem ab (der Posten liegt woanders).
      await syncOrte([vorher, ziel]);
      return ergebnis;
    },
    [einsatzId, syncOrte, konflikt, qc],
  );
  /**
   * `menge` vom Posten abteilen und an `ziel` setzen, in EINEM Request (t1hvaqzu, design.md D1/D6):
   * das Aufteilen mit den Ort-Feldern wie `setOrt`; gleicher Ort schickt nur die Menge.
   */
  const teileAufNach = useCallback(
    async (em: OrtPosten, menge: number, ziel: MaterialOrtRef | null): Promise<void> => {
      const vorher = ortVon(em);
      await teileAuf(einsatzId, em.id, menge, ortPatch(ziel, vorher));
      await syncOrte([vorher, ziel]);
    },
    [einsatzId, syncOrte],
  );
  return { setOrt, teileAufNach };
}
