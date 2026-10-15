//! Benachrichtigung zum Status einer Nachforderung (LLH-1216, Change
//! `kcjecn9e-benachrichtigungskonzept`, Spec `benachrichtigungen`, „Status einer Nachforderung“).
//!
//! Beide Schreibwege des Status (`…/status` und `…/ablehnen` in `routes/nachforderung.rs`) rufen
//! [`status_gewechselt`] nach dem Commit und nur, wenn ihr UPDATE den Status tatsächlich geändert
//! hat. Gemeldet wird der Wechsel in zugesagt, unterwegs, eingetroffen und abgelehnt, auch als
//! Rücknahme um eine Stufe; der Wechsel zurück auf „angefordert“ bleibt still. Wer etwas bekommt,
//! entscheidet [`crate::benachrichtigung::melden`] (`src/AGENTS.md`, Benachrichtigungen); hier
//! steht nur, wer gemeint ist: der Ersteller und S4.

use super::NachforderungStatus;
use crate::benachrichtigung::{
    melden, Adressat, Anlass, BenachrichtigungArt, BenachrichtigungBezugTyp, Bezug,
};
use crate::fuehrung::Fuehrungsfunktion;
use crate::live::LiveHub;
use sqlx::SqlitePool;

/// Der Bezug, der den neuen Status trägt; `None` für „angefordert“ (kein Hinweis). Gegenstück:
/// `benachrichtigung::text::nachforderung_status`.
pub const fn bezug_typ(status: NachforderungStatus) -> Option<BenachrichtigungBezugTyp> {
    match status {
        NachforderungStatus::Angefordert => None,
        NachforderungStatus::Zugesagt => Some(BenachrichtigungBezugTyp::NachforderungZugesagt),
        NachforderungStatus::Unterwegs => Some(BenachrichtigungBezugTyp::NachforderungUnterwegs),
        NachforderungStatus::Eingetroffen => {
            Some(BenachrichtigungBezugTyp::NachforderungEingetroffen)
        }
        NachforderungStatus::Abgelehnt => Some(BenachrichtigungBezugTyp::NachforderungAbgelehnt),
    }
}

/// Die Nachforderung `nachforderung_id` ist in `neu` gewechselt: Ersteller und S4 bekommen den
/// Hinweis „Nachforderung <Status>“, der Auslöser nicht.
pub async fn status_gewechselt(
    pool: &SqlitePool,
    live: &LiveHub,
    einsatz_id: i64,
    nachforderung_id: i64,
    neu: NachforderungStatus,
    ersteller_id: i64,
    ausloeser_id: i64,
) {
    let Some(typ) = bezug_typ(neu) else {
        return;
    };
    melden(
        pool,
        live,
        Anlass::neu(
            einsatz_id,
            BenachrichtigungArt::NachforderungStatus,
            Bezug::neu(typ, nachforderung_id),
        )
        .von(ausloeser_id)
        .an(Adressat::Nutzer(ersteller_id))
        .an(Adressat::Funktion(Fuehrungsfunktion::S4)),
    )
    .await;
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::benachrichtigung::text::nachforderung_status;

    #[test]
    fn bezug_und_status_sind_gegenstuecke() {
        for status in NachforderungStatus::ALLE {
            match bezug_typ(status) {
                Some(typ) => assert_eq!(nachforderung_status(typ), Some(status)),
                None => assert_eq!(status, NachforderungStatus::Angefordert),
            }
        }
        let mit_status = BenachrichtigungBezugTyp::ALLE
            .iter()
            .filter(|t| nachforderung_status(**t).is_some())
            .count();
        assert_eq!(mit_status, 4);
    }
}
