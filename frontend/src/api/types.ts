// LFH-120: Barrel über die aus Rust generierten Schemas (frontend/src/api/types.generated.ts).
// Backend-Typ-Drift bricht jetzt tsc/Build statt still zur Laufzeit. Nicht von Hand pflegen —
// Response-Typen ändern sich über die Rust-Structs + `pnpm gen:types` (schreibt types.generated.ts
// aus src/api/openapi.json). FE-lokale Typen (Eingabe-Bodies, Record-Maps) sind unten markiert.
import type {
  EinheitId, FachaufgabeId, FunktionId, GrundzeichenId, OrganisationId, SymbolId,
} from 'taktische-zeichen-react';
import type { components } from './types.generated';

type S = components['schemas'];

// ============================== Auth ==============================
export type AuthProvider = S['AuthProviderAnzeige'];
export type AuthProviderTyp = S['AuthProviderTyp'];
// LFH-43 (Increment 5): TOTP-Enroll-DTOs (`/api/auth/totp/enroll/start|finish`).
export type TotpEnrollStart = S['TotpEnrollStart'];
export type TotpEnrollFinish = S['TotpEnrollFinish'];

// ============================== Benutzer / Einsatz ==============================
export type SystemRolle = S['SystemRolle'];
export type OrgRolle = S['OrgRolle'];
export type BenutzerAnzeige = S['BenutzerAnzeige'];
export type EinsatzStatus = S['EinsatzStatus'];
export type EinsatzRolle = S['EinsatzRolle'];
export type Einsatzart = S['Einsatzart'];
export type EinsatzAnzeige = S['EinsatzAnzeige'];
export type MitgliedAnzeige = S['MitgliedAnzeige'];
export type StichwortVorschlag = S['StichwortVorschlag'];

// ============================== Karten-/Anzeige-Defaults ==============================
export type BasemapModus = S['BasemapModus'];
export type Zeitformat = S['Zeitformat'];
export type EinheitenSystem = S['EinheitenSystem'];
export type Koordinatenformat = S['Koordinatenformat'];

/** Sichtbarkeit der externen Lage-Layer (LFH-69) als Karten-Default pro Einsatz.
 *  LFH-120: kein Backend-Schema — Rust serialisiert `fachebenen_sichtbar` untypisiert
 *  (EinstellungenAnzeige.fachebenen_sichtbar: unknown); FE-lokale Formgebung. */
export interface FachebenenSichtbar {
  nina: boolean;
  dwd: boolean;
  pegelonline: boolean;
  kritis: boolean;
}

// ============================== Admin — Org-weite Einstellungen ==============================
export type OrgEinstellungen = S['OrgEinstellungenAnzeige'];

/** PUT-Body für org-weite Einstellungen (PUT /api/org-einstellungen, Vollersatz).
 *  LFH-120: kein Backend-Schema — Eingabe-Body, FE-lokal. */
export interface OrgEinstellungenUpdate {
  zeitzone: string | null;
  zeitformat: Zeitformat | null;
  einheiten: EinheitenSystem | null;
  koordinatenformat: Koordinatenformat | null;
  retention_dauer_tage: number | null;
  etb_nummer_praefix: string | null;
  meldung_nummer_praefix: string | null;
  auftrag_nummer_praefix: string | null;
  meldung_bestaetigung_frist_min: number | null;
  auftrag_quittierung_frist_min: number | null;
  /** Auto-ETB-Dual-Publish: false schaltet ab; true/null = an. */
  auto_etb_eintraege: boolean | null;
  geocoder_url: string | null;
}

/** Org-weite Modul-Rollen-Defaults (GET /api/org-modul-einstellungen).
 *  Map modul_key → benoetigte_rolle; fehlt ein Key = kein Org-Default (frei).
 *  LFH-120: kein Backend-Schema — Record-Map, FE-lokal. */
export type OrgModulEinstellungen = Record<string, 'admin' | 'fuehrungskraft' | null>;

export type EinsatzEinstellungen = S['EinstellungenMitOrgDefaults'];

/** PUT-Eingabe (Vollersatz) der Einsatz-Einstellungen.
 *  LFH-120: kein Backend-Schema — Eingabe-Body, FE-lokal. */
