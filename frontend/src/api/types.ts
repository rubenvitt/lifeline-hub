export type SystemRolle = 'admin' | 'keiner';
export type OrgRolle = 'fuehrungskraft' | 'keine';

export interface BenutzerAnzeige {
  id: number;
  anzeigename: string;
  benutzername: string;
  system_rolle: SystemRolle;
  org_rolle: OrgRolle;
  aktiv: boolean;
  erstellt_at: string;
}

export type EinsatzStatus = 'aktiv' | 'abgeschlossen';
export type EinsatzRolle = 'einsatzleitung' | 'fuehrungspersonal' | 'beobachter';
export type Einsatzart = 'realeinsatz' | 'uebung' | 'sanitaetsdienst' | 'bereitstellung';

export interface EinsatzAnzeige {
  id: number;
  bezeichnung: string;
  stichwort: string | null;
  status: EinsatzStatus;
  begonnen_at: string;
  abgeschlossen_at: string | null;
  abgeschlossen_von: number | null;
  einsatzart: Einsatzart;
  einsatznummer_intern: string | null;
  /** Read-only technischer Anlage-Zeitpunkt (Audit-Spur). */
  angelegt_at: string;
  leitstellen_nr: string | null;
  einsatzort: string | null;
  einsatzort_lat: number | null;
  einsatzort_lon: number | null;
  meldende_stelle: string | null;
  sachverhalt: string | null;
  anzahl_betroffene_initial: number | null;
  /** Rolle des abfragenden Benutzers; null = kein Mitglied. */
  meine_rolle: EinsatzRolle | null;
  /** Eigene Organisation des Einsatzes (Träger). */
  org_id: number;
  org_name: string;
}

export interface MitgliedAnzeige {
  benutzer_id: number;
  anzeigename: string;
  benutzername: string;
  einsatz_rolle: EinsatzRolle;
  zugewiesen_at: string;
}

/** Sichtbarkeit der externen Lage-Layer (LFH-69) als Karten-Default pro Einsatz. */
export interface FachebenenSichtbar {
  nina: boolean;
  dwd: boolean;
  pegelonline: boolean;
  kritis: boolean;
}

/** Basemap-Modus als Karten-Default pro Einsatz. */
export type BasemapModus = 'online' | 'offline' | 'blind';

/**
 * Einsatz-Einstellungen (LFH-55/131). `fachebenen_sichtbar` wird vom Backend
 * (EinstellungenAnzeige) als Objekt geliefert; `null` = nicht gesetzt → Default.
 */
export interface EinsatzEinstellungen {
  einsatz_id: number;
  standard_modul: string | null;
  basemap_modus: BasemapModus | null;
  karten_zoom_start: number | null;
  fachebenen_sichtbar: FachebenenSichtbar | null;
  geaendert_at: string | null;
  geaendert_von: number | null;
}

/** PUT-Eingabe (Vollersatz) der Einsatz-Einstellungen. */
export interface EinstellungenUpdate {
  standard_modul: string | null;
  basemap_modus: BasemapModus | null;
  karten_zoom_start: number | null;
  fachebenen_sichtbar: FachebenenSichtbar | null;
}

/**
 * Modul-Override pro Einsatz (LFH-132): überschreibt Sichtbarkeit und benötigte
 * Rolle eines Moduls. `benoetigte_rolle = null` = frei (für alle sichtbaren).
 */
export interface ModulOverride {
  einsatz_id: number;
  modul_key: string;
  sichtbar: boolean;
  benoetigte_rolle: 'admin' | 'fuehrungskraft' | null;
  geaendert_at: string | null;
  geaendert_von: number | null;
}

/** Map `modul_key → Override`; fehlt ein Key, gilt der Registry-Default (sichtbar, frei). */
export type ModulOverrides = Record<string, ModulOverride>;

/** PUT-Eingabe eines einzelnen Modul-Overrides. */
export interface ModulOverrideUpdate {
  sichtbar: boolean;
  benoetigte_rolle: 'admin' | 'fuehrungskraft' | null;
}

/** Org-weiter Einsatzstichwort-Vorschlag für die Combobox. */
export interface StichwortVorschlag {
  id: number;
  text: string;
}

/** 'system' wird vom Server automatisch erzeugt und ist nicht client-erfassbar. */
export type EtbTyp = 'meldung' | 'anordnung' | 'lage' | 'entscheidung' | 'system' | 'berichtigung';
export type MeldeWeg = 'funk' | 'telefon' | 'persoenlich' | 'sonstige';

export interface EtbEintragAnzeige {
  id: number;
  lfd_nr: number;
  typ: EtbTyp;
  inhalt: string;
  von: string | null;
  an: string | null;
  meldeweg: MeldeWeg | null;
  veranlassung: string | null;
  erfasser_id: number;
  erfasser_name: string;
  /** SQLite-Format 'YYYY-MM-DD HH:MM:SS' (UTC). */
  ereigniszeit: string;
  received_at: string;
  erfasst_lokal_at: string | null;
  berichtigt_eintrag_id: number | null;
}

