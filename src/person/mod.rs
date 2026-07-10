pub mod abgleich_repo;
pub mod audit_repo;
pub mod repo;
pub mod sichtung_repo;
pub mod verbleib_repo;
pub mod verlaufsnotiz_repo;

use serde::Serialize;
use utoipa::ToSchema;

/// Administrative Status-Maschine einer Person (E‑1). E‑2 ergänzt die
/// medizinische Sichtungskategorie SK I–IV als separates Attribut auf
/// `betroffen` — diese Maschine bleibt unangetastet.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum PersonStatus {
    Erfasst,
    Vermisst,
    Betroffen,
    Verstorben,
    Abgemeldet,
}

impl PersonStatus {
    /// DB-/API-Stringrepräsentation. **Muss exakt dem CHECK-Constraint in
    /// `migrations/0020_einsatz_person.sql` entsprechen.**
    pub fn as_str(&self) -> &'static str {
        match self {
            PersonStatus::Erfasst => "erfasst",
            PersonStatus::Vermisst => "vermisst",
            PersonStatus::Betroffen => "betroffen",
            PersonStatus::Verstorben => "verstorben",
            PersonStatus::Abgemeldet => "abgemeldet",
        }
    }

    pub fn parse(s: &str) -> Option<PersonStatus> {
        match s {
            "erfasst" => Some(PersonStatus::Erfasst),
            "vermisst" => Some(PersonStatus::Vermisst),
            "betroffen" => Some(PersonStatus::Betroffen),
            "verstorben" => Some(PersonStatus::Verstorben),
            "abgemeldet" => Some(PersonStatus::Abgemeldet),
            _ => None,
        }
    }
}

impl TryFrom<String> for PersonStatus {
    type Error = String;

    fn try_from(s: String) -> Result<Self, Self::Error> {
        PersonStatus::parse(&s).ok_or_else(|| format!("Ungültiger PersonStatus: {s}"))
    }
}

/// Optionale Geschlechtsangabe. `unbekannt` ist ein erstklassiger Wert.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum Geschlecht {
    Maennlich,
    Weiblich,
    Divers,
    Unbekannt,
}

impl Geschlecht {
    pub fn as_str(&self) -> &'static str {
        match self {
            Geschlecht::Maennlich => "maennlich",
            Geschlecht::Weiblich => "weiblich",
            Geschlecht::Divers => "divers",
            Geschlecht::Unbekannt => "unbekannt",
        }
    }

    pub fn parse(s: &str) -> Option<Geschlecht> {
        match s {
            "maennlich" => Some(Geschlecht::Maennlich),
            "weiblich" => Some(Geschlecht::Weiblich),
            "divers" => Some(Geschlecht::Divers),
            "unbekannt" => Some(Geschlecht::Unbekannt),
            _ => None,
        }
    }
}

// `geschlecht` ist eine nullable Spalte (`Option<String>`). `#[sqlx(try_from = "…")]`
// scheitert hier an der Orphan-Rule (`TryFrom<Option<String>> for Option<Geschlecht>`
// wäre ein fremder Trait auf einem fremden `Option<_>`). Stattdessen `Type`/`Decode`
// direkt auf `Geschlecht` implementieren (sqlx-Referenzmuster für Custom-Enum-Spalten,
// vgl. sqlx-Doku zu `Decode`): sqlx' Blanket-Impl für `Option<T>` liefert NULL → `None`
// automatisch; ein ungültiger Nicht-NULL-Wert wird zum `Decode`-Fehler (→ 500 statt
// stillem Fallback — Spalte ist DB-CHECK-geschützt, sollte nie ungültig sein).
impl<DB: sqlx::Database> sqlx::Type<DB> for Geschlecht
where
    str: sqlx::Type<DB>,
{
    fn type_info() -> DB::TypeInfo {
        <str as sqlx::Type<DB>>::type_info()
    }
}

