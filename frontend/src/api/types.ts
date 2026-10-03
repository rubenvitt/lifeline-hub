// Barrel über die aus Rust generierten Schemas (`types.generated.ts`, LFH-120). Nicht von Hand
// pflegen: Response-Typen ändern sich über die Rust-Structs + `scripts/check-typ-codegen.sh`.
// FE-lokale Typen (Eingabe-Bodies, Record-Maps) sind unten als „kein Backend-Schema“ markiert.
// ID-Typen der freien Zeichen (`NeuesFreiesZeichen`/`FreiesZeichenUpdate`) aus dem Altpaket, bis
// LFH-836 sie auf @einsatzzeichen umstellt.
import type {
  EinheitId,
  FachaufgabeId,
  FunktionId,
  GrundzeichenId,
  OrganisationId,
  SymbolId,
} from 'taktische-zeichen-react';
import type { components } from './types.generated';

type S = components['schemas'];

// ============================== Auth ==============================
export type AuthProvider = S['AuthProviderAnzeige'];
export type AppCode = S['AppCode'];
// TOTP-Enroll-DTOs (`/api/auth/totp/enroll/start|finish`).
export type TotpEnrollStart = S['TotpEnrollStart'];
export type TotpEnrollFinish = S['TotpEnrollFinish'];

// ============================== Benutzer / Einsatz ==============================
export type SystemRolle = S['SystemRolle'];
export type OrgRolle = S['OrgRolle'];
export type BenutzerAnzeige = S['BenutzerAnzeige'];
export type EinsatzStatus = S['EinsatzStatus'];
export type EinsatzRolle = S['EinsatzRolle'];
export type Einsatzart = S['Einsatzart'];
/** Aktive lagebezogene Kennzahl am Einsatz (LFH-640) — Auslöser eines Lageplatzes im Lage-Dashboard. */
export type Lagekennzahl = S['Lagekennzahl'];
export type EinsatzAnzeige = S['EinsatzAnzeige'];
export type MitgliedAnzeige = S['MitgliedAnzeige'];
export type StichwortVorschlag = S['StichwortVorschlag'];
/** Präferenzen des angemeldeten Benutzers. `eintraege` ist SPARSE: ein fehlender Schlüssel
 *  heißt „nie geschrieben“; der Wert ist ein opaker Text, dessen Form nur der Besitzer des
 *  Schlüssels kennt. */
export type BenutzerEinstellungen = S['BenutzerEinstellungenAnzeige'];

// ============================== Karten-/Anzeige-Defaults ==============================
export type BasemapModus = S['BasemapModus'];
export type Zeitformat = S['Zeitformat'];
export type EinheitenSystem = S['EinheitenSystem'];
export type Koordinatenformat = S['Koordinatenformat'];

/** Sichtbarkeit der externen Lage-Layer als Karten-Default pro Einsatz. Kein Backend-Schema:
 *  Rust serialisiert `fachebenen_sichtbar` untypisiert; FE-lokale Formgebung. */
export interface FachebenenSichtbar {
  nina: boolean;
  dwd: boolean;
  pegelonline: boolean;
  // Opak durchgereicht, aber ein Typ, der weniger Felder behauptet als die Daten haben, führt
  // in die Irre.
  hochwasser: boolean;
  odl: boolean;
  kritis: boolean;
  autobahn: boolean;
}

// ============================== Demo-Daten ==============================
/** Stand der Demo-Daten der eigenen Organisation, die eine Antwort aller vier Endpunkte.
 *  `import` fehlt ohne aktiven Import, `bericht` fehlt, solange nie importiert wurde. */
export type DemoDatenStatus = S['DemoDatenStatus'];
export type DemoBerichtZeile = S['DemoBerichtZeile'];
export type DemoStammdatenArt = S['DemoStammdatenArt'];
export type DemoVorgang = S['DemoVorgang'];

// ============================== Admin — Org-weite Einstellungen ==============================
export type OrgEinstellungen = S['OrgEinstellungenAnzeige'];

/** PUT-Body für org-weite Einstellungen (PUT /api/org-einstellungen, Vollersatz).
 *  Kein Backend-Schema, FE-lokal. */
export interface OrgEinstellungenUpdate {
  zeitzone: string | null;
  zeitformat: Zeitformat | null;
  einheiten: EinheitenSystem | null;
  koordinatenformat: Koordinatenformat | null;
  retention_dauer_tage: number | null;
  /** Skelett-Frist in Tagen ab Abschluss (LFH-750); null = das Skelett bleibt unbegrenzt. */
  skelett_dauer_tage: number | null;
  /** Bestätigt das erstmalige Setzen oder Verkürzen der Skelett-Frist; ohne → 409. */
  skelett_dauer_bestaetigt?: boolean;
  etb_nummer_praefix: string | null;
  meldung_nummer_praefix: string | null;
  auftrag_nummer_praefix: string | null;
  /** Präfix der Einsatznummer (LFH-617) — beim Anlegen in die Nummer eingefroren. */
  einsatz_nummer_praefix: string | null;
  meldung_bestaetigung_frist_min: number | null;
  auftrag_quittierung_frist_min: number | null;
  rueckmeldung_frist_min: number | null;
  /** Auto-ETB-Dual-Publish: false schaltet ab; true/null = an. */
  auto_etb_eintraege: boolean | null;
  geocoder_url: string | null;
  /** Kategorie-Vorgaben (LFH-749). Fehlt das Feld, bleiben sie am Server unverändert — nur die
   *  Sektion „Einsatz-Defaults“ schickt es mit. */
  aufbewahrung_kategorien?: KategorieVorgabe[];
}

