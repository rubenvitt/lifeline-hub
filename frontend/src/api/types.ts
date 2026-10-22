// Barrel über die aus Rust generierten Schemas (`types.generated.ts`, LFH-120). Nicht von Hand
// pflegen: Response-Typen ändern sich über die Rust-Structs + `scripts/check-typ-codegen.sh`.
// FE-lokale Typen (Eingabe-Bodies, Record-Maps) sind unten als „kein Backend-Schema“ markiert.
import type { components } from './types.generated';

type S = components['schemas'];

// ============================== Auth ==============================
export type AuthProvider = S['AuthProviderAnzeige'];
export type AppCode = S['AppCode'];
export type Einmalpasswort = S['Einmalpasswort'];
// TOTP-Enroll-DTOs (`/api/auth/totp/enroll/start|finish`).
export type TotpEnrollStart = S['TotpEnrollStart'];
export type TotpEnrollFinish = S['TotpEnrollFinish'];
/** Antwort von `GET /api/auth/me`: der Benutzer, bei einer Gerätesitzung (LFH-892) mit `geraet`. */
export type MeAntwort = S['MeAntwort'];

// ============================== Gerätekopplung (LFH-892) ==============================
export type Funktionsansicht = S['Funktionsansicht'];
export type GeraetAnzeige = S['GeraetAnzeige'];
export type LagemonitorAnzeige = S['LagemonitorAnzeige'];
export type LagemonitorUhs = S['LagemonitorUhs'];
export type LagemonitorZone = S['LagemonitorZone'];
export type LagemonitorAbschnitt = S['LagemonitorAbschnitt'];
export type KopplungAnzeige = S['KopplungAnzeige'];
export type KopplungStatus = S['KopplungStatus'];
export type KopplungMitCode = S['KopplungMitCode'];
export type KopplungsCode = S['KopplungsCode'];
export type GeraeteUebersicht = S['GeraeteUebersicht'];
export type AnsichtSperre = S['AnsichtSperre'];
export type AnsichtAuswahl = S['AnsichtAuswahl'];
export type Bindungsart = S['Bindungsart'];

// ============================== Benutzer / Einsatz ==============================
export type SystemRolle = S['SystemRolle'];
export type OrgRolle = S['OrgRolle'];
export type BenutzerAnzeige = S['BenutzerAnzeige'];
/** Eine laufende Sitzung in der Sitzungsliste (LFH-1092). */
export type SitzungAnzeige = S['SitzungAnzeige'];
export type SitzungenBeendet = S['SitzungenBeendet'];
export type EinsatzStatus = S['EinsatzStatus'];
export type EinsatzRolle = S['EinsatzRolle'];
export type Einsatzart = S['Einsatzart'];
/** Aktive lagebezogene Kennzahl am Einsatz (LFH-640) — Auslöser eines Lageplatzes im Lage-Dashboard. */
export type Lagekennzahl = S['Lagekennzahl'];
export type EinsatzAnzeige = S['EinsatzAnzeige'];
export type MitgliedAnzeige = S['MitgliedAnzeige'];
export type MitgliedAuswahl = S['MitgliedAuswahl'];
export type StichwortVorschlag = S['StichwortVorschlag'];
/** Präferenzen des angemeldeten Benutzers. `eintraege` ist SPARSE: ein fehlender Schlüssel
 *  heißt „nie geschrieben“; der Wert ist ein opaker Text, dessen Form nur der Besitzer des
 *  Schlüssels kennt. */
export type BenutzerEinstellungen = S['BenutzerEinstellungenAnzeige'];
export type VersionsstandAnzeige = S['VersionsstandAnzeige'];

// ============================== Benachrichtigungen (kcjecn9e) ==============================
export type BenachrichtigungArt = S['BenachrichtigungArt'];
export type BenachrichtigungStufe = S['BenachrichtigungStufe'];
export type BenachrichtigungBezugTyp = S['BenachrichtigungBezugTyp'];
/** Eine Benachrichtigung mit dem Text, den der Server beim Lesen bildet. */
export type BenachrichtigungAnzeige = S['BenachrichtigungAnzeige'];
/** Nutzlast von `benachrichtigung` (Einsatz-Strom) und `org_benachrichtigung` (Org-Kanal). */
export type BenachrichtigungEreignis = S['BenachrichtigungEreignis'];
/** Antwort von `GET /api/web-push` (LLH-1223): Schlüssel der Instanz, Abo dieser Sitzung. */
export type WebPushStand = S['WebPushStand'];

// ============================== Karten-/Anzeige-Defaults ==============================
export type BasemapModus = S['BasemapModus'];
export type Zeitdarstellung = S['Zeitdarstellung'];
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

// ============================== Datenträgerprüfung (LFH-1100) ==============================
/** Letztes Ergebnis der Datenträgerprüfung des Server-Rechners, nur für den System-Admin. */
export type DatentraegerStatus = S['DatentraegerStatus'];
export type DatentraegerOrt = S['DatentraegerOrt'];

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
  zeitdarstellung: Zeitdarstellung | null;
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

/** Benötigte Rolle eines Moduls (Spec `modul-freigabe`, LFH-1150); `null` = frei. Der Server
 *  typisiert das Feld als freien String und weist andere Werte mit 400 ab. */
export type BenoetigteRolle = 'admin' | 'fuehrungskraft' | 'einsatzfuehrung';

/** Vorgabe der Organisation für ein Modul (LLH-1179): Rolle und aufgelöste Sichtbarkeit
 *  (`false` nur, wenn die Organisation das Modul ausblendet). */
export type OrgModulEinstellung = S['OrgModulEinstellung'];

/** Org-weite Modul-Vorgaben (GET /api/org-modul-einstellungen): Map modul_key → Vorgabe; fehlt ein
 *  Key, gibt die Organisation nichts vor (sichtbar, frei). Die Map ist FE-lokal, der Eintrag nicht. */
export type OrgModulEinstellungen = Record<string, OrgModulEinstellung>;

/** PUT-Eingabe einer Org-Modul-Vorgabe; der Client schickt immer beide Felder (design.md D5 der
 *  Change `archive/2026-10-13-ivtkmf43-org-modul-sichtbarkeit`). Kein Backend-Schema, FE-lokal. */
export interface OrgModulEinstellungUpdate {
  benoetigte_rolle: BenoetigteRolle | null;
  sichtbar: boolean;
}

export type EinsatzEinstellungen = S['EinstellungenMitOrgDefaults'];

