//! Aufträge/Befehle (LFH-52): Top-down-Strang des Führungsvorgangs
//! (Befehlsgebung → Vollzug → Kontrolle). Quittung liegt pro Empfänger
//! (`auftrag_empfaenger`), Vollzug pro Auftrag über den geteilten
//! Kommunikations-Unterbau (`kommunikation_status`, LFH-84).
pub mod eingabe;
pub mod repo;

pub use eingabe::{
    validiere_neuen_auftrag, EmpfaengerEingabeReq, NeuerAuftrag, ValidierterAuftrag,
};

use crate::kommunikation::{AdressatKategorie, Prioritaet, Richtung};
use crate::wire_enum::wire_enum;
use serde::Serialize;
use utoipa::ToSchema;

/// Priorität eines Auftrags (TEXT in der DB, im Code validiert).
pub const PRIO_SOFORT: &str = Prioritaet::Sofort.as_str();
pub const PRIO_DRINGEND: &str = Prioritaet::Dringend.as_str();
pub const PRIO_NORMAL: &str = Prioritaet::Normal.as_str();

/// Empfänger-Diskriminator (Spiegel des DB-CHECK auf auftrag_empfaenger).
pub const EMPF_ABSCHNITT: &str = EmpfaengerTyp::Abschnitt.as_str();
pub const EMPF_EINHEIT: &str = EmpfaengerTyp::Einheit.as_str();
pub const EMPF_FUNKTION: &str = EmpfaengerTyp::Funktion.as_str();
pub const EMPF_PERSON: &str = EmpfaengerTyp::Person.as_str();
pub const EMPF_FAHRZEUG: &str = EmpfaengerTyp::Fahrzeug.as_str();
/// Externer Adressat (LFH-87): Leitstelle, Nachbar-EA, übergeordnete Führung, andere BOS.
pub const EMPF_EXTERN: &str = EmpfaengerTyp::Extern.as_str();

/// Externe Adressat-Kategorie (code-validiert, kein DB-CHECK).
pub const EXTERN_LEITSTELLE: &str = AdressatKategorie::Leitstelle.as_str();
pub const EXTERN_NACHBAR_EA: &str = AdressatKategorie::NachbarEa.as_str();
pub const EXTERN_UEBERGEORDNET: &str = AdressatKategorie::Uebergeordnet.as_str();
pub const EXTERN_ANDERE_BOS: &str = AdressatKategorie::AndereBos.as_str();

wire_enum! {
    /// Bearbeitungsstatus eines Auftrags (Schema-Anker für die OpenAPI-Union, LFH-120).
    /// Wire == `bearbeitungsstatus`.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum AuftragBearbeitungsstatus {
        Offen => "offen",
        InArbeit => "in_arbeit",
        Vollzogen => "vollzogen",
        Abgenommen => "abgenommen",
    }
    try_from = |s| format!("Ungültiger AuftragBearbeitungsstatus: {s}");
}

impl AuftragBearbeitungsstatus {
    /// Ob der Auftrag noch offen ist, also nicht abgeschlossen (LFH-612, Modulzähler).
    ///
    /// Spiegelt die Phasen des Frontends (`AUFTRAG_STATUS` in `kommunikation/phase.ts`):
    /// `offen`/`in_arbeit` sind nicht abgeschlossen, `vollzogen`/`abgenommen` schon. Ein
    /// vollständiger `match` — ein neuer Status muss hier entschieden werden, statt still
    /// in eine der beiden Mengen zu fallen.
    pub fn ist_offen(&self) -> bool {
        match self {
            AuftragBearbeitungsstatus::Offen | AuftragBearbeitungsstatus::InArbeit => true,
            AuftragBearbeitungsstatus::Vollzogen | AuftragBearbeitungsstatus::Abgenommen => false,
        }
    }
}

wire_enum! {
    /// Empfänger-Diskriminator eines Auftrags (Schema-Anker für die OpenAPI-Union, LFH-120).
    /// Wire == `empfaenger_typ`.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum EmpfaengerTyp {
        Abschnitt => "abschnitt",
        Einheit => "einheit",
        Funktion => "funktion",
        Person => "person",
        Fahrzeug => "fahrzeug",
        Extern => "extern",
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
    fn decode(
        value: <DB as sqlx::Database>::ValueRef<'r>,
    ) -> Result<Self, sqlx::error::BoxDynError> {
        let s = <&str as sqlx::Decode<DB>>::decode(value)?;
        EmpfaengerTyp::parse(s).ok_or_else(|| format!("Ungültiger EmpfaengerTyp: {s}").into())
    }
}

pub fn extern_kategorie_gueltig(k: &str) -> bool {
    AdressatKategorie::parse(k).is_some()
}

/// Effektiver Bearbeitungsstatus (abgeleitet, fürs Frontend).
pub const BEARB_OFFEN: &str = AuftragBearbeitungsstatus::Offen.as_str();
pub const BEARB_IN_ARBEIT: &str = AuftragBearbeitungsstatus::InArbeit.as_str();
pub const BEARB_VOLLZOGEN: &str = AuftragBearbeitungsstatus::Vollzogen.as_str();
pub const BEARB_ABGENOMMEN: &str = AuftragBearbeitungsstatus::Abgenommen.as_str();

/// Richtungskennzeichnung intern/extern (LFH-87, TEXT in der DB, im Code validiert).
pub const RICHTUNG_INTERN: &str = Richtung::Intern.as_str();
pub const RICHTUNG_EXTERN: &str = Richtung::Extern.as_str();

pub fn prioritaet_gueltig(p: &str) -> bool {
    Prioritaet::parse(p).is_some()
}

pub fn richtung_gueltig(r: &str) -> bool {
    Richtung::parse(r).is_some()
}

pub fn empfaenger_typ_gueltig(t: &str) -> bool {
    EmpfaengerTyp::parse(t).is_some()
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