export interface EtbBaustein {
  id: number;
  label: string;
  typ: EtbTyp;
  inhalt: string;
  meldeweg: MeldeWeg | null;
  veranlassung: string | null;
  sortier: number;
}

export type Dienststatus = 'in_dienst' | 'ausser_dienst';
export type StatusKategorie = 'verfuegbar' | 'gebunden' | 'nicht_verfuegbar';

/** Taktische Stärke (F/UF/M); Gesamt = Summe (Frontend berechnet bei Bedarf). */
export interface Staerke {
  fuehrer: number;
  unterfuehrer: number;
  mannschaft: number;
}

export interface Fahrzeug {
  id: number;
  funkrufname: string;
  fahrzeugtyp: string | null;
  traegerorganisation: string | null;
  kennzeichen: string | null;
  opta: string | null;
  standort: string | null;
  fms_issi: string | null;
  sondersignal: boolean;
  tragenkapazitaet: number | null;
  staerke: Staerke | null;
  bemerkung: string | null;
  dienststatus: Dienststatus;
  angelegt_at: string;
}

/** Bereits verwendete Werte je Stamm-Feld (DISTINCT) für die Comboboxen. */
export interface FahrzeugVorschlaege {
  fahrzeugtyp: string[];
  traegerorganisation: string[];
  standort: string[];
}

export interface FahrzeugStatus {
  id: number;
  label: string;
  kategorie: StatusKategorie;
  farbe: string | null;
  fms_anker: number | null;
  sortier: number;
}

/** Aufgelöste Dispositionszeile (Live/Snapshot serverseitig gewählt). */
export interface EinsatzFahrzeug {
  id: number;
  einsatz_id: number;
  fahrzeug_id: number | null;
  einheit_id: number | null;
  ist_adhoc: boolean;
  funkrufname: string;
  kennzeichen: string | null;
  fahrzeugtyp: string | null;
  opta: string | null;
  traegerorganisation: string | null;
  status_id: number | null;
  status_label: string | null;
  status_kategorie: StatusKategorie | null;
  status_farbe: string | null;
  bemerkung: string | null;
  disponiert_at: string;
  disponiert_von: number | null;
  // L‑2: taktische Verortung auf der Lagekarte.
  lat: number | null;
  lon: number | null;
  tz_fachaufgabe: string | null;
  tz_organisation: string | null;
  /** BR‑1: aktuell bereitgestellter Bereitstellungsraum (null = in keinem BR). */
  aktueller_br_id: number | null;
}

export type MaterialStatus =
  | 'einsatzbereit'
  | 'im_einsatz'
  | 'defekt'
  | 'verbraucht'
  | 'desinfektion_noetig';

export interface Material {
  id: number;
  bezeichnung: string;
  kategorie: string | null;
  bestandsnummer: string | null;
  traegerorganisation: string | null;
  standort: string | null;
  bemerkung: string | null;
  dienststatus: Dienststatus;
  angelegt_at: string;
}

/** Aufgelöste Material-Dispositionszeile (Live/Snapshot serverseitig gewählt). */
export interface EinsatzMaterial {
  id: number;
  einsatz_id: number;
  material_id: number | null;
  einheit_id: number | null;
  /** E‑3: zugeordnete UHS (null = nicht verortet). */
  uhs_id: number | null;
  ist_adhoc: boolean;
  bezeichnung: string;
  kategorie: string | null;
  bestandsnummer: string | null;
  traegerorganisation: string | null;
  menge: number;
  status: MaterialStatus;
  bemerkung: string | null;
  disponiert_at: string;
  disponiert_von: number | null;
}

/** Material-Mitglied einer Einheit. */
export interface EinheitMitgliedMaterial {
  em_id: number;
  bezeichnung: string;
  menge: number;
  status: MaterialStatus;
}

export type StaerkePosition = 'fuehrer' | 'unterfuehrer' | 'mannschaft';

/** Aufgelöste Qualifikation einer Person (inkl. deaktivierter Zuordnungen). */
export interface QualifikationRef {
  id: number;
  label: string;
}

export interface Personal {
  id: number;
  benutzer_id: number | null;
  name: string;
  personalnummer: string | null;
  traegerorganisation: string | null;
  telefon: string | null;
  staerke_position: StaerkePosition | null;
  bemerkung: string | null;
  dienststatus: Dienststatus;
  angelegt_at: string;
  qualifikationen: QualifikationRef[];
}

/** Bereits verwendete Trägerorganisationen (DISTINCT) für die Combobox. */
export interface PersonalVorschlaege {
  traegerorganisation: string[];
}

/** Qualifikations-Katalog-Eintrag. */
export interface Qualifikation {
  id: number;
  label: string;
  sortier: number;
}