/** PUT-Eingabe (Vollersatz) der Einsatz-Einstellungen. Kein Backend-Schema, FE-lokal. */
export interface EinstellungenUpdate {
  standard_modul: string | null;
  basemap_modus: BasemapModus | null;
  karten_zoom_start: number | null;
  fachebenen_sichtbar: FachebenenSichtbar | null;
  zeitzone: string | null;
  zeitdarstellung: Zeitdarstellung | null;
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
  /** Eigener Wert des Einsatzes; `null` = erbt (Organisation ?? sichtbar, LLH-1179). */
  sichtbar: boolean | null;
  benoetigte_rolle: BenoetigteRolle | null;
}

// ============================== ETB ==============================
export type EtbTyp = S['EtbTyp'];
export type MeldeWeg = S['MeldeWeg'];
export type EtbEintragAnzeige = S['EtbEintragAnzeige'];
export type EtbBaustein = S['EtbBaustein'];
/** Katalog „Externe Stellen“ (LFH-1194). */
export type ExterneStelle = S['ExterneStelle'];
export type ExterneStelleArt = S['ExterneStelleArt'];
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
export type MaterialArt = S['MaterialArt'];
export type Material = S['MaterialAnzeige'];
export type EinsatzMaterial = S['EinsatzMaterialAnzeige'];
export type StaerkePosition = S['StaerkePosition'];
export type Personal = S['PersonalAnzeige'];
export type PersonalVorschlaege = S['PersonalVorschlaege'];
export type Qualifikation = S['Qualifikation'];
export type PersonalStatus = S['PersonalStatus'];
export type EinheitTyp = S['EinheitTyp'];
export type EinsatzPersonal = S['EinsatzPersonalAnzeige'];
/** Grund je abgelehnter Kraft der Sammel-Disposition (LLH-1100, `ApiError.zeilen`). */
export type ZeilenGrund = S['ZeilenGrund'];
export type ZeilenArt = S['ZeilenArt'];

// ============================== LLH-1042 Einheiten-Vorlagen ==============================
export type EinheitVorlage = S['EinheitVorlage'];
export type EinheitVorlageFahrzeug = S['EinheitVorlageFahrzeug'];
export type EinheitVorlagePersonal = S['EinheitVorlagePersonal'];

// ============================== LLH-1049 Einheit aus Vorlage ==============================
/** Vorschau einer Vorlage im Einsatz: Baum und Zustand jeder Kraft (Spec `einheit-vorlagen`). */
export type VorlageVorschau = S['VorlageVorschau'];
export type VorschauKnoten = S['VorschauKnoten'];
export type VorschauFahrzeug = S['VorschauFahrzeug'];
export type VorschauPersonal = S['VorschauPersonal'];
export type VorschauZustand = S['VorschauZustand'];
export type AusVorlageErgebnis = S['AusVorlageErgebnis'];

/** POST-Body des Bildens (`AusVorlageBody` in `src/routes/einsatz_einheit.rs`). Kein
 *  Backend-Schema, FE-lokal. Jede Zeile trägt ihr „umhängen“ (design.md D3). */
export interface AusVorlageEingabe {
  vorlage_id: number;
  /** Name der obersten Einheit; fehlt er, gilt der Name der Vorlage. */
  name?: string | null;
  abschnitt_id?: number | null;
  fahrzeuge: { fahrzeug_id: number; umhaengen: boolean }[];
  personal: { personal_id: number; umhaengen: boolean }[];
}

/** POST-Body einer Einheiten-Vorlage (`VorlageBody` in `src/routes/einheit_vorlage.rs`). Kein
 *  Backend-Schema, FE-lokal. Das Soll geht als Trio oder gar nicht. */
export interface NeueEinheitVorlage {
  name: string;
  typ_id: number;
  ueber_vorlage_id?: number | null;
  funkrufname?: string | null;
  tz_fachaufgabe?: string | null;
  tz_organisation?: string | null;
  soll_fuehrer?: number | null;
  soll_unterfuehrer?: number | null;
  soll_mannschaft?: number | null;
  bemerkung?: string | null;
  sortier?: number;
}

/** PATCH-Body (Tri-State: fehlender Key = unverändert, `null` = leeren bzw. Wurzel). Kein
 *  Backend-Schema, FE-lokal. Name und Typ lassen sich nicht leeren. */
export interface PatchEinheitVorlage {
  name?: string;
  typ_id?: number;
  ueber_vorlage_id?: number | null;
  funkrufname?: string | null;
  tz_fachaufgabe?: string | null;
  tz_organisation?: string | null;
  soll_fuehrer?: number | null;
  soll_unterfuehrer?: number | null;
  soll_mannschaft?: number | null;
  bemerkung?: string | null;
  sortier?: number;
  aktiv?: boolean;
}

/** Eine Zeile der Stammbesetzung im PUT. Kein Backend-Schema, FE-lokal. */
export interface EinheitVorlagePersonalEingabe {
  personal_id: number;
  fahrzeug_id?: number | null;
  staerke_position?: StaerkePosition | null;
}

// ============================== LFH-109 Sprechgruppen-Katalog ==============================
export type Betriebsart = S['Betriebsart'];
export type Sprechgruppe = S['SprechgruppeAnzeige'];

