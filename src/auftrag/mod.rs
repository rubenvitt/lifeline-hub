//! Aufträge/Befehle (LFH-52): Top-down-Strang des Führungsvorgangs
//! (Befehlsgebung → Vollzug → Kontrolle). Quittung liegt pro Empfänger
//! (`auftrag_empfaenger`), Vollzug pro Auftrag über den geteilten
//! Kommunikations-Unterbau (`kommunikation_status`, LFH-84).
pub mod eingabe;
pub mod repo;

pub use eingabe::{validiere_neuen_auftrag, EmpfaengerEingabeReq, NeuerAuftrag, ValidierterAuftrag};

use crate::kommunikation::{AdressatKategorie, Prioritaet, Richtung};
use serde::Serialize;
use utoipa::ToSchema;

/// Priorität eines Auftrags (TEXT in der DB, im Code validiert).
pub const PRIO_SOFORT: &str = "sofort";
pub const PRIO_DRINGEND: &str = "dringend";
pub const PRIO_NORMAL: &str = "normal";

/// Empfänger-Diskriminator (Spiegel des DB-CHECK auf auftrag_empfaenger).
pub const EMPF_ABSCHNITT: &str = "abschnitt";
pub const EMPF_EINHEIT: &str = "einheit";
pub const EMPF_FUNKTION: &str = "funktion";
pub const EMPF_PERSON: &str = "person";
pub const EMPF_FAHRZEUG: &str = "fahrzeug";
/// Externer Adressat (LFH-87): Leitstelle, Nachbar-EA, übergeordnete Führung, andere BOS.
pub const EMPF_EXTERN: &str = "extern";

/// Externe Adressat-Kategorie (code-validiert, kein DB-CHECK).
pub const EXTERN_LEITSTELLE: &str = "leitstelle";
pub const EXTERN_NACHBAR_EA: &str = "nachbar_ea";
pub const EXTERN_UEBERGEORDNET: &str = "uebergeordnet";
pub const EXTERN_ANDERE_BOS: &str = "andere_bos";

/// Bearbeitungsstatus eines Auftrags (Schema-Anker für die OpenAPI-Union, LFH-120).
/// Wire == `bearbeitungsstatus`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AuftragBearbeitungsstatus {
    Offen,
    InArbeit,
    Vollzogen,
    Abgenommen,
}

impl AuftragBearbeitungsstatus {
    /// DB-/API-Stringrepräsentation.
    pub fn as_str(&self) -> &'static str {
        match self {
            AuftragBearbeitungsstatus::Offen => BEARB_OFFEN,
            AuftragBearbeitungsstatus::InArbeit => BEARB_IN_ARBEIT,
            AuftragBearbeitungsstatus::Vollzogen => BEARB_VOLLZOGEN,
            AuftragBearbeitungsstatus::Abgenommen => BEARB_ABGENOMMEN,
        }
    }

    /// Parst einen gespeicherten/übergebenen Bearbeitungsstatus; `None` bei ungültigem Wert.
    pub fn parse(s: &str) -> Option<AuftragBearbeitungsstatus> {
        match s {
            BEARB_OFFEN => Some(AuftragBearbeitungsstatus::Offen),
            BEARB_IN_ARBEIT => Some(AuftragBearbeitungsstatus::InArbeit),
            BEARB_VOLLZOGEN => Some(AuftragBearbeitungsstatus::Vollzogen),
            BEARB_ABGENOMMEN => Some(AuftragBearbeitungsstatus::Abgenommen),
            _ => None,
        }
    }
}

impl TryFrom<String> for AuftragBearbeitungsstatus {
    type Error = String;

    fn try_from(s: String) -> Result<Self, Self::Error> {
        AuftragBearbeitungsstatus::parse(&s).ok_or_else(|| format!("Ungültiger AuftragBearbeitungsstatus: {s}"))
    }
}

/// Empfänger-Diskriminator eines Auftrags (Schema-Anker für die OpenAPI-Union, LFH-120).
/// Wire == `empfaenger_typ`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum EmpfaengerTyp {
    Abschnitt,
    Einheit,
    Funktion,
    Person,
    Fahrzeug,
    Extern,
}

