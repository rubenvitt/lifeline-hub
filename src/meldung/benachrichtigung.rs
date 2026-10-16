//! Benachrichtigung zu einer erfassten Meldung (LLH-1214, Change `kcjecn9e-benachrichtigungskonzept`,
//! design.md D8, Spec `benachrichtigungen`, „Meldung an mich“).
//!
//! Der Schreibweg ruft [`erfasst`] nach dem Commit, genau einmal je Meldung: dann, wenn er das
//! Live-Bündel der Meldung zustellt (`meldung::live_publikation_sicherstellen`, Marker
//! `live_published_at`). Eine Wiederholung derselben `client_id` meldet deshalb nicht noch einmal.
//! Wer etwas bekommt, entscheidet [`crate::benachrichtigung::melden`] (`src/AGENTS.md`,
//! Benachrichtigungen); hier steht nur, wer als Adressat gemeint ist.

use super::MeldungAnzeige;
use crate::benachrichtigung::{
    melden, Adressat, Anlass, BenachrichtigungArt, BenachrichtigungBezugTyp, Bezug,
};
use crate::fuehrung::Fuehrungsfunktion;
use crate::live::LiveHub;
use sqlx::SqlitePool;

/// Der Anlass einer erfassten Meldung: „Neue Meldung“ an ihre Empfängerfunktion, ausgelöst vom
/// Erfasser. Keiner ohne Empfängerfunktion (kein Rückschluss vom Freitext) und keiner bei einer
/// Sofortmeldung: für sie gilt allein ihr Alarm (Spec „Sofortmeldung alarmiert“), ohne zweite
/// Benachrichtigung.
pub fn anlass(meldung: &MeldungAnzeige) -> Option<Anlass> {
    if meldung.ist_sofort() {
        return None;
    }
    let funktion = meldung
        .empfaenger_funktion
        .as_deref()
        .and_then(Fuehrungsfunktion::parse)?;
    Some(
        Anlass::neu(
            meldung.einsatz_id,
            BenachrichtigungArt::Meldung,
            Bezug::neu(BenachrichtigungBezugTyp::Meldung, meldung.id),
        )
        .von(meldung.erfasst_von_id)
        .an(Adressat::Funktion(funktion)),
    )
}

/// Meldet eine gerade erfasste Meldung ([`anlass`]); ohne Anlass nichts.
pub async fn erfasst(pool: &SqlitePool, live: &LiveHub, meldung: &MeldungAnzeige) {
    if let Some(anlass) = anlass(meldung) {
        melden(pool, live, anlass).await;
    }
}
