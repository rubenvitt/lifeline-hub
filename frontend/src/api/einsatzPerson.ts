import type {
  Person,
  PersonAnhang,
  PersonDetail,
  PersonStatus,
  PersonZugriff,
  Sichtung,
  Sichtungskategorie,
  Verbleib,
  VerbleibArt,
  VerbleibStatus,
  Verlaufsnotiz,
  Abgleich,
} from './types';
import {
  apiDatei,
  apiGet,
  apiSend,
  apiUploadMitFortschritt,
  type ApiSendOptionen,
  type UploadFortschritt,
} from './client';
import { UPLOAD_TIMEOUT_MS } from './upload';
import { EXPORT_TIMEOUT_MS } from './exportTimeout';
import { patchBody } from './patchTriState';
import { registrierNummer } from '../anzeige/registrierNummer';

/** Felder, die beim Anlegen/Bearbeiten gesetzt werden können (alle optional). */
export interface PersonEingabe {
  name?: string | null;
  vorname?: string | null;
  geschlecht?: string | null;
  geburtsdatum?: string | null;
  alter_geschaetzt?: number | null;
  herkunft_adresse?: string | null;
  antreff_ort?: string | null;
  melder_kontakt?: string | null;
  notiz?: string | null;
  /** Zustand in Kurzform (Freitext). `null` leert im PATCH. */
  zustand?: string | null;
  /**
   * Fundort-Koordinate (WGS84). Nur als Paar: eine halbe Koordinate ist 422, im PATCH gegen den
   * Bestand geprüft; `{ antreff_lon: null }` allein scheitert also.
   */
  antreff_lat?: number | null;
  antreff_lon?: number | null;
  /**
   * „vermisst seit“ als `YYYY-MM-DD HH:MM:SS` in UTC. Nur bei Status `vermisst` (sonst 422),
   * höchstens 5 min in der Zukunft (sonst 400). Beim Anlegen ohne Angabe setzt der Server die
   * Meldezeit. Im PATCH ist `null` ein 400; das Feld darf deshalb nie über die Formular-Lesart
   * (`undefined` → `null`) mitlaufen, wenn es nicht gesetzt werden soll.
   */
  vermisst_seit?: string | null;
}

/** Offline-/Fastpath-fähige Anlage. `client_id` macht einen Replay nach
 * verloren gegangener Antwort idempotent; `status` vermeidet den unsicheren
 * zweiten Request bei „Vermisst“/„Betroffen“. */
export interface PersonAnlegenEingabe extends PersonEingabe {
  status?: Extract<PersonStatus, 'erfasst' | 'vermisst' | 'betroffen'>;
  client_id?: string;
  /**
   * Erst-Sichtung in derselben Anlage: das Backend schreibt sie in DERSELBEN Transaktion und hebt
   * `erfasst → betroffen`; die Antwort trägt bereits `aktuelle_sichtung`. Kein nachgeschobener
   * POST auf `/sichtung`: der liefe an der `client_id`-Idempotenz der Offline-Queue vorbei. Mit
   * `status: 'vermisst'` ist das 422.
   */
  sichtung?: Sichtungskategorie;
  /** Wartebereich-Eintritt in derselben Transaktion wie die Anlage (bleibt beim Offline-Replay an
   * der client_id); `vermisst` + UHS ist 422. */
  uhs_id?: number | null;
}

export function listePersonen(einsatzId: number, status?: PersonStatus): Promise<Person[]> {
  const q = status ? `?status=${status}` : '';
  return apiGet<Person[]>(`/api/einsaetze/${einsatzId}/personen${q}`);
}

/**
 * Personenliste für die Druckansicht (LFH-727). Schreibt serverseitig EINEN `druck`-Eintrag ins
 * Zugriffsprotokoll und liefert sonst dieselbe Menge wie `listePersonen`. Deshalb nie still
 * wiederholen und nie aus dem Cache der Liste ersetzen (`frontend/src/druck/AGENTS.md`).
 */
