//! Hinweis „Rückmeldung überfällig“ (LLH-1425, Katalog LLH-1142 E1, Spec `benachrichtigungen`,
//! „Rückmeldung überfällig“).
//!
//! **Was überfällig heißt:** dasselbe wie im Meldebild (LFH-610, `frontend/src/meldungen/
//! rueckmeldung.ts`): die jüngste an die Einheit gebundene Meldung ([`repo::letzte_je_einheit`],
//! ohne aufgelöste Einheiten) plus die wirksame Rückmeldefrist (Einsatz vor Organisation vor
//! [`super::RUECKMELDUNG_FRIST_DEFAULT_MIN`]) liegt nicht nach `jetzt`. Eine Einheit, die sich
//! noch nie zurückgemeldet hat, ist nicht überfällig, sondern „keine Rückmeldung“ (Kachel im
//! Meldebild); sie meldet nichts, denn ohne Rückmeldung gibt es keinen Zeitpunkt, ab dem die Frist
//! liefe. Direkt an einen Abschnitt gebundene Meldungen melden ebenfalls nichts: die Rückmeldung
//! eines Abschnitts rechnet der Client über den Teilbaum aus denen seiner Einheiten, ein eigener
//! Hinweis wiederholte sie.
//!
//! **Je Überfälligkeit genau einmal:** der Merker `einsatz_einheit.rueckmeldung_ueberfaellig_
//! meldung_id` hält die Meldung, deren Überfälligkeit schon gemeldet ist. Er wird VOR dem Melden
//! per Vergleich gesetzt; nur wer die Zeile damit trifft, meldet (Muster
//! `lagebesprechung::ankuendigung`). Ein weiterer Takt oder ein paralleler Lauf findet ihn
//! gesetzt. Kommt eine neue Rückmeldung, ist die jüngste eine andere Meldung: ihre spätere
//! Überfälligkeit meldet wieder. Eine längere Frist macht eine schon gemeldete Überfälligkeit nicht
//! rückgängig; eine nachgereichte ältere Meldung ändert die jüngste nicht.
//!
//! **An wen:** wer im Einsatz Meldungen bearbeiten kann (`Adressat::ModulSchreiber("meldungen")`,
//! wie der Eingang einer Meldung ohne Empfängerfunktion): die Rückmeldungen liest nur, wer das
//! Modul Meldungen lesen darf (`GET …/meldungen/rueckmeldungen`). Bezug ist die Einheit; wer
//! etwas bekommt, entscheidet [`crate::benachrichtigung::melden`] (`src/AGENTS.md`,
//! Benachrichtigungen), auch das Leserecht am Modul Einheiten.

use chrono::{DateTime, Utc};
use sqlx::{SqliteConnection, SqlitePool};
use std::collections::HashMap;

use super::repo;
use crate::benachrichtigung::{
    melden, Adressat, Anlass, BenachrichtigungArt, BenachrichtigungBezugTyp, Bezug,
};
use crate::error::AppError;
use crate::live::LiveHub;

/// Fälligkeit einer Rückmeldung: `ereigniszeit` + `frist_min` (UTC). Ein nicht parsebarer
/// Altwert fällt auf die Ereigniszeit selbst zurück — die Einheit gilt dann sofort als
/// überfällig, was auffällt, statt still als rechtzeitig durchzugehen.
pub fn faellig_at(ereigniszeit: &str, frist_min: i64) -> String {
    crate::zeit::plus_minuten(ereigniszeit, frist_min).unwrap_or_else(|| ereigniszeit.to_string())
}

/// Ob eine Rückmeldung mit Fälligkeit `faellig_at` zum Zeitpunkt `jetzt` überfällig ist; wie der
/// Client (`rueckmeldungZustand`): ab der Fälligkeit, ein unlesbarer Wert gilt als überfällig.
pub fn ist_ueberfaellig(faellig_at: &str, jetzt: DateTime<Utc>) -> bool {
    crate::zeit::parse_utc(faellig_at).is_none_or(|f| f <= jetzt)
}

/// Die wirksame Rückmeldefrist eines Einsatzes in Minuten (Einsatz ?? Organisation ?? Vorgabe).
pub async fn frist_min(pool: &SqlitePool, einsatz_id: i64, org_id: i64) -> Result<i64, AppError> {
    let einst = crate::einsatz::einstellungen::laden_oder_default(pool, einsatz_id).await?;
    let org_einst = crate::org::einstellungen::laden_oder_default(pool, org_id).await?;
    Ok(frist_aus(&einst, &org_einst))
}

fn frist_aus(
    einst: &crate::einsatz::einstellungen::EinsatzEinstellungen,
    org_einst: &crate::org::einstellungen::OrgEinstellungen,
) -> i64 {
    crate::einsatz::effektiv::effektive_rueckmeldung_frist_min(einst, org_einst)
        .unwrap_or(super::RUECKMELDUNG_FRIST_DEFAULT_MIN)
}

