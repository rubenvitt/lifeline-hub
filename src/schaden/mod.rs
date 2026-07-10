pub mod repo;

use serde::Serialize;
use utoipa::ToSchema;

// ---------- Status ----------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum SchadenStatus {
    Offen,
    Uebergeben,
    Abgeschlossen,
}

impl SchadenStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            SchadenStatus::Offen => "offen",
            SchadenStatus::Uebergeben => "uebergeben",
            SchadenStatus::Abgeschlossen => "abgeschlossen",
        }
    }

    pub fn parse(s: &str) -> Option<SchadenStatus> {
        match s {
            "offen" => Some(SchadenStatus::Offen),
            "uebergeben" => Some(SchadenStatus::Uebergeben),
            "abgeschlossen" => Some(SchadenStatus::Abgeschlossen),
            _ => None,
        }
    }
}

// `status` ist in `SchadenAnzeige` non-null, aber für einen einheitlichen Decode-
// Mechanismus über alle vier Schaden-Enums (statt gemischt `Type`/`Decode` +
// `#[sqlx(try_from = "String")]`) direkt `Type`/`Decode` auf dem Enum
// implementieren — gleiches Muster wie bei den nullable Feldern unten (vgl.
// `TierStatus` in `src/tier/mod.rs`). sqlx' Blanket-Impl für `Option<T>` deckt
// Nullability von `abschluss_grund` transparent ab.
impl<DB: sqlx::Database> sqlx::Type<DB> for SchadenStatus
where
    str: sqlx::Type<DB>,
{
    fn type_info() -> DB::TypeInfo {
        <str as sqlx::Type<DB>>::type_info()
    }
}

impl<'r, DB: sqlx::Database> sqlx::Decode<'r, DB> for SchadenStatus
where
    &'r str: sqlx::Decode<'r, DB>,
{
    fn decode(value: <DB as sqlx::Database>::ValueRef<'r>) -> Result<Self, sqlx::error::BoxDynError> {
        let s = <&str as sqlx::Decode<DB>>::decode(value)?;
        SchadenStatus::parse(s).ok_or_else(|| format!("Ungültiger SchadenStatus: {s}").into())
    }
}

// ---------- Typ ----------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum SchadenTyp {
    Sachschaden,
    Verkehrshindernis,
    Infrastruktur,
    Umweltschaden,
    Tierkadaver,
    Sonstige,
}

impl SchadenTyp {
    pub fn as_str(&self) -> &'static str {
        match self {
            SchadenTyp::Sachschaden => "sachschaden",
            SchadenTyp::Verkehrshindernis => "verkehrshindernis",
            SchadenTyp::Infrastruktur => "infrastruktur",
            SchadenTyp::Umweltschaden => "umweltschaden",
            SchadenTyp::Tierkadaver => "tierkadaver",
            SchadenTyp::Sonstige => "sonstige",
        }
    }

    pub fn parse(s: &str) -> Option<SchadenTyp> {
        match s {
            "sachschaden" => Some(SchadenTyp::Sachschaden),
            "verkehrshindernis" => Some(SchadenTyp::Verkehrshindernis),
            "infrastruktur" => Some(SchadenTyp::Infrastruktur),
            "umweltschaden" => Some(SchadenTyp::Umweltschaden),
            "tierkadaver" => Some(SchadenTyp::Tierkadaver),
            "sonstige" => Some(SchadenTyp::Sonstige),
            _ => None,
        }
    }
}

// `typ` ist in `SchadenAnzeige` non-null — gleiches einheitliches `Type`/`Decode`-
// Muster wie `SchadenStatus` (s. o.).
impl<DB: sqlx::Database> sqlx::Type<DB> for SchadenTyp
where
    str: sqlx::Type<DB>,
{
    fn type_info() -> DB::TypeInfo {
        <str as sqlx::Type<DB>>::type_info()
    }
}

impl<'r, DB: sqlx::Database> sqlx::Decode<'r, DB> for SchadenTyp
where
    &'r str: sqlx::Decode<'r, DB>,
{
    fn decode(value: <DB as sqlx::Database>::ValueRef<'r>) -> Result<Self, sqlx::error::BoxDynError> {
        let s = <&str as sqlx::Decode<DB>>::decode(value)?;
        SchadenTyp::parse(s).ok_or_else(|| format!("Ungültiger SchadenTyp: {s}").into())
    }
}