export interface EinstellungenUpdate {
  standard_modul: string | null;
  basemap_modus: BasemapModus | null;
  karten_zoom_start: number | null;
  fachebenen_sichtbar: FachebenenSichtbar | null;
  zeitzone: string | null;
  zeitformat: Zeitformat | null;
  einheiten: EinheitenSystem | null;
  koordinatenformat: Koordinatenformat | null;
  // Verhalten & Automatik (LFH-133).
  etb_nummer_praefix: string | null;
  etb_nummer_start: number | null;
  meldung_nummer_praefix: string | null;
  meldung_nummer_start: number | null;
  auftrag_nummer_praefix: string | null;
  auftrag_nummer_start: number | null;
  meldung_bestaetigung_frist_min: number | null;
  auftrag_quittierung_frist_min: number | null;
  /** Auto-ETB-Dual-Publish: false schaltet ab; true/null = an. */
  auto_etb_eintraege: boolean | null;
  /** Aufbewahrungs-Dauer-Politik in Tagen (LFH-135); null/0 = keine Auto-Frist. */
  retention_dauer_tage: number | null;
}

export type ModulOverride = S['EinsatzModulOverride'];

/** Map `modul_key → Override`; fehlt ein Key, gilt der Registry-Default (sichtbar, frei).
 *  LFH-120: kein Backend-Schema — Record-Map, FE-lokal. */
export type ModulOverrides = Record<string, ModulOverride>;

/** PUT-Eingabe eines einzelnen Modul-Overrides.
 *  LFH-120: kein Backend-Schema — Eingabe-Body, FE-lokal. */
export interface ModulOverrideUpdate {
  sichtbar: boolean;
  benoetigte_rolle: 'admin' | 'fuehrungskraft' | null;
}

// ============================== ETB ==============================
export type EtbTyp = S['EtbTyp'];
export type MeldeWeg = S['MeldeWeg'];
export type EtbEintragAnzeige = S['EtbEintragAnzeige'];
export type EtbBaustein = S['EtbBaustein'];

// ============================== LFH-298 SSE-Live-Feed ==============================
/** Wire-Event-Namen des Einsatz-Live-Feeds; Kontrakt gegen `EINSATZ_STREAM_EVENTS`
 *  (queryKeys.ts) via `liveEvent.contract.test.ts`. Wahrheitsquelle: Rust `LiveEvent`. */
export type LiveEvent = S['LiveEvent'];

// ============================== Fahrzeuge / Material / Personal ==============================
export type Dienststatus = S['Dienststatus'];
export type StatusKategorie = S['StatusKategorie'];
export type Staerke = S['Staerke'];
export type Fahrzeug = S['FahrzeugAnzeige'];
export type FahrzeugVorschlaege = S['FahrzeugVorschlaege'];
export type FahrzeugStatus = S['FahrzeugStatus'];
export type EinsatzFahrzeug = S['EinsatzFahrzeugAnzeige'];
export type MaterialStatus = S['MaterialStatus'];
export type Material = S['MaterialAnzeige'];
export type EinsatzMaterial = S['EinsatzMaterialAnzeige'];
export type EinheitMitgliedMaterial = S['EinheitMitgliedMaterial'];
export type StaerkePosition = S['StaerkePosition'];
export type QualifikationRef = S['QualifikationRef'];
export type Personal = S['PersonalAnzeige'];
export type PersonalVorschlaege = S['PersonalVorschlaege'];
export type Qualifikation = S['Qualifikation'];
export type PersonalStatus = S['PersonalStatus'];
export type EinheitTyp = S['EinheitTyp'];
export type EinsatzPersonal = S['EinsatzPersonalAnzeige'];

// ============================== LFH-109 Sprechgruppen-Katalog ==============================
export type Betriebsart = S['Betriebsart'];
export type Sprechgruppe = S['SprechgruppeAnzeige'];

/** Eingabe-Body für Anlegen und PATCH einer Sprechgruppe.
 *  LFH-120: kein Backend-Schema — Eingabe-Body, FE-lokal. */
export interface SprechgruppeEingabe {
  bezeichnung: string;
  betriebsart: Betriebsart;
  hinweis?: string | null;
  sortier?: number;
}

// ============================== Struktur (Abschnitte / Einheiten) ==============================
export type Einsatzabschnitt = S['EinsatzabschnittAnzeige'];
export type EinheitMitgliedPerson = S['EinheitMitgliedPerson'];
export type EinheitMitgliedFahrzeug = S['EinheitMitgliedFahrzeug'];
export type Einheit = S['EinheitAnzeige'];
export type FuehrungskraftKarte = S['FuehrungskraftKarte'];
export type OrganisationInfo = S['OrganisationAnzeige'];

// ============================== E‑2 Personen ==============================
export type PersonStatus = S['PersonStatus'];
export type Geschlecht = S['Geschlecht'];
export type Person = S['PersonAnzeige'];
export type Sichtungskategorie = S['Sichtungskategorie'];
export type VerbleibArt = S['VerbleibArt'];
export type VerbleibStatus = S['VerbleibStatus'];
export type AbgleichStatus = S['AbgleichStatus'];
export type Sichtung = S['SichtungAnzeige'];
export type Verlaufsnotiz = S['NotizAnzeige'];
export type Verbleib = S['VerbleibAnzeige'];
export type Abgleich = S['AbgleichAnzeige'];
export type PersonDetail = S['PersonDetail'];
export type PersonZugriff = S['ZugriffAnzeige'];

