//! Was eine ausgelöste Erinnerung benachrichtigt (LLH-1209, Change
//! `kcjecn9e-benachrichtigungskonzept`, tasks.md 3.1–3.4, Spec `benachrichtigungen`). Der
//! Scheduler ruft [`melden`] nach dem Schreiben seines Merkers; es gibt keinen Auslöser, die
//! Empfänger löst allein `benachrichtigung::melden` auf (`src/AGENTS.md`, Benachrichtigungen).
//!
//! Je Anlass genau EINE Art, nie dieselbe Sache doppelt:
//!
//! - Frist einer Sofortmeldung (Auto-Frist): `sofortmeldung_eskaliert` an alle mit dem Modul
//!   Meldungen, auch den Erfasser, wenn dieser Tick sie eskaliert hat; sonst nichts.
//! - Quittierfrist eines Auftrags (Auto-Frist): `auftrag_ueberfaellig` an den Auftraggeber und an
//!   die Funktionen und Personen, die noch nicht quittiert haben; nur, solange er überfällig ist.
//! - Fristen einer Ablösungsschicht: `abloesung_vorwarnung` bzw. `abloesung_faellig` an alle mit
//!   dem Modul Ablösung. Keine zweite Benachrichtigung als Erinnerung. Der Planungshinweis
//!   (LLH-1131) meldet `abloesung_planung` ebenso, aber nur, solange die Schicht läuft und keine
//!   ablösende Einheit geplant ist.
//! - Jede andere Erinnerung, auch eine von Hand mit Bezug auf Meldung oder Auftrag:
//!   `erinnerung_faellig` an ihre Empfängerfunktion, ohne eine solche an den Ersteller. Eskaliert
//!   ihr Tick eine Sofortmeldung (der Scheduler prüft die Frist bei jedem Meldungsbezug), kommt
//!   die Eskalation dazu: zwei Anlässe, zwei Empfängerkreise; die Auto-Frist der Meldung findet
//!   sie danach schon eskaliert und schweigt.

use super::repo::FaelligeErinnerung;
use crate::benachrichtigung::{
    self, Adressat, Anlass, BenachrichtigungArt, BenachrichtigungBezugTyp, Bezug,
};
use crate::error::AppError;
use crate::fuehrung::Fuehrungsfunktion;
use crate::kommunikation::{
    OBJEKT_ABLOESUNG, OBJEKT_ABLOESUNG_PLANUNG, OBJEKT_ABLOESUNG_VORWARNUNG, OBJEKT_AUFTRAG,
    OBJEKT_MELDUNG,
};
use crate::live::LiveHub;
use sqlx::SqlitePool;

/// Meldet die Benachrichtigungen einer ausgelösten Erinnerung. `eskaliert`: die Sofortmeldung,
/// die dieser Tick über den Bezug der Erinnerung gerade eskaliert hat. Fehler werden geloggt, nie
/// weitergereicht: der Merker ist schon geschrieben, ein Wiederholen gäbe es ohnehin nicht.
pub(super) async fn melden(
    pool: &SqlitePool,
    live: &LiveHub,
    f: &FaelligeErinnerung,
    eskaliert: Option<i64>,
) {
    let neu = |art, typ, id| Anlass::neu(f.einsatz_id, art, Bezug::neu(typ, id));
    if let Some(id) = eskaliert {
        let eskalation = neu(
            BenachrichtigungArt::SofortmeldungEskaliert,
            BenachrichtigungBezugTyp::Meldung,
            id,
        )
        .an(Adressat::ModulLeser("meldungen"));
        benachrichtigung::melden(pool, live, eskalation).await;
    }
    match anlass(pool, f).await {
        Ok(Some(a)) => {
            benachrichtigung::melden(pool, live, a).await;
        }
        Ok(None) => {}
        Err(e) => {
            tracing::warn!(erinnerung_id = f.id, fehler = %e, "Benachrichtigung nicht gebildet");
        }
    }
}

