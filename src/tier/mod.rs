pub mod repo;

use serde::Serialize;
use utoipa::ToSchema;

/// Status-Maschine eines Tiers (E‑4). Bewusst schlank — keine Sichtungskette wie
/// bei Personen. String = CHECK-Constraint in `migrations/0031_einsatz_tier.sql`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum TierStatus {
    Aktiv,
    Vermisst,
    Abgeschlossen,
}

impl TierStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            TierStatus::Aktiv => "aktiv",
            TierStatus::Vermisst => "vermisst",
            TierStatus::Abgeschlossen => "abgeschlossen",
        }
    }

    pub fn parse(s: &str) -> Option<TierStatus> {
        match s {
            "aktiv" => Some(TierStatus::Aktiv),
            "vermisst" => Some(TierStatus::Vermisst),
            "abgeschlossen" => Some(TierStatus::Abgeschlossen),
            _ => None,
        }
    }
}

// `status` ist in `TierAnzeige` non-null, aber für einen einheitlichen Decode-
// Mechanismus über alle vier Tier-Enums (statt gemischt `Type`/`Decode` +
// `#[sqlx(try_from = "String")]`) direkt `Type`/`Decode` auf dem Enum
// implementieren — gleiches Muster wie bei den nullable Feldern unten (vgl.
// `Geschlecht`/`Sichtungskategorie` in `src/person/mod.rs`). sqlx' Blanket-Impl
// für `Option<T>` deckt Nullability der anderen drei Felder transparent ab.
impl<DB: sqlx::Database> sqlx::Type<DB> for TierStatus
where
    str: sqlx::Type<DB>,
{
    fn type_info() -> DB::TypeInfo {
        <str as sqlx::Type<DB>>::type_info()
    }
}

impl<'r, DB: sqlx::Database> sqlx::Decode<'r, DB> for TierStatus
where
    &'r str: sqlx::Decode<'r, DB>,
{
    fn decode(
        value: <DB as sqlx::Database>::ValueRef<'r>,
    ) -> Result<Self, sqlx::error::BoxDynError> {
        let s = <&str as sqlx::Decode<DB>>::decode(value)?;
        TierStatus::parse(s).ok_or_else(|| format!("Ungültiger TierStatus: {s}").into())
    }
}

/// Spezies-Enum. String = CHECK-Constraint. `etb_label` ist die pseudonyme
/// Anzeige in der ETB-Spur (z. B. "Hund").
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum Spezies {
    Hund,
    Katze,
    Grosstier,
    Nutzgefluegel,
    Kleintier,
    Wildtier,
    Sonstige,
}

impl Spezies {
    pub fn as_str(&self) -> &'static str {
        match self {
            Spezies::Hund => "hund",
            Spezies::Katze => "katze",
            Spezies::Grosstier => "grosstier",
            Spezies::Nutzgefluegel => "nutzgefluegel",
            Spezies::Kleintier => "kleintier",
            Spezies::Wildtier => "wildtier",
            Spezies::Sonstige => "sonstige",
        }
    }

    pub fn parse(s: &str) -> Option<Spezies> {
        match s {
            "hund" => Some(Spezies::Hund),
            "katze" => Some(Spezies::Katze),
            "grosstier" => Some(Spezies::Grosstier),
            "nutzgefluegel" => Some(Spezies::Nutzgefluegel),
            "kleintier" => Some(Spezies::Kleintier),
            "wildtier" => Some(Spezies::Wildtier),
            "sonstige" => Some(Spezies::Sonstige),
            _ => None,
        }
    }

    /// Pseudonyme ETB-Beschriftung (Spec-Tabelle: "Tier T-007 (Hund) erfasst").
    pub fn etb_label(&self) -> &'static str {
        match self {
            Spezies::Hund => "Hund",
            Spezies::Katze => "Katze",
            Spezies::Grosstier => "Großtier",
            Spezies::Nutzgefluegel => "Nutzgeflügel",
            Spezies::Kleintier => "Kleintier",
            Spezies::Wildtier => "Wildtier",
            Spezies::Sonstige => "Sonstige",
        }
    }
}

// `spezies` ist in `TierAnzeige` non-null — gleiches einheitliches `Type`/
// `Decode`-Muster wie `TierStatus` (s. o.).
impl<DB: sqlx::Database> sqlx::Type<DB> for Spezies
where
    str: sqlx::Type<DB>,
{
    fn type_info() -> DB::TypeInfo {
        <str as sqlx::Type<DB>>::type_info()
    }
}

impl<'r, DB: sqlx::Database> sqlx::Decode<'r, DB> for Spezies
where
    &'r str: sqlx::Decode<'r, DB>,
{
    fn decode(
        value: <DB as sqlx::Database>::ValueRef<'r>,
    ) -> Result<Self, sqlx::error::BoxDynError> {
        let s = <&str as sqlx::Decode<DB>>::decode(value)?;
        Spezies::parse(s).ok_or_else(|| format!("Ungültige Spezies: {s}").into())
    }
}

