//! Fachmodul Verpflegung (LFH-634): Verpflegungszeitfenster mit erfasstem Bedarf in
//! Essensportionen (EP) und append-only Ausgaben dagegen.
//!
//! **Zeitfenster statt Schicht:** ein Zeitfenster („Mittag“, 12:00–13:30) gilt für den ganzen
//! Einsatz und hängt an keiner Schicht einer Einheit (design.md Context). Zeitfenster dürfen
//! sich überschneiden.
//!
//! **Der Bedarf wird erfasst, nicht gerechnet.** Die Oberfläche schlägt ihn aus Personal und
//! Betreuung vor; gespeichert wird die Zahl, und sie wird danach nicht aus den Quellen
//! nachgezogen (sonst verschöbe sich die Unterdeckung vergangener Zeitfenster still).
//!
//! **Deckung und Fehlmenge rechnet genau eine Stelle**, [`deckung::rechne`]. Eine Einstufung
//! („gedeckt“/„offen“/„Unterdeckung“) liefert das Backend NICHT: sie hängt an der Uhr und
//! wäre zwischen zwei Abrufen veraltet (design.md D2).
//!
//! **Sonderkost ist eine Teilmenge, kein Zuschlag**, und ohne Personenbezug: fünf feste
//! Kostformen als Anzahl ([`Sonderkost`]).
//!
//! **Nachschub läuft über die Nachforderung.** Eine Ausgabe trägt von ihr nur die Kennung
//! (`nachforderung_id`), nichts Hineingejointes — sonst läse jemand mit Zugriff auf
//! Verpflegung, aber ohne Zugriff auf Nachforderungen, deren Angaben (design.md D4).
//!
//! **Verpflegungsstellen** (LLH-1040, [`stelle`]): wo ausgegeben wird, mit Status wie beim
//! Bereitstellungsraum. Ein Zeitfenster gilt an einer oder mehreren Stellen (Zuordnung n:m),
//! ohne Zuordnung einsatzweit wie bisher. **Das Soll bleibt am Zeitfenster**; je Stelle gibt es
//! nur das Ist (`je_stelle`), gerechnet in derselben [`deckung::rechne`]. Eine Ausgabe verweist
//! optional per `verpflegungsstelle_id` auf eine Stelle. Dazu die Verpflegungsart (warm, kalt,
//! Getränke) am Zeitfenster, nur Anzeige.
//!
//! Spec: `openspec/specs/kraefte-verpflegung/spec.md` (Herleitung
//! `openspec/changes/archive/2026-09-29-lfh-634-fachmodul-verpflegung/`, Stellen LLH-1040).

use chrono::{DateTime, Utc};
use chrono_tz::Tz;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::error::AppError;

pub mod deckung;
pub mod repo;
pub mod stelle;

use crate::wire_enum::wire_enum;
use stelle::VerpflegungsstelleAnzeige;

wire_enum! {
    /// Verpflegungsart eines Zeitfensters (LLH-1024 F5, LLH-1040 D8): nur Anzeige, die Deckung
    /// gilt für alle Arten gleich. String = CHECK in `migrations/0206_verpflegungsstelle.sql`;
    /// keine Art (`NULL`) heißt „ohne Angabe“.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum Verpflegungsart {
        Warm => "warm",
        Kalt => "kalt",
        Getraenke => "getraenke",
    }
    try_from = |s| format!("Ungültige Verpflegungsart: {s}");
}

impl Verpflegungsart {
    /// Das Wort für den ETB-Text („Getränke“).
    pub const fn wort(self) -> &'static str {
        match self {
            Verpflegungsart::Warm => "warm",
            Verpflegungsart::Kalt => "kalt",
            Verpflegungsart::Getraenke => "Getränke",
        }
    }
}

// ── Sonderkost ──────────────────────────────────────────────────────────────────────────────

/// Anzahl EP je Kostform, ohne Personenbezug. Der Satz der Kostformen ist fest; der Rest bis
/// zur Gesamtzahl ist Normalkost.
//
// Eine sechste Kostform ist eine additive Spalte und ein Feld mehr hier, im generierten Typ
// damit exhaustiv sichtbar (design.md D1).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, ToSchema)]
pub struct Sonderkost {
    pub vegetarisch: i64,
    pub vegan: i64,
    pub ohne_schwein: i64,
    pub diaet_allergenarm: i64,
    pub saeugling_kleinkind: i64,
}