/** Org-weite Modul-Rollen-Defaults (GET /api/org-modul-einstellungen).
 *  Map modul_key → benoetigte_rolle; fehlt ein Key = kein Org-Default (frei).
 *  Kein Backend-Schema, FE-lokal. */
export type OrgModulEinstellungen = Record<string, 'admin' | 'fuehrungskraft' | null>;

export type EinsatzEinstellungen = S['EinstellungenMitOrgDefaults'];

/** PUT-Eingabe (Vollersatz) der Einsatz-Einstellungen. Kein Backend-Schema, FE-lokal. */
export interface EinstellungenUpdate {
  standard_modul: string | null;
  basemap_modus: BasemapModus | null;
  karten_zoom_start: number | null;
  fachebenen_sichtbar: FachebenenSichtbar | null;
  zeitzone: string | null;
  zeitformat: Zeitformat | null;
  einheiten: EinheitenSystem | null;
  koordinatenformat: Koordinatenformat | null;
  // Verhalten & Automatik.
  etb_nummer_praefix: string | null;
  etb_nummer_start: number | null;
  meldung_nummer_praefix: string | null;
  meldung_nummer_start: number | null;
  auftrag_nummer_praefix: string | null;
  auftrag_nummer_start: number | null;
  meldung_bestaetigung_frist_min: number | null;
  auftrag_quittierung_frist_min: number | null;
  rueckmeldung_frist_min: number | null;
  /** Auto-ETB-Dual-Publish: false schaltet ab; true/null = an. */
  auto_etb_eintraege: boolean | null;
  /** Aufbewahrungs-Dauer-Politik in Tagen (LFH-135); null/0 = keine Auto-Frist. */
  retention_dauer_tage: number | null;
}

export type ModulOverride = S['EinsatzModulOverride'];

/** Map `modul_key → Override` (Rohdaten des Editors „Module"); fehlt ein Key, hat der Einsatz keinen Override.
 *  Kein Backend-Schema, FE-lokal. */
export type ModulOverrides = Record<string, ModulOverride>;

/** Effektive Freigabe eines Moduls für den angemeldeten Benutzer (LFH-669). */
export type ModulFreigabe = S['ModulFreigabe'];

/** Antwort von `GET /api/einsaetze/{id}/modul-freigaben`: ein Eintrag je Modul-Key der Registry.
 *  Die Map selbst ist kein Backend-Schema, FE-lokal. */
export type ModulFreigaben = Record<string, ModulFreigabe>;

/** PUT-Eingabe eines einzelnen Modul-Overrides. Kein Backend-Schema, FE-lokal. */
export interface ModulOverrideUpdate {
  sichtbar: boolean;
  benoetigte_rolle: 'admin' | 'fuehrungskraft' | null;
}

// ============================== ETB ==============================
export type EtbTyp = S['EtbTyp'];
export type MeldeWeg = S['MeldeWeg'];
export type EtbEintragAnzeige = S['EtbEintragAnzeige'];
export type EtbBaustein = S['EtbBaustein'];
/** Eigener Lesestand im Tagebuch eines Einsatzes (LFH-611). */
export type EtbLesemarke = S['EtbLesemarkeAnzeige'];
/** Exakte Zahl der ETB-Einträge gesamt und je Typ, filtertreu zur Liste (LFH-612). */
export type EtbZaehler = S['EtbZaehlerAnzeige'];
/** Zähler je erlaubtem Modul für den Navigationsrahmen (LFH-612); ein fehlendes Feld heißt
 *  „Modul nicht erlaubt", nicht 0. */
export type ModulZaehler = S['ModulZaehlerAnzeige'];
/** Trefferzahl eines ETB-Filters ohne Seitendeckel (LFH-619, Sammeltreffer der Palette). */
export type EtbAnzahl = S['EtbAnzahlAnzeige'];

// ============================== SSE-Live-Feed ==============================
/** Wire-Event-Namen des Einsatz-Live-Feeds; Kontrakt gegen `EINSATZ_STREAM_EVENTS`
 *  (queryKeys.ts) via `liveEvent.contract.test.ts`. Wahrheitsquelle: Rust `LiveEvent`. */
export type LiveEvent = S['LiveEvent'];
/** Wire-Event-Namen der Org-Ereignisse (LFH-734); Kontrakt gegen `ORG_STREAM_EVENTS`
 *  (queryKeys.ts) via `orgLiveEvent.contract.test.ts`. Wahrheitsquelle: Rust `OrgLiveEvent`. */
