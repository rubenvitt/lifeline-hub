//! Fachmodul Betreuung (LFH-639): Evakuierung und Betreuungsstellen als **Mengen**.
//!
//! Zwei Objekte mit je einer append-only Meldereihe: der **Evakuierungsbezirk** (Plangröße,
//! Räumungszustand) mit Standmeldungen „evakuiert“ und die **Betreuungsstelle** (Art,
//! Kapazität, Status) mit Belegungsmeldungen „untergebracht“. Gezählt wird dort, wo Menschen
//! durch eine Tür kommen; einzelne Personen kennt das Modul nicht (keine Verknüpfung mit der
//! Personenauskunft, design.md Non-Goals).
//!
//! **„Aktuell“ ist die nicht zurückgenommene Meldung mit dem jüngsten Zeitpunkt**, bei
//! Gleichstand die größere `id` (design.md D2). Eine nachgetragene ältere Meldung dreht den
//! Stand deshalb nicht zurück. Die Definition steht genau einmal in `repo`.
//!
//! **ETB-Texte tragen nur Bezeichnung und Zahlen**, nie Sammelstelle, Standort oder Notiz
//! (D5): `etb_eintrag.inhalt` bleibt beim Schwärzen erhalten. Die Textfunktionen in
//! [`etb_text`] nehmen diese Freitexte deshalb gar nicht erst entgegen.
//!
//! Spec: `openspec/changes/lfh-639-fachmodul-betreuung/`

use serde::Serialize;
use utoipa::ToSchema;

use crate::error::AppError;
use crate::etb::{TYP_ENTSCHEIDUNG, TYP_MELDUNG};

pub mod repo;

/// Erhebungsart einer Zahl (Plangröße oder Stand). Wire == `as_str()`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum Erhebung {
    Gezaehlt,
    Geschaetzt,
}

impl Erhebung {
    pub const ALLE: [Erhebung; 2] = [Erhebung::Gezaehlt, Erhebung::Geschaetzt];

    pub fn as_str(&self) -> &'static str {
        match self {
            Erhebung::Gezaehlt => "gezaehlt",
            Erhebung::Geschaetzt => "geschaetzt",
        }
    }

    pub fn parse(s: &str) -> Option<Erhebung> {
        match s {
            "gezaehlt" => Some(Erhebung::Gezaehlt),
            "geschaetzt" => Some(Erhebung::Geschaetzt),
            _ => None,
        }
    }

    /// Wortlaut im ETB.
    pub fn label(&self) -> &'static str {
        match self {
            Erhebung::Gezaehlt => "gezählt",
            Erhebung::Geschaetzt => "geschätzt",
        }
    }
}

impl TryFrom<String> for Erhebung {
    type Error = String;

    fn try_from(s: String) -> Result<Self, Self::Error> {
        Erhebung::parse(&s)
            .ok_or_else(|| format!("Unbekannte Erhebungsart '{s}' (erlaubt: gezaehlt, geschaetzt)"))
    }
}

/// Räumungszustand eines Evakuierungsbezirks. Wire == `as_str()`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum Raeumungszustand {
    /// Evakuierung angeordnet, Räumung noch nicht begonnen (Vorgabe).
    Angeordnet,
    Laeuft,
    Geraeumt,
    /// Anordnung aufgehoben; der Bezirk zählt in keiner Kennzahl mehr.
    Aufgehoben,
}

impl Raeumungszustand {
    pub const ALLE: [Raeumungszustand; 4] = [
        Raeumungszustand::Angeordnet,
        Raeumungszustand::Laeuft,
        Raeumungszustand::Geraeumt,
        Raeumungszustand::Aufgehoben,
    ];

