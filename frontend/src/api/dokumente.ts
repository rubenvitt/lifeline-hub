import { apiGet, apiSend, apiUpload } from './client';
import type { Dokument, DokumentKategorie } from './types';

/**
 * Höchstgröße einer Datei: 25 MiB, Spiegel von `MAX_GROESSE` in `src/anhang/mod.rs` (dort
 * `len > MAX_GROESSE` → 400 „Datei ist zu groß (25 MiB erlaubt)"). Der Dialog prüft vorab,
 * damit niemand 25 MiB über eine Mobilfunkstrecke schickt, nur um die Absage zu lesen.
 * Wer den Serverwert ändert, ändert diesen mit — es gibt keinen Codegen dafür.
 */
export const DOKUMENT_MAX_GROESSE = 25 * 1024 * 1024;

/**
 * Dateiauswahl der Dokument-Allowlist (`ERLAUBTE_MIME_DOKUMENT` in `src/anhang/mod.rs`:
 * Chat-Liste plus HEIC/HEIF und TIFF). Geteilt von `DokumentAblegenModal` und der
 * ETB-Schnellerfassung (LFH-117), deren Upload dieselbe Liste nimmt — eine Kopie liefe beim
 * nächsten Dateityp still auseinander. Der Server prüft ohnehin; das hier filtert nur den
 * Dateidialog vor.
 */
export const DOKUMENT_ACCEPT =
  '.pdf,.jpg,.jpeg,.png,.gif,.webp,.heic,.heif,.tif,.tiff,.txt,.csv,.docx,.xlsx,.pptx';

/** 25 MiB + clamd-Scan über eine Mobilfunkstrecke: 15 s reichen nicht (LFH-632). */
export const DOKUMENT_UPLOAD_TIMEOUT_MS = 120_000;

export type DokumentBezugTyp = 'abschnitt' | 'einheit' | 'etb_eintrag';

export interface DokumentAblage {
  datei: File;
  titel: string;
  kategorie: DokumentKategorie;
  bezug?: { typ: DokumentBezugTyp; id: number };
}

const basis = (einsatzId: number) => `/api/einsaetze/${einsatzId}/dokumente`;

export function listeDokumente(einsatzId: number): Promise<Dokument[]> {
  return apiGet<Dokument[]>(basis(einsatzId));
}

export function legeDokumentAb(einsatzId: number, eingabe: DokumentAblage): Promise<Dokument> {
  const fd = new FormData();
  fd.append('datei', eingabe.datei);
  fd.append('titel', eingabe.titel);
  fd.append('kategorie', eingabe.kategorie);
  if (eingabe.bezug) {
    fd.append('bezug_typ', eingabe.bezug.typ);
    fd.append('bezug_id', String(eingabe.bezug.id));
  }
  return apiUpload<Dokument>(basis(einsatzId), fd, { timeoutMs: DOKUMENT_UPLOAD_TIMEOUT_MS });
}

export function entferneDokument(einsatzId: number, dokumentId: number): Promise<void> {
  return apiSend<void>(`${basis(einsatzId)}/${dokumentId}`, 'DELETE');
}

/** Download über die modul-gegatete Route — nie über `/anhaenge` (dort 404, LFH-632 E8). */
export function dokumentDownloadPfad(einsatzId: number, dokumentId: number): string {
  return `${basis(einsatzId)}/${dokumentId}/datei`;
}
