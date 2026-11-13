import type { ArchivEingespielt, ArchivEinspielenVerfuegbarkeit } from './types';
import { apiGet, apiUploadMitFortschritt, type UploadFortschritt } from './client';

/**
 * Archivblock in der Verwaltung einspielen (LLH-1711). Nur der System-Admin; eingespielt wird in
 * seine Organisation, und an einer Instanz, bei der sich eine andere meldet (Hub), gar nicht
 * (`verfuegbar: false`, Hochladen 422). Der Schlüssel geht vor dem Block: so endet ein
 * unbrauchbarer Aufruf, bevor der Block hochgeladen ist.
 */

const PFAD = '/api/admin/archiv/einspielen';

/**
 * Das Zeitlimit umfasst Upload UND Einspielen: 256 MiB über eine langsame Leitung plus
 * Entschlüsseln, Migrieren und Übernehmen. Eine hängende Leitung beendet schon die Leerlauf-Frist
 * des Servers (`transfer::LEERLAUF_FRIST`).
 */
const EINSPIELEN_TIMEOUT_MS = 30 * 60_000;

/** Der private Archiv-Schlüssel: als Datei gewählt oder als Text eingefügt. */
export type ArchivSchluesselEingabe = { art: 'datei'; datei: File } | { art: 'text'; text: string };

export interface ArchivEinspielenEingabe {
  block: File;
  schluessel: ArchivSchluesselEingabe;
  /** Nur für eine mit Passphrase geschützte Schlüsseldatei; leer heißt keine. */
  passphrase?: string;
}

export function ladeArchivEinspielenVerfuegbarkeit(): Promise<ArchivEinspielenVerfuegbarkeit> {
  return apiGet<ArchivEinspielenVerfuegbarkeit>(PFAD);
}

/**
 * Lädt Schlüssel und Block hoch und spielt ein. Über `XMLHttpRequest` mit Byte-Fortschritt wie
 * alle großen Uploads (`apiUploadMitFortschritt`, LFH-654): ein Block darf 256 MiB groß sein.
 */
export function spieleArchivEin(
  eingabe: ArchivEinspielenEingabe,
  onFortschritt?: (stand: UploadFortschritt) => void,
): Promise<ArchivEingespielt> {
  const fd = new FormData();
  if (eingabe.schluessel.art === 'datei') {
    fd.append('schluessel_datei', eingabe.schluessel.datei);
  } else {
    fd.append('schluessel', eingabe.schluessel.text);
  }
  if (eingabe.passphrase) fd.append('passphrase', eingabe.passphrase);
  fd.append('block', eingabe.block);
  return apiUploadMitFortschritt<ArchivEingespielt>(PFAD, fd, {
    timeoutMs: EINSPIELEN_TIMEOUT_MS,
    onFortschritt,
  });
}