export type OrgLiveEvent = S['OrgLiveEvent'];

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
export type StaerkePosition = S['StaerkePosition'];
export type Personal = S['PersonalAnzeige'];
export type PersonalVorschlaege = S['PersonalVorschlaege'];
export type Qualifikation = S['Qualifikation'];
export type PersonalStatus = S['PersonalStatus'];
export type EinheitTyp = S['EinheitTyp'];
export type EinsatzPersonal = S['EinsatzPersonalAnzeige'];

// ============================== LFH-109 Sprechgruppen-Katalog ==============================
export type Betriebsart = S['Betriebsart'];
export type Sprechgruppe = S['SprechgruppeAnzeige'];

/** Eingabe-Body für Anlegen und PATCH einer Sprechgruppe. Kein Backend-Schema, FE-lokal. */
export interface SprechgruppeEingabe {
  bezeichnung: string;
  betriebsart: Betriebsart;
  hinweis?: string | null;
  sortier?: number;
}

// ============================== Struktur (Abschnitte / Einheiten) ==============================
export type Einsatzabschnitt = S['EinsatzabschnittAnzeige'];
export type AbschnittLagezustand = S['AbschnittLagezustand'];
export type Einheit = S['EinheitAnzeige'];
export type EinheitStatus = S['EinheitStatus'];
export type StatusWert = S['StatusWert'];
export type FuehrungskraftKarte = S['FuehrungskraftKarte'];
export type OrganisationInfo = S['OrganisationAnzeige'];

// ============================== E‑2 Personen ==============================
export type PersonStatus = S['PersonStatus'];
export type Person = S['PersonAnzeige'];
export type Sichtungskategorie = S['Sichtungskategorie'];
export type VerbleibArt = S['VerbleibArt'];
export type VerbleibStatus = S['VerbleibStatus'];
export type Sichtung = S['SichtungAnzeige'];
export type Verlaufsnotiz = S['NotizAnzeige'];
export type Verbleib = S['VerbleibAnzeige'];
export type Abgleich = S['AbgleichAnzeige'];
export type PersonDetail = S['PersonDetail'];
export type PersonZugriff = S['ZugriffAnzeige'];
export type PersonZugriffArt = S['ZugriffArt'];
export type PersonAnhang = S['PersonAnhangAnzeige'];

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
/** LFH-21: Foto/Datei an einem Schaden; `id` ist die Linker-id, nicht `anhang.id`. */
export type SchadenAnhang = S['SchadenAnhangAnzeige'];
export type TierAnhang = S['TierAnhangAnzeige'];
export type UhsAnhang = S['UhsAnhangAnzeige'];
/** LFH-758: Lese-Audit je Abruf einer UHS-Datei (nur Einsatzleitung). */
export type AnhangZugriff = S['AnhangZugriffAnzeige'];

// ============================== E‑4 Tiere ==============================
export type TierStatus = S['TierStatus'];
export type Spezies = S['Spezies'];
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

/** POST-Body für ein freies taktisches Zeichen (Punkt-Marker ohne Fachobjekt). Kein
 *  Backend-Schema, FE-lokal; Overlays nutzen die DV-102-ID-Unions aus
 *  `taktische-zeichen-core`. */
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

/** PATCH-Body (Whole-Spec-Overwrite ohne lat/lon, nicht verschiebbar). */
export type FreiesZeichenUpdate = Omit<NeuesFreiesZeichen, 'lat' | 'lon'>;

// ============================== LFH-319 Kartenansichten ==============================
export type KartenAnsicht = S['KartenAnsichtAnzeige'];
export type KartenTheme = S['KartenTheme'];

/** PATCH-Body einer Ansicht, FE-lokal. Drei unabhängige Operationen im selben Endpunkt: „Für
 *  den Einsatz speichern“ (Config-Vollersatz), Umbenennen (`name`) und Standard-Setzen
 *  (`ist_standard: true`). Ein reines Umbenennen sendet NUR `name`, sonst wischte der
 *  Vollersatz die Config. `layer_sichtbar`/`fachebenen_sichtbar` sind serialisierte Bool-Maps. */
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

/** POST-Body „Als neue Ansicht speichern“: Pflicht-`name` + der aktuelle Karten-Zustand
 *  (dieselben Config-Felder wie beim Speichern). Nie Standard. */
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

