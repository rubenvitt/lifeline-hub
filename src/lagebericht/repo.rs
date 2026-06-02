use super::{leere_abschnitte, vorlage, Abschnitt, STATUS_ENTWURF};
use crate::error::AppError;
use serde::Serialize;
use sqlx::SqlitePool;

/// Öffentliche Anzeige eines Lageberichts (Abschnitte aus JSON geparst, Namen aufgelöst).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct LageberichtAnzeige {
    pub id: i64,
    pub einsatz_id: i64,
    pub vorlage: String,
    pub titel: String,
    pub zeitstand: String,
    pub status: String,
    pub abschnitte: Vec<Abschnitt>,
    pub version: i64,
    pub vorgaenger_id: Option<i64>,
    pub ersteller_id: i64,
    pub ersteller_name: String,
    pub erstellt_at: String,
    pub aktualisiert_at: String,
    pub freigegeben_von_id: Option<i64>,
    pub freigegeben_von_name: Option<String>,
    pub freigegeben_at: Option<String>,
    pub etb_eintrag_id: Option<i64>,
}

/// Editierbare Felder eines Entwurfs-PATCH. `None` = unverändert.
#[derive(Debug, Default)]
pub struct LageberichtPatch<'a> {
    pub titel: Option<&'a str>,
    pub zeitstand: Option<&'a str>,
    pub abschnitte: Option<&'a [Abschnitt]>,
}

#[derive(sqlx::FromRow)]
struct Row {
    id: i64,
    einsatz_id: i64,
    vorlage: String,
    titel: String,
    zeitstand: String,
    status: String,
    abschnitte: String,
    version: i64,
    vorgaenger_id: Option<i64>,
    ersteller_id: i64,
    ersteller_name: String,
    erstellt_at: String,
    aktualisiert_at: String,
    freigegeben_von_id: Option<i64>,
    freigegeben_von_name: Option<String>,
    freigegeben_at: Option<String>,
    etb_eintrag_id: Option<i64>,
}

const SELECT: &str = "\
    SELECT l.id, l.einsatz_id, l.vorlage, l.titel, l.zeitstand, l.status, l.abschnitte, \
           l.version, l.vorgaenger_id, \
           l.ersteller_id, b1.anzeigename AS ersteller_name, \
           l.erstellt_at, l.aktualisiert_at, \
           l.freigegeben_von_id, b2.anzeigename AS freigegeben_von_name, \
           l.freigegeben_at, l.etb_eintrag_id \
    FROM lagebericht l \
    JOIN benutzer b1 ON b1.id = l.ersteller_id \
    LEFT JOIN benutzer b2 ON b2.id = l.freigegeben_von_id";

fn zu_anzeige(row: Row) -> Result<LageberichtAnzeige, AppError> {
    let abschnitte: Vec<Abschnitt> = serde_json::from_str(&row.abschnitte)
        .map_err(|e| AppError::Internal(format!("Abschnitte-JSON defekt: {e}")))?;
    Ok(LageberichtAnzeige {
        id: row.id,
        einsatz_id: row.einsatz_id,
        vorlage: row.vorlage,
        titel: row.titel,
        zeitstand: row.zeitstand,
        status: row.status,
        abschnitte,
        version: row.version,
        vorgaenger_id: row.vorgaenger_id,
        ersteller_id: row.ersteller_id,
        ersteller_name: row.ersteller_name,
        erstellt_at: row.erstellt_at,
        aktualisiert_at: row.aktualisiert_at,
        freigegeben_von_id: row.freigegeben_von_id,
        freigegeben_von_name: row.freigegeben_von_name,
        freigegeben_at: row.freigegeben_at,
        etb_eintrag_id: row.etb_eintrag_id,
    })
}

/// Alle Berichte eines Einsatzes, neueste Fortschreibung/Anlage zuerst.
pub async fn liste(pool: &SqlitePool, einsatz_id: i64) -> Result<Vec<LageberichtAnzeige>, AppError> {
    let rows = sqlx::query_as::<_, Row>(&format!(
        "{SELECT} WHERE l.einsatz_id = ? ORDER BY l.zeitstand DESC, l.id DESC"
    ))
    .bind(einsatz_id)
    .fetch_all(pool)
    .await?;
    rows.into_iter().map(zu_anzeige).collect()
}

/// Lädt einen Bericht (aufgelöst); `NotFound`, wenn nicht zum Einsatz.
pub async fn laden(pool: &SqlitePool, einsatz_id: i64, id: i64) -> Result<LageberichtAnzeige, AppError> {
    let row = sqlx::query_as::<_, Row>(&format!("{SELECT} WHERE l.id = ? AND l.einsatz_id = ?"))
        .bind(id)
        .bind(einsatz_id)
        .fetch_optional(pool)
        .await?
        .ok_or(AppError::NotFound)?;
    zu_anzeige(row)
}