impl<'r, DB: sqlx::Database> sqlx::Decode<'r, DB> for Geschlecht
where
    &'r str: sqlx::Decode<'r, DB>,
{
    fn decode(value: <DB as sqlx::Database>::ValueRef<'r>) -> Result<Self, sqlx::error::BoxDynError> {
        let s = <&str as sqlx::Decode<DB>>::decode(value)?;
        Geschlecht::parse(s).ok_or_else(|| format!("Ungültiges Geschlecht: {s}").into())
    }
}

/// Medizinische Sichtungskategorie (Triage). String = CHECK-Constraint in
/// `migrations/0023_person_sichtung.sql`. **`Tot` ist ein medizinisches Urteil
/// und ändert den Admin-`PersonStatus` NICHT** (Annahme 4).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum Sichtungskategorie {
    Sk1,
    Sk2,
    Sk3,
    Sk4,
    Tot,
    Unverletzt,
}

impl Sichtungskategorie {
    pub fn as_str(&self) -> &'static str {
        match self {
            Sichtungskategorie::Sk1 => "sk1",
            Sichtungskategorie::Sk2 => "sk2",
            Sichtungskategorie::Sk3 => "sk3",
            Sichtungskategorie::Sk4 => "sk4",
            Sichtungskategorie::Tot => "tot",
            Sichtungskategorie::Unverletzt => "unverletzt",
        }
    }

    pub fn parse(s: &str) -> Option<Sichtungskategorie> {
        match s {
            "sk1" => Some(Sichtungskategorie::Sk1),
            "sk2" => Some(Sichtungskategorie::Sk2),
            "sk3" => Some(Sichtungskategorie::Sk3),
            "sk4" => Some(Sichtungskategorie::Sk4),
            "tot" => Some(Sichtungskategorie::Tot),
            "unverletzt" => Some(Sichtungskategorie::Unverletzt),
            _ => None,
        }
    }

    /// Pseudonyme ETB-Beschriftung (z. B. `SK II`, `tot`, `unverletzt`).
    pub fn etb_label(&self) -> &'static str {
        match self {
            Sichtungskategorie::Sk1 => "SK I",
            Sichtungskategorie::Sk2 => "SK II",
            Sichtungskategorie::Sk3 => "SK III",
            Sichtungskategorie::Sk4 => "SK IV",
            Sichtungskategorie::Tot => "tot",
            Sichtungskategorie::Unverletzt => "unverletzt",
        }
    }
}

// Nullable Spalte (`aktuelle_sichtung`) — gleiches Muster wie bei `Geschlecht` (s.o.):
// `Type`/`Decode` direkt auf dem Enum, statt `#[sqlx(try_from = "Option<String>")]`
// (Orphan-Rule).
impl<DB: sqlx::Database> sqlx::Type<DB> for Sichtungskategorie
where
    str: sqlx::Type<DB>,
{
    fn type_info() -> DB::TypeInfo {
        <str as sqlx::Type<DB>>::type_info()
    }
}

impl<'r, DB: sqlx::Database> sqlx::Decode<'r, DB> for Sichtungskategorie
where
    &'r str: sqlx::Decode<'r, DB>,
{
    fn decode(value: <DB as sqlx::Database>::ValueRef<'r>) -> Result<Self, sqlx::error::BoxDynError> {
        let s = <&str as sqlx::Decode<DB>>::decode(value)?;
        Sichtungskategorie::parse(s).ok_or_else(|| format!("Ungültige Sichtungskategorie: {s}").into())
    }
}

/// Art eines Verbleib-Ereignisses. String = CHECK-Constraint in
/// `migrations/0025_person_verbleib.sql`. `Verstorben` = Verbleib des Leichnams
/// (NICHT der Admin-Status).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum VerbleibArt {
    Transport,
    Entlassung,
    VorOrt,
    Verstorben,
}