/** POST-Body „Stand sichern“: optionale Bezeichnung/Notiz. FE-lokal. */
export interface NeuerLageSnapshot {
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
export type BefehlAbschnitt = S['BefehlAbschnitt'];
export type BefehlAnzeige = S['BefehlAnzeige'];

// ============================== LFH-606 Pegel-Kennzahl ==============================
export type PegelAnzeige = S['PegelAnzeige'];
export type PegelPrognose = S['PegelPrognose'];
export type PegelVorhersage = S['PegelVorhersage'];
export type PegelVorhersageAntwort = S['PegelVorhersageAntwort'];

// ============================== LFH-633 Wetter & Pegel ==============================
export type PegelVerlauf = S['PegelVerlauf'];
export type WetterAnzeige = S['WetterAnzeige'];
export type WetterOrt = S['WetterOrt'];
export type WetterWarnung = S['WetterWarnung'];
export type WetterWarnstufe = S['WetterWarnstufe'];
export type WetterAktuell = S['WetterAktuell'];
export type WetterErgaenzung = S['WetterErgaenzung'];
export type WetterMessgroesse = S['WetterMessgroesse'];
export type WetterSymbol = S['WetterSymbol'];

// ============================== LFH-632 Dokumentenablage ==============================
export type Dokument = S['DokumentAnzeige'];
export type DokumentKategorie = S['DokumentKategorie'];

// ============================== LFH-549 Funktionskatalog ==============================
export type Fuehrungsfunktion = S['Fuehrungsfunktion'];
export type FuehrungsfunktionEintrag = S['FuehrungsfunktionAnzeige'];
export type AktuelleBesetzung = S['AktuelleBesetzung'];

/** Kein Backend-Schema: Eingabe-Body von `PUT /api/org-fuehrungsfunktionen/{funktion}`. */
export interface FuehrungsfunktionUpdate {
  /** Leer = Standardlabel. */
  label?: string | null;
  /** Nur für `s7`. */
  aktiv?: boolean;
}

// ============================== LFH-46 Stab (S1–S6) ==============================
export type Stab = S['StabAnzeige'];
export type Stabsfunktion = S['StabsfunktionAnzeige'];
export type Lagebesprechung = S['LagebesprechungAnzeige'];
export type Sachgebiet = S['Sachgebiet'];
export type BesetzungArt = S['BesetzungArt'];
export type ChecklistenEintrag = S['ChecklistenEintrag'];
export type ChecklistenPunkt = S['ChecklistenPunkt'];

/**
 * Kein Backend-Schema: Eingabe-Body von `PUT …/stab/checkliste/{punkt}` (LFH-551), FE-lokal.
 * Beide Felder optional, mindestens eines Pflicht (sonst 400). `bemerkung: ''` oder `null` löscht.
 * Ein Bedienziel schickt genau SEIN Feld — der Server lässt das andere unverändert.
 */
export type ChecklistenPunktBody = { erledigt: boolean } | { bemerkung: string | null };

// Kommunikationsplan des S6 (LFH-848).
export type KommunikationsStelle = S['KommunikationsStelle'];
export type KommunikationsVerbindung = S['KommunikationsVerbindung'];
export type Stellenart = S['Stellenart'];
export type Verbindungsmittel = S['Verbindungsmittel'];

/**
 * Kein Backend-Schema: Eingabe-Body von `POST …/stab/kommunikationsplan/stellen`, FE-lokal.
 * `funktion` nur bei `stellenart: 'funktion'`; `bezeichnung` Pflicht bei externen Stellen und bei
 * Führungshilfspersonal/Fachberater, sonst weglassen (422).
 */
export interface NeueKommunikationsStelle {
  stellenart: Stellenart;
  funktion?: Fuehrungsfunktion;
  bezeichnung?: string;
}

/** Kein Backend-Schema: Eingabe-Body von `POST …/stellen/{sid}/verbindungen`, FE-lokal. */
export interface NeueVerbindung {
  mittel: Verbindungsmittel;
  wert: string;
  hinweis?: string;
}

/**
 * Kein Backend-Schema: Eingabe-Body von `PATCH …/kommunikationsplan/verbindungen/{vid}`. Fehlt =
 * unverändert, `hinweis: null` löscht. Unbekannte Felder lehnt der Server mit 400 ab.
 */
export interface VerbindungPatch {
  mittel?: Verbindungsmittel;
  wert?: string;
  hinweis?: string | null;
}

/**
 * Kein Backend-Schema: Eingabe-Body von `PUT …/stab/besetzung/{sachgebiet}`, FE-lokal.
 * `personal_id` ist `einsatz_personal.id` (= `EinsatzPersonal.id`). Überzählige Felder sind 422;
 * Aufrufer schicken NUR das Feld, das die Art verlangt.
 */
export interface BesetzungBody {
  besetzung_art: BesetzungArt;
  personal_id?: number;
  bezeichnung?: string;
}

/**
 * Kein Backend-Schema: Eingabe-Body von `POST …/stab/lagebesprechungen`, FE-lokal.
 *
 * `naechste_at` ist DREIWERTIG: Schlüssel fehlt = Termin unverändert · `null` = löschen · Wert =
 * setzen. Ein leerer String löscht STILL (`support::trimme_tri`), Aufrufer schicken nie `''`.
 * Zeiten als UTC 'YYYY-MM-DD HH:mm:ss'.
 */
export interface LagebesprechungAbschlussBody {
  entschluss: string;
  abgehalten_at?: string;
  naechste_at?: string | null;
}

// ============================== LFH-552 Kräfte-Zeitachse ==============================
export type ZeitachseArt = S['ZeitachseArt'];
export type ZeitachseQuelle = S['ZeitachseQuelle'];
export type ZeitachseMarke = S['ZeitachseMarke'];
export type Einsatzperiode = S['Einsatzperiode'];
export type ZeitachseEreignis = S['ZeitachseEreignis'];
export type Zeitachse = S['ZeitachseAnzeige'];
export type EinheitPerioden = S['EinheitPerioden'];
export type PersonPerioden = S['PersonPerioden'];

/**
 * Kein Backend-Schema: Eingabe-Body von `POST …/{einheiten|personal}/{id}/zeitachse`. Art ohne
 * `abloesung` (400); Zeitpunkt als UTC 'YYYY-MM-DD HH:mm:ss', nicht in der Zukunft (422).
 */
export interface ZeitachseNachtragBody {
  art: Exclude<ZeitachseArt, 'abloesung'>;
  zeitpunkt_at: string;
  notiz?: string;
}

// ============================== LFH-635 Ablösung ==============================
export type Abloesung = S['AbloesungAnzeige'];
export type AbloesungVollzug = S['AbloesungVollzugAnzeige'];
export type AbloesungVorgabe = S['AbloesungVorgabeAnzeige'];
export type AbloesungEinstufung = S['Einstufung'];

/**
 * Kein Backend-Schema: Eingabe-Body von `POST …/abloesungen`, FE-lokal. Ohne
 * `rhythmus_minuten` gilt die Vorgabe des Abschnitts der Einheit (fehlt die, 400); ohne
 * `beginn_at` der Zeitpunkt der Anlage. Zeiten als UTC 'YYYY-MM-DD HH:mm:ss'.
 */
export interface SchichtBeginnenBody {
  einheit_id: number;
  beginn_at?: string;
  rhythmus_minuten?: number;
}

/**
 * Kein Backend-Schema: Eingabe-Body von `PATCH …/abloesungen/{id}`, FE-lokal. DREIWERTIG:
 * Schlüssel fehlt = unverändert · `rhythmus_minuten: null` = zurück zur Abschnittsvorgabe ·
 * `abloesende_einheit_id: null` = Planung aufheben.
 */
export interface SchichtAendernBody {
  beginn_at?: string;
  rhythmus_minuten?: number | null;
  abloesende_einheit_id?: number | null;
}

/** Kein Backend-Schema: Eingabe-Body von `POST …/abloesungen/{id}/vollzug`. */
export interface VollzugBody {
  vollzogen_at?: string;
  abloesende_einheit_id?: number;
}

// ============================== LFH-639 Betreuung ==============================
export type Erhebung = S['Erhebung'];
export type Raeumungszustand = S['Raeumungszustand'];
export type BetreuungsstelleArt = S['BetreuungsstelleArt'];
export type BetreuungsstelleStatus = S['BetreuungsstelleStatus'];
export type Evakuierungsbezirk = S['EvakuierungsbezirkAnzeige'];
export type Betreuungsstelle = S['BetreuungsstelleAnzeige'];
export type BetreuungUebersicht = S['BetreuungUebersicht'];
export type StelleNamentlich = S['StelleNamentlich'];
export type BelegungKopfzahl = S['BelegungKopfzahl'];
/** Antwort auf Melden/Zurücknehmen eines Stands: `meldung_id` ist die GEMELDETE bzw.
 *  zurückgenommene Meldung — `bezirk.stand` ist die aktuelle und bei einer Nachtragung
 *  eine andere. Ein Rückgängig nimmt deshalb `meldung_id`, nie `bezirk.stand.id`. */
export type BezirkMeldung = S['BezirkMeldungAnzeige'];
/** Wie {@link BezirkMeldung}, für Belegungsmeldungen einer Stelle. */
export type StelleMeldung = S['StelleMeldungAnzeige'];
/** Eine Standmeldung im Verlauf eines Bezirks, zurückgenommene eingeschlossen. */
export type StandVerlaufEintrag = S['StandVerlaufEintrag'];
/** Eine Belegungsmeldung im Verlauf einer Stelle. */
export type BelegungVerlaufEintrag = S['BelegungVerlaufEintrag'];

/** Kein Backend-Schema: Eingabe-Body von `POST …/betreuung/bezirke` (`BezirkAnlegen`), FE-lokal. */
export interface EvakuierungsbezirkEingabe {
  bezeichnung: string;
  /** Ganzzahlig ≥ 1; fehlt oder kleiner → 400. */
  plan_personen: number;
  plan_erhebung: Erhebung;
  abschnitt_id?: number;
  sammelstelle?: string;
  notiz?: string;
}

/**
 * Kein Backend-Schema: Eingabe-Body von `PATCH …/betreuung/bezirke/{id}` (`BezirkAendern`).
 * DREIWERTIG bei `abschnitt_id`/`sammelstelle`/`notiz`: Schlüssel fehlt = unverändert · `null` =
 * lösen bzw. leeren. Ein PATCH ohne tatsächliche Änderung schreibt keinen ETB-Eintrag.
 */
export interface EvakuierungsbezirkPatch {
  bezeichnung?: string;
  abschnitt_id?: number | null;
  plan_personen?: number;
  plan_erhebung?: Erhebung;
  raeumung?: Raeumungszustand;
  sammelstelle?: string | null;
  notiz?: string | null;
}

/**
 * Kein Backend-Schema: Eingabe-Body von `POST …/betreuung/bezirke/{id}/staende` (`StandMelden`).
 * `evakuiert` ist eine ABSOLUTE Anzahl (≥ 0), kein Delta. Ohne `zeitpunkt_at` gilt „jetzt“, sonst
 * UTC `YYYY-MM-DD HH:mm:ss` über `alsBackendZeit`, höchstens 60 s in der Zukunft.
 */
export interface StandmeldungEingabe {
  evakuiert: number;
  erhebung: Erhebung;
  zeitpunkt_at?: string;
  /** Idempotenzschlüssel der Offline-Queue; ein Replay liefert die gespeicherte Meldung. */
  client_id?: string;
}

/**
 * Kein Backend-Schema: Eingabe-Body von `POST …/betreuung/stellen` (`StelleAnlegen`). Ohne
 * Kapazität gibt es keine Zahl freier Plätze.
 */
export interface BetreuungsstelleEingabe {
  bezeichnung: string;
  art: BetreuungsstelleArt;
  abschnitt_id?: number;
  /** Ganzzahlig ≥ 1, sonst 400. */
  kapazitaet_personen?: number;
  standort?: string;
  notiz?: string;
}

/**
 * Kein Backend-Schema: Eingabe-Body von `PATCH …/betreuung/stellen/{id}` (`StelleAendern`).
 * DREIWERTIG bei `abschnitt_id`/`kapazitaet_personen`/`standort`/`notiz`: Schlüssel fehlt =
 * unverändert · `null` = lösen bzw. „keine Kapazität“ bzw. leeren. `status: 'geschlossen'` bei
 * Belegung > 0 ist 422.
 */
export interface BetreuungsstellePatch {
  bezeichnung?: string;
  art?: BetreuungsstelleArt;
  abschnitt_id?: number | null;
  kapazitaet_personen?: number | null;
  status?: BetreuungsstelleStatus;
  standort?: string | null;
  notiz?: string | null;
  /** Koordinate: als Paar senden; `null`/`null` entfernt die Verortung. */
  lat?: number | null;
  lon?: number | null;
}

/**
 * Kein Backend-Schema: Eingabe-Body von `POST …/betreuung/stellen/{id}/belegungen`
 * (`BelegungMelden`). Absolute Anzahl (≥ 0); Zeitpunkt wie bei {@link StandmeldungEingabe}.
 * Nicht `BelegungEingabe`, den Namen trägt die UHS-Belegung (`api/einsatzUhs.ts`).
 */
export interface BelegungsmeldungEingabe {
  belegt: number;
  zeitpunkt_at?: string;
  /** Idempotenzschlüssel wie bei {@link StandmeldungEingabe}. */
  client_id?: string;
}

// ============================== LFH-634 Verpflegung ==============================
/** Übersicht `GET …/verpflegung`: alle Zeitfenster nach Beginn. */
export type Verpflegung = S['VerpflegungAnzeige'];
/** Zeitfenster samt Bedarf, ausgegebener Menge, Fehlmenge und Ausgaben. */
export type VerpflegungZeitfenster = S['ZeitfensterAnzeige'];
/** Eine Ausgabe; von der Nachforderung trägt sie nur `nachforderung_id`. */
export type VerpflegungAusgabe = S['AusgabeAnzeige'];
/** Antwort auf Erfassen/Zurücknehmen: `ausgabe_id` ist die betroffene Ausgabe — ein
 *  Rückgängig nimmt diese Kennung, `zeitfenster` trägt die nachgerechnete Deckung. */
export type VerpflegungAusgabeErgebnis = S['AusgabeErgebnis'];
/** Die fünf festen Kostformen als Teilmenge. */
export type Sonderkost = S['Sonderkost'];
export type Kostform = keyof Sonderkost;

/**
 * Kein Backend-Schema: `sonderkost` in den Eingabe-Bodies (`SonderkostEingabe`). Jedes Feld
 * optional; beim PATCH ersetzen gesetzte Felder, fehlende bleiben stehen.
 */
export type SonderkostEingabe = Partial<Sonderkost>;

/**
 * Kein Backend-Schema: Eingabe-Body von `POST …/verpflegung/zeitfenster` (`ZeitfensterAnlegen`).
 * Zeiten als UTC `YYYY-MM-DD HH:mm:ss` oder ISO mit Zone; `bis_at` muss nach `von_at` liegen
 * (sonst 422).
 */
export interface ZeitfensterEingabe {
  bezeichnung: string;
  von_at: string;
  bis_at: string;
  bedarf_kraefte: number;
  bedarf_betreute: number;
  bedarf_weitere?: number;
  sonderkost?: SonderkostEingabe;
}

/**
 * Kein Backend-Schema: Eingabe-Body von `PATCH …/verpflegung/zeitfenster/{id}`
 * (`ZeitfensterAendern`). Zweiwertig: Schlüssel fehlt = unverändert, es gibt kein `null`.
 * Wertgleichheit schreibt weder ETB-Eintrag noch Ereignis.
 */
export type ZeitfensterPatch = Partial<ZeitfensterEingabe>;

/**
 * Kein Backend-Schema: Eingabe-Body von `POST …/verpflegung/zeitfenster/{id}/ausgaben`
 * (`AusgabeErfassen`). Ohne `zeitpunkt_at` gilt „jetzt“; `menge` > 0; die Sonderkost ist
 * Teilmenge der Menge (sonst 422). Eine fremde `nachforderung_id` ist 404.
 */
export interface AusgabeEingabe {
  menge: number;
  zeitpunkt_at?: string;
  ort?: string;
  sonderkost?: SonderkostEingabe;
  nachforderung_id?: number;
  bemerkung?: string;
  /** Idempotenzschlüssel der Offline-Queue (LFH-688); ein Replay liefert die gespeicherte Ausgabe. */
  client_id?: string;
}

// ============================== LFH-51 Terminierte Erinnerungen ==============================
export type Erinnerung = S['ErinnerungAnzeige'];

/** Kein Backend-Schema: Eingabe-Body, FE-lokal. */
export interface NeueErinnerung {
  titel: string;
  beschreibung?: string;
  /** 'YYYY-MM-DD HH:MM' (UTC). */
  faellig_at: string;
  intervall_minuten?: number;
  /** Freitext — oder die Bezeichnung bei Führungshilfspersonal/Fachberater (LFH-549). */
  empfaenger_funktion?: string;
  /** Katalogcode (LFH-549). */
  empfaenger_funktion_code?: Fuehrungsfunktion;
  /** Generischer Sachbezug (z. B. 'etb' + ETB-Eintrag-ID); both-or-neither. */
  bezug_typ?: string;
  bezug_id?: number;
}

// ============================== LFH-52 Aufträge/Befehle ==============================
export type AuftragPrioritaet = S['Prioritaet'];
export type EmpfaengerTyp = S['EmpfaengerTyp'];
export type Richtung = S['Richtung'];
export type AuftragEmpfaenger = S['AuftragEmpfaengerAnzeige'];
export type Auftrag = S['AuftragDetail'];

/** Kein Backend-Schema: Eingabe-Body, FE-lokal. */
export interface NeuerEmpfaenger {
  empfaenger_typ: EmpfaengerTyp;
  abschnitt_id?: number;
  einheit_id?: number;
  person_id?: number;
  fahrzeug_id?: number;
  /** Freitext — oder die Bezeichnung bei Führungshilfspersonal/Fachberater (LFH-549). */
  funktion_text?: string;
  /** Katalogcode beim Funktionsempfänger (LFH-549). */
  funktion?: Fuehrungsfunktion;
  extern_kategorie?: AdressatKategorie;
  extern_bezeichnung?: string;
}

/** Kein Backend-Schema: Eingabe-Body, FE-lokal. */
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

// --- Meldungen (eingehend) ---
export type MeldungPrioritaet = S['Prioritaet'];
export type MeldungStatus = S['MeldungStatus'];
export type Meldungsart = S['Meldungsart'];
export type MeldungMeldeweg = S['MeldeWeg'];
export type Meldung = S['MeldungAnzeige'];

/** Kein Backend-Schema: Eingabe-Body, FE-lokal. */
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
  /** Bestätigungspflicht erzwingen; undefined ⇒ aus Sofort-Klassifikation abgeleitet. */
  bestaetigung_pflicht?: boolean;
  /** Override der Default-Bestätigungsfrist (Minuten ab Eingang). */
  bestaetigung_frist_min?: number;
  /** Stabiler Offline-Idempotenzschlüssel; bei Replay liefert der Server die
   * bereits angelegte Meldung statt einer Dublette. */
  client_id?: string;
  /** Strukturierter Absender: Einheit ODER Abschnitt dieses Einsatzes, nie beide. */
  einheit_id?: number;
  abschnitt_id?: number;
}