    pub fn as_str(&self) -> &'static str {
        match self {
            Raeumungszustand::Angeordnet => "angeordnet",
            Raeumungszustand::Laeuft => "laeuft",
            Raeumungszustand::Geraeumt => "geraeumt",
            Raeumungszustand::Aufgehoben => "aufgehoben",
        }
    }

    pub fn parse(s: &str) -> Option<Raeumungszustand> {
        match s {
            "angeordnet" => Some(Raeumungszustand::Angeordnet),
            "laeuft" => Some(Raeumungszustand::Laeuft),
            "geraeumt" => Some(Raeumungszustand::Geraeumt),
            "aufgehoben" => Some(Raeumungszustand::Aufgehoben),
            _ => None,
        }
    }

    pub fn label(&self) -> &'static str {
        match self {
            Raeumungszustand::Angeordnet => "angeordnet",
            Raeumungszustand::Laeuft => "läuft",
            Raeumungszustand::Geraeumt => "geräumt",
            Raeumungszustand::Aufgehoben => "aufgehoben",
        }
    }

    /// ETB-Typ eines Wechsels in diesen Zustand (D5): Anordnen und Aufheben sind
    /// Entscheidungen, Räumung läuft/geräumt sind Meldungen über die Lage.
    pub fn etb_typ(&self) -> &'static str {
        match self {
            Raeumungszustand::Angeordnet | Raeumungszustand::Aufgehoben => TYP_ENTSCHEIDUNG,
            Raeumungszustand::Laeuft | Raeumungszustand::Geraeumt => TYP_MELDUNG,
        }
    }
}

impl TryFrom<String> for Raeumungszustand {
    type Error = String;

    fn try_from(s: String) -> Result<Self, Self::Error> {
        Raeumungszustand::parse(&s).ok_or_else(|| {
            format!(
                "Unbekannter Räumungszustand '{s}' (erlaubt: angeordnet, laeuft, geraeumt, aufgehoben)"
            )
        })
    }
}

/// Einrichtungsstufe einer Betreuungsstelle (DRK-Glossar Betreuungsdienst). Eine Kategorie,
/// kein Zustand — sie bekommt keine Statusfarbe (D8). Wire == `as_str()`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum BetreuungsstelleArt {
    Anlaufstelle,
    Betreuungsstelle,
    Betreuungsplatz,
    Notunterkunft,
}

impl BetreuungsstelleArt {
    pub const ALLE: [BetreuungsstelleArt; 4] = [
        BetreuungsstelleArt::Anlaufstelle,
        BetreuungsstelleArt::Betreuungsstelle,
        BetreuungsstelleArt::Betreuungsplatz,
        BetreuungsstelleArt::Notunterkunft,
    ];

    pub fn as_str(&self) -> &'static str {
        match self {
            BetreuungsstelleArt::Anlaufstelle => "anlaufstelle",
            BetreuungsstelleArt::Betreuungsstelle => "betreuungsstelle",
            BetreuungsstelleArt::Betreuungsplatz => "betreuungsplatz",
            BetreuungsstelleArt::Notunterkunft => "notunterkunft",
        }
    }

    pub fn parse(s: &str) -> Option<BetreuungsstelleArt> {
        match s {
            "anlaufstelle" => Some(BetreuungsstelleArt::Anlaufstelle),
            "betreuungsstelle" => Some(BetreuungsstelleArt::Betreuungsstelle),
            "betreuungsplatz" => Some(BetreuungsstelleArt::Betreuungsplatz),
            "notunterkunft" => Some(BetreuungsstelleArt::Notunterkunft),
            _ => None,
        }
    }

    pub fn label(&self) -> &'static str {
        match self {
            BetreuungsstelleArt::Anlaufstelle => "Anlaufstelle",
            BetreuungsstelleArt::Betreuungsstelle => "Betreuungsstelle",
            BetreuungsstelleArt::Betreuungsplatz => "Betreuungsplatz",
            BetreuungsstelleArt::Notunterkunft => "Notunterkunft",
        }
    }
}

impl TryFrom<String> for BetreuungsstelleArt {
    type Error = String;

    fn try_from(s: String) -> Result<Self, Self::Error> {
        BetreuungsstelleArt::parse(&s).ok_or_else(|| {
            format!(
                "Unbekannte Art '{s}' (erlaubt: anlaufstelle, betreuungsstelle, betreuungsplatz, notunterkunft)"
            )
        })
    }
}

/// Betriebsstatus einer Betreuungsstelle. `geschlossen` ist umkehrbar (D4). Wire == `as_str()`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum BetreuungsstelleStatus {
    Vorbereitet,
    InBetrieb,
    Geschlossen,
}