impl Sonderkost {
    /// Die fünf Kostformen als `(Feldname, Anzahl)` — für Prüfungen mit Feldnamen.
    fn felder(&self) -> [(&'static str, i64); 5] {
        [
            ("vegetarisch", self.vegetarisch),
            ("vegan", self.vegan),
            ("ohne_schwein", self.ohne_schwein),
            ("diaet_allergenarm", self.diaet_allergenarm),
            ("saeugling_kleinkind", self.saeugling_kleinkind),
        ]
    }

    /// Summe aller Kostformen (Anteil der Sonderkost an der Gesamtzahl).
    pub fn summe(&self) -> i64 {
        self.felder().iter().map(|(_, n)| n).sum()
    }

    /// Je Kostform `self + andere`.
    pub fn plus(&self, andere: &Sonderkost) -> Sonderkost {
        Sonderkost {
            vegetarisch: self.vegetarisch + andere.vegetarisch,
            vegan: self.vegan + andere.vegan,
            ohne_schwein: self.ohne_schwein + andere.ohne_schwein,
            diaet_allergenarm: self.diaet_allergenarm + andere.diaet_allergenarm,
            saeugling_kleinkind: self.saeugling_kleinkind + andere.saeugling_kleinkind,
        }
    }

    /// Je Kostform `max(0, self − ausgegeben)`: eine Überdeckung in einer Kostform deckt keine
    /// andere.
    pub fn fehlmenge(&self, ausgegeben: &Sonderkost) -> Sonderkost {
        let f = |b: i64, a: i64| (b - a).max(0);
        Sonderkost {
            vegetarisch: f(self.vegetarisch, ausgegeben.vegetarisch),
            vegan: f(self.vegan, ausgegeben.vegan),
            ohne_schwein: f(self.ohne_schwein, ausgegeben.ohne_schwein),
            diaet_allergenarm: f(self.diaet_allergenarm, ausgegeben.diaet_allergenarm),
            saeugling_kleinkind: f(self.saeugling_kleinkind, ausgegeben.saeugling_kleinkind),
        }
    }

    /// 400, wenn eine Kostform negativ ist — das Feld scheitert für sich.
    pub fn pruefen(&self) -> Result<(), AppError> {
        for (feld, n) in self.felder() {
            if n < 0 {
                return Err(AppError::Validation(format!(
                    "sonderkost.{feld} darf nicht negativ sein, war {n}"
                )));
            }
            if n > MAX_EP {
                return Err(AppError::Validation(format!(
                    "sonderkost.{feld} darf höchstens {MAX_EP} sein, war {n}"
                )));
            }
        }
        Ok(())
    }
}

/// Sonderkost als Eingabe: jedes Feld optional. Beim Anlegen heißt ein fehlendes Feld 0, beim
/// Ändern „unverändert“ — so bleibt eine Teiländerung eine Teiländerung.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize)]
pub struct SonderkostEingabe {
    #[serde(default)]
    pub vegetarisch: Option<i64>,
    #[serde(default)]
    pub vegan: Option<i64>,
    #[serde(default)]
    pub ohne_schwein: Option<i64>,
    #[serde(default)]
    pub diaet_allergenarm: Option<i64>,
    #[serde(default)]
    pub saeugling_kleinkind: Option<i64>,
}

impl SonderkostEingabe {
    /// Legt die Eingabe über `basis`: gesetzte Felder ersetzen, fehlende bleiben.
    pub fn ueber(&self, basis: &Sonderkost) -> Sonderkost {
        Sonderkost {
            vegetarisch: self.vegetarisch.unwrap_or(basis.vegetarisch),
            vegan: self.vegan.unwrap_or(basis.vegan),
            ohne_schwein: self.ohne_schwein.unwrap_or(basis.ohne_schwein),
            diaet_allergenarm: self.diaet_allergenarm.unwrap_or(basis.diaet_allergenarm),
            saeugling_kleinkind: self
                .saeugling_kleinkind
                .unwrap_or(basis.saeugling_kleinkind),
        }
    }
}

// ── Anzeige ─────────────────────────────────────────────────────────────────────────────────

/// Erfasster Bedarf eines Zeitfensters. `gesamt` ist die Summe der drei Teile.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
pub struct Bedarf {
    pub kraefte: i64,
    pub betreute: i64,
    pub weitere: i64,
    pub gesamt: i64,
    /// Teilmenge von `gesamt`; der Rest ist Normalkost.
    pub sonderkost: Sonderkost,
}

/// Eine Portionenzahl gesamt und je Kostform — die Form von `ausgegeben` und `fehlmenge`.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, ToSchema)]
pub struct Portionen {
    pub gesamt: i64,
    pub sonderkost: Sonderkost,
}

/// Eine Ausgabe gegen ein Zeitfenster. Von der Nachforderung trägt sie NUR die Kennung.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct AusgabeAnzeige {
    pub id: i64,
    pub zeitfenster_id: i64,
    /// UTC ohne Zonenkennung (`YYYY-MM-DD HH:MM:SS`). Darf außerhalb des Zeitfensters liegen
    /// (Anlieferung vor Beginn).
    pub zeitpunkt_at: String,
    pub menge: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ort: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bemerkung: Option<String>,
    pub sonderkost: Sonderkost,
    /// Verweis auf eine Nachforderung desselben Einsatzes — nur die Kennung, keine Angaben
    /// der Nachforderung.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub nachforderung_id: Option<i64>,
    /// Verpflegungsstelle, an der ausgegeben wurde (LLH-1040) — nur die Kennung; die Stelle
    /// steht in `VerpflegungAnzeige.stellen`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub verpflegungsstelle_id: Option<i64>,
    /// Gesetzt, wenn die Ausgabe zurückgenommen ist; sie zählt dann nicht mehr mit.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub zurueckgenommen_at: Option<String>,
    pub erfasst_at: String,
}

