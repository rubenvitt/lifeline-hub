use crate::error::AppError;
use crate::person::{VerbleibArt, VerbleibStatus};
use serde::Serialize;
use sqlx::SqlitePool;
use utoipa::ToSchema;

/// Ein Verbleib-Ereignis (1:1 zu `person_verbleib`).
#[derive(Debug, Clone, Serialize, sqlx::FromRow, ToSchema)]
pub struct VerbleibAnzeige {
    pub id: i64,
    pub einsatz_id: i64,
    pub person_id: i64,
    pub art: VerbleibArt,
    pub transportmittel: Option<String>,
    pub ziel: Option<String>,
    pub status: Option<VerbleibStatus>,
    pub notiz: Option<String>,
    pub zeitpunkt_at: String,
    pub erfasst_von: i64,
    /// Betreuungsstelle eines Notunterkunft-Verbleibs (LFH-674). Nur die Kennung: den Namen
    /// liest, wer das Modul Betreuung sehen darf, aus dessen Übersicht.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub betreuungsstelle_id: Option<i64>,
}

/// Eingabedaten beim Erfassen; Strings bereits getrimmt (Handler). `art`/`status`
/// sind bereits validiert (Handler via `VerbleibArt`).
#[derive(Debug)]
pub struct VerbleibDaten<'a> {
    pub art: &'a str,
    pub transportmittel: Option<&'a str>,
    pub ziel: Option<&'a str>,
    pub status: Option<&'a str>,
    pub notiz: Option<&'a str>,
    /// Nur bei `notunterkunft`; Art, Rechte und Einsatzzugehörigkeit prüft der Handler.
    pub betreuungsstelle_id: Option<i64>,
}

const SELECT_VERBLEIB: &str = "\
    SELECT id, einsatz_id, person_id, art, transportmittel, ziel, status, notiz, \
           zeitpunkt_at, erfasst_von, betreuungsstelle_id \
    FROM person_verbleib";