export function ladePersonenDruck(einsatzId: number): Promise<Person[]> {
  return apiGet<Person[]>(`/api/einsaetze/${einsatzId}/personen/druck`);
}

/** CSV aller nicht stornierten Personen des Einsatzes (`routes/einsatz_person.rs`, `export`).
 *  Schreibt serverseitig JE ABRUF einen `export`-Audit-Eintrag. */
export function ladePersonenExport(einsatzId: number): Promise<Blob> {
  return apiDatei(`/api/einsaetze/${einsatzId}/personen/export`, { timeoutMs: EXPORT_TIMEOUT_MS });
}

export function ladePerson(einsatzId: number, personId: number): Promise<PersonDetail> {
  // Schreibt serverseitig EINEN detail-Audit-Eintrag.
  return apiGet<PersonDetail>(`/api/einsaetze/${einsatzId}/personen/${personId}`);
}

export function legePersonAn(
  einsatzId: number,
  daten: PersonAnlegenEingabe,
  optionen?: ApiSendOptionen,
): Promise<Person> {
  return apiSend<Person>(`/api/einsaetze/${einsatzId}/personen`, 'POST', daten, optionen);
}

/** Bearbeitet die Identitäts-/Kontextfelder. `basisGeaendertAt` aktiviert das optimistische
 *  Lock (stimmt der Stand nicht mehr → 409); ohne ihn (Overwrite aus dem Konfliktdialog) wird
 *  bewusst blind überschrieben.
 *
 *  `daten` kommt aus EINEM Formular, deshalb die Formular-Lesart (`undefined` = geleert =
 *  löschen, siehe `api/patchTriState.ts`). Beim POST (`legePersonAn`) heißt `null` dagegen
 *  „nicht gesetzt“. */
export function aktualisierePerson(
  einsatzId: number,
  personId: number,
  daten: PersonEingabe,
  basisGeaendertAt?: string,
): Promise<Person> {
  const body = patchBody(daten, basisGeaendertAt);
  return apiSend<Person>(`/api/einsaetze/${einsatzId}/personen/${personId}`, 'PATCH', body);
}

export function setzePersonStatus(
  einsatzId: number,
  personId: number,
  status: PersonStatus,
): Promise<Person> {
  return apiSend<Person>(`/api/einsaetze/${einsatzId}/personen/${personId}/status`, 'POST', {
    status,
  });
}

export function stornierePerson(einsatzId: number, personId: number): Promise<void> {
  return apiSend<void>(`/api/einsaetze/${einsatzId}/personen/${personId}`, 'DELETE');
}

export function ladePersonAudit(einsatzId: number, personId: number): Promise<PersonZugriff[]> {
  return apiGet<PersonZugriff[]>(`/api/einsaetze/${einsatzId}/personen/${personId}/audit`);
}

/** Registriernummer-Anzeige wie im Backend (R-042). */
export function registrierAnzeige(nr: number): string {
  return registrierNummer('R', nr);
}

/** Sichtung (Triage) erfassen. Hebt erfasst→betroffen serverseitig an. */
export function erfasseSichtung(
  einsatzId: number,
  personId: number,
  kategorie: Sichtungskategorie,
  notiz?: string | null,
): Promise<Sichtung> {
  return apiSend<Sichtung>(`/api/einsaetze/${einsatzId}/personen/${personId}/sichtung`, 'POST', {
    kategorie,
    notiz: notiz ?? null,
  });
}