/** Personal-Status-Katalog-Eintrag (wie FahrzeugStatus, ohne fms_anker). */
export interface PersonalStatus {
  id: number;
  label: string;
  kategorie: StatusKategorie;
  farbe: string | null;
  sortier: number;
}

/** Einheitstyp-Katalog-Eintrag (org-weit) mit optionaler Standard-Soll-Stärke. */
export interface EinheitTyp {
  id: number;
  label: string;
  /** null, wenn der Typ keine Soll-Stärke definiert (z. B. „Sonstige"). */
  soll: Staerke | null;
  sortier: number;
}

/** Aufgelöste Dispositionszeile (Live/Snapshot serverseitig gewählt). */
export interface EinsatzPersonal {
  id: number;
  einsatz_id: number;
  personal_id: number | null;
  einheit_id: number | null;
  ist_adhoc: boolean;
  name: string;
  funktion: string | null;
  traegerorganisation: string | null;
  staerke_position: StaerkePosition | null;
  status_id: number | null;
  status_label: string | null;
  status_kategorie: StatusKategorie | null;
  status_farbe: string | null;
  bemerkung: string | null;
  disponiert_at: string;
  disponiert_von: number | null;
}

/** Aufgelöster Einsatzabschnitt (flach; Baum baut das FE über ueber_abschnitt_id). */
export interface Einsatzabschnitt {
  id: number;
  einsatz_id: number;
  ueber_abschnitt_id: number | null;
  name: string;
  leiter_id: number | null;
  leiter_name: string | null;
  bemerkung: string | null;
  sortier: number;
  // L‑2: taktische Fläche (GeoJSON-String) und Verortungs-Metadaten.
  flaeche_geojson: string | null;
  tz_fachaufgabe: string | null;
  tz_organisation: string | null;
  // LFH-86: Funk-/Kommunikations-Stammdaten je Abschnitt (einsatz-scoped).
  sprechgruppe_tmo: string | null;
  sprechgruppe_dmo: string | null;
  kommunikationsmittel: string | null;
  erreichbarkeit: string | null;
}

/** Personal-Mitglied einer Einheit (leichtgewichtig). */
export interface EinheitMitgliedPerson {
  ep_id: number;
  name: string;
  funktion: string | null;
  staerke_position: StaerkePosition | null;
  ist_fuehrer: boolean;
}

/** Fahrzeug-Mitglied einer Einheit. */
export interface EinheitMitgliedFahrzeug {
  ef_id: number;
  funkrufname: string;
  fahrzeugtyp: string | null;
}

/** Aufgelöste Einheit inkl. Mitgliedern und Soll/Ist-Stärke. */
export interface Einheit {
  id: number;
  einsatz_id: number;
  abschnitt_id: number | null;
  abschnitt_name: string | null;
  ueber_einheit_id: number | null;
  typ_id: number | null;
  typ_label: string | null;
  name: string;
  fuehrer_id: number | null;
  fuehrer_name: string | null;
  bemerkung: string | null;
  sortier: number;
  /** null, wenn weder Override noch Typ eine Soll-Stärke liefern. */
  soll: Staerke | null;
  ist: Staerke;
  ist_kumuliert: Staerke;
  personal_mitglieder: EinheitMitgliedPerson[];
  fahrzeug_mitglieder: EinheitMitgliedFahrzeug[];
  material_mitglieder: EinheitMitgliedMaterial[];
  // L‑2: taktische Verortung auf der Lagekarte.
  lat: number | null;
  lon: number | null;
  tz_fachaufgabe: string | null;
  tz_organisation: string | null;
  /** BR‑1: aktuell bereitgestellter Bereitstellungsraum (null = in keinem BR). */
  aktueller_br_id: number | null;
}

/** L‑2: Führungskraft-Marker für die Lagekarte (aus GET …/karte/fuehrungskraefte
 *  bzw. Rückgabe von PATCH …/personal/{ep_id}/position). */
export interface FuehrungskraftKarte {
  id: number;
  einsatz_id: number;
  name: string;
  lat: number | null;
  lon: number | null;
  tz_fachaufgabe: string | null;
  tz_organisation: string | null;
  ist_einheitsfuehrer: boolean;
  ist_abschnittsleiter: boolean;
}

/** L‑2: Organisations-Stammdaten inkl. taktischer Default-Organisation. */
export interface OrganisationInfo {
  id: number;
  name: string;
  tz_organisation: string | null;
}

export type PersonStatus = 'erfasst' | 'vermisst' | 'betroffen' | 'verstorben' | 'abgemeldet';
export type Geschlecht = 'maennlich' | 'weiblich' | 'divers' | 'unbekannt';

