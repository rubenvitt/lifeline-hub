import type {
  LageSnapshot,
  LageSnapshotDokument,
  NeuerLageSnapshot,
  PatchLageSnapshot,
} from './types';
import { apiGet, apiSend } from './client';

/** Metadaten-Liste der Lage-Snapshots eines Einsatzes (LFH-321), neueste zuerst, ohne `daten`. */
export function ladeLageSnapshots(einsatzId: number): Promise<LageSnapshot[]> {
  return apiGet<LageSnapshot[]>(`/api/einsaetze/${einsatzId}/lage-snapshots`);
}

/** Volldokument eines Standes inkl. eingefrorenem Lagebild (`daten`). */
export function ladeLageSnapshot(
  einsatzId: number,
  snapshotId: number,
): Promise<LageSnapshotDokument> {
  return apiGet<LageSnapshotDokument>(`/api/einsaetze/${einsatzId}/lage-snapshots/${snapshotId}`);
}

/** „Stand sichern": friert das volle Lagebild ein und legt einen unveränderlichen Stand an. */
export function erzeugeLageSnapshot(
  einsatzId: number,
  daten: NeuerLageSnapshot = {},
): Promise<LageSnapshotDokument> {
  return apiSend<LageSnapshotDokument>(`/api/einsaetze/${einsatzId}/lage-snapshots`, 'POST', daten);
}

/** Metadaten (Bezeichnung/Notiz) eines Standes ändern — `daten`/`stand_at` bleiben unveränderlich. */
export function patcheLageSnapshot(
  einsatzId: number,
  snapshotId: number,
  daten: PatchLageSnapshot,
): Promise<LageSnapshotDokument> {
  return apiSend<LageSnapshotDokument>(
    `/api/einsaetze/${einsatzId}/lage-snapshots/${snapshotId}`,
    'PATCH',
    daten,
  );
}

/** Einen Stand löschen (Dokumenten-Vernichtung, nur Einsatzleitung). */
export function loescheLageSnapshot(einsatzId: number, snapshotId: number): Promise<void> {
  return apiSend<void>(`/api/einsaetze/${einsatzId}/lage-snapshots/${snapshotId}`, 'DELETE');
}