/** Eingabe-Body für Anlegen und PATCH einer Sprechgruppe. Kein Backend-Schema, FE-lokal. */
export interface SprechgruppeEingabe {
  bezeichnung: string;
  betriebsart: Betriebsart;
  hinweis?: string | null;
  netz?: string | null;
  sicherheit?: string | null;
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
/** Eigene Führungsstelle des Einsatzes (LFH-849), seit LFH-1181 ein Ort mit Art und Standort. */
export type Fuehrungsstelle = S['FuehrungsstelleAnzeige'];
/** `mobil` (ELW) oder `ortsfest` (TEL im Rathaus), nie leer (LFH-1181). */
export type FuehrungsstellenArt = S['FuehrungsstellenArt'];
/** Der Einsatzleiter an der eigenen Führungsstelle (LFH-1199). */
export type Einsatzleiter = S['EinsatzleiterAnzeige'];
export type EinsatzleiterArt = S['EinsatzleiterArt'];

/**
 * Ein neuer Einsatzleiter im PATCH der Führungsstelle: eine disponierte Person oder ein externer
 * als Freitext; ohne `seit` gilt die Zeit des Speicherns.
 */
export type EinsatzleiterEingabe =
  | { art: 'personal'; personal_id: number; seit?: string }
  | { art: 'extern'; name: string; seit?: string };

/**
 * Teiländerung der Führungsstelle (kein Backend-Schema, `routes/einsatz_fuehrungsstelle.rs`):
 * fehlender Schlüssel = unverändert, `null` = leeren; `sprechgruppe_ids` ersetzt vollständig.
 */
export interface FuehrungsstellePatch {
  /** Nie `null`: die Art lässt sich nicht leeren (400). */
  art?: FuehrungsstellenArt;
  bezeichnung?: string | null;
  standort_adresse?: string | null;
  /** Koordinate des Standorts, nur als Paar (sonst 422). */
  standort_lat?: number | null;
  standort_lon?: number | null;
  rufname?: string | null;
  kommunikationsmittel?: string | null;
  erreichbarkeit?: string | null;
  sprechgruppe_ids?: number[];
  /** Dispositionszeilen, die die Führungsstelle tragen (LFH-1106); ersetzt vollständig. */
  fahrzeug_ids?: number[];
  /** Der Einsatzleiter (LFH-1199); `null` leert ihn, ein Wechsel schreibt ins ETB. */
  einsatzleiter?: EinsatzleiterEingabe | null;
}

// ============================== E‑2 Personen ==============================
export type PersonStatus = S['PersonStatus'];
/** Stand eines Vermisstenabgleichs (Farbe: `theme/statusFarben.ts:abgleichStatus`). */
export type AbgleichStatus = S['AbgleichStatus'];
export type Person = S['PersonAnzeige'];
/** Personenauswahl ohne Freitexte (LFH-940): Zeile je nicht stornierter Person für Picker,
 *  Sprungpalette und Chat-Bezug. */
export type PersonAuswahl = S['PersonAuswahl'];
export type Sichtungskategorie = S['Sichtungskategorie'];
export type VerbleibArt = S['VerbleibArt'];
export type VerbleibStatus = S['VerbleibStatus'];
export type TransportDurch = S['TransportDurch'];
export type Versorgung = S['Versorgung'];
export type TransportmittelAuswahl = S['TransportmittelAuswahl'];
export type EinsatzTransportfahrzeug = S['EinsatzTransportfahrzeug'];
export type Sichtung = S['SichtungAnzeige'];
export type Verlaufsnotiz = S['NotizAnzeige'];
export type Verbleib = S['VerbleibAnzeige'];
export type Bestaetiger = S['Bestaetiger'];
export type Abgleich = S['AbgleichAnzeige'];
export type PersonDetail = S['PersonDetail'];
export type PersonZugriff = S['ZugriffAnzeige'];
export type PersonZugriffArt = S['ZugriffArt'];
export type PersonAnhang = S['PersonAnhangAnzeige'];
/** Transport einer Person (LLH-1325): Verlaufseintrag und seine Kataloge. */
export type Transport = S['TransportAnzeige'];
export type TransportPrioritaet = S['TransportPrioritaet'];
export type TransportArt = S['TransportArt'];
export type Fachrichtung = S['Fachrichtung'];
/** Maßnahme am Patienten (LLH-1324): Eintrag mit Durchführung, aufgehoben mit `aufgehoben_at`. */
export type Massnahme = S['MassnahmeAnzeige'];
export type MassnahmeArt = S['MassnahmeArt'];
/** Verletzung am Körperschema (LLH-1113): Ansicht, Region, Art, optional Schwere und Lage. */
export type Verletzung = S['VerletzungAnzeige'];
export type VerletzungAnsicht = S['VerletzungAnsicht'];
export type VerletzungArt = S['VerletzungArt'];
export type VerletzungSchwere = S['VerletzungSchwere'];
export type KoerperRegion = S['KoerperRegion'];

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
/** Kraft an einer UHS (LFH-1045): Name, Funktion, Position, Einheit. */
export type UhsKraft = S['UhsKraft'];

// ============================== LFH-14 Bereitstellungsräume ==============================
export type BrStatus = S['BrStatus'];
export type ObjektTyp = S['ObjektTyp'];
export type BrBelegungsArt = S['BrBelegungsArt'];
export type Bereitstellungsraum = S['BrAnzeige'];
export type BrDetail = S['BrDetail'];
export type BrEinheitKurz = S['BrEinheitKurz'];
export type BrFahrzeugKurz = S['BrFahrzeugKurz'];
export type BrBelegung = S['BrBelegungAnzeige'];
// LLH-1095: Kennzahlen, Fahrzeuge der Einheiten, Liste mit Belegung, Verlauf.
export type BrBelegungKennzahlen = S['BrBelegungKennzahlen'];
export type BrEinheitFahrzeug = S['BrEinheitFahrzeug'];
export type BrListenEintrag = S['BrListenEintrag'];
export type BrVerlaufArt = S['BrVerlaufArt'];
export type BrVerlaufEintrag = S['BrVerlaufEintrag'];
// LLH-1075: Eintreffen buchen (bekannt oder unangemeldet), Übernehmen einer unangemeldeten Einheit.
export type EintreffenEingabe = S['EintreffenEingabe'];
export type EintreffenErgebnis = S['EintreffenErgebnis'];
export type EintreffenZeitachse = S['EintreffenZeitachse'];
export type UebernahmeBody = S['UebernahmeBody'];
// LLH-1085: Abruf einer Kraft aus dem Raum (abgeleitet im Detail, Antwort der Route).
export type BrAbrufKurz = S['BrAbrufKurz'];
export type BrAbrufErgebnis = S['BrAbrufErgebnis'];

// ============================== Chat / Anhänge ==============================
export type ChatKanal = S['ChatKanalAnzeige'];
export type Anhang = S['AnhangAnzeige'];
export type ChatNachricht = S['ChatNachrichtAnzeige'];
export type BezugTyp = S['BezugTyp'];
/**
 * Eine Erwähnung beim Senden einer Nachricht (LLH-1220, handgepflegt wie alle Request-DTOs): ein
 * Mitglied oder eine Führungsfunktion. Der Text trägt nur `@Anzeige`.
 */
export type ChatErwaehnung = { benutzer_id: number } | { funktion: Fuehrungsfunktion };

// ============================== E‑5 Schäden ==============================
export type SchadenStatus = S['SchadenStatus'];
export type SchadenTyp = S['SchadenTyp'];
export type Ausmass = S['Ausmass'];
export type SchadenAbschlussGrund = S['SchadenAbschlussGrund'];
export type Schaden = S['SchadenAnzeige'];
/** LFH-931: Schadenmarker für Lagekarte und Lage-Dashboard, ohne Freitexte. */
export type SchadenMarker = S['SchadenMarker'];
export type Schadensgrad = S['Schadensgrad'];
export type SchadenKennzahlen = S['SchadenKennzahlen'];
export type SchadenAuswahl = S['SchadenAuswahl'];
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
/** Ein freies Zeichen, wie die Route es liefert (`zeichen_spec` ist dort Pflicht, LLH-1160) oder
 *  wie ein Lage-Snapshot von vor LFH-836 es eingefroren hat: nur die Altform, ohne
 *  `zeichen_spec`. Der Leseadapter `zeichen/freiesZeichen.ts` nimmt beides. */
export type FreiesZeichen = Omit<S['FreiesZeichenAnzeige'], 'zeichen_spec'> & {
  zeichen_spec?: string | null;
  grundzeichen?: string | null;
  organisation?: string | null;
  fachaufgabe?: string | null;
  symbol?: string | null;
  einheit?: string | null;
  funktion?: string | null;
  farbe?: string | null;
};

/** POST-Body für ein freies taktisches Zeichen (Punkt-Marker ohne Fachobjekt). Kein
 *  Backend-Schema, FE-lokal. Das Zeichen steht allein in `zeichen_spec`, der kanonischen
 *  Zeichenbeschreibung von @einsatzzeichen (`serializeAnySpec`; LFH-836, design.md D1). Den alten
 *  Body mit Grundzeichen und Overlays lehnt der Server seit LLH-1160 ab. */
export interface NeuesFreiesZeichen {
  lat: number;
  lon: number;
  zeichen_spec: string;
  label?: string | null;
  /** Ansichts-Zugehörigkeit (LFH-320): aktive Ansicht beim Anlegen; `null` = auf allen. */
  ansicht_id?: number | null;
}

/** PATCH-Body (ohne lat/lon, nicht verschiebbar). `zeichen_spec` schreibt das Zeichen; eine
 *  Altzeile (Hülle aus Migration 0192) wird so beim nächsten Ändern zur Spec. */
export type FreiesZeichenUpdate = Omit<NeuesFreiesZeichen, 'lat' | 'lon'>;

/** Teil-PATCH: Nur eine Umbenennung schickt bloß `label`, dann bleibt die gespeicherte Form —
 *  auch die Hülle einer Altzeile mit Alt-Kennung und Alt-Farbe — unverändert (LFH-836, Review). */
export type FreiesZeichenPatch = Partial<FreiesZeichenUpdate>;

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
/** LFH-931: Listenzeile ohne Abschnitte; den Text liefert nur das Detail. */
export type LageberichtKopf = S['LageberichtKopf'];

// ============================== LFH-64 Befehlsgebung ==============================
export type BefehlVorlageKey = S['BefehlVorlage'];
export type BefehlAbschnitt = S['BefehlAbschnitt'];
export type BefehlAnzeige = S['BefehlAnzeige'];
/** LFH-931: Listenzeile ohne Abschnitte. */
export type BefehlKopf = S['BefehlKopf'];

// ============================== LFH-1028 Dokument-Anlagen ==============================
export type DokumentAnlage = S['DokumentAnlageAnzeige'];
/** Ein Eintrag des Verteilers an Befehl und Lagebericht (LLH-1172), mit Anzeigename. */
export type VerteilerEintrag = S['VerteilerEintragAnzeige'];
export type AnlageArt = S['AnlageArt'];

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

// ============================== LLH-1111 Lagebesprechung ==============================
export type Lagebesprechung = S['LagebesprechungAnzeige'];
export type LagebesprechungStand = S['LagebesprechungStand'];

/**
 * Kein Backend-Schema: Eingabe-Body von `POST …/lagebesprechungen`, FE-lokal.
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

/**
 * Kein Backend-Schema: Eingabe-Body von `PUT …/lagebesprechung/termin`, FE-lokal. Der Schlüssel
 * ist Pflicht: Zeitpunkt (UTC 'YYYY-MM-DD HH:mm:ss') = setzen, `null` = kein Termin.
 */
export interface LagebesprechungTerminBody {
  naechste_at: string | null;
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
/** Vorgabe des Einsatzes (LLH-1122): Kopie eines Schichtmodells, Vorwarnung, folgende Schichten. */
export type AbloesungEinsatzVorgabe = S['AbloesungEinsatzVorgabeAnzeige'];
export type RhythmusQuelle = S['RhythmusQuelle'];
/** Status einer Schicht (LLH-1128: `beendet` endet ohne Ablösung, mit `beendet_grund`). */
export type AbloesungStatus = S['AbloesungStatus'];
export type BeendetGrund = S['BeendetGrund'];
/** Ein Ablöser einer Schicht und eine Folgeschicht aus ihrem Vollzug (LLH-1132). */
export type AbloesungAbloeser = S['AbloesungAbloeser'];
export type AbloesungFolge = S['AbloesungFolge'];
/** Warnung zur geplanten ablösenden Einheit (LLH-1131): schon geplant oder selbst im Einsatz. */
export type AbloesungPlanungWarnung = S['AbloesungPlanungWarnung'];
/** Art des Vollzugs und eine Person beim Besatzungswechsel (LLH-1150). */
export type AbloesungArt = S['AbloesungArt'];
export type AbloesungBesatzung = S['AbloesungBesatzung'];
export type BesatzungRolle = S['BesatzungRolle'];

// ============================== LLH-1375 Einsatz-Vorlagen ==============================
/** Modulsatz der Organisation mit optionaler Einsatzart; `ausgeblendet` sind Modulschlüssel. */
export type EinsatzVorlage = S['EinsatzVorlage'];

/**
 * Kein Backend-Schema: `POST /api/einsatz-vorlagen`, `PUT /api/einsatz-vorlagen/{id}`
 * (Vollersatz, alle Felder Pflicht). Gespeichert werden die ausgeblendeten Module.
 */
export interface EinsatzVorlageEingabe {
  bezeichnung: string;
  einsatzart: Einsatzart | null;
  ausgeblendet: string[];
}

// ============================== LLH-1122 Schichtmodelle ==============================
export type Schichtmodell = S['Schichtmodell'];
export type SchichtmodellTyp = S['SchichtmodellTyp'];
export type EinsatzSchichtmodell = S['EinsatzSchichtmodell'];

/**
 * Kein Backend-Schema: die Werte eines Schichtmodells (`schichtmodell::WerteBody`), beim
 * Anlegen und Ändern in den Stammdaten und als eigene Werte am Einsatz. Nur die Felder des Typs;
 * ein Feld des anderen Typs lehnt der Server mit 422 ab. Vorwarnung und Planungsvorlauf fehlen
 * = Vorgabe (30 bzw. 120 min). Wechselzeiten als `HH:MM`.
 */
export interface SchichtmodellWerteBody {
  bezeichnung: string;
  typ: SchichtmodellTyp;
  rhythmus_minuten?: number;
  wechselzeiten?: string[];
  mindestdauer_minuten?: number;
  vorwarnung_minuten?: number;
  planungsvorlauf_minuten?: number;
}

/** Kein Backend-Schema: `POST /api/schichtmodelle`, `PUT /api/schichtmodelle/{id}` (ganzer Satz). */
export interface SchichtmodellBody extends SchichtmodellWerteBody {
  ist_vorgabe: boolean;
}

/**
 * Kein Backend-Schema: `PUT …/abloesungen/schichtmodell`. Genau eine Angabe: ein Modell der
 * Organisation (Kopie), eigene Werte oder `schichtmodell: null` (entfernen).
 */
export type EinsatzSchichtmodellBody =
  { schichtmodell_id: number } | { schichtmodell: SchichtmodellWerteBody | null };

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
 * `abloeser_ids: []` = Planung aufheben. `abloeser_ids` (LLH-1132, höchstens
 * `ABLOESUNG_ABLOESER_MAX`) ersetzt die Liste der Ablöser; die Einzelangabe
 * `abloesende_einheit_id` ist Bestand und nicht zugleich erlaubt (422).
 */
export interface SchichtAendernBody {
  beginn_at?: string;
  rhythmus_minuten?: number | null;
  abloesende_einheit_id?: number | null;
  abloeser_ids?: number[];
}

/**
 * Kein Backend-Schema: Eingabe-Body von `POST …/abloesungen/{id}/vollzug`. `abloeser_ids`
 * (LLH-1132): je Knoten-Ablöser eine Folgeschicht, eine schon laufende ohne Vorgänger wird
 * übernommen. `abschnitt_uebergeben` verlangt die Freigabe des Moduls Einheiten (sonst 403).
 * `art: 'besatzung'` (LLH-1150) mit `besatzung_ids` (`einsatz_personal.id`, höchstens
 * `ABLOESUNG_BESATZUNG_MAX`, Pflicht) ist der Besatzungswechsel, ohne Ablöser und ohne
 * Abschnittsübergabe (sonst 422); er verlangt ebenfalls die Freigabe des Moduls Einheiten.
 */
export interface VollzugBody {
  vollzogen_at?: string;
  abloesende_einheit_id?: number;
  abloeser_ids?: number[];
  abschnitt_uebergeben?: boolean;
  art?: AbloesungArt;
  besatzung_ids?: number[];
}

// ============================== LFH-639 Betreuung ==============================
export type Erhebung = S['Erhebung'];
export type Raeumungszustand = S['Raeumungszustand'];
export type BetreuungsstelleArt = S['BetreuungsstelleArt'];
export type BetreuungsstelleStatus = S['BetreuungsstelleStatus'];
export type Evakuierungsbezirk = S['EvakuierungsbezirkAnzeige'];
export type Betreuungsstelle = S['BetreuungsstelleAnzeige'];
export type BetreuungUebersicht = S['BetreuungUebersicht'];
/** Lesequelle des Moduls Evakuierung (`GET …/evakuierung`, LLH-1034): die Bezirke. */
export type EvakuierungUebersicht = S['EvakuierungUebersicht'];
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

/** Kein Backend-Schema: Eingabe-Body von `POST …/evakuierung/bezirke` (`BezirkAnlegen`), FE-lokal. */
export interface EvakuierungsbezirkEingabe {
  bezeichnung: string;
  /** Ganzzahlig ≥ 1; fehlt oder kleiner → 400. */
  plan_personen: number;
  plan_erhebung: Erhebung;
  abschnitt_id?: number;
  sammelstelle?: string;
  /** Koordinate der Sammelstelle (LLH-1121): nur als Paar, sonst 422. */
  sammelstelle_lat?: number;
  sammelstelle_lon?: number;
  notiz?: string;
}

/**
 * Kein Backend-Schema: Eingabe-Body von `PATCH …/evakuierung/bezirke/{id}` (`BezirkAendern`).
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
  /** Koordinate der Sammelstelle: als Paar senden; `null`/`null` entfernt die Verortung. */
  sammelstelle_lat?: number | null;
  sammelstelle_lon?: number | null;
  notiz?: string | null;
}

/**
 * Kein Backend-Schema: Eingabe-Body von `POST …/evakuierung/bezirke/{id}/staende` (`StandMelden`).
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
  /** Koordinate des Standorts (LLH-1121): nur als Paar, sonst 422. */
  lat?: number;
  lon?: number;
  notiz?: string;
  /** Wer die Stelle leitet (LLH-1044), höchstens `BETREUUNG_LEITUNG_MAX` Zeichen. */
  leitung?: string;
  /** Wie die Stelle erreichbar ist, höchstens `BETREUUNG_ERREICHBARKEIT_MAX` Zeichen. */
  erreichbarkeit?: string;
}

