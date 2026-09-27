//! Zentrale Klassifikations-Registry für die irreversible PII-Schwärzung (F02/LFH-229).
//!
//! Die Schwärzung (`repo::schwaerze_einsatz`, Phase B des Purge-Schedulers) war eine
//! handgepflegte Liste von UPDATE-Statements. Nichts erzwang, dass eine NEUE PII-Spalte
//! aufgenommen wird — reale Lücken (Anhang-BLOBs, Einsatz-Kopf, Lage-Freitexte) blieben
//! stehen. Diese Registry **tötet die Fehlerklasse**:
//!
//! 1. Sie taggt für JEDE Spalte JEDER einsatz-scoped Tabelle eine [`Klassifikation`]
//!    (`Scrub{Strategie}` oder `Retain{Grund}`).
//! 2. Ein Guard-Test (`tests`) entdeckt die einsatz-scoped Tabellenmenge S dynamisch
//!    (`einsatz_id` + transitive `ON DELETE CASCADE`-Hülle ab `einsatz`) und bricht ROT,
//!    sobald eine Spalte/Tabelle **un**klassifiziert ist. Eine neue PII-Spalte kann also
//!    nicht mehr still durchrutschen.
//!
//!    Die Entdeckung trägt eine Vorbedingung, die GUARD 5 (LFH-291) erzwingt: **Jede
//!    FK-Kante nach S kommt aus S oder steht begründet auf der Allowlist**
//!    (`FREMDKANTEN_ALLOWLIST` im `tests`-Modul, startet leer). Ohne sie fiele eine neue
//!    Tabelle ohne `einsatz_id`, die per `ON DELETE SET NULL` oder ohne ON-DELETE-Angabe
//!    auf eine Tabelle in S zeigt, aus der CASCADE-Hülle heraus — GUARD 1 fragte ihre
//!    Spalten nie ab, ihre PII überlebte die Schwärzung still.
//! 3. [`scrubbe_aus_registry`] treibt den tatsächlichen Scrub **data-driven** aus den
//!    `Scrub`-Einträgen → kein Drift zwischen Guard und Scrub möglich (die Statements
//!    entstehen aus denselben compile-time-Konstanten, die der Guard prüft).
//!
//! Tabellen-/Spaltennamen sind ausschließlich compile-time-Registry-Konstanten (nie
//! User-Input) → `sqlx::AssertSqlSafe` ist hier injektionssicher; Werte bleiben `.bind`.

use super::repo::SCHWAERZUNG_PLATZHALTER;

/// Wie eine als PII eingestufte Spalte gescrubbt wird.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Strategie {
    /// `col = NULL` (nullable Spalte).
    NullSetzen,
    /// `col = SCHWAERZUNG_PLATZHALTER` (NOT-NULL-Textspalte, NULL unmöglich).
    Platzhalter,
    /// `col = CASE WHEN col IS NULL THEN NULL ELSE SCHWAERZUNG_PLATZHALTER END`
    /// (nullable, aber ein CHECK erzwingt einen Wert, sobald ein Statusfeld gesetzt ist —
    /// z. B. `einsatz_schaden.uebergeben_an` bei `status='uebergeben'`).
    PlatzhalterWennGesetzt,
    /// `col = SCHWAERZUNG_PLATZHALTER || ' ' || id` — NOT-NULL-Textspalte unter einem
    /// UNIQUE-Index (LFH-639: `evakuierungsbezirk.bezeichnung`, `betreuungsstelle.bezeichnung`,
    /// eindeutig je Einsatz unter den nicht stornierten Zeilen). Ein für alle Zeilen gleicher
    /// Platzhalter verletzte den Index ab der zweiten Zeile, und die ganze Schwärzung bräche
    /// in ihrer Transaktion ab. Die Zeilen-ID ist Struktur (`G_PK`) und trägt keinen
    /// Personenbezug.
    PlatzhalterMitId,
    /// Die ganze Zeile wird gelöscht (`DELETE FROM t WHERE …`). Für Tabellen, deren
    /// Nutzlast selbst PII ist und die kein zu erhaltendes Skelett tragen (`anhang`:
    /// Foto-BLOBs Betroffener). CASCADE räumt abhängige Verknüpfungszeilen mit.
    ZeileLoeschen,
}

/// Klassifikation einer einzelnen Spalte.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Klassifikation {
    /// PII → wird bei der Schwärzung nach [`Strategie`] entfernt.
    Scrub(Strategie),
    /// Bleibt erhalten. Der `&'static str` begründet, WARUM (Struktur, Führungs-Doku,
    /// anonymisiertes Statistik-Skelett …) — Review-Anker.
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