export interface Person {
  id: number;
  einsatz_id: number;
  registrier_nr: number;
  status: PersonStatus;
  name: string | null;
  vorname: string | null;
  geschlecht: Geschlecht | null;
  geburtsdatum: string | null;
  alter_geschaetzt: number | null;
  herkunft_adresse: string | null;
  antreff_ort: string | null;
  melder_kontakt: string | null;
  notiz: string | null;
  erfasst_at: string;
  erfasst_von: number;
  geaendert_at: string;
  geaendert_von: number;
  storniert_at: string | null;
  // E‑2: medizinischer Cache (null = ungesichtet / vor Ort)
  aktuelle_sichtung: Sichtungskategorie | null;
  aktuelle_sichtung_at: string | null;
  aktueller_verbleib: string | null;
  // E‑3: UHS-Cache (null = nicht in UHS)
  aktuelle_uhs_id: number | null;
  aktueller_platz_id: number | null;
}

export type Sichtungskategorie = 'sk1' | 'sk2' | 'sk3' | 'sk4' | 'tot' | 'unverletzt';
export type VerbleibArt = 'transport' | 'entlassung' | 'vor_ort' | 'verstorben';
export type VerbleibStatus = 'angemeldet' | 'abtransportiert';
export type AbgleichStatus = 'verdacht' | 'bestaetigt' | 'verworfen';

export interface Sichtung {
  id: number;
  einsatz_id: number;
  person_id: number;
  kategorie: Sichtungskategorie;
  notiz: string | null;
  gesichtet_at: string;
  gesichtet_von: number;
}

export interface Verlaufsnotiz {
  id: number;
  einsatz_id: number;
  person_id: number;
  text: string;
  erfasst_at: string;
  erfasst_von: number;
}

export interface Verbleib {
  id: number;
  einsatz_id: number;
  person_id: number;
  art: VerbleibArt;
  transportmittel: string | null;
  ziel: string | null;
  status: VerbleibStatus | null;
  notiz: string | null;
  zeitpunkt_at: string;
  erfasst_von: number;
}

export interface Abgleich {
  id: number;
  einsatz_id: number;
  vermisst_person_id: number;
  gefunden_person_id: number;
  status: AbgleichStatus;
  erstellt_at: string;
  erstellt_von: number;
  entschieden_at: string | null;
  entschieden_von: number | null;
}

/** Detail-Antwort: alle Person-Felder PLUS die vier E‑2-Verlauf-Arrays. */
export interface PersonDetail extends Person {
  sichtungen: Sichtung[];
  notizen: Verlaufsnotiz[];
  verbleib: Verbleib[];
  abgleiche: Abgleich[];
}

export interface PersonZugriff {
  id: number;
  person_id: number | null;
  benutzer_id: number;
  benutzer_name: string;
  art: 'detail' | 'export';
  zugriff_at: string;
}

// ============================== E‑3 Unfallhilfsstellen ==============================

export type UhsTyp =
  | 'patientenablage' | 'behandlungsplatz' | 'verletztensammelstelle'
  | 'sonstige';

export type UhsStatus = 'geplant' | 'aktiv' | 'aufgeloest';

export type PlatzTyp =
  | 'wartebereich' | 'behandlungsplatz' | 'bett' | 'intensivplatz'
  | 'trage' | 'transport_bereitstellung' | 'sonstige';

export type Verfuegbarkeit = 'frei' | 'defekt' | 'aufbereitung' | 'gesperrt' | 'reserviert';

export type BelegungsArt = 'eintritt' | 'wechsel' | 'austritt';

export interface Uhs {
  id: number;
  einsatz_id: number;
  abschnitt_id: number | null;
  typ: UhsTyp;
  bezeichnung: string;
  standort: string | null;
  notiz: string | null;
  lat: number | null;
  lon: number | null;
  status: UhsStatus;
  erfasst_at: string;
  erfasst_von: number;
  geaendert_at: string;
  geaendert_von: number;
  storniert_at: string | null;
}

export interface UhsPlatz {
  id: number;
  uhs_id: number;
  typ: PlatzTyp;
  bezeichnung: string;
  pos_x: number | null;
  pos_y: number | null;
  verfuegbarkeit: Verfuegbarkeit;
  reserviert_fuer_person_id: number | null;
  storniert_at: string | null;
}

export interface UhsBelegung {
  id: number;
  einsatz_id: number;
  person_id: number;
  uhs_id: number;
  platz_id: number | null;
  art: BelegungsArt;
  notiz: string | null;
  zeitpunkt_at: string;
  erfasst_von: number;
}

/** Detail-Antwort: UHS + Plätze + Belegungen + Material. */
export interface UhsDetail extends Uhs {
  plaetze: UhsPlatz[];
  belegungen: UhsBelegung[];
  material: EinsatzMaterial[];
}

// ============================== LFH-14 Bereitstellungsräume ==============================

export type BrStatus = 'geplant' | 'aktiv' | 'aufgeloest';

/** Objekt-Typ für BR-Belegung: Einheit oder einheitenloses Fahrzeug. */
export type ObjektTyp = 'einheit' | 'fahrzeug';