/**
 * Kein Backend-Schema: Eingabe-Body von `PATCH …/betreuung/stellen/{id}` (`StelleAendern`).
 * DREIWERTIG bei `abschnitt_id`/`kapazitaet_personen`/`standort`/`notiz`/`leitung`/
 * `erreichbarkeit`: Schlüssel fehlt = unverändert · `null` = lösen bzw. „keine Kapazität“ bzw.
 * leeren. `status: 'geschlossen'` bei
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
  leitung?: string | null;
  erreichbarkeit?: string | null;
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
/** Übersicht `GET …/verpflegung`: alle Zeitfenster nach Beginn, dazu die Verpflegungsstellen
 *  (LLH-1040, keine eigene Leseroute). */
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
/** Verpflegungsart eines Zeitfensters (warm, kalt, Getränke), nur Anzeige (LLH-1040). */
export type Verpflegungsart = S['Verpflegungsart'];
/** Verpflegungsstelle (LLH-1040): Feldküche, Ausgabestelle oder Zuführung, Status wie beim BR.
 *  Stornierte kommen nicht vor, aufgelöste schon (die Karte braucht ihre Namen). */
export type Verpflegungsstelle = S['VerpflegungsstelleAnzeige'];
export type VerpflegungsstelleArt = S['VerpflegungsstelleArt'];
export type VerpflegungsstelleStatus = S['VerpflegungsstelleStatus'];
/** Ausgegebene Menge an einer Stelle (`je_stelle` am Zeitfenster), nur das Ist; ohne
 *  `stelle_id` der Eintrag „ohne Stelle“. Der Client rechnet je Stelle nichts nach. */