const fn scrub(spalte: &'static str, strategie: Strategie) -> SpaltenRegel {
    SpaltenRegel {
        spalte,
        klassifikation: Klassifikation::Scrub(strategie),
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
// Operatives Struktur-Label (Bezeichnung einer Einheit/eines Abschnitts/Raums/Funkgruppe):
// benennt ein operatives Objekt, keine Person → Teil des operativen Skeletts.
const G_OP_LABEL: &str =
    "Operatives Struktur-Label (Objekt-/Einheiten-/Abschnitts-/Funkgruppen-Bezeichnung, kein Personenbezug)";
const G_OP_SNAP: &str =
    "Disponier-Snapshot von Betriebsmittel-Stammdaten (Fahrzeug/Material/Einheit der eigenen Org, kein Betroffenen-Bezug)";
const G_FUEHRUNG: &str =
    "DV100-Führungsdokumentation; bei Freigabe unveränderlich ins ETB gesnapshottet \
     (Rechtsstand liegt im ETB, hier Arbeitskopie)";
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
// REVIEW: operativer Freitext-Zettel, konservativ gescrubbt (LFH-229) — Begründung im Scrub-Kommentar.

/// Die vollständige Registry aller einsatz-scoped Tabellen (Menge S). Reihenfolge =
/// Ausführungsreihenfolge des Scrubs (Korrektheit ist reihenfolgeunabhängig).
pub const TABELLEN: &[TabellenRegel] = &[
    // ---------- Einsatz-Kopf (dieselbe Zeile, die den Tombstone trägt) ----------
    TabellenRegel {
        tabelle: "einsatz",
        scoping: Scoping::SelbstId,
        zeilenfilter: None,
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
            // SCRUB Einsatz-Kopf: Meldebild + Adresse/GPS + meldende Stelle sind Betroffenen-/
            // Melder-PII. GPS mit-nullen (Adresse nullen aber Fix behalten wäre dieselbe Preisgabe).
            scrub("einsatzort", Strategie::NullSetzen),
            scrub("einsatzort_lat", Strategie::NullSetzen),
            scrub("einsatzort_lon", Strategie::NullSetzen),
            scrub("meldende_stelle", Strategie::NullSetzen),
            scrub("sachverhalt", Strategie::NullSetzen),
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
        spalten: &[
            retain("id", G_PK),
            retain("einsatz_id", G_SCOPE),
            retain("client_id", G_IDEMPOTENZ),
            retain("registrier_nr", G_ZAEHLER),
            retain("status", G_TRIAGE),
            scrub("name", Strategie::NullSetzen),
            scrub("vorname", Strategie::NullSetzen),
            scrub("geschlecht", Strategie::NullSetzen),
            scrub("geburtsdatum", Strategie::NullSetzen),
            scrub("alter_geschaetzt", Strategie::NullSetzen),
            scrub("herkunft_adresse", Strategie::NullSetzen),
            scrub("antreff_ort", Strategie::NullSetzen),
            scrub("melder_kontakt", Strategie::NullSetzen),
            scrub("notiz", Strategie::NullSetzen),
            retain("erfasst_at", G_ZEIT),
            retain("erfasst_von", G_FK),
            retain("geaendert_at", G_ZEIT),
            retain("geaendert_von", G_FK),
            retain("storniert_at", G_ZEIT),
            retain("aktuelle_sichtung", G_TRIAGE),
            retain("aktuelle_sichtung_at", G_ZEIT),
            // Denormalisierter Cache: trägt für Transporte den Klartext „Transport → {Klinik}“ → PII.
            scrub("aktueller_verbleib", Strategie::NullSetzen),
            retain("aktuelle_uhs_id", G_FK),
            retain("aktueller_platz_id", G_FK),
            // LFH-613: Zustand ist ein Gesundheitsdatum (Freitext), die Fundort-Koordinate ein
            // Aufenthaltsort → beide PII. Das Verbleib-Ziel spiegelt person_verbleib.ziel
            // (Klinikname/Adresse) und wird wie dort gescrubbt.
            scrub("zustand", Strategie::NullSetzen),
            scrub("antreff_lat", Strategie::NullSetzen),
            scrub("antreff_lon", Strategie::NullSetzen),
            retain("vermisst_seit", G_ZEIT),
            // Art/Status spiegeln die CHECK-Enums von person_verbleib (dort ebenfalls retain).
            retain("aktuelle_verbleib_art", G_TRIAGE),
            scrub("aktuelles_verbleib_ziel", Strategie::NullSetzen),
            retain("aktueller_verbleib_status", G_TRIAGE),
            // LFH-674: Kennung der Betreuungsstelle, kein Personenbezug (der Name hängt an der
            // Stelle, das Ziel wird oben gescrubbt).
            retain("aktuelle_verbleib_betreuungsstelle_id", G_FK),
        ],
    },
    TabellenRegel {
        tabelle: "person_sichtung",
        scoping: Scoping::EinsatzId,
        zeilenfilter: None,
        spalten: &[
            retain("id", G_PK),
            retain("einsatz_id", G_SCOPE),
            retain("person_id", G_FK),
            retain("kategorie", G_TRIAGE),
            scrub("notiz", Strategie::NullSetzen),
            retain("gesichtet_at", G_ZEIT),
            retain("gesichtet_von", G_FK),
        ],
    },
    TabellenRegel {
        tabelle: "person_verlaufsnotiz",
        scoping: Scoping::EinsatzId,
        zeilenfilter: None,
        spalten: &[
            retain("id", G_PK),
            retain("einsatz_id", G_SCOPE),
            retain("person_id", G_FK),
            // text ist NOT NULL → Platzhalter statt NULL.
            scrub("text", Strategie::Platzhalter),
            retain("erfasst_at", G_ZEIT),
            retain("erfasst_von", G_FK),
        ],
    },
    TabellenRegel {
        tabelle: "person_verbleib",
        scoping: Scoping::EinsatzId,
        zeilenfilter: None,
        spalten: &[
            retain("id", G_PK),
            retain("einsatz_id", G_SCOPE),
            retain("person_id", G_FK),
            retain("art", G_TRIAGE),
            // transportmittel ist Freitext (nullable, "RTW, KTW, …") wie die Schwester-
            // Freitexte ziel/notiz → gescrubbt (LFH-229 Review; G_TRIAGE galt nur für die
            // CHECK-Enum-Kategorien art/status, nicht für Freitext).
            scrub("transportmittel", Strategie::NullSetzen),
            // ziel = Klartext-Verbringungsort (Klinikname/Adresse) → PII.
            scrub("ziel", Strategie::NullSetzen),
            retain("status", G_TRIAGE),
            scrub("notiz", Strategie::NullSetzen),
            retain("zeitpunkt_at", G_ZEIT),
            retain("erfasst_von", G_FK),
            // LFH-674: Kennung der Betreuungsstelle eines Notunterkunft-Verbleibs.
            retain("betreuungsstelle_id", G_FK),
        ],
    },
    TabellenRegel {
        tabelle: "person_uhs_belegung",
        scoping: Scoping::EinsatzId,
        zeilenfilter: None,
        spalten: &[
            retain("id", G_PK),
            retain("einsatz_id", G_SCOPE),
            retain("person_id", G_FK),
            retain("uhs_id", G_FK),
            retain("platz_id", G_FK),
            retain("art", G_TRIAGE),
            scrub("notiz", Strategie::NullSetzen),
            retain("zeitpunkt_at", G_ZEIT),
            retain("erfasst_von", G_FK),
        ],
    },
    TabellenRegel {
        tabelle: "person_abgleich",
        scoping: Scoping::EinsatzId,
        zeilenfilter: None,
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
        spalten: &[
            retain("id", G_PK),
            retain("einsatz_id", G_SCOPE),
            retain("person_id", G_FK),
            retain("benutzer_id", G_FK),
            retain("art", G_AUDIT),
            retain("zugriff_at", G_ZEIT),
        ],
    },
    // ---------- Tiere ----------
    TabellenRegel {
        tabelle: "einsatz_tier",
        scoping: Scoping::EinsatzId,
        zeilenfilter: None,
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
            // Chip-/Tätowierungsnummer = im Haustierregister auf den Halter registrierter,
            // eindeutiger Identifikator → personenverknüpfend.
            scrub("kennzeichnung", Strategie::NullSetzen),
            retain("groesse_gewicht", G_TIER),
            retain("halter_person_id", G_FK),
            scrub("halter_kontakt", Strategie::NullSetzen),
            scrub("antreff_ort", Strategie::NullSetzen),
            scrub("notiz", Strategie::NullSetzen),
            retain("abschluss_grund", G_ENUM),
            scrub("abschluss_ziel", Strategie::NullSetzen),
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
        spalten: &[
            retain("id", G_PK),
            retain("einsatz_id", G_SCOPE),
            retain("registrier_nr", G_ZAEHLER),
            retain("status", G_ENUM),
            retain("typ", G_ENUM),
            retain("ausmass", G_ENUM),
            // Schadensort = faktisch Adresse Betroffener → gescrubbt (Nutzer-Entscheidung LFH-229);
            // NOT NULL → Platzhalter. Die Beschreibung bleibt operative Schadens-Doku (RETAIN).
            scrub("ort", Strategie::Platzhalter),
            // beschreibung ist unstrukturierter Freitext (NOT NULL) und kann dieselbe PII
            // (Name/Adresse/Kontakt Betroffener) tragen wie ort → gescrubbt (LFH-229 Review +
            // Nutzer-Entscheidung); kein Führungs-Doku-Rang.
            scrub("beschreibung", Strategie::Platzhalter),
            retain("geschaedigt_person_id", G_FK),
            scrub("geschaedigt_kontakt", Strategie::NullSetzen),
            retain("geschaedigt_personal_id", G_FK),
            retain("geschaedigt_organisation_id", G_FK),
            // uebergeben_an: CHECK status='uebergeben' ⇒ NOT NULL → Platzhalter nur wenn gesetzt.
            scrub("uebergeben_an", Strategie::PlatzhalterWennGesetzt),
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
        // Nur Ad-hoc-externe sind einsatz-scoped PII. Dispositionen echter Stamm-Kräfte
        // (personal_id gesetzt) sind Stammdaten → unberührt.
        zeilenfilter: Some("personal_id IS NULL"),
        spalten: &[
            retain("id", G_PK),
            retain("einsatz_id", G_SCOPE),
            retain("personal_id", G_FK),
            retain("status_id", G_FK),
            retain("staerke_position", G_ENUM),
            // snap_name ist NOT NULL → Platzhalter.
            scrub("snap_name", Strategie::Platzhalter),
            scrub("snap_funktion", Strategie::NullSetzen),
            scrub("snap_traegerorganisation", Strategie::NullSetzen),
            scrub("bemerkung", Strategie::NullSetzen),
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
        spalten: &[
            retain("id", G_PK),
            retain("einsatz_id", G_SCOPE),
            // Dateiname kann PII tragen (z. B. „Lageplan Familie Müller.png“) → Platzhalter (NOT NULL).
            scrub("name", Strategie::Platzhalter),
            // BLOB bleibt: georeferenziertes Kartografie-Skelett, KEIN Foto Betroffener (≠ anhang).
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
            // Ansichts-Zugehörigkeit (LFH-320): FK auf karten_ansicht, kein Personenbezug.
            retain("ansicht_id", G_FK),
        ],
    },
    TabellenRegel {
        // Kartenansicht (LFH-319): einsatzweit geteilte Karten-Konfiguration. Reine
        // Layout-/Konfig-Daten; einziger Freitext ist der Ansichts-Name.
        tabelle: "karten_ansicht",
        scoping: Scoping::EinsatzId,
        zeilenfilter: None,
        spalten: &[
            retain("id", G_PK),
            retain("einsatz_id", G_SCOPE),
            // Ansichts-Name ist meist thematisch („Standard“, „Verkehr“), kann aber PII
            // tragen → Platzhalter (NOT NULL), konsistent mit karte_hintergrundbild.name.
            scrub("name", Strategie::Platzhalter),
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
            scrub("label", Strategie::NullSetzen),
            retain("erstellt_von", G_FK),
            retain("erstellt_at", G_ZEIT),
            retain("geaendert_at", G_ZEIT),
            // Ansichts-Zugehörigkeit (LFH-320): FK auf karten_ansicht, kein Personenbezug.
            retain("ansicht_id", G_FK),
        ],
    },
    TabellenRegel {
        // Ganze Zeile löschen: `daten` (BLOB NOT NULL) sind Fotos/Dateien Betroffener,
        // KEIN Kartografie-Skelett. CASCADE räumt die Linker chat_nachricht_anhang,
        // einsatz_dokument (s. u.), etb_eintrag_anhang (LFH-117) und
        // einsatz_schaden_anhang (LFH-21, s. u.) mit.
        tabelle: "anhang",
        scoping: Scoping::EinsatzId,
        zeilenfilter: None,
        spalten: &[
            scrub("id", Strategie::ZeileLoeschen),
            scrub("einsatz_id", Strategie::ZeileLoeschen),
            scrub("dateiname", Strategie::ZeileLoeschen),
            scrub("mime", Strategie::ZeileLoeschen),
            scrub("groesse", Strategie::ZeileLoeschen),
            scrub("sha256", Strategie::ZeileLoeschen),
            scrub("daten", Strategie::ZeileLoeschen),
            scrub("hochgeladen_von", Strategie::ZeileLoeschen),
            scrub("erstellt_at", Strategie::ZeileLoeschen),
        ],
    },
    TabellenRegel {
        // LFH-632: ganze Zeile löschen wie `anhang` — der Titel ist Freitext (kann PII tragen,
        // „Foto Familie Müller“), und die Datei, die die Zeile beschreibt, ist ohnehin weg
        // (CASCADE von `anhang`, Entscheidung E9; `anhang` steht deshalb VOR dieser Regel).
        // Der Titel ÜBERLEBT trotzdem im Wortlaut: `dokument::repo` schreibt ihn in die
        // System-ETB-Einträge „Dokument abgelegt: {titel} ({kategorie})“ und „Dokument
        // entfernt: {titel} ({kategorie})“, und `etb_eintrag.inhalt` ist Retain (G_ETB). Das
        // ist die ETB-Politik — rechtsverbindliche Führungsdokumentation wird dort nicht
        // gescrubbt, für diesen Titel so wenig wie für jeden anderen ETB-Freitext. Gepinnt in
        // `einsatz::repo::tests::schwaerzung_loescht_dokument_samt_anhang_und_haelt_den_etb_nachweis`.
        tabelle: "einsatz_dokument",
        scoping: Scoping::EinsatzId,
        zeilenfilter: None,
        spalten: &[
            scrub("id", Strategie::ZeileLoeschen),
            scrub("einsatz_id", Strategie::ZeileLoeschen),
            scrub("anhang_id", Strategie::ZeileLoeschen),
            scrub("kategorie", Strategie::ZeileLoeschen),
            scrub("titel", Strategie::ZeileLoeschen),
            scrub("bezug_abschnitt_id", Strategie::ZeileLoeschen),
            scrub("bezug_einheit_id", Strategie::ZeileLoeschen),
            scrub("bezug_etb_eintrag_id", Strategie::ZeileLoeschen),
            scrub("etb_eintrag_id", Strategie::ZeileLoeschen),
            scrub("abgelegt_von_id", Strategie::ZeileLoeschen),
            scrub("abgelegt_at", Strategie::ZeileLoeschen),
            scrub("geloescht_at", Strategie::ZeileLoeschen),
            scrub("geloescht_von_id", Strategie::ZeileLoeschen),
        ],
    },
    TabellenRegel {
        // LFH-21: ganze Zeile löschen wie `anhang` — die Datei, die die Zeile beschreibt, ist
        // ohnehin weg (CASCADE von `anhang`; `anhang` steht deshalb VOR dieser Regel), und
        // ein Linker ohne Datei trägt nichts, was die Akte bräuchte. Anders als bei
        // `einsatz_dokument` überlebt hier KEIN Freitext: die System-ETB-Einträge nennen nur
        // Registriernummer und Art („Schaden S-003: Foto abgelegt“, `schaden::anhang`), nie den
        // Dateinamen. `etb_eintrag.inhalt` bleibt Retain (G_ETB) und ist damit pseudonym.
        // Gepinnt in
        // `einsatz::repo::tests::schwaerzung_loescht_schaden_anhaenge_und_haelt_den_etb_nachweis`.
        tabelle: "einsatz_schaden_anhang",
        scoping: Scoping::EinsatzId,
        zeilenfilter: None,
        spalten: &[
            scrub("id", Strategie::ZeileLoeschen),
            scrub("einsatz_id", Strategie::ZeileLoeschen),
            scrub("schaden_id", Strategie::ZeileLoeschen),
            scrub("anhang_id", Strategie::ZeileLoeschen),
            scrub("abgelegt_von_id", Strategie::ZeileLoeschen),
            scrub("abgelegt_at", Strategie::ZeileLoeschen),
            scrub("geloescht_at", Strategie::ZeileLoeschen),
            scrub("geloescht_von_id", Strategie::ZeileLoeschen),
        ],
    },
    TabellenRegel {
        // Ganze Zeile löschen (LFH-321): `daten` ist das eingefrorene volle Lagebild inkl.
        // PII (Personal-Marker, Freitext-Labels) — die Nutzlast IST die PII, kein zu
        // erhaltendes Skelett. KEINE ETB-Kopplung → nicht Retain-fähig wie lagebericht/
        // befehl.abschnitte (deren Rechtsstand ins ETB gesnapshottet ist); bezeichnung/notiz
        // sind Freitext-PII und werden mitentfernt.
        tabelle: "lage_snapshot",
        scoping: Scoping::EinsatzId,
        zeilenfilter: None,
        spalten: &[
            scrub("id", Strategie::ZeileLoeschen),
            scrub("einsatz_id", Strategie::ZeileLoeschen),
            scrub("bezeichnung", Strategie::ZeileLoeschen),
            scrub("notiz", Strategie::ZeileLoeschen),
            scrub("stand_at", Strategie::ZeileLoeschen),
            scrub("schema_version", Strategie::ZeileLoeschen),
            scrub("daten", Strategie::ZeileLoeschen),
            scrub("erstellt_von", Strategie::ZeileLoeschen),
            scrub("erstellt_at", Strategie::ZeileLoeschen),
        ],
    },
    // ---------- Lage / Gefahren (Freitext-Labels der „ELW Fam. Müller“-Klasse) ----------
    TabellenRegel {
        tabelle: "lage_zone",
        scoping: Scoping::EinsatzId,
        zeilenfilter: None,
        spalten: &[
            retain("id", G_PK),
            retain("einsatz_id", G_SCOPE),
            retain("typ", G_ENUM),
            retain("geometrie_typ", G_ENUM),
            retain("geometrie", G_GEO),
            // Das Label überlebt im System-ETB-Wortlaut („Gefahrengebiet «…» eingerichtet“,
            // `routes/lage_zone.rs::etb_text`) — ETB-Politik G_ETB, Präzedenz LFH-632/E9
            // (Dokumenttitel). Entscheidung des Auftraggebers zu LFH-283: dokumentieren und
            // pinnen (`tests/gefahr.rs::schwaerzung_nullt_zonen_und_gebietslabel_und_haelt_den_etb_wortlaut`).
            scrub("label", Strategie::NullSetzen),
            retain("farbe", G_ENUM),
            scrub("notiz", Strategie::NullSetzen),
            retain("erstellt_von", G_FK),
            retain("erstellt_at", G_ZEIT),
            retain("geaendert_at", G_ZEIT),
            retain("gefahrengebiet_id", G_FK),
            // Ansichts-Zugehörigkeit (LFH-320): FK auf karten_ansicht, kein Personenbezug.
            retain("ansicht_id", G_FK),
            // LFH-673: Verweis auf den Evakuierungsbezirk — dessen Bezeichnung schwärzt der
            // Block `evakuierungsbezirk`, der Verweis selbst trägt nichts.
            retain("evakuierungsbezirk_id", G_FK),
        ],
    },
    TabellenRegel {
        tabelle: "gefahrengebiet",
        scoping: Scoping::EinsatzId,
        zeilenfilter: None,
        spalten: &[
            retain("id", G_PK),
            retain("einsatz_id", G_SCOPE),
            // Wie `lage_zone.label`: das Gebietslabel steht im System-ETB des
            // Warnstufenwechsels („Gefahr «…» in «Label» …“, `routes/gefahr.rs`) und bleibt
            // dort (G_ETB, Präzedenz LFH-632/E9) — gepinnt im selben Test.
            scrub("label", Strategie::NullSetzen),
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
        spalten: &[
            retain("id", G_PK),
            retain("gefahrengebiet_id", G_FK),
            retain("gefahrentyp", G_ENUM),
            retain("schutzobjekt", G_ENUM),
            retain("warnstufe", G_ENUM),
            // Gefahren-Beschreibung = unstrukturierter Freitext (nullable), kann Betroffenen-
            // PII tragen → gescrubbt (LFH-229 Review + Nutzer-Entscheidung).
            scrub("beschreibung", Strategie::NullSetzen),
            // gemeldet_von ist TEXT (Klartext-Name des Melders) — NICHT der benutzer-FK
            // aktualisiert_von. → NULL.
            scrub("gemeldet_von", Strategie::NullSetzen),
            retain("aktualisiert_von", G_FK),
            retain("erstellt_at", G_ZEIT),
            retain("geaendert_at", G_ZEIT),
        ],
    },
    TabellenRegel {
        tabelle: "lage_meldung",
        scoping: Scoping::EinsatzId,
        zeilenfilter: None,
        spalten: &[
            retain("id", G_PK),
            retain("einsatz_id", G_SCOPE),
            retain("meldung_id", G_FK),
            // text ist NOT NULL → Platzhalter.
            scrub("text", Strategie::Platzhalter),
            retain("lat", G_GEO),
            retain("lon", G_GEO),
            retain("erstellt_von_id", G_FK),
            retain("erstellt_at", G_ZEIT),
        ],
    },
    // ---------- Operative Struktur: Abschnitte / Einheiten / Räume / UHS / Funk ----------
    // Bezeichnungen/Namen operativer Objekte = Skelett (RETAIN). Nullable Freitext-Zettel
    // (notiz/bemerkung/hinweis/standort/erreichbarkeit/abschnittsauftrag) können
    // Betroffenen-PII enthalten → konservativ NULL + REVIEW-Tag (LFH-229). Der Schlüssel
    // `kommunikationsmittel` ist KEIN Freitext und bleibt (RETAIN, siehe unten).
    TabellenRegel {
        tabelle: "einsatzabschnitt",
        scoping: Scoping::EinsatzId,
        zeilenfilter: None,
        spalten: &[
            retain("id", G_PK),
            retain("einsatz_id", G_SCOPE),
            retain("ueber_abschnitt_id", G_FK),
            retain("name", G_OP_LABEL),
            retain("leiter_id", G_FK),
            scrub("bemerkung", Strategie::NullSetzen), // REVIEW: operativer Freitext-Zettel
            retain("sortier", G_KONFIG),
            retain("angelegt_at", G_ZEIT),
            retain("flaeche_geojson", G_GEO),
            retain("tz_fachaufgabe", G_ENUM),
            retain("tz_organisation", G_ENUM),
            // Seit 0073 eingefrorene Alt-Spalten (read-only Reserve, kein Schreibweg mehr):
            // Funkgruppen-Label, identisch mit `sprechgruppe.bezeichnung` (ebenfalls
            // G_OP_LABEL). RETAIN ist die Entscheidung des Auftraggebers zu LFH-140 — sie hier
            // zu nullen und die Bezeichnung im Katalog stehen zu lassen, wäre inkonsistent.
            // Gepinnt in `repo::tests::schwaerzung_nullt_alle_abschnitts_freitexte_und_haelt_die_labels`.
            retain("sprechgruppe_tmo", G_OP_LABEL),
            retain("sprechgruppe_dmo", G_OP_LABEL),
            // kommunikationsmittel = Kommunikationsart-Schlüssel (digitalfunk/mobil/festnetz),
            // kein Personenbezug (LFH-108, Feld-Autor) → RETAIN. Dass nur diese drei Schlüssel
            // hineinkommen, erzwingt seit LFH-140 `routes::support::pruefe_kommunikationsmittel`
            // an POST/PATCH (unbekannt → 400).
            retain(
                "kommunikationsmittel",
                "Kommunikationsart-Schlüssel (digitalfunk/mobil/…), kein Personenbezug (LFH-108)",
            ),
            // erreichbarkeit = mögliche Rufnummer der Führung → PII, gescrubbt (LFH-108).
            scrub("erreichbarkeit", Strategie::NullSetzen),
            // LFH-608: Kürzel, Beurteilung und Einschätzung sind Führungsskelett (RETAIN).
            // Der feste Abschnittsauftrag ist nullabler Freitext wie `bemerkung` — anders
            // als `auftrag.auftrag_text` wird er nicht ins ETB gesnapshottet, und „Evakuierung
            // Uferstraße 3, Familie …" ist genau die Sorte Satz, die hier stehen kann.
            retain("kurzbezeichnung", G_OP_LABEL),
            retain("lagezustand", G_ENUM),
            scrub("abschnittsauftrag", Strategie::NullSetzen), // REVIEW: operativer Freitext
            retain("fortschritt", G_ZAEHLER),
            // LFH-635: Rhythmus-Vorgabe der Ablösung in Minuten.
            retain("abloesung_rhythmus_minuten", G_KONFIG),
        ],
    },
    TabellenRegel {
        tabelle: "einsatz_einheit",
        scoping: Scoping::EinsatzId,
        zeilenfilter: None,
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
            scrub("bemerkung", Strategie::NullSetzen), // REVIEW: operativer Freitext-Zettel
            // Funk-Felder (LFH-108, Migration 0086_einheit_funk): kommunikationsmittel =
            // Kategorie-Schlüssel (RETAIN, Wertemenge per Handler-Precheck erzwungen, LFH-140),
            // erreichbarkeit = mögliche Rufnummer der Führung (Scrub).
            retain(
                "kommunikationsmittel",
                "Kommunikationsart-Schlüssel (digitalfunk/mobil/…), kein Personenbezug (LFH-108)",
            ),
            scrub("erreichbarkeit", Strategie::NullSetzen),
            // LFH-614 (0105): Rufname der Einheit benennt ein operatives Objekt, keine
            // Person — wie fahrzeug.funkrufname/snap_funkrufname.
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
            scrub("bemerkung", Strategie::NullSetzen), // REVIEW: operativer Freitext-Zettel
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
            scrub("bemerkung", Strategie::NullSetzen), // REVIEW: operativer Freitext-Zettel
            retain("disponiert_at", G_ZEIT),
            retain("disponiert_von", G_FK),
            retain("uhs_id", G_FK),
        ],
    },
    TabellenRegel {
        tabelle: "einsatz_mitgliedschaft",
        scoping: Scoping::EinsatzId,
        zeilenfilter: None,
        spalten: &[
            retain("einsatz_id", G_SCOPE),
            retain("benutzer_id", G_FK),
            retain("einsatz_rolle", G_ENUM),
            scrub("fuehrungsstelle", Strategie::NullSetzen),
            retain("zugewiesen_at", G_ZEIT),
        ],
    },
    // LFH-46: Besetzung der Sachgebiete S1–S6. `snap_name`/`bezeichnung` sind PII (Name einer
    // Person bzw. eines Externen) und werden genullt — dieselbe Linie wie
    // `einsatz_mitgliedschaft.fuehrungsstelle` oben. Das Skelett (welches Sachgebiet war WIE
    // besetzt, von wem und wann gesetzt) bleibt als anonymer Führungsnachweis stehen.
    TabellenRegel {
        tabelle: "einsatz_stabsfunktion",
        scoping: Scoping::EinsatzId,
        zeilenfilter: None,
        spalten: &[
            retain("id", G_PK),
            retain("einsatz_id", G_SCOPE),
            retain("sachgebiet", G_ENUM),
            retain("besetzung_art", G_ENUM),
            retain("personal_id", G_FK),
            scrub("snap_name", Strategie::NullSetzen), // REVIEW: Name der disponierten Person
            scrub("bezeichnung", Strategie::NullSetzen), // REVIEW: Name/Stelle extern bzw. rückwärtig
            retain("gesetzt_von_id", G_FK),
            retain("gesetzt_at", G_ZEIT),
        ],
    },
    // LFH-635: Ablösungsschichten. Kein Freitext in der Tabelle (bewusst, design.md D1) —
    // Namen kommen per Join aus `einsatz_einheit`/`einsatzabschnitt` und werden dort
    // klassifiziert. Alles Struktur, Zeit oder Enum → RETAIN.
    TabellenRegel {
        tabelle: "einsatz_abloesung",
        scoping: Scoping::EinsatzId,
        zeilenfilter: None,
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
    // LFH-639: Betreuung. Mengen, keine Personen — Anzahlen, Plangrößen, Kapazitäten,
    // Zustände, Arten und Zeitpunkte bleiben als Statistik-Skelett. Die Bezeichnung trägt oft
    // eine Adresse („Uferstraße 12–40“, „Turnhalle Ost, Ostring 5“) und wird deshalb anders als
    // `uhs.bezeichnung` ersetzt (Spec „Schwärzung“). Sammelstelle, Standort und Notiz sind
    // Freitexte mit möglichem Personen- oder Adressbezug → NULL. Die ETB-Texte nennen nur
    // Bezeichnung und Zahlen (design.md D5), der Scrub hier läuft also nicht ins Leere.
    TabellenRegel {
        tabelle: "evakuierungsbezirk",
        scoping: Scoping::EinsatzId,
        zeilenfilter: None,
        spalten: &[
            retain("id", G_PK),
            retain("einsatz_id", G_SCOPE),
            retain("abschnitt_id", G_FK),
            // NOT NULL unter partiellem UNIQUE-Index → je Zeile eigener Platzhalter.
            scrub("bezeichnung", Strategie::PlatzhalterMitId),
            retain("plan_personen", G_ZAEHLER),
            retain("plan_erhebung", G_ENUM),
            retain("raeumung", G_ENUM),
            scrub("sammelstelle", Strategie::NullSetzen),
            scrub("notiz", Strategie::NullSetzen),
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
        spalten: &[
            retain("id", G_PK),
            retain("bezirk_id", G_FK),
            retain("einsatz_id", G_SCOPE),
            // LFH-675: technische UUID der Offline-Queue, kein Personenbezug.
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
        spalten: &[
            retain("id", G_PK),
            retain("einsatz_id", G_SCOPE),
            retain("abschnitt_id", G_FK),
            // NOT NULL unter partiellem UNIQUE-Index → je Zeile eigener Platzhalter.
            scrub("bezeichnung", Strategie::PlatzhalterMitId),
            retain("art", G_ENUM),
            retain("kapazitaet_personen", G_ZAEHLER),
            retain("status", G_ENUM),
            scrub("standort", Strategie::NullSetzen),
            scrub("notiz", Strategie::NullSetzen),
            // LFH-673: Koordinate auf der Lagekarte — Geo-Skelett wie `uhs.lat/lon`.
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
        spalten: &[
            retain("id", G_PK),
            retain("stelle_id", G_FK),
            retain("einsatz_id", G_SCOPE),
            // LFH-675: technische UUID der Offline-Queue, kein Personenbezug.
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
    // LFH-634: Verpflegung. Mengen, keine Personen — Bedarfe, Mengen, Sonderkost-Anzahlen und
    // Zeitpunkte bleiben als Statistik-Skelett (Spec „Schwärzung“). Die Bezeichnung eines
    // Zeitfensters ist der Mahlzeitname („Mittag“) und bleibt; Ort und Bemerkung einer Ausgabe
    // können eine Adresse oder einen Namen tragen („Hof Familie Meyer“) → NULL. Die ETB-Texte
    // nennen weder Ort noch Bemerkung (design.md D5), der Scrub läuft also nicht ins Leere.
    TabellenRegel {
        tabelle: "verpflegung_zeitfenster",
        scoping: Scoping::EinsatzId,
        zeilenfilter: None,
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
        spalten: &[
            retain("id", G_PK),
            retain("einsatz_id", G_SCOPE),
            retain("zeitfenster_id", G_FK),
            retain("zeitpunkt_at", G_ZEIT),
            retain("menge", G_ZAEHLER),
            scrub("ort", Strategie::NullSetzen),
            scrub("bemerkung", Strategie::NullSetzen),
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
        ],
    },
    // LFH-46: abgeschlossene Lagebesprechungen. `entschluss` bleibt RETAIN (G_FUEHRUNG) —
    // dieselbe Klassifikation wie `lagebericht.abschnitte` und `befehl`, deren Inhalt derselbe
    // Entschluss der Einsatzleitung ist. Ein Alleingang auf Scrub für genau eine der drei
    // Tabellen wäre inkonsistent; käme die Linie „Führungs-Freitexte scrubben", dann für alle
    // drei gemeinsam.
    TabellenRegel {
        tabelle: "einsatz_lagebesprechung",
        scoping: Scoping::EinsatzId,
        zeilenfilter: None,
        spalten: &[
            retain("id", G_PK),
            retain("einsatz_id", G_SCOPE),
            retain("lfd_nr", G_ZAEHLER),
            retain("abgehalten_at", G_ZEIT),
            retain("entschluss", G_FUEHRUNG),
            retain("naechste_at", G_ZEIT),
            retain("etb_eintrag_id", G_FK),
            retain("erfasst_von_id", G_FK),
            retain("erfasst_at", G_ZEIT),
        ],
    },
    // LFH-606: maßgebliche Pegel. Stationsname und Gewässer benennen eine Messstelle der
    // WSV, keine Person — operatives Label. Kein Personenbezug außer dem Benutzer-FK.
    TabellenRegel {
        tabelle: "einsatz_pegel",
        scoping: Scoping::EinsatzId,
        zeilenfilter: None,
        spalten: &[
            retain("id", G_PK),
            retain("einsatz_id", G_SCOPE),
            retain("station_uuid", G_OP_LABEL),
            retain("name", G_OP_LABEL),
            retain("gewaesser", G_OP_LABEL),
            retain("reihenfolge", G_ZAEHLER),
            retain("gesetzt_von_id", G_FK),
            retain("gesetzt_at", G_ZEIT),
            // LFH-628: erwarteter Höchststand — ein Messwert mit Zeitpunkt, kein Personenbezug
            // außer dem Benutzer-FK.
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
        spalten: &[
            retain("einsatz_id", G_SCOPE),
            retain("modul_key", G_ENUM),
            retain("sichtbar", G_KONFIG),
            retain("benoetigte_rolle", G_ENUM),
            retain("geaendert_at", G_ZEIT),
            retain("geaendert_von", G_FK),
        ],
    },
    TabellenRegel {
        tabelle: "bereitstellungsraum",
        scoping: Scoping::EinsatzId,
        zeilenfilter: None,
        spalten: &[
            retain("id", G_PK),
            retain("einsatz_id", G_SCOPE),
            retain("abschnitt_id", G_FK),
            retain("bezeichnung", G_OP_LABEL),
            scrub("standort", Strategie::NullSetzen), // REVIEW: Freitext-Standort (Adresse möglich)
            scrub("notiz", Strategie::NullSetzen),    // REVIEW: operativer Freitext-Zettel
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
        spalten: &[
            retain("id", G_PK),
            retain("einsatz_id", G_SCOPE),
            retain("br_id", G_FK),
            retain("objekt_typ", G_POLY),
            retain("objekt_id", G_POLY),
            retain("art", G_ENUM),
            scrub("notiz", Strategie::NullSetzen), // REVIEW: operativer Freitext-Zettel
            retain("zeitpunkt_at", G_ZEIT),
            retain("erfasst_von", G_FK),
        ],
    },
    TabellenRegel {
        tabelle: "uhs",
        scoping: Scoping::EinsatzId,
        zeilenfilter: None,
        spalten: &[
            retain("id", G_PK),
            retain("einsatz_id", G_SCOPE),
            retain("abschnitt_id", G_FK),
            retain("typ", G_ENUM),
            retain("bezeichnung", G_OP_LABEL),
            scrub("standort", Strategie::NullSetzen), // REVIEW: „Adresse/Hinweis“-Freitext
            scrub("notiz", Strategie::NullSetzen),    // REVIEW: operativer Freitext-Zettel
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
        spalten: &[
            retain("id", G_PK),
            retain("org_id", G_FK),
            retain("einsatz_id", G_SCOPE),
            retain("bezeichnung", G_OP_LABEL),
            retain("betriebsart", G_ENUM),
            scrub("hinweis", Strategie::NullSetzen), // REVIEW: operativer Freitext-Zettel
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
        spalten: &[retain("einheit_id", G_FK), retain("sprechgruppe_id", G_FK)],
    },
    TabellenRegel {
        tabelle: "einsatzabschnitt_sprechgruppe",
        scoping: Scoping::UeberParent {
            fk: "abschnitt_id",
            parent: "einsatzabschnitt",
        },
        zeilenfilter: None,
        spalten: &[
            retain("abschnitt_id", G_FK),
            retain("sprechgruppe_id", G_FK),
        ],
    },
    // ---------- Führungs-Dokumentation (RETAIN — im ETB rechtsverbindlich gesnapshottet) ----------
    TabellenRegel {
        tabelle: "etb_eintrag",
        scoping: Scoping::EinsatzId,
        zeilenfilter: None,
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
            // Funktionskürzel („S2", „EL") aus Sachgebiet/Rolle, keine Person (LFH-615).
            // Bewusst NICHT aus `einsatz_mitgliedschaft.fuehrungsstelle` (Scrub) abgeleitet.
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
        ],
    },
    TabellenRegel {
        tabelle: "meldung",
        scoping: Scoping::EinsatzId,
        zeilenfilter: None,
        spalten: &[
            retain("id", G_PK),
            retain("einsatz_id", G_SCOPE),
            retain("client_id", G_IDEMPOTENZ),
            retain("lfd_nr", G_ZAEHLER),
            retain("absender", G_FUEHRUNG),
            retain("empfaenger", G_FUEHRUNG),
            retain("meldeweg", G_FUEHRUNG),
            retain("inhalt", G_FUEHRUNG),
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
        spalten: &[
            retain("id", G_PK),
            retain("einsatz_id", G_SCOPE),
            retain("auftrag_text", G_FUEHRUNG),
            retain("absicht", G_FUEHRUNG),
            retain("lage", G_FUEHRUNG),
            retain("ort", G_FUEHRUNG),
            retain("zeit", G_FUEHRUNG),
            retain("mittel", G_FUEHRUNG),
            retain("verbindung", G_FUEHRUNG),
            retain("sicherheit", G_FUEHRUNG),
            retain("prioritaet", G_ENUM),
            retain("frist_at", G_ZEIT),
            retain("erteilt_at", G_ZEIT),
            retain("in_arbeit_at", G_ZEIT),
            retain("vollzugsmeldung", G_FUEHRUNG),
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
        spalten: &[
            retain("id", G_PK),
            retain("auftrag_id", G_FK),
            retain("empfaenger_typ", G_ENUM),
            retain("abschnitt_id", G_FK),
            retain("einheit_id", G_FK),
            retain("person_id", G_FK),
            retain("fahrzeug_id", G_FK),
            retain("funktion_text", G_FUEHRUNG),
            retain("extern_kategorie", G_ENUM),
            // REVIEW: externer Empfänger-Klartext (Auftrags-Adressierung, Führungs-Doku;
            // kann externen Namen tragen) — im ETB gesnapshottet.
            retain(
                "extern_bezeichnung",
                "Auftrags-Empfänger-Klartext (Führungs-Doku) — REVIEW LFH-229",
            ),
            retain(
                "snap_anzeige",
                "Auftrags-Empfänger-Snapshot (Führungs-Doku) — REVIEW LFH-229",
            ),
            retain("quittiert_at", G_ZEIT),
            retain("quittiert_von_id", G_FK),
        ],
    },
    TabellenRegel {
        tabelle: "lagebericht",
        scoping: Scoping::EinsatzId,
        zeilenfilter: None,
        spalten: &[
            retain("id", G_PK),
            retain("einsatz_id", G_SCOPE),
            retain("vorlage", G_ENUM),
            retain("titel", G_FUEHRUNG),
            retain("zeitstand", G_FUEHRUNG),
            retain("status", G_ENUM),
            retain("abschnitte", G_FUEHRUNG),
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
        spalten: &[
            retain("id", G_PK),
            retain("einsatz_id", G_SCOPE),
            retain("vorlage", G_ENUM),
            retain("titel", G_FUEHRUNG),
            retain("zeitstand", G_FUEHRUNG),
            retain("status", G_ENUM),
            retain("abschnitte", G_FUEHRUNG),
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
        tabelle: "nachforderung",
        scoping: Scoping::EinsatzId,
        zeilenfilter: None,
        spalten: &[
            retain("id", G_PK),
            retain("einsatz_id", G_SCOPE),
            retain("art", G_ENUM),
            retain("bezeichnung", G_FUEHRUNG),
            retain("anzahl", G_ZAEHLER),
            retain("adressat_kategorie", G_ENUM),
            retain("adressat_bezeichnung", G_FUEHRUNG),
            retain("begruendung", G_FUEHRUNG),
            retain("prioritaet", G_ENUM),
            retain("status", G_ENUM),
            retain("zugesagt_at", G_ZEIT),
            retain("unterwegs_at", G_ZEIT),
            retain("eingetroffen_at", G_ZEIT),
            retain("abgelehnt_at", G_ZEIT),
            retain("abgelehnt_grund", G_FUEHRUNG),
            retain("angefordert_at", G_ZEIT),
            retain("etb_nachforderung_id", G_FK),
            retain("erstellt_von_id", G_FK),
            retain("erstellt_at", G_ZEIT),
        ],
    },
    // ---------- Chat / Erinnerungen (Freitexte gescrubbt, LFH-290) ----------
    // Chat- und Erinnerungs-Freitexte tragen Personenbezug („Fam. Müller, Tel. …“) und
    // werden entfernt — auch in soft-gelöschten Nachrichten (`geloescht_at` ist nur ein
    // Tombstone, der Inhalt blieb stehen). Heraufgestufte Nachrichten liegen als KOPIE in
    // `etb_eintrag.inhalt` (G_ETB) bzw. `auftrag.auftrag_text` (G_FUEHRUNG) und bleiben
    // dort als Führungsdokumentation stehen (ETB-Politik, Präzedenz LFH-632/E9).
    TabellenRegel {
        tabelle: "chat_kanal",
        scoping: Scoping::EinsatzId,
        zeilenfilter: None,
        spalten: &[
            retain("id", G_PK),
            retain("einsatz_id", G_SCOPE),
            scrub("name", Strategie::Platzhalter), // NOT NULL
            scrub("beschreibung", Strategie::NullSetzen),
            retain("erstellt_von_id", G_FK),
            retain("erstellt_at", G_ZEIT),
            retain("archiviert_at", G_ZEIT),
        ],
    },
    TabellenRegel {
        tabelle: "chat_nachricht",
        scoping: Scoping::EinsatzId,
        zeilenfilter: None,
        spalten: &[
            retain("id", G_PK),
            retain("einsatz_id", G_SCOPE),
            retain("kanal_id", G_FK),
            retain("autor_id", G_FK),
            scrub("inhalt", Strategie::Platzhalter), // NOT NULL
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
        // Junction; CASCADE von anhang/chat_nachricht räumt sie. Kein Scrub nötig: `anhang`
        // ist ZeileLoeschen, die Verknüpfung geht per CASCADE mit (belegt in
        // `repo::tests::schwaerzung_entfernt_chat_und_erinnerungs_freitexte`).
        tabelle: "chat_nachricht_anhang",
        scoping: Scoping::UeberParent {
            fk: "nachricht_id",
            parent: "chat_nachricht",
        },
        zeilenfilter: None,
        spalten: &[retain("nachricht_id", G_FK), retain("anhang_id", G_FK)],
    },
    TabellenRegel {
        // LFH-117: Junction (dritter Linker auf `anhang`); CASCADE von anhang/etb_eintrag
        // räumt sie. Kein Scrub nötig: `anhang` ist ZeileLoeschen, die Verknüpfung geht per
        // CASCADE mit, der Eintrag selbst bleibt (G_ETB). Der Dateiname steht in keinem
        // ETB-Text — die Erfassung schreibt ihn nicht in `inhalt`. Belegt in
        // `einsatz::repo::tests::schwaerzung_loescht_etb_anhang_und_haelt_den_eintrag`.
        tabelle: "etb_eintrag_anhang",
        scoping: Scoping::UeberParent {
            fk: "eintrag_id",
            parent: "etb_eintrag",
        },
        zeilenfilter: None,
        spalten: &[retain("eintrag_id", G_FK), retain("anhang_id", G_FK)],
    },
    TabellenRegel {
        tabelle: "erinnerung",
        scoping: Scoping::EinsatzId,
        zeilenfilter: None,
        spalten: &[
            retain("id", G_PK),
            retain("einsatz_id", G_SCOPE),
            scrub("titel", Strategie::Platzhalter), // NOT NULL
            scrub("beschreibung", Strategie::NullSetzen),
            retain("faellig_at", G_ZEIT),
            retain("intervall_minuten", G_KONFIG),
            // Freitext-Empfänger (migrations/0044: „noch kein FK“), kann einen Personennamen
            // tragen („Herr Müller“) — kein reines Funktionslabel (LFH-290).
            scrub("empfaenger_funktion", Strategie::NullSetzen),
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
    // ETB-Lesemarke (LFH-611): wer bis wohin gesichtet hat — Struktur, kein Inhalt.
    TabellenRegel {
        tabelle: "etb_lesemarke",
        scoping: Scoping::EinsatzId,
        zeilenfilter: None,
        spalten: &[
            retain("einsatz_id", G_SCOPE),
            retain("benutzer_id", G_FK),
            retain("gesichtet_lfd_nr", G_ZAEHLER),
            retain("gesichtet_at", G_ZEIT),
        ],
    },
    // ---------- Demo-Daten (LFH-690, design.md D4) ----------
    // Der Kopf wird über die Spalte `einsatz_id` entdeckt, obwohl sie bewusst KEIN FK ist:
    // `entdecke_einsatz_scoped` prüft den Spaltennamen, nicht den Fremdschlüssel. Kein Scrub —
    // der Kopf trägt Struktur, Zeitstempel und einen Mengenbericht, keinen Personenbezug.
    TabellenRegel {
        tabelle: "demo_import",
        scoping: Scoping::EinsatzId,
        zeilenfilter: None,
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
    // Die Marke kommt über die CASCADE-Hülle mit (`import_id` → `demo_import`), nicht über
    // einen Einsatzbezug: sie zeigt auf Stammdaten der Org, nie auf Einsatzzeilen.
    TabellenRegel {
        tabelle: "demo_herkunft",
        scoping: Scoping::UeberParent {
            fk: "import_id",
            parent: "demo_import",
        },
        zeilenfilter: None,
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
fn where_klausel(regel: &TabellenRegel) -> String {
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

/// Treibt den PII-Scrub **data-driven** aus [`TABELLEN`]: pro Tabelle mit `Scrub`-Spalten
/// genau ein `UPDATE` (bzw. `DELETE` bei `ZeileLoeschen`). Läuft auf der übergebenen
/// (Transaktions-)Verbindung des Aufrufers, damit der gesamte Scrub atomar bleibt.
///
/// Tabellen-/Spaltennamen stammen ausschließlich aus den compile-time-Registry-Konstanten
/// (nie User-Input) → `AssertSqlSafe` ist injektionssicher; der Platzhalter-Wert und die
/// `einsatz_id` werden regulär gebunden.
pub async fn scrubbe_aus_registry(
    conn: &mut sqlx::SqliteConnection,
    einsatz_id: i64,
) -> Result<(), sqlx::Error> {
    for regel in TABELLEN {
        let scrubs: Vec<(&'static str, Strategie)> = regel
            .spalten
            .iter()
            .filter_map(|s| match s.klassifikation {
                Klassifikation::Scrub(strategie) => Some((s.spalte, strategie)),
                Klassifikation::Retain(_) => None,
            })
            .collect();
        if scrubs.is_empty() {
            continue;
        }

        let where_teil = where_klausel(regel);

        // ZeileLoeschen: ganze Zeile weg. Muss (Kohärenz) für alle Scrub-Spalten der
        // Tabelle gelten — sonst mischt die Registry Zeilenlöschung mit Spalten-Scrub.
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

        // UPDATE: SET-Zuweisungen in Spaltenreihenfolge; Platzhalter-Strategien binden
        // SCHWAERZUNG_PLATZHALTER (in genau dieser Reihenfolge VOR der einsatz_id).
        let mut sets: Vec<String> = Vec::with_capacity(scrubs.len());
        let mut platzhalter_binds = 0usize;
        for (spalte, strategie) in &scrubs {
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
                Strategie::ZeileLoeschen => unreachable!("oben abgefangen"),
            }
        }
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

    /// Entdeckt die einsatz-scoped Tabellenmenge S dynamisch:
    /// `{einsatz}` ∪ `{Tabellen mit einsatz_id}` ∪ transitive Hülle über
    /// `ON DELETE CASCADE`-FKs ab S. Der benutzer/organisation/personal-Stammdaten-
    /// Teilbaum bleibt außen vor (kein CASCADE-FK, der auf einsatz zeigt).
    ///
    /// Die Hülle folgt NUR `CASCADE`. Dass sie damit nichts verliert, ist eine
    /// Vorbedingung, die GUARD 5 (`guard5_keine_fk_kante_von_aussen_nach_s`, LFH-291)
    /// erzwingt: jede FK-Kante nach S kommt aus S oder steht begründet auf
    /// `FREMDKANTEN_ALLOWLIST` — unabhängig von ihrem `on_delete`.
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
    /// Eine neue PII-Spalte/-Tabelle bricht diesen Test ROT → Fehlerklasse getötet.
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

    /// GUARD 2: kein Registry-Eintrag zeigt auf eine Spalte/Tabelle, die es nicht (mehr)
    /// gibt (keine toten Einträge → data-driven Scrub kann kein NO-SUCH-COLUMN werfen).
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

    /// GUARD 4 (advisor must-do): der Stammdaten-/Katalog-Teilbaum darf NIEMALS in S
    /// landen (sonst irreversibler Falsch-Scrub). Belegt die CASCADE-Ausschluss-Annahme.
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
            // Logo der Organisation (LFH-22, design.md D8): hängt an der Org, nicht am
            // Einsatz. Ein späterer FK/CASCADE Richtung Einsatz zöge es still in die
            // Schwärzung — dieser Eintrag macht das rot.
            "org_logo",
        ] {
            assert!(
                !s.contains(verboten),
                "Stammdaten-Tabelle {verboten:?} wurde als einsatz-scoped entdeckt — \
                 die CASCADE-Hülle würde sie irreversibel schwärzen!"
            );
        }
    }

    // ---------- GUARD 5 (LFH-291): FK-Kanten von außerhalb S nach S ----------

    /// Begründete Ausnahmen zu GUARD 5, Format `(tabelle, spalte, grund)`: einzelne
    /// FK-Kanten aus Tabellen AUSSERHALB von S nach S, die legitim sind, weil die Zeilen
    /// nicht einsatz-eigen sind und deshalb NICHT geschwärzt werden (z. B. eine
    /// Stammdaten-Tabelle mit `REFERENCES einsatz ON DELETE SET NULL`). Je KANTE, nicht je
    /// Tabelle: eine später ergänzte zweite Kante derselben Tabelle nach S muss eigens
    /// begründet werden. Der Grund ist Pflicht (`guard5_allowlist_hat_keine_toten_eintraege`).
    ///
    /// Was GUARD 5 nicht sieht: Verweise ohne deklarierten FK (polymorphe
    /// `objekt_typ`/`objekt_id`) und die per `_fts` ausgeschlossenen Tabellen. Die Liste startet LEER, weil der Bestand
    /// keine einzige solche Kante hat (gemessen über alle Migrationen). Ein Eintrag ohne
    /// Querkante gilt selbst als Verstoß (`guard5_allowlist_hat_keine_toten_eintraege`),
    /// sonst veraltet die Liste still.
    const FREMDKANTEN_ALLOWLIST: &[(&str, &str, &str)] = &[];

    /// Eine FK-Kante aus einer Tabelle außerhalb von S auf eine Tabelle in S.
    #[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
    struct FremdKante {
        tabelle: String,
        spalte: String,
        parent: String,
        on_delete: String,
    }

    /// Befund für GUARD 5 (reine Funktion über das Schema): jede FK-Kante aus einer
    /// Tabelle AUSSERHALB von `s` auf eine Tabelle IN `s` — unabhängig von `on_delete`
    /// (`SET NULL`, `NO ACTION`, `RESTRICT`, …), abzüglich der Kanten auf `allowlist`.
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

    /// Allowlist-Einträge, deren `(tabelle, spalte)` im UNGEFILTERTEN Befund keine
    /// Querkante hat (tot).
    /// Gegen den ungefilterten Befund, sonst sähe jeder wirksame Eintrag tot aus.
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

    /// GUARD 5 (LFH-291): Die Menge S entsteht über `einsatz_id` und die
    /// `ON DELETE CASCADE`-Hülle. Eine NEUE Tabelle ohne `einsatz_id`, die per `SET NULL`
    /// oder ohne ON-DELETE-Angabe auf eine Tabelle in S zeigt, fiele aus S heraus — GUARD 1
    /// fragte ihre Spalten nie ab, ihre PII überlebte die Schwärzung still. Deshalb muss
    /// JEDE FK-Kante nach S aus S kommen oder begründet auf der Allowlist stehen.
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

    /// Beschränkt einen Befund auf die Sondentabellen: die synthetischen Tests sollen auch
    /// dann grün bleiben, wenn das echte Schema eine begründete Querkante bekommt — die
    /// Leerheit des echten Schemas prüft `guard5_keine_fk_kante_von_aussen_nach_s`.
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
            // Kontrolle 2: CASCADE-FK nach S — die Hülle nimmt die Tabelle in S auf, sie
            //     ist damit kein Fremder mehr.
            "CREATE TABLE lfh291_sonde_cascade (
                 id INTEGER PRIMARY KEY,
                 person_id INTEGER NOT NULL REFERENCES einsatz_person(id) ON DELETE CASCADE
             )",
        ] {
            sqlx::query(ddl).execute(pool).await.unwrap();
        }
    }

    /// AK LFH-291: SET NULL auf einen Parent ohne einsatz_id und ein FK ohne ON-DELETE-
    /// Angabe werden beide gemeldet; FKs nach außen und CASCADE-Kinder nicht.
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

    /// Die Allowlist filtert je KANTE, nicht je Tabelle: eine später ergänzte zweite
    /// Kante derselben Tabelle nach S bleibt sichtbar. Ein Eintrag ohne passende
    /// Querkante (fremde Tabelle oder falsche Spalte) ist tot.
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

    /// Kohärenz: `ZeileLoeschen` gilt (wenn überhaupt) für ALLE Spalten der Tabelle —
    /// sonst mischt der Generator Zeilenlöschung mit Spalten-Scrub.
    #[test]
    fn zeile_loeschen_ist_kohaerent() {
        for regel in TABELLEN {
            let hat_loeschen = regel.spalten.iter().any(|s| {
                matches!(
                    s.klassifikation,
                    Klassifikation::Scrub(Strategie::ZeileLoeschen)
                )
            });
            if hat_loeschen {
                assert!(
                    regel.spalten.iter().all(|s| matches!(
                        s.klassifikation,
                        Klassifikation::Scrub(Strategie::ZeileLoeschen)
                    )),
                    "Tabelle {} mischt ZeileLoeschen mit anderen Strategien",
                    regel.tabelle
                );
            }
        }
    }
}