export type BrBelegungsArt = 'eintritt' | 'wechsel' | 'austritt';

/** Serialisierbare BR-Anzeige (1:1 zur Tabelle `bereitstellungsraum`). */
export interface Bereitstellungsraum {
  id: number;
  einsatz_id: number;
  abschnitt_id: number | null;
  bezeichnung: string;
  standort: string | null;
  notiz: string | null;
  status: BrStatus;
  erfasst_at: string;
  erfasst_von: number;
  geaendert_at: string;
  geaendert_von: number;
  storniert_at: string | null;
}

/** Detail-Antwort: BR-Stamm + aktuell bereitgestellte Einheiten + Fahrzeuge. */
export interface BrDetail extends Bereitstellungsraum {
  einheiten: BrEinheitKurz[];
  fahrzeuge: BrFahrzeugKurz[];
}

/** Schlanke Einheiten-Info für den Detail-Response. */
export interface BrEinheitKurz {
  id: number;
  name: string;
}

/** Schlanke Fahrzeug-Info für den Detail-Response. */
export interface BrFahrzeugKurz {
  id: number;
  funkrufname: string;
}

/** Belegungs-Verlaufseintrag (1:1 zu `br_belegung`). */
export interface BrBelegung {
  id: number;
  einsatz_id: number;
  br_id: number;
  objekt_typ: ObjektTyp;
  objekt_id: number;
  art: BrBelegungsArt;
  notiz: string | null;
  zeitpunkt_at: string;
  erfasst_von: number;
}

export interface ChatKanal {
  id: number;
  einsatz_id: number;
  name: string;
  beschreibung: string | null;
  erstellt_von_id: number;
  erstellt_at: string;
  archiviert_at: string | null;
}

/** Metadaten eines generischen Datei-Anhangs (ohne Bytes), Spiegel von
 *  `AnhangAnzeige` im Backend. Bewusst modulübergreifend (nicht chat-spezifisch)
 *  — Chat dockt jetzt an, ETB/Lageobjekte können denselben Typ nutzen (LFH-102).
 *  Download über GET /api/einsaetze/{id}/anhaenge/{anhang.id}. */
export interface Anhang {
  id: number;
  einsatz_id: number;
  dateiname: string;
  mime: string;
  groesse: number;
  hochgeladen_von: number;
  erstellt_at: string;
}

export interface ChatNachricht {
  id: number;
  einsatz_id: number;
  kanal_id: number;
  autor_id: number;
  autor_name: string;
  /** `null` = gelöscht (Tombstone) — der Text wird vom Server nicht ausgeliefert. */
  inhalt: string | null;
  erstellt_at: string;
  bearbeitet_at: string | null;
  geloescht_at: string | null;
  etb_eintrag_id: number | null;
  /** `null` = nicht zu einem Auftrag heraufgestuft (LFH-101). Unabhängig von `etb_eintrag_id`. */
  auftrag_id: number | null;
  /**
   * Polymorpher Sachbezug auf ein bestehendes Domänenobjekt (LFH-103). `null`/`null`,
   * wenn kein Bezug gesetzt ist (both-or-neither). Unabhängig von der Heraufstufung
   * (`etb_eintrag_id`/`auftrag_id`): ein Bezug verweist, eine Heraufstufung erzeugt.
   */
  bezug_typ: BezugTyp | null;
  bezug_id: number | null;
  /** Angehängte Dateien (LFH-102); leeres Array, wenn keine. */
  anhaenge: Anhang[];
}

/** Referenzierbare Objekttypen des Chat-Sachbezugs (LFH-103). Codes = Modulnamen. */
export type BezugTyp = 'schaden' | 'uhs' | 'person' | 'lagebericht' | 'meldung' | 'auftrag';

// ============================== E‑5 Schäden ==============================

export type SchadenStatus = 'offen' | 'uebergeben' | 'abgeschlossen';
export type SchadenTyp =
  | 'sachschaden'
  | 'verkehrshindernis'
  | 'infrastruktur'
  | 'umweltschaden'
  | 'tierkadaver'
  | 'sonstige';
export type Ausmass = 'gering' | 'mittel' | 'gross' | 'katastrophal';
// Hinweis: AbschlussGrund ist bereits für Tier belegt (andere Werte) → hier SchadenAbschlussGrund
export type SchadenAbschlussGrund = 'behoben' | 'kein_handlungsbedarf' | 'abgewiesen';