export type VerpflegungStelleIst = S['StelleIst'];
/** Empfängerliste der Verpflegung (LLH-1055): Projektion in `GET …/verpflegung`, keine eigene
 *  Leseroute und ohne Personenangaben — nie `GET …/einheiten` für die Verpflegung lesen. */
export type VerpflegungEmpfaenger = S['VerpflegungEmpfaenger'];
/** Eine Einheit als Empfänger: Gliederung, Abschnitt, Ist-Stärke (eigene und kumuliert) und
 *  Eintreffen. Aufgelöste stehen nur drin, wenn eine Ausgabe sie nennt. */
export type EmpfaengerEinheit = S['EmpfaengerEinheit'];
/** Ein Einsatzabschnitt als Empfänger (Zuführung an den Abschnitt). */
export type EmpfaengerAbschnitt = S['EmpfaengerAbschnitt'];

/**
 * Kein Backend-Schema: Eingabe-Body von `POST …/verpflegung/stellen` (`StelleAnlegen`).
 * Bezeichnung eindeutig unter den nicht stornierten Stellen (sonst 409); `lat` und `lon` nur
 * als Paar (sonst 422).
 */
export interface VerpflegungsstelleEingabe {
  bezeichnung: string;
  art: VerpflegungsstelleArt;
  standort?: string;
  lat?: number;
  lon?: number;
  abschnitt_id?: number;
}