/// Ausgegebene Menge an einer Stelle (LLH-1040, design.md D6) — nur das Ist, kein Soll und keine
/// Fehlmenge je Stelle.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
pub struct StelleIst {
    /// Die Stelle; fehlt beim Eintrag „ohne Stelle“ (Ausgaben ohne Stelle), der zuletzt steht.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stelle_id: Option<i64>,
    /// Summe der nicht zurückgenommenen Ausgaben an dieser Stelle, gesamt und je Kostform.
    pub ausgegeben: Portionen,
}

/// Ein Zeitfenster mit Deckung und allen Ausgaben (auch zurückgenommenen).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct ZeitfensterAnzeige {
    pub id: i64,
    pub einsatz_id: i64,
    pub bezeichnung: String,
    /// Beginn, UTC ohne Zonenkennung.
    pub von_at: String,
    /// Ende, UTC ohne Zonenkennung; liegt immer nach `von_at`.
    pub bis_at: String,
    /// Warm, kalt oder Getränke; fehlt = ohne Angabe (LLH-1040 D8).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub verpflegungsart: Option<Verpflegungsart>,
    pub bedarf: Bedarf,
    /// Summe der nicht zurückgenommenen Ausgaben.
    pub ausgegeben: Portionen,
    /// Je `max(0, bedarf − ausgegeben)`, gesamt und je Kostform.
    pub fehlmenge: Portionen,
    /// Die zugeordneten Stellen, nach Bezeichnung; leer = einsatzweit (LLH-1040 D5).
    pub stelle_ids: Vec<i64>,
    /// Ausgegeben je Stelle (D6): jede zugeordnete Stelle (auch mit 0), danach jede weitere mit
    /// Ausgaben, zuletzt „ohne Stelle“. Leer, wenn es weder Zuordnung noch eine Ausgabe an einer
    /// Stelle gibt — dann zeigt das Zeitfenster nur Gesamtwerte wie bisher.
    pub je_stelle: Vec<StelleIst>,
    /// Nach Zeitpunkt, zurückgenommene mit `zurueckgenommen_at`.
    pub ausgaben: Vec<AusgabeAnzeige>,
    pub angelegt_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub geaendert_at: Option<String>,
}

/// Die eine Lesequelle der Modulseite (`GET …/verpflegung`).
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct VerpflegungAnzeige {
    /// Nach Beginn geordnet.
    pub zeitfenster: Vec<ZeitfensterAnzeige>,
    /// Alle nicht stornierten Verpflegungsstellen nach Bezeichnung, auch aufgelöste (die Karte
    /// braucht ihre Namen). Keine eigene Leseroute (LLH-1040 D4).
    pub stellen: Vec<VerpflegungsstelleAnzeige>,
}

