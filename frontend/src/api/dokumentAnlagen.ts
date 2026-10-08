import { apiGet, apiSend, apiUploadMitFortschritt } from './client';
import type { AnlageArt, DokumentAnlage } from './types';
import { UPLOAD_TIMEOUT_MS } from './upload';

/**
 * Bild-Anlagen an Lagebericht und Befehl (LFH-1028). Beide Dokumente tragen dieselben Routen
 * unter ihrer eigenen Sammlung; `dokument` wählt sie. Ablegen und Entfernen gehen nur im Entwurf,
 * eine Freigabe friert die Anlagen mit ein.
 */
export type AnlagenDokument = 'lageberichte' | 'befehle';

const basis = (dokument: AnlagenDokument, einsatzId: number, dokumentId: number) =>
  `/api/einsaetze/${einsatzId}/${dokument}/${dokumentId}/anlagen`;

/** Anlagen in ihrer Reihenfolge (Nummer 1, 2, …). */
export function listeDokumentAnlagen(
  dokument: AnlagenDokument,
  einsatzId: number,
  dokumentId: number,
): Promise<DokumentAnlage[]> {
  return apiGet<DokumentAnlage[]>(basis(dokument, einsatzId, dokumentId));
}

export interface NeueDokumentAnlage {
  art: AnlageArt;
  titel: string;
  /** ISO-Zeitpunkt, derselbe, der im Bild als „Stand“ steht. */
  standAt: string;
  datei: Blob;
  dateiname: string;
}

export function legeDokumentAnlageAb(
  dokument: AnlagenDokument,
  einsatzId: number,
  dokumentId: number,
  anlage: NeueDokumentAnlage,
): Promise<DokumentAnlage> {
  const fd = new FormData();
  fd.append('art', anlage.art);
  fd.append('titel', anlage.titel);
  fd.append('stand_at', anlage.standAt);
  fd.append('datei', anlage.datei, anlage.dateiname);
  return apiUploadMitFortschritt<DokumentAnlage>(basis(dokument, einsatzId, dokumentId), fd, {
    timeoutMs: UPLOAD_TIMEOUT_MS,
  });
}

export function entferneDokumentAnlage(
  dokument: AnlagenDokument,
  einsatzId: number,
  dokumentId: number,
  anlageId: number,
): Promise<void> {
  return apiSend<void>(`${basis(dokument, einsatzId, dokumentId)}/${anlageId}`, 'DELETE');
}

/**
 * Bild der Anlage über die Dokumentroute, nie über `/anhaenge/{aid}` des Einsatzes (dort 404).
 * Ein API-Pfad, keine Navigation, deshalb nicht in `routing/deeplinks.ts`.
 */
export function dokumentAnlageDateiPfad(
  dokument: AnlagenDokument,
  einsatzId: number,
  dokumentId: number,
  anlageId: number,
): string {
  return `${basis(dokument, einsatzId, dokumentId)}/${anlageId}/datei`;
}