impl BetreuungsstelleStatus {
    pub const ALLE: [BetreuungsstelleStatus; 3] = [
        BetreuungsstelleStatus::Vorbereitet,
        BetreuungsstelleStatus::InBetrieb,
        BetreuungsstelleStatus::Geschlossen,
    ];

    pub fn as_str(&self) -> &'static str {
        match self {
            BetreuungsstelleStatus::Vorbereitet => "vorbereitet",
            BetreuungsstelleStatus::InBetrieb => "in_betrieb",
            BetreuungsstelleStatus::Geschlossen => "geschlossen",
        }
    }

    pub fn parse(s: &str) -> Option<BetreuungsstelleStatus> {
        match s {
            "vorbereitet" => Some(BetreuungsstelleStatus::Vorbereitet),
            "in_betrieb" => Some(BetreuungsstelleStatus::InBetrieb),
            "geschlossen" => Some(BetreuungsstelleStatus::Geschlossen),
            _ => None,
        }
    }

    pub fn label(&self) -> &'static str {
        match self {
            BetreuungsstelleStatus::Vorbereitet => "vorbereitet",
            BetreuungsstelleStatus::InBetrieb => "in Betrieb",
            BetreuungsstelleStatus::Geschlossen => "geschlossen",
        }
    }
}

impl TryFrom<String> for BetreuungsstelleStatus {
    type Error = String;

    fn try_from(s: String) -> Result<Self, Self::Error> {
        BetreuungsstelleStatus::parse(&s).ok_or_else(|| {
            format!("Unbekannter Status '{s}' (erlaubt: vorbereitet, in_betrieb, geschlossen)")
        })
    }
}

/// Obergrenze je Personenzahl: Plangröße, Stand „evakuiert“, Kapazität, Belegung (LFH-680).
/// Die größten Evakuierungen in Deutschland lagen bei einigen Zehntausend Menschen (Frankfurt
/// 2017: rund 60 000); eine Million in EINEM Bezirk oder EINER Stelle liegt eine
/// Größenordnung darüber und hält trotzdem jede Summe fern vom Überlauf: ohne Grenze lief die
/// `summe` der Kopfzahl über (Debug-Build: Panic im Handler, Release: still negativ), und
/// jenseits von 2^53 zählt eine JS-Number nicht mehr genau. Das Feld scheitert für sich,
/// also **400** — Vorbild `verpflegung::MAX_EP`.
pub const MAX_PERSONEN: i64 = 1_000_000;

/// Liest einen Enum-Wert aus einer Eingabe. Ein unbekannter Wert scheitert am Feld für sich
/// und ist deshalb **400** (CLAUDE.md „Statuscode-Konvention“, `src/error.rs`), nicht 422.
pub fn enum_wert<T: TryFrom<String, Error = String>>(s: &str) -> Result<T, AppError> {
    T::try_from(s.to_string()).map_err(AppError::Validation)
}

// ── Anzeige ─────────────────────────────────────────────────────────────────────────────────

/// Die aktuelle Standmeldung eines Bezirks.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct EvakuierungsstandAnzeige {
    pub id: i64,
    pub evakuiert: i64,
    pub erhebung: Erhebung,
    /// Zeitpunkt der Meldung, UTC ohne Zonenkennung (`YYYY-MM-DD HH:MM:SS`).
    pub zeitpunkt_at: String,
}

/// Die aktuelle Belegungsmeldung einer Stelle.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct BelegungsmeldungAnzeige {
    pub id: i64,
    pub belegt: i64,
    /// Zeitpunkt der Meldung, UTC ohne Zonenkennung (`YYYY-MM-DD HH:MM:SS`).
    pub zeitpunkt_at: String,
}

