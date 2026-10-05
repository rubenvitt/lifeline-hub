//! Speicher des UHS-Plans (`uhs_plan`, LFH-999). Jede Abfrage nennt `einsatz_id` UND `uhs_id`:
//! ein Plan einer UHS eines anderen Einsatzes ist `NotFound`.

use sqlx::{SqliteConnection, SqlitePool};

use super::{
    pruefe_bereich, raste, startlage, GeprueftesBild, UhsPlanAnzeige, BREITE_MAX, BREITE_MIN,
    VERSATZ_MAX,
};
use crate::error::AppError;

const ANZEIGE_SELECT: &str = "\
    SELECT uhs_id, mime, sha256, bild_breite, bild_hoehe, x, y, breite, helligkeit, kontrast, \
           nacht_umkehren, hinterlegt_at, geaendert_at \
    FROM uhs_plan";

/// Der Plan einer UHS, falls einer hinterlegt ist (für `UhsDetail`).
pub async fn laden_optional(
    executor: impl sqlx::Executor<'_, Database = sqlx::Sqlite>,
    einsatz_id: i64,
    uhs_id: i64,
) -> Result<Option<UhsPlanAnzeige>, AppError> {
    Ok(
        sqlx::query_as::<_, UhsPlanAnzeige>(sqlx::AssertSqlSafe(format!(
            "{ANZEIGE_SELECT} WHERE uhs_id = ? AND einsatz_id = ?"
        )))
        .bind(uhs_id)
        .bind(einsatz_id)
        .fetch_optional(executor)
        .await?,
    )
}

/// Wie [`laden_optional`], ohne Plan `NotFound`.
pub async fn laden(
    executor: impl sqlx::Executor<'_, Database = sqlx::Sqlite>,
    einsatz_id: i64,
    uhs_id: i64,
) -> Result<UhsPlanAnzeige, AppError> {
    laden_optional(executor, einsatz_id, uhs_id)
        .await?
        .ok_or(AppError::NotFound)
}

/// `(mime, sha256)` OHNE Bytes, für ETag und den 304-Kurzschluss.
pub async fn bild_meta(
    pool: &SqlitePool,
    einsatz_id: i64,
    uhs_id: i64,
) -> Result<(String, String), AppError> {
    sqlx::query_as::<_, (String, String)>(
        "SELECT mime, sha256 FROM uhs_plan WHERE uhs_id = ? AND einsatz_id = ?",
    )
    .bind(uhs_id)
    .bind(einsatz_id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)
}

/// Die gespeicherten (bereinigten) Bytes.
pub async fn bild_bytes(
    pool: &SqlitePool,
    einsatz_id: i64,
    uhs_id: i64,
) -> Result<Vec<u8>, AppError> {
    sqlx::query_scalar::<_, Vec<u8>>(
        "SELECT daten FROM uhs_plan WHERE uhs_id = ? AND einsatz_id = ?",
    )
    .bind(uhs_id)
    .bind(einsatz_id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)
}

