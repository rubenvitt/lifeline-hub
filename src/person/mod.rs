pub mod abgleich_repo;
pub mod anhang;
pub mod audit_repo;
pub mod massnahme_repo;
pub mod repo;
pub mod sichtung_repo;
pub mod transport_repo;
pub mod verbleib_repo;
pub mod verlaufsnotiz_repo;
pub mod verletzung_repo;

use crate::wire_enum::wire_enum;
use serde::Serialize;
use utoipa::ToSchema;

wire_enum! {
    /// Administrative Status-Maschine einer Person (E‑1). E‑2 ergänzt die
    /// medizinische Sichtungskategorie SK I–IV als separates Attribut auf
    /// `betroffen` — diese Maschine bleibt unangetastet.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum PersonStatus {
        Erfasst => "erfasst",
        Vermisst => "vermisst",
        Betroffen => "betroffen",
        Verstorben => "verstorben",
        Abgemeldet => "abgemeldet",
    }
    try_from = |s| format!("Ungültiger PersonStatus: {s}");
}

wire_enum! {
    /// Optionale Geschlechtsangabe. `unbekannt` ist ein erstklassiger Wert.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum Geschlecht {
        Maennlich => "maennlich",
        Weiblich => "weiblich",
        Divers => "divers",
        Unbekannt => "unbekannt",
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
    fn decode(
        value: <DB as sqlx::Database>::ValueRef<'r>,
    ) -> Result<Self, sqlx::error::BoxDynError> {
        let s = <&str as sqlx::Decode<DB>>::decode(value)?;
        Geschlecht::parse(s).ok_or_else(|| format!("Ungültiges Geschlecht: {s}").into())
    }
}

wire_enum! {
    /// Medizinische Sichtungskategorie (Triage). String = CHECK-Constraint in
    /// `migrations/0023_person_sichtung.sql`. **`Tot` ist ein medizinisches Urteil
    /// und ändert den Admin-`PersonStatus` NICHT** (Annahme 4).
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum Sichtungskategorie {
        Sk1 => "sk1",
        Sk2 => "sk2",
        Sk3 => "sk3",
        Sk4 => "sk4",
        Tot => "tot",
        Unverletzt => "unverletzt",
    }
}

impl Sichtungskategorie {
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
    fn decode(
        value: <DB as sqlx::Database>::ValueRef<'r>,
    ) -> Result<Self, sqlx::error::BoxDynError> {
        let s = <&str as sqlx::Decode<DB>>::decode(value)?;
        Sichtungskategorie::parse(s)
            .ok_or_else(|| format!("Ungültige Sichtungskategorie: {s}").into())
    }
}

wire_enum! {
    /// Art eines Verbleib-Ereignisses. String = CHECK-Constraint in
    /// `migrations/0025_person_verbleib.sql`, erweitert um `notunterkunft` in
    /// `migrations/0112_person_verbleib_notunterkunft.sql` (LFH-613). `Verstorben` = Verbleib des
    /// Leichnams (NICHT der Admin-Status).
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum VerbleibArt {
        Transport => "transport",
        Entlassung => "entlassung",
        VorOrt => "vor_ort",
        Verstorben => "verstorben",
        Notunterkunft => "notunterkunft",
    }
}

impl VerbleibArt {
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
            // Ohne Ziel wie beim Transport die bloße Art (LFH-613).
            VerbleibArt::Notunterkunft => match ziel {
                Some(z) => format!("Notunterkunft → {z}"),
                None => "Notunterkunft".to_string(),
            },
        }
    }

    /// Pseudonymer ETB-Sachverhalt (ohne Reg.-Nr.-Präfix; der Handler stellt es voran). Kennt
    /// bewusst kein Ziel: das ist Scrub des Verbleibs und bliebe sonst über die Schwärzung hinaus
    /// im ETB stehen (LFH-752, Spec `aufbewahrung`).
    pub fn etb_sachverhalt(&self) -> &'static str {
        match self {
            VerbleibArt::Transport => "abtransportiert",
            VerbleibArt::Entlassung => "entlassen",
            VerbleibArt::VorOrt => "verbleibt vor Ort",
            VerbleibArt::Verstorben => "Verbleib des Leichnams",
            VerbleibArt::Notunterkunft => "in Notunterkunft",
        }
    }
}

