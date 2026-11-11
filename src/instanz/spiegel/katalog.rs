//! Sprechgruppen aus dem Katalog der Org am Spiegel (LLH-1629, design.md der Change
//! `polrv1lt-spiegel-antraege`, Nachtrag „Katalog-Sprechgruppen“).
//!
//! Ein Einsatz darf Sprechgruppen aus dem Katalog der Org nutzen (`einsatz_id IS NULL`); sie
//! stehen in keinem Änderungslog eines Einsatzes. Deshalb:
//!
//! - **Liefern:** Jede genutzte Katalogzeile geht als mitgelieferte Abhängigkeit hinaus, auch
//!   ohne Logzeile ([`ist_katalogzeile`]). Die meldende Seite nennt dazu den Schlüssel beim
//!   Gegenüber, wenn die Herkunft der Stammdaten ihn kennt ([`gegen_hinaus`]). Ändert sich die
//!   Katalogzeile, schreibt der Trigger `sprechgruppe_spiegelkatalog_u` (Migration 0315) sie ins
//!   Log jedes nutzenden Einsatzes.
//! - **Übernehmen** ([`uebernehmen`]): Gegenstück aus dem eigenen Katalog (Herkunft der
//!   Stammdaten), sonst eine gleichnamige Sprechgruppe des Spiegels, sonst eine Kopie als
//!   Sprechgruppe des Spiegels. Ein Gegenstück steht in `spiegel_katalog` und wird vom Spiegel nie
//!   geändert; eine Kopie steht wie jede Zeile in `spiegel_herkunft` und zieht nach.

use super::abbildung;
use super::paket::Zeile;
use super::uebernehmen::Empfaenger;
use crate::error::AppError;
use crate::instanz::stammdaten::StammdatenArt;
use serde_json::{Map, Value};
use sqlx::SqliteConnection;

/// Zuordnungen auf Sprechgruppen, deren Katalogzeile ein Absender vor LLH-1629 nicht mitliefert
/// ([`super::paket::EinsatzLieferung::katalog`]). Fehlt ihr Bezug, wartet der Spiegel bei ihm
/// nicht darauf, sonst bliebe sein Stand bis zum Update des Absenders stehen.
pub const OHNE_KATALOG: &[&str] = &[
    "einsatz_fuehrungsstelle_sprechgruppe",
    "einsatzabschnitt_sprechgruppe",
    "einsatz_einheit_sprechgruppe",
    "einsatz_kommunikation_stelle_sprechgruppe",
    "fernmeldeskizze_komponente_sprechgruppe",
];

/// Merkt den Stand der ersten Zuordnung, die ein älterer Absender ohne Katalogzeile geliefert hat
/// (`katalog_ab`), und setzt den Stand des Spiegels darauf zurück, sobald derselbe Führer
/// Katalogzeilen liefert: Die übersprungenen Zuordnungen kommen dann mit dem nächsten Abgleich
/// erneut, samt ihrer Sprechgruppe.
pub async fn nach_update_neu_holen(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    l: &super::paket::EinsatzLieferung,
    katalog_ab: Option<i64>,
) -> Result<(), sqlx::Error> {
    if l.katalog {
        // Lag die gemerkte Zeile in dieser Lieferung, ist sie neu übernommen worden (scheitert sie
        // wieder, hält `nachholen_ab` den Stand davor). Sonst, auch bei einer kürzeren
        // Wiederholung darunter, höchstens bis davor bestätigen und den Merker behalten.
        sqlx::query(
            "UPDATE einsatz_spiegel SET \
             stand = CASE WHEN ?1 < katalog_ab AND ?2 >= katalog_ab THEN stand \
                          ELSE MIN(stand, katalog_ab - 1) END, \
             katalog_ab = CASE WHEN ?1 < katalog_ab AND ?2 >= katalog_ab THEN NULL \
                               ELSE katalog_ab END \
             WHERE einsatz_id = ?3 AND katalog_ab IS NOT NULL",
        )
        .bind(l.seit)
        .bind(l.bis)
        .bind(einsatz_id)
        .execute(&mut *conn)
        .await?;
    } else if let Some(ab) = katalog_ab {
        sqlx::query(
            "UPDATE einsatz_spiegel SET katalog_ab = MIN(COALESCE(katalog_ab, ?1), ?1) \
             WHERE einsatz_id = ?2",
        )
        .bind(ab)
        .bind(einsatz_id)
        .execute(&mut *conn)
        .await?;
    }
    Ok(())
}