/// Antwort auf „Ausgabe erfassen“ und „Ausgabe zurücknehmen“: die Kennung der Ausgabe (für
/// „Rückgängig“) und das Zeitfenster danach.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct AusgabeErgebnis {
    pub ausgabe_id: i64,
    pub zeitfenster: ZeitfensterAnzeige,
}

// ── Zeiten ──────────────────────────────────────────────────────────────────────────────────

/// Obergrenze je Zahlfeld in EP (Bedarfsteil, Menge, Kostform). Eine Verpflegungslage mit mehr
/// als 100 000 Portionen in EINEM Zeitfenster oder EINER Ausgabe gibt es nicht; ohne Grenze
/// ließ die Summe zweier Ausgaben mit `i64::MAX` die Deckung überlaufen (Review LFH-634) —
/// im Release still negativ, im Debug-Build ein Panic bei jedem Abruf. Das Feld scheitert für
/// sich, also 400.
pub const MAX_EP: i64 = 100_000;

// ── Eingabegrenzen (LLH-1040, design.md D10) ────────────────────────────────────────────────
//
// Zeichen nach dem Trimmen, 400 vor jedem 422 (`src/AGENTS.md`, „Eingabegrenzen“), gespiegelt in
// `frontend/src/api/eingabegrenzen.ts` (`VERPFLEGUNG_*`). Bestand über der Grenze bleibt lesbar;
// geprüft werden nur neue Schreibvorgänge.

/// Bezeichnung eines Zeitfensters („Mittag“).
pub const ZEITFENSTER_BEZEICHNUNG_MAX: usize = 200;
/// Bezeichnung einer Verpflegungsstelle („Feldküche BR Sportplatz“). Gelangt ins ETB (D7).
pub const STELLE_BEZEICHNUNG_MAX: usize = 200;
/// Standort einer Verpflegungsstelle (Freitext, Adresse möglich).
pub const STANDORT_MAX: usize = 500;
/// Ort einer Ausgabe („Zuführungsziel“).
pub const ORT_MAX: usize = 500;
/// Bemerkung einer Ausgabe.
pub const BEMERKUNG_MAX: usize = 2_000;
/// Stellen je Zeitfenster im Request, gezählt vor dem Entdoppeln.
pub const STELLEN_JE_ZEITFENSTER_MAX: usize = 20;

/// Stellenliste eines Zeitfensters von außen (LLH-1040 D5): mehr als
/// [`STELLEN_JE_ZEITFENSTER_MAX`] Einträge, gezählt VOR dem Entdoppeln, sind 400 — vor jeder
/// Abfrage. Danach entdoppelt, in der Reihenfolge des ersten Auftretens.
pub fn dedupe_stelle_ids(ids: &[i64]) -> Result<Vec<i64>, AppError> {
    if ids.len() > STELLEN_JE_ZEITFENSTER_MAX {
        return Err(AppError::Validation(format!(
            "stelle_ids darf höchstens {STELLEN_JE_ZEITFENSTER_MAX} Einträge haben, waren {}",
            ids.len()
        )));
    }
    let mut eindeutig: Vec<i64> = Vec::with_capacity(ids.len());
    for id in ids {
        if !eindeutig.contains(id) {
            eindeutig.push(*id);
        }
    }
    Ok(eindeutig)
}

/// Liest einen Zeitpunkt im Drahtformat. Als Rundreise: chrono nimmt beim Parsen auch
/// ungepolsterte Felder an, die als Text falsch sortierten. Unlesbar → 400.
pub fn draht_lesen(feld: &str, s: &str) -> Result<DateTime<Utc>, AppError> {
    match crate::zeit::parse_streng(s) {
        Some(t) => Ok(t.and_utc()),
        None => Err(AppError::Validation(format!(
            "{feld}: ungültiger Zeitpunkt '{s}' (erwartet: YYYY-MM-DD HH:MM:SS, UTC)"
        ))),
    }
}

/// Zeitraum für den ETB-Text in der Zeitzone der Organisation (design.md D5):
/// `TT.MM. HH:MM–HH:MM`, über Mitternacht (nach ORTSdatum) mit beiden Daten
/// `TT.MM. HH:MM–TT.MM. HH:MM`. Der Server rechnet sonst in UTC, und eine beweissichernde
/// Unterlage nennte still die falsche Uhrzeit.
pub fn zeitraum_text(von: DateTime<Utc>, bis: DateTime<Utc>, tz: Tz) -> String {
    let v = von.with_timezone(&tz);
    let b = bis.with_timezone(&tz);
    if v.date_naive() == b.date_naive() {
        format!("{}–{}", v.format("%d.%m. %H:%M"), b.format("%H:%M"))
    } else {
        format!("{}–{}", v.format("%d.%m. %H:%M"), b.format("%d.%m. %H:%M"))
    }
}