/// Der Anlass der Erinnerung selbst, ohne die Eskalation (siehe [`melden`]).
async fn anlass(pool: &SqlitePool, f: &FaelligeErinnerung) -> Result<Option<Anlass>, AppError> {
    let neu = |art, typ, id| Anlass::neu(f.einsatz_id, art, Bezug::neu(typ, id));
    let auto_frist = f.quelle == super::QUELLE_AUTO_FRIST;
    let bezug = f.bezug_typ.as_deref().zip(f.bezug_id);
    Ok(match bezug {
        // Die Bestätigungsfrist meldet sich nur als Eskalation.
        Some((OBJEKT_MELDUNG, _)) if auto_frist => None,
        Some((OBJEKT_AUFTRAG, id)) if auto_frist => {
            auftrag_ueberfaellig(pool, f.einsatz_id, id).await?
        }
        Some((OBJEKT_ABLOESUNG_PLANUNG, id)) => {
            planung_offen(pool, f.einsatz_id, id).await?.then(|| {
                neu(
                    BenachrichtigungArt::AbloesungPlanung,
                    BenachrichtigungBezugTyp::Abloesung,
                    id,
                )
                .an(Adressat::ModulLeser("abloesung"))
            })
        }
        Some((typ @ (OBJEKT_ABLOESUNG | OBJEKT_ABLOESUNG_VORWARNUNG), id)) => {
            let art = if typ == OBJEKT_ABLOESUNG {
                BenachrichtigungArt::AbloesungFaellig
            } else {
                BenachrichtigungArt::AbloesungVorwarnung
            };
            Some(
                neu(art, BenachrichtigungBezugTyp::Abloesung, id)
                    .an(Adressat::ModulLeser("abloesung")),
            )
        }
        _ => {
            let an = match f
                .empfaenger_funktion_code
                .as_deref()
                .and_then(Fuehrungsfunktion::parse)
            {
                Some(funktion) => Adressat::Funktion(funktion),
                None => Adressat::Nutzer(f.erstellt_von_id),
            };
            Some(
                neu(
                    BenachrichtigungArt::ErinnerungFaellig,
                    BenachrichtigungBezugTyp::Erinnerung,
                    f.id,
                )
                .an(an),
            )
        }
    })
}

/// Ob der Planungshinweis einer Schicht noch gilt (LLH-1131): sie läuft, und weder die
/// Einzelplanung noch die Ablöser-Liste nennt eine ablösende Einheit, und kein Besatzungswechsel
/// ist geplant (LLH-1319). Das Planen schließt die
/// Frist schon; das hier ist das Netz gegen einen Tick im selben Augenblick.
async fn planung_offen(pool: &SqlitePool, einsatz_id: i64, id: i64) -> Result<bool, AppError> {
    let r: Option<i64> = sqlx::query_scalar(
        "SELECT 1 FROM einsatz_abloesung a \
         WHERE a.id = ? AND a.einsatz_id = ? AND a.status = 'laufend' \
           AND a.abloesende_einheit_id IS NULL \
           AND NOT EXISTS (SELECT 1 FROM einsatz_abloesung_abloeser l WHERE l.abloesung_id = a.id) \
           AND NOT EXISTS (SELECT 1 FROM einsatz_abloesung_besatzung_plan p \
                           WHERE p.abloesung_id = a.id)",
    )
    .bind(id)
    .bind(einsatz_id)
    .fetch_optional(pool)
    .await?;
    Ok(r.is_some())
}

/// Der Anlass eines überfälligen Auftrags: Auftraggeber und jede Funktion oder Person, deren
/// Zeile noch nicht quittiert ist (Spec „Überfälliger Auftrag alarmiert Auftraggeber und
/// Empfänger“). `None`, wenn er nicht (mehr) überfällig ist: aufgehoben, fremd, gelöscht oder
/// von allen quittiert — dieselbe Regel wie `ist_ueberfaellig_sql!` ohne die Frist, die der
/// Scheduler schon geprüft hat.
async fn auftrag_ueberfaellig(
    pool: &SqlitePool,
    einsatz_id: i64,
    auftrag_id: i64,
) -> Result<Option<Anlass>, AppError> {
    let auftraggeber: Option<i64> = sqlx::query_scalar(
        "SELECT erstellt_von_id FROM auftrag \
         WHERE id = ? AND einsatz_id = ? AND aufgehoben_at IS NULL",
    )
    .bind(auftrag_id)
    .bind(einsatz_id)
    .fetch_optional(pool)
    .await?;
    let Some(auftraggeber) = auftraggeber else {
        return Ok(None);
    };
    let offen = sqlx::query_as::<_, (String, Option<String>, Option<i64>)>(
        "SELECT empfaenger_typ, funktion, person_id FROM auftrag_empfaenger \
         WHERE auftrag_id = ? AND quittiert_at IS NULL ORDER BY id",
    )
    .bind(auftrag_id)
    .fetch_all(pool)
    .await?;
    if offen.is_empty() {
        return Ok(None);
    }
    let mut anlass = Anlass::neu(
        einsatz_id,
        BenachrichtigungArt::AuftragUeberfaellig,
        Bezug::neu(BenachrichtigungBezugTyp::Auftrag, auftrag_id),
    )
    .an(Adressat::Nutzer(auftraggeber));
    for (typ, funktion, person) in offen {
        // Einheit, Abschnitt, Fahrzeug und extern haben keinen Nutzer (design.md, Non-Goals);
        // eine Funktion ohne Katalogcode ist Freitext und wird nicht erraten
        // (`frontend/src/fuehrung/AGENTS.md`).
        match (
            typ.as_str(),
            funktion.as_deref().and_then(Fuehrungsfunktion::parse),
            person,
        ) {
            ("funktion", Some(f), _) => anlass = anlass.an(Adressat::Funktion(f)),
            ("person", _, Some(p)) => anlass = anlass.an(Adressat::Person(p)),
            _ => {}
        }
    }
    Ok(Some(anlass))
}
