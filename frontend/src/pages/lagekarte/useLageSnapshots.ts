import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { einsatzKeys } from '../../api/queryKeys';
import {
  ladeLageSnapshots,
  erzeugeLageSnapshot,
  loescheLageSnapshot,
} from '../../api/lageSnapshot';

/**
 * Daten-Leg der Lage-Snapshots (LFH-321): Metadaten-Liste + „Stand sichern"/Löschen.
 * Geteilt von der Snapshot-Leiste (C) und der Replay-Zeitleiste (D). Die Liste ist SSE-live
 * (`lage_snapshot`-Event invalidiert `einsatzKeys.lageSnapshot`); Snapshot-Dokumente selbst sind
 * unveränderlich und liegen unter einem EIGENEN Prefix (`lageSnapshotDokument`), damit die
 * Listen-Invalidierung sie nicht per Prefix mit-refetcht.
 */
export function useLageSnapshots(einsatzId: number) {
  const qc = useQueryClient();
  const listeQuery = useQuery({
    queryKey: einsatzKeys.lageSnapshot(einsatzId),
    queryFn: () => ladeLageSnapshots(einsatzId),
  });
  const invalidiere = () => qc.invalidateQueries({ queryKey: einsatzKeys.lageSnapshot(einsatzId) });

  const sichernM = useMutation({
    mutationFn: (bezeichnung?: string) =>
      erzeugeLageSnapshot(einsatzId, { bezeichnung: bezeichnung?.trim() || null }),
    onSuccess: invalidiere,
  });
  const loeschenM = useMutation({
    mutationFn: (id: number) => loescheLageSnapshot(einsatzId, id),
    onSuccess: invalidiere,
  });

  return {
    /** Metadaten-Liste, neueste zuerst (Backend-Sortierung). */
    snapshots: listeQuery.data ?? [],
    ladt: listeQuery.isLoading,
    sichern: (bezeichnung?: string) => sichernM.mutateAsync(bezeichnung),
    sichertGerade: sichernM.isPending,
    loesche: (id: number) => loeschenM.mutateAsync(id),
    loeschtGerade: loeschenM.isPending,
  };
}