wire_enum! {
    /// Verbleib-Status (Schema-Anker für die OpenAPI-Union, LFH-120). Wire == `status`.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum VerbleibStatus {
        Angemeldet => "angemeldet",
        Abtransportiert => "abtransportiert",
        /// Quittierte Übergabe eines Eigentransports am Ziel (LLH-1332, design.md D2).
        Uebergeben => "uebergeben",
    }
}

wire_enum! {
    /// Wer einen Transport fährt (LLH-1332, design.md D1). Nur bei `art = transport`; ein
    /// Bestands-Transport ohne Angabe gilt als `fremd`.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum TransportDurch {
        /// Ein fremdes Rettungsmittel übernimmt; der Patient ist übergeben.
        Fremd => "fremd",
        /// Ein Fahrzeug aus dem Einsatz fährt; der Patient bleibt bis zur Übergabe bei uns.
        Eigen => "eigen",
    }
}

impl<DB: sqlx::Database> sqlx::Type<DB> for TransportDurch
where
    str: sqlx::Type<DB>,
{
    fn type_info() -> DB::TypeInfo {
        <str as sqlx::Type<DB>>::type_info()
    }
}

impl<'r, DB: sqlx::Database> sqlx::Decode<'r, DB> for TransportDurch
where
    &'r str: sqlx::Decode<'r, DB>,
{
    fn decode(
        value: <DB as sqlx::Database>::ValueRef<'r>,
    ) -> Result<Self, sqlx::error::BoxDynError> {
        let s = <&str as sqlx::Decode<DB>>::decode(value)?;
        TransportDurch::parse(s).ok_or_else(|| format!("Ungültiges TransportDurch: {s}").into())
    }
}

wire_enum! {
    /// Versorgungszustand einer Person (LLH-1332, design.md D3), abgeleitet aus dem jüngsten
    /// Verbleib, nie gespeichert. Die eine Regel steht in [`versorgung_von`].
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, ToSchema)]
    pub enum Versorgung {
        /// Noch bei uns: kein Verbleib, „verbleibt vor Ort“ oder ein nur angemeldeter Transport.
        #[default]
        Offen => "offen",
        /// Im Eigentransport, Übergabe noch nicht quittiert.
        Unterwegs => "unterwegs",
        /// Übergeben, entlassen, in Notunterkunft oder Verbleib des Leichnams.
        Abgeschlossen => "abgeschlossen",
    }
}

/// Versorgungszustand aus dem jüngsten Verbleib (Spec `patienten-uebergabe`, „Versorgungszustand
/// der Person“). Gepinnt im gemeinsamen Fixture `tests/fixtures/verdichtung/regeln.json`
/// (Abschnitt `versorgung`); der Client liest nur das Feld `versorgung`. Eine vermisste Person ist
/// immer `offen`, auch mit einem älteren Verbleib (design.md D3): sie wird gesucht und darf nicht
/// aus der Liste fallen.
pub fn versorgung_von(
    person_status: PersonStatus,
    art: Option<VerbleibArt>,
    status: Option<VerbleibStatus>,
    durch: Option<TransportDurch>,
) -> Versorgung {
    if person_status == PersonStatus::Vermisst {
        return Versorgung::Offen;
    }
    match art {
        None | Some(VerbleibArt::VorOrt) => Versorgung::Offen,
        Some(VerbleibArt::Transport) => match (status, durch) {
            (Some(VerbleibStatus::Angemeldet), _) => Versorgung::Offen,
            (Some(VerbleibStatus::Uebergeben), _) => Versorgung::Abgeschlossen,
            (_, Some(TransportDurch::Eigen)) => Versorgung::Unterwegs,
            _ => Versorgung::Abgeschlossen,
        },
        Some(VerbleibArt::Entlassung | VerbleibArt::Notunterkunft | VerbleibArt::Verstorben) => {
            Versorgung::Abgeschlossen
        }
    }
}