export interface Schaden {
  id: number;
  einsatz_id: number;
  registrier_nr: number;
  status: SchadenStatus;
  typ: SchadenTyp;
  ausmass: Ausmass;
  ort: string;
  lat: number | null;
  lon: number | null;
  beschreibung: string;
  geschaedigt_person_id: number | null;
  geschaedigt_personal_id: number | null;
  geschaedigt_organisation_id: number | null;
  geschaedigt_kontakt: string | null;
  uebergeben_an: string | null;
  uebergeben_at: string | null;
  abschluss_grund: SchadenAbschlussGrund | null;
  abschluss_at: string | null;
  erfasst_at: string;
  erfasst_von: number;
  geaendert_at: string;
  geaendert_von: number;
  storniert_at: string | null;
  storniert_von: number | null;
  // Read-only Join-Felder (Geschädigt-Auflösung):
  geschaedigt_registrier_nr: number | null;
  geschaedigt_storniert_at: string | null;
  geschaedigt_personal_name: string | null;
  geschaedigt_organisation_name: string | null;
}

// ============================== E‑4 Tiere ==============================

export type TierStatus = 'aktiv' | 'vermisst' | 'abgeschlossen';
export type Spezies =
  | 'hund' | 'katze' | 'grosstier' | 'nutzgefluegel' | 'kleintier' | 'wildtier' | 'sonstige';
export type TierGeschlecht = 'maennlich' | 'weiblich' | 'unbekannt';
export type AbschlussGrund =
  | 'uebergabe_halter' | 'uebergabe_tierarzt' | 'uebergabe_tierheim'
  | 'verstorben' | 'freilauf' | 'sonstiges';

export interface Tier {
  id: number;
  einsatz_id: number;
  registrier_nr: number;
  status: TierStatus;
  spezies: Spezies;
  rasse_beschreibung: string | null;
  rufname: string | null;
  geschlecht: TierGeschlecht | null;
  alter_geschaetzt: number | null;
  farbe_beschreibung: string | null;
  kennzeichnung: string | null;
  groesse_gewicht: string | null;
  halter_person_id: number | null;
  halter_kontakt: string | null;
  antreff_ort: string | null;
  notiz: string | null;
  abschluss_grund: AbschlussGrund | null;
  abschluss_ziel: string | null;
  erfasst_at: string;
  erfasst_von: number;
  geaendert_at: string;
  geaendert_von: number;
  storniert_at: string | null;
  // Read-only Join-Felder (Halter-Auflösung über einsatz_person):
  halter_registrier_nr: number | null;
  halter_storniert_at: string | null;
}

// ============================== L-3 Gefahren- & Absperrzonen ==============================

export type Gefahrentyp =
  | 'atemgifte' | 'angstreaktion' | 'ausbreitung' | 'atomare_strahlung' | 'chemische_stoffe'
  | 'erkrankung_verletzung' | 'explosion' | 'elektrizitaet' | 'einsturz' | 'absturz' | 'brand'
  | 'durchbruch' | 'ertrinken';

export type Schutzobjekt = 'menschen' | 'tiere' | 'umwelt' | 'sachwerte' | 'einsatzkraefte';

export type Warnstufe = 'keine' | 'niedrig' | 'mittel' | 'hoch' | 'akut';

export interface GefahrBewertung {
  id: number;
  gefahrengebiet_id: number;
  gefahrentyp: Gefahrentyp;
  schutzobjekt: Schutzobjekt;
  warnstufe: Warnstufe;
  beschreibung: string | null;
  gemeldet_von: string | null;
  aktualisiert_von: number;
  erstellt_at: string;
  geaendert_at: string;
}

export interface Gefahrengebiet {
  id: number;
  einsatz_id: number;
  label: string | null;
  zonen_ids: number[];
  hoechste_warnstufe: Warnstufe;
}

export type ZoneTyp =
  | 'gefahrengebiet'
  | 'absperrbereich'
  | 'absperrgrenze'
  | 'sperrgebiet'
  | 'freie_skizze';

export interface LageZone {
  id: number;
  einsatz_id: number;
  typ: ZoneTyp;
  geometrie_typ: 'Polygon' | 'LineString';
  geometrie: string; // GeoJSON-Geometry als String
  label: string | null;
  farbe: string | null;
  notiz: string | null;
  gefahrengebiet_id: number | null;
  erstellt_von: number;
  erstellt_at: string;
  geaendert_at: string;
}

// ============================== LFH-48 Lageberichte ==============================

export type LageberichtVorlageKey = 'lagebericht' | 'lagebeurteilung' | 'freitext';
export type LageberichtStatus = 'entwurf' | 'freigegeben';

export interface LageberichtAbschnitt {
  schluessel: string;
  text: string;
}

export interface LageberichtAnzeige {
  id: number;
  einsatz_id: number;
  vorlage: LageberichtVorlageKey;
  titel: string;
  zeitstand: string;
  status: LageberichtStatus;
  abschnitte: LageberichtAbschnitt[];
  version: number;
  vorgaenger_id: number | null;
  ersteller_id: number;
  ersteller_name: string;
  erstellt_at: string;
  aktualisiert_at: string;
  freigegeben_von_id: number | null;
  freigegeben_von_name: string | null;
  freigegeben_at: string | null;
  etb_eintrag_id: number | null;
}

// ============================== LFH-51 Terminierte Erinnerungen ==============================

