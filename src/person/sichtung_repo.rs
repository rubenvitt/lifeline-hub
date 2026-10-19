use crate::error::AppError;
use crate::geraet::bestaetigung::Bestaetigung;
use crate::person::Sichtungskategorie;
use serde::Serialize;
use sqlx::{SqliteConnection, SqlitePool};
use utoipa::ToSchema;

/// Ein Sichtungs-Verlaufseintrag (1:1 zu `person_sichtung`).
#[derive(Debug, Clone, Serialize, sqlx::FromRow, ToSchema)]
pub struct SichtungAnzeige {
    pub id: i64,
    pub einsatz_id: i64,
    pub person_id: i64,
    #[schema(value_type = crate::person::Sichtungskategorie)]
    pub kategorie: String,
    pub notiz: Option<String>,
    pub gesichtet_at: String,
    pub gesichtet_von: i64,
    /// Namentliche Bestätigung am Gerät (LFH-1046): Name der bestätigenden Person.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bestaetigt_name: Option<String>,
    /// Wann der Eintrag beim Server ankam (LLH-1138); `gesichtet_at` ist die Erfassungszeit.
    /// Fehlt bei Einträgen von vor der Migration 0217.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub eingegangen_at: Option<String>,
}

const SELECT_SICHTUNG: &str = "\
    SELECT id, einsatz_id, person_id, kategorie, notiz, gesichtet_at, gesichtet_von, \
           bestaetigt_name, eingegangen_at \
    FROM person_sichtung";

/// „Aktuell“ (Spec `personen-verlauf`, design.md D6): die Sichtung mit dem jüngsten
/// Erfassungszeitpunkt, bei Gleichstand die später gespeicherte. **Die einzige Stelle, die das
/// für die Sichtung definiert**: Cache und Verlauf lesen dieselbe Ordnung. Als Makro, damit
/// `concat!` daraus ein `&'static str` baut (Muster `betreuung::repo::juengste_meldung!`).
///
/// Überholt ist der Kopfkommentar von `migrations/0022_einsatz_person_med_cache.sql` („jüngster
/// Eintrag = zuletzt eingefügt“): seit 0217 nimmt der POST eine Erfassungszeit an, und der Cache
/// folgt dieser Ordnung, auch für den Verbleib (`verbleib_repo::verbleibfolge!`). Die Migration
/// bleibt trotzdem unverändert: sqlx prüft die Checksumme der ganzen Datei samt Kommentaren.
macro_rules! sichtungsfolge {
    () => {
        "ORDER BY gesichtet_at DESC, id DESC"
    };
}

/// Eine neue Sichtung; Texte bereits getrimmt, `kategorie` bereits validiert.
#[derive(Debug, Default)]
pub struct NeueSichtung<'a> {
    pub kategorie: &'a str,
    pub notiz: Option<&'a str>,
    /// Erfassungszeit, bereits über `support::erfassungszeitpunkt` gekappt; `None` = jetzt.
    pub gesichtet_at: Option<&'a str>,
    /// Idempotenzschlüssel der Offline-Queue (LLH-1138).
    pub client_id: Option<&'a str>,
    /// Bereits über [`crate::geraet::bestaetigung::aufloesen`] geprüft (LFH-1046).
    pub bestaetigung: Option<&'a Bestaetigung>,
}

/// Ergebnis einer Erfassung: der neue Eintrag und ob er der aktuelle ist. Ein nachgereichter
/// älterer Eintrag gewinnt nicht; Folgen, die am aktuellen Stand hängen, unterbleiben dann.
#[derive(Debug)]
pub struct ErfassteSichtung {
    pub sichtung: SichtungAnzeige,
    pub gewinnt: bool,
}