/// Öffentliche Darstellung eines Evakuierungsbezirks mit seinem aktuellen Stand.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct EvakuierungsbezirkAnzeige {
    pub id: i64,
    pub einsatz_id: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub abschnitt_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub abschnitt_name: Option<String>,
    pub bezeichnung: String,
    pub plan_personen: i64,
    pub plan_erhebung: Erhebung,
    pub raeumung: Raeumungszustand,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sammelstelle: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notiz: Option<String>,
    /// Zahl der Zonen vom Typ `evakuierungsbezirk`, die diesem Bezirk zugeordnet sind
    /// (LFH-673). Immer gesetzt, 0 ohne Fläche — die Betreuungsseite bietet „Auf Karte
    /// zeigen" nur bei > 0 an und braucht dafür keine Zonenliste (die hängt am Modul Lagekarte).
    pub flaechen: i64,
    /// Fehlt, solange keine (nicht zurückgenommene) Standmeldung vorliegt — „keine Meldung“
    /// ist nicht „0 evakuiert“.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stand: Option<EvakuierungsstandAnzeige>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub storniert_at: Option<String>,
    pub angelegt_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub geaendert_at: Option<String>,
}

/// Öffentliche Darstellung einer Betreuungsstelle mit ihrer aktuellen Belegung.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct BetreuungsstelleAnzeige {
    pub id: i64,
    pub einsatz_id: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub abschnitt_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub abschnitt_name: Option<String>,
    pub bezeichnung: String,
    pub art: BetreuungsstelleArt,
    /// Fehlt bei unbekannter Kapazität; dann gibt es auch keine Zahl freier Plätze.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kapazitaet_personen: Option<i64>,
    pub status: BetreuungsstelleStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub standort: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notiz: Option<String>,
    /// Koordinate auf der Lagekarte (LFH-673). Beide fehlen = nicht verortet; die App hält
    /// sie als Paar.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lat: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lon: Option<f64>,
    /// Fehlt, solange keine (nicht zurückgenommene) Belegungsmeldung vorliegt.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub belegung: Option<BelegungsmeldungAnzeige>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub storniert_at: Option<String>,
    pub angelegt_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub geaendert_at: Option<String>,
}

/// Die eine Lesequelle der Modulseite (`GET …/betreuung`): alle nicht stornierten Bezirke
/// und Stellen eines Einsatzes.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct BetreuungUebersicht {
    pub bezirke: Vec<EvakuierungsbezirkAnzeige>,
    pub stellen: Vec<BetreuungsstelleAnzeige>,
    /// „davon namentlich“ (LFH-674): je Stelle die Zahl der Personen, deren jüngster Verbleib
    /// `notunterkunft` an dieser Stelle ist — nur Stellen mit mindestens einer Person. Fehlt
    /// ganz, wenn der Lesende das Modul Personen nicht sehen darf (nicht „0“). Gefüllt NUR in
    /// der Route: `repo::uebersicht` speist auch den gesicherten Lagestand. Die Zahl geht in
    /// keine Belegung, Kopfzahl oder Summe ein — führend ist die Mengenmeldung.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub namentlich: Option<Vec<StelleNamentlich>>,
}

/// Namentlich zugeordnete Personen an einer Stelle (LFH-674), Teil von [`BetreuungUebersicht`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct StelleNamentlich {
    pub stelle_id: i64,
    pub anzahl: i64,
}

/// Belegung einer Stelle zum Stichtag der Kopfzahl.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct BelegungKopfzahlStelle {
    pub stelle_id: i64,
    pub bezeichnung: String,
    /// Fehlt, wenn die Stelle bis zum Stichtag keine Meldung hat — sie zählt dann nicht mit.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub belegt: Option<i64>,
    /// Zeitpunkt der maßgeblichen Meldung.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub zeitpunkt_at: Option<String>,
}

/// Antwort auf „Stand melden“ und „Standmeldung zurücknehmen“: die ID der gemeldeten bzw.
/// zurückgenommenen Meldung und der Bezirk danach. Die ID steht eigens da, weil `bezirk.stand`
/// die AKTUELLE Meldung ist — bei einer nachgetragenen älteren Meldung eine andere, und ein
/// Rückgängig über `stand.id` nähme dann die falsche zurück.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct BezirkMeldungAnzeige {
    pub meldung_id: i64,
    pub bezirk: EvakuierungsbezirkAnzeige,
}

