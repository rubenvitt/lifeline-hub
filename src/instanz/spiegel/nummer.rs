//! Einsatznummer beim Übergang vom Spiegel zum eigenen Einsatz (Spec `einsatznummer`, „Freie
//! Nummer, wenn ein Spiegel zum eigenen Einsatz wird“; LLH-1647, LLH-1703).
//!
//! ELW und Hub vergeben Einsatznummern unabhängig; ein Spiegel ist von ihrer Eindeutigkeit
//! ausgenommen (`idx_einsatz_nummer… WHERE spiegel = 0`). Sobald die Zeile in `einsatz_spiegel`
//! fällt, gilt die Eindeutigkeit wieder. Jeder Weg, der sie entfernt, ruft deshalb vorher
//! [`ensure_freie_nummer`].

use crate::error::AppError;
use sqlx::SqliteConnection;

/// Vergibt eine eigene Nummer, wenn die des Spiegels in seiner Org schon ein eigener Einsatz oder
/// das Löschprotokoll trägt. Liefert (alt, neu) bei einer Umnummerierung. Läuft unter dem Merker.
/// Ein Einsatz ohne Nummer (Altbestand) stößt an keine Eindeutigkeit und bleibt, wie er ist.
pub(super) async fn ensure_freie_nummer(
    conn: &mut SqliteConnection,
    id: i64,
) -> Result<Option<(String, String)>, AppError> {
    #[allow(clippy::type_complexity)]
    let (org_id, nummer, jahr, lfd): (i64, Option<String>, Option<i64>, Option<i64>) =
        sqlx::query_as(
            "SELECT org_id, einsatznummer_intern, nummer_jahr, nummer_lfd FROM einsatz WHERE id = ?",
        )
        .bind(id)
        .fetch_one(&mut *conn)
        .await?;
    let Some(nummer) = nummer else {
        return Ok(None);
    };
    let belegt: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM einsatz WHERE org_id = ?1 AND spiegel = 0 AND id <> ?2 \
                        AND (einsatznummer_intern = ?3 \
                             OR (nummer_jahr = ?4 AND nummer_lfd = ?5))) \
             OR EXISTS (SELECT 1 FROM aufbewahrung_loeschprotokoll WHERE org_id = ?1 \
                        AND (einsatznummer_intern = ?3 \
                             OR (nummer_jahr = ?4 AND nummer_lfd = ?5)))",
    )
    .bind(org_id)
    .bind(id)
    .bind(&nummer)
    .bind(jahr)
    .bind(lfd)
    .fetch_one(&mut *conn)
    .await?;
    if !belegt {
        return Ok(None);
    }
    let (praefix, zeitzone): (Option<String>, Option<String>) = sqlx::query_as(
        "SELECT einsatz_nummer_praefix, zeitzone FROM org_einstellungen WHERE org_id = ?",
    )
    .bind(org_id)
    .fetch_optional(&mut *conn)
    .await?
    .unwrap_or((None, None));
    let jahr = match jahr {
        Some(j) => j,
        None => i64::from(crate::einsatz::nummer::jahr_in_zone(
            chrono::Utc::now(),
            zeitzone.as_deref(),
        )),
    };
    // Über allen Einsätzen des Jahres, auch Spiegeln, und dem Löschprotokoll: anders als die
    // Anlage (`einsatz::repo::anlegen_tx` zählt nur eigene), damit die neue Nummer keinem Spiegel
    // gleicht, der später selbst eigen werden kann und dann wieder umnummeriert würde.
    let max_lfd: Option<i64> = sqlx::query_scalar(
        "SELECT MAX(lfd) FROM ( \
             SELECT nummer_lfd AS lfd FROM einsatz WHERE org_id = ?1 AND nummer_jahr = ?2 \
             UNION ALL \
             SELECT nummer_lfd FROM aufbewahrung_loeschprotokoll \
             WHERE org_id = ?1 AND nummer_jahr = ?2)",
    )
    .bind(org_id)
    .bind(jahr)
    .fetch_one(&mut *conn)
    .await?;
    let mut neu_lfd = max_lfd.unwrap_or(0) + 1;
    let neu = loop {
        let kandidat = crate::einsatz::nummer::formatiere(
            praefix.as_deref(),
            i32::try_from(jahr).unwrap_or(0),
            neu_lfd,
        );
        let vergeben: bool = sqlx::query_scalar(
            "SELECT EXISTS (SELECT 1 FROM einsatz WHERE org_id = ?1 AND einsatznummer_intern = ?2) \
                 OR EXISTS (SELECT 1 FROM aufbewahrung_loeschprotokoll \
                            WHERE org_id = ?1 AND einsatznummer_intern = ?2)",
        )
        .bind(org_id)
        .bind(&kandidat)
        .fetch_one(&mut *conn)
        .await?;
        if !vergeben {
            break kandidat;
        }
        neu_lfd += 1;
    };
    sqlx::query(
        "UPDATE einsatz SET einsatznummer_intern = ?, nummer_jahr = ?, nummer_lfd = ? WHERE id = ?",
    )
    .bind(&neu)
    .bind(jahr)
    .bind(neu_lfd)
    .bind(id)
    .execute(&mut *conn)
    .await?;
    Ok(Some((nummer, neu)))
}