/// Hinterlegt oder ersetzt den Plan in der offenen Transaktion. Ein neuer Plan liegt über allen
/// Plätzen ([`startlage`]); beim Ersetzen bleiben Lage und Darstellung, nur Bild und Maße
/// wechseln. Der Aufrufer hat die UHS im Einsatz und ihren Storno geprüft.
pub async fn hinterlegen_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    uhs_id: i64,
    benutzer_id: i64,
    bild: &GeprueftesBild,
) -> Result<UhsPlanAnzeige, AppError> {
    let plaetze: Vec<(f64, f64)> = sqlx::query_as(
        "SELECT pos_x, pos_y FROM uhs_platz \
         WHERE uhs_id = ? AND storniert_at IS NULL AND pos_x IS NOT NULL AND pos_y IS NOT NULL",
    )
    .bind(uhs_id)
    .fetch_all(&mut *conn)
    .await?;
    let lage = startlage(&plaetze, bild.bild_breite, bild.bild_hoehe);
    sqlx::query(
        "INSERT INTO uhs_plan (uhs_id, einsatz_id, daten, mime, groesse, sha256, bild_breite, \
                               bild_hoehe, x, y, breite, hinterlegt_von) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) \
         ON CONFLICT(uhs_id) DO UPDATE SET \
             daten = excluded.daten, mime = excluded.mime, groesse = excluded.groesse, \
             sha256 = excluded.sha256, bild_breite = excluded.bild_breite, \
             bild_hoehe = excluded.bild_hoehe, hinterlegt_von = excluded.hinterlegt_von, \
             hinterlegt_at = strftime('%Y-%m-%d %H:%M:%S', 'now'), \
             geaendert_at = strftime('%Y-%m-%d %H:%M:%S', 'now')",
    )
    .bind(uhs_id)
    .bind(einsatz_id)
    .bind(&bild.daten)
    .bind(bild.mime)
    .bind(bild.daten.len() as i64)
    .bind(&bild.sha256)
    .bind(i64::from(bild.bild_breite))
    .bind(i64::from(bild.bild_hoehe))
    .bind(lage.x)
    .bind(lage.y)
    .bind(lage.breite)
    .bind(benutzer_id)
    .execute(&mut *conn)
    .await?;
    laden(&mut *conn, einsatz_id, uhs_id).await
}

/// Änderung von Lage und Darstellung; `None` = unverändert.
#[derive(Debug, Default, Clone, Copy)]
pub struct PlanPatch {
    pub x: Option<i64>,
    pub y: Option<i64>,
    pub breite: Option<i64>,
    pub helligkeit: Option<i64>,
    pub kontrast: Option<i64>,
    pub nacht_umkehren: Option<bool>,
}

impl PlanPatch {
    /// Rastet Versatz und Breite ein und prüft alle Werte gegen die Grenzen der Spec (400).
    /// Geprüft wird der eingerastete Wert: 5004 rastet auf 5000 und ist erlaubt.
    pub fn eingerastet(self) -> Result<Self, AppError> {
        let x = self.x.map(raste);
        let y = self.y.map(raste);
        let breite = self.breite.map(raste);
        if let Some(v) = x {
            pruefe_bereich("Versatz links", v, 0, VERSATZ_MAX)?;
        }
        if let Some(v) = y {
            pruefe_bereich("Versatz oben", v, 0, VERSATZ_MAX)?;
        }
        if let Some(v) = breite {
            pruefe_bereich("Breite", v, BREITE_MIN, BREITE_MAX)?;
        }
        if let Some(v) = self.helligkeit {
            pruefe_bereich("Helligkeit", v, 20, 100)?;
        }
        if let Some(v) = self.kontrast {
            pruefe_bereich("Kontrast", v, 50, 150)?;
        }
        Ok(Self {
            x,
            y,
            breite,
            ..self
        })
    }
}

/// Schreibt einen geprüften Patch ([`PlanPatch::eingerastet`]); ohne Plan `NotFound`.
pub async fn aendern_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    uhs_id: i64,
    p: PlanPatch,
) -> Result<UhsPlanAnzeige, AppError> {
    let geaendert = sqlx::query(
        "UPDATE uhs_plan SET \
             x = COALESCE(?, x), y = COALESCE(?, y), breite = COALESCE(?, breite), \
             helligkeit = COALESCE(?, helligkeit), kontrast = COALESCE(?, kontrast), \
             nacht_umkehren = COALESCE(?, nacht_umkehren), \
             geaendert_at = strftime('%Y-%m-%d %H:%M:%S', 'now') \
         WHERE uhs_id = ? AND einsatz_id = ?",
    )
    .bind(p.x)
    .bind(p.y)
    .bind(p.breite)
    .bind(p.helligkeit)
    .bind(p.kontrast)
    .bind(p.nacht_umkehren)
    .bind(uhs_id)
    .bind(einsatz_id)
    .execute(&mut *conn)
    .await?
    .rows_affected();
    if geaendert == 0 {
        return Err(AppError::NotFound);
    }
    laden(&mut *conn, einsatz_id, uhs_id).await
}