/// Merkt die zum Zeitpunkt `jetzt` schon überfälligen Rückmeldungen eines Einsatzes als
/// gemeldet, OHNE zu melden; liefert ihre Zahl. Für einen Bestand, der auf einmal entsteht
/// (Demo-Import, `demo::import`, D10 „kein Alarm auf Vorrat“): sonst meldete der erste Takt
/// danach jede Einheit des Drehbuchs zugleich. Was erst später überfällig wird, meldet der Takt
/// wie sonst.
pub async fn vormerken_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    org_id: i64,
    jetzt: DateTime<Utc>,
) -> Result<u64, AppError> {
    let einst = crate::einsatz::einstellungen::laden_oder_default(&mut *conn, einsatz_id).await?;
    let org_einst = crate::org::einstellungen::laden_oder_default(&mut *conn, org_id).await?;
    let frist = frist_aus(&einst, &org_einst);
    let mut anzahl = 0;
    for r in repo::letzte_je_einheit(&mut *conn, einsatz_id).await? {
        if !ist_ueberfaellig(&faellig_at(&r.ereigniszeit, frist), jetzt) {
            continue;
        }
        anzahl += sqlx::query(
            "UPDATE einsatz_einheit SET rueckmeldung_ueberfaellig_meldung_id = ? \
             WHERE id = ? AND einsatz_id = ?",
        )
        .bind(r.meldung_id)
        .bind(r.bezug_id)
        .bind(einsatz_id)
        .execute(&mut *conn)
        .await?
        .rows_affected();
    }
    Ok(anzahl)
}

/// Ein Lauf für den Zeitpunkt `jetzt` über alle laufenden Einsätze: meldet jede neu überfällige
/// Rückmeldung einer Einheit. Liefert die Zahl der Meldungen (Einheiten, nicht Empfänger). Ein
/// Fehler in einem Einsatz wird geloggt und hält die anderen nicht auf.
pub async fn ueberfaellige_melden(
    pool: &SqlitePool,
    live: &LiveHub,
    jetzt: DateTime<Utc>,
) -> usize {
    let einsaetze: Vec<(i64, i64)> = match sqlx::query_as(
        "SELECT id, org_id FROM einsatz WHERE status = 'aktiv' AND geloescht_at IS NULL \
           AND geschwaerzt_at IS NULL ORDER BY id",
    )
    .fetch_all(pool)
    .await
    {
        Ok(v) => v,
        Err(e) => {
            tracing::warn!("Rückmeldungen nicht geprüft: {e}");
            return 0;
        }
    };
    let mut anzahl = 0;
    for (einsatz_id, org_id) in einsaetze {
        match melden_fuer(pool, live, einsatz_id, org_id, jetzt).await {
            Ok(n) => anzahl += n,
            Err(e) => tracing::warn!(einsatz_id, fehler = %e, "Rückmeldungen nicht geprüft"),
        }
    }
    anzahl
}

async fn melden_fuer(
    pool: &SqlitePool,
    live: &LiveHub,
    einsatz_id: i64,
    org_id: i64,
    jetzt: DateTime<Utc>,
) -> Result<usize, AppError> {
    let letzte = repo::letzte_je_einheit(pool, einsatz_id).await?;
    if letzte.is_empty() {
        return Ok(0);
    }
    let frist = frist_min(pool, einsatz_id, org_id).await?;
    // Die schon gemeldeten Überfälligkeiten in einem Zug: ein Takt ohne neue Überfälligkeit
    // schreibt nichts. Aufgelöste Einheiten stehen nicht in `letzte`.
    let gemeldet: HashMap<i64, i64> = sqlx::query_as::<_, (i64, i64)>(
        "SELECT id, rueckmeldung_ueberfaellig_meldung_id FROM einsatz_einheit \
         WHERE einsatz_id = ? AND aufgeloest_at IS NULL \
           AND rueckmeldung_ueberfaellig_meldung_id IS NOT NULL",
    )
    .bind(einsatz_id)
    .fetch_all(pool)
    .await?
    .into_iter()
    .collect();
    let mut anzahl = 0;
    for r in letzte {
        if gemeldet.get(&r.bezug_id) == Some(&r.meldung_id)
            || !ist_ueberfaellig(&faellig_at(&r.ereigniszeit, frist), jetzt)
        {
            continue;
        }
        let gemerkt = sqlx::query(
            "UPDATE einsatz_einheit SET rueckmeldung_ueberfaellig_meldung_id = ?1 \
             WHERE id = ?2 AND einsatz_id = ?3 \
               AND rueckmeldung_ueberfaellig_meldung_id IS NOT ?1",
        )
        .bind(r.meldung_id)
        .bind(r.bezug_id)
        .bind(einsatz_id)
        .execute(pool)
        .await?
        .rows_affected()
            == 1;
        if !gemerkt {
            continue;
        }
        melden(
            pool,
            live,
            Anlass::neu(
                einsatz_id,
                BenachrichtigungArt::RueckmeldungUeberfaellig,
                Bezug::neu(BenachrichtigungBezugTyp::Einheit, r.bezug_id),
            )
            .an(Adressat::ModulSchreiber("meldungen")),
        )
        .await;
        anzahl += 1;
    }
    Ok(anzahl)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn t(s: &str) -> DateTime<Utc> {
        crate::zeit::parse_utc(s).unwrap()
    }

    #[test]
    fn faellig_at_addiert_frist_ueber_die_tagesgrenze() {
        assert_eq!(faellig_at("2026-09-22 23:30:00", 60), "2026-09-23 00:30:00");
        assert_eq!(faellig_at("kaputt", 60), "kaputt");
    }

    #[test]
    fn ueberfaellig_ab_der_faelligkeit_und_bei_unlesbarem_wert() {
        let faellig = "2026-10-26 09:00:00";
        assert!(!ist_ueberfaellig(faellig, t("2026-10-26 08:59:59")));
        assert!(ist_ueberfaellig(faellig, t("2026-10-26 09:00:00")));
        assert!(ist_ueberfaellig("kaputt", t("2026-10-26 08:00:00")));
    }
}
