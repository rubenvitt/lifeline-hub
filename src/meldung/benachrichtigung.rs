//! Benachrichtigungen zu Meldungen (LLH-1214, LLH-1062; Spec `benachrichtigungen`, „Meldung an
//! mich“, „Eingang einer Meldung“, „In die Lage übernommen“, „Sichten räumt den Hinweis bei
//! allen“).
//!
//! Der Schreibweg ruft [`erfasst`] nach dem Commit, genau einmal je Meldung: dann, wenn er das
//! Live-Bündel der Meldung zustellt (`meldung::live_publikation_sicherstellen`, Marker
//! `live_published_at`). Eine Wiederholung derselben `client_id` meldet deshalb nicht noch einmal.
//! Wer etwas bekommt, entscheidet [`crate::benachrichtigung::melden`] (`src/AGENTS.md`,
//! Benachrichtigungen); hier steht nur, wer als Adressat gemeint ist, und wann ein Hinweis für
//! alle erledigt ist.

use super::{MeldungAnzeige, MeldungStatus, Meldungsart};
use crate::benachrichtigung::{
    erledigen, melden, Adressat, Anlass, BenachrichtigungArt, BenachrichtigungBezugTyp, Bezug,
};
use crate::fuehrung::Fuehrungsfunktion;
use crate::kommunikation::Prioritaet;
use crate::live::LiveHub;
use sqlx::SqlitePool;

/// Das Modul, dessen Schreiber einen Eingang ohne Empfängerfunktion bekommen.
const MODUL: &str = "meldungen";

/// Woher eine Meldung kam (LLH-1062, design.md E4). Keine Spalte: die Quelle ist beim Anlegen
/// bekannt und folgt hier aus dem Erfasser. `Etb` (Übernahme aus dem Einsatztagebuch) ergänzt
/// LLH-1037.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MeldungQuelle {
    /// Von Hand im Meldungsformular, im ETB oder über einen Schreibweg des Rahmens erfasst.
    Hand,
    /// Von einem gekoppelten Gerät (UHS, Abschnitt, Bereitstellungsraum, Verpflegung …).
    Geraet,
}

impl MeldungQuelle {
    /// Die Quelle einer gespeicherten Meldung: `Geraet`, wenn ihr Erfasser ein Gerätekonto ist
    /// (jede Kopplung hat ein eigenes Konto, auch nach ihrem Ende).
    pub async fn von(pool: &SqlitePool, meldung: &MeldungAnzeige) -> Result<Self, sqlx::Error> {
        let geraet: Option<i64> =
            sqlx::query_scalar("SELECT 1 FROM geraet_kopplung WHERE benutzer_id = ? LIMIT 1")
                .bind(meldung.erfasst_von_id)
                .fetch_optional(pool)
                .await?;
        Ok(if geraet.is_some() {
            MeldungQuelle::Geraet
        } else {
            MeldungQuelle::Hand
        })
    }
}

/// Ob eine Meldung ein *Eingang* ist (design.md E3): dringend, eine Lagemeldung oder von einem
/// Gerät. Ein Eingang geht als Hinweis an alle, die ihn bearbeiten können; eine normale Meldung
/// von Hand bleibt still. Sofortmeldungen sind nie ein Eingang, sie alarmieren.
pub fn ist_eingang(meldung: &MeldungAnzeige, quelle: MeldungQuelle) -> bool {
    !meldung.ist_sofort()
        && (meldung.prioritaet == Prioritaet::Dringend
            || meldung.meldungsart == Meldungsart::Lagemeldung
            || quelle == MeldungQuelle::Geraet)
}

/// Der Anlass einer erfassten Meldung, ausgelöst vom Erfasser (design.md E3):
/// - Sofortmeldung: keiner, für sie gilt allein ihr Alarm (Spec „Sofortmeldung alarmiert“).
/// - Eingang mit Empfängerfunktion: „Neue Meldung“ an die Funktion und die Einsatzleitung.
/// - Eingang ohne Empfängerfunktion: an alle mit Schreibrecht im Modul Meldungen.
/// - Sonst mit Empfängerfunktion: an die Funktion (Spec „Meldung an mich“).
/// - Sonst: keiner (still). Kein Rückschluss vom Freitext auf eine Funktion.
pub fn anlass(meldung: &MeldungAnzeige, quelle: MeldungQuelle) -> Option<Anlass> {
    if meldung.ist_sofort() {
        return None;
    }
    let funktion = meldung
        .empfaenger_funktion
        .as_deref()
        .and_then(Fuehrungsfunktion::parse);
    let basis = Anlass::neu(
        meldung.einsatz_id,
        BenachrichtigungArt::Meldung,
        Bezug::neu(BenachrichtigungBezugTyp::Meldung, meldung.id),
    )
    .von(meldung.erfasst_von_id);
    match (ist_eingang(meldung, quelle), funktion) {
        (true, Some(f)) => Some(
            basis
                .an(Adressat::Funktion(f))
                .an(Adressat::Funktion(Fuehrungsfunktion::El)),
        ),
        (true, None) => Some(basis.an(Adressat::ModulSchreiber(MODUL))),
        (false, Some(f)) => Some(basis.an(Adressat::Funktion(f))),
        (false, None) => None,
    }
}

