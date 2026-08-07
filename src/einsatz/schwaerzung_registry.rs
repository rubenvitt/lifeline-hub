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
const G_CHAT: &str =
    "Chat-Führungskommunikation, RETAIN v1 (Scrub-Follow-up getaggt) — im ETB koppelbar";
const G_ERINNERUNG: &str =
    "Erinnerungs-/Wiedervorlage-Freitext, RETAIN v1 (Scrub-Follow-up getaggt) — operativ";
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
            retain("abgeschlossen_at", G_ZEIT),
            retain("abgeschlossen_von", G_FK),
            retain("einsatzart", G_ENUM),
            retain("einsatznummer_intern", G_ZAEHLER),
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
        // KEIN Kartografie-Skelett. CASCADE räumt chat_nachricht_anhang mit.
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
            scrub("label", Strategie::NullSetzen),
            retain("farbe", G_ENUM),
            scrub("notiz", Strategie::NullSetzen),
            retain("erstellt_von", G_FK),
            retain("erstellt_at", G_ZEIT),
            retain("geaendert_at", G_ZEIT),
            retain("gefahrengebiet_id", G_FK),
            // Ansichts-Zugehörigkeit (LFH-320): FK auf karten_ansicht, kein Personenbezug.
            retain("ansicht_id", G_FK),
        ],
    },
    TabellenRegel {
        tabelle: "gefahrengebiet",
        scoping: Scoping::EinsatzId,
        zeilenfilter: None,
        spalten: &[
            retain("id", G_PK),
            retain("einsatz_id", G_SCOPE),
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
    // (notiz/bemerkung/hinweis/standort/erreichbarkeit/kommunikationsmittel) können
    // Betroffenen-PII enthalten → konservativ NULL + REVIEW-Tag (LFH-229).
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
            retain("sprechgruppe_tmo", G_OP_LABEL),
            retain("sprechgruppe_dmo", G_OP_LABEL),
            // kommunikationsmittel = Kommunikationsart-Schlüssel (digitalfunk/mobil/festnetz),
            // kein Personenbezug (LFH-108, Feld-Autor) → RETAIN.
            retain(
                "kommunikationsmittel",
                "Kommunikationsart-Schlüssel (digitalfunk/mobil/…), kein Personenbezug (LFH-108)",
            ),
            // erreichbarkeit = mögliche Rufnummer der Führung → PII, gescrubbt (LFH-108).
            scrub("erreichbarkeit", Strategie::NullSetzen),
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
            // Kategorie-Schlüssel (RETAIN), erreichbarkeit = mögliche Rufnummer der Führung (Scrub).
            retain(
                "kommunikationsmittel",
                "Kommunikationsart-Schlüssel (digitalfunk/mobil/…), kein Personenbezug (LFH-108)",
            ),
            scrub("erreichbarkeit", Strategie::NullSetzen),
            retain("sortier", G_KONFIG),
            retain("angelegt_at", G_ZEIT),
            retain("angelegt_von", G_FK),
            retain("lat", G_GEO),
            retain("lon", G_GEO),
            retain("tz_fachaufgabe", G_ENUM),
            retain("tz_organisation", G_ENUM),
            retain("aktueller_br_id", G_FK),
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
            retain("zugewiesen_at", G_ZEIT),
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
    // ---------- Chat / Erinnerungen (RETAIN v1, Scrub-Follow-up getaggt) ----------
    TabellenRegel {
        tabelle: "chat_kanal",
        scoping: Scoping::EinsatzId,
        zeilenfilter: None,
        spalten: &[
            retain("id", G_PK),
            retain("einsatz_id", G_SCOPE),
            retain("name", G_CHAT),
            retain("beschreibung", G_CHAT),
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
            retain("inhalt", G_CHAT),
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
        // Junction; CASCADE von anhang/chat_nachricht räumt sie. Kein Scrub nötig.
        tabelle: "chat_nachricht_anhang",
        scoping: Scoping::UeberParent {
            fk: "nachricht_id",
            parent: "chat_nachricht",
        },
        zeilenfilter: None,
        spalten: &[retain("nachricht_id", G_FK), retain("anhang_id", G_FK)],
    },
    TabellenRegel {
        tabelle: "erinnerung",
        scoping: Scoping::EinsatzId,
        zeilenfilter: None,
        spalten: &[
            retain("id", G_PK),
            retain("einsatz_id", G_SCOPE),
            retain("titel", G_ERINNERUNG),
            retain("beschreibung", G_ERINNERUNG),
            retain("faellig_at", G_ZEIT),
            retain("intervall_minuten", G_KONFIG),
            retain("empfaenger_funktion", G_OP_LABEL),
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
        let sql = format!("PRAGMA foreign_key_list('{tabelle}')");
        sqlx::query(sqlx::AssertSqlSafe(sql))
            .fetch_all(pool)
            .await
            .unwrap()
            .iter()
            .map(|r| (r.get::<String, _>("table"), r.get::<String, _>("on_delete")))
            .collect()
    }

    /// Entdeckt die einsatz-scoped Tabellenmenge S dynamisch:
    /// `{einsatz}` ∪ `{Tabellen mit einsatz_id}` ∪ transitive Hülle über
    /// `ON DELETE CASCADE`-FKs ab S. Der benutzer/organisation/personal-Stammdaten-
    /// Teilbaum bleibt außen vor (kein CASCADE-FK, der auf einsatz zeigt).
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
        ] {
            assert!(
                !s.contains(verboten),
                "Stammdaten-Tabelle {verboten:?} wurde als einsatz-scoped entdeckt — \
                 die CASCADE-Hülle würde sie irreversibel schwärzen!"
            );
        }
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