export interface VerbleibEingabe {
  art: VerbleibArt;
  transportmittel?: string | null;
  ziel?: string | null;
  status?: VerbleibStatus | null;
  notiz?: string | null;
  /**
   * Betreuungsstelle, nur bei `art: 'notunterkunft'` (sonst 422) und nur mit Lesezugriff auf das
   * Modul Betreuung (sonst 403). Der Server kopiert keinen Namen ins Ziel.
   */
  betreuungsstelle_id?: number | null;
}
export function erfasseVerbleib(
  einsatzId: number,
  personId: number,
  daten: VerbleibEingabe,
): Promise<Verbleib> {
  return apiSend<Verbleib>(
    `/api/einsaetze/${einsatzId}/personen/${personId}/verbleib`,
    'POST',
    daten,
  );
}

/** Befund-/Verlaufsnotiz (append-only, KEIN ETB-Eintrag). */
export function legeNotizAn(
  einsatzId: number,
  personId: number,
  text: string,
): Promise<Verlaufsnotiz> {
  return apiSend<Verlaufsnotiz>(
    `/api/einsaetze/${einsatzId}/personen/${personId}/notizen`,
    'POST',
    { text },
  );
}

/** Vermisstenabgleich vorschlagen (Verdacht). `vermisstPersonId` ist :pid. */
export function schlageAbgleichVor(
  einsatzId: number,
  vermisstPersonId: number,
  gefundenPersonId: number,
): Promise<Abgleich> {
  return apiSend<Abgleich>(
    `/api/einsaetze/${einsatzId}/personen/${vermisstPersonId}/abgleich`,
    'POST',
    { gefunden_person_id: gefundenPersonId },
  );
}

/** Abgleich entscheiden, nur Einsatzleitung. */
export function entscheideAbgleich(
  einsatzId: number,
  vermisstPersonId: number,
  abgleichId: number,
  entscheidung: 'bestaetigt' | 'verworfen',
): Promise<Abgleich> {
  return apiSend<Abgleich>(
    `/api/einsaetze/${einsatzId}/personen/${vermisstPersonId}/abgleich/${abgleichId}/entscheidung`,
    'POST',
    { entscheidung },
  );
}

// ---------- Fotos und Dateien (LFH-757) ----------

const anhangBasis = (einsatzId: number, personId: number) =>
  `/api/einsaetze/${einsatzId}/personen/${personId}/anhaenge`;

/** Lebende Anhänge einer Person, neueste zuerst. Die Liste schreibt serverseitig KEIN Audit. */
export function listePersonAnhaenge(einsatzId: number, personId: number): Promise<PersonAnhang[]> {
  return apiGet<PersonAnhang[]>(anhangBasis(einsatzId, personId));
}

/** Legt EINE Datei an der Person ab (Feld `datei`), Timeout und Fortschritt wie die übrigen Uploads. */
export function legePersonAnhangAb(
  einsatzId: number,
  personId: number,
  datei: File,
  onFortschritt?: (stand: UploadFortschritt) => void,
): Promise<PersonAnhang> {
  const fd = new FormData();
  fd.append('datei', datei);
  return apiUploadMitFortschritt<PersonAnhang>(anhangBasis(einsatzId, personId), fd, {
    timeoutMs: UPLOAD_TIMEOUT_MS,
    onFortschritt,
  });
}

/** Entfernt einen Anhang (Soft-Delete mit ETB-Nachweis); `anhangId` ist die Linker-id. */
export function entfernePersonAnhang(
  einsatzId: number,
  personId: number,
  anhangId: number,
): Promise<void> {
  return apiSend<void>(`${anhangBasis(einsatzId, personId)}/${anhangId}`, 'DELETE');
}

/**
 * Download über die Personenroute, nie über `/anhaenge/{aid}` des Einsatzes (dort 404). Jeder
 * Abruf — auch die Revalidierung mit 304 — schreibt serverseitig eine Zeile ins Zugriffsprotokoll
 * der Person; deshalb nur als Verweis, den eine Person bewusst auslöst, nie als Vorschau.
 */
export function personAnhangDownloadPfad(
  einsatzId: number,
  personId: number,
  anhangId: number,
): string {
  return `${anhangBasis(einsatzId, personId)}/${anhangId}/datei`;
}
