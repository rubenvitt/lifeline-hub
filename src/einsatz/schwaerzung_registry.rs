//! Zentrale Klassifikations-Registry für die irreversible PII-Schwärzung (LFH-229).
//!
//! 1. Sie taggt JEDE Spalte JEDER einsatz-scoped Tabelle mit einer [`Klassifikation`]
//!    (`Scrub{Strategie}` oder `Retain{Grund}`).
//! 2. Ein Guard-Test (`tests`) entdeckt die einsatz-scoped Tabellenmenge S dynamisch
//!    (`einsatz_id` + transitive `ON DELETE CASCADE`-Hülle ab `einsatz`) und wird ROT, sobald
//!    eine Spalte oder Tabelle unklassifiziert ist — eine neue PII-Spalte kann nicht still
//!    durchrutschen.
//!
//!    Das setzt voraus, dass jede FK-Kante nach S aus S kommt oder begründet auf
//!    `FREMDKANTEN_ALLOWLIST` steht (GUARD 5, LFH-291). Sonst fiele eine Tabelle ohne
//!    `einsatz_id`, die per `SET NULL` oder ohne ON-DELETE auf S zeigt, aus der Hülle, und ihre
//!    PII überlebte die Schwärzung.
//! 3. [`scrubbe_aus_registry`] treibt den Scrub data-driven aus denselben Konstanten, die der
//!    Guard prüft — kein Drift möglich.
//!
//! Tabellen-/Spaltennamen sind ausschließlich compile-time-Konstanten (nie User-Input), daher
//! ist `sqlx::AssertSqlSafe` hier injektionssicher; Werte werden gebunden.

use super::repo::SCHWAERZUNG_PLATZHALTER;
use super::retention::Datenkategorie;

/// Wie eine als PII eingestufte Spalte gescrubbt wird.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Strategie {
    /// `col = NULL` (nullable Spalte).
    NullSetzen,
    /// `col = SCHWAERZUNG_PLATZHALTER` (NOT-NULL-Textspalte, NULL unmöglich).
    Platzhalter,
    /// `col = CASE WHEN col IS NULL THEN NULL ELSE SCHWAERZUNG_PLATZHALTER END` — nullable, aber
    /// ein CHECK verlangt einen Wert, sobald ein Statusfeld gesetzt ist (z. B.
    /// `einsatz_schaden.uebergeben_an` bei `status='uebergeben'`).
    PlatzhalterWennGesetzt,
    /// `col = SCHWAERZUNG_PLATZHALTER || ' ' || id` — NOT-NULL-Textspalte unter einem
    /// UNIQUE-Index (z. B. `evakuierungsbezirk.bezeichnung`). Ein gleicher Platzhalter verletzte
    /// den
    /// Index ab der zweiten Zeile und bräche die ganze Schwärzung ab. Die Zeilen-ID ist Struktur.
    PlatzhalterMitId,
    /// `col = '[]'` — NOT-NULL-Spalte mit einem JSON-Array, das beim Laden deserialisiert wird
    /// (`abschnitte` der Vorlagendokumente, LFH-701). Ein Text-Platzhalter wäre kein gültiges
    /// JSON; das leere Array heißt „keine Abschnitte“.
    LeeresJsonArray,
    /// Die ganze Zeile wird gelöscht. Für Tabellen, deren Nutzlast selbst PII ist und die kein
    /// Skelett tragen (`anhang`: Foto-BLOBs Betroffener); CASCADE räumt abhängige Zeilen mit.
    ZeileLoeschen,
}

/// Welcher Frist eine Scrub-Spalte folgt (LFH-749, Spec `aufbewahrung-kategorien`, design.md
/// D1/D2). Jede Scrub-Spalte trägt genau eine Zuordnung — im Typ, damit eine neue Spalte ohne
/// Zuordnung nicht kompiliert. Gepinnt in `tests::kategorie_zuordnung_ist_gepinnt`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Zuordnung {
    /// Eigene Kategorie-Frist: wird mit der Kategorie geschwärzt.
    Kategorie(Datenkategorie),
    /// Personenstamm: wird erst geschwärzt, wenn alle Zwecke der Person geschwärzt sind
    /// (design.md D3); die Tabelle nennt dafür ihren [`TabellenRegel::person_bezug`].
    Personenstamm,
    /// Folgt der Frist des Einsatzes: nur die Einsatz-Schwärzung nimmt sie mit.
    Einsatz,
}

const Z_EINSATZ: Zuordnung = Zuordnung::Einsatz;
const Z_STAMM: Zuordnung = Zuordnung::Personenstamm;
const Z_BEHANDLUNG: Zuordnung = Zuordnung::Kategorie(Datenkategorie::Behandlung);
const Z_AUSKUNFT: Zuordnung = Zuordnung::Kategorie(Datenkategorie::Personenauskunft);
const Z_ANHAENGE: Zuordnung = Zuordnung::Kategorie(Datenkategorie::Anhaenge);

/// Klassifikation einer einzelnen Spalte.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Klassifikation {
    /// PII → wird bei der Schwärzung nach [`Strategie`] entfernt, zu der Frist, die die
    /// [`Zuordnung`] nennt.
    Scrub(Strategie, Zuordnung),
    /// Bleibt erhalten. Der `&'static str` begründet, warum (Struktur, Führungs-Doku,
    /// anonymisiertes Statistik-Skelett …).
    Retain(&'static str),
}

/// Wie eine Tabelle auf den zu schwärzenden Einsatz eingegrenzt wird (WHERE-Klausel).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Scoping {
    /// Die `einsatz`-Tabelle selbst (`WHERE id = ?`).
    SelbstId,
    /// Direkte `einsatz_id`-Spalte (`WHERE einsatz_id = ?`).
    EinsatzId,
    /// Über einen Parent-FK, der selbst `einsatz_id` trägt
    /// (`WHERE {fk} IN (SELECT id FROM {parent} WHERE einsatz_id = ?)`).
    UeberParent {
        fk: &'static str,
        parent: &'static str,
    },
}

/// Klassifikationsregel für eine einzelne Spalte.
#[derive(Debug, Clone, Copy)]
pub struct SpaltenRegel {
    pub spalte: &'static str,
    pub klassifikation: Klassifikation,
}

const fn scrub(spalte: &'static str, strategie: Strategie, zuordnung: Zuordnung) -> SpaltenRegel {
    SpaltenRegel {
        spalte,
        klassifikation: Klassifikation::Scrub(strategie, zuordnung),
    }
}

const fn retain(spalte: &'static str, grund: &'static str) -> SpaltenRegel {
    SpaltenRegel {
        spalte,
        klassifikation: Klassifikation::Retain(grund),
    }
}

/// Klassifikationsregel für eine einsatz-scoped Tabelle.
#[derive(Debug, Clone, Copy)]
pub struct TabellenRegel {
    pub tabelle: &'static str,
    pub scoping: Scoping,
    /// Optionaler zusätzlicher Zeilenfilter (SQL-Fragment ohne `WHERE`/`AND`, z. B.
    /// `"personal_id IS NULL"`). Compile-time-Konstante → injektionssicher.
    pub zeilenfilter: Option<&'static str>,
    /// Spalte, über die eine Zeile ihre Person (`einsatz_person.id`) erreicht. Pflicht, sobald
    /// die Tabelle eine [`Zuordnung::Personenstamm`]-Spalte trägt (design.md D3).
    pub person_bezug: Option<&'static str>,
    pub spalten: &'static [SpaltenRegel],
}

// --- Wiederverwendete RETAIN-Begründungen (Struktur-Skelett) ---
const G_PK: &str = "Primärschlüssel (Struktur, kein Personenbezug)";
const G_FK: &str =
    "Struktur-/Benutzer-FK (INTEGER-Referenz; System-Nutzer, kein Betroffenen-Freitext)";
const G_SCOPE: &str = "Einsatz-Scope-FK (Struktur)";
const G_ZEIT: &str = "Zeitstempel (Struktur/Audit, kein Personenbezug)";
const G_ENUM: &str = "Enum/Katalog-Wert (CHECK-validiert, kein Personenbezug)";
const G_GEO: &str = "Operatives Geo-/Positions-/Layout-Skelett (kein direkter Personenbezug)";
const G_ZAEHLER: &str = "Laufende Nummer/Zähler/Menge (anonymes Statistik-Skelett)";
const G_IDEMPOTENZ: &str =
    "Client-Idempotenzschlüssel (technische UUID zur Offline-Dedup, kein Personenbezug)";
const G_KONFIG: &str = "Einsatz-Konfiguration (kein Personenbezug)";
const G_POLY: &str =
    "Polymorpher Bezug (objekt_typ/objekt_id o. Ä.; Struktur, Ziel wird eigenständig gescrubbt)";
// Operatives Struktur-Label (Einheit, Abschnitt, Raum, Funkgruppe): benennt ein Objekt, keine
// Person.
const G_OP_LABEL: &str =
    "Operatives Struktur-Label (Objekt-/Einheiten-/Abschnitts-/Funkgruppen-Bezeichnung, kein Personenbezug)";
const G_OP_SNAP: &str =
    "Disponier-Snapshot von Betriebsmittel-Stammdaten (Fahrzeug/Material/Einheit der eigenen Org, kein Betroffenen-Bezug)";
// Die Freitexte der Führungsmodule (Meldung, Auftrag, Nachforderung, Lagebericht, Befehl,
// Pressemitteilung, Lagebesprechung) werden gescrubbt: Die Führungsdokumentation ist allein
// der ETB-Wortlaut (G_ETB), die Module sind Arbeitsstand (LFH-701, Linie A).
const G_PRESSE_LOG: &str =
    "Presse-Log ist selbst der Nachweis der Pressearbeit (kein ETB-Eintrag, LFH-554 D9); \
     Medium, Thema, Antwort und Freigabeangabe ohne Ansprechperson";
const G_ETB: &str =
    "ETB — rechtsverbindliche Führungs-/Einsatzdokumentation, gesetzliches Aufbewahrungs-Skelett";
const G_TRIAGE: &str =
    "Triage-/Verbleib-Statuskategorie (Art. 9): nach Nullen aller Direkt-Identifikatoren \
     bleibt pro Zeile nur registrier_nr + Kategorie + Zeitstempel → anonymisiertes Statistik-Skelett";
const G_TIER: &str =
    "Reine Tierbeschreibung (kein Personenbezug; Halter-Direktdaten werden gescrubbt)";
const G_ABGLEICH: &str =
    "Vermisst-/Gefunden-Abgleich-Verknüpfung (Struktur; die verknüpften Personen-Zeilen \
     werden selbst gescrubbt)";
const G_AUDIT: &str =
    "Zugriffs-Audit (Nachweis-Struktur; benutzer=System-Nutzer, kein Betroffenen-Freitext)";
const G_ANTRAG: &str =
    "Aktenzeichen des Löschersuchens (Art. 17): Nachweis der Erfüllung, kein Personenwert \
     (der Dialog verlangt ein Zeichen ohne Namen, LFH-751 design.md D10)";
// REVIEW: operativer Freitext-Zettel, konservativ gescrubbt — Begründung im Scrub-Kommentar.