/// Erfasst eine Sichtung append-only und bestimmt den Cache neu aus der jüngsten Sichtung, samt
/// optionalem Heben `erfasst→betroffen`, auf der offenen Verbindung des Aufrufers (der bündelt
/// es mit dem System-ETB in EINE `write_retry!`-Transaktion). Liefert die frische Anzeige und ob
/// sie gewinnt.
pub async fn erfassen_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    person_id: i64,
    neu: &NeueSichtung<'_>,
    gesichtet_von: i64,
    hebe_auf_betroffen: bool,
) -> Result<ErfassteSichtung, AppError> {
    if hebe_auf_betroffen {
        sqlx::query(
            "UPDATE einsatz_person SET status = 'betroffen', \
                geaendert_at = strftime('%Y-%m-%d %H:%M:%S','now'), geaendert_von = ? \
             WHERE id = ? AND einsatz_id = ?",
        )
        .bind(gesichtet_von)
        .bind(person_id)
        .bind(einsatz_id)
        .execute(&mut *conn)
        .await?;
    }
    let id: i64 = sqlx::query_scalar(
        "INSERT INTO person_sichtung (einsatz_id, person_id, kategorie, notiz, gesichtet_von, \
            bestaetigt_personal_id, bestaetigt_name, gesichtet_at, eingegangen_at, client_id) \
         VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, strftime('%Y-%m-%d %H:%M:%S','now')), \
                 strftime('%Y-%m-%d %H:%M:%S','now'), ?) RETURNING id",
    )
    .bind(einsatz_id)
    .bind(person_id)
    .bind(neu.kategorie)
    .bind(neu.notiz)
    .bind(gesichtet_von)
    .bind(neu.bestaetigung.map(|b| b.personal_id))
    .bind(neu.bestaetigung.map(|b| b.name.as_str()))
    .bind(neu.gesichtet_at)
    .bind(neu.client_id)
    .fetch_one(&mut *conn)
    .await?;
    // Der Cache folgt der jüngsten Sichtung (D6), nicht der Einfügung: eine nachgereichte ältere
    // lässt ihn stehen. Das At-Feld übernimmt exakt deren gesichtet_at.
    let juengste: i64 = sqlx::query_scalar(concat!(
        "SELECT id FROM person_sichtung WHERE einsatz_id = ? AND person_id = ? ",
        sichtungsfolge!(),
        " LIMIT 1"
    ))
    .bind(einsatz_id)
    .bind(person_id)
    .fetch_one(&mut *conn)
    .await?;
    sqlx::query(
        "UPDATE einsatz_person SET \
            aktuelle_sichtung = (SELECT kategorie FROM person_sichtung WHERE id = ?1), \
            aktuelle_sichtung_at = (SELECT gesichtet_at FROM person_sichtung WHERE id = ?1) \
         WHERE id = ?2 AND einsatz_id = ?3",
    )
    .bind(juengste)
    .bind(person_id)
    .bind(einsatz_id)
    .execute(&mut *conn)
    .await?;
    Ok(ErfassteSichtung {
        sichtung: laden_tx(conn, einsatz_id, id).await?,
        gewinnt: juengste == id,
    })
}

/// Die schon gespeicherte Sichtung zu einer `client_id` im Einsatz (Replay der Offline-Queue).
pub async fn nach_client_id(
    executor: impl sqlx::Executor<'_, Database = sqlx::Sqlite>,
    einsatz_id: i64,
    client_id: &str,
) -> Result<Option<SichtungAnzeige>, AppError> {
    Ok(
        sqlx::query_as::<_, SichtungAnzeige>(sqlx::AssertSqlSafe(format!(
            "{SELECT_SICHTUNG} WHERE einsatz_id = ? AND client_id = ?"
        )))
        .bind(einsatz_id)
        .bind(client_id)
        .fetch_optional(executor)
        .await?,
    )
}

/// Die aktuelle Sichtungskategorie einer Person (Cache `aktuelle_sichtung`) auf der offenen
/// Verbindung des Aufrufers: in derselben Transaktion VOR [`erfassen_tx`] gelesen, ist sie der
/// Vorzustand, an dem eine Hochstufung auf SK I erkannt wird (Spec `benachrichtigungen`, „Neue
/// Person der Sichtungskategorie I“). `None` ohne Sichtung; `NotFound`, falls fremd.
pub async fn aktuelle_kategorie_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    person_id: i64,
) -> Result<Option<Sichtungskategorie>, AppError> {
    sqlx::query_scalar::<_, Option<Sichtungskategorie>>(
        "SELECT aktuelle_sichtung FROM einsatz_person WHERE id = ? AND einsatz_id = ?",
    )
    .bind(person_id)
    .bind(einsatz_id)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or(AppError::NotFound)
}

/// Pool-Wrapper: erfasst eine Sichtung in EINER eigenen Transaktion (Status-Hub, INSERT und
/// Cache atomar) und lädt die Anzeige.
pub async fn erfassen(
    pool: &SqlitePool,
    einsatz_id: i64,
    person_id: i64,
    kategorie: &str,
    notiz: Option<&str>,
    gesichtet_von: i64,
    hebe_auf_betroffen: bool,
) -> Result<SichtungAnzeige, AppError> {
    let mut tx = pool.begin().await?;
    let erfasst = erfassen_tx(
        &mut tx,
        einsatz_id,
        person_id,
        &NeueSichtung {
            kategorie,
            notiz,
            ..NeueSichtung::default()
        },
        gesichtet_von,
        hebe_auf_betroffen,
    )
    .await?;
    tx.commit().await?;
    Ok(erfasst.sichtung)
}