// ── ETB-Texte ───────────────────────────────────────────────────────────────────────────────

/// Reine Textfunktionen für die ETB-Sätze (design.md D5). Sie nehmen weder Ort noch Bemerkung
/// einer Ausgabe entgegen — Ausgaben schreiben ohnehin keinen Eintrag, und die Freitexte werden
/// beim Schwärzen geleert, `etb_eintrag.inhalt` aber nicht.
pub mod etb_text {
    use super::stelle::{VerpflegungsstelleArt, VerpflegungsstelleStatus};
    use super::{Bedarf, Verpflegungsart};

    /// Bezeichnung in deutschen einfachen Anführungszeichen.
    fn q(bezeichnung: &str) -> String {
        format!("‚{bezeichnung}‘")
    }

    /// „(180 Kräfte, 70 Betreute, 5 weitere)“ — nur belegte Teile; leer, wenn keiner belegt ist.
    fn aufteilung(b: &Bedarf) -> String {
        let mut teile = Vec::new();
        if b.kraefte > 0 {
            teile.push(format!("{} Kräfte", b.kraefte));
        }
        if b.betreute > 0 {
            teile.push(format!("{} Betreute", b.betreute));
        }
        if b.weitere > 0 {
            teile.push(format!("{} weitere", b.weitere));
        }
        if teile.is_empty() {
            String::new()
        } else {
            format!(" ({})", teile.join(", "))
        }
    }

    fn davon_sonderkost(b: &Bedarf) -> String {
        match b.sonderkost.summe() {
            0 => String::new(),
            n => format!(", davon {n} Sonderkost"),
        }
    }

    /// „‚A‘, ‚B‘“ bzw. „keine“ — die Stellen eines Zeitfensters (LLH-1040 D7).
    fn stellen_text(stellen: &[String]) -> String {
        if stellen.is_empty() {
            "keine".into()
        } else {
            stellen.iter().map(|s| q(s)).collect::<Vec<_>>().join(", ")
        }
    }