export interface Erinnerung {
  id: number;
  einsatz_id: number;
  titel: string;
  beschreibung: string | null;
  faellig_at: string;
  intervall_minuten: number | null;
  empfaenger_funktion: string | null;
  bezug_typ: string | null;
  bezug_id: number | null;
  quelle: string;
  status: 'offen' | 'erledigt' | 'quittiert';
  erledigt_at: string | null;
  erstellt_von_id: number;
  erstellt_at: string;
  ist_faellig: boolean;
  quittiert_at: string | null;
  quittiert_von_id: number | null;
  vollzug_status: 'offen' | 'in_arbeit' | 'vollzogen';
  vollzogen_at: string | null;
  vollzogen_von_id: number | null;
}

export interface NeueErinnerung {
  titel: string;
  beschreibung?: string;
  /** 'YYYY-MM-DD HH:MM' (UTC). */
  faellig_at: string;
  intervall_minuten?: number;
  empfaenger_funktion?: string;
  /** Generischer Sachbezug (z. B. 'etb' + ETB-Eintrag-ID, LFH-106); both-or-neither. */
  bezug_typ?: string;
  bezug_id?: number;
}

// ============================== LFH-52 Aufträge/Befehle ==============================

export type AuftragPrioritaet = 'sofort' | 'dringend' | 'normal';
export type AuftragBearbeitungsstatus = 'offen' | 'in_arbeit' | 'vollzogen' | 'abgenommen';
export type EmpfaengerTyp = 'abschnitt' | 'einheit' | 'funktion' | 'person' | 'fahrzeug' | 'extern';
/** Richtungskennzeichnung intern/extern (LFH-87), an Meldung und Auftrag. */
export type Richtung = 'intern' | 'extern';

export interface AuftragEmpfaenger {
  id: number;
  auftrag_id: number;
  empfaenger_typ: EmpfaengerTyp;
  abschnitt_id: number | null;
  einheit_id: number | null;
  person_id: number | null;
  fahrzeug_id: number | null;
  funktion_text: string | null;
  extern_kategorie: AdressatKategorie | null;
  extern_bezeichnung: string | null;
  snap_anzeige: string;
  quittiert_at: string | null;
  quittiert_von_id: number | null;
}

export interface Auftrag {
  id: number;
  einsatz_id: number;
  auftrag_text: string;
  absicht: string | null;
  lage: string | null;
  ort: string | null;
  zeit: string | null;
  mittel: string | null;
  verbindung: string | null;
  sicherheit: string | null;
  prioritaet: AuftragPrioritaet;
  richtung: Richtung;
  frist_at: string | null;
  erteilt_at: string;
  in_arbeit_at: string | null;
  vollzugsmeldung: string | null;
  abgenommen_at: string | null;
  abgenommen_von_id: number | null;
  etb_anordnung_id: number | null;
  /** Quell-ETB-Eintrag, aus dem dieser Auftrag erteilt wurde (LFH-112); getrennt von etb_anordnung_id. */
  quell_etb_eintrag_id: number | null;
  erstellt_von_id: number;
  erstellt_at: string;
  vollzug_status: 'offen' | 'in_arbeit' | 'vollzogen';
  vollzogen_at: string | null;
  vollzogen_von_id: number | null;
  empfaenger_anzahl: number;
  quittiert_anzahl: number;
  ist_ueberfaellig: boolean;
  bearbeitungsstatus: AuftragBearbeitungsstatus;
  /** Detail-/Anlege-/Mutations-Antwort liefert die Empfänger mit. */
  empfaenger: AuftragEmpfaenger[];
}

export interface NeuerEmpfaenger {
  empfaenger_typ: EmpfaengerTyp;
  abschnitt_id?: number;
  einheit_id?: number;
  person_id?: number;
  fahrzeug_id?: number;
  funktion_text?: string;
  extern_kategorie?: AdressatKategorie;
  extern_bezeichnung?: string;
}

export interface NeuerAuftrag {
  auftrag_text: string;
  absicht?: string;
  lage?: string;
  ort?: string;
  zeit?: string;
  mittel?: string;
  verbindung?: string;
  sicherheit?: string;
  prioritaet?: AuftragPrioritaet;
  richtung?: Richtung;
  /** 'YYYY-MM-DD HH:MM' (UTC). */
  frist_at?: string;
  /** Erteilzeitpunkt (UTC); leer = jetzt. */
  erteilt_at?: string;
  empfaenger: NeuerEmpfaenger[];
}

// --- Meldungen (eingehend) (LFH-54) ---

export type MeldungPrioritaet = 'sofort' | 'dringend' | 'normal';
export type MeldungStatus = 'neu' | 'gesichtet' | 'in_bearbeitung' | 'erledigt';
export type Meldungsart =
  | 'lagemeldung' | 'sofortmeldung' | 'rueckmeldung' | 'vollzugsmeldung' | 'anfrage' | 'sonstige';