impl VerbleibArt {
    pub fn as_str(&self) -> &'static str {
        match self {
            VerbleibArt::Transport => "transport",
            VerbleibArt::Entlassung => "entlassung",
            VerbleibArt::VorOrt => "vor_ort",
            VerbleibArt::Verstorben => "verstorben",
        }
    }

    pub fn parse(s: &str) -> Option<VerbleibArt> {
        match s {
            "transport" => Some(VerbleibArt::Transport),
            "entlassung" => Some(VerbleibArt::Entlassung),
            "vor_ort" => Some(VerbleibArt::VorOrt),
            "verstorben" => Some(VerbleibArt::Verstorben),
            _ => None,
        }
    }

    /// Kurzform fürs Cache-Feld `aktueller_verbleib` (z. B. `Transport → KH Mitte`).
    pub fn kurzform(&self, ziel: Option<&str>) -> String {
        match self {
            VerbleibArt::Transport => match ziel {
                Some(z) => format!("Transport → {z}"),
                None => "Transport".to_string(),
            },
            VerbleibArt::Entlassung => "entlassen".to_string(),
            VerbleibArt::VorOrt => "vor Ort".to_string(),
            VerbleibArt::Verstorben => "verstorben".to_string(),
        }
    }

    /// Pseudonymer ETB-Sachverhalt (ohne Reg.-Nr.-Präfix; der Handler stellt es voran).
    pub fn etb_sachverhalt(&self, ziel: Option<&str>) -> String {
        match self {
            VerbleibArt::Transport => match ziel {
                Some(z) => format!("abtransportiert → {z}"),
                None => "abtransportiert".to_string(),
            },
            VerbleibArt::Entlassung => "entlassen".to_string(),
            VerbleibArt::VorOrt => "verbleibt vor Ort".to_string(),
            VerbleibArt::Verstorben => "Verbleib des Leichnams".to_string(),
        }
    }
}

/// Verbleib-Status (Schema-Anker für die OpenAPI-Union, LFH-120). Wire == `status`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum VerbleibStatus {
    Angemeldet,
    Abtransportiert,
}

/// Abgleich-Status (Schema-Anker für die OpenAPI-Union, LFH-120). Wire == `status`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AbgleichStatus {
    Verdacht,
    Bestaetigt,
    Verworfen,
}

/// Ob ein Status-Übergang `von → nach` erlaubt ist. Unbekannte Werte und
/// gleichbleibender Status sind nie erlaubt. Übergänge aus terminalen Zuständen
/// (`verstorben`/`abgemeldet`) zurück in aktive sind erlaubt — als Korrektur
/// einer Fehleingabe; das Schreibrecht prüft die Route.
pub fn darf_uebergehen(von: &str, nach: &str) -> bool {
    use PersonStatus::*;
    let (Some(von), Some(nach)) = (PersonStatus::parse(von), PersonStatus::parse(nach)) else {
        return false;
    };
    if von == nach {
        return false;
    }
    match von {
        Erfasst => matches!(nach, Vermisst | Betroffen | Verstorben | Abgemeldet),
        Vermisst => matches!(nach, Betroffen | Verstorben | Abgemeldet),
        Betroffen => matches!(nach, Vermisst | Verstorben | Abgemeldet),
        // Terminal: nur Korrektur zurück in aktive Zustände.
        Verstorben | Abgemeldet => matches!(nach, Erfasst | Vermisst | Betroffen),
    }
}

/// Stabile, nicht-identifizierende Anzeige der Registriernummer (z. B. `R-042`).
pub fn registrier_anzeige(nr: i64) -> String {
    format!("R-{nr:03}")
}

