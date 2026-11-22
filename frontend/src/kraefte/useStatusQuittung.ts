import { type QueryKey, useMutation, useQueryClient } from '@tanstack/react-query';
import { App } from 'antd';
import { useCallback } from 'react';
import { fehlerText, isVeraltet } from '../api/client';
import { nimmEinheitStatuswechselZurueck } from '../api/einheiten';
import { nimmStatuswechselZurueck } from '../api/einsatzFahrzeuge';
import { nimmMaterialStatuswechselZurueck } from '../api/einsatzMaterial';
import { nimmPersonalStatuswechselZurueck } from '../api/einsatzPersonal';
import { einsatzKeys } from '../api/queryKeys';
import type {
  EinheitStatusAntwort,
  FahrzeugPatchAntwort,
  FahrzeugStatus,
  MaterialPatchAntwort,
  MaterialStatus,
  PersonalPatchAntwort,
  PersonalStatus,
} from '../api/types';
import { type StatusArt, zeigeStatusQuittung } from '../kommunikation/rueckgaengig';
import { materialStatus } from '../theme/statusFarben';

/** Der kurze Name eines Status für die Quittung: „S4“ mit FMS-Anker, sonst das Label. */
export function statusKurz(
  katalog: readonly { id: number; label: string; fms_anker?: number | null }[] | undefined,
  statusId: number | null | undefined,
): string {
  if (statusId == null) return '—';
  const s = katalog?.find((k) => k.id === statusId);
  if (!s) return '—';
  return s.fms_anker != null ? `S${s.fms_anker}` : s.label;
}

/** Materialstatus mit dem Wort der Oberfläche (`theme/statusFarben.materialStatus`). */
export function materialStatusKurz(status: MaterialStatus | null | undefined): string {
  return status ? materialStatus[status].label : '—';
}

/** Name einer Einheit in der Quittung: der Funkrufname, sonst der Name. */
export function einheitQuittungName(e: { funkrufname?: string | null; name: string }): string {
  return e.funkrufname?.trim() ? e.funkrufname.trim() : e.name;
}

/** Wortlaut, wenn die Rücknahme nicht mehr geht. */
export function ruecknahmeFehlerText(name: string, e: unknown): string {
  return isVeraltet(e)
    ? `${name}: Nicht mehr zurückzunehmen, inzwischen geändert.`
    : `${name}: ${fehlerText(e, 'Nicht zurückgenommen')}`;
}

/** Die Antwort eines Wechsels ohne den Beleg, für den Cache: kein späterer Leser findet ihn. */
export function ohneBeleg<T extends { status_ruecknahme?: unknown }>(
  antwort: T,
): Omit<T, 'status_ruecknahme'> {
  const kopie = { ...antwort };
  delete kopie.status_ruecknahme;
  return kopie;
}

/** Eine Quittung: wer, von was nach was, und der Beleg für den Rückweg. */
export type StatusQuittung<B> = { id: number; name: string; vorher: string; neu: string; beleg: B };

/**
 * Quittung nach einem Statuswechsel mit echtem Rückweg (LLH-1781, LLH-1986; Regel
 * `kraefte/AGENTS.md`, „Quittung und Rücknahme eines Statuswechsels“): „<Name>: <alt> → <neu> ·
 * Rückgängig“. „Rückgängig“ schickt den Beleg an den Rückweg der Art; nicht mehr möglich → ein
 * Hinweis mit dem Grund. Danach lädt der Hook die Abfragen `neuLaden` neu.
 */
export function useStatusQuittung<B>(opts: {
  art: StatusArt;
  zuruecknehmen: (id: number, beleg: B) => Promise<unknown>;
  neuLaden: readonly QueryKey[];
}) {
  const { art, zuruecknehmen, neuLaden } = opts;
  const { message } = App.useApp();
  const qc = useQueryClient();
  const { mutate } = useMutation({
    mutationFn: (v: StatusQuittung<B>) => zuruecknehmen(v.id, v.beleg),
    onError: (e, v) => {
      message.warning(ruecknahmeFehlerText(v.name, e));
    },
    onSettled: () => {
      for (const key of neuLaden) void qc.invalidateQueries({ queryKey: key });
    },
  });
  return useCallback(
    (q: StatusQuittung<B>) => {
      zeigeStatusQuittung(message, { art, ...q }, () => mutate(q));
    },
    [message, art, mutate],
  );
}

