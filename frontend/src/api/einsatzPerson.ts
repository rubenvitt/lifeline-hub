import type {
  Bestaetiger,
  Fachrichtung,
  KoerperRegion,
  Massnahme,
  MassnahmeArt,
  Person,
  PersonAnhang,
  PersonAuswahl,
  PersonDetail,
  PersonStatus,
  PersonZugriff,
  Sichtung,
  Sichtungskategorie,
  Transport,
  TransportArt,
  TransportPrioritaet,
  TransportDurch,
  TransportmittelAuswahl,
  Verbleib,
  VerbleibArt,
  VerbleibStatus,
  Verlaufsnotiz,
  Verletzung,
  VerletzungAnsicht,
  VerletzungArt,
  VerletzungSchwere,
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
  /** PAT-Nummer (LLH-1326), höchstens `PAT_NUMMER_MAX` Zeichen; `null` leert. Nur im PATCH. */
  pat_nummer?: string | null;
  /** Kontamination: `true`/`false`, `null` = keine Angabe (nicht „nein“). Nur im PATCH. */
  kontamination?: boolean | null;
}

/**
 * Feld-CAS im PATCH (LLH-1103, design.md D1 der Change `f8218h1i-personendaten-feldweise`): je
 * geändertem Feld der Wert beim Öffnen, unter demselben Namen wie die Änderung. `null` heißt
 * „leer erwartet“, die Koordinate steht nur als Paar (`antreff_lat` und `antreff_lon`). Weicht
 * der gespeicherte Wert ab, antwortet der Server mit 409 und schreibt nichts; ein Feld hier, das
 * die Änderung nicht nennt, ist 400. Ohne `erwartet` schreibt der PATCH ohne Vergleich.
 */
export type PersonErwartet = PersonEingabe;

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
  /** Wer die Erst-Sichtung am Gerät namentlich bestätigt (LFH-1046): Kennung im Einsatzpersonal.
   * Nur mit `sichtung` und nur an einem gekoppelten Gerät, sonst 422. */
  bestaetigt_personal_id?: number | null;
  /** Wartebereich-Eintritt in derselben Transaktion wie die Anlage (bleibt beim Offline-Replay an
   * der client_id); `vermisst` + UHS ist 422. */
  uhs_id?: number | null;
  /** Erfassungszeit einer ohne Netz vorgemerkten Aufnahme (`YYYY-MM-DD HH:MM:SS`, UTC; LLH-1330):
   * Anlage, Erst-Sichtung und ihre ETB-Einträge tragen sie. Fehlt sie, gilt die Serverzeit. Setzt
   * nur die Warteschlange. */
  zeitpunkt_at?: string | null;
}

export function listePersonen(
  einsatzId: number,
  filter: { status?: PersonStatus; betreuungsstelleId?: number } = {},
): Promise<Person[]> {
  const q = new URLSearchParams();
  if (filter.status) q.set('status', filter.status);
  // LLH-1044: nur Personen, deren aktueller Verbleib diese Betreuungsstelle ist (Serverfilter,
  // dasselbe Recht wie die Liste, nicht protokolliert).
  if (filter.betreuungsstelleId != null) {
    q.set('betreuungsstelle_id', String(filter.betreuungsstelleId));
  }
  const qs = q.toString();
  return apiGet<Person[]>(`/api/einsaetze/${einsatzId}/personen${qs ? `?${qs}` : ''}`);
}

/**
 * Schlanke Auswahl je nicht stornierter Person (`id`, `registrier_nr`, `name`, `vorname`,
 * `status`) ohne Freitexte, für Picker, Sprungpalette und Chat-Bezug (LFH-940). Hinter
 * demselben Recht wie die Liste, ohne Zugriffsprotokoll.
 */