/// Meldet eine gerade erfasste Meldung ([`anlass`]); ohne Anlass nichts. Eine unlesbare Quelle
/// gilt als Hand: lieber still als ein Fehler nach dem Commit.
pub async fn erfasst(pool: &SqlitePool, live: &LiveHub, meldung: &MeldungAnzeige) {
    let quelle = MeldungQuelle::von(pool, meldung)
        .await
        .unwrap_or(MeldungQuelle::Hand);
    if let Some(anlass) = anlass(meldung, quelle) {
        melden(pool, live, anlass).await;
    }
}

/// Der Anlass der Übernahme einer Meldung in die Lage (design.md E5): „In die Lage übernommen“
/// an S2 und die Einsatzleitung, ausgelöst vom Übernehmenden. Nur bei der ersten Übergabe
/// (`war_lagerelevant` vor dem Schreiben) und nicht für die Art Lagemeldung, die schon ihren
/// Eingang hatte.
pub fn uebernahme_anlass(vorher: &MeldungAnzeige, benutzer_id: i64) -> Option<Anlass> {
    if vorher.lagerelevant || vorher.meldungsart == Meldungsart::Lagemeldung {
        return None;
    }
    Some(
        Anlass::neu(
            vorher.einsatz_id,
            BenachrichtigungArt::Meldung,
            Bezug::neu(BenachrichtigungBezugTyp::LageUebernahme, vorher.id),
        )
        .von(benutzer_id)
        .an(Adressat::Funktion(Fuehrungsfunktion::S2))
        .an(Adressat::Funktion(Fuehrungsfunktion::El)),
    )
}

/// Meldet die Übernahme ([`uebernahme_anlass`]) nach dem Commit.
pub async fn uebernommen(
    pool: &SqlitePool,
    live: &LiveHub,
    vorher: &MeldungAnzeige,
    benutzer_id: i64,
) {
    if let Some(anlass) = uebernahme_anlass(vorher, benutzer_id) {
        melden(pool, live, anlass).await;
    }
}

/// Nach einem Statuswechsel (design.md E6): steht die Meldung nicht mehr auf „Neu“, ist ihr
/// Eingang für alle erledigt. Der Sofortalarm bleibt unberührt; ihn quittiert jeder selbst.
pub async fn status_geaendert(pool: &SqlitePool, live: &LiveHub, meldung: &MeldungAnzeige) {
    if meldung.status == MeldungStatus::Neu {
        return;
    }
    erledigen(
        pool,
        live,
        meldung.einsatz_id,
        BenachrichtigungArt::Meldung,
        BenachrichtigungBezugTyp::Meldung,
        &[meldung.id],
    )
    .await;
}

/// Was die Übernahme-Hinweise eines Einsatzes zu Lagemeldungen sind, die inzwischen jemand als
/// gesehen gekennzeichnet hat (Spec `lagemeldung-kenntnisnahme`). Die Lage-Sicht liest heute
/// `lage_meldung`; mit LLH-1031 wandert die Kenntnisnahme an die Meldung, dann zieht diese
/// Abfrage mit.
const GESEHENE_UEBERNAHMEN_SQL: &str = "SELECT b.bezug_id FROM benachrichtigung b \
     JOIN lage_meldung l ON l.meldung_id = b.bezug_id AND l.einsatz_id = b.einsatz_id \
     WHERE b.einsatz_id = ? AND b.art = 'meldung' AND b.bezug_typ = 'lage_uebernahme' \
       AND b.quittiert_at IS NULL AND l.gesehen_at IS NOT NULL";

/// Nach einer Kenntnisnahme in der Lage-Sicht (einzeln oder alle): die Übernahme-Hinweise der
/// gesehenen Lagemeldungen sind für alle erledigt (design.md E6).
pub async fn lage_gesehen(pool: &SqlitePool, live: &LiveHub, einsatz_id: i64) {
    let ids: Vec<i64> = match sqlx::query_scalar(GESEHENE_UEBERNAHMEN_SQL)
        .bind(einsatz_id)
        .fetch_all(pool)
        .await
    {
        Ok(ids) => ids,
        Err(e) => {
            tracing::warn!(einsatz_id, fehler = %e, "Übernahme-Hinweise nicht erledigt");
            return;
        }
    };
    erledigen(
        pool,
        live,
        einsatz_id,
        BenachrichtigungArt::Meldung,
        BenachrichtigungBezugTyp::LageUebernahme,
        &ids,
    )
    .await;
}
