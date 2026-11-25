//! Vorschau und Übernehmen eines [`StammdatenPaket`]s (LLH-1633, Spec „Ablauf und
//! Schnittstelle“). Drei Schritte wie beim Schichtplan (LLH-1556,
//! `abloesung::schichtplan::uebernahme::repo`):
//!
//! 1. [`bestand_tx`] liest alles der Org in einem Rutsch, samt `stammdaten_kennung`.
//! 2. [`planen`] gleicht rein ab ([`super::abgleich`]), wendet die Entscheidungen an und prüft
//!    Kollisionen (Funkrufname, Personalnummer) gegen Bestand und Datei.
//! 3. [`write_tx`] schreibt eine übernehmbare Planung, ohne zu committen.
//!
//! [`vorschau`] schreibt nichts; [`uebernehmen`] läuft alle drei Schritte in EINER Transaktion
//! (`write_retry!`, `BEGIN IMMEDIATE`), sodass Vorschau und Schreiben denselben Stand sehen.

use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use utoipa::ToSchema;

use super::abgleich::TrefferGrund;
use super::{DateiMeldung, StammdatenArt, StammdatenPaket};
use crate::error::AppError;
use crate::wire_enum::wire_enum;
use crate::write_retry;

mod bestand;
mod planen;
mod schreiben;

pub use bestand::{bestand_tx, herkunft_vorschlag_tx};
pub use planen::{planen, Planung};
pub use schreiben::write_tx;

/// Entscheidungen je Liste in einer Anfrage (400 darüber); dieselbe Grenze wie LLH-1556.
pub use crate::abloesung::schichtplan::uebernahme::ENTSCHEIDUNGEN_MAX;

// ---------------------------------------------------------------------------------------------
// Entscheidungen (Request)
// ---------------------------------------------------------------------------------------------

/// Was mit einer Zeile geschehen soll. Fehlt die Wahl, gilt der Vorschlag: `neu` legt an,
/// `gefunden` füllt nur Lücken und behält abweichende Werte; `mehrdeutig` bleibt offen.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(tag = "art", rename_all = "snake_case", deny_unknown_fields)]
pub enum ZeilenWahl {
    /// Die Zeile wird nicht übernommen.
    Auslassen,
    /// Ein neuer Datensatz wird angelegt.
    Neu,
    /// Einer der Kandidaten der Zeile (`kandidaten[].id`).
    Kandidat { id: i64 },
    /// Abweichende Werte der Datei übernehmen (Erkennungsfelder nur bei Treffer über die
    /// Kennung).
    DateiUebernehmen,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct ZeilenEntscheidung {
    pub art: StammdatenArt,
    pub zeile: u32,
    pub wahl: ZeilenWahl,
}

/// Was mit einer Qualifikation der Datei geschehen soll. Fehlt die Wahl, wird eine unbekannte
/// neu angelegt und eine gefundene verknüpft.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(tag = "art", rename_all = "snake_case", deny_unknown_fields)]
pub enum QualiWahl {
    Neu,
    /// Zu einer Qualifikation der eigenen Org; wird gemerkt und gilt in späteren Läufen.
    Zuordnen {
        qualifikation_id: i64,
    },
    Auslassen,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct QualiEntscheidung {
    /// Der Text der Qualifikation, wie die Vorschau ihn zeigt (`qualifikationen[].text`).
    pub text: String,
    pub wahl: QualiWahl,
}

/// Die Wahl in der Vorschau. Je Zeile (Art + Zeilennummer) bzw. je Qualifikationstext; fehlt
/// ein Eintrag, gilt der Vorschlag. Doppelte Einträge: der letzte gilt.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct Entscheidungen {
    #[serde(default)]
    pub zeilen: Vec<ZeilenEntscheidung>,
    #[serde(default)]
    pub qualifikationen: Vec<QualiEntscheidung>,
}

// ---------------------------------------------------------------------------------------------
// Vorschau und Ergebnis (Response)
// ---------------------------------------------------------------------------------------------

wire_enum! {
    /// Ergebnis des Abgleichs einer Zeile. Wire == `as_str()`.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, ToSchema)]
    pub enum ZeilenErgebnis {
        /// Nichts gefunden: wird angelegt.
        Neu => "neu",
        /// Ein Datensatz gefunden; die Datei ergänzt oder ändert ihn.
        Gefunden => "gefunden",
        /// Mehrere Kandidaten (oder ein Ziel mit anderer Kennung derselben Herkunft): offen.
        Mehrdeutig => "mehrdeutig",
        /// Die Kennung trifft einen außer Dienst gestellten Datensatz: ausgelassen.
        AusserDienst => "ausser_dienst",
        /// Die Zeile kann so nicht übernommen werden (Grund in `hinweise`).
        Fehler => "fehler",
        /// Gefunden, und die Datei ändert nichts.
        Unveraendert => "unveraendert",
    }
    try_from = |s| format!("Ungültiges Ergebnis einer Zeile: {s}");
}

wire_enum! {
    /// Art einer Feldänderung. Wire == `as_str()`.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, ToSchema)]
    pub enum FeldAenderungArt {
        /// Das Feld ist leer, die Datei füllt es (wird immer übernommen).
        Fuellt => "fuellt",
        /// Das Feld ist gefüllt, die Datei nennt einen anderen Wert.
        WeichtAb => "weicht_ab",
    }
    try_from = |s| format!("Ungültige Art einer Feldänderung: {s}");
}

/// Ein Kandidat einer Zeile: ein Datensatz der eigenen Org.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct Kandidat {
    pub id: i64,
    pub anzeige: String,
}