// ============================== E‑3 Unfallhilfsstellen ==============================
export type UhsTyp = S['UhsTyp'];
export type UhsStatus = S['UhsStatus'];
export type PlatzTyp = S['PlatzTyp'];
export type Verfuegbarkeit = S['Verfuegbarkeit'];
export type BelegungsArt = S['BelegungsArt'];
export type Uhs = S['UhsAnzeige'];
export type UhsPlatz = S['PlatzAnzeige'];
export type UhsBelegung = S['BelegungAnzeige'];
export type UhsDetail = S['UhsDetail'];

// ============================== LFH-14 Bereitstellungsräume ==============================
export type BrStatus = S['BrStatus'];
export type ObjektTyp = S['ObjektTyp'];
export type BrBelegungsArt = S['BrBelegungsArt'];
export type Bereitstellungsraum = S['BrAnzeige'];
export type BrDetail = S['BrDetail'];
export type BrEinheitKurz = S['BrEinheitKurz'];
export type BrFahrzeugKurz = S['BrFahrzeugKurz'];
export type BrBelegung = S['BrBelegungAnzeige'];

// ============================== Chat / Anhänge ==============================
export type ChatKanal = S['ChatKanalAnzeige'];
export type Anhang = S['AnhangAnzeige'];
export type ChatNachricht = S['ChatNachrichtAnzeige'];
export type BezugTyp = S['BezugTyp'];

// ============================== E‑5 Schäden ==============================
export type SchadenStatus = S['SchadenStatus'];
export type SchadenTyp = S['SchadenTyp'];
export type Ausmass = S['Ausmass'];
export type SchadenAbschlussGrund = S['SchadenAbschlussGrund'];
export type Schaden = S['SchadenAnzeige'];

// ============================== E‑4 Tiere ==============================
export type TierStatus = S['TierStatus'];
export type Spezies = S['Spezies'];
export type TierGeschlecht = S['TierGeschlecht'];
export type AbschlussGrund = S['AbschlussGrund'];
export type Tier = S['TierAnzeige'];

// ============================== L-3 Gefahren- & Absperrzonen ==============================
export type Gefahrentyp = S['Gefahrentyp'];
export type Schutzobjekt = S['Schutzobjekt'];
export type Warnstufe = S['Warnstufe'];
export type GefahrBewertung = S['GefahrBewertungAnzeige'];
export type Gefahrengebiet = S['GefahrengebietAnzeige'];
export type ZoneTyp = S['LageZoneTyp'];
export type LageZone = S['LageZoneAnzeige'];

// ============================== LFH-170 Freie taktische Zeichen ==============================
export type FreiesZeichen = S['FreiesZeichenAnzeige'];

/** POST-Body für ein freies taktisches Zeichen (Punkt-Marker ohne Fachobjekt).
 *  LFH-120/170: kein Backend-Schema — Eingabe-Body, FE-lokal. Overlays nutzen die
 *  DV-102-ID-Unions aus `taktische-zeichen-core` für FE-Typsicherheit. */
export interface NeuesFreiesZeichen {
  lat: number;
  lon: number;
  grundzeichen: GrundzeichenId;
  organisation?: OrganisationId | null;
  fachaufgabe?: FachaufgabeId | null;
  symbol?: SymbolId | null;
  einheit?: EinheitId | null;
  funktion?: FunktionId | null;
  farbe?: string | null;
  label?: string | null;
  /** Ansichts-Zugehörigkeit (LFH-320): aktive Ansicht beim Anlegen; `null` = auf allen. */
  ansicht_id?: number | null;
}

/** PATCH-Body (Whole-Spec-Overwrite ohne lat/lon — v1 nicht verschiebbar). LFH-170. */
export type FreiesZeichenUpdate = Omit<NeuesFreiesZeichen, 'lat' | 'lon'>;

// ============================== LFH-319 Kartenansichten ==============================
export type KartenAnsicht = S['KartenAnsichtAnzeige'];
export type KartenTheme = S['KartenTheme'];

/** PATCH-Body einer Ansicht (LFH-319/320). FE-lokal (kein Backend-Schema). Drei unabhängige
 *  Operationen im selben Endpunkt: „Für den Einsatz speichern" (Config-Vollersatz — die
 *  Config-Felder), Umbenennen (`name`) und Standard-Setzen (`ist_standard: true`). Ein reines
 *  Umbenennen sendet NUR `name` (ohne Config-Felder), sonst würde der Vollersatz die Config
 *  wischen. `layer_sichtbar`/`fachebenen_sichtbar` sind serialisierte Bool-Maps. */