export type MeldungMeldeweg = 'funk' | 'telefon' | 'persoenlich' | 'sonstige';

export interface Meldung {
  id: number;
  einsatz_id: number;
  lfd_nr: number;
  absender: string;
  empfaenger: string | null;
  meldeweg: MeldungMeldeweg;
  inhalt: string;
  meldungsart: Meldungsart;
  prioritaet: MeldungPrioritaet;
  richtung: Richtung;
  status: MeldungStatus;
  bearbeiter_id: number | null;
  bearbeiter_name: string | null;
  lagerelevant: boolean;
  ereigniszeit: string;
  eingang_at: string;
  etb_meldung_id: number | null;
  auftrag_id: number | null;
  erfasst_von_id: number;
  erstellt_at: string;
  /** id des erzeugten Lageobjekts (LFH-95), falls an die Lage übergeben. */
  lage_meldung_id: number | null;
  /** Abgeleitet: status !== 'erledigt'. */
  ist_offen: boolean;
  /** Erledigt-Zeitpunkt (UTC), first-write-wins beim Übergang nach 'erledigt' (LFH-113); null solange nie erledigt. */
  erledigt_at: string | null;
  /** Sofortmeldung & Eskalation (LFH-85/97): aktive Bestätigungspflicht. */
  bestaetigung_pflicht: boolean;
  /** Absolute Bestätigungsfrist (UTC), null wenn keine Pflicht. */
  bestaetigung_frist_at: string | null;
  /** Frist überschritten + unbestätigt (Server-/Tick-getrieben). */
  eskaliert: boolean;
  /** Bestätigt-um (Quittungs-Achse), null wenn unbestätigt. */
  bestaetigt_at: string | null;
  bestaetigt_von_id: number | null;
  bestaetigt_von_name: string | null;
  /** Abgeleitet: quittiert_at !== null. */
  ist_bestaetigt: boolean;
  /** Abgeleitet: pflichtig, unbestätigt und Frist überschritten. */
  ist_ueberfaellig: boolean;
}

export interface NeueMeldung {
  absender: string;
  empfaenger?: string;
  meldeweg: MeldungMeldeweg;
  inhalt: string;
  meldungsart?: Meldungsart;
  prioritaet?: MeldungPrioritaet;
  richtung?: Richtung;
  /** Ereigniszeit (UTC) 'YYYY-MM-DD HH:mm:ss'. Pflicht (≠ Erfassungszeit). */
  ereigniszeit: string;
  /** Bestätigungspflicht erzwingen; undefined ⇒ aus Sofort-Klassifikation abgeleitet (LFH-97). */
  bestaetigung_pflicht?: boolean;
  /** Override der Default-Bestätigungsfrist (Minuten ab Eingang). */
  bestaetigung_frist_min?: number;
}

/** Lageobjekt aus lagerelevanter Meldung (LFH-95). */
export interface LageMeldung {
  id: number;
  einsatz_id: number;
  meldung_id: number;
  text: string;
  lat: number | null;
  lon: number | null;
  erstellt_von_id: number;
  erstellt_at: string;
  /** Herkunft (aus JOIN meldung): zur Nachvollziehbarkeit am Lageobjekt. */
  meldung_lfd_nr: number;
  meldung_absender: string;
}

// ============================== LFH-87 Nachforderung Kräfte/Mittel ==============================

export type NachforderungPrioritaet = 'sofort' | 'dringend' | 'normal';
export type NachforderungStatus = 'angefordert' | 'zugesagt' | 'unterwegs' | 'eingetroffen' | 'abgelehnt';
export type AdressatKategorie = 'leitstelle' | 'nachbar_ea' | 'uebergeordnet' | 'andere_bos';

export interface Nachforderung {
  id: number;
  einsatz_id: number;
  art: string;
  bezeichnung: string;
  anzahl: number | null;
  adressat_kategorie: AdressatKategorie;
  adressat_bezeichnung: string | null;
  begruendung: string | null;
  prioritaet: NachforderungPrioritaet;
  status: NachforderungStatus;
  zugesagt_at: string | null;
  unterwegs_at: string | null;
  eingetroffen_at: string | null;
  abgelehnt_at: string | null;
  abgelehnt_grund: string | null;
  angefordert_at: string;
  etb_nachforderung_id: number | null;
  erstellt_von_id: number;
  erstellt_at: string;
  erstellt_von_name: string | null;
  /** Abgeleitet: status NOT IN ('eingetroffen','abgelehnt'). */
  ist_offen: boolean;
}

export interface NeueNachforderung {
  art: string;
  bezeichnung: string;
  anzahl?: number;
  adressat_kategorie: AdressatKategorie;
  adressat_bezeichnung?: string;
  begruendung?: string;
  prioritaet?: NachforderungPrioritaet;
  /** Ereigniszeit der Anforderung (UTC); leer = jetzt. */
  angefordert_at?: string;
}