/// Legt einen Entwurf mit leerem Abschnitts-Skelett der Vorlage an.
/// Erwartet eine bereits validierte `vorlage` und normalisierten `zeitstand`.
pub async fn anlegen(
    pool: &SqlitePool,
    einsatz_id: i64,
    vorlage_key: &str,
    titel: &str,
    zeitstand: &str,
    ersteller_id: i64,
) -> Result<LageberichtAnzeige, AppError> {
    let v = vorlage(vorlage_key).ok_or_else(|| AppError::Validation("Unbekannte Vorlage".into()))?;
    let skelett = serde_json::to_string(&leere_abschnitte(v))
        .map_err(|e| AppError::Internal(e.to_string()))?;
    let id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO lagebericht (einsatz_id, vorlage, titel, zeitstand, status, abschnitte, ersteller_id) \
         VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(einsatz_id)
    .bind(vorlage_key)
    .bind(titel)
    .bind(zeitstand)
    .bind(STATUS_ENTWURF)
    .bind(skelett)
    .bind(ersteller_id)
    .fetch_one(pool)
    .await?;
    laden(pool, einsatz_id, id).await
}

/// Partielles Update eines Entwurfs (Titel/Zeitstand/Abschnitte). `NotFound`,
/// wenn nicht zum Einsatz. Der Entwurfs-Status wird vom Handler geprüft.
pub async fn aktualisiere(
    pool: &SqlitePool,
    einsatz_id: i64,
    id: i64,
    patch: LageberichtPatch<'_>,
) -> Result<LageberichtAnzeige, AppError> {
    let abschnitte_json = match patch.abschnitte {
        Some(a) => Some(serde_json::to_string(a).map_err(|e| AppError::Internal(e.to_string()))?),
        None => None,
    };
    let betroffen = sqlx::query(
        "UPDATE lagebericht SET \
            titel      = CASE WHEN ? THEN ? ELSE titel END, \
            zeitstand  = CASE WHEN ? THEN ? ELSE zeitstand END, \
            abschnitte = CASE WHEN ? THEN ? ELSE abschnitte END, \
            aktualisiert_at = datetime('now') \
         WHERE id = ? AND einsatz_id = ?",
    )
    .bind(patch.titel.is_some()).bind(patch.titel)
    .bind(patch.zeitstand.is_some()).bind(patch.zeitstand)
    .bind(abschnitte_json.is_some()).bind(abschnitte_json.as_deref())
    .bind(id).bind(einsatz_id)
    .execute(pool)
    .await?
    .rows_affected();
    if betroffen == 0 {
        return Err(AppError::NotFound);
    }
    laden(pool, einsatz_id, id).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lagebericht::{vorlage, STATUS_ENTWURF};

    /// Legt Org (id=1), einen Benutzer und einen Einsatz an;
    /// liefert (einsatz_id, ersteller_id).
    /// Mirrored von src/etb/repo.rs tests::setup.
    async fn setup(pool: &SqlitePool) -> (i64, i64) {
        sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT OR IGNORE INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (1, 'Leitung', 'leit', 'h')",
        )
        .execute(pool)
        .await
        .unwrap();
        let ersteller_id: i64 =
            sqlx::query_scalar("SELECT id FROM benutzer WHERE benutzername = 'leit'")
                .fetch_one(pool)
                .await
                .unwrap();
        let einsatz_id: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Lage') RETURNING id",
        )
        .fetch_one(pool)
        .await
        .unwrap();
        (einsatz_id, ersteller_id)
    }

    #[tokio::test]
    async fn anlegen_erzeugt_entwurf_mit_skelett() {
        let pool = crate::db::test_pool().await;
        let (einsatz, ersteller) = setup(&pool).await;
        let lb = anlegen(&pool, einsatz, "lagebericht", "Lage 10:00", "2026-06-02 10:00:00", ersteller)
            .await.unwrap();
        assert_eq!(lb.vorlage, "lagebericht");
        assert_eq!(lb.status, STATUS_ENTWURF);
        assert_eq!(lb.version, 1);
        assert_eq!(lb.abschnitte.len(), vorlage("lagebericht").unwrap().abschnitte.len());
        assert!(lb.abschnitte.iter().all(|a| a.text.is_empty()));
        let geladen = laden(&pool, einsatz, lb.id).await.unwrap();
        assert_eq!(geladen, lb);
        let alle = liste(&pool, einsatz).await.unwrap();
        assert_eq!(alle.len(), 1);
    }

    #[tokio::test]
    async fn fremder_einsatz_ist_notfound() {
        let pool = crate::db::test_pool().await;
        let (einsatz, ersteller) = setup(&pool).await;
        let lb = anlegen(&pool, einsatz, "freitext", "X", "2026-06-02 10:00:00", ersteller).await.unwrap();
        assert!(matches!(laden(&pool, 999, lb.id).await.unwrap_err(), crate::error::AppError::NotFound));
    }

    #[tokio::test]
    async fn aktualisiere_setzt_abschnitte() {
        let pool = crate::db::test_pool().await;
        let (einsatz, ersteller) = setup(&pool).await;
        let lb = anlegen(&pool, einsatz, "freitext", "X", "2026-06-02 10:00:00", ersteller).await.unwrap();
        let neu = vec![Abschnitt { schluessel: "text".into(), text: "Inhalt".into() }];
        let upd = aktualisiere(&pool, einsatz, lb.id, LageberichtPatch {
            titel: Some("Neu"), zeitstand: None, abschnitte: Some(&neu),
        }).await.unwrap();
        assert_eq!(upd.titel, "Neu");
        assert_eq!(upd.abschnitte, neu);
    }
}