/**
 * Kein Backend-Schema: Eingabe-Body von `PATCH …/verpflegung/stellen/{sid}` (`StelleAendern`).
 * Schlüssel fehlt = unverändert; `null` leert Standort, Koordinate und Abschnitt.
 */
export interface VerpflegungsstellePatch {
  bezeichnung?: string;
  art?: VerpflegungsstelleArt;
  standort?: string | null;
  lat?: number | null;
  lon?: number | null;
  abschnitt_id?: number | null;
}

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
  /** Fehlt = ohne Angabe (LLH-1040). */
  verpflegungsart?: Verpflegungsart;
  /** Zugeordnete Stellen, höchstens 20; fehlt oder leer = einsatzweit. */
  stelle_ids?: number[];
}

/**
 * Kein Backend-Schema: Eingabe-Body von `PATCH …/verpflegung/zeitfenster/{id}`
 * (`ZeitfensterAendern`). Schlüssel fehlt = unverändert; nur `verpflegungsart` kennt `null`
 * (leeren). `stelle_ids` ersetzt die Zuordnung, `[]` leert sie. Wertgleichheit (bei den Stellen
 * auch in anderer Reihenfolge) schreibt weder ETB-Eintrag noch Ereignis.
 */
export type ZeitfensterPatch = Omit<Partial<ZeitfensterEingabe>, 'verpflegungsart'> & {
  verpflegungsart?: Verpflegungsart | null;
};

/** Eine Mahlzeit des Verpflegungsplans der Organisation (LLH-1058): Uhrzeiten `HH:MM` ohne
 *  Datum, `folgetag` heißt „Ende am nächsten Tag“. */
export type VerpflegungVorlage = S['VerpflegungVorlage'];
/** Antwort auf „Tag aus der Vorlage anlegen“: angelegt in Anfragereihenfolge, übersprungen mit
 *  Bezeichnung (am Tag schon gleichnamig vorhanden). */
export type VerpflegungTagErgebnis = S['VerpflegungTagErgebnis'];

/**
 * Kein Backend-Schema: Eingabe-Body von `POST /api/verpflegung-vorlagen` (`VorlageBody`).
 * Uhrzeiten als `HH:MM` oder `HHMM`; Ende gleich Beginn 422, gleicher aktiver Name 409.
 */
export interface VerpflegungVorlageEingabe {
  bezeichnung: string;
  beginn: string;
  ende: string;
  verpflegungsart?: Verpflegungsart;
}

/**
 * Kein Backend-Schema: Eingabe-Body von `PATCH /api/verpflegung-vorlagen/{vid}`
 * (`PatchVorlage`). Schlüssel fehlt = unverändert; `verpflegungsart: null` leert die Art,
 * `aktiv` schaltet in beide Richtungen (es gibt kein Löschen).
 */
export type VerpflegungVorlagePatch = Partial<
  Omit<VerpflegungVorlageEingabe, 'verpflegungsart'>
> & {
  verpflegungsart?: Verpflegungsart | null;
  aktiv?: boolean;
};

/**
 * Kein Backend-Schema: Eingabe-Body von `POST …/verpflegung/zeitfenster/aus-vorlage`
 * (`TagAusVorlage`). Die Tagesgrenzen und jede Uhrzeit hat der Client in der Anzeigezone auf den
 * Tag gelegt (`anzeige/uhrzeit.ts`); ein Zeitfenster trägt die Felder des Einzelanlegens ohne
 * Stellen. Höchstens `VERPFLEGUNG_AUS_VORLAGE_MAX` Zeitfenster.
 */
export interface TagAusVorlageEingabe {
  tag_von_at: string;
  tag_bis_at: string;
  zeitfenster: Omit<ZeitfensterEingabe, 'stelle_ids'>[];
}

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
  /** Verpflegungsstelle (LLH-1040): fremd, unbekannt oder storniert 422, aufgelöst 409 — außer
   *  `zeitpunkt_at` liegt vor der Auflösung. */
  verpflegungsstelle_id?: number;
  /** Empfänger (LLH-1055), höchstens einer von `einheit_id` und `abschnitt_id` (beide 422).
   *  Unbekannte oder fremde Einheit bzw. Abschnitt 404; aufgelöste Einheit 409 — außer
   *  `zeitpunkt_at` liegt vor der Auflösung. */
  einheit_id?: number;
  abschnitt_id?: number;
  /** Idempotenzschlüssel der Offline-Queue (LFH-688); ein Replay liefert die gespeicherte Ausgabe. */
  client_id?: string;
}