export function listePersonenAuswahl(einsatzId: number): Promise<PersonAuswahl[]> {
  return apiGet<PersonAuswahl[]>(`/api/einsaetze/${einsatzId}/personen/auswahl`);
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

/**
 * Druckansicht einer Person (LLH-1120, Spec `druck-dokumente`): dasselbe Detail, aber
 * serverseitig als `druck`-Eintrag mit Person im Zugriffsprotokoll. Nie still wiederholen und nie
 * aus dem Cache des Details ersetzen (`frontend/src/druck/AGENTS.md`, Personendruck).
 */
export function loadPersonDruck(einsatzId: number, personId: number): Promise<PersonDetail> {
  return apiGet<PersonDetail>(`/api/einsaetze/${einsatzId}/personen/${personId}/druck`);
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

/**
 * Die einzeln schreibbaren Personendaten (LLH-1103, Spec `personendaten-bearbeiten`) mit ihrem
 * Wire-Wert; `null` leert. Die Koordinate ist EIN Feld und geht als Paar `antreff_lat`/`antreff_lon`.
 * „vermisst seit“ lässt sich nicht leeren (`null` ist am Server 400).
 */
export interface PersonFeldEingabe {
  name: string | null;
  vorname: string | null;
  geschlecht: string | null;
  geburtsdatum: string | null;
  alter_geschaetzt: number | null;
  herkunft_adresse: string | null;
  antreff_ort: string | null;
  melder_kontakt: string | null;
  notiz: string | null;
  koordinate: { lat: number; lon: number } | null;
  vermisst_seit: string;
}
export type PersonFeld = keyof PersonFeldEingabe;

function feldAufWire<K extends PersonFeld>(feld: K, wert: PersonFeldEingabe[K]): PersonEingabe {
  if (feld === 'koordinate') {
    const k = wert as PersonFeldEingabe['koordinate'];
    return { antreff_lat: k?.lat ?? null, antreff_lon: k?.lon ?? null };
  }
  return { [feld]: wert } as PersonEingabe;
}

/**
 * Ein Feld der Personendaten schreiben, mit Feld-CAS (design.md D1): `erwartet` ist der Wert beim
 * Öffnen (`null` = leer); weicht der gespeicherte ab, antwortet der Server mit 409 und schreibt
 * nichts. `erwartet` `undefined` schreibt ohne Vergleich („Überschreiben“ nach der Rückfrage).
 * Der Body nennt nur dieses Feld, kein anderes wird geleert; `aktualisierePerson` bleibt für den
 * Kopf (Zustand, PAT) und andere Aufrufer.
 */
export function savePersonFeld<K extends PersonFeld>(
  einsatzId: number,
  personId: number,
  feld: K,
  wert: PersonFeldEingabe[K],
  erwartet: PersonFeldEingabe[K] | undefined,
): Promise<Person> {
  const body: PersonEingabe & { erwartet?: PersonErwartet } = feldAufWire(feld, wert);
  if (erwartet !== undefined) body.erwartet = feldAufWire(feld, erwartet);
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

/**
 * Zugriffe auf die ganze Personenliste (Export, Druck), neueste zuerst (LFH-916). Nur die
 * Einsatzleitung (sonst 403); der Abruf wird selbst nicht protokolliert.
 */
export function ladePersonenListenzugriffe(einsatzId: number): Promise<PersonZugriff[]> {
  return apiGet<PersonZugriff[]>(`/api/einsaetze/${einsatzId}/personen/listenzugriffe`);
}

/** Registriernummer-Anzeige wie im Backend (R-042). */
export function registrierAnzeige(nr: number): string {
  return registrierNummer('R', nr);
}

/**
 * Ohne Netz vormerkbar (LLH-1138, Spec `personen-verlauf`): jeder medizinische Eintrag einer
 * Person nimmt `client_id` (Replay ohne zweiten Eintrag) und `zeitpunkt_at` (Erfassungszeit,
 * serverseitig gekappt). Gesetzt werden beide nur über `offline/schreiben.ts`.
 */
export interface OfflineEintragEingabe {
  client_id?: string | null;
  zeitpunkt_at?: string | null;
}

/** Eine Nachsichtung. `bestaetigt_personal_id` nennt am Gerät die bestätigende Person (LFH-1046);
 * eine Person schickt es nie (422). */
export interface SichtungEingabe extends OfflineEintragEingabe {
  kategorie: Sichtungskategorie;
  notiz?: string | null;
  bestaetigt_personal_id?: number | null;
}

/** Sichtung (Triage) erfassen. Hebt erfasst→betroffen serverseitig an. */
export function erfasseSichtung(
  einsatzId: number,
  personId: number,
  eingabe: SichtungEingabe,
  optionen?: ApiSendOptionen,
): Promise<Sichtung> {
  const { bestaetigt_personal_id, notiz, ...rest } = eingabe;
  return apiSend<Sichtung>(
    `/api/einsaetze/${einsatzId}/personen/${personId}/sichtung`,
    'POST',
    {
      ...rest,
      notiz: notiz ?? null,
      ...(bestaetigt_personal_id != null ? { bestaetigt_personal_id } : {}),
    },
    optionen,
  );
}

/** Auswahl „Bestätigt von“ am UHS-Gerät (LFH-1046): das Personal des Einsatzes. Eine Person und
 * der Lagemonitor bekommen 403. */
export function ladeBestaetiger(einsatzId: number): Promise<Bestaetiger[]> {
  return apiGet<Bestaetiger[]>(`/api/einsaetze/${einsatzId}/personen/bestaetiger`);
}

/** Vorschläge zum Rettungsmittel der Verbleib-Maske (LLH-1332, Spec `patienten-uebergabe`). */
export function ladeTransportmittel(einsatzId: number): Promise<TransportmittelAuswahl> {
  return apiGet<TransportmittelAuswahl>(`/api/einsaetze/${einsatzId}/personen/transportmittel`);
}

export interface VerbleibEingabe extends OfflineEintragEingabe {
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
  /** Wer den Verbleib am Gerät namentlich bestätigt (LFH-1046); eine Person schickt es nie. */
  bestaetigt_personal_id?: number | null;
  /** Wer fährt (LLH-1332), nur bei `art: 'transport'`. */
  transport_durch?: TransportDurch | null;
  /** Disposition des Fahrzeugs eines Eigentransports (LLH-1332), Pflicht bei `eigen`. */
  einsatz_fahrzeug_id?: number | null;
}
export function erfasseVerbleib(
  einsatzId: number,
  personId: number,
  daten: VerbleibEingabe,
  optionen?: ApiSendOptionen,
): Promise<Verbleib> {
  return apiSend<Verbleib>(
    `/api/einsaetze/${einsatzId}/personen/${personId}/verbleib`,
    'POST',
    daten,
    optionen,
  );
}

/** Eine Verlaufsnotiz; ihr Text liegt ohne Netz in der Warteschlange (design.md D8). */
export interface NotizEingabe extends OfflineEintragEingabe {
  text: string;
}

/** Befund-/Verlaufsnotiz (append-only, KEIN ETB-Eintrag). */
export function legeNotizAn(
  einsatzId: number,
  personId: number,
  eingabe: NotizEingabe,
  optionen?: ApiSendOptionen,
): Promise<Verlaufsnotiz> {
  return apiSend<Verlaufsnotiz>(
    `/api/einsaetze/${einsatzId}/personen/${personId}/notizen`,
    'POST',
    eingabe,
    optionen,
  );
}

// ---------- PAT-Kern: Transport, Maßnahmen, Verletzungen (Change `y18v58dt-pat-kern`) ----------
//
// Je Schreibweg GENAU EINE Funktion, und jede Oberfläche ruft sie nur über ihre eine Mutation im
// Patientenkopf, dort über `offline/schreiben.ts` (`savePersonEintragOfflineCapable`, design.md
// D8). Das Aufheben bleibt online: seine Route kennt weder `client_id` noch Erfassungszeit.

/** Ein voller Transportstand (Spec `personen-transport`): jedes Feld einzeln leer, alle drei leer
 * heben den Transport auf. Am Gerät optional „Bestätigt von“ (LFH-1046). */
export interface TransportEingabe extends OfflineEintragEingabe {
  prioritaet: TransportPrioritaet | null;
  art: TransportArt | null;
  fachrichtung: Fachrichtung | null;
  bestaetigt_personal_id?: number | null;
}

/** Transport festlegen: ein neuer Eintrag im Verlauf; ETB nur beim Wechsel der Priorität. */
export function saveTransport(
  einsatzId: number,
  personId: number,
  eingabe: TransportEingabe,
  optionen?: ApiSendOptionen,
): Promise<Transport> {
  return apiSend<Transport>(
    `/api/einsaetze/${einsatzId}/personen/${personId}/transport`,
    'POST',
    eingabe,
    optionen,
  );
}

/** Eine Maßnahme aus dem festen Katalog (Spec `personen-massnahmen`); ohne `zeitpunkt_at` gilt die
 * Erfassung als Durchführung (vorgemerkt: die Zeit des Vormerkens). Kein ETB. */
export interface MassnahmeEingabe extends OfflineEintragEingabe {
  art: MassnahmeArt;
  bestaetigt_personal_id?: number | null;
}

export function createMassnahme(
  einsatzId: number,
  personId: number,
  eingabe: MassnahmeEingabe,
  optionen?: ApiSendOptionen,
): Promise<Massnahme> {
  return apiSend<Massnahme>(
    `/api/einsaetze/${einsatzId}/personen/${personId}/massnahmen`,
    'POST',
    eingabe,
    optionen,
  );
}

/** Hebt eine Maßnahme genau einmal auf (zweites Aufheben 409). */
export function revokeMassnahme(
  einsatzId: number,
  personId: number,
  massnahmeId: number,
): Promise<Massnahme> {
  return apiSend<Massnahme>(
    `/api/einsaetze/${einsatzId}/personen/${personId}/massnahmen/${massnahmeId}/aufheben`,
    'POST',
  );
}

/** Eine Verletzung am Körperschema (Spec `personen-verletzungen`): Region muss in der Ansicht
 * liegen (sonst 422), die Lage `x`/`y` nur als Paar, je 0..1. Kein ETB. */
export interface VerletzungEingabe extends OfflineEintragEingabe {
  ansicht: VerletzungAnsicht;
  region: KoerperRegion;
  art: VerletzungArt;
  schwere?: VerletzungSchwere | null;
  x?: number;
  y?: number;
  notiz?: string | null;
  bestaetigt_personal_id?: number | null;
}

export function createVerletzung(
  einsatzId: number,
  personId: number,
  eingabe: VerletzungEingabe,
  optionen?: ApiSendOptionen,
): Promise<Verletzung> {
  return apiSend<Verletzung>(
    `/api/einsaetze/${einsatzId}/personen/${personId}/verletzungen`,
    'POST',
    eingabe,
    optionen,
  );
}

/** Hebt eine Verletzung genau einmal auf; die Nummer am Schema bleibt frei (Lücke). */
export function revokeVerletzung(
  einsatzId: number,
  personId: number,
  verletzungId: number,
): Promise<Verletzung> {
  return apiSend<Verletzung>(
    `/api/einsaetze/${einsatzId}/personen/${personId}/verletzungen/${verletzungId}/aufheben`,
    'POST',
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