/// Die vollständige Registry aller einsatz-scoped Tabellen (Menge S). Reihenfolge =
/// Ausführungsreihenfolge des Scrubs (Korrektheit ist reihenfolgeunabhängig).
pub const TABELLEN: &[TabellenRegel] = &[
    // ---------- Einsatz-Kopf (dieselbe Zeile, die den Tombstone trägt) ----------
    TabellenRegel {
        tabelle: "einsatz",
        scoping: Scoping::SelbstId,
        zeilenfilter: None,
        person_bezug: None,
        spalten: &[
            retain("id", G_PK),
            retain("org_id", G_FK),
            retain(
                "bezeichnung",
                "Einsatz-Bezeichnung (operatives Label, z. B. „Hochwasser Musterstadt“)",
            ),
            retain(
                "stichwort",
                "Einsatz-Stichwort (operatives Schlagwort, kein Personenbezug)",
            ),
            retain("status", G_ENUM),
            retain("begonnen_at", G_ZEIT),
            retain("naechste_lagebesprechung_at", G_ZEIT),
            retain("abgeschlossen_at", G_ZEIT),
            retain("abgeschlossen_von", G_FK),
            retain("einsatzart", G_ENUM),
            retain("einsatznummer_intern", G_ZAEHLER),
            retain("nummer_jahr", G_ZAEHLER),
            retain("nummer_lfd", G_ZAEHLER),
            retain("angelegt_at", G_ZEIT),
            retain(
                "leitstellen_nr",
                "Leitstellen-Einsatznummer (operativer Verweis, kein Personenbezug)",
            ),
            // Meldebild, Adresse/GPS und meldende Stelle sind Betroffenen-/Melder-PII. GPS
            // mit-nullen,
            // sonst verriete der Fix die Adresse.
            scrub("einsatzort", Strategie::NullSetzen, Z_EINSATZ),
            scrub("einsatzort_lat", Strategie::NullSetzen, Z_EINSATZ),
            scrub("einsatzort_lon", Strategie::NullSetzen, Z_EINSATZ),
            scrub("meldende_stelle", Strategie::NullSetzen, Z_EINSATZ),
            scrub("sachverhalt", Strategie::NullSetzen, Z_EINSATZ),
            retain("anzahl_betroffene_initial", G_ZAEHLER),
            retain("retention_bis", G_ZEIT),
            retain("geloescht_at", G_ZEIT),
            retain("geschwaerzt_at", G_ZEIT),
        ],
    },
    // ---------- Personen (Betroffene) + Historie/Triage ----------
    TabellenRegel {
        tabelle: "einsatz_person",
        scoping: Scoping::EinsatzId,
        zeilenfilter: None,
        person_bezug: Some("id"),
        spalten: &[
            retain("id", G_PK),
            retain("einsatz_id", G_SCOPE),
            retain("client_id", G_IDEMPOTENZ),
            retain("registrier_nr", G_ZAEHLER),
            retain("status", G_TRIAGE),
            scrub("name", Strategie::NullSetzen, Z_STAMM),
            scrub("vorname", Strategie::NullSetzen, Z_STAMM),
            scrub("geschlecht", Strategie::NullSetzen, Z_STAMM),
            scrub("geburtsdatum", Strategie::NullSetzen, Z_STAMM),
            scrub("alter_geschaetzt", Strategie::NullSetzen, Z_STAMM),
            scrub("herkunft_adresse", Strategie::NullSetzen, Z_AUSKUNFT),
            scrub("antreff_ort", Strategie::NullSetzen, Z_STAMM),
            scrub("melder_kontakt", Strategie::NullSetzen, Z_AUSKUNFT),
            scrub("notiz", Strategie::NullSetzen, Z_STAMM),
            retain("erfasst_at", G_ZEIT),
            retain("erfasst_von", G_FK),
            retain("geaendert_at", G_ZEIT),
            retain("geaendert_von", G_FK),
            retain("storniert_at", G_ZEIT),
            retain("aktuelle_sichtung", G_TRIAGE),
            retain("aktuelle_sichtung_at", G_ZEIT),
            // Denormalisierter Cache: trägt bei Transporten „Transport → {Klinik}“ im Klartext.
            scrub("aktueller_verbleib", Strategie::NullSetzen, Z_STAMM),
            retain("aktuelle_uhs_id", G_FK),
            retain("aktueller_platz_id", G_FK),
            // Zustand ist ein Gesundheitsdatum, die Fundort-Koordinate ein Aufenthaltsort. Das
            // Verbleib-Ziel spiegelt `person_verbleib.ziel` und wird wie dort gescrubbt.
            scrub("zustand", Strategie::NullSetzen, Z_BEHANDLUNG),
            scrub("antreff_lat", Strategie::NullSetzen, Z_STAMM),
            scrub("antreff_lon", Strategie::NullSetzen, Z_STAMM),
            retain("vermisst_seit", G_ZEIT),
            // Art/Status spiegeln die CHECK-Enums von person_verbleib (dort ebenfalls retain).
            retain("aktuelle_verbleib_art", G_TRIAGE),
            scrub("aktuelles_verbleib_ziel", Strategie::NullSetzen, Z_STAMM),
            retain("aktueller_verbleib_status", G_TRIAGE),
            // Kennung der Betreuungsstelle, kein Personenbezug (der Name hängt an der Stelle).
            retain("aktuelle_verbleib_betreuungsstelle_id", G_FK),
        ],
    },
    TabellenRegel {
        tabelle: "person_sichtung",
        scoping: Scoping::EinsatzId,
        zeilenfilter: None,
        person_bezug: None,
        spalten: &[
            retain("id", G_PK),
            retain("einsatz_id", G_SCOPE),
            retain("person_id", G_FK),
            retain("kategorie", G_TRIAGE),
            scrub("notiz", Strategie::NullSetzen, Z_BEHANDLUNG),
            retain("gesichtet_at", G_ZEIT),
            retain("gesichtet_von", G_FK),
        ],
    },
    TabellenRegel {
        tabelle: "person_verlaufsnotiz",
        scoping: Scoping::EinsatzId,
        zeilenfilter: None,
        person_bezug: None,
        spalten: &[
            retain("id", G_PK),
            retain("einsatz_id", G_SCOPE),
            retain("person_id", G_FK),
            // text ist NOT NULL → Platzhalter statt NULL.
            scrub("text", Strategie::Platzhalter, Z_BEHANDLUNG),
            retain("erfasst_at", G_ZEIT),
            retain("erfasst_von", G_FK),
        ],
    },
    TabellenRegel {
        tabelle: "person_verbleib",
        scoping: Scoping::EinsatzId,
        zeilenfilter: None,
        person_bezug: Some("person_id"),
        spalten: &[
            retain("id", G_PK),
            retain("einsatz_id", G_SCOPE),
            retain("person_id", G_FK),
            retain("art", G_TRIAGE),
            // Freitext wie ziel/notiz → gescrubbt; G_TRIAGE gilt nur für die CHECK-Enums
            // art/status.
            scrub("transportmittel", Strategie::NullSetzen, Z_STAMM),
            // Klartext-Verbringungsort (Klinikname/Adresse) → PII.
            scrub("ziel", Strategie::NullSetzen, Z_STAMM),
            retain("status", G_TRIAGE),
            scrub("notiz", Strategie::NullSetzen, Z_STAMM),
            retain("zeitpunkt_at", G_ZEIT),
            retain("erfasst_von", G_FK),
            // Kennung der Betreuungsstelle eines Notunterkunft-Verbleibs.
            retain("betreuungsstelle_id", G_FK),
        ],
    },
    TabellenRegel {
        tabelle: "person_uhs_belegung",
        scoping: Scoping::EinsatzId,
        zeilenfilter: None,
        person_bezug: None,
        spalten: &[
            retain("id", G_PK),
            retain("einsatz_id", G_SCOPE),
            retain("person_id", G_FK),
            retain("uhs_id", G_FK),
            retain("platz_id", G_FK),
            retain("art", G_TRIAGE),
            scrub("notiz", Strategie::NullSetzen, Z_BEHANDLUNG),
            retain("zeitpunkt_at", G_ZEIT),
            retain("erfasst_von", G_FK),
        ],
    },
    TabellenRegel {
        tabelle: "person_abgleich",
        scoping: Scoping::EinsatzId,
        zeilenfilter: None,
        person_bezug: None,
        spalten: &[
            retain("id", G_PK),
            retain("einsatz_id", G_SCOPE),
            retain("vermisst_person_id", G_ABGLEICH),
            retain("gefunden_person_id", G_ABGLEICH),
            retain("status", G_ENUM),
            retain("erstellt_at", G_ZEIT),
            retain("erstellt_von", G_FK),
            retain("entschieden_at", G_ZEIT),
            retain("entschieden_von", G_FK),
        ],
    },
    TabellenRegel {
        tabelle: "person_zugriff_audit",
        scoping: Scoping::EinsatzId,
        zeilenfilter: None,
        person_bezug: None,
        spalten: &[
            retain("id", G_PK),
            retain("einsatz_id", G_SCOPE),
            retain("person_id", G_FK),
            retain("benutzer_id", G_FK),
            retain("art", G_AUDIT),
            retain("zugriff_at", G_ZEIT),
        ],
    },
    TabellenRegel {
        // LFH-758: Lese-Audit je Abruf einer UHS-Datei — bleibt wie `person_zugriff_audit`
        // (Nachweis, wer wann eine Datei mit möglichem Patientenbezug abgerufen hat). `anhang_id`
        // zeigt nach der Schwärzung ins Leere (bewusst ohne FK, 0138); `ablage` nennt nur die
        // UHS-Bezeichnung, die selbst bleibt (G_OP_LABEL). Kein Dateiname in der Tabelle.
        // Gepinnt in
        // `einsatz::repo::tests::schwaerzung_loescht_uhs_anhaenge_und_haelt_etb_und_audit`.
        tabelle: "anhang_zugriff_audit",
        scoping: Scoping::EinsatzId,
        zeilenfilter: None,
        person_bezug: None,
        spalten: &[
            retain("id", G_PK),
            retain("einsatz_id", G_SCOPE),
            retain("anhang_id", G_FK),
            retain("ablage", G_OP_LABEL),
            retain("benutzer_id", G_FK),
            retain("fassung", G_AUDIT),
            retain("zugriff_at", G_ZEIT),
        ],
    },
    // ---------- Tiere ----------
    TabellenRegel {
        tabelle: "einsatz_tier",
        scoping: Scoping::EinsatzId,
        zeilenfilter: None,
        person_bezug: None,
        spalten: &[
            retain("id", G_PK),
            retain("einsatz_id", G_SCOPE),
            retain("registrier_nr", G_ZAEHLER),
            retain("status", G_ENUM),
            retain("spezies", G_ENUM),
            retain("rasse_beschreibung", G_TIER),
            retain("rufname", G_TIER),
            retain("geschlecht", G_TIER),
            retain("alter_geschaetzt", G_TIER),
            retain("farbe_beschreibung", G_TIER),
            // Chip-/Tätowierungsnummer ist im Haustierregister auf den Halter registriert →
            // personenverknüpfend.
            scrub("kennzeichnung", Strategie::NullSetzen, Z_EINSATZ),
            retain("groesse_gewicht", G_TIER),
            retain("halter_person_id", G_FK),
            scrub("halter_kontakt", Strategie::NullSetzen, Z_EINSATZ),
            scrub("antreff_ort", Strategie::NullSetzen, Z_EINSATZ),
            scrub("notiz", Strategie::NullSetzen, Z_EINSATZ),
            retain("abschluss_grund", G_ENUM),
            scrub("abschluss_ziel", Strategie::NullSetzen, Z_EINSATZ),
            retain("erfasst_at", G_ZEIT),
            retain("erfasst_von", G_FK),
            retain("geaendert_at", G_ZEIT),
            retain("geaendert_von", G_FK),
            retain("storniert_at", G_ZEIT),
        ],
    },
    // ---------- Schäden ----------
    TabellenRegel {
        tabelle: "einsatz_schaden",
        scoping: Scoping::EinsatzId,
        zeilenfilter: None,
        person_bezug: None,
        spalten: &[
            retain("id", G_PK),
            retain("einsatz_id", G_SCOPE),
            retain("registrier_nr", G_ZAEHLER),
            retain("status", G_ENUM),
            retain("typ", G_ENUM),
            retain("ausmass", G_ENUM),
            // Schadensort ist faktisch die Adresse Betroffener → gescrubbt; NOT NULL → Platzhalter.
            scrub("ort", Strategie::Platzhalter, Z_EINSATZ),
            // Unstrukturierter Freitext, kann dieselbe PII tragen wie `ort` → gescrubbt.
            scrub("beschreibung", Strategie::Platzhalter, Z_EINSATZ),
            retain("geschaedigt_person_id", G_FK),
            scrub("geschaedigt_kontakt", Strategie::NullSetzen, Z_EINSATZ),
            retain("geschaedigt_personal_id", G_FK),
            retain("geschaedigt_organisation_id", G_FK),
            // CHECK status='uebergeben' ⇒ NOT NULL → Platzhalter nur, wenn gesetzt.
            scrub("uebergeben_an", Strategie::PlatzhalterWennGesetzt, Z_EINSATZ),
            retain("uebergeben_at", G_ZEIT),
            retain("abschluss_grund", G_ENUM),
            retain("abschluss_at", G_ZEIT),
            retain("erfasst_at", G_ZEIT),
            retain("erfasst_von", G_FK),
            retain("geaendert_at", G_ZEIT),
            retain("geaendert_von", G_FK),
            retain("storniert_at", G_ZEIT),
            retain("storniert_von", G_FK),
            retain("lat", G_GEO),
            retain("lon", G_GEO),
        ],
    },
    // ---------- Personal-Dispositionen (nur Ad-hoc-extern = personal_id IS NULL) ----------
    TabellenRegel {
        tabelle: "einsatz_personal",
        scoping: Scoping::EinsatzId,
        // Nur Ad-hoc-externe sind einsatz-scoped PII; Dispositionen von Stamm-Kräften sind
        // Stammdaten.
        zeilenfilter: Some("personal_id IS NULL"),
        person_bezug: None,
        spalten: &[
            retain("id", G_PK),
            retain("einsatz_id", G_SCOPE),
            retain("personal_id", G_FK),
            retain("status_id", G_FK),
            retain("staerke_position", G_ENUM),
            // snap_name ist NOT NULL → Platzhalter.
            scrub("snap_name", Strategie::Platzhalter, Z_EINSATZ),
            scrub("snap_funktion", Strategie::NullSetzen, Z_EINSATZ),
            scrub("snap_traegerorganisation", Strategie::NullSetzen, Z_EINSATZ),
            scrub("bemerkung", Strategie::NullSetzen, Z_EINSATZ),
            retain("disponiert_at", G_ZEIT),
            retain("disponiert_von", G_FK),
            retain("einheit_id", G_FK),
            retain("lat", G_GEO),
            retain("lon", G_GEO),
            retain("tz_fachaufgabe", G_ENUM),
            retain("tz_organisation", G_ENUM),
            retain("fahrzeug_id", G_FK),
        ],
    },
    // ---------- Karte / freie Zeichen / Anhänge ----------
    TabellenRegel {
        tabelle: "karte_hintergrundbild",
        scoping: Scoping::EinsatzId,
        zeilenfilter: None,
        person_bezug: None,
        spalten: &[
            retain("id", G_PK),
            retain("einsatz_id", G_SCOPE),
            // Der Dateiname kann PII tragen („Lageplan Familie Müller.png“) → Platzhalter (NOT
            // NULL).
            scrub("name", Strategie::Platzhalter, Z_EINSATZ),
            // BLOB bleibt: georeferenziertes Kartografie-Skelett, kein Foto Betroffener (≠ anhang).
            retain(
                "daten",
                "Kartografie-Skelett (georeferenzierter Bild-Hintergrund, kein Personenbezug)",
            ),
            retain("mime", G_ENUM),
            retain("groesse", G_ZAEHLER),
            retain(
                "sha256",
                "SHA-256-Integritätshash des Kartografie-BLOBs (kein Personenbezug)",
            ),
            retain("ecken_json", G_GEO),
            retain("opazitaet", G_KONFIG),
            retain("sichtbar", G_KONFIG),
            retain("reihenfolge", G_KONFIG),
            retain("hochgeladen_von", G_FK),
            retain("erstellt_at", G_ZEIT),
            retain("geaendert_at", G_ZEIT),
            // FK auf karten_ansicht, kein Personenbezug.
            retain("ansicht_id", G_FK),
        ],
    },
    TabellenRegel {
        // Kartenansicht: einsatzweit geteilte Layout-/Konfig-Daten; einziger Freitext ist der Name.
        tabelle: "karten_ansicht",
        scoping: Scoping::EinsatzId,
        zeilenfilter: None,
        person_bezug: None,
        spalten: &[
            retain("id", G_PK),
            retain("einsatz_id", G_SCOPE),
            // Meist thematisch („Verkehr“), kann aber PII tragen → Platzhalter (NOT NULL).
            scrub("name", Strategie::Platzhalter, Z_EINSATZ),
            retain("reihenfolge", G_KONFIG),
            retain("ist_standard", G_KONFIG),
            retain("basemap_modus", G_ENUM),
            retain("online_stil", G_KONFIG),
            retain("karten_theme", G_ENUM),
            retain("layer_sichtbar", G_KONFIG),
            retain("fachebenen_sichtbar", G_KONFIG),
            retain("zentrum_lat", G_GEO),
            retain("zentrum_lon", G_GEO),
            retain("zoom", G_KONFIG),
            retain("erstellt_von", G_FK),
            retain("erstellt_at", G_ZEIT),
            retain("geaendert_at", G_ZEIT),
            retain("geaendert_von", G_FK),
        ],
    },
    TabellenRegel {
        tabelle: "freies_zeichen",
        scoping: Scoping::EinsatzId,
        zeilenfilter: None,
        person_bezug: None,
        spalten: &[
            retain("id", G_PK),
            retain("einsatz_id", G_SCOPE),
            retain("lat", G_GEO),
            retain("lon", G_GEO),
            retain("grundzeichen", G_ENUM),
            retain("organisation", G_ENUM),
            retain("fachaufgabe", G_ENUM),
            retain("symbol", G_ENUM),
            retain("einheit", G_ENUM),
            retain("funktion", G_ENUM),
            retain("farbe", G_ENUM),
            // Freitext-Label (kann PII tragen, „ELW Fam. Müller“) → NULL (nullable).
            scrub("label", Strategie::NullSetzen, Z_EINSATZ),
            retain("erstellt_von", G_FK),
            retain("erstellt_at", G_ZEIT),
            retain("geaendert_at", G_ZEIT),
            // FK auf karten_ansicht, kein Personenbezug.
            retain("ansicht_id", G_FK),
        ],
    },
    TabellenRegel {
        // Ganze Zeile löschen: `daten` sind Fotos/Dateien Betroffener, kein Kartografie-Skelett.
        // CASCADE räumt die Linker chat_nachricht_anhang, einsatz_dokument, etb_eintrag_anhang,
        // einsatz_schaden_anhang, einsatz_tier_anhang und uhs_anhang (LFH-758) mit.
        tabelle: "anhang",
        scoping: Scoping::EinsatzId,
        zeilenfilter: None,
        person_bezug: None,
        spalten: &[
            scrub("id", Strategie::ZeileLoeschen, Z_ANHAENGE),
            scrub("einsatz_id", Strategie::ZeileLoeschen, Z_ANHAENGE),
            scrub("dateiname", Strategie::ZeileLoeschen, Z_ANHAENGE),
            scrub("mime", Strategie::ZeileLoeschen, Z_ANHAENGE),
            scrub("groesse", Strategie::ZeileLoeschen, Z_ANHAENGE),
            scrub("sha256", Strategie::ZeileLoeschen, Z_ANHAENGE),
            scrub("daten", Strategie::ZeileLoeschen, Z_ANHAENGE),
            scrub("hochgeladen_von", Strategie::ZeileLoeschen, Z_ANHAENGE),
            scrub("erstellt_at", Strategie::ZeileLoeschen, Z_ANHAENGE),
        ],
    },
    TabellenRegel {
        // Ganze Zeile löschen wie `anhang`: der Titel ist Freitext, und die Datei ist ohnehin weg
        // (CASCADE; `anhang` steht deshalb VOR dieser Regel). Seit LFH-752 nennen die
        // System-ETB-Einträge den Titel nicht mehr, nur die Kategorie und den Ablage-Eintrag
        // („Dokument abgelegt (Foto)“, „Dokument entfernt: Ablage ETB 12 (Foto)“). Ältere
        // Einträge mit Titel bleiben, ETB-Freitext ist Führungsdokumentation (G_ETB). Gepinnt in
        // `einsatz::repo::tests::schwaerzung_loescht_dokument_samt_anhang_und_haelt_den_etb_nachweis`.
        tabelle: "einsatz_dokument",
        scoping: Scoping::EinsatzId,
        zeilenfilter: None,
        person_bezug: None,
        spalten: &[
            scrub("id", Strategie::ZeileLoeschen, Z_ANHAENGE),
            scrub("einsatz_id", Strategie::ZeileLoeschen, Z_ANHAENGE),
            scrub("anhang_id", Strategie::ZeileLoeschen, Z_ANHAENGE),
            scrub("kategorie", Strategie::ZeileLoeschen, Z_ANHAENGE),
            scrub("titel", Strategie::ZeileLoeschen, Z_ANHAENGE),
            scrub("bezug_abschnitt_id", Strategie::ZeileLoeschen, Z_ANHAENGE),
            scrub("bezug_einheit_id", Strategie::ZeileLoeschen, Z_ANHAENGE),
            scrub("bezug_etb_eintrag_id", Strategie::ZeileLoeschen, Z_ANHAENGE),
            scrub("etb_eintrag_id", Strategie::ZeileLoeschen, Z_ANHAENGE),
            scrub("abgelegt_von_id", Strategie::ZeileLoeschen, Z_ANHAENGE),
            scrub("abgelegt_at", Strategie::ZeileLoeschen, Z_ANHAENGE),
            scrub("geloescht_at", Strategie::ZeileLoeschen, Z_ANHAENGE),
            scrub("geloescht_von_id", Strategie::ZeileLoeschen, Z_ANHAENGE),
        ],
    },
    TabellenRegel {
        // Ganze Zeile löschen wie `anhang`: die Datei ist weg (CASCADE; `anhang` steht VOR dieser
        // Regel), und ein Linker ohne Datei trägt nichts. Die System-ETB-Einträge nennen nur
        // Registriernummer und Art, nie den Dateinamen. Gepinnt in
        // `einsatz::repo::tests::schwaerzung_loescht_schaden_anhaenge_und_haelt_den_etb_nachweis`.
        tabelle: "einsatz_schaden_anhang",
        scoping: Scoping::EinsatzId,
        zeilenfilter: None,
        person_bezug: None,
        spalten: &[
            scrub("id", Strategie::ZeileLoeschen, Z_ANHAENGE),
            scrub("einsatz_id", Strategie::ZeileLoeschen, Z_ANHAENGE),
            scrub("schaden_id", Strategie::ZeileLoeschen, Z_ANHAENGE),
            scrub("anhang_id", Strategie::ZeileLoeschen, Z_ANHAENGE),
            scrub("abgelegt_von_id", Strategie::ZeileLoeschen, Z_ANHAENGE),
            scrub("abgelegt_at", Strategie::ZeileLoeschen, Z_ANHAENGE),
            scrub("geloescht_at", Strategie::ZeileLoeschen, Z_ANHAENGE),
            scrub("geloescht_von_id", Strategie::ZeileLoeschen, Z_ANHAENGE),
        ],
    },
    TabellenRegel {
        // LFH-758, wie `einsatz_schaden_anhang`: ganze Zeile löschen, die Datei ist weg (CASCADE;
        // `anhang` steht VOR dieser Regel). Die System-ETB-Einträge nennen nur „Tier T-007“ und
        // die Art, nie Dateiname, Kennzeichnung oder Halter. Gepinnt in
        // `einsatz::repo::tests::schwaerzung_loescht_tier_anhaenge_und_haelt_den_etb_nachweis`.
        tabelle: "einsatz_tier_anhang",
        scoping: Scoping::EinsatzId,
        zeilenfilter: None,
        person_bezug: None,
        spalten: &[
            scrub("id", Strategie::ZeileLoeschen, Z_ANHAENGE),
            scrub("einsatz_id", Strategie::ZeileLoeschen, Z_ANHAENGE),
            scrub("tier_id", Strategie::ZeileLoeschen, Z_ANHAENGE),
            scrub("anhang_id", Strategie::ZeileLoeschen, Z_ANHAENGE),
            scrub("abgelegt_von_id", Strategie::ZeileLoeschen, Z_ANHAENGE),
            scrub("abgelegt_at", Strategie::ZeileLoeschen, Z_ANHAENGE),
            scrub("geloescht_at", Strategie::ZeileLoeschen, Z_ANHAENGE),
            scrub("geloescht_von_id", Strategie::ZeileLoeschen, Z_ANHAENGE),
        ],
    },
    TabellenRegel {
        // LFH-758, wie `einsatz_schaden_anhang`: ganze Zeile löschen, die Datei ist weg (CASCADE;
        // `anhang` steht VOR dieser Regel). Die System-ETB-Einträge nennen nur „UHS {bezeichnung}“
        // (die Bezeichnung bleibt ohnehin, G_OP_LABEL) und die Art, nie den Dateinamen. Das
        // Lese-Audit `anhang_zugriff_audit` bleibt stehen. Gepinnt in
        // `einsatz::repo::tests::schwaerzung_loescht_uhs_anhaenge_und_haelt_etb_und_audit`.
        tabelle: "uhs_anhang",
        scoping: Scoping::EinsatzId,
        zeilenfilter: None,
        person_bezug: None,
        spalten: &[
            scrub("id", Strategie::ZeileLoeschen, Z_ANHAENGE),
            scrub("einsatz_id", Strategie::ZeileLoeschen, Z_ANHAENGE),
            scrub("uhs_id", Strategie::ZeileLoeschen, Z_ANHAENGE),
            scrub("anhang_id", Strategie::ZeileLoeschen, Z_ANHAENGE),
            scrub("abgelegt_von_id", Strategie::ZeileLoeschen, Z_ANHAENGE),
            scrub("abgelegt_at", Strategie::ZeileLoeschen, Z_ANHAENGE),
            scrub("geloescht_at", Strategie::ZeileLoeschen, Z_ANHAENGE),
            scrub("geloescht_von_id", Strategie::ZeileLoeschen, Z_ANHAENGE),
        ],
    },
    TabellenRegel {
        // Ganze Zeile löschen: `daten` ist das eingefrorene Lagebild inkl. PII. Anders als
        // lagebericht/befehl gibt es keine ETB-Kopplung, die einen Retain begründete; bezeichnung
        // und
        // notiz gehen mit.
        tabelle: "lage_snapshot",
        scoping: Scoping::EinsatzId,
        zeilenfilter: None,
        person_bezug: None,
        spalten: &[
            scrub("id", Strategie::ZeileLoeschen, Z_EINSATZ),
            scrub("einsatz_id", Strategie::ZeileLoeschen, Z_EINSATZ),
            scrub("bezeichnung", Strategie::ZeileLoeschen, Z_EINSATZ),
            scrub("notiz", Strategie::ZeileLoeschen, Z_EINSATZ),
            scrub("stand_at", Strategie::ZeileLoeschen, Z_EINSATZ),
            scrub("schema_version", Strategie::ZeileLoeschen, Z_EINSATZ),
            scrub("daten", Strategie::ZeileLoeschen, Z_EINSATZ),
            scrub("erstellt_von", Strategie::ZeileLoeschen, Z_EINSATZ),
            scrub("erstellt_at", Strategie::ZeileLoeschen, Z_EINSATZ),
        ],
    },
    // ---------- Lage / Gefahren (Freitext-Labels der „ELW Fam. Müller“-Klasse) ----------
    TabellenRegel {
        tabelle: "lage_zone",
        scoping: Scoping::EinsatzId,
        zeilenfilter: None,
        person_bezug: None,
        spalten: &[
            retain("id", G_PK),
            retain("einsatz_id", G_SCOPE),
            retain("typ", G_ENUM),
            retain("geometrie_typ", G_ENUM),
            retain("geometrie", G_GEO),
            // Das Label überlebt im System-ETB-Wortlaut („Gefahrengebiet «…» eingerichtet“) —
            // ETB-Politik
            // G_ETB. Gepinnt in
            // `tests/gefahr.rs::schwaerzung_nullt_zonen_und_gebietslabel_und_haelt_den_etb_wortlaut`.
            scrub("label", Strategie::NullSetzen, Z_EINSATZ),
            retain("farbe", G_ENUM),
            scrub("notiz", Strategie::NullSetzen, Z_EINSATZ),
            retain("erstellt_von", G_FK),
            retain("erstellt_at", G_ZEIT),
            retain("geaendert_at", G_ZEIT),
            retain("gefahrengebiet_id", G_FK),
            // FK auf karten_ansicht, kein Personenbezug.
            retain("ansicht_id", G_FK),
            // Verweis auf den Evakuierungsbezirk; dessen Bezeichnung schwärzt der Block
            // `evakuierungsbezirk`.
            retain("evakuierungsbezirk_id", G_FK),
        ],
    },
    TabellenRegel {
        tabelle: "gefahrengebiet",
        scoping: Scoping::EinsatzId,
        zeilenfilter: None,
        person_bezug: None,
        spalten: &[
            retain("id", G_PK),
            retain("einsatz_id", G_SCOPE),
            // Wie `lage_zone.label`: das Gebietslabel bleibt im System-ETB des Warnstufenwechsels
            // (G_ETB), gepinnt im selben Test.
            scrub("label", Strategie::NullSetzen, Z_EINSATZ),
            retain("erstellt_von", G_FK),
            retain("erstellt_at", G_ZEIT),
            retain("geaendert_at", G_ZEIT),
        ],
    },
    TabellenRegel {
        // Kein einsatz_id — scoped über den CASCADE-Parent gefahrengebiet.
        tabelle: "gefahr_bewertung",
        scoping: Scoping::UeberParent {
            fk: "gefahrengebiet_id",
            parent: "gefahrengebiet",
        },
        zeilenfilter: None,
        person_bezug: None,
        spalten: &[
            retain("id", G_PK),
            retain("gefahrengebiet_id", G_FK),
            retain("gefahrentyp", G_ENUM),
            retain("schutzobjekt", G_ENUM),
            retain("warnstufe", G_ENUM),
            // Unstrukturierter Freitext, kann Betroffenen-PII tragen → gescrubbt.
            scrub("beschreibung", Strategie::NullSetzen, Z_EINSATZ),
            // `gemeldet_von` ist Klartext-Name des Melders (nicht der Benutzer-FK) → NULL.
            scrub("gemeldet_von", Strategie::NullSetzen, Z_EINSATZ),
            retain("aktualisiert_von", G_FK),
            retain("erstellt_at", G_ZEIT),
            retain("geaendert_at", G_ZEIT),
        ],
    },
    TabellenRegel {
        tabelle: "lage_meldung",
        scoping: Scoping::EinsatzId,
        zeilenfilter: None,
        person_bezug: None,
        spalten: &[
            retain("id", G_PK),
            retain("einsatz_id", G_SCOPE),
            retain("meldung_id", G_FK),
            // text ist NOT NULL → Platzhalter.
            scrub("text", Strategie::Platzhalter, Z_EINSATZ),
            retain("lat", G_GEO),
            retain("lon", G_GEO),
            retain("erstellt_von_id", G_FK),
            retain("erstellt_at", G_ZEIT),
        ],
    },
    // ---------- Operative Struktur: Abschnitte / Einheiten / Räume / UHS / Funk ----------
    // Bezeichnungen operativer Objekte sind Skelett (RETAIN). Nullable Freitext-Zettel
    // (notiz/bemerkung/hinweis/standort/erreichbarkeit/abschnittsauftrag) können Betroffenen-PII
    // enthalten → konservativ NULL + REVIEW-Tag. `kommunikationsmittel` ist kein Freitext
    // (RETAIN).
    TabellenRegel {
        tabelle: "einsatzabschnitt",
        scoping: Scoping::EinsatzId,
        zeilenfilter: None,
        person_bezug: None,
        spalten: &[
            retain("id", G_PK),
            retain("einsatz_id", G_SCOPE),
            retain("ueber_abschnitt_id", G_FK),
            retain("name", G_OP_LABEL),
            retain("leiter_id", G_FK),
            scrub("bemerkung", Strategie::NullSetzen, Z_EINSATZ), // REVIEW: operativer Freitext-Zettel
            retain("sortier", G_KONFIG),
            retain("angelegt_at", G_ZEIT),
            retain("flaeche_geojson", G_GEO),
            retain("tz_fachaufgabe", G_ENUM),
            retain("tz_organisation", G_ENUM),
            // Eingefrorene Alt-Spalten ohne Schreibweg: Funkgruppen-Label wie
            // `sprechgruppe.bezeichnung` (ebenfalls G_OP_LABEL). Gepinnt in
            // `repo::tests::schwaerzung_nullt_alle_abschnitts_freitexte_und_haelt_die_labels`.
            retain("sprechgruppe_tmo", G_OP_LABEL),
            retain("sprechgruppe_dmo", G_OP_LABEL),
            // Kommunikationsart-Schlüssel (digitalfunk/mobil/festnetz), kein Personenbezug. Die
            // Wertemenge erzwingt `routes::support::pruefe_kommunikationsmittel` (unbekannt → 400).
            retain(
                "kommunikationsmittel",
                "Kommunikationsart-Schlüssel (digitalfunk/mobil/…), kein Personenbezug (LFH-108)",
            ),
            // Mögliche Rufnummer der Führung → PII.
            scrub("erreichbarkeit", Strategie::NullSetzen, Z_EINSATZ),
            // Kürzel, Beurteilung und Einschätzung sind Führungsskelett (RETAIN). Der
            // Abschnittsauftrag
            // ist nullabler Freitext und wird, anders als `auftrag.auftrag_text`, nicht ins ETB
            // gesnapshottet.
            retain("kurzbezeichnung", G_OP_LABEL),
            retain("lagezustand", G_ENUM),
            scrub("abschnittsauftrag", Strategie::NullSetzen, Z_EINSATZ), // REVIEW: operativer Freitext
            retain("fortschritt", G_ZAEHLER),
            // Rhythmus-Vorgabe der Ablösung in Minuten.
            retain("abloesung_rhythmus_minuten", G_KONFIG),
        ],
    },
    TabellenRegel {
        tabelle: "einsatz_einheit",
        scoping: Scoping::EinsatzId,
        zeilenfilter: None,
        person_bezug: None,
        spalten: &[
            retain("id", G_PK),
            retain("einsatz_id", G_SCOPE),
            retain("abschnitt_id", G_FK),
            retain("ueber_einheit_id", G_FK),
            retain("typ_id", G_FK),
            retain("name", G_OP_LABEL),
            retain("fuehrer_id", G_FK),
            retain("soll_fuehrer", G_ZAEHLER),
            retain("soll_unterfuehrer", G_ZAEHLER),
            retain("soll_mannschaft", G_ZAEHLER),
            scrub("bemerkung", Strategie::NullSetzen, Z_EINSATZ), // REVIEW: operativer Freitext-Zettel
            // Funk-Felder: kommunikationsmittel ist Kategorie-Schlüssel (RETAIN), erreichbarkeit
            // eine
            // mögliche Rufnummer (Scrub).
            retain(
                "kommunikationsmittel",
                "Kommunikationsart-Schlüssel (digitalfunk/mobil/…), kein Personenbezug (LFH-108)",
            ),
            scrub("erreichbarkeit", Strategie::NullSetzen, Z_EINSATZ),
            // Der Rufname benennt ein operatives Objekt, keine Person (wie fahrzeug.funkrufname).
            retain("funkrufname", G_OP_LABEL),
            retain("sortier", G_KONFIG),
            retain("angelegt_at", G_ZEIT),
            retain("angelegt_von", G_FK),
            retain("lat", G_GEO),
            retain("lon", G_GEO),
            retain("tz_fachaufgabe", G_ENUM),
            retain("tz_organisation", G_ENUM),
            retain("aktueller_br_id", G_FK),
            retain("status_id", G_FK),
            retain("status_seit", G_ZEIT),
        ],
    },
    TabellenRegel {
        tabelle: "einsatz_fahrzeug",
        scoping: Scoping::EinsatzId,
        zeilenfilter: None,
        person_bezug: None,
        spalten: &[
            retain("id", G_PK),
            retain("einsatz_id", G_SCOPE),
            retain("fahrzeug_id", G_FK),
            retain("status_id", G_FK),
            retain("status_seit", G_ZEIT),
            retain("snap_funkrufname", G_OP_SNAP),
            retain("snap_kennzeichen", G_OP_SNAP),
            retain("snap_fahrzeugtyp", G_OP_SNAP),
            retain("snap_opta", G_OP_SNAP),
            retain("snap_traegerorganisation", G_OP_SNAP),
            scrub("bemerkung", Strategie::NullSetzen, Z_EINSATZ), // REVIEW: operativer Freitext-Zettel
            retain("disponiert_at", G_ZEIT),
            retain("disponiert_von", G_FK),
            retain("einheit_id", G_FK),
            retain("lat", G_GEO),
            retain("lon", G_GEO),
            retain("tz_fachaufgabe", G_ENUM),
            retain("tz_organisation", G_ENUM),
            retain("aktueller_br_id", G_FK),
        ],
    },
    TabellenRegel {
        tabelle: "einsatz_material",
        scoping: Scoping::EinsatzId,
        zeilenfilter: None,
        person_bezug: None,
        spalten: &[
            retain("id", G_PK),
            retain("einsatz_id", G_SCOPE),
            retain("material_id", G_FK),
            retain("einheit_id", G_FK),
            retain("menge", G_ZAEHLER),
            retain("status", G_ENUM),
            retain("snap_bezeichnung", G_OP_SNAP),
            retain("snap_kategorie", G_OP_SNAP),
            retain("snap_bestandsnummer", G_OP_SNAP),
            retain("snap_traegerorganisation", G_OP_SNAP),
            scrub("bemerkung", Strategie::NullSetzen, Z_EINSATZ), // REVIEW: operativer Freitext-Zettel
            retain("disponiert_at", G_ZEIT),
            retain("disponiert_von", G_FK),
            retain("uhs_id", G_FK),
        ],
    },
    TabellenRegel {
        tabelle: "einsatz_mitgliedschaft",
        scoping: Scoping::EinsatzId,
        zeilenfilter: None,
        person_bezug: None,
        spalten: &[
            retain("einsatz_id", G_SCOPE),
            retain("benutzer_id", G_FK),
            retain("einsatz_rolle", G_ENUM),
            scrub("fuehrungsstelle", Strategie::NullSetzen, Z_EINSATZ),
            // Katalogcode (LFH-549) — kein Personenbezug; die Bezeichnung steht in
            // `fuehrungsstelle` und wird oben genullt.
            retain("fuehrungsfunktion", G_ENUM),
            retain("zugewiesen_at", G_ZEIT),
        ],
    },
    // Besetzung der Sachgebiete S1–S6. `snap_name`/`bezeichnung` sind PII und werden genullt (wie
    // `einsatz_mitgliedschaft.fuehrungsstelle`); das Skelett (welches Sachgebiet wie, von wem und
    // wann besetzt) bleibt als anonymer Führungsnachweis.
    TabellenRegel {
        tabelle: "einsatz_stabsfunktion",
        scoping: Scoping::EinsatzId,
        zeilenfilter: None,
        person_bezug: None,
        spalten: &[
            retain("id", G_PK),
            retain("einsatz_id", G_SCOPE),
            retain("sachgebiet", G_ENUM),
            retain("besetzung_art", G_ENUM),
            retain("personal_id", G_FK),
            scrub("snap_name", Strategie::NullSetzen, Z_EINSATZ), // REVIEW: Name der disponierten Person
            scrub("bezeichnung", Strategie::NullSetzen, Z_EINSATZ), // REVIEW: Name/Stelle extern bzw. rückwärtig
            retain("gesetzt_von_id", G_FK),
            retain("gesetzt_at", G_ZEIT),
        ],
    },
    // Ablösungsschichten: kein Freitext, Namen kommen per Join aus `einsatz_einheit`/
    // `einsatzabschnitt`. Alles Struktur, Zeit oder Enum → RETAIN.
    TabellenRegel {
        tabelle: "einsatz_abloesung",
        scoping: Scoping::EinsatzId,
        zeilenfilter: None,
        person_bezug: None,
        spalten: &[
            retain("id", G_PK),
            retain("einsatz_id", G_SCOPE),
            retain("einheit_id", G_FK),
            retain("abschnitt_id", G_FK),
            retain("beginn_at", G_ZEIT),
            retain("rhythmus_minuten", G_KONFIG),
            retain("rhythmus_quelle", G_ENUM),
            retain("faellig_at", G_ZEIT),
            retain("abloesende_einheit_id", G_FK),
            retain("status", G_ENUM),
            retain("vollzogen_at", G_ZEIT),
            retain("vollzogen_von_id", G_FK),
            retain("vorgaenger_id", G_FK),
            retain("etb_vollzug_id", G_FK),
            retain("angelegt_von_id", G_FK),
            retain("angelegt_at", G_ZEIT),
        ],
    },
    // Kräfte-Zeitachse (LFH-552): Ereignisse je Einheit/Person. Art, Quelle, Zeitpunkte und
    // FKs sind Skelett — die Person steckt in `einsatz_personal` und wird dort geschwärzt.
    // Freitext (Notiz, Streichgrund) → weg. `streichgrund` hängt per CHECK an `gestrichen_at`,
    // deshalb Platzhalter, wenn gesetzt, statt NULL.
    TabellenRegel {
        tabelle: "einsatz_kraft_zeitachse",
        scoping: Scoping::EinsatzId,
        zeilenfilter: None,
        person_bezug: None,
        spalten: &[
            retain("id", G_PK),
            retain("einsatz_id", G_SCOPE),
            retain("einheit_id", G_FK),
            retain("personal_id", G_FK),
            retain("art", G_ENUM),
            retain("zeitpunkt_at", G_ZEIT),
            retain("quelle", G_ENUM),
            retain("ursprung_id", G_FK),
            scrub("notiz", Strategie::NullSetzen, Z_EINSATZ),
            retain("erfasst_von", G_FK),
            retain("erfasst_at", G_ZEIT),
            retain("gestrichen_at", G_ZEIT),
            retain("gestrichen_von", G_FK),
            scrub("streichgrund", Strategie::PlatzhalterWennGesetzt, Z_EINSATZ),
        ],
    },
    // Betreuung: Mengen, keine Personen — Anzahlen, Kapazitäten, Zustände und Zeitpunkte bleiben
    // als Statistik-Skelett. Die Bezeichnung trägt oft eine Adresse und wird deshalb, anders als
    // `uhs.bezeichnung`, ersetzt. Sammelstelle, Standort und Notiz → NULL. Die ETB-Texte nennen
    // nur Bezeichnung und Zahlen.
    TabellenRegel {
        tabelle: "evakuierungsbezirk",
        scoping: Scoping::EinsatzId,
        zeilenfilter: None,
        person_bezug: None,
        spalten: &[
            retain("id", G_PK),
            retain("einsatz_id", G_SCOPE),
            retain("abschnitt_id", G_FK),
            // NOT NULL unter partiellem UNIQUE-Index → je Zeile eigener Platzhalter.
            scrub("bezeichnung", Strategie::PlatzhalterMitId, Z_EINSATZ),
            retain("plan_personen", G_ZAEHLER),
            retain("plan_erhebung", G_ENUM),
            retain("raeumung", G_ENUM),
            scrub("sammelstelle", Strategie::NullSetzen, Z_EINSATZ),
            scrub("notiz", Strategie::NullSetzen, Z_EINSATZ),
            retain("stand_id", G_FK),
            retain("storniert_at", G_ZEIT),
            retain("storniert_von_id", G_FK),
            retain("angelegt_at", G_ZEIT),
            retain("angelegt_von_id", G_FK),
            retain("geaendert_at", G_ZEIT),
        ],
    },
    TabellenRegel {
        tabelle: "evakuierung_stand",
        scoping: Scoping::EinsatzId,
        zeilenfilter: None,
        person_bezug: None,
        spalten: &[
            retain("id", G_PK),
            retain("bezirk_id", G_FK),
            retain("einsatz_id", G_SCOPE),
            // Technische UUID der Offline-Queue, kein Personenbezug.
            retain("client_id", G_IDEMPOTENZ),
            retain("evakuiert", G_ZAEHLER),
            retain("erhebung", G_ENUM),
            retain("zeitpunkt_at", G_ZEIT),
            retain("erfasst_at", G_ZEIT),
            retain("erfasst_von_id", G_FK),
            retain("etb_eintrag_id", G_FK),
            retain("zurueckgenommen_at", G_ZEIT),
            retain("zurueckgenommen_von_id", G_FK),
        ],
    },
    TabellenRegel {
        tabelle: "betreuungsstelle",
        scoping: Scoping::EinsatzId,
        zeilenfilter: None,
        person_bezug: None,
        spalten: &[
            retain("id", G_PK),
            retain("einsatz_id", G_SCOPE),
            retain("abschnitt_id", G_FK),
            // NOT NULL unter partiellem UNIQUE-Index → je Zeile eigener Platzhalter.
            scrub("bezeichnung", Strategie::PlatzhalterMitId, Z_EINSATZ),
            retain("art", G_ENUM),
            retain("kapazitaet_personen", G_ZAEHLER),
            retain("status", G_ENUM),
            scrub("standort", Strategie::NullSetzen, Z_EINSATZ),
            scrub("notiz", Strategie::NullSetzen, Z_EINSATZ),
            // Koordinate auf der Lagekarte — Geo-Skelett wie `uhs.lat/lon`.
            retain("lat", G_GEO),
            retain("lon", G_GEO),
            retain("belegung_id", G_FK),
            retain("storniert_at", G_ZEIT),
            retain("storniert_von_id", G_FK),
            retain("angelegt_at", G_ZEIT),
            retain("angelegt_von_id", G_FK),
            retain("geaendert_at", G_ZEIT),
        ],
    },
    TabellenRegel {
        tabelle: "betreuungsstelle_belegung",
        scoping: Scoping::EinsatzId,
        zeilenfilter: None,
        person_bezug: None,
        spalten: &[
            retain("id", G_PK),
            retain("stelle_id", G_FK),
            retain("einsatz_id", G_SCOPE),
            // Technische UUID der Offline-Queue, kein Personenbezug.
            retain("client_id", G_IDEMPOTENZ),
            retain("belegt", G_ZAEHLER),
            retain("zeitpunkt_at", G_ZEIT),
            retain("erfasst_at", G_ZEIT),
            retain("erfasst_von_id", G_FK),
            retain("etb_eintrag_id", G_FK),
            retain("zurueckgenommen_at", G_ZEIT),
            retain("zurueckgenommen_von_id", G_FK),
        ],
    },
    // Verpflegung: Mengen, keine Personen — Bedarfe, Sonderkost-Anzahlen und Zeitpunkte bleiben.
    // Die Zeitfenster-Bezeichnung ist ein Mahlzeitname und bleibt; Ort und Bemerkung einer Ausgabe
    // können Adresse oder Name tragen → NULL. Die ETB-Texte nennen beides nicht.
    TabellenRegel {
        tabelle: "verpflegung_zeitfenster",
        scoping: Scoping::EinsatzId,
        zeilenfilter: None,
        person_bezug: None,
        spalten: &[
            retain("id", G_PK),
            retain("einsatz_id", G_SCOPE),
            retain("bezeichnung", G_OP_LABEL),
            retain("von_at", G_ZEIT),
            retain("bis_at", G_ZEIT),
            retain("bedarf_kraefte", G_ZAEHLER),
            retain("bedarf_betreute", G_ZAEHLER),
            retain("bedarf_weitere", G_ZAEHLER),
            retain("sk_vegetarisch", G_ZAEHLER),
            retain("sk_vegan", G_ZAEHLER),
            retain("sk_ohne_schwein", G_ZAEHLER),
            retain("sk_diaet_allergenarm", G_ZAEHLER),
            retain("sk_saeugling_kleinkind", G_ZAEHLER),
            retain("angelegt_von_id", G_FK),
            retain("angelegt_at", G_ZEIT),
            retain("geaendert_at", G_ZEIT),
        ],
    },
    TabellenRegel {
        tabelle: "verpflegung_ausgabe",
        scoping: Scoping::EinsatzId,
        zeilenfilter: None,
        person_bezug: None,
        spalten: &[
            retain("id", G_PK),
            retain("einsatz_id", G_SCOPE),
            retain("zeitfenster_id", G_FK),
            retain("zeitpunkt_at", G_ZEIT),
            retain("menge", G_ZAEHLER),
            scrub("ort", Strategie::NullSetzen, Z_EINSATZ),
            scrub("bemerkung", Strategie::NullSetzen, Z_EINSATZ),
            retain("sk_vegetarisch", G_ZAEHLER),
            retain("sk_vegan", G_ZAEHLER),
            retain("sk_ohne_schwein", G_ZAEHLER),
            retain("sk_diaet_allergenarm", G_ZAEHLER),
            retain("sk_saeugling_kleinkind", G_ZAEHLER),
            retain("nachforderung_id", G_FK),
            retain("zurueckgenommen_at", G_ZEIT),
            retain("zurueckgenommen_von_id", G_FK),
            retain("erfasst_von_id", G_FK),
            retain("erfasst_at", G_ZEIT),
            retain("client_id", G_IDEMPOTENZ),
        ],
    },
    // Abgeschlossene Lagebesprechungen. `entschluss` wird gescrubbt wie
    // `lagebericht.abschnitte` und `befehl`, die denselben Entschluss tragen — eine Linie für
    // alle drei (LFH-701, Linie A). Der Wortlaut bleibt im ETB-Eintrag der Besprechung.
    TabellenRegel {
        tabelle: "einsatz_lagebesprechung",
        scoping: Scoping::EinsatzId,
        zeilenfilter: None,
        person_bezug: None,
        spalten: &[
            retain("id", G_PK),
            retain("einsatz_id", G_SCOPE),
            retain("lfd_nr", G_ZAEHLER),
            retain("abgehalten_at", G_ZEIT),
            scrub("entschluss", Strategie::Platzhalter, Z_EINSATZ), // NOT NULL
            retain("naechste_at", G_ZEIT),
            retain("etb_eintrag_id", G_FK),
            retain("erfasst_von_id", G_FK),
            retain("erfasst_at", G_ZEIT),
        ],
    },
    // Checkliste Arbeitsaufnahme (LFH-551): ein Arbeitsmittel, kein Führungsnachweis. Die
    // `bemerkung` ist Freitext und kann Namen tragen („Einweisung durch BI Müller“) → genullt;
    // Punkt, Haken und Zeitpunkte bleiben als Skelett. Der eine Nachweis steht im ETB.
    TabellenRegel {
        tabelle: "einsatz_stab_checkliste",
        scoping: Scoping::EinsatzId,
        zeilenfilter: None,
        person_bezug: None,
        spalten: &[
            retain("id", G_PK),
            retain("einsatz_id", G_SCOPE),
            retain("punkt", G_ENUM),
            retain("erledigt", G_ENUM),
            retain("erledigt_at", G_ZEIT),
            retain("erledigt_von_id", G_FK),
            scrub("bemerkung", Strategie::NullSetzen, Z_EINSATZ), // REVIEW: Freitext am Punkt
            retain("geaendert_von_id", G_FK),
            retain("geaendert_at", G_ZEIT),
        ],
    },
    // Maßgebliche Pegel: Stationsname und Gewässer benennen eine WSV-Messstelle, keine Person.
    TabellenRegel {
        tabelle: "einsatz_pegel",
        scoping: Scoping::EinsatzId,
        zeilenfilter: None,
        person_bezug: None,
        spalten: &[
            retain("id", G_PK),
            retain("einsatz_id", G_SCOPE),
            retain("station_uuid", G_OP_LABEL),
            retain("name", G_OP_LABEL),
            retain("gewaesser", G_OP_LABEL),
            retain("reihenfolge", G_ZAEHLER),
            retain("gesetzt_von_id", G_FK),
            retain("gesetzt_at", G_ZEIT),
            // Erwarteter Höchststand: Messwert mit Zeitpunkt, kein Personenbezug.
            retain("prognose_cm", G_ZAEHLER),
            retain("prognose_zeit", G_ZEIT),
            retain("prognose_gesetzt_von_id", G_FK),
            retain("prognose_gesetzt_at", G_ZEIT),
        ],
    },
    TabellenRegel {
        tabelle: "einsatz_einstellungen",
        scoping: Scoping::EinsatzId,
        zeilenfilter: None,
        person_bezug: None,
        spalten: &[
            retain("einsatz_id", G_SCOPE),
            retain("standard_modul", G_KONFIG),
            retain("basemap_modus", G_KONFIG),
            retain("karten_zoom_start", G_KONFIG),
            retain("fachebenen_sichtbar", G_KONFIG),
            retain("geaendert_at", G_ZEIT),
            retain("geaendert_von", G_FK),
            retain("zeitzone", G_KONFIG),
            retain("zeitformat", G_KONFIG),
            retain("einheiten", G_KONFIG),
            retain("koordinatenformat", G_KONFIG),
            retain("etb_nummer_praefix", G_KONFIG),
            retain("etb_nummer_start", G_KONFIG),
            retain("meldung_nummer_praefix", G_KONFIG),
            retain("meldung_nummer_start", G_KONFIG),
            retain("auftrag_nummer_praefix", G_KONFIG),
            retain("auftrag_nummer_start", G_KONFIG),
            retain("meldung_bestaetigung_frist_min", G_KONFIG),
            retain("auftrag_quittierung_frist_min", G_KONFIG),
            retain("rueckmeldung_frist_min", G_KONFIG),
            retain("auto_etb_eintraege", G_KONFIG),
            retain("retention_dauer_tage", G_KONFIG),
        ],
    },
    TabellenRegel {
        tabelle: "einsatz_modul_override",
        scoping: Scoping::EinsatzId,
        zeilenfilter: None,
        person_bezug: None,
        spalten: &[
            retain("einsatz_id", G_SCOPE),
            retain("modul_key", G_ENUM),
            retain("sichtbar", G_KONFIG),
            retain("benoetigte_rolle", G_ENUM),
            retain("geaendert_at", G_ZEIT),
            retain("geaendert_von", G_FK),
        ],
    },
    // Kategorie-Fristen (LFH-749): Aufbewahrungsstruktur, die die Schwärzung überleben muss,
    // damit Archivakte und Zustand sie zeigen.
    TabellenRegel {
        tabelle: "einsatz_aufbewahrung_kategorie",
        scoping: Scoping::EinsatzId,
        zeilenfilter: None,
        person_bezug: None,
        spalten: &[
            retain("einsatz_id", G_SCOPE),
            retain("kategorie", G_ENUM),
            retain("frist_bis", G_ZEIT),
            retain(
                "rechtsgrundlage",
                "Rechtsgrundlage der Frist (Org-Text zur Rechenschaft, kein Personenbezug)",
            ),
            retain("vorgemerkt_at", G_ZEIT),
            retain("geschwaerzt_at", G_ZEIT),
        ],
    },
    TabellenRegel {
        tabelle: "bereitstellungsraum",
        scoping: Scoping::EinsatzId,
        zeilenfilter: None,
        person_bezug: None,
        spalten: &[
            retain("id", G_PK),
            retain("einsatz_id", G_SCOPE),
            retain("abschnitt_id", G_FK),
            retain("bezeichnung", G_OP_LABEL),
            scrub("standort", Strategie::NullSetzen, Z_EINSATZ), // REVIEW: Freitext-Standort (Adresse möglich)
            scrub("notiz", Strategie::NullSetzen, Z_EINSATZ),    // REVIEW: operativer Freitext-Zettel
            retain("status", G_ENUM),
            retain("erfasst_at", G_ZEIT),
            retain("erfasst_von", G_FK),
            retain("geaendert_at", G_ZEIT),
            retain("geaendert_von", G_FK),
            retain("storniert_at", G_ZEIT),
        ],
    },
    TabellenRegel {
        tabelle: "br_belegung",
        scoping: Scoping::EinsatzId,
        zeilenfilter: None,
        person_bezug: None,
        spalten: &[
            retain("id", G_PK),
            retain("einsatz_id", G_SCOPE),
            retain("br_id", G_FK),
            retain("objekt_typ", G_POLY),
            retain("objekt_id", G_POLY),
            retain("art", G_ENUM),
            scrub("notiz", Strategie::NullSetzen, Z_EINSATZ), // REVIEW: operativer Freitext-Zettel
            retain("zeitpunkt_at", G_ZEIT),
            retain("erfasst_von", G_FK),
        ],
    },
    TabellenRegel {
        tabelle: "uhs",
        scoping: Scoping::EinsatzId,
        zeilenfilter: None,
        person_bezug: None,
        spalten: &[
            retain("id", G_PK),
            retain("einsatz_id", G_SCOPE),
            retain("abschnitt_id", G_FK),
            retain("typ", G_ENUM),
            retain("bezeichnung", G_OP_LABEL),
            scrub("standort", Strategie::NullSetzen, Z_EINSATZ), // REVIEW: „Adresse/Hinweis“-Freitext
            scrub("notiz", Strategie::NullSetzen, Z_EINSATZ),    // REVIEW: operativer Freitext-Zettel
            retain("status", G_ENUM),
            retain("erfasst_at", G_ZEIT),
            retain("erfasst_von", G_FK),
            retain("geaendert_at", G_ZEIT),
            retain("geaendert_von", G_FK),
            retain("storniert_at", G_ZEIT),
            retain("lat", G_GEO),
            retain("lon", G_GEO),
        ],
    },
    TabellenRegel {
        // Kein einsatz_id — scoped über den CASCADE-Parent uhs. Kein Scrub (reines Skelett).
        tabelle: "uhs_platz",
        scoping: Scoping::UeberParent {
            fk: "uhs_id",
            parent: "uhs",
        },
        zeilenfilter: None,
        person_bezug: None,
        spalten: &[
            retain("id", G_PK),
            retain("uhs_id", G_FK),
            retain("typ", G_ENUM),
            retain("bezeichnung", G_OP_LABEL),
            retain("pos_x", G_GEO),
            retain("pos_y", G_GEO),
            retain("verfuegbarkeit", G_ENUM),
            retain("reserviert_fuer_person_id", G_FK),
            retain("storniert_at", G_ZEIT),
        ],
    },
    TabellenRegel {
        tabelle: "sprechgruppe",
        scoping: Scoping::EinsatzId,
        zeilenfilter: None,
        person_bezug: None,
        spalten: &[
            retain("id", G_PK),
            retain("org_id", G_FK),
            retain("einsatz_id", G_SCOPE),
            retain("bezeichnung", G_OP_LABEL),
            retain("betriebsart", G_ENUM),
            scrub("hinweis", Strategie::NullSetzen, Z_EINSATZ), // REVIEW: operativer Freitext-Zettel
            retain("aktiv", G_KONFIG),
            retain("sortier", G_KONFIG),
            retain("angelegt_at", G_ZEIT),
        ],
    },
    TabellenRegel {
        tabelle: "einsatz_einheit_sprechgruppe",
        scoping: Scoping::UeberParent {
            fk: "einheit_id",
            parent: "einsatz_einheit",
        },
        zeilenfilter: None,
        person_bezug: None,
        spalten: &[retain("einheit_id", G_FK), retain("sprechgruppe_id", G_FK)],
    },
    TabellenRegel {
        tabelle: "einsatzabschnitt_sprechgruppe",
        scoping: Scoping::UeberParent {
            fk: "abschnitt_id",
            parent: "einsatzabschnitt",
        },
        zeilenfilter: None,
        person_bezug: None,
        spalten: &[
            retain("abschnitt_id", G_FK),
            retain("sprechgruppe_id", G_FK),
        ],
    },
    // ---------- Führungsdokumentation: ETB (RETAIN, Wortlaut) und Führungsmodule ----------
    // Rechtsverbindlich ist allein der ETB-Wortlaut. Die Freitexte der Module darunter werden
    // gescrubbt, ihre Struktur bleibt (LFH-701, Linie A).
    TabellenRegel {
        tabelle: "etb_eintrag",
        scoping: Scoping::EinsatzId,
        zeilenfilter: None,
        person_bezug: None,
        spalten: &[
            retain("id", G_PK),
            retain("einsatz_id", G_SCOPE),
            retain("lfd_nr", G_ZAEHLER),
            retain("typ", G_ENUM),
            retain("inhalt", G_ETB),
            retain("von", G_ETB),
            retain("an", G_ETB),
            retain("meldeweg", G_ETB),
            retain("veranlassung", G_ETB),
            retain("erfasser_id", G_FK),
            // Funktionskürzel („S2“, „EL“), keine Person. Nicht aus
            // `einsatz_mitgliedschaft.fuehrungsstelle` (Scrub) abgeleitet.
            retain("erfasser_funktion", G_ETB),
            retain("ereigniszeit", G_ZEIT),
            retain("received_at", G_ZEIT),
            retain("erfasst_lokal_at", G_ZEIT),
            retain("client_id", G_IDEMPOTENZ),
            retain("berichtigt_eintrag_id", G_FK),
            retain("lagebericht_id", G_FK),
            retain("auftrag_id", G_FK),
            retain("meldung_id", G_FK),
            retain("nachforderung_id", G_FK),
            retain("befehl_id", G_FK),
            retain("pressemitteilung_id", G_FK),
        ],
    },
    TabellenRegel {
        tabelle: "meldung",
        scoping: Scoping::EinsatzId,
        zeilenfilter: None,
        person_bezug: None,
        spalten: &[
            retain("id", G_PK),
            retain("einsatz_id", G_SCOPE),
            retain("client_id", G_IDEMPOTENZ),
            retain("lfd_nr", G_ZAEHLER),
            // Führungs-Freitexte (LFH-701, Linie A): Die Führungsdokumentation ist der
            // ETB-Wortlaut (`etb_eintrag.von`/`an`/`inhalt`, G_ETB); die Meldung ist Arbeitsstand.
            scrub("absender", Strategie::Platzhalter, Z_EINSATZ), // NOT NULL
            scrub("empfaenger", Strategie::NullSetzen, Z_EINSATZ),
            retain("meldeweg", G_ENUM),
            scrub("inhalt", Strategie::Platzhalter, Z_EINSATZ), // NOT NULL
            retain("meldungsart", G_ENUM),
            retain("prioritaet", G_ENUM),
            retain("status", G_ENUM),
            retain("bearbeiter_id", G_FK),
            retain("lagerelevant", G_KONFIG),
            retain("ereigniszeit", G_ZEIT),
            retain("eingang_at", G_ZEIT),
            retain("etb_meldung_id", G_FK),
            retain("auftrag_id", G_FK),
            retain("erfasst_von_id", G_FK),
            retain("erstellt_at", G_ZEIT),
            retain("live_published_at", G_ZEIT),
            retain("bestaetigung_pflicht", G_KONFIG),
            retain("bestaetigung_frist_at", G_ZEIT),
            retain("eskaliert", G_KONFIG),
            retain("richtung", G_ENUM),
            retain("erledigt_at", G_ZEIT),
            retain("einheit_id", G_FK),
            retain("abschnitt_id", G_FK),
        ],
    },
    TabellenRegel {
        tabelle: "auftrag",
        scoping: Scoping::EinsatzId,
        zeilenfilter: None,
        person_bezug: None,
        spalten: &[
            retain("id", G_PK),
            retain("einsatz_id", G_SCOPE),
            // Führungs-Freitexte (LFH-701, Linie A): `auftrag_text` und `vollzugsmeldung` stehen
            // im ETB-Wortlaut; die Fünf-Punkte-Felder gelangen nie ins ETB und gehen ganz.
            scrub("auftrag_text", Strategie::Platzhalter, Z_EINSATZ), // NOT NULL
            scrub("absicht", Strategie::NullSetzen, Z_EINSATZ),
            scrub("lage", Strategie::NullSetzen, Z_EINSATZ),
            scrub("ort", Strategie::NullSetzen, Z_EINSATZ),
            scrub("zeit", Strategie::NullSetzen, Z_EINSATZ),
            scrub("mittel", Strategie::NullSetzen, Z_EINSATZ),
            scrub("verbindung", Strategie::NullSetzen, Z_EINSATZ),
            scrub("sicherheit", Strategie::NullSetzen, Z_EINSATZ),
            retain("prioritaet", G_ENUM),
            retain("frist_at", G_ZEIT),
            retain("erteilt_at", G_ZEIT),
            retain("in_arbeit_at", G_ZEIT),
            scrub("vollzugsmeldung", Strategie::NullSetzen, Z_EINSATZ),
            retain("abgenommen_at", G_ZEIT),
            retain("abgenommen_von_id", G_FK),
            retain("etb_anordnung_id", G_FK),
            retain("erstellt_von_id", G_FK),
            retain("erstellt_at", G_ZEIT),
            retain("richtung", G_ENUM),
            retain("quell_etb_eintrag_id", G_FK),
            retain("lfd_nr", G_ZAEHLER),
        ],
    },
    TabellenRegel {
        tabelle: "auftrag_empfaenger",
        scoping: Scoping::UeberParent {
            fk: "auftrag_id",
            parent: "auftrag",
        },
        zeilenfilter: None,
        person_bezug: None,
        spalten: &[
            retain("id", G_PK),
            retain("auftrag_id", G_FK),
            retain("empfaenger_typ", G_ENUM),
            retain("abschnitt_id", G_FK),
            retain("einheit_id", G_FK),
            retain("person_id", G_FK),
            retain("fahrzeug_id", G_FK),
            // Empfänger-Klartext kann einen Namen tragen (externe Stelle, Funktionsbezeichnung,
            // bei Typ `person` `einsatz_personal.snap_name`, das selbst gescrubbt wird). Er steht
            // verkettet in `etb_eintrag.an` der Anordnung (LFH-701, Linie A); die Bezeichnung
            // von Einheit/Abschnitt/Fahrzeug bleibt zudem über den Verweis erhalten.
            scrub("funktion_text", Strategie::NullSetzen, Z_EINSATZ),
            // Katalogcode (LFH-549) — kein Personenbezug.
            retain("funktion", G_ENUM),
            retain("extern_kategorie", G_ENUM),
            scrub("extern_bezeichnung", Strategie::NullSetzen, Z_EINSATZ),
            scrub("snap_anzeige", Strategie::Platzhalter, Z_EINSATZ), // NOT NULL
            retain("quittiert_at", G_ZEIT),
            retain("quittiert_von_id", G_FK),
        ],
    },
    TabellenRegel {
        tabelle: "lagebericht",
        scoping: Scoping::EinsatzId,
        zeilenfilter: None,
        person_bezug: None,
        spalten: &[
            retain("id", G_PK),
            retain("einsatz_id", G_SCOPE),
            retain("vorlage", G_ENUM),
            scrub("titel", Strategie::Platzhalter, Z_EINSATZ), // NOT NULL
            retain("zeitstand", G_ZEIT),
            retain("status", G_ENUM),
            scrub("abschnitte", Strategie::LeeresJsonArray, Z_EINSATZ), // NOT NULL, JSON
            retain("version", G_ZAEHLER),
            retain("vorgaenger_id", G_FK),
            retain("ersteller_id", G_FK),
            retain("erstellt_at", G_ZEIT),
            retain("aktualisiert_at", G_ZEIT),
            retain("freigegeben_von_id", G_FK),
            retain("freigegeben_at", G_ZEIT),
            retain("etb_eintrag_id", G_FK),
        ],
    },
    TabellenRegel {
        tabelle: "befehl",
        scoping: Scoping::EinsatzId,
        zeilenfilter: None,
        person_bezug: None,
        spalten: &[
            retain("id", G_PK),
            retain("einsatz_id", G_SCOPE),
            retain("vorlage", G_ENUM),
            scrub("titel", Strategie::Platzhalter, Z_EINSATZ), // NOT NULL
            retain("zeitstand", G_ZEIT),
            retain("status", G_ENUM),
            scrub("abschnitte", Strategie::LeeresJsonArray, Z_EINSATZ), // NOT NULL, JSON
            retain("version", G_ZAEHLER),
            retain("vorgaenger_id", G_FK),
            retain("ersteller_id", G_FK),
            retain("erstellt_at", G_ZEIT),
            retain("aktualisiert_at", G_ZEIT),
            retain("freigegeben_von_id", G_FK),
            retain("freigegeben_at", G_ZEIT),
            retain("etb_eintrag_id", G_FK),
        ],
    },
    // ---------- Presse- und Medienarbeit S5 (LFH-554) ----------
    // Die Pressemitteilung folgt `lagebericht`/`befehl` (gemeinsamer Kern `vorlagendokument`,
    // LFH-701, Linie A): Die freigegebene Fassung steht im ETB-Wortlaut, Entwürfe nirgends.
    TabellenRegel {
        tabelle: "pressemitteilung",
        scoping: Scoping::EinsatzId,
        zeilenfilter: None,
        person_bezug: None,
        spalten: &[
            retain("id", G_PK),
            retain("einsatz_id", G_SCOPE),
            retain("vorlage", G_ENUM),
            scrub("titel", Strategie::Platzhalter, Z_EINSATZ), // NOT NULL
            retain("zeitstand", G_ZEIT),
            retain("status", G_ENUM),
            scrub("abschnitte", Strategie::LeeresJsonArray, Z_EINSATZ), // NOT NULL, JSON
            retain("version", G_ZAEHLER),
            retain("vorgaenger_id", G_FK),
            retain("ersteller_id", G_FK),
            retain("erstellt_at", G_ZEIT),
            retain("aktualisiert_at", G_ZEIT),
            retain("freigegeben_von_id", G_FK),
            retain("freigegeben_at", G_ZEIT),
            retain("etb_eintrag_id", G_FK),
        ],
    },
    // Presse-Log: Ansprechperson und Erreichbarkeit sind personenbezogen. Medium (eine
    // Redaktion, keine Person), Thema, Antwort und Freigabeangabe bleiben als Nachweis der
    // Pressearbeit (LFH-554 design.md D9). Anders als die Führungsmodule schreibt das Log kein
    // ETB; ob es Linie A folgen soll, ist eine eigene Abwägung (LFH-901; Herleitung
    // `openspec/changes/archive/2026-10-01-lfh-701-fuehrungs-freitexte-klassifikation/design.md`, D5).
    TabellenRegel {
        tabelle: "medienkontakt",
        scoping: Scoping::EinsatzId,
        zeilenfilter: None,
        person_bezug: None,
        spalten: &[
            retain("id", G_PK),
            retain("einsatz_id", G_SCOPE),
            retain("art", G_ENUM),
            retain("medium", G_PRESSE_LOG),
            retain("thema", G_PRESSE_LOG),
            scrub("kontakt_name", Strategie::NullSetzen, Z_EINSATZ),
            scrub("kontakt_erreichbarkeit", Strategie::NullSetzen, Z_EINSATZ),
            retain("eingang_at", G_ZEIT),
            retain("status", G_ENUM),
            retain("antwort", G_PRESSE_LOG),
            retain("freigabe_durch", G_PRESSE_LOG),
            retain("pressemitteilung_id", G_FK),
            retain("bearbeitet_von_id", G_FK),
            retain("bearbeitet_at", G_ZEIT),
            retain("angelegt_von_id", G_FK),
            retain("angelegt_at", G_ZEIT),
            retain("geaendert_at", G_ZEIT),
        ],
    },
    // Informationstelefon: Name, Rückrufnummer und Notiz der Anrufenden sind personenbezogen.
    // `rueckruf` nimmt den Platzhalter, weil ein CHECK ihn bei `status = 'offen'` verlangt.
    TabellenRegel {
        tabelle: "infotelefon_anruf",
        scoping: Scoping::EinsatzId,
        zeilenfilter: None,
        person_bezug: None,
        spalten: &[
            retain("id", G_PK),
            retain("einsatz_id", G_SCOPE),
            retain("anliegen", G_ENUM),
            scrub("notiz", Strategie::NullSetzen, Z_EINSATZ),
            scrub("anrufer_name", Strategie::NullSetzen, Z_EINSATZ),
            scrub("rueckruf", Strategie::PlatzhalterWennGesetzt, Z_EINSATZ),
            retain("status", G_ENUM),
            retain("eingang_at", G_ZEIT),
            retain("erledigt_von_id", G_FK),
            retain("erledigt_at", G_ZEIT),
            retain("angelegt_von_id", G_FK),
            retain("angelegt_at", G_ZEIT),
        ],
    },
    TabellenRegel {
        tabelle: "nachforderung",
        scoping: Scoping::EinsatzId,
        zeilenfilter: None,
        person_bezug: None,
        spalten: &[
            retain("id", G_PK),
            retain("einsatz_id", G_SCOPE),
            scrub("art", Strategie::Platzhalter, Z_EINSATZ), // NOT NULL, Freitext („RTW“, „Dolmetscher“)
            // Führungs-Freitexte (LFH-701, Linie A): Art, Bezeichnung, Adressat und Begründung
            // stehen im ETB-Wortlaut der Anforderung; der Ablehnungsgrund gelangt nie ins ETB.
            scrub("bezeichnung", Strategie::Platzhalter, Z_EINSATZ), // NOT NULL
            retain("anzahl", G_ZAEHLER),
            retain("adressat_kategorie", G_ENUM),
            scrub("adressat_bezeichnung", Strategie::NullSetzen, Z_EINSATZ),
            scrub("begruendung", Strategie::NullSetzen, Z_EINSATZ),
            retain("prioritaet", G_ENUM),
            retain("status", G_ENUM),
            retain("zugesagt_at", G_ZEIT),
            retain("unterwegs_at", G_ZEIT),
            retain("eingetroffen_at", G_ZEIT),
            retain("abgelehnt_at", G_ZEIT),
            scrub("abgelehnt_grund", Strategie::NullSetzen, Z_EINSATZ),
            retain("angefordert_at", G_ZEIT),
            retain("etb_nachforderung_id", G_FK),
            retain("erstellt_von_id", G_FK),
            retain("erstellt_at", G_ZEIT),
        ],
    },
    // ---------- Chat / Erinnerungen (Freitexte gescrubbt) ----------
    // Chat- und Erinnerungs-Freitexte tragen Personenbezug und werden entfernt, auch in
    // soft-gelöschten Nachrichten. Heraufgestufte Nachrichten liegen als KOPIE in
    // `etb_eintrag.inhalt` (G_ETB) und bleiben dort als Führungsdokumentation; die Kopie in
    // `auftrag.auftrag_text` wird seit LFH-701 mitgescrubbt (bei Auto-ETB steht sie im ETB der
    // Anordnung).
    TabellenRegel {
        tabelle: "chat_kanal",
        scoping: Scoping::EinsatzId,
        zeilenfilter: None,
        person_bezug: None,
        spalten: &[
            retain("id", G_PK),
            retain("einsatz_id", G_SCOPE),
            scrub("name", Strategie::Platzhalter, Z_EINSATZ), // NOT NULL
            scrub("beschreibung", Strategie::NullSetzen, Z_EINSATZ),
            retain("erstellt_von_id", G_FK),
            retain("erstellt_at", G_ZEIT),
            retain("archiviert_at", G_ZEIT),
        ],
    },
    TabellenRegel {
        tabelle: "chat_nachricht",
        scoping: Scoping::EinsatzId,
        zeilenfilter: None,
        person_bezug: None,
        spalten: &[
            retain("id", G_PK),
            retain("einsatz_id", G_SCOPE),
            retain("kanal_id", G_FK),
            retain("autor_id", G_FK),
            scrub("inhalt", Strategie::Platzhalter, Z_EINSATZ), // NOT NULL
            retain("erstellt_at", G_ZEIT),
            retain("bearbeitet_at", G_ZEIT),
            retain("geloescht_at", G_ZEIT),
            retain("etb_eintrag_id", G_FK),
            retain("auftrag_id", G_FK),
            retain("bezug_typ", G_POLY),
            retain("bezug_id", G_POLY),
        ],
    },
    TabellenRegel {
        // Junction; `anhang` ist ZeileLoeschen, die Verknüpfung geht per CASCADE mit (belegt in
        // `repo::tests::schwaerzung_entfernt_chat_und_erinnerungs_freitexte`).
        tabelle: "chat_nachricht_anhang",
        scoping: Scoping::UeberParent {
            fk: "nachricht_id",
            parent: "chat_nachricht",
        },
        zeilenfilter: None,
        person_bezug: None,
        spalten: &[retain("nachricht_id", G_FK), retain("anhang_id", G_FK)],
    },
    TabellenRegel {
        // Junction (Linker auf `anhang`); die Verknüpfung geht per CASCADE mit, der Eintrag bleibt
        // (G_ETB). Der Dateiname steht in keinem ETB-Text. Belegt in
        // `einsatz::repo::tests::schwaerzung_loescht_etb_anhang_und_haelt_den_eintrag`.
        tabelle: "etb_eintrag_anhang",
        scoping: Scoping::UeberParent {
            fk: "eintrag_id",
            parent: "etb_eintrag",
        },
        zeilenfilter: None,
        person_bezug: None,
        spalten: &[retain("eintrag_id", G_FK), retain("anhang_id", G_FK)],
    },
    TabellenRegel {
        tabelle: "erinnerung",
        scoping: Scoping::EinsatzId,
        zeilenfilter: None,
        person_bezug: None,
        spalten: &[
            retain("id", G_PK),
            retain("einsatz_id", G_SCOPE),
            scrub("titel", Strategie::Platzhalter, Z_EINSATZ), // NOT NULL
            scrub("beschreibung", Strategie::NullSetzen, Z_EINSATZ),
            retain("faellig_at", G_ZEIT),
            retain("intervall_minuten", G_KONFIG),
            // Freitext-Empfänger ohne FK, kann einen Personennamen tragen — kein reines
            // Funktionslabel.
            scrub("empfaenger_funktion", Strategie::NullSetzen, Z_EINSATZ),
            // Katalogcode (LFH-549) — kein Personenbezug, überlebt die Schwärzung.
            retain("empfaenger_funktion_code", G_ENUM),
            retain("bezug_typ", G_POLY),
            retain("bezug_id", G_POLY),
            retain("quelle", G_ENUM),
            retain("status", G_ENUM),
            retain("erledigt_at", G_ZEIT),
            retain("zuletzt_ausgeloest_at", G_ZEIT),
            retain("erstellt_von_id", G_FK),
            retain("erstellt_at", G_ZEIT),
        ],
    },
    // ---------- Kommunikations-Status / -Zustellung (reines Status-Skelett) ----------
    TabellenRegel {
        tabelle: "kommunikation_status",
        scoping: Scoping::EinsatzId,
        zeilenfilter: None,
        person_bezug: None,
        spalten: &[
            retain("id", G_PK),
            retain("org_id", G_FK),
            retain("einsatz_id", G_SCOPE),
            retain("objekt_typ", G_POLY),
            retain("objekt_id", G_POLY),
            retain("quittiert_at", G_ZEIT),
            retain("quittiert_von_id", G_FK),
            retain("vollzug_status", G_ENUM),
            retain("vollzogen_at", G_ZEIT),
            retain("vollzogen_von_id", G_FK),
        ],
    },
    TabellenRegel {
        tabelle: "kommunikation_zustellung",
        scoping: Scoping::EinsatzId,
        zeilenfilter: None,
        person_bezug: None,
        spalten: &[
            retain("id", G_PK),
            retain("org_id", G_FK),
            retain("einsatz_id", G_SCOPE),
            retain("objekt_typ", G_POLY),
            retain("objekt_id", G_POLY),
            retain("empfaenger_id", G_FK),
            retain("zugestellt_at", G_ZEIT),
            retain("gelesen_at", G_ZEIT),
        ],
    },
    // ETB-Lesemarke: wer bis wohin gesichtet hat — Struktur, kein Inhalt.
    TabellenRegel {
        tabelle: "etb_lesemarke",
        scoping: Scoping::EinsatzId,
        zeilenfilter: None,
        person_bezug: None,
        spalten: &[
            retain("einsatz_id", G_SCOPE),
            retain("benutzer_id", G_FK),
            retain("gesichtet_lfd_nr", G_ZAEHLER),
            retain("gesichtet_at", G_ZEIT),
        ],
    },
    // ---------- Demo-Daten (LFH-690) ----------
    // Der Kopf wird über die Spalte `einsatz_id` entdeckt, obwohl sie kein FK ist
    // (`entdecke_einsatz_scoped` prüft den Spaltennamen). Kein Scrub: Struktur, Zeitstempel und
    // ein Mengenbericht, kein Personenbezug.
    TabellenRegel {
        tabelle: "demo_import",
        scoping: Scoping::EinsatzId,
        zeilenfilter: None,
        person_bezug: None,
        spalten: &[
            retain("id", G_PK),
            retain("org_id", G_FK),
            retain(
                "einsatz_id",
                "ID des Demo-Einsatzes, bewusst ohne FK: bleibt nach dem Entfernen als \
                 ID-Sperre stehen (LFH-690 D6), kein Personenbezug",
            ),
            retain("importiert_von", G_FK),
            retain("importiert_at", G_ZEIT),
            retain("entfernt_at", G_ZEIT),
            retain(
                "bericht",
                "Mengenbericht des letzten Demo-Vorgangs (JSON mit Zählern je Stammdatenart, \
                 kein Personenbezug)",
            ),
        ],
    },
    // ---------- Löschprotokoll der endgültigen Löschung (LFH-750) ----------
    // Wird über die Spalte `einsatz_id` entdeckt (wie `demo_import`, ohne FK). Die Zeile entsteht
    // erst, wenn der Einsatz gelöscht wird; zur Schwärzung eines Einsatzes gibt es sie nie. Kein
    // Scrub: Nummer, Zeitpunkte und Frist, ohne Bezeichnung, Stichwort, Ort und ETB-Text.
    TabellenRegel {
        tabelle: "aufbewahrung_loeschprotokoll",
        scoping: Scoping::EinsatzId,
        zeilenfilter: None,
        person_bezug: None,
        spalten: &[
            retain("id", G_PK),
            retain("org_id", G_FK),
            retain(
                "einsatz_id",
                "ID des endgültig gelöschten Einsatzes, bewusst ohne FK: sperrt ID und \
                 Einsatznummer gegen die Wiedervergabe (LFH-750 D5), kein Personenbezug",
            ),
            retain("einsatznummer_intern", G_ZAEHLER),
            retain("nummer_jahr", G_ZAEHLER),
            retain("nummer_lfd", G_ZAEHLER),
            retain("abgeschlossen_at", G_ZEIT),
            retain("geschwaerzt_at", G_ZEIT),
            retain("geloescht_at", G_ZEIT),
            retain("skelett_dauer_tage", G_KONFIG),
            retain("akteur_id", G_FK),
        ],
    },
    // Die Marke kommt über die CASCADE-Hülle (`import_id` → `demo_import`) mit; sie zeigt auf
    // Stammdaten der Org, nie auf Einsatzzeilen.
    TabellenRegel {
        tabelle: "demo_herkunft",
        scoping: Scoping::UeberParent {
            fk: "import_id",
            parent: "demo_import",
        },
        zeilenfilter: None,
        person_bezug: None,
        spalten: &[
            retain("import_id", G_FK),
            retain(
                "tabelle",
                "Stammdatenart der Marke (CHECK auf fahrzeug/personal/material, kein Personenbezug)",
            ),
            retain(
                "datensatz_id",
                "Polymorpher Verweis auf die markierte Stammdatenzeile (Struktur, kein Personenbezug)",
            ),
        ],
    },
    // ---------- Schwärzungsanträge (LFH-751) ----------
    // Der Antrag ist der Nachweis, dass die Organisation einem Löschersuchen nach Art. 17
    // nachgekommen ist (Rechenschaftspflicht, Art. 5 Abs. 2) — er überdauert die Schwärzung.
    // Das Ziel steht nur als Art + ID darin, nie mit Namen.
    TabellenRegel {
        tabelle: "schwaerzung_antrag",
        scoping: Scoping::EinsatzId,
        zeilenfilter: None,
        person_bezug: None,
        spalten: &[
            retain("id", G_PK),
            retain("einsatz_id", G_SCOPE),
            retain("ziel_art", G_ENUM),
            retain("ziel_id", G_POLY),
            retain("aktenzeichen", G_ANTRAG),
            retain("beantragt_von", G_FK),
            retain("beantragt_at", G_ZEIT),
            retain("faellig_at", G_ZEIT),
            retain("zurueckgenommen_at", G_ZEIT),
            retain("zurueckgenommen_von", G_FK),
            retain("vollzogen_at", G_ZEIT),
        ],
    },
];