// ============================== LFH-51 Terminierte Erinnerungen ==============================
export type Erinnerung = S['ErinnerungAnzeige'];
/** Zahlen der Erinnerungsseite aus einem eigenen Abruf (LFH-940). */
export type ErinnerungKennzahlen = S['ErinnerungKennzahlen'];

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
export type AuftragKennzahlen = S['AuftragKennzahlen'];

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
  /** Koordinate des Ziels (LLH-1114), nur als Paar und nur neben `ort`. */
  ort_lat?: number;
  ort_lon?: number;
  zeit?: string;
  mittel?: string;
  verbindung?: string;
  sicherheit?: string;
  /** Weg der Einheit (FwDV 100: Einheit – Auftrag – Mittel – Ziel – Weg, LLH-1091). */
  weg?: string;
  prioritaet?: AuftragPrioritaet;
  richtung?: Richtung;
  /** 'YYYY-MM-DD HH:MM' (UTC). */
  frist_at?: string;
  /** Erteilzeitpunkt (UTC); leer = jetzt. */
  erteilt_at?: string;
  empfaenger: NeuerEmpfaenger[];
}

/** Die Felder des Befehlsschemas, die eine Berichtigung einzeln leeren kann. */
export type AuftragSchemafeld =
  'absicht' | 'lage' | 'ort' | 'zeit' | 'mittel' | 'verbindung' | 'sicherheit' | 'weg';

/**
 * Kein Backend-Schema: Teil-Patch der Berichtigung (LLH-1098), FE-lokal. Ein fehlendes Feld bleibt,
 * `null` leert ein optionales Feld; `empfaenger` ersetzt die ganze Liste.
 */
export type AuftragPatch = {
  auftrag_text?: string;
  empfaenger?: NeuerEmpfaenger[];
  prioritaet?: AuftragPrioritaet;
  /** 'YYYY-MM-DD HH:MM' (UTC); `null` entfernt die Frist. */
  frist_at?: string | null;
  /** Koordinate des Ziels (LLH-1114): nur als Paar; `null` entfernt sie, ein leeres Ziel auch. */
  ort_lat?: number | null;
  ort_lon?: number | null;
} & Partial<Record<AuftragSchemafeld, string | null>>;

/** Kein Backend-Schema: Body von `POST …/auftraege/{aid}/aufheben` (LLH-1098), FE-lokal. */
export interface AuftragAufhebenBody {
  grund: string;
}

// --- Meldungen ---
export type MeldungPrioritaet = S['Prioritaet'];
export type MeldungStatus = S['MeldungStatus'];
export type Meldungsart = S['Meldungsart'];
export type MeldungMeldeweg = S['MeldeWeg'];
export type Meldung = S['MeldungAnzeige'];
/** Zahlen der Meldungsseite aus einem eigenen Abruf (LFH-940): „Alarmiert“ quer zur Phase. */
export type MeldungKennzahlen = S['MeldungKennzahlen'];

/** Kein Backend-Schema: Eingabe-Body, FE-lokal. */
export interface NeueMeldung {
  absender: string;
  empfaenger?: string;
  /** Empfängerfunktion aus dem Katalog (ohne Führungshilfspersonal/Fachberater); ihre Nutzer
   * bekommen den Hinweis „Neue Meldung“. */
  empfaenger_funktion?: Fuehrungsfunktion;
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
  /** Verortung, nur bei der Art Lagemeldung (sonst 422); lat und lon nur gemeinsam. */
  lat?: number;
  lon?: number;
}

export type LageMeldung = S['LageMeldungAnzeige'];
/** Die Felder, die LLH-1031 an die Lagemeldung gebracht hat. */
type LageMeldungSeit1031 =
  'meldungsart' | 'prioritaet' | 'meldung_status' | 'richtung' | 'is_von_geraet';
/** Eine Lagemeldung, wie ein eingefrorener Lage-Stand sie trägt: Stände von vor LLH-1031 haben
 *  die Felder ab `meldungsart` nicht, und ihr `id` ist die Kennung des früheren Lageobjekts. */
export type LageMeldungStand = Omit<LageMeldung, LageMeldungSeit1031> &
  Partial<Pick<LageMeldung, LageMeldungSeit1031>>;
export type LageGesehen = S['LageGesehenAnzeige'];
/** Kein Backend-Schema: Eingabe-Body von `POST …/lage/gesehen`, FE-lokal. */
export interface LageGesehenBody {
  meldung_ids: number[];
}
/** Korrektur einer Meldung (`PATCH …/meldungen/{mid}`, LLH-1066): nur die geänderten Felder.
 * Wortlaut, Absender, Meldeweg und Ereigniszeit bleiben, wie die Meldung einging (422). */
export interface MeldungKorrekturPatch {
  meldungsart?: Meldungsart;
  prioritaet?: MeldungPrioritaet;
  richtung?: Richtung;
  /** Von-Bezug als Paar: steht eines, ersetzt es den Bezug; `null` löst ihn. */
  einheit_id?: number | null;
  abschnitt_id?: number | null;
  empfaenger?: string | null;
  /** Empfängerfunktion aus dem Katalog wie beim Erfassen (LLH-1381); `null` leert. */
  empfaenger_funktion?: Fuehrungsfunktion | null;
  /** `true` übernimmt in die Lage, `false` nimmt aus der Lage (nicht bei einer Lagemeldung). */
  lagerelevant?: boolean;
  /** Leer oder `null`: der Wortlaut gilt. */
  lage_text?: string | null;
  /** Nur gemeinsam; beide `null` entfernt die Verortung. */
  lat?: number | null;
  lon?: number | null;
}
/** Letzte Rückmeldung je Einheit bzw. direkt gebundenem Abschnitt. */
export type Rueckmeldungen = S['RueckmeldungenAnzeige'];
export type LetzteRueckmeldung = S['LetzteRueckmeldung'];

// ============================== LFH-87 Nachforderung Kräfte/Mittel ==============================
export type NachforderungPrioritaet = S['Prioritaet'];
export type NachforderungStatus = S['NachforderungStatus'];
export type AdressatKategorie = S['AdressatKategorie'];
export type Nachforderung = S['NachforderungAnzeige'];
/** Übliche Art der Organisation für Schnellwahl und Vorschläge (LLH-1379). */
export type NachforderungArtUeblich = S['NachforderungArtUeblich'];