/// Sichtungsverteilung der Lage ohne abgeschlossene Patienten (LLH-1332, Spec
/// `lage-verdichtung`, „Abgeschlossene Patienten zählen nicht als Patienten“). Gegenstück im
/// Client: `sichtungsbild` mit `ohneAbgeschlossene` in `personen/personenBilanz.ts`.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct LageSichtung {
    pub sk1: i64,
    pub sk2: i64,
    pub sk3: i64,
    pub sk4: i64,
    pub tot: i64,
    pub unverletzt: i64,
    pub ohne: i64,
    /// Abgeschlossene, in keiner Kategorie oben gezählt.
    pub abgeschlossen: i64,
}

impl LageSichtung {
    /// SK I bis SK IV.
    pub fn patienten(&self) -> i64 {
        self.sk1 + self.sk2 + self.sk3 + self.sk4
    }
}

/// Zählt Sichtung und Versorgungszustand je Person zur [`LageSichtung`].
pub fn zaehle_lage_sichtung(
    personen: impl IntoIterator<Item = (Option<Sichtungskategorie>, Versorgung)>,
) -> LageSichtung {
    let mut z = LageSichtung::default();
    for (sichtung, versorgung) in personen {
        if versorgung == Versorgung::Abgeschlossen {
            z.abgeschlossen += 1;
            continue;
        }
        match sichtung {
            Some(Sichtungskategorie::Sk1) => z.sk1 += 1,
            Some(Sichtungskategorie::Sk2) => z.sk2 += 1,
            Some(Sichtungskategorie::Sk3) => z.sk3 += 1,
            Some(Sichtungskategorie::Sk4) => z.sk4 += 1,
            Some(Sichtungskategorie::Tot) => z.tot += 1,
            Some(Sichtungskategorie::Unverletzt) => z.unverletzt += 1,
            None => z.ohne += 1,
        }
    }
    z
}

/// Kurzform des Verbleib-Caches `aktueller_verbleib` samt Fahrer-Angabe (LLH-1332, design.md
/// D2): ein Eigentransport nennt sein Fahrzeug, die quittierte Übergabe heißt „übergeben“.
pub fn verbleib_kurzform(
    art: VerbleibArt,
    ziel: Option<&str>,
    status: Option<VerbleibStatus>,
    durch: Option<TransportDurch>,
    transportmittel: Option<&str>,
) -> String {
    let nach = |kopf: String| match ziel {
        Some(z) => format!("{kopf} → {z}"),
        None => kopf,
    };
    match (art, durch, status) {
        (VerbleibArt::Transport, Some(TransportDurch::Eigen), Some(VerbleibStatus::Uebergeben)) => {
            nach("übergeben".to_string())
        }
        (VerbleibArt::Transport, Some(TransportDurch::Eigen), _) => nach(match transportmittel {
            Some(t) => format!("Eigentransport {t}"),
            None => "Eigentransport".to_string(),
        }),
        _ => art.kurzform(ziel),
    }
}

/// Pseudonymer ETB-Sachverhalt samt Fahrer-Angabe; wie [`VerbleibArt::etb_sachverhalt`] ohne
/// Ziel und ohne Fahrzeug (Scrub, LFH-752).
pub fn verbleib_etb_sachverhalt(
    art: VerbleibArt,
    status: Option<VerbleibStatus>,
    durch: Option<TransportDurch>,
) -> &'static str {
    match (art, durch, status) {
        (VerbleibArt::Transport, Some(TransportDurch::Eigen), Some(VerbleibStatus::Uebergeben)) => {
            "übergeben"
        }
        (VerbleibArt::Transport, Some(TransportDurch::Eigen), _) => "im Eigentransport",
        _ => art.etb_sachverhalt(),
    }
}

