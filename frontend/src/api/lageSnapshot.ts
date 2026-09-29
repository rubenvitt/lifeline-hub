import type { LageSnapshot, LageSnapshotDokument, NeuerLageSnapshot } from './types';
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

/** Einen Stand löschen (Dokumenten-Vernichtung, nur Einsatzleitung). */
export function loescheLageSnapshot(einsatzId: number, snapshotId: number): Promise<void> {
  return apiSend<void>(`/api/einsaetze/${einsatzId}/lage-snapshots/${snapshotId}`, 'DELETE');
}
