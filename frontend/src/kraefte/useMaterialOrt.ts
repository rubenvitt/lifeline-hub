import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { updateDisposition } from '../api/einsatzMaterial';
import { einsatzKeys } from '../api/queryKeys';
import { ortPatch, ortVon, type MaterialOrtRef } from './materialPosten';
import type { OrtPosten } from './materialOrtWahl';

/**
 * Der EINE Schreibweg für den Ort eines Materialpostens (LLH-1225, design.md D2; LLH-1224 D9 „Der
 * Ort gehört dem Material“): jede Ansicht, die einen Ort setzt, wechselt oder löst, ruft
 * {@link useMaterialOrt}`().setOrt` — derselbe PATCH an die Disposition mit dem Recht Material,
 * nie der Weg eines Zielmoduls. Gleicher Ort sendet nichts.
 *
 * Erfüllt erst, wenn die Materialliste neu im Cache steht (eine `InlineAngabe` schließt dann mit
 * dem neuen Wert); die übrigen Orte gleichen ohne Warten ab. Eine Ablehnung geht an den Aufrufer,
 * der sie am Ort der Handlung zeigt (LFH-1077).
 */
export function useMaterialOrt(einsatzId: number) {
  const qc = useQueryClient();
  const setOrt = useCallback(
    async (em: OrtPosten, ziel: MaterialOrtRef | null): Promise<void> => {
      const vorher = ortVon(em);
      const patch = ortPatch(ziel, vorher);
      if (patch == null) return;
      await updateDisposition(einsatzId, em.id, patch);
      // Die Einheit trägt ihr Material im DTO, UHS und Bereitstellungsraum im Detail.
      void qc.invalidateQueries({ queryKey: einsatzKeys.einheiten(einsatzId) });
      void qc.invalidateQueries({ queryKey: einsatzKeys.uhs(einsatzId) });
      for (const ort of [vorher, ziel]) {
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
  return { setOrt };
}
