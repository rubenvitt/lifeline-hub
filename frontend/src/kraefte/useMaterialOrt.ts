import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { teileAuf, updateDisposition } from '../api/einsatzMaterial';
import { einsatzKeys } from '../api/queryKeys';
import { ortPatch, ortVon, type MaterialOrtRef } from './materialPosten';
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
  const setOrt = useCallback(
    async (em: OrtPosten, ziel: MaterialOrtRef | null): Promise<void> => {
      const vorher = ortVon(em);
      const patch = ortPatch(ziel, vorher);
      if (patch == null) return;
      await updateDisposition(einsatzId, em.id, patch);
      await syncOrte([vorher, ziel]);
    },
    [einsatzId, syncOrte],
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
