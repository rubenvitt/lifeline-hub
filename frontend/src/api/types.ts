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
