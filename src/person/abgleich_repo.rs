use crate::error::AppError;
use crate::person::{AbgleichStatus, PersonStatus};
use serde::Serialize;
use sqlx::SqlitePool;
use utoipa::ToSchema;

/// Ein Vermisstenabgleich (1:1 zu `person_abgleich`).
#[derive(Debug, Clone, Serialize, sqlx::FromRow, ToSchema)]
pub struct AbgleichAnzeige {
    pub id: i64,
    pub einsatz_id: i64,
    pub vermisst_person_id: i64,
    pub gefunden_person_id: i64,
    #[sqlx(try_from = "String")]
    pub status: AbgleichStatus,
    pub erstellt_at: String,
    pub erstellt_von: i64,
    pub entschieden_at: Option<String>,
    pub entschieden_von: Option<i64>,
}

const SELECT_ABGLEICH: &str = "\
    SELECT id, einsatz_id, vermisst_person_id, gefunden_person_id, status, \
           erstellt_at, erstellt_von, entschieden_at, entschieden_von \
    FROM person_abgleich";

/// Legt einen Verdachts-Link an (Status `verdacht`). Die fachliche Validierung (Status der
/// Personen, gleicher Einsatz, nicht dieselbe Person) macht der Handler.
pub async fn anlegen_verdacht(
    pool: &SqlitePool,
    einsatz_id: i64,
    vermisst_person_id: i64,
    gefunden_person_id: i64,
    erstellt_von: i64,
) -> Result<AbgleichAnzeige, AppError> {
    let id: i64 = sqlx::query_scalar(
        "INSERT INTO person_abgleich \
            (einsatz_id, vermisst_person_id, gefunden_person_id, erstellt_von) \
         VALUES (?, ?, ?, ?) RETURNING id",
    )
    .bind(einsatz_id)
    .bind(vermisst_person_id)
    .bind(gefunden_person_id)
    .bind(erstellt_von)
    .fetch_one(pool)
    .await?;
    laden(pool, einsatz_id, id).await
}

/// Lädt einen Abgleich; `NotFound`, falls nicht zum Einsatz.
pub async fn laden(
    pool: &SqlitePool,
    einsatz_id: i64,
    id: i64,
) -> Result<AbgleichAnzeige, AppError> {
    sqlx::query_as::<_, AbgleichAnzeige>(sqlx::AssertSqlSafe(format!(
        "{SELECT_ABGLEICH} WHERE id = ? AND einsatz_id = ?"
    )))
    .bind(id)
    .bind(einsatz_id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)
}