impl EmpfaengerTyp {
    /// DB-/API-Stringrepräsentation.
    pub fn as_str(&self) -> &'static str {
        match self {
            EmpfaengerTyp::Abschnitt => EMPF_ABSCHNITT,
            EmpfaengerTyp::Einheit => EMPF_EINHEIT,
            EmpfaengerTyp::Funktion => EMPF_FUNKTION,
            EmpfaengerTyp::Person => EMPF_PERSON,
            EmpfaengerTyp::Fahrzeug => EMPF_FAHRZEUG,
            EmpfaengerTyp::Extern => EMPF_EXTERN,
        }
    }

    /// Parst einen gespeicherten/übergebenen Empfänger-Typ; `None` bei ungültigem Wert.
    pub fn parse(s: &str) -> Option<EmpfaengerTyp> {
        match s {
            EMPF_ABSCHNITT => Some(EmpfaengerTyp::Abschnitt),
            EMPF_EINHEIT => Some(EmpfaengerTyp::Einheit),
            EMPF_FUNKTION => Some(EmpfaengerTyp::Funktion),
            EMPF_PERSON => Some(EmpfaengerTyp::Person),
            EMPF_FAHRZEUG => Some(EmpfaengerTyp::Fahrzeug),
            EMPF_EXTERN => Some(EmpfaengerTyp::Extern),
            _ => None,
        }
    }
}

// `empfaenger_typ` ist in `AuftragEmpfaengerAnzeige` non-null, aber für einen
// einheitlichen Decode-Mechanismus über beide Enum-Felder dieses GEMISCHTEN DTOs
// (das nullable `extern_kategorie: Option<AdressatKategorie>` daneben) direkt
// `Type`/`Decode` implementieren (statt gemischt mit `#[sqlx(try_from = …)]`) —
// gleiches Muster wie bei `TierAnzeige` (`src/tier/mod.rs`).
impl<DB: sqlx::Database> sqlx::Type<DB> for EmpfaengerTyp
where
    str: sqlx::Type<DB>,
{
    fn type_info() -> DB::TypeInfo {
        <str as sqlx::Type<DB>>::type_info()
    }
}

impl<'r, DB: sqlx::Database> sqlx::Decode<'r, DB> for EmpfaengerTyp
where
    &'r str: sqlx::Decode<'r, DB>,
{
    fn decode(value: <DB as sqlx::Database>::ValueRef<'r>) -> Result<Self, sqlx::error::BoxDynError> {
        let s = <&str as sqlx::Decode<DB>>::decode(value)?;
        EmpfaengerTyp::parse(s).ok_or_else(|| format!("Ungültiger EmpfaengerTyp: {s}").into())
    }
}

pub fn extern_kategorie_gueltig(k: &str) -> bool {
    matches!(k, EXTERN_LEITSTELLE | EXTERN_NACHBAR_EA | EXTERN_UEBERGEORDNET | EXTERN_ANDERE_BOS)
}

/// Effektiver Bearbeitungsstatus (abgeleitet, fürs Frontend).
pub const BEARB_OFFEN: &str = "offen";
pub const BEARB_IN_ARBEIT: &str = "in_arbeit";
pub const BEARB_VOLLZOGEN: &str = "vollzogen";
pub const BEARB_ABGENOMMEN: &str = "abgenommen";

/// Richtungskennzeichnung intern/extern (LFH-87, TEXT in der DB, im Code validiert).
pub const RICHTUNG_INTERN: &str = "intern";
pub const RICHTUNG_EXTERN: &str = "extern";

pub fn prioritaet_gueltig(p: &str) -> bool {
    matches!(p, PRIO_SOFORT | PRIO_DRINGEND | PRIO_NORMAL)
}

pub fn richtung_gueltig(r: &str) -> bool {
    matches!(r, RICHTUNG_INTERN | RICHTUNG_EXTERN)
}

pub fn empfaenger_typ_gueltig(t: &str) -> bool {
    matches!(t, EMPF_ABSCHNITT | EMPF_EINHEIT | EMPF_FUNKTION | EMPF_PERSON | EMPF_FAHRZEUG | EMPF_EXTERN)
}