/// Optionale Geschlechtsangabe des Tiers (kein `divers`, anders als bei Personen).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum TierGeschlecht {
    Maennlich,
    Weiblich,
    Unbekannt,
}

impl TierGeschlecht {
    pub fn as_str(&self) -> &'static str {
        match self {
            TierGeschlecht::Maennlich => "maennlich",
            TierGeschlecht::Weiblich => "weiblich",
            TierGeschlecht::Unbekannt => "unbekannt",
        }
    }

    pub fn parse(s: &str) -> Option<TierGeschlecht> {
        match s {
            "maennlich" => Some(TierGeschlecht::Maennlich),
            "weiblich" => Some(TierGeschlecht::Weiblich),
            "unbekannt" => Some(TierGeschlecht::Unbekannt),
            _ => None,
        }
    }
}

// `geschlecht` ist eine nullable Spalte (`Option<String>`). `#[sqlx(try_from = …)]`
// scheitert an der Orphan-Rule auf `Option<Enum>` (vgl. `Geschlecht` in
// `src/person/mod.rs`) — stattdessen `Type`/`Decode` direkt auf dem Enum; sqlx'
// Blanket-Impl für `Option<T>` liefert NULL → `None` automatisch, ein ungültiger
// Nicht-NULL-Wert wird zum `Decode`-Fehler (Spalte ist DB-CHECK-geschützt).
impl<DB: sqlx::Database> sqlx::Type<DB> for TierGeschlecht
where
    str: sqlx::Type<DB>,
{
    fn type_info() -> DB::TypeInfo {
        <str as sqlx::Type<DB>>::type_info()
    }
}

impl<'r, DB: sqlx::Database> sqlx::Decode<'r, DB> for TierGeschlecht
where
    &'r str: sqlx::Decode<'r, DB>,
{
    fn decode(
        value: <DB as sqlx::Database>::ValueRef<'r>,
    ) -> Result<Self, sqlx::error::BoxDynError> {
        let s = <&str as sqlx::Decode<DB>>::decode(value)?;
        TierGeschlecht::parse(s).ok_or_else(|| format!("Ungültiges TierGeschlecht: {s}").into())
    }
}

/// Abschlussgrund beim Übergang `→ abgeschlossen`. String = CHECK-Constraint.
/// `etb_label` erscheint in Klammern in der ETB-Spur (Spec: "abgeschlossen
/// (uebergabe_tierarzt)") — daher identisch zum DB-String.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AbschlussGrund {
    UebergabeHalter,
    UebergabeTierarzt,
    UebergabeTierheim,
    Verstorben,
    Freilauf,
    Sonstiges,
}

impl AbschlussGrund {
    pub fn as_str(&self) -> &'static str {
        match self {
            AbschlussGrund::UebergabeHalter => "uebergabe_halter",
            AbschlussGrund::UebergabeTierarzt => "uebergabe_tierarzt",
            AbschlussGrund::UebergabeTierheim => "uebergabe_tierheim",
            AbschlussGrund::Verstorben => "verstorben",
            AbschlussGrund::Freilauf => "freilauf",
            AbschlussGrund::Sonstiges => "sonstiges",
        }
    }

    pub fn parse(s: &str) -> Option<AbschlussGrund> {
        match s {
            "uebergabe_halter" => Some(AbschlussGrund::UebergabeHalter),
            "uebergabe_tierarzt" => Some(AbschlussGrund::UebergabeTierarzt),
            "uebergabe_tierheim" => Some(AbschlussGrund::UebergabeTierheim),
            "verstorben" => Some(AbschlussGrund::Verstorben),
            "freilauf" => Some(AbschlussGrund::Freilauf),
            "sonstiges" => Some(AbschlussGrund::Sonstiges),
            _ => None,
        }
    }
}

// Nullable Spalte (`abschluss_grund`) — gleiches Muster wie bei `TierGeschlecht`
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
    fn decode(
        value: <DB as sqlx::Database>::ValueRef<'r>,
    ) -> Result<Self, sqlx::error::BoxDynError> {
        let s = <&str as sqlx::Decode<DB>>::decode(value)?;
        AbschlussGrund::parse(s).ok_or_else(|| format!("Ungültiger AbschlussGrund: {s}").into())
    }
}

/// Ob ein Status-Übergang `von → nach` erlaubt ist. Gleichbleibender Status und
/// unbekannte Werte sind nie erlaubt. `abgeschlossen` ist terminal; Übergänge
/// zurück in aktive Zustände sind erlaubt — als Korrektur einer Fehleingabe
/// (das Schreibrecht prüft die Route). Der Übergang `→ abgeschlossen` erfordert
/// zusätzlich einen `abschluss_grund` (Route + DB-CHECK), wird hier aber NICHT
/// geprüft — `darf_uebergehen` validiert nur die Zustandskanten.
pub fn darf_uebergehen(von: &str, nach: &str) -> bool {
    use TierStatus::*;
    let (Some(von), Some(nach)) = (TierStatus::parse(von), TierStatus::parse(nach)) else {
        return false;
    };
    if von == nach {
        return false;
    }
    match von {
        Aktiv => matches!(nach, Vermisst | Abgeschlossen),
        Vermisst => matches!(nach, Aktiv | Abgeschlossen),
        // Terminal: nur Korrektur zurück in aktive Zustände.
        Abgeschlossen => matches!(nach, Aktiv | Vermisst),
    }
}