/// Sucht die Klassifikation einer Spalte in der Registry (`None`, wenn nicht erfasst).
pub fn klassifikation_von(tabelle: &str, spalte: &str) -> Option<Klassifikation> {
    TABELLEN
        .iter()
        .find(|t| t.tabelle == tabelle)?
        .spalten
        .iter()
        .find(|s| s.spalte == spalte)
        .map(|s| s.klassifikation)
}

/// Baut die WHERE-Klausel (ohne führendes `WHERE`) für eine Tabellenregel; der einzige
/// Bind-Parameter ist stets die `einsatz_id`.
pub(super) fn where_klausel(regel: &TabellenRegel) -> String {
    let basis = match regel.scoping {
        Scoping::SelbstId => "id = ?".to_string(),
        Scoping::EinsatzId => "einsatz_id = ?".to_string(),
        Scoping::UeberParent { fk, parent } => {
            format!("{fk} IN (SELECT id FROM {parent} WHERE einsatz_id = ?)")
        }
    };
    match regel.zeilenfilter {
        Some(filter) => format!("{basis} AND {filter}"),
        None => basis,
    }
}

/// SET-Zuweisungen eines Spalten-Scrubs in Spaltenreihenfolge und die Zahl der Platzhalter-Binds.
/// Platzhalter-Strategien binden [`SCHWAERZUNG_PLATZHALTER`] in genau dieser Reihenfolge VOR den
/// Bind-Parametern der WHERE-Klausel. `ZeileLoeschen` ist kein Spalten-Scrub (Aufrufer fängt ab).
pub(super) fn set_zuweisungen(scrubs: &[(&'static str, Strategie)]) -> (Vec<String>, usize) {
    let mut sets: Vec<String> = Vec::with_capacity(scrubs.len());
    let mut platzhalter_binds = 0usize;
    for (spalte, strategie) in scrubs {
        match strategie {
            Strategie::NullSetzen => sets.push(format!("{spalte} = NULL")),
            Strategie::Platzhalter => {
                sets.push(format!("{spalte} = ?"));
                platzhalter_binds += 1;
            }
            Strategie::PlatzhalterWennGesetzt => {
                sets.push(format!(
                    "{spalte} = CASE WHEN {spalte} IS NULL THEN NULL ELSE ? END"
                ));
                platzhalter_binds += 1;
            }
            Strategie::PlatzhalterMitId => {
                sets.push(format!("{spalte} = ? || ' ' || id"));
                platzhalter_binds += 1;
            }
            Strategie::LeeresJsonArray => sets.push(format!("{spalte} = '[]'")),
            Strategie::ZeileLoeschen => unreachable!("ZeileLoeschen ist kein Spalten-Scrub"),
        }
    }
    (sets, platzhalter_binds)
}

/// Tabellen, deren Zeilen einer Person einen Behandlungsbezug geben (design.md D3), jeweils
/// über `person_id`. Dazu kommt `einsatz_person.zustand` selbst. Ohne `storniert_at`-Filter: auch
/// eine stornierte Sichtung war eine medizinische Einschätzung. Gepinnt in
/// `tests::behandlungsbezug_kennt_jede_personentabelle`.
pub const BEHANDLUNGSBEZUG_TABELLEN: &[&str] = &[
    "person_sichtung",
    "person_verlaufsnotiz",
    "person_uhs_belegung",
];

/// `SELECT` der Personen-IDs mit Behandlungsbezug (ohne Einsatz-Eingrenzung; der Aufrufer grenzt
/// über die Tabellenregel ein).
fn behandlungsbezug_sql() -> String {
    let mut teile = vec!["p.zustand IS NOT NULL".to_string()];
    for t in BEHANDLUNGSBEZUG_TABELLEN {
        teile.push(format!(
            "EXISTS (SELECT 1 FROM {t} x WHERE x.person_id = p.id)"
        ));
    }
    format!(
        "SELECT p.id FROM einsatz_person p WHERE {}",
        teile.join(" OR ")
    )
}

/// Was ein Scrub-Lauf erfasst (LFH-749, design.md D2/D3).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Umfang {
    /// Alle Scrub-Spalten, gleich welcher Zuordnung: die Einsatz-Schwärzung.
    Alles,
    /// Nur die Spalten dieser Datenkategorie.
    Kategorie(Datenkategorie),
    /// Der Personenstamm; mit `nur_ohne_behandlungsbezug` nur der Personen ohne
    /// Behandlungsbezug (die Personenauskunft ist geschwärzt, die Behandlung nicht).
    Personenstamm { nur_ohne_behandlungsbezug: bool },
}

impl Umfang {
    fn erfasst(self, zuordnung: Zuordnung) -> bool {
        match self {
            Umfang::Alles => true,
            Umfang::Kategorie(k) => zuordnung == Zuordnung::Kategorie(k),
            Umfang::Personenstamm { .. } => zuordnung == Zuordnung::Personenstamm,
        }
    }
}

/// Treibt den PII-Scrub data-driven aus [`TABELLEN`]: je Tabelle mit `Scrub`-Spalten im
/// [`Umfang`] genau ein `UPDATE` (bzw. `DELETE` bei `ZeileLoeschen`), auf der
/// Transaktions-Verbindung des Aufrufers, damit der Scrub atomar bleibt. `AssertSqlSafe` ist
/// sicher, weil alle Namen compile-time-Konstanten sind; Platzhalter und `einsatz_id` werden
/// gebunden.
pub async fn scrubbe_aus_registry(
    conn: &mut sqlx::SqliteConnection,
    einsatz_id: i64,
    umfang: Umfang,
) -> Result<(), sqlx::Error> {
    for regel in TABELLEN {
        let scrubs: Vec<(&'static str, Strategie)> = regel
            .spalten
            .iter()
            .filter_map(|s| match s.klassifikation {
                Klassifikation::Scrub(strategie, zuordnung) if umfang.erfasst(zuordnung) => {
                    Some((s.spalte, strategie))
                }
                Klassifikation::Scrub(..) | Klassifikation::Retain(_) => None,
            })
            .collect();
        if scrubs.is_empty() {
            continue;
        }

        let mut where_teil = where_klausel(regel);
        if let Umfang::Personenstamm {
            nur_ohne_behandlungsbezug: true,
        } = umfang
        {
            // Der Guard `kategorie_zuordnung_ist_gepinnt` sichert, dass jede Personenstamm-Tabelle
            // ihren Personenbezug nennt; fehlt er doch, schwärzte ein Lauf ohne Filter zu viel.
            let Some(bezug) = regel.person_bezug else {
                return Err(sqlx::Error::Protocol(format!(
                    "Personenstamm-Tabelle {} ohne person_bezug",
                    regel.tabelle
                )));
            };
            where_teil = format!(
                "{where_teil} AND {bezug} NOT IN ({})",
                behandlungsbezug_sql()
            );
        }

        // ZeileLoeschen muss für alle Scrub-Spalten der Tabelle gelten, sonst mischte die Registry
        // Zeilenlöschung mit Spalten-Scrub.
        if scrubs.iter().any(|(_, s)| *s == Strategie::ZeileLoeschen) {
            debug_assert!(
                scrubs.iter().all(|(_, s)| *s == Strategie::ZeileLoeschen),
                "ZeileLoeschen muss für ALLE Scrub-Spalten von {} gelten",
                regel.tabelle
            );
            let sql = format!("DELETE FROM {} WHERE {where_teil}", regel.tabelle);
            sqlx::query(sqlx::AssertSqlSafe(sql))
                .bind(einsatz_id)
                .execute(&mut *conn)
                .await?;
            continue;
        }

        let (sets, platzhalter_binds) = set_zuweisungen(&scrubs);
        let sql = format!(
            "UPDATE {} SET {} WHERE {where_teil}",
            regel.tabelle,
            sets.join(", ")
        );
        let mut query = sqlx::query(sqlx::AssertSqlSafe(sql));
        for _ in 0..platzhalter_binds {
            query = query.bind(SCHWAERZUNG_PLATZHALTER);
        }
        query.bind(einsatz_id).execute(&mut *conn).await?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::{Row, SqlitePool};
    use std::collections::BTreeSet;

    /// Tabellen, die weder Nutz- noch Metadaten der Schwärzung sind (FTS-Schatten,
    /// sqlite-intern, Migrations-Ledger).
    fn ist_relevante_tabelle(name: &str) -> bool {
        !(name.starts_with("sqlite_") || name.contains("_fts") || name == "_sqlx_migrations")
    }

    async fn alle_tabellen(pool: &SqlitePool) -> Vec<String> {
        sqlx::query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
            .fetch_all(pool)
            .await
            .unwrap()
            .iter()
            .map(|r| r.get::<String, _>("name"))
            .filter(|n| ist_relevante_tabelle(n))
            .collect()
    }

    async fn spalten_von(pool: &SqlitePool, tabelle: &str) -> Vec<String> {
        // Tabellenname stammt aus sqlite_master (vertrauenswürdig, kein User-Input).
        let sql = format!("PRAGMA table_info('{tabelle}')");
        sqlx::query(sqlx::AssertSqlSafe(sql))
            .fetch_all(pool)
            .await
            .unwrap()
            .iter()
            .map(|r| r.get::<String, _>("name"))
            .collect()
    }

    /// Ausgehende FKs einer Tabelle als `(referenzierte_tabelle, on_delete)`.
    async fn fks_von(pool: &SqlitePool, tabelle: &str) -> Vec<(String, String)> {
        fk_kanten_von(pool, tabelle)
            .await
            .into_iter()
            .map(|(_, parent, on_delete)| (parent, on_delete))
            .collect()
    }

    /// Entdeckt die einsatz-scoped Tabellenmenge S dynamisch: `{einsatz}` ∪ `{Tabellen mit
    /// einsatz_id}` ∪ transitive Hülle über `ON DELETE CASCADE`-FKs ab S. Der Stammdaten-Teilbaum
    /// bleibt außen vor.
    ///
    /// Die Hülle folgt nur `CASCADE`; dass sie damit nichts verliert, erzwingt GUARD 5
    /// (`guard5_keine_fk_kante_von_aussen_nach_s`).
    async fn entdecke_einsatz_scoped(pool: &SqlitePool) -> BTreeSet<String> {
        let alle = alle_tabellen(pool).await;
        let mut s: BTreeSet<String> = BTreeSet::new();
        s.insert("einsatz".to_string());
        for t in &alle {
            if spalten_von(pool, t).await.iter().any(|c| c == "einsatz_id") {
                s.insert(t.clone());
            }
        }
        loop {
            let mut neu = false;
            for t in &alle {
                if s.contains(t) {
                    continue;
                }
                let fks = fks_von(pool, t).await;
                if fks
                    .iter()
                    .any(|(parent, on_del)| on_del == "CASCADE" && s.contains(parent))
                {
                    s.insert(t.clone());
                    neu = true;
                }
            }
            if !neu {
                break;
            }
        }
        s
    }

    /// GUARD 1: jede Spalte jeder einsatz-scoped Tabelle MUSS klassifiziert sein.
    #[tokio::test]
    async fn jede_einsatz_scoped_spalte_ist_klassifiziert() {
        let pool = crate::db::test_pool().await;
        let s = entdecke_einsatz_scoped(&pool).await;
        let mut fehlend: Vec<(String, String)> = Vec::new();
        for t in &s {
            for c in spalten_von(&pool, t).await {
                if klassifikation_von(t, &c).is_none() {
                    fehlend.push((t.clone(), c));
                }
            }
        }
        assert!(
            fehlend.is_empty(),
            "Unklassifizierte einsatz-scoped Spalten ({}) — jede muss Scrub|Retain sein:\n{}",
            fehlend.len(),
            fehlend
                .iter()
                .map(|(t, c)| format!("  {t}.{c}"))
                .collect::<Vec<_>>()
                .join("\n"),
        );
    }

    /// GUARD 2: kein Registry-Eintrag zeigt auf eine Spalte/Tabelle, die es nicht gibt (sonst
    /// würfe der Scrub NO-SUCH-COLUMN).
    #[tokio::test]
    async fn keine_toten_registry_eintraege() {
        let pool = crate::db::test_pool().await;
        let vorhandene: std::collections::HashMap<&str, BTreeSet<String>> = {
            let mut m = std::collections::HashMap::new();
            for regel in TABELLEN {
                let cols: BTreeSet<String> = spalten_von(&pool, regel.tabelle)
                    .await
                    .into_iter()
                    .collect();
                m.insert(regel.tabelle, cols);
            }
            m
        };
        let mut tot: Vec<String> = Vec::new();
        for regel in TABELLEN {
            let cols = &vorhandene[regel.tabelle];
            if cols.is_empty() {
                tot.push(format!("{} (Tabelle fehlt)", regel.tabelle));
                continue;
            }
            for s in regel.spalten {
                if !cols.contains(s.spalte) {
                    tot.push(format!("{}.{}", regel.tabelle, s.spalte));
                }
            }
        }
        assert!(
            tot.is_empty(),
            "Tote Registry-Einträge:\n  {}",
            tot.join("\n  ")
        );
    }

    /// GUARD 3: die entdeckte Tabellenmenge == Registry-Tabellenmenge (keine Tabelle
    /// nur im einen oder anderen).
    #[tokio::test]
    async fn entdeckte_tabellen_gleich_registry_tabellen() {
        let pool = crate::db::test_pool().await;
        let entdeckt = entdecke_einsatz_scoped(&pool).await;
        let registriert: BTreeSet<String> =
            TABELLEN.iter().map(|t| t.tabelle.to_string()).collect();

        let nur_entdeckt: Vec<&String> = entdeckt.difference(&registriert).collect();
        let nur_registriert: Vec<&String> = registriert.difference(&entdeckt).collect();
        assert!(
            nur_entdeckt.is_empty() && nur_registriert.is_empty(),
            "Tabellenmengen weichen ab.\n  nur entdeckt (fehlen in Registry): {nur_entdeckt:?}\n  \
             nur registriert (nicht mehr einsatz-scoped): {nur_registriert:?}",
        );
    }

    /// GUARD 4: der Stammdaten-/Katalog-Teilbaum darf nie in S landen (sonst irreversibler
    /// Falsch-Scrub).
    #[tokio::test]
    async fn stammdaten_teilbaum_nie_einsatz_scoped() {
        let pool = crate::db::test_pool().await;
        let s = entdecke_einsatz_scoped(&pool).await;
        // Stammdaten/Kataloge ohne CASCADE-FK auf einsatz — dürfen nicht mit-gescrubbt werden.
        for verboten in [
            "benutzer",
            "organisation",
            "personal",
            "fahrzeug",
            "material",
            "einheit_typ",
            "qualifikation",
            "karte_registry",
            // Logo der Organisation: hängt an der Org, nicht am Einsatz. Ein späterer FK Richtung
            // Einsatz
            // zöge es still in die Schwärzung — dieser Eintrag macht das rot.
            "org_logo",
        ] {
            assert!(
                !s.contains(verboten),
                "Stammdaten-Tabelle {verboten:?} wurde als einsatz-scoped entdeckt — \
                 die CASCADE-Hülle würde sie irreversibel schwärzen!"
            );
        }
    }

    // ---------- GUARD 5: FK-Kanten von außerhalb S nach S ----------

    /// Begründete Ausnahmen zu GUARD 5, `(tabelle, spalte, grund)`: FK-Kanten aus Tabellen
    /// AUSSERHALB von S nach S, deren Zeilen nicht einsatz-eigen sind und deshalb nicht geschwärzt
    /// werden. Je KANTE, nicht je Tabelle; der Grund ist Pflicht.
    ///
    /// GUARD 5 sieht keine Verweise ohne deklarierten FK (polymorphe `objekt_typ`/`objekt_id`) und
    /// keine `_fts`-Tabellen. Die Liste ist leer, weil der Bestand keine solche Kante hat; ein
    /// Eintrag ohne Querkante gilt selbst als Verstoß
    /// (`guard5_allowlist_hat_keine_toten_eintraege`).
    const FREMDKANTEN_ALLOWLIST: &[(&str, &str, &str)] = &[];

    /// Eine FK-Kante aus einer Tabelle außerhalb von S auf eine Tabelle in S.
    #[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
    struct FremdKante {
        tabelle: String,
        spalte: String,
        parent: String,
        on_delete: String,
    }

    /// Befund für GUARD 5: jede FK-Kante aus einer Tabelle außerhalb von `s` auf eine Tabelle in
    /// `s`, unabhängig von `on_delete`, abzüglich der Allowlist.
    async fn fremde_fk_auf_scoped(
        pool: &SqlitePool,
        s: &BTreeSet<String>,
        allowlist: &[(&str, &str, &str)],
    ) -> Vec<FremdKante> {
        let mut befund: Vec<FremdKante> = Vec::new();
        for t in alle_tabellen(pool).await {
            if s.contains(&t) {
                continue;
            }
            for (spalte, parent, on_delete) in fk_kanten_von(pool, &t).await {
                let begruendet = allowlist
                    .iter()
                    .any(|(tabelle, sp, _)| *tabelle == t && *sp == spalte);
                if s.contains(&parent) && !begruendet {
                    befund.push(FremdKante {
                        tabelle: t.clone(),
                        spalte,
                        parent,
                        on_delete,
                    });
                }
            }
        }
        befund.sort();
        befund
    }

    /// Ausgehende FKs einer Tabelle als `(spalte, referenzierte_tabelle, on_delete)`.
    /// SQLite meldet eine fehlende ON-DELETE-Angabe als `"NO ACTION"`.
    async fn fk_kanten_von(pool: &SqlitePool, tabelle: &str) -> Vec<(String, String, String)> {
        let sql = format!("PRAGMA foreign_key_list('{tabelle}')");
        sqlx::query(sqlx::AssertSqlSafe(sql))
            .fetch_all(pool)
            .await
            .unwrap()
            .iter()
            .map(|r| {
                (
                    r.get::<String, _>("from"),
                    r.get::<String, _>("table"),
                    r.get::<String, _>("on_delete"),
                )
            })
            .collect()
    }

    /// Allowlist-Einträge ohne Querkante im UNGEFILTERTEN Befund (tot) — gegen den gefilterten sähe
    /// jeder wirksame Eintrag tot aus.
    fn tote_allowlist_eintraege<'a>(
        ungefiltert: &[FremdKante],
        allowlist: &[(&'a str, &'a str, &'a str)],
    ) -> Vec<(&'a str, &'a str)> {
        allowlist
            .iter()
            .filter(|(tabelle, spalte, _)| {
                !ungefiltert
                    .iter()
                    .any(|k| k.tabelle == *tabelle && k.spalte == *spalte)
            })
            .map(|(tabelle, spalte, _)| (*tabelle, *spalte))
            .collect()
    }

    /// GUARD 5: eine neue Tabelle ohne `einsatz_id`, die per `SET NULL` oder ohne ON-DELETE auf S
    /// zeigt, fiele aus S heraus, und ihre PII überlebte die Schwärzung. Deshalb muss jede
    /// FK-Kante nach S aus S kommen oder begründet auf der Allowlist stehen.
    #[tokio::test]
    async fn guard5_keine_fk_kante_von_aussen_nach_s() {
        let pool = crate::db::test_pool().await;
        let s = entdecke_einsatz_scoped(&pool).await;
        let befund = fremde_fk_auf_scoped(&pool, &s, FREMDKANTEN_ALLOWLIST).await;
        assert!(
            befund.is_empty(),
            "FK-Kanten von außerhalb der einsatz-scoped Menge S nach S ({}). Die Zeilen \
             dieser Tabellen hängen an einem Einsatz, liegen aber nicht in S und würden \
             NICHT geschwärzt. Sind die Zeilen einsatz-eigen: (1) eine einsatz_id-Spalte \
             ergänzen oder (2) den FK auf ON DELETE CASCADE umstellen (dann entdeckt die \
             Hülle die Tabelle, GUARD 1/3 verlangen die Klassifikation). Sind sie es NICHT \
             (Stammdaten): (3) die Kante mit Begründung auf FREMDKANTEN_ALLOWLIST setzen — \
             (1)/(2) zögen Stammdaten in die unumkehrbare Schwärzung:\n{}",
            befund.len(),
            befund
                .iter()
                .map(|k| format!(
                    "  {}.{} → {} (ON DELETE {})",
                    k.tabelle, k.spalte, k.parent, k.on_delete
                ))
                .collect::<Vec<_>>()
                .join("\n"),
        );
    }

    /// Wächter zu GUARD 5: kein toter Allowlist-Eintrag.
    #[tokio::test]
    async fn guard5_allowlist_hat_keine_toten_eintraege() {
        let pool = crate::db::test_pool().await;
        let s = entdecke_einsatz_scoped(&pool).await;
        let ungefiltert = fremde_fk_auf_scoped(&pool, &s, &[]).await;
        let tot = tote_allowlist_eintraege(&ungefiltert, FREMDKANTEN_ALLOWLIST);
        for (tabelle, spalte, grund) in FREMDKANTEN_ALLOWLIST {
            assert!(
                !grund.trim().is_empty(),
                "FREMDKANTEN_ALLOWLIST-Eintrag {tabelle}.{spalte} ohne Begründung"
            );
        }
        assert!(
            tot.is_empty(),
            "Tote FREMDKANTEN_ALLOWLIST-Einträge (keine FK-Kante mehr nach S) — streichen: \
             {tot:?}"
        );
    }

    /// Beschränkt einen Befund auf die Sondentabellen, damit die synthetischen Tests auch mit einer
    /// künftigen begründeten Querkante grün bleiben.
    fn nur_sonden(befund: Vec<FremdKante>) -> Vec<FremdKante> {
        befund
            .into_iter()
            .filter(|k| k.tabelle.starts_with("lfh291_sonde_"))
            .collect()
    }

    /// Legt im (je Test eigenen) Pool vier Sondentabellen an: zwei Lecks, die GUARD 5
    /// melden muss, und zwei Kontrollen, die er NICHT melden darf.
    async fn lege_fremdkanten_sonden_an(pool: &SqlitePool) {
        for ddl in [
            // (a) SET NULL auf einen einsatz-scoped Parent OHNE einsatz_id (uhs_platz liegt
            //     nur über den CASCADE-FK auf uhs in S).
            "CREATE TABLE lfh291_sonde_set_null (
                 id INTEGER PRIMARY KEY,
                 platz_id INTEGER REFERENCES uhs_platz(id) ON DELETE SET NULL,
                 freitext TEXT
             )",
            // (b) FK ohne ON-DELETE-Angabe (NO ACTION) auf einsatz_person.
            "CREATE TABLE lfh291_sonde_no_action (
                 id INTEGER PRIMARY KEY,
                 person_id INTEGER REFERENCES einsatz_person(id),
                 freitext TEXT
             )",
            // Kontrolle 1: FK auf eine Tabelle AUSSERHALB von S — keine Querkante.
            "CREATE TABLE lfh291_sonde_extern (
                 id INTEGER PRIMARY KEY,
                 benutzer_id INTEGER REFERENCES benutzer(id) ON DELETE SET NULL
             )",
            // Kontrolle 2: CASCADE-FK nach S — die Hülle nimmt die Tabelle in S auf.
            "CREATE TABLE lfh291_sonde_cascade (
                 id INTEGER PRIMARY KEY,
                 person_id INTEGER NOT NULL REFERENCES einsatz_person(id) ON DELETE CASCADE
             )",
        ] {
            sqlx::query(ddl).execute(pool).await.unwrap();
        }
    }

    /// SET NULL auf einen Parent ohne einsatz_id und ein FK ohne ON-DELETE werden gemeldet; FKs
    /// nach außen und CASCADE-Kinder nicht.
    #[tokio::test]
    async fn guard5_meldet_set_null_und_no_action_kanten_synthetisch() {
        let pool = crate::db::test_pool().await;
        lege_fremdkanten_sonden_an(&pool).await;
        let s = entdecke_einsatz_scoped(&pool).await;
        assert!(s.contains("uhs_platz") && s.contains("einsatz_person"));
        assert!(!s.contains("lfh291_sonde_set_null"));
        assert!(!s.contains("lfh291_sonde_no_action"));
        assert!(!s.contains("lfh291_sonde_extern"));
        assert!(
            s.contains("lfh291_sonde_cascade"),
            "Kontrolle: das CASCADE-Kind gehört zu S"
        );

        let befund = nur_sonden(fremde_fk_auf_scoped(&pool, &s, &[]).await);
        let erwartet = vec![
            FremdKante {
                tabelle: "lfh291_sonde_no_action".into(),
                spalte: "person_id".into(),
                parent: "einsatz_person".into(),
                on_delete: "NO ACTION".into(),
            },
            FremdKante {
                tabelle: "lfh291_sonde_set_null".into(),
                spalte: "platz_id".into(),
                parent: "uhs_platz".into(),
                on_delete: "SET NULL".into(),
            },
        ];
        assert_eq!(befund, erwartet, "genau die zwei Lecks, keine Kontrolle");
    }

    /// Die Allowlist filtert je KANTE: eine zweite Kante derselben Tabelle bleibt sichtbar. Ein
    /// Eintrag ohne passende Querkante ist tot.
    #[tokio::test]
    async fn guard5_allowlist_filtert_je_kante_und_toter_eintrag_wird_gemeldet_synthetisch() {
        let pool = crate::db::test_pool().await;
        lege_fremdkanten_sonden_an(&pool).await;
        // Zwei Kanten nach S an EINER Tabelle: nur die erste ist begründet.
        sqlx::query(
            "CREATE TABLE lfh291_sonde_zwei_kanten (
                 id INTEGER PRIMARY KEY,
                 platz_id INTEGER REFERENCES uhs_platz(id) ON DELETE SET NULL,
                 person_id INTEGER REFERENCES einsatz_person(id) ON DELETE SET NULL,
                 freitext TEXT
             )",
        )
        .execute(&pool)
        .await
        .unwrap();
        let s = entdecke_einsatz_scoped(&pool).await;
        let allowlist: &[(&str, &str, &str)] = &[
            (
                "lfh291_sonde_set_null",
                "platz_id",
                "Sonde: begründete Ausnahme",
            ),
            (
                "lfh291_sonde_zwei_kanten",
                "platz_id",
                "Sonde: nur diese Kante",
            ),
            (
                "lfh291_sonde_extern",
                "benutzer_id",
                "Sonde: hat keine Kante nach S",
            ),
            (
                "lfh291_sonde_no_action",
                "gibt_es_nicht",
                "Sonde: falsche Spalte",
            ),
        ];

        let gefiltert = nur_sonden(fremde_fk_auf_scoped(&pool, &s, allowlist).await);
        let kanten: Vec<(&str, &str)> = gefiltert
            .iter()
            .map(|k| (k.tabelle.as_str(), k.spalte.as_str()))
            .collect();
        assert_eq!(
            kanten,
            vec![
                ("lfh291_sonde_no_action", "person_id"),
                ("lfh291_sonde_zwei_kanten", "person_id"),
            ],
            "die unbegründete zweite Kante derselben Tabelle bleibt gemeldet"
        );

        let ungefiltert = fremde_fk_auf_scoped(&pool, &s, &[]).await;
        assert_eq!(
            tote_allowlist_eintraege(&ungefiltert, allowlist),
            vec![
                ("lfh291_sonde_extern", "benutzer_id"),
                ("lfh291_sonde_no_action", "gibt_es_nicht"),
            ],
            "Einträge mit passender Querkante leben, die übrigen sind tot"
        );
    }

    /// Pinnt die Zuordnung aus design.md D1 (LFH-749): Jede Spalte mit eigener Kategorie oder im
    /// Personenstamm steht hier namentlich, damit eine stille Umhängung — etwa eines
    /// Gesundheitsdatums auf die Einsatz-Frist — rot wird. Dazu: Personenstamm-Tabellen nennen
    /// ihren Personenbezug, und `ZeileLoeschen`-Tabellen gehören geschlossen einer Zuordnung an.
    #[test]
    fn kategorie_zuordnung_ist_gepinnt() {
        use std::collections::BTreeMap;
        let mut ist: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
        for regel in TABELLEN {
            let mut zuordnungen = BTreeSet::new();
            let mut hat_stamm = false;
            let mut hat_loeschen = false;
            for s in regel.spalten {
                let Klassifikation::Scrub(strategie, zuordnung) = s.klassifikation else {
                    continue;
                };
                hat_loeschen |= strategie == Strategie::ZeileLoeschen;
                zuordnungen.insert(format!("{zuordnung:?}"));
                let schluessel = match zuordnung {
                    Zuordnung::Einsatz => continue,
                    Zuordnung::Personenstamm => {
                        hat_stamm = true;
                        "personenstamm".to_string()
                    }
                    Zuordnung::Kategorie(k) => k.as_str().to_string(),
                };
                ist.entry(schluessel)
                    .or_default()
                    .insert(format!("{}.{}", regel.tabelle, s.spalte));
            }
            assert_eq!(
                regel.person_bezug.is_some(),
                hat_stamm,
                "{}: person_bezug genau dann, wenn die Tabelle Personenstamm-Spalten trägt",
                regel.tabelle
            );
            if hat_loeschen {
                assert_eq!(
                    zuordnungen.len(),
                    1,
                    "{}: ZeileLoeschen-Tabelle mit gemischter Zuordnung {zuordnungen:?}",
                    regel.tabelle
                );
            }
        }

        let menge = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<BTreeSet<_>>();
        let spalten_von = |tabelle: &str| {
            TABELLEN
                .iter()
                .find(|t| t.tabelle == tabelle)
                .unwrap()
                .spalten
                .iter()
                .map(|s| format!("{tabelle}.{}", s.spalte))
                .collect::<Vec<_>>()
        };
        let mut anhaenge = BTreeSet::new();
        for t in [
            "anhang",
            "einsatz_dokument",
            "einsatz_schaden_anhang",
            "einsatz_tier_anhang",
            "uhs_anhang",
        ] {
            anhaenge.extend(spalten_von(t));
        }
        let soll: BTreeMap<String, BTreeSet<String>> = [
            (
                "behandlung".to_string(),
                menge(&[
                    "einsatz_person.zustand",
                    "person_sichtung.notiz",
                    "person_uhs_belegung.notiz",
                    "person_verlaufsnotiz.text",
                ]),
            ),
            (
                "personenauskunft".to_string(),
                menge(&[
                    "einsatz_person.herkunft_adresse",
                    "einsatz_person.melder_kontakt",
                ]),
            ),
            ("anhaenge".to_string(), anhaenge),
            (
                "personenstamm".to_string(),
                menge(&[
                    "einsatz_person.aktueller_verbleib",
                    "einsatz_person.aktuelles_verbleib_ziel",
                    "einsatz_person.alter_geschaetzt",
                    "einsatz_person.antreff_lat",
                    "einsatz_person.antreff_lon",
                    "einsatz_person.antreff_ort",
                    "einsatz_person.geburtsdatum",
                    "einsatz_person.geschlecht",
                    "einsatz_person.name",
                    "einsatz_person.notiz",
                    "einsatz_person.vorname",
                    "person_verbleib.notiz",
                    "person_verbleib.transportmittel",
                    "person_verbleib.ziel",
                ]),
            ),
        ]
        .into_iter()
        .collect();
        assert_eq!(ist, soll, "Zuordnung weicht von design.md D1 ab");
    }

    /// Jede einsatzbezogene Tabelle mit FK auf `einsatz_person` steht im Behandlungsbezug
    /// ([`BEHANDLUNGSBEZUG_TABELLEN`]) oder begründet in `KEIN_BEHANDLUNGSBEZUG` (design.md D3,
    /// Risiko „Prädikat erfasst einen Behandlungsbezug nicht“). Eine neue Personentabelle muss
    /// sich damit entscheiden, statt still als „nur registriert“ zu gelten.
    #[tokio::test]
    async fn behandlungsbezug_kennt_jede_personentabelle() {
        const KEIN_BEHANDLUNGSBEZUG: &[(&str, &str)] = &[
            (
                "person_verbleib",
                "Verbleib: Personenstamm, dient beiden Zwecken",
            ),
            (
                "person_abgleich",
                "Vermisst-/Gefunden-Abgleich: Personenauskunft",
            ),
            (
                "person_zugriff_audit",
                "Zugriffsprotokoll, kein Bezug zur Person selbst",
            ),
            (
                "einsatz_schaden",
                "Geschädigte Person eines Sachschadens: Personenauskunft",
            ),
            ("einsatz_tier", "Halter eines Tiers: Personenauskunft"),
            (
                "uhs_platz",
                "Reservierung ohne Belegung ist kein Behandlungsnachweis; eine Belegung steht in \
                 person_uhs_belegung",
            ),
        ];
        let pool = crate::db::test_pool().await;
        let mut ist = BTreeSet::new();
        for t in alle_tabellen(&pool).await {
            let fks: Vec<String> = sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
                "SELECT \"table\" FROM pragma_foreign_key_list('{t}')"
            )))
            .fetch_all(&pool)
            .await
            .unwrap();
            if t != "einsatz_person" && fks.iter().any(|z| z == "einsatz_person") {
                ist.insert(t);
            }
        }
        let soll: BTreeSet<String> = BEHANDLUNGSBEZUG_TABELLEN
            .iter()
            .copied()
            .chain(KEIN_BEHANDLUNGSBEZUG.iter().map(|(t, _)| *t))
            .map(String::from)
            .collect();
        assert_eq!(
            ist, soll,
            "Tabellen mit FK auf einsatz_person: in BEHANDLUNGSBEZUG_TABELLEN oder \
             KEIN_BEHANDLUNGSBEZUG eintragen"
        );
    }

    /// `ZeileLoeschen` gilt (wenn überhaupt) für ALLE Scrub-Spalten einer Tabelle.
    #[test]
    fn zeile_loeschen_ist_kohaerent() {
        for regel in TABELLEN {
            let hat_loeschen = regel.spalten.iter().any(|s| {
                matches!(
                    s.klassifikation,
                    Klassifikation::Scrub(Strategie::ZeileLoeschen, _)
                )
            });
            if hat_loeschen {
                assert!(
                    regel.spalten.iter().all(|s| matches!(
                        s.klassifikation,
                        Klassifikation::Scrub(Strategie::ZeileLoeschen, _)
                    )),
                    "Tabelle {} mischt ZeileLoeschen mit anderen Strategien",
                    regel.tabelle
                );
            }
        }
    }
}
