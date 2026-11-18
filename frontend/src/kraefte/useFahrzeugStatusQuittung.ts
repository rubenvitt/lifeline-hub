import { useMutation, useQueryClient } from '@tanstack/react-query';
import { App } from 'antd';
import { useCallback } from 'react';
import { fehlerText, isVeraltet } from '../api/client';
import { nimmStatuswechselZurueck } from '../api/einsatzFahrzeuge';
import { einsatzKeys } from '../api/queryKeys';
import type { FahrzeugPatchAntwort, FahrzeugStatus, StatusRuecknahmeBeleg } from '../api/types';
import { zeigeStatusQuittung } from '../kommunikation/rueckgaengig';

/** Der kurze Name eines Status für die Quittung: „S4“ mit FMS-Anker, sonst das Label. */
export function statusKurz(
  katalog: readonly Pick<FahrzeugStatus, 'id' | 'label' | 'fms_anker'>[] | undefined,
  statusId: number | null | undefined,
): string {
  if (statusId == null) return '—';
  const s = katalog?.find((k) => k.id === statusId);
  if (!s) return '—';
  return s.fms_anker != null ? `S${s.fms_anker}` : s.label;
}

/** Wortlaut, wenn die Rücknahme nicht mehr geht (Spec `fahrzeugstatus-quittung`). */
export function ruecknahmeFehlerText(rufname: string, e: unknown): string {
  return isVeraltet(e)
    ? `${rufname}: Nicht mehr zurückzunehmen, inzwischen geändert.`
    : `${rufname}: ${fehlerText(e, 'Nicht zurückgenommen')}`;
}

/**
 * Quittung nach dem Statuswechsel eines Fahrzeugs mit echtem Rückweg (LLH-1781, Change
 * `eon26eat-status-und-bedienung`, D10). Der Aufrufer reicht die Antwort des Status-PATCH; trägt
 * sie einen Beleg, erscheint „85-1: S2 → S3 · Rückgängig“. „Rückgängig“ schickt den Beleg an
 * `…/status/zuruecknehmen` und lädt Fahrzeuge, Einheiten, Personal und ETB neu.
 */
export function useFahrzeugStatusQuittung(
  einsatzId: number,
  katalog: readonly FahrzeugStatus[] | undefined,
) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const ruecknahme = useMutation({
    mutationFn: (v: { efId: number; rufname: string; beleg: StatusRuecknahmeBeleg }) =>
      nimmStatuswechselZurueck(einsatzId, v.efId, v.beleg),
    onError: (e, v) => {
      message.warning(ruecknahmeFehlerText(v.rufname, e));
    },
    onSettled: () => {
      for (const key of [
        einsatzKeys.fahrzeuge(einsatzId),
        einsatzKeys.einheiten(einsatzId),
        einsatzKeys.personal(einsatzId),
        einsatzKeys.etb(einsatzId),
      ]) {
        void qc.invalidateQueries({ queryKey: key });
      }
    },
  });
  const { mutate } = ruecknahme;
  return useCallback(
    (antwort: FahrzeugPatchAntwort) => {
      const beleg = antwort.status_ruecknahme;
      if (!beleg) return;
      const rufname = antwort.funkrufname;
      zeigeStatusQuittung(
        message,
        {
          efId: antwort.id,
          rufname,
          vorher: statusKurz(katalog, beleg.vorher_status_id),
          neu: statusKurz(katalog, beleg.status_id),
        },
        () => mutate({ efId: antwort.id, rufname, beleg }),
      );
    },
    [message, katalog, mutate],
  );
}
