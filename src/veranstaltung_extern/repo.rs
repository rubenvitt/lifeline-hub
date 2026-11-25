//! Tabelle `veranstaltung_extern` (LLH-2097, Migration 0376): je Adapter jede Veranstaltung
//! einmal, mit ihrem letzten Stand. Geschrieben nur in der Übernahme des Laufs, gelöscht nur vom
//! Purge-Lauf (14 Tage nach dem Ende) oder mit dem Adapter.

use std::collections::{HashMap, HashSet};

use sqlx::{SqliteConnection, SqlitePool};

use super::vertrag::{Veranstaltung, VeranstaltungsArt, VeranstaltungsStatus};
use crate::error::AppError;

/// Tage nach dem Ende, nach denen der Purge-Lauf eine Veranstaltung löscht.
pub const AUFBEWAHRUNG_TAGE: i64 = 14;

/// Fenster des Vertrags: die Quelle liefert jede Veranstaltung, deren Ende höchstens so viele
/// Tage zurückliegt. Was älter ist, fällt planmäßig aus der Lieferung und wird nicht `entfernt`.
pub const FENSTER_TAGE: i64 = 7;

/// Eine Zeile von `veranstaltung_extern`.
#[derive(Debug, Clone, PartialEq, Eq, sqlx::FromRow)]
pub struct VeranstaltungExtern {
    pub org_id: i64,
    pub adapter_id: String,
    pub extern_id: String,
    pub name: String,
    pub art: VeranstaltungsArt,
    pub status: VeranstaltungsStatus,
    pub ort: String,
    pub veranstalter: String,
    pub bemerkung: String,
    pub beginn_at: String,
    pub ende_at: String,
    pub fingerabdruck: String,
    pub erhalten_at: String,
    pub geaendert_at: String,
}

/// Was ein Adapter schon abgelegt hat: Fingerabdruck, Status und Ende je Kennung.
async fn load_stand(
    conn: &mut SqliteConnection,
    adapter_id: &str,
) -> Result<HashMap<String, (String, VeranstaltungsStatus, String)>, AppError> {
    let zeilen: Vec<(String, String, VeranstaltungsStatus, String)> = sqlx::query_as(
        "SELECT extern_id, fingerabdruck, status, ende_at FROM veranstaltung_extern \
         WHERE adapter_id = ?",
    )
    .bind(adapter_id)
    .fetch_all(&mut *conn)
    .await?;
    Ok(zeilen
        .into_iter()
        .map(|(id, fp, status, ende)| (id, (fp, status, ende)))
        .collect())
}