/// Gespiegelte Tabellen mit Katalogzeilen (`einsatz_id IS NULL`) und ihre Stammdatenart.
const KATALOGE: &[(&str, StammdatenArt)] = &[("sprechgruppe", StammdatenArt::Sprechgruppe)];

fn art_von(tabelle: &str) -> Option<StammdatenArt> {
    KATALOGE
        .iter()
        .find(|(t, _)| *t == tabelle)
        .map(|(_, a)| *a)
}

/// Ob die gelieferten Daten eine Katalogzeile sind.
pub fn ist_katalog_daten(tabelle: &str, daten: &Map<String, Value>) -> bool {
    art_von(tabelle).is_some() && daten.get("einsatz_id").is_none_or(Value::is_null)
}

/// Ob die lokale Zeile `schluessel` eine Katalogzeile ist.
pub async fn ist_katalogzeile(
    conn: &mut SqliteConnection,
    tabelle: &str,
    schluessel: &str,
) -> Result<bool, AppError> {
    if art_von(tabelle).is_none() {
        return Ok(false);
    }
    let katalog: Option<bool> = sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
        "SELECT einsatz_id IS NULL FROM {tabelle} WHERE id = ?"
    )))
    .bind(schluessel)
    .fetch_optional(&mut *conn)
    .await?;
    Ok(katalog == Some(true))
}

/// Schlüssel einer Katalogzeile beim Gegenüber, nur an der meldenden Seite bekannt (Herkunft der
/// Stammdaten).
pub async fn gegen_hinaus(
    conn: &mut SqliteConnection,
    kopplung_org_id: i64,
    tabelle: &str,
    schluessel: &str,
) -> Result<Option<String>, AppError> {
    let (Some(art), Ok(id)) = (art_von(tabelle), schluessel.parse::<i64>()) else {
        return Ok(None);
    };
    Ok(abbildung::stammdaten_fremd(conn, kopplung_org_id, art, id)
        .await?
        .map(|f| f.to_string()))
}

/// Lokaler Schlüssel einer mitbenutzten Katalogzeile des Führers (`spiegel_katalog`).
pub async fn lokal(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    tabelle: &str,
    fremd: &str,
) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT lokaler_schluessel FROM spiegel_katalog \
         WHERE einsatz_id = ? AND art = ? AND fremder_schluessel = ?",
    )
    .bind(einsatz_id)
    .bind(tabelle)
    .bind(fremd)
    .fetch_optional(&mut *conn)
    .await
}

/// Schlüssel beim Führer zu einer mitbenutzten lokalen Katalogzeile (für Anträge).
pub async fn fremd(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    tabelle: &str,
    lokal: &str,
) -> Result<Option<String>, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT fremder_schluessel FROM spiegel_katalog \
         WHERE einsatz_id = ? AND art = ? AND lokaler_schluessel = ? \
         ORDER BY fremder_schluessel LIMIT 1",
    )
    .bind(einsatz_id)
    .bind(tabelle)
    .bind(lokal)
    .fetch_optional(&mut *conn)
    .await
}

/// Was mit einer gelieferten Katalogzeile geschieht.
pub enum Katalog {
    /// Ein Gegenstück ist (jetzt) gemerkt; die Zeile selbst wird nicht geschrieben.
    Gegenstueck,
    /// Kopie als Zeile des Spiegels anlegen oder nachziehen, mit diesen Daten.
    Kopie(Map<String, Value>),
}

/// Bildet eine gelieferte Katalogzeile ab: Gegenstück oder Kopie (Moduldoku).
pub async fn uebernehmen(
    conn: &mut SqliteConnection,
    e: &Empfaenger,
    einsatz_id: i64,
    z: &Zeile,
    daten: &Map<String, Value>,
) -> Result<Katalog, AppError> {
    let tabelle = z.art.as_str();
    let art = art_von(tabelle).expect("nur für Katalogzeilen");
    if lokal(conn, einsatz_id, tabelle, &z.schluessel)
        .await?
        .is_some()
    {
        return Ok(Katalog::Gegenstueck);
    }
    let kopie = abbildung::einsatz_lokal(conn, einsatz_id, tabelle, &z.schluessel)
        .await?
        .is_some();
    if !kopie {
        if let Some(l) = gegenstueck(conn, e, einsatz_id, art, z, daten).await? {
            sqlx::query(
                "INSERT INTO spiegel_katalog (einsatz_id, art, fremder_schluessel, lokaler_schluessel) \
                 VALUES (?, ?, ?, ?)",
            )
            .bind(einsatz_id)
            .bind(tabelle)
            .bind(&z.schluessel)
            .bind(l.to_string())
            .execute(&mut *conn)
            .await?;
            return Ok(Katalog::Gegenstueck);
        }
    }
    // Die Kopie gehört dem Spiegel: `einsatz_id` zeigt auf den Einsatz des Führers und wird beim
    // Abbilden zum Spiegel (jeder Wert dort bildet auf den Spiegel ab).
    let mut d = daten.clone();
    d.insert("einsatz_id".into(), Value::from(0));
    Ok(Katalog::Kopie(d))
}