// ---------- Ausmaß ----------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum Ausmass {
    Gering,
    Mittel,
    Gross,
    Katastrophal,
}

impl Ausmass {
    pub fn as_str(&self) -> &'static str {
        match self {
            Ausmass::Gering => "gering",
            Ausmass::Mittel => "mittel",
            Ausmass::Gross => "gross",
            Ausmass::Katastrophal => "katastrophal",
        }
    }

    pub fn parse(s: &str) -> Option<Ausmass> {
        match s {
            "gering" => Some(Ausmass::Gering),
            "mittel" => Some(Ausmass::Mittel),
            "gross" => Some(Ausmass::Gross),
            "katastrophal" => Some(Ausmass::Katastrophal),
            _ => None,
        }
    }
}

// `ausmass` ist in `SchadenAnzeige` non-null — gleiches einheitliches `Type`/
// `Decode`-Muster wie `SchadenStatus` (s. o.).
impl<DB: sqlx::Database> sqlx::Type<DB> for Ausmass
where
    str: sqlx::Type<DB>,
{
    fn type_info() -> DB::TypeInfo {
        <str as sqlx::Type<DB>>::type_info()
    }
}

impl<'r, DB: sqlx::Database> sqlx::Decode<'r, DB> for Ausmass
where
    &'r str: sqlx::Decode<'r, DB>,
{
    fn decode(value: <DB as sqlx::Database>::ValueRef<'r>) -> Result<Self, sqlx::error::BoxDynError> {
        let s = <&str as sqlx::Decode<DB>>::decode(value)?;
        Ausmass::parse(s).ok_or_else(|| format!("Ungültiges Ausmaß: {s}").into())
    }
}

// ---------- Abschlussgrund ----------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[schema(as = SchadenAbschlussGrund)]
#[serde(rename_all = "snake_case")]
pub enum AbschlussGrund {
    Behoben,
    KeinHandlungsbedarf,
    Abgewiesen,
}

impl AbschlussGrund {
    pub fn as_str(&self) -> &'static str {
        match self {
            AbschlussGrund::Behoben => "behoben",
            AbschlussGrund::KeinHandlungsbedarf => "kein_handlungsbedarf",
            AbschlussGrund::Abgewiesen => "abgewiesen",
        }
    }

    pub fn parse(s: &str) -> Option<AbschlussGrund> {
        match s {
            "behoben" => Some(AbschlussGrund::Behoben),
            "kein_handlungsbedarf" => Some(AbschlussGrund::KeinHandlungsbedarf),
            "abgewiesen" => Some(AbschlussGrund::Abgewiesen),
            _ => None,
        }
    }
}

// Nullable Spalte (`abschluss_grund`) — gleiches Muster wie bei `SchadenStatus`
// (s. o.): `Type`/`Decode` direkt auf dem Enum, statt `#[sqlx(try_from = …)]`
// (Orphan-Rule auf `Option<Enum>`).
impl<DB: sqlx::Database> sqlx::Type<DB> for AbschlussGrund
where
    str: sqlx::Type<DB>,
{
    fn type_info() -> DB::TypeInfo {
        <str as sqlx::Type<DB>>::type_info()
    }
}

impl<'r, DB: sqlx::Database> sqlx::Decode<'r, DB> for AbschlussGrund
where
    &'r str: sqlx::Decode<'r, DB>,
{
    fn decode(value: <DB as sqlx::Database>::ValueRef<'r>) -> Result<Self, sqlx::error::BoxDynError> {
        let s = <&str as sqlx::Decode<DB>>::decode(value)?;
        AbschlussGrund::parse(s).ok_or_else(|| format!("Ungültiger Abschlussgrund: {s}").into())
    }
}

// ---------- Status-Übergänge ----------

/// Erlaubte Status-Übergänge der Schaden-Maschine. Keine Rückwärts-Übergänge,
/// `abgeschlossen` ist terminal. Fehleingaben werden storniert, nicht zurückgerollt.
pub fn darf_uebergehen(von: &str, nach: &str) -> bool {
    use SchadenStatus::*;
    let (Some(von), Some(nach)) = (SchadenStatus::parse(von), SchadenStatus::parse(nach)) else {
        return false;
    };
    if von == nach {
        return false;
    }
    match von {
        Offen => matches!(nach, Uebergeben | Abgeschlossen),
        Uebergeben => matches!(nach, Abgeschlossen),
        Abgeschlossen => false,
    }
}

