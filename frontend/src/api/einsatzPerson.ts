import type {
  Person, PersonDetail, PersonStatus, PersonZugriff,
  Sichtung, Sichtungskategorie, Verbleib, VerbleibArt, VerbleibStatus,
  Verlaufsnotiz, Abgleich,
} from './types';
import { apiGet, apiSend, type ApiSendOptionen } from './client';
import { patchBody } from './patchTriState';

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
}

/** Offline-/Fastpath-fähige Anlage. `client_id` macht einen Replay nach
 * verloren gegangener Antwort idempotent; `status` vermeidet den unsicheren
 * zweiten Request bei „Vermisst“/„Betroffen“. */
export interface PersonAnlegenEingabe extends PersonEingabe {
  status?: Extract<PersonStatus, 'erfasst' | 'vermisst' | 'betroffen'>;
  client_id?: string;
  /**
   * Erst-Sichtung in derselben Anlage (LFH-340 · C5). Das Backend schreibt sie in DERSELBEN
   * Transaktion und hebt `erfasst → betroffen`; die Antwort trägt bereits `aktuelle_sichtung`.
   *
   * Kein nachgeschobener POST auf `/sichtung`: der liefe an der Offline-Queue vorbei, deren
   * Idempotenz an `client_id` DIESES Requests hängt. Serverseitig ist die Kombination mit
   * `status: 'vermisst'` ein 422 — eine vermisste Person ist nicht angetroffen.
   */
  sichtung?: Sichtungskategorie;
  /** Wartebereich-Eintritt in derselben Transaktion wie die Anlage (LFH-458).
   * Bleibt beim Offline-Replay an der client_id; `vermisst` + UHS ist 422. */
  uhs_id?: number | null;
}

export function listePersonen(einsatzId: number, status?: PersonStatus): Promise<Person[]> {
  const q = status ? `?status=${status}` : '';
  return apiGet<Person[]>(`/api/einsaetze/${einsatzId}/personen${q}`);
}

export function ladePerson(einsatzId: number, personId: number): Promise<PersonDetail> {
  // Schreibt serverseitig EINEN detail-Audit-Eintrag (E‑1-Mechanik, unverändert
  // in E‑2 — der medizinische Verlauf ist Teil derselben Antwort).
  return apiGet<PersonDetail>(`/api/einsaetze/${einsatzId}/personen/${personId}`);
}

export function legePersonAn(
  einsatzId: number,
  daten: PersonAnlegenEingabe,
  optionen?: ApiSendOptionen,
): Promise<Person> {
  return apiSend<Person>(`/api/einsaetze/${einsatzId}/personen`, 'POST', daten, optionen);
}

/** Bearbeitet die Identitäts-/Kontextfelder. `basisGeaendertAt` (der beim Laden gelesene Stand,
 *  LFH-241/F10) aktiviert das optimistische Lock: stimmt er serverseitig nicht mehr → 409. Ohne
 *  ihn (Overwrite aus dem Konfliktdialog) wird bewusst blind überschrieben.
 *
 *  PATCH-Semantik (LFH-266/F12): ein gesendetes `null` LEERT das Feld, ein fehlender Key lässt
 *  es unverändert. Geleerte Formularfelder werden dafür zu `null` normalisiert — die Regeln
 *  samt der `undefined`-Falle stehen an `api/patchTriState.ts`. `daten` kommt hier aus EINEM
 *  Formular, deshalb die formular-Lesart (`undefined` = geleert = löschen). Beim POST
 *  (`legePersonAn`) gilt das NICHT — dort heißt `null` schlicht „nicht gesetzt". */
export function aktualisierePerson(
  einsatzId: number,
  personId: number,
  daten: PersonEingabe,
  basisGeaendertAt?: string,
): Promise<Person> {
  const body = patchBody(daten, basisGeaendertAt);
  return apiSend<Person>(`/api/einsaetze/${einsatzId}/personen/${personId}`, 'PATCH', body);
}

export function setzePersonStatus(einsatzId: number, personId: number, status: PersonStatus): Promise<Person> {
  return apiSend<Person>(`/api/einsaetze/${einsatzId}/personen/${personId}/status`, 'POST', { status });
}

export function stornierePerson(einsatzId: number, personId: number): Promise<void> {
  return apiSend<void>(`/api/einsaetze/${einsatzId}/personen/${personId}`, 'DELETE');
}

export function ladePersonAudit(einsatzId: number, personId: number): Promise<PersonZugriff[]> {
  return apiGet<PersonZugriff[]>(`/api/einsaetze/${einsatzId}/personen/${personId}/audit`);
}

/** Registriernummer-Anzeige wie im Backend (R-042). */
export function registrierAnzeige(nr: number): string {
  return `R-${String(nr).padStart(3, '0')}`;
}

/** E‑2: Sichtung (Triage) erfassen. Hebt erfasst→betroffen serverseitig an. */
export function erfasseSichtung(
  einsatzId: number, personId: number,
  kategorie: Sichtungskategorie, notiz?: string | null,
): Promise<Sichtung> {
  return apiSend<Sichtung>(
    `/api/einsaetze/${einsatzId}/personen/${personId}/sichtung`,
    'POST', { kategorie, notiz: notiz ?? null },
  );
}

export interface VerbleibEingabe {
  art: VerbleibArt;
  transportmittel?: string | null;
  ziel?: string | null;
  status?: VerbleibStatus | null;
  notiz?: string | null;
}
export function erfasseVerbleib(
  einsatzId: number, personId: number, daten: VerbleibEingabe,
): Promise<Verbleib> {
  return apiSend<Verbleib>(
    `/api/einsaetze/${einsatzId}/personen/${personId}/verbleib`, 'POST', daten,
  );
}

/** E‑2: Befund-/Verlaufsnotiz (append-only, KEIN ETB-Eintrag). */
export function legeNotizAn(
  einsatzId: number, personId: number, text: string,
): Promise<Verlaufsnotiz> {
  return apiSend<Verlaufsnotiz>(
    `/api/einsaetze/${einsatzId}/personen/${personId}/notizen`, 'POST', { text },
  );
}

/** E‑2: Vermisstenabgleich vorschlagen (Verdacht). `vermisstPersonId` ist :pid. */
export function schlageAbgleichVor(
  einsatzId: number, vermisstPersonId: number, gefundenPersonId: number,
): Promise<Abgleich> {
  return apiSend<Abgleich>(
    `/api/einsaetze/${einsatzId}/personen/${vermisstPersonId}/abgleich`,
    'POST', { gefunden_person_id: gefundenPersonId },
  );
}

/** E‑2: Abgleich entscheiden — nur Einsatzleitung. */
export function entscheideAbgleich(
  einsatzId: number, vermisstPersonId: number, abgleichId: number,
  entscheidung: 'bestaetigt' | 'verworfen',
): Promise<Abgleich> {
  return apiSend<Abgleich>(
    `/api/einsaetze/${einsatzId}/personen/${vermisstPersonId}/abgleich/${abgleichId}/entscheidung`,
    'POST', { entscheidung },
  );
}