/// Gegenstück im eigenen Katalog (Herkunft der Stammdaten) oder eine gleichnamige Sprechgruppe
/// des Spiegels (sonst stieße die Kopie an deren eindeutigen Namen).
async fn gegenstueck(
    conn: &mut SqliteConnection,
    e: &Empfaenger,
    einsatz_id: i64,
    art: StammdatenArt,
    z: &Zeile,
    daten: &Map<String, Value>,
) -> Result<Option<i64>, AppError> {
    let kandidat = if e.meldend {
        match z.schluessel.parse::<i64>() {
            Ok(id) => abbildung::stammdaten_lokal(conn, e.kopplung_org_id, art, id).await?,
            Err(_) => None,
        }
    } else {
        z.gegen.as_deref().and_then(|g| g.parse::<i64>().ok())
    };
    if let Some(id) = kandidat {
        let im_katalog: Option<i64> = sqlx::query_scalar(
            "SELECT id FROM sprechgruppe WHERE id = ? AND org_id = ? AND einsatz_id IS NULL",
        )
        .bind(id)
        .bind(e.org_id)
        .fetch_optional(&mut *conn)
        .await?;
        if im_katalog.is_some() {
            return Ok(im_katalog);
        }
    }
    let (Some(betriebsart), Some(bezeichnung)) = (
        daten.get("betriebsart").and_then(Value::as_str),
        daten.get("bezeichnung").and_then(Value::as_str),
    ) else {
        return Ok(None);
    };
    Ok(sqlx::query_scalar(
        "SELECT id FROM sprechgruppe WHERE einsatz_id = ? AND betriebsart = ? AND bezeichnung = ?",
    )
    .bind(einsatz_id)
    .bind(betriebsart)
    .bind(bezeichnung)
    .fetch_optional(&mut *conn)
    .await?)
}

#[cfg(test)]
mod tests {
    use super::super::art;

    /// Der Trigger `sprechgruppe_spiegelkatalog_u` kennt jede gespiegelte Tabelle, die auf eine
    /// Sprechgruppe verweist; sonst zöge eine Kopie am Spiegel nach einer Änderung nicht nach.
    #[tokio::test]
    async fn der_log_trigger_kennt_jeden_verweis_auf_sprechgruppen() {
        let pool = crate::db::test_pool().await;
        let mut conn = pool.acquire().await.unwrap();
        let sql: String = sqlx::query_scalar(
            "SELECT sql FROM sqlite_master WHERE type = 'trigger' \
             AND name = 'sprechgruppe_spiegelkatalog_u'",
        )
        .fetch_one(&mut *conn)
        .await
        .unwrap();
        let sql = sql.split_whitespace().collect::<Vec<_>>().join(" ");
        let mut fehlend = Vec::new();
        for g in art::GESPIEGELT {
            let fks: Vec<(String, String)> = sqlx::query_as(sqlx::AssertSqlSafe(format!(
                "SELECT \"from\", \"table\" FROM pragma_foreign_key_list('{}')",
                g.tabelle
            )))
            .fetch_all(&mut *conn)
            .await
            .unwrap();
            for (von, ziel) in fks {
                if ziel != "sprechgruppe" {
                    continue;
                }
                // Beide Hälften des Triggers (Log leeren, Log schreiben).
                let n = sql.matches(&format!("FROM {} ", g.tabelle)).count();
                let spalte = sql.matches(&format!("{von} = NEW.id")).count();
                if n < 2 || spalte < 2 {
                    fehlend.push(format!("{}.{von}", g.tabelle));
                }
            }
        }
        assert!(
            sql.contains("FROM fernmeldeskizze_lage WHERE element = 'sg-' || NEW.id"),
            "Skizzen-Element sg-<id>"
        );
        assert!(
            fehlend.is_empty(),
            "Verweise auf Sprechgruppen ohne Eintrag im Trigger:\n  {}",
            fehlend.join("\n  ")
        );
    }
}