    fn art_text(art: Option<Verpflegungsart>) -> &'static str {
        art.map_or("ohne Angabe", Verpflegungsart::wort)
    }

    /// „Verpflegung ‚Mittag‘ 24.09. 12:00–13:30 angelegt: Bedarf 250 EP (180 Kräfte,
    /// 70 Betreute), davon 15 Sonderkost.“ Art und Stellen (LLH-1040 D7) nur, wenn gesetzt:
    /// „…, davon 15 Sonderkost; warm; an ‚Feldküche BR Sportplatz‘, ‚Ausgabe Turnhalle Nord‘.“
    pub fn angelegt(
        bezeichnung: &str,
        zeitraum: &str,
        b: &Bedarf,
        art: Option<Verpflegungsart>,
        stellen: &[String],
    ) -> String {
        let mut zusatz = String::new();
        if let Some(art) = art {
            zusatz.push_str(&format!("; {}", art.wort()));
        }
        if !stellen.is_empty() {
            zusatz.push_str(&format!("; an {}", stellen_text(stellen)));
        }
        format!(
            "Verpflegung {} {zeitraum} angelegt: Bedarf {} EP{}{}{zusatz}.",
            q(bezeichnung),
            b.gesamt,
            aufteilung(b),
            davon_sonderkost(b)
        )
    }

    /// System-ETB beim Statuswechsel einer Verpflegungsstelle (LLH-1040 D7, Muster
    /// `bereitstellungsraum::etb_text_status`): „Verpflegungsstelle ‚Feldküche BR Sportplatz‘
    /// (Feldküche) in Betrieb genommen.“ bzw. „… aufgelöst.“; `geplant` schreibt keinen Eintrag.
    pub fn stelle_status(
        bezeichnung: &str,
        art: VerpflegungsstelleArt,
        status: VerpflegungsstelleStatus,
    ) -> Option<String> {
        let was = match status {
            VerpflegungsstelleStatus::Geplant => return None,
            VerpflegungsstelleStatus::Aktiv => "in Betrieb genommen",
            VerpflegungsstelleStatus::Aufgeloest => "aufgelöst",
        };
        Some(format!(
            "Verpflegungsstelle {} ({}) {was}.",
            q(bezeichnung),
            art.wort()
        ))
    }

    /// Was sich an einem Zeitfenster geändert hat. `None` = unverändert.
    #[derive(Debug, Default, Clone)]
    pub struct Aenderungen<'a> {
        pub bezeichnung_vorher: Option<&'a str>,
        pub zeitraum_vorher: Option<&'a str>,
        /// Gesamtbedarf vorher, wenn er sich geändert hat.
        pub gesamt_vorher: Option<i64>,
        /// Die Aufteilung auf Kräfte/Betreute/weitere hat sich geändert.
        pub aufteilung: bool,
        /// Sonderkost-Summe vorher, wenn sich die Sonderkost geändert hat.
        pub sonderkost_vorher: Option<i64>,
        /// `(jetzt, vorher)`, wenn sich die Verpflegungsart geändert hat (LLH-1040).
        pub art: Option<(Option<Verpflegungsart>, Option<Verpflegungsart>)>,
        /// `(jetzt, vorher)` als Bezeichnungen, wenn sich die Menge der Stellen geändert hat.
        pub stellen: Option<(&'a [String], &'a [String])>,
    }

    impl Aenderungen<'_> {
        pub fn leer(&self) -> bool {
            self.bezeichnung_vorher.is_none()
                && self.zeitraum_vorher.is_none()
                && self.gesamt_vorher.is_none()
                && !self.aufteilung
                && self.sonderkost_vorher.is_none()
                && self.art.is_none()
                && self.stellen.is_none()
        }
    }

    /// Nennt nur, was sich geändert hat, und immer Bezeichnung, Zeitraum und Gesamtbedarf (Spec
    /// „Einsatztagebuch“). Hat sich der Gesamtbedarf geändert, steht er mit dem Vorwert in der
    /// Aufzählung, sonst im Kopf:
    /// „Verpflegung ‚Mittag‘ 24.09. 12:00–13:30 geändert: Bedarf 270 EP (vorher 250).“ bzw.
    /// „Verpflegung ‚Mittag‘ 24.09. 12:00–13:30 (Bedarf 250 EP) geändert: Zeitraum (vorher …).“
    pub fn geaendert(bezeichnung: &str, zeitraum: &str, b: &Bedarf, a: &Aenderungen<'_>) -> String {
        let mut teile: Vec<String> = Vec::new();
        if let Some(v) = a.bezeichnung_vorher {
            teile.push(format!("Bezeichnung (vorher {})", q(v)));
        }
        if let Some(v) = a.zeitraum_vorher {
            teile.push(format!("Zeitraum (vorher {v})"));
        }
        if let Some(v) = a.gesamt_vorher {
            teile.push(format!("Bedarf {} EP (vorher {v})", b.gesamt));
        }
        if a.aufteilung {
            teile.push(format!("Aufteilung{}", aufteilung(b)));
        }
        if let Some(v) = a.sonderkost_vorher {
            let n = b.sonderkost.summe();
            if n == v {
                teile.push(format!("Sonderkost {n} (Kostformen geändert)"));
            } else {
                teile.push(format!("Sonderkost {n} (vorher {v})"));
            }
        }
        if let Some((jetzt, vorher)) = a.art {
            teile.push(format!(
                "Art {} (vorher {})",
                art_text(jetzt),
                art_text(vorher)
            ));
        }
        if let Some((jetzt, vorher)) = a.stellen {
            teile.push(format!(
                "Stellen {} (vorher {})",
                stellen_text(jetzt),
                stellen_text(vorher)
            ));
        }
        let kopf = match a.gesamt_vorher {
            Some(_) => format!("Verpflegung {} {zeitraum}", q(bezeichnung)),
            None => format!(
                "Verpflegung {} {zeitraum} (Bedarf {} EP)",
                q(bezeichnung),
                b.gesamt
            ),
        };
        format!("{kopf} geändert: {}.", teile.join(", "))
    }

    /// „Verpflegung ‚Mittag‘ 24.09. 12:00–13:30 gelöscht (Bedarf 250 EP).“
    pub fn geloescht(bezeichnung: &str, zeitraum: &str, b: &Bedarf) -> String {
        format!(
            "Verpflegung {} {zeitraum} gelöscht (Bedarf {} EP).",
            q(bezeichnung),
            b.gesamt
        )
    }
}

#[cfg(test)]
mod tests;