/// Anzeige eines Auftrags inkl. abgeleiteter Felder und der Vollzugs-Achse aus
/// dem geteilten `kommunikation_status` (per LEFT JOIN). Quittungs-Aggregate
/// (`empfaenger_anzahl`, `quittiert_anzahl`) stammen aus `auftrag_empfaenger`.
#[derive(Debug, Clone, Serialize, sqlx::FromRow, ToSchema)]
pub struct AuftragAnzeige {
    pub id: i64,
    pub einsatz_id: i64,
    /// Laufende Nummer je Einsatz (LFH-133). Nullable, weil per ADD COLUMN eingeführt;
    /// alle ab LFH-133 angelegten Aufträge tragen einen Wert.
    pub lfd_nr: Option<i64>,
    pub auftrag_text: String,
    pub absicht: Option<String>,
    pub lage: Option<String>,
    pub ort: Option<String>,
    pub zeit: Option<String>,
    pub mittel: Option<String>,
    pub verbindung: Option<String>,
    pub sicherheit: Option<String>,
    #[sqlx(try_from = "String")]
    pub prioritaet: Prioritaet,
    /// Richtung intern/extern (LFH-87).
    #[sqlx(try_from = "String")]
    pub richtung: Richtung,
    pub frist_at: Option<String>,
    pub erteilt_at: String,
    pub in_arbeit_at: Option<String>,
    pub vollzugsmeldung: Option<String>,
    pub abgenommen_at: Option<String>,
    pub abgenommen_von_id: Option<i64>,
    pub etb_anordnung_id: Option<i64>,
    /// Quell-ETB-Eintrag, AUS DEM dieser Auftrag erteilt wurde (LFH-112). Klar getrennt
    /// von `etb_anordnung_id` (= der vom Auftrag SELBST erzeugte Anordnungs-Eintrag).
    pub quell_etb_eintrag_id: Option<i64>,
    pub erstellt_von_id: i64,
    pub erstellt_at: String,
    // Vollzugs-Achse aus kommunikation_status (Default 'offen').
    pub vollzug_status: String,
    pub vollzogen_at: Option<String>,
    pub vollzogen_von_id: Option<i64>,
    // Quittungs-Aggregat aus auftrag_empfaenger.
    pub empfaenger_anzahl: i64,
    pub quittiert_anzahl: i64,
    // Abgeleitet: Frist überschritten UND noch nicht alle Empfänger quittiert.
    pub ist_ueberfaellig: bool,
    // Abgeleitet: 'abgenommen' wenn abgenommen_at gesetzt, sonst vollzug_status.
    #[sqlx(try_from = "String")]
    pub bearbeitungsstatus: AuftragBearbeitungsstatus,
}

/// Anzeige einer Empfänger-Zeile inkl. Quittung (Achse 1, pro Empfänger).
#[derive(Debug, Clone, Serialize, sqlx::FromRow, ToSchema)]
pub struct AuftragEmpfaengerAnzeige {
    pub id: i64,
    pub auftrag_id: i64,
    pub empfaenger_typ: EmpfaengerTyp,
    pub abschnitt_id: Option<i64>,
    pub einheit_id: Option<i64>,
    pub person_id: Option<i64>,
    pub fahrzeug_id: Option<i64>,
    pub funktion_text: Option<String>,
    /// Externer Adressat (LFH-87): Kategorie + Bezeichnung (nur bei empfaenger_typ='extern').
    pub extern_kategorie: Option<AdressatKategorie>,
    pub extern_bezeichnung: Option<String>,
    pub snap_anzeige: String,
    pub quittiert_at: Option<String>,
    pub quittiert_von_id: Option<i64>,
}

/// Auftrag + seine Empfänger (Detail-/Anlege-/Mutations-Antwort).
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct AuftragDetail {
    #[serde(flatten)]
    pub auftrag: AuftragAnzeige,
    pub empfaenger: Vec<AuftragEmpfaengerAnzeige>,
}