/// Antwort auf „Belegung melden“ und „Belegungsmeldung zurücknehmen“, gebaut wie
/// [`BezirkMeldungAnzeige`].
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct StelleMeldungAnzeige {
    pub meldung_id: i64,
    pub stelle: BetreuungsstelleAnzeige,
}

/// Kopfzahl „in Betreuung“ zu einem Zeitpunkt (Verpflegung, LFH-634). Ohne Personenbezug.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct BelegungKopfzahl {
    /// Stichtag, UTC ohne Zonenkennung.
    pub zeitpunkt_at: String,
    /// Summe über die Stellen MIT Meldung bis zum Stichtag. Ist `stellen_ohne_meldung` > 0,
    /// ist die Summe eine Untergrenze; bei 0 Stellen mit Meldung heißt `summe = 0` „nichts
    /// gemeldet“, nicht „niemand in Betreuung“.
    pub summe: i64,
    /// Zahl der Stellen, die bis zum Stichtag keine Meldung haben. Mitgezählt wird nur, wer zum
    /// Stichtag betrieben sein konnte: nicht nach ihm angelegt und nicht jetzt geschlossen oder
    /// vorbereitet ohne jede Meldung (LFH-679). Solche Stellen fehlen auch in `stellen`.
    pub stellen_ohne_meldung: i64,
    pub stellen: Vec<BelegungKopfzahlStelle>,
}

// ── ETB-Texte ───────────────────────────────────────────────────────────────────────────────

/// Reine Textfunktionen für die ETB-Sätze (design.md D5). Sie nehmen **keine** Freitexte
/// (Sammelstelle, Standort, Notiz) entgegen; eine Änderung daran erscheint nur als
/// „weitere Angaben“.
pub mod etb_text {
    use super::{BetreuungsstelleArt, BetreuungsstelleStatus, Erhebung, Raeumungszustand};

    /// Bezeichnung in deutschen einfachen Anführungszeichen.
    fn q(bezeichnung: &str) -> String {
        format!("‚{bezeichnung}‘")
    }

