//! Benachrichtigungen der Aufträge (LLH-1212, Change `kcjecn9e-benachrichtigungskonzept`, Spec
//! `benachrichtigungen`, „Auftrag erteilt“ und „Auftrag quittiert oder erledigt“).
//!
//! Die Schreibwege rufen diese Funktionen nach dem Commit und nur beim Übergang: Erteilen meldet
//! die Empfänger des neuen Auftrags, eine Berichtigung nur die hinzugekommenen, die erste Quittung
//! einer Empfänger-Zeile und der Vollzug melden dem Auftraggeber. Wer etwas bekommt, entscheidet
//! [`crate::benachrichtigung::melden`] (`src/AGENTS.md`, Benachrichtigungen); hier steht nur, wer
//! als Adressat gemeint ist.

use super::repo::EmpfaengerEingabe;
use super::{EMPF_FUNKTION, EMPF_PERSON};
use crate::benachrichtigung::{
    melden, Adressat, Anlass, BenachrichtigungArt, BenachrichtigungBezugTyp, Bezug,
};
use crate::fuehrung::Fuehrungsfunktion;
use crate::live::LiveHub;
use sqlx::SqlitePool;

/// Der Adressat einer Empfänger-Zeile: eine Katalogfunktion oder eine Einsatzkraft. Einheit,
/// Abschnitt, Fahrzeug, extern und eine Funktion als Freitext haben keinen Nutzer (Spec „Auftrag
/// erteilt“, Szenario „Auftrag an eine Einheit“).
fn adressat(
    typ: &str,
    funktion: Option<Fuehrungsfunktion>,
    person_id: Option<i64>,
) -> Option<Adressat> {
    match (typ, funktion, person_id) {
        (EMPF_FUNKTION, Some(f), _) => Some(Adressat::Funktion(f)),
        (EMPF_PERSON, _, Some(ep)) => Some(Adressat::Person(ep)),
        _ => None,
    }
}

/// Meldet `auftrag_erteilt` an die genannten Adressaten; ohne Adressaten nichts.
async fn erteilt_an(
    pool: &SqlitePool,
    live: &LiveHub,
    einsatz_id: i64,
    auftrag_id: i64,
    ausloeser_id: i64,
    adressaten: impl IntoIterator<Item = Adressat>,
) {
    let anlass = adressaten.into_iter().fold(
        Anlass::neu(
            einsatz_id,
            BenachrichtigungArt::AuftragErteilt,
            Bezug::neu(BenachrichtigungBezugTyp::Auftrag, auftrag_id),
        )
        .von(ausloeser_id),
        Anlass::an,
    );
    if !anlass.adressaten.is_empty() {
        melden(pool, live, anlass).await;
    }
}

/// Ein Auftrag wurde erteilt (direkt, aus ETB, Meldung oder Chat): seine Funktions- und
/// Personen-Empfänger bekommen „Neuer Auftrag“, der Erteilende nicht. Liest die Empfänger nach dem
/// Commit; ein Lesefehler wird wie jeder Fehler beim Melden nur geloggt.
pub async fn erteilt(
    pool: &SqlitePool,
    live: &LiveHub,
    einsatz_id: i64,
    auftrag_id: i64,
    ausloeser_id: i64,
) {
    let empfaenger = match super::repo::empfaenger_von(pool, auftrag_id).await {
        Ok(e) => e,
        Err(e) => {
            tracing::warn!(auftrag_id, fehler = %e, "Empfänger für die Benachrichtigung nicht lesbar");
            return;
        }
    };
    let adressaten = empfaenger.iter().filter_map(|e| {
        adressat(
            e.empfaenger_typ.as_str(),
            e.funktion.as_deref().and_then(Fuehrungsfunktion::parse),
            e.person_id,
        )
    });
    erteilt_an(pool, live, einsatz_id, auftrag_id, ausloeser_id, adressaten).await;
}

/// Eine Berichtigung hat Empfänger hinzugefügt (LLH-1098): nur sie bekommen „Neuer Auftrag“;
/// bleibende Empfänger kennen den Auftrag schon.
pub async fn empfaenger_hinzugekommen(
    pool: &SqlitePool,
    live: &LiveHub,
    einsatz_id: i64,
    auftrag_id: i64,
    ausloeser_id: i64,
    hinzu: &[EmpfaengerEingabe],
) {
    let adressaten = hinzu
        .iter()
        .filter_map(|e| adressat(&e.empfaenger_typ, e.funktion, e.person_id));
    erteilt_an(pool, live, einsatz_id, auftrag_id, ausloeser_id, adressaten).await;
}

/// Eine Empfänger-Zeile wurde zum ersten Mal quittiert: der Auftraggeber bekommt „Auftrag
/// quittiert“. Bezug ist die Zeile, damit die Detailzeile den Empfänger nennen kann.
pub async fn quittiert(
    pool: &SqlitePool,
    live: &LiveHub,
    einsatz_id: i64,
    empfaenger_zeile_id: i64,
    auftraggeber_id: i64,
    ausloeser_id: i64,
) {
    melden(
        pool,
        live,
        Anlass::neu(
            einsatz_id,
            BenachrichtigungArt::AuftragQuittiert,
            Bezug::neu(
                BenachrichtigungBezugTyp::AuftragEmpfaenger,
                empfaenger_zeile_id,
            ),
        )
        .von(ausloeser_id)
        .an(Adressat::Nutzer(auftraggeber_id)),
    )
    .await;
}

/// Ein Empfänger hat den Auftrag erledigt gemeldet (Vollzug): der Auftraggeber bekommt „Auftrag
/// erledigt“.
pub async fn erledigt(
    pool: &SqlitePool,
    live: &LiveHub,
    einsatz_id: i64,
    auftrag_id: i64,
    auftraggeber_id: i64,
    ausloeser_id: i64,
) {
    melden(
        pool,
        live,
        Anlass::neu(
            einsatz_id,
            BenachrichtigungArt::AuftragErledigt,
            Bezug::neu(BenachrichtigungBezugTyp::Auftrag, auftrag_id),
        )
        .von(ausloeser_id)
        .an(Adressat::Nutzer(auftraggeber_id)),
    )
    .await;
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auftrag::EmpfaengerTyp;

    #[test]
    fn nur_katalogfunktion_und_person_sind_adressaten() {
        assert_eq!(
            adressat(EMPF_FUNKTION, Some(Fuehrungsfunktion::S2), None),
            Some(Adressat::Funktion(Fuehrungsfunktion::S2))
        );
        assert_eq!(
            adressat(EMPF_PERSON, None, Some(7)),
            Some(Adressat::Person(7))
        );
        assert_eq!(adressat(EMPF_FUNKTION, None, None), None, "Freitext");
        for typ in [
            EmpfaengerTyp::Abschnitt,
            EmpfaengerTyp::Einheit,
            EmpfaengerTyp::Fahrzeug,
            EmpfaengerTyp::Extern,
        ] {
            assert_eq!(
                adressat(typ.as_str(), Some(Fuehrungsfunktion::S2), Some(7)),
                None,
                "{}",
                typ.as_str()
            );
        }
    }
}