/// Entscheidet einen Abgleich (`bestaetigt`/`verworfen`). Bei `bestaetigt` wird in
/// DERSELBEN Transaktion die Vermisstmeldung `→ abgemeldet` gesetzt; der partielle
/// Unique-Index erzwingt höchstens einen bestätigten Abgleich je Vermisstmeldung
/// (Verletzung → `Conflict`). Nur aus `verdacht` heraus: ein schon entschiedener Abgleich
/// endet mit `Conflict`, geprüft im UPDATE selbst (LLH-1686). Vor dem Bestätigen werden beide
/// Personen erneut geprüft wie beim Anlegen (LLH-1883, `pruefe_person`); Verwerfen geht immer.
pub async fn entscheide(
    pool: &SqlitePool,
    einsatz_id: i64,
    id: i64,
    entscheidung: &str,
    entschieden_von: i64,
) -> Result<AbgleichAnzeige, AppError> {
    let abgleich = laden(pool, einsatz_id, id).await?;
    // Die Bedingung `status = 'verdacht'` steht im UPDATE selbst (LLH-1686): Die Vorprüfung der
    // Route sieht im Wettlauf noch den alten Stand, und zwei gleichzeitige Entscheidungen
    // überschrieben einander sonst (bestätigt und abgemeldet, aber Abgleich `verworfen`). Die
    // zweite trifft keine Zeile mehr und endet mit 409, ohne die Vermisstmeldung anzufassen.
    crate::write_retry!(pool, |conn| {
        let ergebnis = sqlx::query(
            "UPDATE person_abgleich SET status = ?, \
                entschieden_at = strftime('%Y-%m-%d %H:%M:%S','now'), entschieden_von = ? \
             WHERE id = ? AND einsatz_id = ? AND status = 'verdacht'",
        )
        .bind(entscheidung)
        .bind(entschieden_von)
        .bind(id)
        .bind(einsatz_id)
        .execute(&mut *conn)
        .await;
        let rows_affected = match ergebnis {
            Ok(r) => r.rows_affected(),
            Err(e) => {
                // Partieller Unique-Index: bereits ein bestätigter Abgleich je Vermisstmeldung.
                if let sqlx::Error::Database(db) = &e {
                    if db.is_unique_violation() {
                        return Err(AppError::Conflict(
                            "Für diese Vermisstmeldung ist bereits ein Abgleich bestätigt".into(),
                        ));
                    }
                }
                return Err(e.into());
            }
        };
        if rows_affected == 0 {
            return Err(AppError::Conflict(
                "Abgleich ist bereits entschieden".into(),
            ));
        }
        if entscheidung == "bestaetigt" {
            // LLH-1883: Seit dem Verdacht kann eine der Personen storniert oder umgestellt worden
            // sein. Bestätigt wird nur, was `abgleich_anlegen` auch anlegen ließe; sonst Fehler und
            // Rollback, der Abgleich bleibt `verdacht` und lässt sich verwerfen.
            pruefe_person(
                conn,
                einsatz_id,
                abgleich.vermisst_person_id,
                &[PersonStatus::Vermisst],
                "Vermisstmeldung ist storniert",
                "Person ist nicht mehr vermisst",
            )
            .await?;
            pruefe_person(
                conn,
                einsatz_id,
                abgleich.gefunden_person_id,
                &[PersonStatus::Betroffen, PersonStatus::Verstorben],
                "Gefundene Person ist storniert",
                "Gefundene Person muss Status betroffen/verstorben haben",
            )
            .await?;
            let abgemeldet = sqlx::query(
                "UPDATE einsatz_person SET status = 'abgemeldet', \
                    geaendert_at = strftime('%Y-%m-%d %H:%M:%S','now'), geaendert_von = ? \
                 WHERE id = ? AND einsatz_id = ? AND status = 'vermisst' \
                   AND storniert_at IS NULL",
            )
            .bind(entschieden_von)
            .bind(abgleich.vermisst_person_id)
            .bind(einsatz_id)
            .execute(&mut *conn)
            .await?
            .rows_affected();
            if abgemeldet == 0 {
                return Err(AppError::Conflict(
                    "Vermisstmeldung wurde zwischenzeitlich geändert".into(),
                ));
            }
        }
        Ok(())
    })?;
    laden(pool, einsatz_id, id).await
}

/// Prüft eine am Abgleich beteiligte Person in der laufenden Transaktion (LLH-1883): storniert →
/// 409 (Lebenszyklus), Status nicht in `erlaubt` → 422 (Zustand), nach `src/AGENTS.md`,
/// Statuscode-Konvention.
async fn pruefe_person(
    conn: &mut sqlx::SqliteConnection,
    einsatz_id: i64,
    person_id: i64,
    erlaubt: &[PersonStatus],
    storniert: &str,
    falscher_status: &str,
) -> Result<(), AppError> {
    let (status, storniert_at): (String, Option<String>) = sqlx::query_as(
        "SELECT status, storniert_at FROM einsatz_person WHERE id = ? AND einsatz_id = ?",
    )
    .bind(person_id)
    .bind(einsatz_id)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or(AppError::NotFound)?;
    if storniert_at.is_some() {
        return Err(AppError::Conflict(storniert.into()));
    }
    if !PersonStatus::parse(&status).is_some_and(|s| erlaubt.contains(&s)) {
        return Err(AppError::UnprocessableEntity(falscher_status.into()));
    }
    Ok(())
}