/// Anzeige der Registriernummer: `S-007`.
pub fn registrier_anzeige(nr: i64) -> String {
    format!("S-{nr:03}")
}

/// Ort-Kurzform für die pseudonyme ETB-Spur (max. 40 Zeichen, char-sicher).
pub fn ort_kurz(ort: &str) -> String {
    let mut kurz: String = ort.trim().chars().take(40).collect();
    if ort.trim().chars().count() > 40 {
        kurz.push('…');
    }
    kurz
}

// ---------- Anzeige-DTO ----------

#[derive(Debug, Clone, Serialize, sqlx::FromRow, ToSchema)]
pub struct SchadenAnzeige {
    pub id: i64,
    pub einsatz_id: i64,
    pub registrier_nr: i64,
    pub status: SchadenStatus,
    pub typ: SchadenTyp,
    pub ausmass: Ausmass,
    pub ort: String,
    pub lat: Option<f64>,
    pub lon: Option<f64>,
    pub beschreibung: String,
    pub geschaedigt_person_id: Option<i64>,
    pub geschaedigt_kontakt: Option<String>,
    pub geschaedigt_personal_id: Option<i64>,
    pub geschaedigt_organisation_id: Option<i64>,
    pub uebergeben_an: Option<String>,
    pub uebergeben_at: Option<String>,
    pub abschluss_grund: Option<AbschlussGrund>,
    pub abschluss_at: Option<String>,
    pub erfasst_at: String,
    pub erfasst_von: i64,
    pub geaendert_at: String,
    pub geaendert_von: i64,
    pub storniert_at: Option<String>,
    pub storniert_von: Option<i64>,
    // Read-only Join-Felder (Geschädigt-Auflösung über einsatz_person):
    pub geschaedigt_registrier_nr: Option<i64>,
    pub geschaedigt_storniert_at: Option<String>,
    // Read-only Join-Felder (Geschädigt-Auflösung über einsatz_personal / organisation):
    pub geschaedigt_personal_name: Option<String>,      // einsatz_personal.snap_name
    pub geschaedigt_organisation_name: Option<String>,  // organisation.name
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_roundtrip() {
        for s in ["offen", "uebergeben", "abgeschlossen"] {
            assert_eq!(SchadenStatus::parse(s).unwrap().as_str(), s);
        }
        assert!(SchadenStatus::parse("quatsch").is_none());
    }

    #[test]
    fn typ_und_ausmass_roundtrip() {
        for s in ["sachschaden", "verkehrshindernis", "infrastruktur", "umweltschaden", "tierkadaver", "sonstige"] {
            assert_eq!(SchadenTyp::parse(s).unwrap().as_str(), s);
        }
        for s in ["gering", "mittel", "gross", "katastrophal"] {
            assert_eq!(Ausmass::parse(s).unwrap().as_str(), s);
        }
    }

    #[test]
    fn abschlussgrund_roundtrip() {
        for s in ["behoben", "kein_handlungsbedarf", "abgewiesen"] {
            assert_eq!(AbschlussGrund::parse(s).unwrap().as_str(), s);
        }
        assert!(AbschlussGrund::parse("uebergabe").is_none());
    }

    #[test]
    fn uebergaenge_vorwaerts_erlaubt() {
        assert!(darf_uebergehen("offen", "uebergeben"));
        assert!(darf_uebergehen("offen", "abgeschlossen"));
        assert!(darf_uebergehen("uebergeben", "abgeschlossen"));
    }

    #[test]
    fn uebergaenge_rueckwaerts_und_terminal_verboten() {
        assert!(!darf_uebergehen("uebergeben", "offen"));
        assert!(!darf_uebergehen("abgeschlossen", "offen"));
        assert!(!darf_uebergehen("abgeschlossen", "uebergeben"));
        assert!(!darf_uebergehen("offen", "offen"));
        assert!(!darf_uebergehen("quatsch", "offen"));
    }

    #[test]
    fn registrier_und_ort_kurz() {
        assert_eq!(registrier_anzeige(7), "S-007");
        assert_eq!(registrier_anzeige(123), "S-123");
        assert_eq!(ort_kurz("Hauptstr. 17"), "Hauptstr. 17");
        let lang = "A".repeat(50);
        assert_eq!(ort_kurz(&lang).chars().count(), 41); // 40 + Ellipsis
    }
}