/** Kein Backend-Schema: Eingabe-Body, FE-lokal. */
export interface NeueNachforderung {
  art: string;
  /** Details/Zweck, optional (LLH-1089). */
  bezeichnung?: string;
  anzahl?: number;
  adressat_kategorie: AdressatKategorie;
  adressat_bezeichnung?: string;
  begruendung?: string;
  prioritaet?: NachforderungPrioritaet;
  /** Ereigniszeit der Anforderung (UTC); leer = jetzt. */
  angefordert_at?: string;
  /** Betreuungsstelle, für die angefordert wird (LLH-1082); fehlt = einsatzweit. */
  betreuungsstelle_id?: number;
  /** Ziel (Meldeort, LLH-1089): höchstens eines von Raum, Abschnitt und Freitext. */
  ziel_br_id?: number;
  ziel_abschnitt_id?: number;
  ziel_text?: string;
  /** Bedarfszeit „benötigt bis“ (UTC); fehlt = sofort. */
  benoetigt_bis?: string;
}

/**
 * Body von `POST …/nachforderungen/{nid}/zusage` (LLH-1097 D4), FE-lokal. Eine Anzahl unter der
 * angeforderten teilt den Rest als eigene Position ab (D1).
 */
export interface NachforderungZusageEingabe {
  /** Zugesagte Menge; fehlt = die angeforderte. */
  anzahl?: number;
  /** „Wer“: Rufnamen oder freie Angaben. */
  rufnamen?: string[];
  /** Voraussichtliches Eintreffen (UTC); fehlt = ohne. */
  eintreffen_erwartet_at?: string;
}

/**
 * Body von `PATCH …/nachforderungen/{nid}` (LLH-1097 D9), FE-lokal: nur Geändertes, `null` leert.
 * Steht ein Zielfeld im Body, ersetzt der Body das ganze Ziel. Wer und Eintreffen nur in zugesagt
 * und unterwegs.
 */
export interface PatchNachforderung {
  anzahl?: number;
  prioritaet?: NachforderungPrioritaet;
  bezeichnung?: string | null;
  ziel_br_id?: number | null;
  ziel_abschnitt_id?: number | null;
  ziel_text?: string | null;
  eintreffen_erwartet_at?: string | null;
  rufnamen?: string[];
}

/**
 * Body von `POST …/einheiten/aus-nachforderung` (LLH-1383 D2), FE-lokal. Je Zeile genau eines:
 * `name` legt eine neue Einheit an, `einheit_id` verknüpft eine schon geführte (D3).
 */
export interface EinheitenAusNachforderungEingabe {
  nachforderung_id: number;
  einheiten: ({ name: string } | { einheit_id: number })[];
  /** Einheitstyp der neuen Einheiten. */
  typ_id?: number;
  /** In den Bereitstellungsraum des Ziels buchen (D5). */
  in_bereitstellungsraum?: boolean;
}

// ============================== Zugangsprotokoll (LFH-1097) ==============================
/** Ereignis der Anmeldespur (`auth_audit`). */
export type AnmeldeEreignis = S['Ereignis'];
/** Zeile der Anmeldespur (`GET /api/zugangsprotokoll/anmeldungen`). */
export type AnmeldeEintrag = S['AnmeldeEintragAnzeige'];
/** Aktion der Admin-Spur (`admin_audit`). */
export type AdminAktion = S['AdminAktion'];
/** Zeile der Admin-Spur (`GET /api/zugangsprotokoll/zugangsaenderungen`). */
export type Zugangsaenderung = S['ZugangsaenderungAnzeige'];
/** Anmeldeweg eines Eintrags der Anmeldespur und einer Sitzung (LFH-1152). */
export type Anmeldeweg = S['Anmeldeweg'];
/** Strukturiertes Detail einer Zugangsänderung: Rollen bzw. beendete Sitzung (LFH-1152). */
export type ZugangsAngaben = S['ZugangsAngaben'];

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
export type MedienkontaktKennzahlen = S['MedienkontaktKennzahlen'];
export type PressemitteilungVorlageKey = S['PressemitteilungVorlage'];
export type PressemitteilungStatus = S['PressemitteilungStatus'];
export type PressemitteilungAbschnitt = S['PressemitteilungAbschnitt'];
export type Pressemitteilung = S['PressemitteilungAnzeige'];
/** LFH-931: Listenzeile ohne Abschnitte. */
export type PressemitteilungKopf = S['PressemitteilungKopf'];
export type InfotelefonAnliegen = S['InfotelefonAnliegen'];
export type InfotelefonStatus = S['InfotelefonStatus'];
export type InfotelefonAnruf = S['InfotelefonAnrufAnzeige'];
export type InfotelefonZaehler = S['InfotelefonZaehler'];
export type InfotelefonAnliegenZaehler = S['InfotelefonAnliegenZaehler'];

// ============================== LFH-893 Taktische Fernmeldeskizze ==============================
// API-Vertrag: openspec/changes/archive/2026-10-05-lfh-893-taktische-fernmeldeskizze/design.md (D14).
export type Fernmeldeskizze = S['Fernmeldeskizze'];
export type SkizzenLage = S['SkizzenLage'];
/** 409 auf `PUT …/stab/fernmeldeskizze/lage/{element}`: Fehlertext und gespeicherter Stand. */
export type SkizzenLageKonflikt = S['SkizzenLageKonflikt'];
export type SkizzenKomponente = S['SkizzenKomponente'];
export type SkizzenVerbindung = S['SkizzenVerbindung'];
export type SkizzenBezug = S['SkizzenBezug'];
export type SkizzenBezugArt = S['SkizzenBezugArt'];
export type SkizzenBereich = S['SkizzenBereich'];
/** 409 auf `PATCH …/stab/fernmeldeskizze/bereiche/{bid}`: Fehlertext und gespeicherter Stand. */
export type SkizzenBereichKonflikt = S['SkizzenBereichKonflikt'];
export type Schriftfeld = S['Schriftfeld'];
export type Komponentenart = S['Komponentenart'];
export type Verbindungsart = S['Verbindungsart'];
export type Verbindungsmedium = S['Verbindungsmedium'];
export type Verbindungsstatus = S['Verbindungsstatus'];
export type Verkehrsart = S['Verkehrsart'];
export type VsVermerk = S['VsVermerk'];
/** Kanal einer externen Stelle des Kommunikationsplans (`KommunikationsStelle.sprechgruppen`). */
export type StellenKanal = S['StellenKanal'];