// `status` ist in `VerbleibAnzeige` eine nullable Spalte (`Option<String>`) —
// gleiches Muster wie `Geschlecht`/`Sichtungskategorie` (s. o.): `Type`/`Decode`
// direkt auf dem Enum, statt `#[sqlx(try_from = "…")]` (Orphan-Rule auf
// `Option<Enum>`).
impl<DB: sqlx::Database> sqlx::Type<DB> for VerbleibStatus
where
    str: sqlx::Type<DB>,
{
    fn type_info() -> DB::TypeInfo {
        <str as sqlx::Type<DB>>::type_info()
    }
}

impl<'r, DB: sqlx::Database> sqlx::Decode<'r, DB> for VerbleibStatus
where
    &'r str: sqlx::Decode<'r, DB>,
{
    fn decode(
        value: <DB as sqlx::Database>::ValueRef<'r>,
    ) -> Result<Self, sqlx::error::BoxDynError> {
        let s = <&str as sqlx::Decode<DB>>::decode(value)?;
        VerbleibStatus::parse(s).ok_or_else(|| format!("Ungültiger VerbleibStatus: {s}").into())
    }
}

// `art` ist in `VerbleibAnzeige` non-null, aber `VerbleibAnzeige` ist gemischt
// (status ist nullable) → einheitlicher Decode-Mechanismus über direkte
// `Type`/`Decode`-Impls für BEIDE Felder, statt `#[sqlx(try_from = "String")]`
// nur für `art` (vgl. Tier-Cluster in `src/tier/mod.rs`).
impl<DB: sqlx::Database> sqlx::Type<DB> for VerbleibArt
where
    str: sqlx::Type<DB>,
{
    fn type_info() -> DB::TypeInfo {
        <str as sqlx::Type<DB>>::type_info()
    }
}

impl<'r, DB: sqlx::Database> sqlx::Decode<'r, DB> for VerbleibArt
where
    &'r str: sqlx::Decode<'r, DB>,
{
    fn decode(
        value: <DB as sqlx::Database>::ValueRef<'r>,
    ) -> Result<Self, sqlx::error::BoxDynError> {
        let s = <&str as sqlx::Decode<DB>>::decode(value)?;
        VerbleibArt::parse(s).ok_or_else(|| format!("Ungültige VerbleibArt: {s}").into())
    }
}

wire_enum! {
    /// Abgleich-Status (Schema-Anker für die OpenAPI-Union, LFH-120). Wire == `status`.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum AbgleichStatus {
        Verdacht => "verdacht",
        Bestaetigt => "bestaetigt",
        Verworfen => "verworfen",
    }
    try_from = |s| format!("Ungültiger AbgleichStatus: {s}");
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