/// Erfasst ein Verbleib-Ereignis append-only und aktualisiert den Verbleib-Cache an der
/// Person in DERSELBEN Transaktion: die Kurzform `aktueller_verbleib` (vom Handler berechnet)
/// und — seit LFH-613 — Art, Ziel und Status als eigene Spalten, seit LFH-674 auch den Verweis
/// auf die Betreuungsstelle. Der neue Eintrag ist per
/// Definition der jüngste (`zeitpunkt_at` = jetzt, höchste id), der Cache spiegelt also
/// genau das Ereignis, das `liste_je_person` zuoberst liefert.
pub async fn erfassen(
    pool: &SqlitePool,
    einsatz_id: i64,
    person_id: i64,
    daten: VerbleibDaten<'_>,
    kurzform: &str,
    erfasst_von: i64,
) -> Result<VerbleibAnzeige, AppError> {
    let mut tx = pool.begin().await?;
    let id: i64 = sqlx::query_scalar(
        "INSERT INTO person_verbleib \
            (einsatz_id, person_id, art, transportmittel, ziel, status, notiz, erfasst_von, \
             betreuungsstelle_id) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(einsatz_id)
    .bind(person_id)
    .bind(daten.art)
    .bind(daten.transportmittel)
    .bind(daten.ziel)
    .bind(daten.status)
    .bind(daten.notiz)
    .bind(erfasst_von)
    .bind(daten.betreuungsstelle_id)
    .fetch_one(&mut *tx)
    .await?;
    sqlx::query(
        "UPDATE einsatz_person SET aktueller_verbleib = ?1, aktuelle_verbleib_art = ?2, \
            aktuelles_verbleib_ziel = ?3, aktueller_verbleib_status = ?4, \
            aktuelle_verbleib_betreuungsstelle_id = ?5 \
         WHERE id = ?6 AND einsatz_id = ?7",
    )
    .bind(kurzform)
    .bind(daten.art)
    .bind(daten.ziel)
    .bind(daten.status)
    .bind(daten.betreuungsstelle_id)
    .bind(person_id)
    .bind(einsatz_id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    laden(pool, einsatz_id, id).await
}

/// Lädt ein Verbleib-Ereignis; `NotFound`, falls nicht zum Einsatz.
pub async fn laden(
    pool: &SqlitePool,
    einsatz_id: i64,
    id: i64,
) -> Result<VerbleibAnzeige, AppError> {
    sqlx::query_as::<_, VerbleibAnzeige>(sqlx::AssertSqlSafe(format!(
        "{SELECT_VERBLEIB} WHERE id = ? AND einsatz_id = ?"
    )))
    .bind(id)
    .bind(einsatz_id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)
}

/// Verbleib-Verlauf einer Person (neueste zuerst).
pub async fn liste_je_person(
    pool: &SqlitePool,
    einsatz_id: i64,
    person_id: i64,
) -> Result<Vec<VerbleibAnzeige>, AppError> {
    Ok(
        sqlx::query_as::<_, VerbleibAnzeige>(sqlx::AssertSqlSafe(format!(
            "{SELECT_VERBLEIB} WHERE einsatz_id = ? AND person_id = ? \
         ORDER BY zeitpunkt_at DESC, id DESC"
        )))
        .bind(einsatz_id)
        .bind(person_id)
        .fetch_all(pool)
        .await?,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_pool;
    use sqlx::SqlitePool;

    async fn setup(pool: &SqlitePool) -> (i64, i64, i64) {
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Test-Orga')")
            .execute(pool)
            .await
            .unwrap();
        let b: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash, system_rolle, org_rolle, aktiv) \
             VALUES (1, 'A', 'a', 'h', 'keiner', 'keine', 1) RETURNING id")
            .fetch_one(pool).await.unwrap();
        let e: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung, status, begonnen_at, einsatzart, angelegt_at) \
             VALUES (1, 'Lage', 'aktiv', '2026-05-27', 'realeinsatz', '2026-05-27') RETURNING id")
            .fetch_one(pool).await.unwrap();
        let p: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_person (einsatz_id, registrier_nr, erfasst_von, geaendert_von) \
             VALUES (?, 1, ?, ?) RETURNING id",
        )
        .bind(e)
        .bind(b)
        .bind(b)
        .fetch_one(pool)
        .await
        .unwrap();
        (b, e, p)
    }

    fn daten<'a>(art: &'a str, ziel: Option<&'a str>) -> VerbleibDaten<'a> {
        VerbleibDaten {
            art,
            transportmittel: None,
            ziel,
            status: None,
            notiz: None,
            betreuungsstelle_id: None,
        }
    }

    async fn stelle_anlegen(pool: &SqlitePool, e: i64, b: i64, bezeichnung: &str) -> i64 {
        sqlx::query_scalar(
            "INSERT INTO betreuungsstelle (einsatz_id, bezeichnung, art, angelegt_von_id) \
             VALUES (?, ?, 'notunterkunft', ?) RETURNING id",
        )
        .bind(e)
        .bind(bezeichnung)
        .bind(b)
        .fetch_one(pool)
        .await
        .unwrap()
    }

    /// LFH-674: Der Verweis auf die Betreuungsstelle geht ins Ereignis UND in den Cache der
    /// Person; ein späterer Verbleib ohne Verweis leert den Cache, der Verlauf behält ihn.
    #[tokio::test]
    async fn erfassen_pflegt_verweis_auf_betreuungsstelle() {
        let pool = test_pool().await;
        let (b, e, p) = setup(&pool).await;
        let stelle = stelle_anlegen(&pool, e, b, "NU Turnhalle Nord").await;
        let cache = |pool: SqlitePool| async move {
            sqlx::query_scalar::<_, Option<i64>>(
                "SELECT aktuelle_verbleib_betreuungsstelle_id FROM einsatz_person WHERE id = ?",
            )
            .bind(p)
            .fetch_one(&pool)
            .await
            .unwrap()
        };
        let erstes = erfassen(
            &pool,
            e,
            p,
            VerbleibDaten {
                betreuungsstelle_id: Some(stelle),
                ..daten("notunterkunft", Some("NU Turnhalle Nord"))
            },
            "Notunterkunft → NU Turnhalle Nord",
            b,
        )
        .await
        .unwrap();
        assert_eq!(erstes.betreuungsstelle_id, Some(stelle));
        assert_eq!(cache(pool.clone()).await, Some(stelle));

        erfassen(&pool, e, p, daten("entlassung", None), "entlassen", b)
            .await
            .unwrap();
        assert_eq!(
            cache(pool.clone()).await,
            None,
            "Verweis bleibt nicht stehen"
        );
        let verlauf = liste_je_person(&pool, e, p).await.unwrap();
        assert_eq!(verlauf[0].betreuungsstelle_id, None);
        assert_eq!(
            verlauf[1].betreuungsstelle_id,
            Some(stelle),
            "Verlauf behält den Verweis"
        );
    }

    /// Ohne Verweis fehlt das Feld in der Anzeige (Norm LFH-265), statt `null` zu tragen.
    #[tokio::test]
    async fn anzeige_ohne_verweis_laesst_feld_weg() {
        let pool = test_pool().await;
        let (b, e, p) = setup(&pool).await;
        let v = erfassen(&pool, e, p, daten("vor_ort", None), "vor Ort", b)
            .await
            .unwrap();
        let json = serde_json::to_value(&v).unwrap();
        assert!(!json
            .as_object()
            .unwrap()
            .contains_key("betreuungsstelle_id"));
    }

    #[tokio::test]
    async fn erfassen_ist_append_only_und_cache_spiegelt_juengsten() {
        let pool = test_pool().await;
        let (b, e, p) = setup(&pool).await;
        erfassen(&pool, e, p, daten("vor_ort", None), "vor Ort", b)
            .await
            .unwrap();
        erfassen(
            &pool,
            e,
            p,
            daten("transport", Some("KH Mitte")),
            "Transport → KH Mitte",
            b,
        )
        .await
        .unwrap();
        let verlauf = liste_je_person(&pool, e, p).await.unwrap();
        assert_eq!(verlauf.len(), 2, "append-only");
        assert_eq!(verlauf[0].art, VerbleibArt::Transport, "neueste zuerst");
        let cache: Option<String> =
            sqlx::query_scalar("SELECT aktueller_verbleib FROM einsatz_person WHERE id = ?")
                .bind(p)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(cache.as_deref(), Some("Transport → KH Mitte"));
    }

    /// LFH-613: Art, Ziel und Status gehen als eigene Cache-Spalten mit — und ein späteres
    /// Ereignis ohne Ziel/Status leert sie, statt den Vorwert stehen zu lassen.
    #[tokio::test]
    async fn erfassen_pflegt_art_ziel_und_status_im_cache() {
        let pool = test_pool().await;
        let (b, e, p) = setup(&pool).await;
        let cache = |pool: SqlitePool| async move {
            sqlx::query_as::<_, (Option<String>, Option<String>, Option<String>)>(
                "SELECT aktuelle_verbleib_art, aktuelles_verbleib_ziel, aktueller_verbleib_status \
                 FROM einsatz_person WHERE id = ?",
            )
            .bind(p)
            .fetch_one(&pool)
            .await
            .unwrap()
        };
        erfassen(
            &pool,
            e,
            p,
            VerbleibDaten {
                status: Some("angemeldet"),
                ..daten("transport", Some("KH Mitte"))
            },
            "Transport → KH Mitte",
            b,
        )
        .await
        .unwrap();
        assert_eq!(
            cache(pool.clone()).await,
            (
                Some("transport".into()),
                Some("KH Mitte".into()),
                Some("angemeldet".into())
            )
        );
        erfassen(
            &pool,
            e,
            p,
            daten("notunterkunft", None),
            "Notunterkunft",
            b,
        )
        .await
        .unwrap();
        assert_eq!(
            cache(pool.clone()).await,
            (Some("notunterkunft".into()), None, None),
            "Ziel und Status des Vorgängers bleiben nicht stehen"
        );
    }
}
