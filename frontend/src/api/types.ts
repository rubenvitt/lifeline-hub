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
}

export interface MitgliedAnzeige {
  benutzer_id: number;
  anzeigename: string;
  benutzername: string;
  einsatz_rolle: EinsatzRolle;
  zugewiesen_at: string;
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
}