export interface PatchKartenAnsicht {
  name?: string;
  ist_standard?: boolean;
  basemap_modus?: BasemapModus | null;
  online_stil?: string | null;
  karten_theme?: KartenTheme | null;
  layer_sichtbar?: Record<string, boolean> | null;
  fachebenen_sichtbar?: Record<string, boolean> | null;
  zentrum_lat?: number | null;
  zentrum_lon?: number | null;
  zoom?: number | null;
}

/** POST-Body „Als neue Ansicht speichern" (LFH-320): Pflicht-`name` + der aktuelle
 *  Karten-Zustand (dieselben Config-Felder wie beim Speichern). Nie Standard. */
export interface NeueKartenAnsicht {
  name: string;
  basemap_modus?: BasemapModus | null;
  online_stil?: string | null;
  karten_theme?: KartenTheme | null;
  layer_sichtbar?: Record<string, boolean> | null;
  fachebenen_sichtbar?: Record<string, boolean> | null;
  zentrum_lat?: number | null;
  zentrum_lon?: number | null;
  zoom?: number | null;
}

// ============================== LFH-321 Lage-Snapshots ==============================
export type LageSnapshot = S['LageSnapshotAnzeige'];
export type LageSnapshotDokument = S['LageSnapshotDokument'];

/** POST-Body „Stand sichern" (LFH-321): optionale Bezeichnung/Notiz. FE-lokal (kein Backend-Schema). */
export interface NeuerLageSnapshot {
  bezeichnung?: string | null;
  notiz?: string | null;
}

/** PATCH-Body eines Snapshots (LFH-321): NUR Metadaten — `daten`/`stand_at`/`erstellt_*` sind
 *  unveränderlich und im DTO nicht enthalten. `null` löscht das Feld, absent lässt es unverändert. */
export interface PatchLageSnapshot {
  bezeichnung?: string | null;
  notiz?: string | null;
}

// ============================== LFH-48 Lageberichte ==============================
export type LageberichtVorlageKey = S['LageberichtVorlage'];
export type LageberichtStatus = S['LageberichtStatus'];
export type LageberichtAbschnitt = S['LageberichtAbschnitt'];
export type LageberichtAnzeige = S['LageberichtAnzeige'];

// ============================== LFH-64 Befehlsgebung ==============================
export type BefehlVorlageKey = S['BefehlVorlage'];
export type BefehlStatus = S['BefehlStatus'];
export type BefehlAbschnitt = S['BefehlAbschnitt'];
export type BefehlAnzeige = S['BefehlAnzeige'];

// ============================== LFH-51 Terminierte Erinnerungen ==============================
export type Erinnerung = S['ErinnerungAnzeige'];

/** LFH-120: kein Backend-Schema — Eingabe-Body, FE-lokal. */
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
export type AuftragPrioritaet = S['Prioritaet'];
export type AuftragBearbeitungsstatus = S['AuftragBearbeitungsstatus'];
export type EmpfaengerTyp = S['EmpfaengerTyp'];
export type Richtung = S['Richtung'];
export type AuftragEmpfaenger = S['AuftragEmpfaengerAnzeige'];
export type Auftrag = S['AuftragDetail'];

/** LFH-120: kein Backend-Schema — Eingabe-Body, FE-lokal. */
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

/** LFH-120: kein Backend-Schema — Eingabe-Body, FE-lokal. */
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
export type MeldungPrioritaet = S['Prioritaet'];
export type MeldungStatus = S['MeldungStatus'];
export type Meldungsart = S['Meldungsart'];
export type MeldungMeldeweg = S['MeldeWeg'];
export type Meldung = S['MeldungAnzeige'];

/** LFH-120: kein Backend-Schema — Eingabe-Body, FE-lokal. */
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
  /** Stabiler Offline-Idempotenzschlüssel; bei Replay liefert der Server die
   * bereits angelegte Meldung statt einer Dublette. */
  client_id?: string;
}

export type LageMeldung = S['LageMeldungAnzeige'];

// ============================== LFH-87 Nachforderung Kräfte/Mittel ==============================
export type NachforderungPrioritaet = S['Prioritaet'];
export type NachforderungStatus = S['NachforderungStatus'];
export type AdressatKategorie = S['AdressatKategorie'];
export type Nachforderung = S['NachforderungAnzeige'];

/** LFH-120: kein Backend-Schema — Eingabe-Body, FE-lokal. */
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
