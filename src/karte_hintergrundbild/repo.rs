use super::HintergrundbildAnzeige;
use crate::error::AppError;
use sha2::{Digest, Sha256};
use sqlx::SqlitePool;

const ANZEIGE_SELECT: &str = "\
    SELECT id, einsatz_id, name, mime, groesse, ecken_json, opazitaet, \
           sichtbar, reihenfolge, hochgeladen_von, erstellt_at, geaendert_at \
    FROM karte_hintergrundbild";

fn hex(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push_str(&format!("{b:02x}"));
    }
    s
}

pub async fn liste(pool: &SqlitePool, einsatz_id: i64) -> Result<Vec<HintergrundbildAnzeige>, AppError> {
    Ok(sqlx::query_as::<_, HintergrundbildAnzeige>(
        &format!("{ANZEIGE_SELECT} WHERE einsatz_id = ? ORDER BY reihenfolge, id"),
    )
    .bind(einsatz_id)
    .fetch_all(pool)
    .await?)
}

pub async fn laden(pool: &SqlitePool, einsatz_id: i64, id: i64) -> Result<HintergrundbildAnzeige, AppError> {
    sqlx::query_as::<_, HintergrundbildAnzeige>(
        &format!("{ANZEIGE_SELECT} WHERE id = ? AND einsatz_id = ?"),
    )
    .bind(id)
    .bind(einsatz_id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)
}

pub async fn laden_bytes(pool: &SqlitePool, einsatz_id: i64, id: i64) -> Result<(String, Vec<u8>), AppError> {
    sqlx::query_as::<_, (String, Vec<u8>)>(
        "SELECT mime, daten FROM karte_hintergrundbild WHERE id = ? AND einsatz_id = ?",
    )
    .bind(id)
    .bind(einsatz_id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)
}

#[allow(clippy::too_many_arguments)]
pub async fn anlegen(
    pool: &SqlitePool,
    einsatz_id: i64,
    hochgeladen_von: i64,
    name: &str,
    mime: &str,
    daten: &[u8],
    ecken_json: &str,
) -> Result<HintergrundbildAnzeige, AppError> {
    let groesse = daten.len() as i64;
    let sha = hex(&Sha256::digest(daten));
    // Neue Bilder oben auf den Stapel: max(reihenfolge)+1.
    let id: i64 = sqlx::query_scalar(
        "INSERT INTO karte_hintergrundbild \
            (einsatz_id, name, daten, mime, groesse, sha256, ecken_json, reihenfolge, hochgeladen_von) \
         VALUES (?, ?, ?, ?, ?, ?, ?, \
            (SELECT COALESCE(MAX(reihenfolge), -1) + 1 FROM karte_hintergrundbild WHERE einsatz_id = ?), \
            ?) RETURNING id",
    )
    .bind(einsatz_id).bind(name).bind(daten).bind(mime).bind(groesse).bind(sha)
    .bind(ecken_json).bind(einsatz_id).bind(hochgeladen_von)
    .fetch_one(pool)
    .await?;
    laden(pool, einsatz_id, id).await
}

#[derive(Debug, Default)]
pub struct BildPatch {
    pub name: Option<String>,
    pub ecken_json: Option<String>,
    pub opazitaet: Option<i64>,
    pub sichtbar: Option<bool>,
    pub reihenfolge: Option<i64>,
}

pub async fn aktualisiere(
    pool: &SqlitePool,
    einsatz_id: i64,
    id: i64,
    daten: BildPatch,
) -> Result<HintergrundbildAnzeige, AppError> {
    // Nur gesendete Felder ändern (CASE-WHEN-Muster wie lage_zone); geaendert_at stets neu.
    let betroffen = sqlx::query(
        "UPDATE karte_hintergrundbild SET \
            name        = CASE WHEN ? THEN ? ELSE name END, \
            ecken_json  = CASE WHEN ? THEN ? ELSE ecken_json END, \
            opazitaet   = CASE WHEN ? THEN ? ELSE opazitaet END, \
            sichtbar    = CASE WHEN ? THEN ? ELSE sichtbar END, \
            reihenfolge = CASE WHEN ? THEN ? ELSE reihenfolge END, \
            geaendert_at = datetime('now') \
         WHERE id = ? AND einsatz_id = ?",
    )
    .bind(daten.name.is_some()).bind(daten.name)
    .bind(daten.ecken_json.is_some()).bind(daten.ecken_json)
    .bind(daten.opazitaet.is_some()).bind(daten.opazitaet)
    .bind(daten.sichtbar.is_some()).bind(daten.sichtbar)
    .bind(daten.reihenfolge.is_some()).bind(daten.reihenfolge)
    .bind(id).bind(einsatz_id)
    .execute(pool)
    .await?
    .rows_affected();
    if betroffen == 0 {
        return Err(AppError::NotFound);
    }
    laden(pool, einsatz_id, id).await
}