/// Lädt eine Sichtung; `NotFound`, falls nicht zum Einsatz.
pub async fn laden(
    pool: &SqlitePool,
    einsatz_id: i64,
    id: i64,
) -> Result<SichtungAnzeige, AppError> {
    sqlx::query_as::<_, SichtungAnzeige>(sqlx::AssertSqlSafe(format!(
        "{SELECT_SICHTUNG} WHERE id = ? AND einsatz_id = ?"
    )))
    .bind(id)
    .bind(einsatz_id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)
}

/// Wie [`laden`], aber auf einer offenen Connection/Transaktion (In-Tx-Reload für den
/// atomaren Erfassungs-Pfad).
pub async fn laden_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    id: i64,
) -> Result<SichtungAnzeige, AppError> {
    sqlx::query_as::<_, SichtungAnzeige>(sqlx::AssertSqlSafe(format!(
        "{SELECT_SICHTUNG} WHERE id = ? AND einsatz_id = ?"
    )))
    .bind(id)
    .bind(einsatz_id)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or(AppError::NotFound)
}

/// Sichtungs-Verlauf einer Person (neueste zuerst).
pub async fn liste_je_person(
    pool: &SqlitePool,
    einsatz_id: i64,
    person_id: i64,
) -> Result<Vec<SichtungAnzeige>, AppError> {
    Ok(
        sqlx::query_as::<_, SichtungAnzeige>(sqlx::AssertSqlSafe(format!(
            "{SELECT_SICHTUNG} WHERE einsatz_id = ? AND person_id = ? {}",
            sichtungsfolge!()
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

    /// Org + Benutzer + aktiver Einsatz + eine Person (Status erfasst). Liefert (benutzer_id, einsatz_id, person_id).
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

    async fn status(pool: &SqlitePool, person_id: i64) -> String {
        sqlx::query_scalar("SELECT status FROM einsatz_person WHERE id = ?")
            .bind(person_id)
            .fetch_one(pool)
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn erfassen_ist_append_only_und_cache_spiegelt_juengste() {
        let pool = test_pool().await;
        let (b, e, p) = setup(&pool).await;
        erfassen(&pool, e, p, "sk2", None, b, false).await.unwrap();
        erfassen(&pool, e, p, "sk1", Some("verschlechtert"), b, false)
            .await
            .unwrap();
        let verlauf = liste_je_person(&pool, e, p).await.unwrap();
        assert_eq!(verlauf.len(), 2, "beide Sichtungen bleiben (append-only)");
        assert_eq!(verlauf[0].kategorie, "sk1", "neueste zuerst");
        // Cache spiegelt jüngste Sichtung + deren Zeitstempel:
        let (kat, at): (Option<String>, Option<String>) = sqlx::query_as(
            "SELECT aktuelle_sichtung, aktuelle_sichtung_at FROM einsatz_person WHERE id = ?",
        )
        .bind(p)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(kat.as_deref(), Some("sk1"));
        assert_eq!(
            at.as_deref(),
            Some(verlauf[0].gesichtet_at.as_str()),
            "Cache-At = jüngstes gesichtet_at"
        );
    }

    #[tokio::test]
    async fn hebe_auf_betroffen_setzt_status_in_derselben_aktion() {
        let pool = test_pool().await;
        let (b, e, p) = setup(&pool).await;
        assert_eq!(status(&pool, p).await, "erfasst");
        erfassen(&pool, e, p, "sk3", None, b, true).await.unwrap();
        assert_eq!(
            status(&pool, p).await,
            "betroffen",
            "erfasst→betroffen durch Sichtung"
        );
    }

    #[tokio::test]
    async fn sichtung_tot_aendert_admin_status_nicht() {
        let pool = test_pool().await;
        let (b, e, p) = setup(&pool).await;
        // Vorbedingung: Person ist betroffen (kein erfasst-Anheben mehr nötig).
        sqlx::query("UPDATE einsatz_person SET status='betroffen' WHERE id=?")
            .bind(p)
            .execute(&pool)
            .await
            .unwrap();
        erfassen(&pool, e, p, "tot", None, b, false).await.unwrap();
        assert_eq!(
            status(&pool, p).await,
            "betroffen",
            "Sichtung=tot lässt Admin-Status unangetastet"
        );
    }
}