#[cfg(test)]
mod tests {
    use crate::instanz::fuehrung::repo::tests::gekoppelt;
    use sqlx::SqlitePool;

    /// Org 1 gekoppelt, Führung an.
    async fn pool() -> SqlitePool {
        let pool = crate::db::test_pool().await;
        gekoppelt(&pool).await;
        crate::instanz::fuehrung::save_schalter(&pool, true)
            .await
            .unwrap();
        pool
    }

    /// Ein Spiegel mit der Nummer `lfd` des Jahres 2026 (oder ohne Nummer), dessen Akte diese
    /// Instanz als Führer nennt; noch nicht ausgerichtet.
    async fn spiegel_mit_eigener_akte(pool: &SqlitePool, lfd: Option<i64>) -> i64 {
        let id: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung, kennung, einsatznummer_intern, \
             nummer_jahr, nummer_lfd, spiegel) \
             VALUES (1, 'Spiegel', 'hub/5-aa', \
                     CASE WHEN ?1 IS NULL THEN NULL ELSE 'E-2026-' || printf('%04d', ?1) END, \
                     CASE WHEN ?1 IS NULL THEN NULL ELSE 2026 END, ?1, 1) RETURNING id",
        )
        .bind(lfd)
        .fetch_one(pool)
        .await
        .unwrap();
        crate::einsatz::spiegel_filter::als_spiegel_markieren(pool, id).await;
        sqlx::query(
            "INSERT INTO einsatz_fuehrung (kennung, einsatz_id, org_id, bezeichnung, status, \
             epoche_zaehler, epoche_instanz, fuehrer_kennung, fuehrer_name, art, stand, \
             geaendert_at) \
             SELECT 'hub/5-aa', ?, 1, 'Spiegel', 'aktiv', 2, kennung, kennung, 'Diese Instanz', \
                    'notuebernahme', 1, '2026-11-12 10:00:00' FROM instanz_identitaet",
        )
        .bind(id)
        .execute(pool)
        .await
        .unwrap();
        id
    }

    async fn eigener_einsatz(pool: &SqlitePool, lfd: i64) {
        sqlx::query(
            "INSERT INTO einsatz (org_id, bezeichnung, einsatznummer_intern, nummer_jahr, \
             nummer_lfd) VALUES (1, 'Eigen', 'E-2026-' || printf('%04d', ?1), 2026, ?1)",
        )
        .bind(lfd)
        .execute(pool)
        .await
        .unwrap();
    }

    /// Ein weiterer Spiegel derselben Org mit der laufenden Nummer `lfd`, der Spiegel bleibt. Sein
    /// Text trägt das Präfix der Gegenstelle: So entscheidet allein die Zählung über die neue
    /// Nummer, nicht das Ausweichen vor einem vergebenen Text.
    async fn fremder_spiegel(pool: &SqlitePool, lfd: i64) {
        sqlx::query(
            "INSERT INTO einsatz (org_id, bezeichnung, einsatznummer_intern, nummer_jahr, \
             nummer_lfd, spiegel) \
             VALUES (1, 'Fremd', 'ELW-2026-' || printf('%04d', ?1), 2026, ?1, 1)",
        )
        .bind(lfd)
        .execute(pool)
        .await
        .unwrap();
    }

    async fn richte_aus(pool: &SqlitePool, id: i64) {
        let mut tx = pool.begin().await.unwrap();
        super::super::fuehrung::richte_aus(&mut tx, id)
            .await
            .expect("der Führungswechsel gelingt");
        tx.commit().await.unwrap();
    }

    /// (Nummer, ist Spiegel, ETB-Einträge) eines Einsatzes.
    async fn stand(pool: &SqlitePool, id: i64) -> (Option<String>, bool, i64) {
        sqlx::query_as(
            "SELECT einsatznummer_intern, spiegel = 1, \
             (SELECT COUNT(*) FROM etb_eintrag WHERE einsatz_id = einsatz.id) \
             FROM einsatz WHERE id = ?",
        )
        .bind(id)
        .fetch_one(pool)
        .await
        .unwrap()
    }

    /// Kein Konto für den ETB-Eintrag: Der Wechsel gelingt trotzdem, nur der Eintrag entfällt
    /// (`openspec/changes/archive/2026-11-12-a36p545r-nummer-beim-fuehrungswechsel/design.md`, D4).
    #[tokio::test]
    async fn ohne_konto_wird_umnummeriert_und_kein_eintrag_geschrieben() {
        let pool = pool().await;
        eigener_einsatz(&pool, 1).await;
        let id = spiegel_mit_eigener_akte(&pool, Some(1)).await;
        richte_aus(&pool, id).await;
        assert_eq!(
            stand(&pool, id).await,
            (Some("E-2026-0002".into()), false, 0)
        );
        let merker: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM spiegel_uebernahme")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(merker, 0, "der Merker der Übernahme bleibt nicht stehen");
        let akte: Option<String> =
            sqlx::query_scalar("SELECT nummer FROM einsatz_fuehrung WHERE einsatz_id = ?")
                .bind(id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(
            akte.as_deref(),
            Some("E-2026-0002"),
            "die Akte folgt sofort"
        );
    }

    /// Die neue Nummer liegt über allen Einsätzen des Jahres, auch über fremden Spiegeln (Spec
    /// `einsatznummer`, „Neue Nummer über den Spiegeln“): anders als die Anlage, die nur eigene
    /// zählt.
    #[tokio::test]
    async fn die_neue_nummer_liegt_ueber_den_spiegeln() {
        let pool = pool().await;
        eigener_einsatz(&pool, 1).await;
        eigener_einsatz(&pool, 2).await;
        for lfd in 2..=5 {
            fremder_spiegel(&pool, lfd).await;
        }
        let id = spiegel_mit_eigener_akte(&pool, Some(1)).await;
        richte_aus(&pool, id).await;
        assert_eq!(
            stand(&pool, id).await,
            (Some("E-2026-0006".into()), false, 0)
        );
    }

    #[tokio::test]
    async fn eine_nummer_im_loeschprotokoll_gilt_als_belegt() {
        let pool = pool().await;
        sqlx::query(
            "INSERT INTO aufbewahrung_loeschprotokoll (org_id, einsatz_id, art, gegenstelle, \
             einsatznummer_intern, nummer_jahr, nummer_lfd, abgeschlossen_at, geloescht_at) \
             VALUES (1, 900, 'verwahrt', 'Hub Nord', 'E-2026-0001', 2026, 1, \
                     '2026-05-01 00:00:00', '2026-06-01 00:00:00')",
        )
        .execute(&pool)
        .await
        .unwrap();
        let id = spiegel_mit_eigener_akte(&pool, Some(1)).await;
        richte_aus(&pool, id).await;
        assert_eq!(
            stand(&pool, id).await,
            (Some("E-2026-0002".into()), false, 0)
        );
    }

    #[tokio::test]
    async fn eine_freie_nummer_bleibt() {
        let pool = pool().await;
        eigener_einsatz(&pool, 1).await;
        let id = spiegel_mit_eigener_akte(&pool, Some(7)).await;
        richte_aus(&pool, id).await;
        assert_eq!(
            stand(&pool, id).await,
            (Some("E-2026-0007".into()), false, 0)
        );
    }

    /// Altbestand ohne Einsatznummer (Spec `einsatznummer`, „Bestand“) stößt an keine
    /// Eindeutigkeit und bleibt ohne Nummer.
    #[tokio::test]
    async fn ein_spiegel_ohne_nummer_wird_ohne_nummer_eigen() {
        let pool = pool().await;
        eigener_einsatz(&pool, 1).await;
        let id = spiegel_mit_eigener_akte(&pool, None).await;
        richte_aus(&pool, id).await;
        assert_eq!(stand(&pool, id).await, (None, false, 0));
    }
}