/** Quittung nach dem FMS-Wechsel eines Fahrzeugs; nimmt die Antwort des Status-PATCH. */
export function useFahrzeugStatusQuittung(
  einsatzId: number,
  katalog: readonly FahrzeugStatus[] | undefined,
) {
  const quittiere = useStatusQuittung({
    art: 'fahrzeug',
    zuruecknehmen: (id, beleg: NonNullable<FahrzeugPatchAntwort['status_ruecknahme']>) =>
      nimmStatuswechselZurueck(einsatzId, id, beleg),
    neuLaden: [
      einsatzKeys.fahrzeuge(einsatzId),
      einsatzKeys.einheiten(einsatzId),
      einsatzKeys.personal(einsatzId),
      einsatzKeys.etb(einsatzId),
    ],
  });
  return useCallback(
    (antwort: FahrzeugPatchAntwort) => {
      const beleg = antwort.status_ruecknahme;
      if (!beleg) return;
      quittiere({
        id: antwort.id,
        name: antwort.funkrufname,
        vorher: statusKurz(katalog, beleg.vorher_status_id),
        neu: statusKurz(katalog, beleg.status_id),
        beleg,
      });
    },
    [quittiere, katalog],
  );
}

/** Quittung nach dem Statuswechsel einer Kraft; nimmt die Antwort des PATCH. */
export function usePersonalStatusQuittung(
  einsatzId: number,
  katalog: readonly PersonalStatus[] | undefined,
) {
  const quittiere = useStatusQuittung({
    art: 'personal',
    zuruecknehmen: (id, beleg: NonNullable<PersonalPatchAntwort['status_ruecknahme']>) =>
      nimmPersonalStatuswechselZurueck(einsatzId, id, beleg),
    neuLaden: [einsatzKeys.personal(einsatzId), einsatzKeys.etb(einsatzId)],
  });
  return useCallback(
    (antwort: PersonalPatchAntwort) => {
      const beleg = antwort.status_ruecknahme;
      if (!beleg) return;
      quittiere({
        id: antwort.id,
        name: antwort.name,
        vorher: statusKurz(katalog, beleg.vorher_status_id),
        neu: statusKurz(katalog, beleg.status_id),
        beleg,
      });
    },
    [quittiere, katalog],
  );
}

/** Quittung nach dem Statuswechsel eines Postens; nimmt die Antwort des PATCH. */
export function useMaterialStatusQuittung(einsatzId: number) {
  const quittiere = useStatusQuittung({
    art: 'material',
    zuruecknehmen: (id, beleg: NonNullable<MaterialPatchAntwort['status_ruecknahme']>) =>
      nimmMaterialStatuswechselZurueck(einsatzId, id, beleg),
    neuLaden: [
      einsatzKeys.material(einsatzId),
      einsatzKeys.einheiten(einsatzId),
      einsatzKeys.etb(einsatzId),
    ],
  });
  return useCallback(
    (antwort: MaterialPatchAntwort) => {
      const beleg = antwort.status_ruecknahme;
      if (!beleg) return;
      quittiere({
        id: antwort.id,
        name: antwort.bezeichnung,
        vorher: materialStatusKurz(beleg.vorher_status),
        neu: materialStatusKurz(beleg.status),
        beleg,
      });
    },
    [quittiere],
  );
}

/** Quittung nach dem Wechsel des Handstatus einer Einheit; nimmt die Antwort des PUT. */
export function useEinheitStatusQuittung(
  einsatzId: number,
  katalog: readonly FahrzeugStatus[] | undefined,
) {
  const quittiere = useStatusQuittung({
    art: 'einheit',
    zuruecknehmen: (id, beleg: NonNullable<EinheitStatusAntwort['status_ruecknahme']>) =>
      nimmEinheitStatuswechselZurueck(einsatzId, id, beleg),
    neuLaden: [
      einsatzKeys.einheiten(einsatzId),
      einsatzKeys.personal(einsatzId),
      einsatzKeys.etb(einsatzId),
    ],
  });
  return useCallback(
    (antwort: EinheitStatusAntwort) => {
      const beleg = antwort.status_ruecknahme;
      if (!beleg) return;
      quittiere({
        id: antwort.id,
        name: einheitQuittungName(antwort),
        vorher: statusKurz(katalog, beleg.vorher_status_id),
        neu: statusKurz(katalog, beleg.status_id),
        beleg,
      });
    },
    [quittiere, katalog],
  );
}
