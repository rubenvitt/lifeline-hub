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
//! Spec: `openspec/changes/lfh-634-fachmodul-verpflegung/`

use chrono::{DateTime, Utc};
use chrono_tz::Tz;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::error::AppError;

pub mod deckung;
pub mod repo;

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
    /// Gesetzt, wenn die Ausgabe zurückgenommen ist; sie zählt dann nicht mehr mit.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub zurueckgenommen_at: Option<String>,
    pub erfasst_at: String,
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
    pub bedarf: Bedarf,
    /// Summe der nicht zurückgenommenen Ausgaben.
    pub ausgegeben: Portionen,
    /// Je `max(0, bedarf − ausgegeben)`, gesamt und je Kostform.
    pub fehlmenge: Portionen,
    /// Nach Zeitpunkt, zurückgenommene mit `zurueckgenommen_at`.
    pub ausgaben: Vec<AusgabeAnzeige>,
    pub angelegt_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub geaendert_at: Option<String>,
}

/// Die eine Lesequelle der Modulseite (`GET …/verpflegung`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct VerpflegungAnzeige {
    /// Nach Beginn geordnet.
    pub zeitfenster: Vec<ZeitfensterAnzeige>,
}

/// Antwort auf „Ausgabe erfassen“ und „Ausgabe zurücknehmen“: die Kennung der Ausgabe (für
/// „Rückgängig“) und das Zeitfenster danach.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct AusgabeErgebnis {
    pub ausgabe_id: i64,
    pub zeitfenster: ZeitfensterAnzeige,
}

// ── Zeiten ──────────────────────────────────────────────────────────────────────────────────

/// Drahtformat der Zeitpunkte: UTC ohne Zonenkennung.
pub const DRAHT: &str = "%Y-%m-%d %H:%M:%S";

/// Obergrenze je Zahlfeld in EP (Bedarfsteil, Menge, Kostform). Eine Verpflegungslage mit mehr
/// als 100 000 Portionen in EINEM Zeitfenster oder EINER Ausgabe gibt es nicht; ohne Grenze
/// ließ die Summe zweier Ausgaben mit `i64::MAX` die Deckung überlaufen (Review LFH-634) —
/// im Release still negativ, im Debug-Build ein Panic bei jedem Abruf. Das Feld scheitert für
/// sich, also 400.
pub const MAX_EP: i64 = 100_000;

/// Liest einen Zeitpunkt im Drahtformat. Als Rundreise: chrono nimmt beim Parsen auch
/// ungepolsterte Felder an, die als Text falsch sortierten. Unlesbar → 400.
pub fn draht_lesen(feld: &str, s: &str) -> Result<DateTime<Utc>, AppError> {
    match chrono::NaiveDateTime::parse_from_str(s, DRAHT) {
        Ok(t) if t.format(DRAHT).to_string() == s => Ok(t.and_utc()),
        _ => Err(AppError::Validation(format!(
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
    use super::Bedarf;

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

    /// „Verpflegung ‚Mittag‘ 24.09. 12:00–13:30 angelegt: Bedarf 250 EP (180 Kräfte,
    /// 70 Betreute), davon 15 Sonderkost.“
    pub fn angelegt(bezeichnung: &str, zeitraum: &str, b: &Bedarf) -> String {
        format!(
            "Verpflegung {} {zeitraum} angelegt: Bedarf {} EP{}{}.",
            q(bezeichnung),
            b.gesamt,
            aufteilung(b),
            davon_sonderkost(b)
        )
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
    }

    impl Aenderungen<'_> {
        pub fn leer(&self) -> bool {
            self.bezeichnung_vorher.is_none()
                && self.zeitraum_vorher.is_none()
                && self.gesamt_vorher.is_none()
                && !self.aufteilung
                && self.sonderkost_vorher.is_none()
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