export type LageMeldung = S['LageMeldungAnzeige'];
/** Letzte Rückmeldung je Einheit bzw. direkt gebundenem Abschnitt. */
export type Rueckmeldungen = S['RueckmeldungenAnzeige'];
export type LetzteRueckmeldung = S['LetzteRueckmeldung'];

// ============================== LFH-87 Nachforderung Kräfte/Mittel ==============================
export type NachforderungPrioritaet = S['Prioritaet'];
export type NachforderungStatus = S['NachforderungStatus'];
export type AdressatKategorie = S['AdressatKategorie'];
export type Nachforderung = S['NachforderungAnzeige'];

/** Kein Backend-Schema: Eingabe-Body, FE-lokal. */
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

// ============================== Aufbewahrung (Archiv des Org-Admins) ==============================
/** Aufbewahrungszustand eines abgeschlossenen Einsatzes (sieben Werte, `retention::zustand`). */
export type AufbewahrungZustand = S['AufbewahrungZustand'];
/** Zeile der Aufbewahrungsübersicht (`GET /api/aufbewahrung`). */
export type AufbewahrungEintrag = S['AufbewahrungEintragAnzeige'];
/** Pseudonyme Archivakte: Kopf, Zustand, Register — nur Retain-Spalten. */
export type ArchivAkte = S['ArchivAkteAnzeige'];
export type ArchivPerson = S['ArchivPersonAnzeige'];
export type ArchivTier = S['ArchivTierAnzeige'];
export type ArchivSchaden = S['ArchivSchadenAnzeige'];
/** ETB-Eintrag der Archivakte im Wortlaut, ohne Anhänge und Rückverweise. */
export type ArchivEtbEintrag = S['ArchivEtbEintragAnzeige'];