/// Eine Feldänderung. `feld` ist die Spalte des Vertrags (`funkrufname`, `issi`, `typ`, …,
/// `qualifikationen` für eine hinzukommende Qualifikation); Werte nur aus Spalten des Vertrags.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct FeldAenderungDto {
    pub feld: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub alt: Option<String>,
    pub neu: String,
    pub art: FeldAenderungArt,
    /// Ein Erkennungsmerkmal; eine Abweichung wird nur bei Treffer über die Kennung übernommen.
    pub erkennungsfeld: bool,
    /// Ob das Übernehmen mit der aktuellen Wahl dieses Feld schreibt.
    pub uebernommen: bool,
}

/// Eine Fahrzeug- oder Personalzeile der Datei in der Vorschau.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct StammdatenZeile {
    pub art: StammdatenArt,
    pub zeile: u32,
    pub anzeige: String,
    pub ergebnis: ZeilenErgebnis,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub grund: Option<TrefferGrund>,
    /// Getroffene Datensätze: einer bei `gefunden`/`ausser_dienst`, mehrere bei `mehrdeutig`.
    pub kandidaten: Vec<Kandidat>,
    pub aenderungen: Vec<FeldAenderungDto>,
    /// Hinweise; bei `fehler` steht der Grund zuerst.
    pub hinweise: Vec<String>,
    /// Die wirksame Wahl: die gesendete, sonst `neu` bei einer neuen Zeile; fehlt bei einer
    /// gefundenen Zeile ohne Wahl (Vorschlag) und bei einer offenen.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub wahl: Option<ZeilenWahl>,
}

/// Eine Qualifikation der Datei: aus dem Blatt „Qualifikationen“ und aus den Listen des
/// Personals, je Herkunft und normalisiertem Text einmal.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct QualiZeile {
    pub text: String,
    /// Zeilen im Blatt „Qualifikationen“ (leer, wenn sie nur das Personal nennt).
    pub zeilen: Vec<u32>,
    pub ergebnis: ZeilenErgebnis,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub grund: Option<TrefferGrund>,
    pub kandidaten: Vec<Kandidat>,
    pub hinweise: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub wahl: Option<QualiWahl>,
}