pub async fn loeschen(pool: &SqlitePool, einsatz_id: i64, id: i64) -> Result<(), AppError> {
    let betroffen = sqlx::query("DELETE FROM karte_hintergrundbild WHERE id = ? AND einsatz_id = ?")
        .bind(id).bind(einsatz_id)
        .execute(pool)
        .await?
        .rows_affected();
    if betroffen == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Org idempotent anlegen, eindeutigen Benutzer + frischen Einsatz anlegen.
    /// Gibt (einsatz_id, benutzer_id) zurück — passend zur Brief-Destrukturierung `(eid, uid)`.
    async fn setup(pool: &SqlitePool) -> (i64, i64) {
        sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(pool)
            .await
            .unwrap();
        let benutzer: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (1, 'Tester', 'tester' || (SELECT COUNT(*) FROM benutzer), 'h') RETURNING id",
        )
        .fetch_one(pool)
        .await
        .unwrap();
        let einsatz: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Lage') RETURNING id",
        )
        .fetch_one(pool)
        .await
        .unwrap();
        (einsatz, benutzer)
    }

    fn ecken() -> &'static str {
        "[[9.0,50.0],[9.1,50.0],[9.1,49.9],[9.0,49.9]]"
    }

    #[tokio::test]
    async fn anlegen_und_laden_roundtrip() {
        let pool = crate::db::test_pool().await;
        let (eid, uid) = setup(&pool).await;
        let bytes = [0x89u8, b'P', b'N', b'G', 1, 2, 3];
        let a = anlegen(&pool, eid, uid, "plan.png", "image/png", &bytes, ecken())
            .await
            .unwrap();
        assert_eq!(a.name, "plan.png");
        assert_eq!(a.groesse, bytes.len() as i64);
        assert_eq!(a.opazitaet, 100);
        assert!(a.sichtbar);

        let (mime, daten) = laden_bytes(&pool, eid, a.id).await.unwrap();
        assert_eq!(mime, "image/png");
        assert_eq!(daten, bytes);

        let liste = liste(&pool, eid).await.unwrap();
        assert_eq!(liste.len(), 1);
    }

    #[tokio::test]
    async fn patch_opazitaet_und_ecken() {
        let pool = crate::db::test_pool().await;
        let (eid, uid) = setup(&pool).await;
        let a = anlegen(&pool, eid, uid, "p.png", "image/png", &[0x89, b'P'], ecken())
            .await
            .unwrap();
        let neu = "[[8.0,51.0],[8.2,51.0],[8.2,50.8],[8.0,50.8]]";
        let p = aktualisiere(
            &pool,
            eid,
            a.id,
            BildPatch {
                opazitaet: Some(60),
                ecken_json: Some(neu.into()),
                sichtbar: Some(false),
                name: None,
                reihenfolge: None,
            },
        )
        .await
        .unwrap();
        assert_eq!(p.opazitaet, 60);
        assert!(!p.sichtbar);
        assert_eq!(p.ecken_json, neu);
        // Nicht gepatchte Felder (name/reihenfolge waren None) bleiben unverändert.
        assert_eq!(p.name, a.name);
        assert_eq!(p.reihenfolge, a.reihenfolge);
    }

    #[tokio::test]
    async fn fremder_einsatz_notfound() {
        let pool = crate::db::test_pool().await;
        let (eid, uid) = setup(&pool).await;
        let a = anlegen(&pool, eid, uid, "p.png", "image/png", &[0x89], ecken())
            .await
            .unwrap();
        // anderer Einsatz: ALLE einsatz-scoped Pfade müssen das fremde Bild abweisen.
        let (eid2, _) = setup(&pool).await;
        assert!(laden(&pool, eid2, a.id).await.is_err());
        assert!(laden_bytes(&pool, eid2, a.id).await.is_err());
        assert!(aktualisiere(&pool, eid2, a.id, BildPatch::default())
            .await
            .is_err());
        assert!(loeschen(&pool, eid2, a.id).await.is_err());
        // Das echte Bild bleibt unter seinem Einsatz unangetastet.
        assert!(laden(&pool, eid, a.id).await.is_ok());
    }

    #[tokio::test]
    async fn loeschen_entfernt() {
        let pool = crate::db::test_pool().await;
        let (eid, uid) = setup(&pool).await;
        let a = anlegen(&pool, eid, uid, "p.png", "image/png", &[0x89], ecken())
            .await
            .unwrap();
        loeschen(&pool, eid, a.id).await.unwrap();
        assert!(liste(&pool, eid).await.unwrap().is_empty());
        // Zweites Löschen trifft keine Zeile mehr → NotFound (rows_affected == 0).
        assert!(loeschen(&pool, eid, a.id).await.is_err());
    }
}