/// Personenauswahl (LFH-940, Spec `listen-projektion`): je nicht stornierter Person nur, was
/// Auswahlfelder, Sprungpalette und Chat-Bezug brauchen. Keine Freitexte (Notiz, Kontakt,
/// Adresse, Antreffort, Zustand) — die bleiben der Personenliste und dem Detail.
#[derive(Debug, Clone, Serialize, sqlx::FromRow, ToSchema)]
pub struct PersonAuswahl {
    pub id: i64,
    pub registrier_nr: i64,
    #[sqlx(try_from = "String")]
    pub status: PersonStatus,
    pub name: Option<String>,
    pub vorname: Option<String>,
    /// PAT-Nummer (LLH-1326, design.md D12): die Sprungpalette findet die Person auch darüber.
    /// Ohne Netz kürzt `lagebildKuerzen` sie weg (D9).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pat_nummer: Option<String>,
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
    // LFH-613: Lagedaten. Neue Option-Felder fehlen im JSON, wenn leer (Norm ab LFH-265) —
    // die älteren Felder oben bleiben bewusst bei `null`, ihre Tests prüfen das.
    /// Zustand in Kurzform (Freitext, z. B. „gehfähig, unterkühlt").
    #[serde(skip_serializing_if = "Option::is_none")]
    pub zustand: Option<String>,
    /// Fundort-Koordinate (WGS84), immer gemeinsam mit `antreff_lon` gesetzt oder leer.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub antreff_lat: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub antreff_lon: Option<f64>,
    /// Seit wann die Person vermisst wird (`YYYY-MM-DD HH:MM:SS`, UTC). Nur bei Status
    /// `vermisst` bedeutsam; beim Verlassen des Status bleibt der Wert dokumentarisch stehen.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vermisst_seit: Option<String>,
    /// Strukturierter Cache des jüngsten Verbleib-Ereignisses (neben der Kurzform
    /// `aktueller_verbleib`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub aktuelle_verbleib_art: Option<VerbleibArt>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub aktuelles_verbleib_ziel: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub aktueller_verbleib_status: Option<VerbleibStatus>,
    /// Betreuungsstelle des jüngsten Verbleibs (LFH-674), nur bei `notunterkunft` gesetzt.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub aktuelle_verbleib_betreuungsstelle_id: Option<i64>,
    /// Wer den jüngsten Transport fährt (LLH-1332); fehlt bei anderen Arten und im Bestand.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub aktueller_transport_durch: Option<TransportDurch>,
    /// Disposition des Fahrzeugs eines Eigentransports (LLH-1332), sonst leer.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub aktuelles_einsatz_fahrzeug_id: Option<i64>,
    /// Abgeleiteter Versorgungszustand (LLH-1332, design.md D3). Nie gespeichert: das Repo setzt
    /// ihn nach jedem Lesen über [`PersonAnzeige::mit_versorgung`].
    #[sqlx(skip)]
    pub versorgung: Versorgung,
    /// Nummer der Papier-Patientenanhängetasche (LLH-1326), zum Abgleich; nicht eindeutig.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pat_nummer: Option<String>,
    /// Kontamination (LLH-1326): `true` kontaminiert, `false` nicht; fehlt = keine Angabe,
    /// ausdrücklich nicht „nein“.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kontamination: Option<bool>,
    /// Aktueller Transportstand (LLH-1325, Cache des jüngsten Eintrags in `person_transport`);
    /// alle vier fehlen ohne Stand oder nach dem Aufheben.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<transport_repo::TransportPrioritaet>)]
    pub transport_prioritaet: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<transport_repo::TransportArt>)]
    pub transport_art: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<transport_repo::Fachrichtung>)]
    pub transport_fachrichtung: Option<String>,
    /// Erfassungszeit des aktuellen Transportstands.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transport_at: Option<String>,
}