/// Stabile, nicht-identifizierende Anzeige der Registriernummer (z. B. `T-042`).
pub fn registrier_anzeige(nr: i64) -> String {
    format!("T-{nr:03}")
}

/// Serialisierbarer Tier-Datensatz (1:1 zur Tabelle `einsatz_tier`). Die beiden
/// `halter_*`-Felder kommen aus einem LEFT JOIN auf `einsatz_person` und sind
/// read-only (NULL bei Freitext-Halter oder unbekannt) — die UI zeigt damit
/// `R-nnn` bzw. "Halter (storniert): R-nnn" ohne Zweit-Request.
#[derive(Debug, Clone, Serialize, sqlx::FromRow, ToSchema)]
pub struct TierAnzeige {
    pub id: i64,
    pub einsatz_id: i64,
    pub registrier_nr: i64,
    pub status: TierStatus,
    pub spezies: Spezies,
    pub rasse_beschreibung: Option<String>,
    pub rufname: Option<String>,
    pub geschlecht: Option<TierGeschlecht>,
    pub alter_geschaetzt: Option<i64>,
    pub farbe_beschreibung: Option<String>,
    pub kennzeichnung: Option<String>,
    pub groesse_gewicht: Option<String>,
    pub halter_person_id: Option<i64>,
    pub halter_kontakt: Option<String>,
    pub antreff_ort: Option<String>,
    pub notiz: Option<String>,
    pub abschluss_grund: Option<AbschlussGrund>,
    pub abschluss_ziel: Option<String>,
    pub erfasst_at: String,
    pub erfasst_von: i64,
    pub geaendert_at: String,
    pub geaendert_von: i64,
    pub storniert_at: Option<String>,
    // Join-Felder (read-only): Halter-Auflösung über einsatz_person.
    pub halter_registrier_nr: Option<i64>,
    pub halter_storniert_at: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_roundtrip() {
        for s in ["aktiv", "vermisst", "abgeschlossen"] {
            assert_eq!(TierStatus::parse(s).unwrap().as_str(), s);
        }
        assert!(TierStatus::parse("gestohlen").is_none());
    }

    #[test]
    fn spezies_roundtrip_und_label() {
        for s in [
            "hund",
            "katze",
            "grosstier",
            "nutzgefluegel",
            "kleintier",
            "wildtier",
            "sonstige",
        ] {
            assert_eq!(Spezies::parse(s).unwrap().as_str(), s);
        }
        assert!(Spezies::parse("dinosaurier").is_none());
        assert_eq!(Spezies::parse("hund").unwrap().etb_label(), "Hund");
        assert_eq!(Spezies::parse("grosstier").unwrap().etb_label(), "Großtier");
    }

    #[test]
    fn geschlecht_roundtrip_ohne_divers() {
        for g in ["maennlich", "weiblich", "unbekannt"] {
            assert_eq!(TierGeschlecht::parse(g).unwrap().as_str(), g);
        }
        assert!(
            TierGeschlecht::parse("divers").is_none(),
            "Tiere haben kein 'divers'"
        );
    }

    #[test]
    fn abschluss_grund_roundtrip() {
        for g in [
            "uebergabe_halter",
            "uebergabe_tierarzt",
            "uebergabe_tierheim",
            "verstorben",
            "freilauf",
            "sonstiges",
        ] {
            assert_eq!(AbschlussGrund::parse(g).unwrap().as_str(), g);
        }
        assert!(AbschlussGrund::parse("vergessen").is_none());
    }

    #[test]
    fn erlaubte_uebergaenge() {
        assert!(darf_uebergehen("aktiv", "vermisst"));
        assert!(darf_uebergehen("aktiv", "abgeschlossen"));
        assert!(darf_uebergehen("vermisst", "aktiv"));
        assert!(darf_uebergehen("vermisst", "abgeschlossen"));
        // Korrektur aus dem terminalen Zustand zurück:
        assert!(darf_uebergehen("abgeschlossen", "aktiv"));
        assert!(darf_uebergehen("abgeschlossen", "vermisst"));
    }

    #[test]
    fn verbotene_uebergaenge() {
        assert!(!darf_uebergehen("aktiv", "aktiv"));
        assert!(!darf_uebergehen("vermisst", "vermisst"));
        assert!(!darf_uebergehen("abgeschlossen", "abgeschlossen"));
        assert!(!darf_uebergehen("aktiv", "quatsch"));
        assert!(!darf_uebergehen("quatsch", "aktiv"));
    }

    #[test]
    fn registrier_anzeige_mit_fuehrenden_nullen() {
        assert_eq!(registrier_anzeige(7), "T-007");
        assert_eq!(registrier_anzeige(42), "T-042");
        assert_eq!(registrier_anzeige(1234), "T-1234");
    }
}