/// Serialisierbarer Personen-Datensatz (1:1 zur Tabelle `einsatz_person`; kein
/// `org_id`, da einsatz-scoped). Direkt aus der Zeile lesbar — kein Stamm-Join,
/// kein Snapshot wie bei Material.
#[derive(Debug, Clone, Serialize, sqlx::FromRow, ToSchema)]
pub struct PersonAnzeige {
    pub id: i64,
    pub einsatz_id: i64,
    pub registrier_nr: i64,
    #[sqlx(try_from = "String")]
    pub status: PersonStatus,
    pub name: Option<String>,
    pub vorname: Option<String>,
    pub geschlecht: Option<Geschlecht>,
    pub geburtsdatum: Option<String>,
    pub alter_geschaetzt: Option<i64>,
    pub herkunft_adresse: Option<String>,
    pub antreff_ort: Option<String>,
    pub melder_kontakt: Option<String>,
    pub notiz: Option<String>,
    pub erfasst_at: String,
    pub erfasst_von: i64,
    pub geaendert_at: String,
    pub geaendert_von: i64,
    pub storniert_at: Option<String>,
    // E‑2: denormalisierter medizinischer Cache (NULL = ungesichtet / vor Ort).
    pub aktuelle_sichtung: Option<Sichtungskategorie>,
    pub aktuelle_sichtung_at: Option<String>,
    pub aktueller_verbleib: Option<String>,
    // E‑3: UHS-Cache (NULL = nicht in einer UHS / nicht auf einem Platz).
    pub aktuelle_uhs_id: Option<i64>,
    pub aktueller_platz_id: Option<i64>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_roundtrip() {
        for s in ["erfasst", "vermisst", "betroffen", "verstorben", "abgemeldet"] {
            assert_eq!(PersonStatus::parse(s).unwrap().as_str(), s);
        }
        assert!(PersonStatus::parse("unsinn").is_none());
    }

    #[test]
    fn geschlecht_roundtrip() {
        for g in ["maennlich", "weiblich", "divers", "unbekannt"] {
            assert_eq!(Geschlecht::parse(g).unwrap().as_str(), g);
        }
        assert!(Geschlecht::parse("x").is_none());
    }

    #[test]
    fn erlaubte_uebergaenge() {
        assert!(darf_uebergehen("erfasst", "vermisst"));
        assert!(darf_uebergehen("erfasst", "betroffen"));
        assert!(darf_uebergehen("erfasst", "verstorben"));
        assert!(darf_uebergehen("erfasst", "abgemeldet"));
        assert!(darf_uebergehen("vermisst", "betroffen"));
        assert!(darf_uebergehen("betroffen", "vermisst"));
        assert!(darf_uebergehen("vermisst", "verstorben"));
        assert!(darf_uebergehen("betroffen", "verstorben"));
        assert!(darf_uebergehen("vermisst", "abgemeldet"));
        // Korrektur aus terminalen Zuständen zurück in aktive:
        assert!(darf_uebergehen("verstorben", "betroffen"));
        assert!(darf_uebergehen("abgemeldet", "erfasst"));
    }

    #[test]
    fn verbotene_uebergaenge() {
        assert!(!darf_uebergehen("erfasst", "erfasst"));
        assert!(!darf_uebergehen("betroffen", "betroffen"));
        assert!(!darf_uebergehen("vermisst", "erfasst"));
        assert!(!darf_uebergehen("betroffen", "erfasst"));
        assert!(!darf_uebergehen("verstorben", "abgemeldet"));
        assert!(!darf_uebergehen("abgemeldet", "verstorben"));
        assert!(!darf_uebergehen("erfasst", "quatsch"));
        assert!(!darf_uebergehen("quatsch", "betroffen"));
    }

    #[test]
    fn registrier_anzeige_formatiert_mit_fuehrenden_nullen() {
        assert_eq!(registrier_anzeige(42), "R-042");
        assert_eq!(registrier_anzeige(7), "R-007");
        assert_eq!(registrier_anzeige(1234), "R-1234");
    }

    #[test]
    fn sichtungskategorie_roundtrip_und_label() {
        for k in ["sk1", "sk2", "sk3", "sk4", "tot", "unverletzt"] {
            assert_eq!(Sichtungskategorie::parse(k).unwrap().as_str(), k);
        }
        assert!(Sichtungskategorie::parse("sk5").is_none());
        assert_eq!(Sichtungskategorie::parse("sk2").unwrap().etb_label(), "SK II");
        assert_eq!(Sichtungskategorie::parse("tot").unwrap().etb_label(), "tot");
        assert_eq!(Sichtungskategorie::parse("unverletzt").unwrap().etb_label(), "unverletzt");
    }

    #[test]
    fn verbleib_art_roundtrip() {
        for a in ["transport", "entlassung", "vor_ort", "verstorben"] {
            assert_eq!(VerbleibArt::parse(a).unwrap().as_str(), a);
        }
        assert!(VerbleibArt::parse("teleportation").is_none());
    }
}