/// Entfernt den Plan; ohne Plan `NotFound`.
pub async fn entfernen_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    uhs_id: i64,
) -> Result<(), AppError> {
    let weg = sqlx::query("DELETE FROM uhs_plan WHERE uhs_id = ? AND einsatz_id = ?")
        .bind(uhs_id)
        .bind(einsatz_id)
        .execute(&mut *conn)
        .await?
        .rows_affected();
    if weg == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::super::{pruefe_bild, testbild};
    use super::*;
    use crate::uhs::repo::{self as uhs_repo, NeueDaten};

    struct Stand {
        pool: SqlitePool,
        benutzer: i64,
        einsatz: i64,
    }

    async fn setup() -> Stand {
        let pool = crate::db::test_pool().await;
        sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(&pool)
            .await
            .unwrap();
        let benutzer: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (1, 'Leitung', 'leit', 'h') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let einsatz: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Lage') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        Stand {
            pool,
            benutzer,
            einsatz,
        }
    }

    async fn uhs(st: &Stand, einsatz: i64, bezeichnung: &str) -> i64 {
        uhs_repo::anlegen(
            &st.pool,
            einsatz,
            st.benutzer,
            NeueDaten {
                typ: "behandlungsplatz",
                bezeichnung,
                abschnitt_id: None,
                standort: None,
                notiz: None,
            },
        )
        .await
        .unwrap()
        .id
    }

    async fn hinterlege(st: &Stand, uhs_id: i64, b: u32, h: u32) -> UhsPlanAnzeige {
        let bild = pruefe_bild(&testbild::png(b, h)).unwrap();
        let mut conn = st.pool.acquire().await.unwrap();
        hinterlegen_tx(&mut conn, st.einsatz, uhs_id, st.benutzer, &bild)
            .await
            .unwrap()
    }

    async fn aendere(st: &Stand, uhs_id: i64, p: PlanPatch) -> Result<UhsPlanAnzeige, AppError> {
        let mut conn = st.pool.acquire().await.unwrap();
        aendern_tx(&mut conn, st.einsatz, uhs_id, p.eingerastet()?).await
    }

    #[tokio::test]
    async fn neuer_plan_mit_vorgaben_und_startlage() {
        let st = setup().await;
        let u = uhs(&st, st.einsatz, "BHP 50").await;
        let p = hinterlege(&st, u, 80, 60).await;
        assert_eq!((p.x, p.y, p.breite), (0, 0, 820));
        assert_eq!(
            (p.helligkeit, p.kontrast, p.nacht_umkehren),
            (100, 100, true)
        );
        assert_eq!(
            (p.bild_breite, p.bild_hoehe, p.mime.as_str()),
            (80, 60, "image/png")
        );
    }

    #[tokio::test]
    async fn ersetzen_behaelt_lage_und_darstellung() {
        let st = setup().await;
        let u = uhs(&st, st.einsatz, "BHP 50").await;
        let erst = hinterlege(&st, u, 80, 60).await;
        aendere(
            &st,
            u,
            PlanPatch {
                x: Some(40),
                breite: Some(1200),
                helligkeit: Some(60),
                nacht_umkehren: Some(false),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        let neu = hinterlege(&st, u, 40, 40).await;
        assert_ne!(neu.sha256, erst.sha256);
        assert_eq!((neu.bild_breite, neu.bild_hoehe), (40, 40));
        assert_eq!(
            (neu.x, neu.breite, neu.helligkeit, neu.nacht_umkehren),
            (40, 1200, 60, false)
        );
        let zeilen: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM uhs_plan")
            .fetch_one(&st.pool)
            .await
            .unwrap();
        assert_eq!(zeilen, 1);
    }

    #[tokio::test]
    async fn aendern_rastet_ein_und_prueft_grenzen() {
        let st = setup().await;
        let u = uhs(&st, st.einsatz, "BHP 50").await;
        hinterlege(&st, u, 80, 60).await;
        let p = aendere(
            &st,
            u,
            PlanPatch {
                x: Some(37),
                y: Some(124),
                breite: Some(5004),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        assert_eq!((p.x, p.y, p.breite), (40, 120, 5000));
        for falsch in [
            PlanPatch {
                breite: Some(90),
                ..Default::default()
            },
            PlanPatch {
                breite: Some(5010),
                ..Default::default()
            },
            PlanPatch {
                x: Some(-10),
                ..Default::default()
            },
            PlanPatch {
                y: Some(10_010),
                ..Default::default()
            },
            PlanPatch {
                helligkeit: Some(19),
                ..Default::default()
            },
            PlanPatch {
                helligkeit: Some(101),
                ..Default::default()
            },
            PlanPatch {
                kontrast: Some(49),
                ..Default::default()
            },
            PlanPatch {
                kontrast: Some(151),
                ..Default::default()
            },
        ] {
            assert!(
                matches!(aendere(&st, u, falsch).await, Err(AppError::Validation(_))),
                "{falsch:?}"
            );
        }
    }

    #[tokio::test]
    async fn fremder_einsatz_und_fehlender_plan_sind_not_found() {
        let st = setup().await;
        let anderer: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Andere') RETURNING id",
        )
        .fetch_one(&st.pool)
        .await
        .unwrap();
        let fremd = uhs(&st, anderer, "PA 1").await;
        let u = uhs(&st, st.einsatz, "BHP 50").await;
        assert!(matches!(
            laden(&st.pool, st.einsatz, u).await,
            Err(AppError::NotFound)
        ));
        assert!(matches!(
            aendere(&st, u, PlanPatch::default()).await,
            Err(AppError::NotFound)
        ));
        let mut conn = st.pool.acquire().await.unwrap();
        assert!(matches!(
            entfernen_tx(&mut conn, st.einsatz, u).await,
            Err(AppError::NotFound)
        ));
        drop(conn);
        // Plan an der fremden UHS: über diesen Einsatz nicht erreichbar.
        let bild = pruefe_bild(&testbild::png(8, 8)).unwrap();
        let mut conn = st.pool.acquire().await.unwrap();
        hinterlegen_tx(&mut conn, anderer, fremd, st.benutzer, &bild)
            .await
            .unwrap();
        drop(conn);
        assert!(matches!(
            bild_meta(&st.pool, st.einsatz, fremd).await,
            Err(AppError::NotFound)
        ));
        assert!(matches!(
            bild_bytes(&st.pool, st.einsatz, fremd).await,
            Err(AppError::NotFound)
        ));
    }

    #[tokio::test]
    async fn startlage_ueber_platzierten_plaetzen() {
        let st = setup().await;
        let u = uhs(&st, st.einsatz, "BHP 50").await;
        crate::uhs::platz_repo::anlegen_bulk(&st.pool, u, "behandlungsplatz", "P", 10)
            .await
            .unwrap();
        let p = hinterlege(&st, u, 400, 1600).await;
        assert_eq!((p.x, p.y, p.breite), (0, 0, 810));
    }

    #[tokio::test]
    async fn entfernen_loescht_die_zeile() {
        let st = setup().await;
        let u = uhs(&st, st.einsatz, "BHP 50").await;
        hinterlege(&st, u, 8, 8).await;
        let mut conn = st.pool.acquire().await.unwrap();
        entfernen_tx(&mut conn, st.einsatz, u).await.unwrap();
        drop(conn);
        assert!(laden_optional(&st.pool, st.einsatz, u)
            .await
            .unwrap()
            .is_none());
    }
}