impl PersonAnzeige {
    /// Setzt den abgeleiteten Versorgungszustand aus den Verbleib-Caches.
    pub fn mit_versorgung(mut self) -> Self {
        self.versorgung = versorgung_von(
            self.status,
            self.aktuelle_verbleib_art,
            self.aktueller_verbleib_status,
            self.aktueller_transport_durch,
        );
        self
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_roundtrip() {
        for s in [
            "erfasst",
            "vermisst",
            "betroffen",
            "verstorben",
            "abgemeldet",
        ] {
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
        assert_eq!(
            Sichtungskategorie::parse("sk2").unwrap().etb_label(),
            "SK II"
        );
        assert_eq!(Sichtungskategorie::parse("tot").unwrap().etb_label(), "tot");
        assert_eq!(
            Sichtungskategorie::parse("unverletzt").unwrap().etb_label(),
            "unverletzt"
        );
    }

    #[test]
    fn verbleib_art_roundtrip() {
        for a in [
            "transport",
            "entlassung",
            "vor_ort",
            "verstorben",
            "notunterkunft",
        ] {
            assert_eq!(VerbleibArt::parse(a).unwrap().as_str(), a);
        }
        assert!(VerbleibArt::parse("teleportation").is_none());
    }

    #[test]
    fn notunterkunft_kurzform_und_etb_sachverhalt() {
        let n = VerbleibArt::Notunterkunft;
        assert_eq!(
            n.kurzform(Some("Turnhalle Ost")),
            "Notunterkunft → Turnhalle Ost"
        );
        assert_eq!(n.kurzform(None), "Notunterkunft");
        // LFH-752: Der ETB-Sachverhalt kennt kein Ziel (Scrub des Verbleibs).
        assert_eq!(n.etb_sachverhalt(), "in Notunterkunft");
        assert_eq!(VerbleibArt::Transport.etb_sachverhalt(), "abtransportiert");
    }

    #[test]
    fn kurzform_und_etb_mit_fahrer_angabe() {
        use TransportDurch::*;
        use VerbleibArt::Transport;
        use VerbleibStatus::*;
        assert_eq!(
            verbleib_kurzform(
                Transport,
                Some("KH Mitte"),
                Some(Abtransportiert),
                Some(Fremd),
                Some("RTW 3/83-2")
            ),
            "Transport → KH Mitte"
        );
        assert_eq!(
            verbleib_kurzform(
                Transport,
                Some("KH Mitte"),
                Some(Abtransportiert),
                Some(Eigen),
                Some("1/83-1")
            ),
            "Eigentransport 1/83-1 → KH Mitte"
        );
        assert_eq!(
            verbleib_kurzform(
                Transport,
                None,
                Some(Abtransportiert),
                Some(Eigen),
                Some("1/83-1")
            ),
            "Eigentransport 1/83-1"
        );
        assert_eq!(
            verbleib_kurzform(
                Transport,
                Some("KH Mitte"),
                Some(Uebergeben),
                Some(Eigen),
                Some("1/83-1")
            ),
            "übergeben → KH Mitte"
        );
        assert_eq!(
            verbleib_kurzform(Transport, None, Some(Uebergeben), Some(Eigen), None),
            "übergeben"
        );
        assert_eq!(
            verbleib_etb_sachverhalt(Transport, Some(Abtransportiert), Some(Eigen)),
            "im Eigentransport"
        );
        assert_eq!(
            verbleib_etb_sachverhalt(Transport, Some(Uebergeben), Some(Eigen)),
            "übergeben"
        );
        assert_eq!(
            verbleib_etb_sachverhalt(Transport, Some(Abtransportiert), Some(Fremd)),
            "abtransportiert"
        );
        assert_eq!(
            verbleib_etb_sachverhalt(VerbleibArt::Entlassung, None, None),
            "entlassen"
        );
    }

    #[test]
    fn verbleib_status_roundtrip() {
        for s in ["angemeldet", "abtransportiert"] {
            assert_eq!(VerbleibStatus::parse(s).unwrap().as_str(), s);
        }
        assert!(VerbleibStatus::parse("unsinn").is_none());
    }

    #[test]
    fn abgleich_status_roundtrip() {
        for s in ["verdacht", "bestaetigt", "verworfen"] {
            assert_eq!(AbgleichStatus::parse(s).unwrap().as_str(), s);
        }
        assert!(AbgleichStatus::parse("unsinn").is_none());
    }
}

// ── System-ETB-Wortlaute (LFH-690) ──────────────────────────────────────────────────
// Reine Textbausteine: Handler und Demo-Import rufen dieselbe Funktion, damit ein
// importierter Einsatz dieselben ETB-Texte trägt wie ein echter.

/// System-ETB beim Erfassen einer Person: «Person R-001 erfasst».
pub fn etb_text_erfasst(registrier_nr: i64) -> String {
    format!("Person {} erfasst", registrier_anzeige(registrier_nr))
}

/// System-ETB der Erst-Sichtung beim Anlegen: «Person R-001: Sichtung SK II».
pub fn etb_text_sichtung(registrier_nr: i64, kategorie: Sichtungskategorie) -> String {
    format!(
        "Person {}: Sichtung {}",
        registrier_anzeige(registrier_nr),
        kategorie.etb_label()
    )
}

/// Höchstlänge der PAT-Nummer (LLH-1326, Spec `betroffene-lagedaten`): die Nummer einer
/// Papier-Patientenanhängetasche, ein kurzer Freitext zum Abgleich. Spiegel:
/// `frontend/src/api/eingabegrenzen.ts`.
pub const PAT_NUMMER_MAX: usize = 32;

/// Höchstlänge von Name und Vorname einer Person (LLH-1329, Spec `eingabegrenzen`, design.md D7
/// der Change `f8218h1i-personendaten-feldweise`). Die Grenzen der Personen-Freitexte sind
/// großzügig, damit eine vorgemerkte Anlage aus der Warteschlange nicht scheitert. Spiegel:
/// `frontend/src/api/eingabegrenzen.ts`.
pub const PERSON_NAME_MAX: usize = 200;

/// Höchstlänge von Herkunft / Adresse, Fundort (`antreff_ort`) und Melder / Kontakt (LLH-1329).
pub const PERSON_ANGABE_MAX: usize = 500;

/// Höchstlänge von „Zustand / Verdacht“ (LLH-1329).
pub const PERSON_ZUSTAND_MAX: usize = 500;

/// Höchstlänge der Notiz in den Personendaten (LLH-1329).
pub const PERSON_NOTIZ_MAX: usize = 2_000;

/// Höchstlänge einer Verlaufsnotiz (`POST …/notizen`, LLH-1329).
pub const VERLAUFSNOTIZ_MAX: usize = 2_000;

/// Höchstlänge der Notiz einer Verletzung (LLH-1113, Spec `personen-verletzungen`): ein kurzer
/// Zusatz zur Markierung am Körperschema, kein Befundtext. Spiegel:
/// `frontend/src/api/eingabegrenzen.ts`.
pub const VERLETZUNG_NOTIZ_MAX: usize = 200;

/// System-ETB einer nachgereichten älteren Sichtung (LLH-1138, Spec `personen-verlauf`): sie
/// steht im Verlauf, die aktuelle bleibt. «Person R-001: Sichtung SK I, nachgetragen, aktuelle
/// Sichtung bleibt SK II». Beide Kategorien sind Statuskategorien (Retain), kein Befund.
pub fn etb_text_sichtung_nachgetragen(
    registrier_nr: i64,
    kategorie: Sichtungskategorie,
    aktuell: Sichtungskategorie,
) -> String {
    format!(
        "{}, nachgetragen, aktuelle Sichtung bleibt {}",
        etb_text_sichtung(registrier_nr, kategorie),
        aktuell.etb_label()
    )
}

/// Hängt eine namentliche Bestätigung am Gerät an einen System-ETB-Text (LFH-1046):
/// «Person R-001: Sichtung SK II, bestätigt: Dr. A. Muster». Der Name ist eine Einsatzkraft
/// (`einsatz_personal.snap_name`), kein Wert von Betroffenen (LFH-752, Gruppe Einsatzkraft).
pub fn etb_text_bestaetigt(
    text: String,
    bestaetigung: Option<&crate::geraet::bestaetigung::Bestaetigung>,
) -> String {
    match bestaetigung {
        Some(b) => format!("{text}, bestätigt: {}", b.name),
        None => text,
    }
}

/// System-ETB des UHS-Eintritts beim Anlegen (ohne Platz, also in die Inbox).
pub fn etb_text_uhs_aufnahme(registrier_nr: i64, uhs_bezeichnung: &str) -> String {
    format!(
        "Person {}: Aufnahme in {} (Inbox)",
        registrier_anzeige(registrier_nr),
        uhs_bezeichnung,
    )
}

#[cfg(test)]
mod etb_text_tests {
    use super::*;

    #[test]
    fn erfasst_sichtung_und_uhs_aufnahme() {
        assert_eq!(etb_text_erfasst(1), "Person R-001 erfasst");
        assert_eq!(
            etb_text_sichtung(42, Sichtungskategorie::parse("sk2").unwrap()),
            "Person R-042: Sichtung SK II"
        );
        assert_eq!(
            etb_text_uhs_aufnahme(7, "BHP 50"),
            "Person R-007: Aufnahme in BHP 50 (Inbox)"
        );
    }
}
