//! Push-Anmeldung der iOS-Helfer-App (Spec
//! `docs/superpowers/specs/2026-11-25-c19brpvf-helfer-pager-design.md`, ADR-0105): je Helfer-Kopplung
//! höchstens eine, mit der Kopplung gelöscht (`ON DELETE CASCADE`) und von jedem Endweg geräumt
//! ([`delete_registration`], [`delete_ended`]). Kein Verweis auf Benutzer oder Sitzung: die Anmeldung
//! gehört der Kopplung.

use crate::error::AppError;
use crate::ios_push::relais::Umgebung;
use sqlx::{SqliteConnection, SqlitePool};

/// Eine Push-Anmeldung, wie die App sie schickt (`PUT /api/devices/me/push`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HelferPushAnmeldung {
    pub kopplung_id: i64,
    /// Kennung der Anmeldung (AAD der Verschlüsselung, ADR-0090).
    pub kennung: String,
    pub token: String,
    pub umgebung: Umgebung,
    pub schluessel: [u8; 32],
}

fn umgebung_text(u: Umgebung) -> &'static str {
    match u {
        Umgebung::Sandbox => "sandbox",
        Umgebung::Production => "production",
    }
}

/// Legt die Anmeldung der Kopplung an oder ersetzt sie.
pub async fn save_registration(pool: &SqlitePool, a: &HelferPushAnmeldung) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO helfer_push_anmeldung \
           (kopplung_id, kennung, token, umgebung, schluessel, angelegt_at) \
         VALUES (?, ?, ?, ?, ?, ?) \
         ON CONFLICT (kopplung_id) DO UPDATE SET kennung = excluded.kennung, \
           token = excluded.token, umgebung = excluded.umgebung, \
           schluessel = excluded.schluessel, angelegt_at = excluded.angelegt_at",
    )
    .bind(a.kopplung_id)
    .bind(&a.kennung)
    .bind(&a.token)
    .bind(umgebung_text(a.umgebung))
    .bind(a.schluessel.as_slice())
    .bind(crate::zeit::jetzt())
    .execute(pool)
    .await?;
    Ok(())
}

/// Löscht die Anmeldung der Kopplung (Abmelden, Token ungültig, Ende der Kopplung).
pub async fn delete_registration(
    conn: &mut SqliteConnection,
    kopplung_id: i64,
) -> Result<(), AppError> {
    sqlx::query("DELETE FROM helfer_push_anmeldung WHERE kopplung_id = ?")
        .bind(kopplung_id)
        .execute(&mut *conn)
        .await?;
    Ok(())
}

#[derive(sqlx::FromRow)]
struct Zeile {
    kopplung_id: i64,
    kennung: String,
    token: String,
    umgebung: String,
    schluessel: Vec<u8>,
}

/// Die Anmeldungen der Kopplungen `kopplung_ids`; eine Zeile mit kaputtem Schlüssel fällt weg.
pub async fn load_registrations(
    pool: &SqlitePool,
    kopplung_ids: &[i64],
) -> Result<Vec<HelferPushAnmeldung>, AppError> {
    if kopplung_ids.is_empty() {
        return Ok(Vec::new());
    }
    let ids = serde_json::to_string(kopplung_ids).map_err(|e| AppError::Internal(e.to_string()))?;
    let zeilen: Vec<Zeile> = sqlx::query_as(
        "SELECT kopplung_id, kennung, token, umgebung, schluessel FROM helfer_push_anmeldung \
         WHERE kopplung_id IN (SELECT value FROM json_each(?)) ORDER BY kopplung_id",
    )
    .bind(ids)
    .fetch_all(pool)
    .await?;
    Ok(zeilen
        .into_iter()
        .filter_map(|z| {
            Some(HelferPushAnmeldung {
                kopplung_id: z.kopplung_id,
                kennung: z.kennung,
                token: z.token,
                umgebung: match z.umgebung.as_str() {
                    "production" => Umgebung::Production,
                    _ => Umgebung::Sandbox,
                },
                schluessel: z.schluessel.try_into().ok()?,
            })
        })
        .collect())
}