/** Body von `POST /api/aufbewahrung/einsaetze/{id}/wiederherstellen`. Kein Backend-Schema,
 *  FE-lokal. `retention_bis` ist PFLICHT: ein Zeitpunkt in der Zukunft (UTC,
 *  `YYYY-MM-DD HH:mm:ss`) oder `null` für unbegrenzt. */
export interface WiederherstellenBody {
  retention_bis: string | null;
}

/** Body von `PUT /api/einsaetze/{id}/aufbewahrungsfrist`. `null` hebt die Frist auf; eine
 *  Verkürzung braucht `bestaetigt: true`, sonst 409. Kein Backend-Schema, FE-lokal. */
export interface FristSetzenBody {
  retention_bis: string | null;
  bestaetigt?: boolean;
}

// ---- Löschersuchen nach Art. 17 (LFH-751) ----
/** Personenart eines Löschersuchens: Betroffene, externe Kraft, Anruf, Medienkontakt. */
export type PersonenArt = S['PersonenArt'];
/** Zielart eines Antrags: `einsatz` oder eine {@link PersonenArt}. */
export type AntragZielArt = S['AntragZielArt'];
export type AntragStand = S['AntragStand'];
/** Ein Schwärzungsantrag der Archivakte — Ziel nur als Art und pseudonyme Kennung. */
export type Schwaerzungsantrag = S['SchwaerzungsantragAnzeige'];
/** Treffer der pseudonymen Personensuche — ohne Name oder Kontakt. */
export type PersonTreffer = S['PersonTrefferAnzeige'];