/// Zählung einer Art. `offen` = mehrdeutig ohne Wahl (sperrt das Übernehmen).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, ToSchema)]
pub struct ArtZaehlung {
    pub neu: i64,
    /// Gefunden; die Datei füllt Lücken, fügt Qualifikationen hinzu oder merkt die Kennung.
    pub ergaenzt: i64,
    /// Gefunden; abweichende Werte werden übernommen.
    pub geaendert: i64,
    pub unveraendert: i64,
    pub ausgelassen: i64,
    pub fehler: i64,
    pub offen: i64,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, ToSchema)]
pub struct Zaehlung {
    pub fahrzeuge: ArtZaehlung,
    pub personal: ArtZaehlung,
    pub qualifikationen: ArtZaehlung,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct StammdatenVorschau {
    pub zaehlung: Zaehlung,
    pub zeilen: Vec<StammdatenZeile>,
    pub qualifikationen: Vec<QualiZeile>,
    pub meldungen: Vec<DateiMeldung>,
    /// Spaltenköpfe, die der Vertrag nicht kennt (nie ihre Werte).
    pub nicht_uebernommen: Vec<String>,
    /// Eine Zeile hat eine Kennung, aber weder Zeile noch Hochladen nennen eine Herkunft.
    pub herkunft_noetig: bool,
    /// Die zuletzt in der Org gemerkte Herkunft (normalisiert).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub herkunft_vorschlag: Option<String>,
    /// Keine Fehler, nichts offen, Herkunft da: das Übernehmen schreibt.
    pub uebernehmbar: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
pub struct StammdatenErgebnis {
    pub zaehlung: Zaehlung,
}

// ---------------------------------------------------------------------------------------------
// Vorschau und Übernehmen über den Pool
// ---------------------------------------------------------------------------------------------

/// Die Vorschau: liest, gleicht ab, schreibt nichts. Ein Ziel einer Entscheidung außerhalb der
/// Org oder eine Wahl, die nicht zur Zeile passt → `Validation`.
pub async fn vorschau(
    pool: &SqlitePool,
    org_id: i64,
    paket: &StammdatenPaket,
    meldungen: &[DateiMeldung],
    nicht_uebernommen: &[String],
    herkunft_default: Option<&str>,
    e: &Entscheidungen,
) -> Result<StammdatenVorschau, AppError> {
    let mut conn = pool.acquire().await?;
    let bestand = bestand_tx(&mut conn, org_id).await?;
    let vorschlag = herkunft_vorschlag_tx(&mut conn, org_id).await?;
    let planung = planen(
        &bestand,
        paket,
        meldungen,
        nicht_uebernommen,
        herkunft_default,
        vorschlag,
        e,
    )?;
    Ok(planung.vorschau)
}

/// Übernimmt in EINER Transaktion (`write_retry!`): rechnet die Vorschau auf dem Stand der
/// Transaktion neu und schreibt sie. Fehlende Herkunft → 400; nicht übernehmbar → 422
/// (`AppError::Zeilen`, `art = dateizeile`). Liefert die Zählung und die Ids der angelegten oder
/// geänderten Fahrzeuge (für die Live-Meldung im Aufrufer).
pub async fn uebernehmen(
    pool: &SqlitePool,
    org_id: i64,
    paket: &StammdatenPaket,
    meldungen: &[DateiMeldung],
    nicht_uebernommen: &[String],
    herkunft_default: Option<&str>,
    e: &Entscheidungen,
) -> Result<(StammdatenErgebnis, Vec<i64>), AppError> {
    let jetzt = crate::zeit::jetzt();
    let (ergebnis, fahrzeug_ids) = write_retry!(pool, |conn| {
        let bestand = bestand_tx(conn, org_id).await?;
        let vorschlag = herkunft_vorschlag_tx(conn, org_id).await?;
        let planung = planen(
            &bestand,
            paket,
            meldungen,
            nicht_uebernommen,
            herkunft_default,
            vorschlag,
            e,
        )?;
        write_tx(conn, org_id, &planung, &jetzt).await
    })?;
    tracing::info!(
        org_id,
        herkunft = herkunft_default.unwrap_or(""),
        zaehlung = ?ergebnis.zaehlung,
        "Stammdaten eingelesen"
    );
    Ok((ergebnis, fahrzeug_ids))
}