/// Abgleiche, an denen die Person beteiligt ist (als vermisst ODER gefunden),
/// neueste zuerst.
pub async fn liste_je_person(
    pool: &SqlitePool,
    einsatz_id: i64,
    person_id: i64,
) -> Result<Vec<AbgleichAnzeige>, AppError> {
    Ok(
        sqlx::query_as::<_, AbgleichAnzeige>(sqlx::AssertSqlSafe(format!(
            "{SELECT_ABGLEICH} WHERE einsatz_id = ? \
         AND (vermisst_person_id = ? OR gefunden_person_id = ?) \
         ORDER BY erstellt_at DESC, id DESC"
        )))
        .bind(einsatz_id)
        .bind(person_id)
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

    /// Liefert (benutzer, einsatz, vermisst_id, gefunden_a, gefunden_b).
    async fn setup(pool: &SqlitePool) -> (i64, i64, i64, i64, i64) {
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
        let mk = |nr: i64, status: &'static str| {
            let e = e;
            let b = b;
            let pool = pool.clone();
            async move {
                sqlx::query_scalar::<_, i64>(
                    "INSERT INTO einsatz_person (einsatz_id, registrier_nr, status, erfasst_von, geaendert_von) \
                     VALUES (?, ?, ?, ?, ?) RETURNING id")
                    .bind(e).bind(nr).bind(status).bind(b).bind(b)
                    .fetch_one(&pool).await.unwrap()
            }
        };
        let vermisst = mk(1, "vermisst").await;
        let gef_a = mk(2, "betroffen").await;
        let gef_b = mk(3, "betroffen").await;
        (b, e, vermisst, gef_a, gef_b)
    }

    async fn status(pool: &SqlitePool, person_id: i64) -> String {
        sqlx::query_scalar("SELECT status FROM einsatz_person WHERE id = ?")
            .bind(person_id)
            .fetch_one(pool)
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn verdacht_anlegen_und_liste_je_person() {
        let pool = test_pool().await;
        let (b, e, v, g, _) = setup(&pool).await;
        let a = anlegen_verdacht(&pool, e, v, g, b).await.unwrap();
        assert_eq!(a.status, AbgleichStatus::Verdacht);
        // Taucht sowohl beim Vermissten als auch bei der gefundenen Person auf:
        assert_eq!(liste_je_person(&pool, e, v).await.unwrap().len(), 1);
        assert_eq!(liste_je_person(&pool, e, g).await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn bestaetigen_meldet_vermissten_ab() {
        let pool = test_pool().await;
        let (b, e, v, g, _) = setup(&pool).await;
        let a = anlegen_verdacht(&pool, e, v, g, b).await.unwrap();
        let entschieden = entscheide(&pool, e, a.id, "bestaetigt", b).await.unwrap();
        assert_eq!(entschieden.status, AbgleichStatus::Bestaetigt);
        assert!(entschieden.entschieden_at.is_some());
        assert_eq!(
            status(&pool, v).await,
            "abgemeldet",
            "Vermisstmeldung aufgeklärt → abgemeldet"
        );
    }

    #[tokio::test]
    async fn zweiter_bestaetigter_je_vermisstmeldung_ist_konflikt() {
        let pool = test_pool().await;
        let (b, e, v, g_a, g_b) = setup(&pool).await;
        let a1 = anlegen_verdacht(&pool, e, v, g_a, b).await.unwrap();
        let a2 = anlegen_verdacht(&pool, e, v, g_b, b).await.unwrap();
        entscheide(&pool, e, a1.id, "bestaetigt", b).await.unwrap();
        let err = entscheide(&pool, e, a2.id, "bestaetigt", b)
            .await
            .unwrap_err();
        assert!(
            matches!(err, AppError::Conflict(_)),
            "Unique-Index: nur ein bestätigter Abgleich je Vermisstmeldung"
        );
    }

    /// LLH-1686: Ein schon entschiedener Abgleich wird nicht überschrieben, auch wenn die
    /// Vorprüfung der Route (Status `verdacht`) im Wettlauf noch den alten Stand sah. Verwerfen
    /// nach Bestätigen: 409, der Abgleich bleibt bestätigt.
    #[tokio::test]
    async fn verwerfen_nach_bestaetigen_ist_konflikt_und_ueberschreibt_nicht() {
        let pool = test_pool().await;
        let (b, e, v, g, _) = setup(&pool).await;
        let a = anlegen_verdacht(&pool, e, v, g, b).await.unwrap();
        entscheide(&pool, e, a.id, "bestaetigt", b).await.unwrap();

        let err = entscheide(&pool, e, a.id, "verworfen", b)
            .await
            .unwrap_err();
        assert!(matches!(err, AppError::Conflict(_)), "{err:?}");
        assert_eq!(
            laden(&pool, e, a.id).await.unwrap().status,
            AbgleichStatus::Bestaetigt
        );
        assert_eq!(status(&pool, v).await, "abgemeldet");
    }

    /// Umgekehrt: Bestätigen nach Verwerfen ist 409 und meldet die vermisste Person nicht ab.
    #[tokio::test]
    async fn bestaetigen_nach_verwerfen_ist_konflikt_und_meldet_nicht_ab() {
        let pool = test_pool().await;
        let (b, e, v, g, _) = setup(&pool).await;
        let a = anlegen_verdacht(&pool, e, v, g, b).await.unwrap();
        entscheide(&pool, e, a.id, "verworfen", b).await.unwrap();

        let err = entscheide(&pool, e, a.id, "bestaetigt", b)
            .await
            .unwrap_err();
        assert!(matches!(err, AppError::Conflict(_)), "{err:?}");
        assert_eq!(
            laden(&pool, e, a.id).await.unwrap().status,
            AbgleichStatus::Verworfen
        );
        assert_eq!(status(&pool, v).await, "vermisst");
    }

    async fn setze(pool: &SqlitePool, person_id: i64, status: &str) {
        sqlx::query("UPDATE einsatz_person SET status = ? WHERE id = ?")
            .bind(status)
            .bind(person_id)
            .execute(pool)
            .await
            .unwrap();
    }

    async fn storniere(pool: &SqlitePool, person_id: i64, von: i64) {
        sqlx::query(
            "UPDATE einsatz_person SET storniert_at = '2026-05-27 10:00:00', storniert_von = ? \
             WHERE id = ?",
        )
        .bind(von)
        .bind(person_id)
        .execute(pool)
        .await
        .unwrap();
    }

    /// Prüft den Fehler und dass nichts geschrieben wurde: der Abgleich bleibt `verdacht`, die
    /// vermisste Person behält `erwartet`.
    async fn abgelehnt_ohne_schreiben(
        pool: &SqlitePool,
        e: i64,
        aid: i64,
        v: i64,
        err: AppError,
        erwartet: &str,
    ) -> AppError {
        assert_eq!(
            laden(pool, e, aid).await.unwrap().status,
            AbgleichStatus::Verdacht,
            "Rollback: der Abgleich bleibt offen ({err:?})"
        );
        assert_eq!(status(pool, v).await, erwartet, "nicht abgemeldet");
        err
    }

    /// LLH-1883: Eine seit dem Verdacht stornierte Vermisstmeldung wird nicht mehr bestätigt (409,
    /// Lebenszyklus) und nicht abgemeldet.
    #[tokio::test]
    async fn bestaetigen_nach_storno_der_vermisstmeldung_ist_409_ohne_schreiben() {
        let pool = test_pool().await;
        let (b, e, v, g, _) = setup(&pool).await;
        let a = anlegen_verdacht(&pool, e, v, g, b).await.unwrap();
        storniere(&pool, v, b).await;

        let err = entscheide(&pool, e, a.id, "bestaetigt", b)
            .await
            .unwrap_err();
        let err = abgelehnt_ohne_schreiben(&pool, e, a.id, v, err, "vermisst").await;
        assert!(matches!(err, AppError::Conflict(_)), "{err:?}");
    }

    /// LLH-1883: Steht die Vermisstmeldung inzwischen auf `betroffen` oder `verstorben`, ist das
    /// Bestätigen 422 (Zustand) und ändert ihren Status nicht.
    #[tokio::test]
    async fn bestaetigen_nach_statuswechsel_der_vermisstmeldung_ist_422_ohne_schreiben() {
        for neu in ["betroffen", "verstorben", "abgemeldet", "erfasst"] {
            let pool = test_pool().await;
            let (b, e, v, g, _) = setup(&pool).await;
            let a = anlegen_verdacht(&pool, e, v, g, b).await.unwrap();
            setze(&pool, v, neu).await;

            let err = entscheide(&pool, e, a.id, "bestaetigt", b)
                .await
                .unwrap_err();
            let err = abgelehnt_ohne_schreiben(&pool, e, a.id, v, err, neu).await;
            assert!(
                matches!(err, AppError::UnprocessableEntity(_)),
                "{neu}: {err:?}"
            );
        }
    }

    /// LLH-1883: Auch die gefundene Person wird beim Bestätigen erneut geprüft: storniert → 409.
    #[tokio::test]
    async fn bestaetigen_nach_storno_der_gefundenen_person_ist_409_ohne_schreiben() {
        let pool = test_pool().await;
        let (b, e, v, g, _) = setup(&pool).await;
        let a = anlegen_verdacht(&pool, e, v, g, b).await.unwrap();
        storniere(&pool, g, b).await;

        let err = entscheide(&pool, e, a.id, "bestaetigt", b)
            .await
            .unwrap_err();
        let err = abgelehnt_ohne_schreiben(&pool, e, a.id, v, err, "vermisst").await;
        assert!(matches!(err, AppError::Conflict(_)), "{err:?}");
    }

    /// LLH-1883: Gefundene Person nicht mehr `betroffen`/`verstorben` → 422; `verstorben` bleibt
    /// eine gültige Fundlage.
    #[tokio::test]
    async fn bestaetigen_prueft_status_der_gefundenen_person() {
        for neu in ["vermisst", "abgemeldet", "erfasst"] {
            let pool = test_pool().await;
            let (b, e, v, g, _) = setup(&pool).await;
            let a = anlegen_verdacht(&pool, e, v, g, b).await.unwrap();
            setze(&pool, g, neu).await;

            let err = entscheide(&pool, e, a.id, "bestaetigt", b)
                .await
                .unwrap_err();
            let err = abgelehnt_ohne_schreiben(&pool, e, a.id, v, err, "vermisst").await;
            assert!(
                matches!(err, AppError::UnprocessableEntity(_)),
                "{neu}: {err:?}"
            );
        }

        let pool = test_pool().await;
        let (b, e, v, g, _) = setup(&pool).await;
        let a = anlegen_verdacht(&pool, e, v, g, b).await.unwrap();
        setze(&pool, g, "verstorben").await;
        entscheide(&pool, e, a.id, "bestaetigt", b).await.unwrap();
        assert_eq!(status(&pool, v).await, "abgemeldet");
    }

    /// LLH-1883: Verwerfen bleibt möglich, wenn die Lage nicht mehr passt — so räumt die
    /// Einsatzleitung einen veralteten Verdacht ab. Der Status der Person bleibt.
    #[tokio::test]
    async fn verwerfen_geht_auch_nach_storno_oder_statuswechsel() {
        let pool = test_pool().await;
        let (b, e, v, g, g2) = setup(&pool).await;
        let a1 = anlegen_verdacht(&pool, e, v, g, b).await.unwrap();
        let a2 = anlegen_verdacht(&pool, e, v, g2, b).await.unwrap();
        setze(&pool, v, "betroffen").await;
        entscheide(&pool, e, a1.id, "verworfen", b).await.unwrap();
        assert_eq!(status(&pool, v).await, "betroffen");
        storniere(&pool, v, b).await;
        let a2 = entscheide(&pool, e, a2.id, "verworfen", b).await.unwrap();
        assert_eq!(a2.status, AbgleichStatus::Verworfen);
    }

    /// LLH-1883: Wird die Person zurück auf `vermisst` korrigiert, gilt der offene Verdacht wieder.
    #[tokio::test]
    async fn nach_korrektur_zurueck_auf_vermisst_geht_bestaetigen_wieder() {
        let pool = test_pool().await;
        let (b, e, v, g, _) = setup(&pool).await;
        let a = anlegen_verdacht(&pool, e, v, g, b).await.unwrap();
        setze(&pool, v, "betroffen").await;
        entscheide(&pool, e, a.id, "bestaetigt", b)
            .await
            .unwrap_err();
        setze(&pool, v, "vermisst").await;
        entscheide(&pool, e, a.id, "bestaetigt", b).await.unwrap();
        assert_eq!(status(&pool, v).await, "abgemeldet");
    }

    #[tokio::test]
    async fn verwerfen_laesst_status_unveraendert() {
        let pool = test_pool().await;
        let (b, e, v, g, _) = setup(&pool).await;
        let a = anlegen_verdacht(&pool, e, v, g, b).await.unwrap();
        entscheide(&pool, e, a.id, "verworfen", b).await.unwrap();
        assert_eq!(
            status(&pool, v).await,
            "vermisst",
            "verworfen ändert den Status nicht"
        );
    }

    #[tokio::test]
    async fn liste_je_person_filtert_korrekt_auch_bei_id_kollision() {
        let pool = test_pool().await;
        let (b, e, v, g, _) = setup(&pool).await;
        anlegen_verdacht(&pool, e, v, g, b).await.unwrap();
        // Eine vierte Person, die NICHT am Abgleich beteiligt ist.
        let unbeteiligt: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_person (einsatz_id, registrier_nr, status, erfasst_von, geaendert_von) \
             VALUES (?, 99, 'erfasst', ?, ?) RETURNING id")
            .bind(e).bind(b).bind(b).fetch_one(&pool).await.unwrap();
        // Unbeteiligte Person hat KEINEN Abgleich — Query muss leere Liste liefern.
        assert_eq!(
            liste_je_person(&pool, e, unbeteiligt).await.unwrap().len(),
            0,
            "person_id-Filter muss greifen (unbeteiligte Person hat keinen Abgleich)"
        );
    }
}