/** Body von `POST …/schwaerzungsantraege`. Kein Backend-Schema, FE-lokal. `ziel.id` fehlt beim
 *  Einsatz und ist bei einer Person Pflicht; `bestaetigung` ist die eingetippte Kennung. */
export interface NeuerSchwaerzungsantrag {
  ziel: { art: AntragZielArt; id?: number };
  aktenzeichen: string;
  bestaetigung: string;
}

// ============================== LFH-749 Fristen je Datenkategorie ==============================
/** Datenkategorie mit eigener Aufbewahrungsfrist (`behandlung`, `personenauskunft`, `anhaenge`). */
export type Datenkategorie = S['Datenkategorie'];
/** Org-Vorgabe einer Kategorie: Dauer in Tagen und Rechtsgrundlage. */
export type KategorieVorgabe = S['KategorieVorgabe'];
/** Aufbewahrung einer Kategorie am Einsatz bzw. in der Archivakte (Frist, Zustand, Rechtsgrundlage). */
export type KategorieAufbewahrung = S['KategorieAufbewahrungAnzeige'];

/** Body von `PUT /api/einsaetze/{id}/aufbewahrungsfrist/{kategorie}`. `null` hebt die Frist auf
 *  (die Kategorie folgt der Einsatz-Frist); eine Verkürzung braucht `bestaetigt: true`, sonst 409;
 *  die erste Frist einer Kategorie braucht eine Rechtsgrundlage, sonst 422. Kein Backend-Schema,
 *  FE-lokal. */
export interface KategorieFristBody {
  retention_bis: string | null;
  bestaetigt?: boolean;
  rechtsgrundlage?: string;
}

// ============================== LFH-554 Presse- und Medienarbeit S5 ==============================
export type MedienkontaktArt = S['MedienkontaktArt'];
export type MedienkontaktStatus = S['MedienkontaktStatus'];
export type Medienkontakt = S['MedienkontaktAnzeige'];
export type PressemitteilungVorlageKey = S['PressemitteilungVorlage'];
export type PressemitteilungStatus = S['PressemitteilungStatus'];
export type PressemitteilungAbschnitt = S['PressemitteilungAbschnitt'];
export type Pressemitteilung = S['PressemitteilungAnzeige'];
export type InfotelefonAnliegen = S['InfotelefonAnliegen'];
export type InfotelefonStatus = S['InfotelefonStatus'];
export type InfotelefonAnruf = S['InfotelefonAnrufAnzeige'];