/// Übernimmt eine vollständige Lieferung eines Adapters, in der Transaktion des Laufs: gleicher
/// Fingerabdruck schreibt nichts, eine neue Veranstaltung wird angelegt, eine geänderte
/// überschrieben (`geaendert_at` = `jetzt`). Eine Veranstaltung, die fehlt, obwohl ihr Ende noch
/// im Fenster liegt, bekommt den Status `entfernt` und einen leeren Fingerabdruck (kehrt sie
/// zurück, zählt das als Änderung). Liefert die Zahl der angelegten und geänderten Zeilen.
/// Idempotent: ein zweiter Lauf mit derselben Lieferung schreibt nichts.
pub async fn uebernehmen(
    conn: &mut SqliteConnection,
    org_id: i64,
    adapter_id: &str,
    liste: &[Veranstaltung],
    jetzt: &str,
) -> Result<i64, AppError> {
    let stand = load_stand(conn, adapter_id).await?;
    let mut geschrieben = 0i64;
    for v in liste {
        let fp = v.fingerabdruck();
        match stand.get(&v.extern_id) {
            Some((alt, _, _)) if *alt == fp => continue,
            Some(_) => {
                sqlx::query(
                    "UPDATE veranstaltung_extern SET name = ?, art = ?, status = ?, ort = ?, \
                     veranstalter = ?, bemerkung = ?, beginn_at = ?, ende_at = ?, \
                     fingerabdruck = ?, geaendert_at = ? \
                     WHERE adapter_id = ? AND extern_id = ?",
                )
                .bind(&v.name)
                .bind(v.art.as_str())
                .bind(v.status.as_str())
                .bind(&v.ort)
                .bind(&v.veranstalter)
                .bind(&v.bemerkung)
                .bind(&v.beginn_at)
                .bind(&v.ende_at)
                .bind(&fp)
                .bind(jetzt)
                .bind(adapter_id)
                .bind(&v.extern_id)
                .execute(&mut *conn)
                .await?;
            }
            None => {
                sqlx::query(
                    "INSERT INTO veranstaltung_extern (org_id, adapter_id, extern_id, name, art, \
                     status, ort, veranstalter, bemerkung, beginn_at, ende_at, fingerabdruck, \
                     erhalten_at, geaendert_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                )
                .bind(org_id)
                .bind(adapter_id)
                .bind(&v.extern_id)
                .bind(&v.name)
                .bind(v.art.as_str())
                .bind(v.status.as_str())
                .bind(&v.ort)
                .bind(&v.veranstalter)
                .bind(&v.bemerkung)
                .bind(&v.beginn_at)
                .bind(&v.ende_at)
                .bind(&fp)
                .bind(jetzt)
                .bind(jetzt)
                .execute(&mut *conn)
                .await?;
            }
        }
        geschrieben += 1;
    }

    let geliefert: HashSet<&str> = liste.iter().map(|v| v.extern_id.as_str()).collect();
    let fenster_ab = crate::zeit::plus_minuten(jetzt, -FENSTER_TAGE * 24 * 60)
        .ok_or_else(|| AppError::Internal("Zeitpunkt der Übernahme ungültig".into()))?;
    for (id, (_, status, ende)) in &stand {
        if geliefert.contains(id.as_str())
            || *status == VeranstaltungsStatus::Entfernt
            || *ende < fenster_ab
        {
            continue;
        }
        sqlx::query(
            "UPDATE veranstaltung_extern SET status = ?, fingerabdruck = '', geaendert_at = ? \
             WHERE adapter_id = ? AND extern_id = ?",
        )
        .bind(VeranstaltungsStatus::Entfernt.as_str())
        .bind(jetzt)
        .bind(adapter_id)
        .bind(id)
        .execute(&mut *conn)
        .await?;
        geschrieben += 1;
    }
    Ok(geschrieben)
}

/// Die Veranstaltungen eines Adapters, nach Beginn.
pub async fn load_for_adapter(
    conn: &mut SqliteConnection,
    adapter_id: &str,
) -> Result<Vec<VeranstaltungExtern>, AppError> {
    Ok(sqlx::query_as(
        "SELECT org_id, adapter_id, extern_id, name, art, status, ort, veranstalter, bemerkung, \
         beginn_at, ende_at, fingerabdruck, erhalten_at, geaendert_at FROM veranstaltung_extern \
         WHERE adapter_id = ? ORDER BY beginn_at, extern_id",
    )
    .bind(adapter_id)
    .fetch_all(conn)
    .await?)
}

/// Löschlauf (Purge, Phase C): Veranstaltungen, deren Ende mehr als [`AUFBEWAHRUNG_TAGE`] Tage
/// zurückliegt. Liefert die Zahl der gelöschten Zeilen.
pub async fn purge(pool: &SqlitePool, jetzt: &str) -> Result<u64, sqlx::Error> {
    Ok(
        sqlx::query("DELETE FROM veranstaltung_extern WHERE ende_at < datetime(?, ?)")
            .bind(jetzt)
            .bind(format!("-{AUFBEWAHRUNG_TAGE} days"))
            .execute(pool)
            .await?
            .rows_affected(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    const JETZT: &str = "2026-11-25 08:00:00";
    const SPAETER: &str = "2026-11-25 08:05:00";

    async fn pool_mit_adapter() -> SqlitePool {
        let pool = crate::db::test_pool().await;
        sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (1, 'Test-Orga')")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO adapter (id, org_id, art, name, intervall_s) \
             VALUES ('a1', 1, 'veranstaltungen_abruf', 'Veranstaltungen', 300)",
        )
        .execute(&pool)
        .await
        .unwrap();
        pool
    }

    fn v(id: &str, ende: &str) -> Veranstaltung {
        Veranstaltung {
            extern_id: id.into(),
            name: "Stadtfest".into(),
            art: VeranstaltungsArt::Sanitaetsdienst,
            status: VeranstaltungsStatus::Zugesagt,
            ort: "Marktplatz".into(),
            veranstalter: "Stadtmarketing".into(),
            bemerkung: String::new(),
            beginn_at: "2026-11-28 07:00:00".into(),
            ende_at: ende.into(),
        }
    }

    async fn uebernimm(pool: &SqlitePool, liste: &[Veranstaltung], jetzt: &str) -> i64 {
        let mut conn = pool.acquire().await.unwrap();
        uebernehmen(&mut conn, 1, "a1", liste, jetzt).await.unwrap()
    }

    /// Alle Schreibvorgänge dieser Verbindung seit dem Öffnen.
    async fn aenderungen(conn: &mut SqliteConnection) -> i64 {
        sqlx::query_scalar("SELECT total_changes()")
            .fetch_one(conn)
            .await
            .unwrap()
    }

    async fn zeilen(pool: &SqlitePool) -> Vec<VeranstaltungExtern> {
        let mut conn = pool.acquire().await.unwrap();
        load_for_adapter(&mut conn, "a1").await.unwrap()
    }

    #[tokio::test]
    async fn neue_veranstaltung_wird_angelegt() {
        let pool = pool_mit_adapter().await;
        assert_eq!(
            uebernimm(&pool, &[v("x", "2026-11-28 21:00:00")], JETZT).await,
            1
        );
        let z = zeilen(&pool).await;
        assert_eq!(z.len(), 1);
        assert_eq!(z[0].org_id, 1);
        assert_eq!(z[0].status, VeranstaltungsStatus::Zugesagt);
        assert_eq!(z[0].art, VeranstaltungsArt::Sanitaetsdienst);
        assert_eq!(
            (z[0].erhalten_at.as_str(), z[0].geaendert_at.as_str()),
            (JETZT, JETZT)
        );
        assert_eq!(
            z[0].fingerabdruck,
            v("x", "2026-11-28 21:00:00").fingerabdruck()
        );
    }

    #[tokio::test]
    async fn unveraenderte_lieferung_schreibt_nichts() {
        let pool = pool_mit_adapter().await;
        let liste = [v("x", "2026-11-28 21:00:00"), v("y", "2026-11-29 21:00:00")];
        uebernimm(&pool, &liste, JETZT).await;
        let vorher = zeilen(&pool).await;

        let mut conn = pool.acquire().await.unwrap();
        let davor = aenderungen(&mut conn).await;
        let n = uebernehmen(&mut conn, 1, "a1", &liste, SPAETER)
            .await
            .unwrap();
        assert_eq!(n, 0);
        assert_eq!(aenderungen(&mut conn).await, davor, "kein Schreibvorgang");
        drop(conn);
        assert_eq!(zeilen(&pool).await, vorher);
    }

    #[tokio::test]
    async fn geaenderte_veranstaltung_wird_ueberschrieben() {
        let pool = pool_mit_adapter().await;
        uebernimm(&pool, &[v("x", "2026-11-28 21:00:00")], JETZT).await;
        let mut neu = v("x", "2026-11-28 22:00:00");
        neu.status = VeranstaltungsStatus::Abgesagt;
        neu.ort = "Schlossplatz".into();
        assert_eq!(uebernimm(&pool, &[neu.clone()], SPAETER).await, 1);
        let z = zeilen(&pool).await;
        assert_eq!(z.len(), 1);
        assert_eq!(z[0].status, VeranstaltungsStatus::Abgesagt);
        assert_eq!(z[0].ort, "Schlossplatz");
        assert_eq!(z[0].ende_at, "2026-11-28 22:00:00");
        assert_eq!(z[0].erhalten_at, JETZT);
        assert_eq!(z[0].geaendert_at, SPAETER);
        assert_eq!(z[0].fingerabdruck, neu.fingerabdruck());
    }

    #[tokio::test]
    async fn verschwundene_veranstaltung_wird_entfernt_und_kann_zurueckkehren() {
        let pool = pool_mit_adapter().await;
        let x = v("x", "2026-11-28 21:00:00");
        let y = v("y", "2026-11-29 21:00:00");
        uebernimm(&pool, &[x.clone(), y.clone()], JETZT).await;

        assert_eq!(uebernimm(&pool, std::slice::from_ref(&x), SPAETER).await, 1);
        let z = zeilen(&pool).await;
        let y_zeile = z.iter().find(|r| r.extern_id == "y").unwrap();
        assert_eq!(y_zeile.status, VeranstaltungsStatus::Entfernt);
        assert_eq!(y_zeile.geaendert_at, SPAETER);
        assert_eq!(y_zeile.name, "Stadtfest", "der letzte Stand bleibt lesbar");

        // Ein zweiter Abruf ohne sie schreibt nichts mehr.
        assert_eq!(
            uebernimm(&pool, std::slice::from_ref(&x), "2026-11-25 08:10:00").await,
            0
        );
        // Kehrt sie zurück, gilt wieder ihr gelieferter Status.
        assert_eq!(uebernimm(&pool, &[x, y], "2026-11-25 08:15:00").await, 1);
        let z = zeilen(&pool).await;
        let y_zeile = z.iter().find(|r| r.extern_id == "y").unwrap();
        assert_eq!(y_zeile.status, VeranstaltungsStatus::Zugesagt);
    }

    #[tokio::test]
    async fn aus_dem_fenster_gefallene_veranstaltung_bleibt_wie_sie_war() {
        let pool = pool_mit_adapter().await;
        uebernimm(
            &pool,
            &[v("alt", "2026-11-10 21:00:00")],
            "2026-11-10 08:00:00",
        )
        .await;
        // Acht Tage nach dem Ende liefert die Quelle sie planmäßig nicht mehr.
        assert_eq!(uebernimm(&pool, &[], "2026-11-18 22:00:00").await, 0);
        assert_eq!(
            zeilen(&pool).await[0].status,
            VeranstaltungsStatus::Zugesagt
        );
    }

    #[tokio::test]
    async fn adapter_anderer_lieferung_bleibt_unberuehrt() {
        let pool = pool_mit_adapter().await;
        sqlx::query(
            "INSERT INTO adapter (id, org_id, art, name, intervall_s) \
             VALUES ('a2', 1, 'veranstaltungen_abruf', 'Zweite Quelle', 300)",
        )
        .execute(&pool)
        .await
        .unwrap();
        uebernimm(&pool, &[v("x", "2026-11-28 21:00:00")], JETZT).await;
        let mut conn = pool.acquire().await.unwrap();
        // Dieselbe Kennung bei einem anderen Adapter ist eine eigene Zeile, und dessen leere
        // Lieferung entfernt hier nichts.
        uebernehmen(&mut conn, 1, "a2", &[v("x", "2026-11-28 21:00:00")], JETZT)
            .await
            .unwrap();
        uebernehmen(&mut conn, 1, "a2", &[], SPAETER).await.unwrap();
        drop(conn);
        assert_eq!(
            zeilen(&pool).await[0].status,
            VeranstaltungsStatus::Zugesagt
        );
    }

    #[tokio::test]
    async fn purge_loescht_14_tage_nach_dem_ende() {
        let pool = pool_mit_adapter().await;
        uebernimm(
            &pool,
            &[
                v("alt", "2026-11-10 21:00:00"),
                v("jung", "2026-11-11 21:00:01"),
            ],
            "2026-11-01 08:00:00",
        )
        .await;
        assert_eq!(purge(&pool, "2026-11-25 21:00:00").await.unwrap(), 1);
        let z = zeilen(&pool).await;
        assert_eq!(z.len(), 1);
        assert_eq!(z[0].extern_id, "jung");
    }

    #[tokio::test]
    async fn geloeschter_adapter_nimmt_seine_veranstaltungen_mit() {
        let pool = pool_mit_adapter().await;
        uebernimm(&pool, &[v("x", "2026-11-28 21:00:00")], JETZT).await;
        sqlx::query("DELETE FROM adapter WHERE id = 'a1'")
            .execute(&pool)
            .await
            .unwrap();
        assert!(zeilen(&pool).await.is_empty());
    }
}