    /// Welche Stammdaten eines Bezirks sich geändert haben (ohne Plangröße und Räumung, die
    /// je einen eigenen Eintrag bekommen).
    #[derive(Debug, Default, Clone, Copy)]
    pub struct BezirkStammdaten<'a> {
        /// Die bisherige Bezeichnung, wenn sie sich geändert hat.
        pub bezeichnung_vorher: Option<&'a str>,
        pub abschnitt: bool,
        /// Sammelstelle und/oder Notiz.
        pub weitere_angaben: bool,
    }

    impl BezirkStammdaten<'_> {
        pub fn leer(&self) -> bool {
            self.bezeichnung_vorher.is_none() && !self.abschnitt && !self.weitere_angaben
        }
    }

    /// Welche Stammdaten einer Stelle sich geändert haben (ohne Status, der einen eigenen
    /// Eintrag bekommt).
    #[derive(Debug, Default, Clone, Copy)]
    pub struct StelleStammdaten<'a> {
        pub bezeichnung_vorher: Option<&'a str>,
        /// `(vorher, neu)`
        pub art: Option<(BetreuungsstelleArt, BetreuungsstelleArt)>,
        /// `(vorher, neu)`
        pub kapazitaet: Option<(Option<i64>, Option<i64>)>,
        pub abschnitt: bool,
        /// Standort und/oder Notiz.
        pub weitere_angaben: bool,
    }

    impl StelleStammdaten<'_> {
        pub fn leer(&self) -> bool {
            self.bezeichnung_vorher.is_none()
                && self.art.is_none()
                && self.kapazitaet.is_none()
                && !self.abschnitt
                && !self.weitere_angaben
        }
    }

    pub fn bezirk_angelegt(bezeichnung: &str, plan: i64, erhebung: Erhebung) -> String {
        format!(
            "Evakuierung Bezirk {} angeordnet, Plangröße {plan} ({}).",
            q(bezeichnung),
            erhebung.label()
        )
    }

    pub fn plan_geaendert(
        bezeichnung: &str,
        plan: i64,
        erhebung: Erhebung,
        plan_vorher: i64,
        erhebung_vorher: Erhebung,
    ) -> String {
        format!(
            "Plangröße Bezirk {} auf {plan} ({}) gesetzt, vorher {plan_vorher} ({}).",
            q(bezeichnung),
            erhebung.label(),
            erhebung_vorher.label()
        )
    }

    /// Der ETB-Typ dazu ist [`Raeumungszustand::etb_typ`].
    pub fn raeumung_gewechselt(bezeichnung: &str, zustand: Raeumungszustand) -> String {
        let b = q(bezeichnung);
        match zustand {
            Raeumungszustand::Angeordnet | Raeumungszustand::Aufgehoben => {
                format!("Evakuierung Bezirk {b} {}.", zustand.label())
            }
            Raeumungszustand::Laeuft => format!("Bezirk {b}: Räumung läuft."),
            Raeumungszustand::Geraeumt => format!("Bezirk {b} geräumt."),
        }
    }

    fn bezeichnung_teil(vorher: Option<&str>) -> Option<String> {
        vorher.map(|v| format!("Bezeichnung (vorher {})", q(v)))
    }

    pub fn bezirk_geaendert(bezeichnung: &str, s: BezirkStammdaten<'_>) -> String {
        let mut teile: Vec<String> = Vec::new();
        teile.extend(bezeichnung_teil(s.bezeichnung_vorher));
        if s.abschnitt {
            teile.push("Einsatzabschnitt".into());
        }
        if s.weitere_angaben {
            teile.push("weitere Angaben".into());
        }
        format!("Bezirk {} geändert: {}.", q(bezeichnung), teile.join(", "))
    }

    pub fn bezirk_storniert(bezeichnung: &str) -> String {
        format!("Evakuierungsbezirk {} storniert.", q(bezeichnung))
    }

    pub fn stand_gemeldet(
        bezeichnung: &str,
        evakuiert: i64,
        erhebung: Erhebung,
        vorher: Option<i64>,
        plan: i64,
    ) -> String {
        let vorher = vorher.map(|v| format!(", vorher {v}")).unwrap_or_default();
        format!(
            "Bezirk {}: {evakuiert} evakuiert ({}){vorher}, Plan {plan}.",
            q(bezeichnung),
            erhebung.label()
        )
    }

    /// Eine nachgetragene Standmeldung: ihr Zeitpunkt liegt STRIKT vor dem der aktuellen
    /// Meldung, der Stand bleibt also stehen (D2). „vorher N“ stünde hier falsch — mit der
    /// Ereigniszeit der Nachtragung läse es sich als Rückgang, den es nie gab, und das ETB ist
    /// nicht berichtigbar. `aktuell` = der Stand, der bleibt.
    pub fn stand_nachgetragen(
        bezeichnung: &str,
        evakuiert: i64,
        erhebung: Erhebung,
        aktuell: i64,
        plan: i64,
    ) -> String {
        format!(
            "Bezirk {}: {evakuiert} evakuiert ({}), nachgetragen, aktueller Stand bleibt \
             {aktuell}, Plan {plan}.",
            q(bezeichnung),
            erhebung.label()
        )
    }

    /// `jetzt` = der nach der Rücknahme aktuelle Stand. `war_aktuell`: die zurückgenommene
    /// Meldung war die aktuelle — nur dann ändert sich der Stand („wieder N“); sonst bleibt er
    /// („bleibt N“), und „wieder“ unterstellte eine Änderung, die es nicht gab.
    pub fn stand_zurueckgenommen(
        bezeichnung: &str,
        jetzt: Option<i64>,
        war_aktuell: bool,
    ) -> String {
        match (jetzt, war_aktuell) {
            (Some(n), true) => format!(
                "Meldung zurückgenommen, Stand Bezirk {} wieder {n}.",
                q(bezeichnung)
            ),
            (Some(n), false) => format!(
                "Meldung zurückgenommen, Stand Bezirk {} bleibt {n}.",
                q(bezeichnung)
            ),
            (None, _) => format!(
                "Meldung zurückgenommen, Bezirk {} ohne Standmeldung.",
                q(bezeichnung)
            ),
        }
    }

    pub fn stelle_angelegt(
        bezeichnung: &str,
        art: BetreuungsstelleArt,
        kapazitaet: Option<i64>,
    ) -> String {
        let kapazitaet = kapazitaet
            .map(|k| format!(", Kapazität {k}"))
            .unwrap_or_default();
        format!(
            "Betreuungsstelle {} ({}) angelegt{kapazitaet}.",
            q(bezeichnung),
            art.label()
        )
    }

    fn kapazitaet_text(k: Option<i64>) -> String {
        k.map(|k| k.to_string())
            .unwrap_or_else(|| "ohne Angabe".into())
    }

    pub fn stelle_geaendert(bezeichnung: &str, s: StelleStammdaten<'_>) -> String {
        let mut teile: Vec<String> = Vec::new();
        teile.extend(bezeichnung_teil(s.bezeichnung_vorher));
        if let Some((vorher, neu)) = s.art {
            teile.push(format!("Art {} (vorher {})", neu.label(), vorher.label()));
        }
        if let Some((vorher, neu)) = s.kapazitaet {
            teile.push(format!(
                "Kapazität {} (vorher {})",
                kapazitaet_text(neu),
                kapazitaet_text(vorher)
            ));
        }
        if s.abschnitt {
            teile.push("Einsatzabschnitt".into());
        }
        if s.weitere_angaben {
            teile.push("weitere Angaben".into());
        }
        format!(
            "Betreuungsstelle {} geändert: {}.",
            q(bezeichnung),
            teile.join(", ")
        )
    }

    pub fn stelle_status(
        bezeichnung: &str,
        status: BetreuungsstelleStatus,
        vorher: BetreuungsstelleStatus,
    ) -> String {
        format!(
            "Betreuungsstelle {}: {} (vorher {}).",
            q(bezeichnung),
            status.label(),
            vorher.label()
        )
    }

    pub fn stelle_storniert(bezeichnung: &str) -> String {
        format!("Betreuungsstelle {} storniert.", q(bezeichnung))
    }

    pub fn belegung_gemeldet(
        bezeichnung: &str,
        belegt: i64,
        vorher: Option<i64>,
        kapazitaet: Option<i64>,
    ) -> String {
        let vorher = vorher.map(|v| format!(", vorher {v}")).unwrap_or_default();
        let kapazitaet = kapazitaet
            .map(|k| format!(", Kapazität {k}"))
            .unwrap_or_default();
        format!(
            "Betreuungsstelle {}: {belegt} untergebracht{vorher}{kapazitaet}.",
            q(bezeichnung)
        )
    }

    /// Eine nachgetragene Belegungsmeldung, wie [`stand_nachgetragen`]. `aktuell` = die
    /// Belegung, die bleibt.
    pub fn belegung_nachgetragen(
        bezeichnung: &str,
        belegt: i64,
        aktuell: i64,
        kapazitaet: Option<i64>,
    ) -> String {
        let kapazitaet = kapazitaet
            .map(|k| format!(", Kapazität {k}"))
            .unwrap_or_default();
        format!(
            "Betreuungsstelle {}: {belegt} untergebracht, nachgetragen, aktuelle Belegung \
             bleibt {aktuell}{kapazitaet}.",
            q(bezeichnung)
        )
    }

    /// `jetzt` = die nach der Rücknahme aktuelle Belegung; `war_aktuell` wie bei
    /// [`stand_zurueckgenommen`].
    pub fn belegung_zurueckgenommen(
        bezeichnung: &str,
        jetzt: Option<i64>,
        war_aktuell: bool,
    ) -> String {
        match (jetzt, war_aktuell) {
            (Some(n), true) => format!(
                "Meldung zurückgenommen, Belegung Betreuungsstelle {} wieder {n}.",
                q(bezeichnung)
            ),
            (Some(n), false) => format!(
                "Meldung zurückgenommen, Belegung Betreuungsstelle {} bleibt {n}.",
                q(bezeichnung)
            ),
            (None, _) => format!(
                "Meldung zurückgenommen, Betreuungsstelle {} ohne Belegungsmeldung.",
                q(bezeichnung)
            ),
        }
    }
}

#[cfg(test)]
mod tests;