/// Räumt Anmeldungen beendeter Kopplungen: widerrufen, abgelaufen, abgelehnt, oder ihr Einsatz ist
/// nicht mehr aktiv oder gelöscht. Liefert die Zahl der gelöschten Zeilen.
pub async fn delete_ended(conn: &mut SqliteConnection) -> Result<u64, AppError> {
    let r = sqlx::query(
        "DELETE FROM helfer_push_anmeldung WHERE kopplung_id IN ( \
           SELECT gk.id FROM geraet_kopplung gk JOIN einsatz e ON e.id = gk.einsatz_id \
           WHERE gk.widerrufen_at IS NOT NULL OR gk.laeuft_ab_at <= datetime('now') \
              OR gk.helfer_zustand = 'abgelehnt' \
              OR e.status <> 'aktiv' OR e.geloescht_at IS NOT NULL)",
    )
    .execute(&mut *conn)
    .await?;
    Ok(r.rows_affected())
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn einsatz(pool: &SqlitePool) -> i64 {
        sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(pool)
            .await
            .unwrap();
        sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Push') RETURNING id",
        )
        .fetch_one(pool)
        .await
        .unwrap()
    }

    async fn kopplung(pool: &SqlitePool, einsatz: i64, name: &str) -> i64 {
        let benutzer: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash, \
               system_rolle, org_rolle) VALUES (1, ?, ?, '', 'keiner', 'keine') RETURNING id",
        )
        .bind(name)
        .bind(format!("geraet-{name}"))
        .fetch_one(pool)
        .await
        .unwrap();
        sqlx::query_scalar(
            "INSERT INTO geraet_kopplung (einsatz_id, benutzer_id, ansicht, bezeichnung, \
               erstellt_von, laeuft_ab_at, helfer_zustand) \
             VALUES (?, ?, 'helfer', ?, ?, datetime('now', '+1 hour'), 'aktiv') RETURNING id",
        )
        .bind(einsatz)
        .bind(benutzer)
        .bind(name)
        .bind(benutzer)
        .fetch_one(pool)
        .await
        .unwrap()
    }

    fn anmeldung(kopplung_id: i64, token: &str) -> HelferPushAnmeldung {
        HelferPushAnmeldung {
            kopplung_id,
            kennung: format!("k-{token}"),
            token: token.into(),
            umgebung: Umgebung::Sandbox,
            schluessel: [7; 32],
        }
    }

    #[tokio::test]
    async fn speichern_ersetzt_die_anmeldung_der_kopplung() {
        let pool = crate::db::test_pool().await;
        let e = einsatz(&pool).await;
        let k = kopplung(&pool, e, "a").await;
        save_registration(&pool, &anmeldung(k, "aa")).await.unwrap();
        save_registration(&pool, &anmeldung(k, "bb")).await.unwrap();
        let a = load_registrations(&pool, &[k]).await.unwrap();
        assert_eq!(a, vec![anmeldung(k, "bb")]);
    }

    #[tokio::test]
    async fn delete_ended_raeumt_widerrufene_abgelaufene_und_beendete_einsaetze() {
        let pool = crate::db::test_pool().await;
        let e = einsatz(&pool).await;
        let aktiv = kopplung(&pool, e, "aktiv").await;
        let widerrufen = kopplung(&pool, e, "widerrufen").await;
        let abgelaufen = kopplung(&pool, e, "abgelaufen").await;
        let abgelehnt = kopplung(&pool, e, "abgelehnt").await;
        let e2 = einsatz(&pool).await;
        let beendet = kopplung(&pool, e2, "beendet").await;
        for (k, t) in [
            (aktiv, "a1"),
            (widerrufen, "a2"),
            (abgelaufen, "a3"),
            (abgelehnt, "a4"),
            (beendet, "a5"),
        ] {
            save_registration(&pool, &anmeldung(k, t)).await.unwrap();
        }
        let setze = |sql: &'static str, id: i64| {
            let pool = pool.clone();
            async move {
                sqlx::query(sql).bind(id).execute(&pool).await.unwrap();
            }
        };
        setze(
            "UPDATE geraet_kopplung SET widerrufen_at = datetime('now') WHERE id = ?",
            widerrufen,
        )
        .await;
        setze(
            "UPDATE geraet_kopplung SET laeuft_ab_at = datetime('now', '-1 minute') WHERE id = ?",
            abgelaufen,
        )
        .await;
        setze(
            "UPDATE geraet_kopplung SET helfer_zustand = 'abgelehnt' WHERE id = ?",
            abgelehnt,
        )
        .await;
        setze(
            "UPDATE einsatz SET status = 'abgeschlossen' WHERE id = ?",
            e2,
        )
        .await;
        let mut conn = pool.acquire().await.unwrap();
        assert_eq!(delete_ended(&mut conn).await.unwrap(), 4);
        drop(conn);
        let rest = load_registrations(&pool, &[aktiv, widerrufen, abgelaufen, abgelehnt, beendet])
            .await
            .unwrap();
        assert_eq!(rest, vec![anmeldung(aktiv, "a1")]);
    }

    #[tokio::test]
    async fn anmeldung_faellt_mit_der_kopplung() {
        let pool = crate::db::test_pool().await;
        let e = einsatz(&pool).await;
        let k = kopplung(&pool, e, "weg").await;
        save_registration(&pool, &anmeldung(k, "cc")).await.unwrap();
        sqlx::query("DELETE FROM geraet_kopplung WHERE id = ?")
            .bind(k)
            .execute(&pool)
            .await
            .unwrap();
        assert!(load_registrations(&pool, &[k]).await.unwrap().is_empty());
    }
}
