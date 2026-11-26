//! Kanaladressen einer externen Stelle (LLH-2093, Spec `ausgang-email` Abschnitt 1). Heute nimmt
//! die Oberfläche E-Mail und Matrix an ([`KanalArt::is_freigeschaltet`]); die Tabelle kennt schon alle
//! vier Kanäle. Org-Isolation wie im Repo der Stelle: eine fremde Stelle oder Adresse ist
//! `NotFound`.

use super::repo::load_conn;
use super::{ExterneStelle, ExterneStelleKanal, KanalArt};
use crate::error::AppError;
use crate::write_retry;
use sqlx::{SqliteConnection, SqlitePool};

/// Höchstlänge einer Mailadresse nach dem Trimmen (RFC 5321: 254 Oktette im Pfad).
pub const EMAIL_MAX: usize = 254;

/// Höchstlänge der Bezeichnung einer Adresse nach dem Trimmen.
pub const BEZEICHNUNG_MAX: usize = 100;

const COLUMNS: &str = "id, externe_stelle_id, kanal, adresse, bezeichnung";

/// Prüft eine Mailadresse und bringt sie in Speicherform: getrimmt, die Domain klein, der Teil
/// vor dem `@` unverändert. Genau eine Adresse, ohne Anzeigenamen; die Prüfung macht der
/// Adress-Parser des Mail-Crates. Der Fehlertext ist für die Oberfläche bestimmt.
pub fn normalize_email(roh: &str) -> Result<String, String> {
    let roh = roh.trim();
    if roh.is_empty() {
        return Err("Mailadresse darf nicht leer sein".into());
    }
    if roh.chars().count() > EMAIL_MAX {
        return Err(format!(
            "Mailadresse darf höchstens {EMAIL_MAX} Zeichen lang sein"
        ));
    }
    // `Address` kennt weder Anzeigenamen noch Listen; ein Komma, Leerraum oder Klammern wären
    // dort schon ungültig, der Parser lehnt sie ab.
    let adresse: lettre::Address = roh.parse().map_err(|_| {
        "Keine gültige Mailadresse (genau eine Adresse, ohne Anzeigenamen)".to_string()
    })?;
    let fertig = format!("{}@{}", adresse.user(), adresse.domain().to_lowercase());
    if fertig.chars().count() > EMAIL_MAX {
        return Err(format!(
            "Mailadresse darf höchstens {EMAIL_MAX} Zeichen lang sein"
        ));
    }
    Ok(fertig)
}

/// Höchstlänge einer Matrix-Adresse in Bytes (Grenze der Matrix-Spec für IDs).
pub const MATRIX_MAX: usize = 255;

/// Prüft eine Matrix-Adresse und bringt sie in Speicherform: getrimmt, entweder Raum-ID
/// (`!lokal:server`) oder Raum-Alias (`#lokal:server`), geprüft mit dem Parser von ruma. Nutzer-IDs
/// und `matrix.to`-Links werden mit eigenem Text abgelehnt (das Entpacken eines Links ist nicht
/// eingebaut; das Frontend nennt denselben Text, `ExterneStelleKanaele.tsx`). Der Fehlertext ist
/// für die Oberfläche bestimmt.
pub fn normalize_matrix(roh: &str) -> Result<String, String> {
    use matrix_sdk::ruma::OwnedRoomOrAliasId;
    let roh = roh.trim();
    if roh.is_empty() {
        return Err("Matrix-Adresse darf nicht leer sein".into());
    }
    if roh.starts_with('@') {
        return Err("Nutzer-IDs gehen noch nicht, bitte den Raum eintragen".into());
    }
    let klein = roh.to_ascii_lowercase();
    if klein.starts_with("https://matrix.to/") || klein.starts_with("http://matrix.to/") {
        return Err("matrix.to-Links gehen nicht, bitte Raum-ID oder Alias eintragen".into());
    }
    if roh.len() > MATRIX_MAX {
        return Err(format!(
            "Matrix-Adresse darf höchstens {MATRIX_MAX} Bytes lang sein"
        ));
    }
    // ruma lässt Leerraum im lokalen Teil zu; in einer von Hand getippten Adresse ist er ein Tippfehler.
    if roh.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err("Matrix-Adresse darf keinen Leerraum enthalten".into());
    }
    let id: OwnedRoomOrAliasId = roh.try_into().map_err(|_| {
        "Keine gültige Matrix-Adresse (Raum-ID „!raum:server“ oder Alias „#raum:server“)"
            .to_string()
    })?;
    Ok(id.to_string())
}

/// Teil-Patch einer Adresse (Tri-State): `label: Some(None)` leert die Bezeichnung.
#[derive(Debug, Default)]
pub struct KanalPatch<'a> {
    pub address: Option<&'a str>,
    pub label: Option<Option<&'a str>>,
}

fn map_adresse_conflict<T>(e: AppError) -> Result<T, AppError> {
    if let AppError::Database(sqlx::Error::Database(db)) = &e {
        if db.is_unique_violation() {
            return Err(AppError::Conflict(
                "Diese Adresse ist bei der Stelle schon eingetragen".into(),
            ));
        }
    }
    Err(e)
}

/// Alle Adressen einer Stelle der Organisation (`NotFound` bei fremder oder unbekannter Stelle),
/// sortiert nach Kanal und Adresse.
pub async fn list(
    pool: &SqlitePool,
    org_id: i64,
    stelle_id: i64,
) -> Result<Vec<ExterneStelleKanal>, AppError> {
    let mut conn = pool.acquire().await?;
    load_conn(&mut conn, org_id, stelle_id).await?;
    sqlx::query_as::<_, ExterneStelleKanal>(sqlx::AssertSqlSafe(format!(
        "SELECT {COLUMNS} FROM org_externe_stelle_kanal \
         WHERE org_id = ? AND externe_stelle_id = ? \
         ORDER BY kanal, adresse COLLATE NOCASE, id"
    )))
    .bind(org_id)
    .bind(stelle_id)
    .fetch_all(&mut *conn)
    .await
    .map_err(Into::into)
}

/// Alle Adressen der gewünschten Kanäle der **aktiven** Stellen der Organisation, mit ihrer
/// Stelle; sortiert nach Stelle (wie der Katalog) und Adresse. Für die Auswahl im Senden-Dialog.
pub async fn list_fuer_org(
    pool: &SqlitePool,
    org_id: i64,
    kanaele: &[KanalArt],
) -> Result<Vec<(ExterneStelle, ExterneStelleKanal)>, AppError> {
    let stellen = super::repo::list(pool, org_id, true).await?;
    let alle = sqlx::query_as::<_, ExterneStelleKanal>(sqlx::AssertSqlSafe(format!(
        "SELECT {COLUMNS} FROM org_externe_stelle_kanal \
         WHERE org_id = ? ORDER BY adresse COLLATE NOCASE, id"
    )))
    .bind(org_id)
    .fetch_all(pool)
    .await?;
    let mut aus = Vec::new();
    for stelle in stellen {
        for k in alle
            .iter()
            .filter(|k| k.externe_stelle_id == stelle.id && kanaele.contains(&k.channel))
        {
            aus.push((stelle.clone(), k.clone()));
        }
    }
    Ok(aus)
}

async fn load_kanal(
    conn: &mut SqliteConnection,
    org_id: i64,
    kanal_id: i64,
) -> Result<ExterneStelleKanal, AppError> {
    sqlx::query_as::<_, ExterneStelleKanal>(sqlx::AssertSqlSafe(format!(
        "SELECT {COLUMNS} FROM org_externe_stelle_kanal WHERE id = ? AND org_id = ?"
    )))
    .bind(kanal_id)
    .bind(org_id)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or(AppError::NotFound)
}

/// Eine Adresse samt ihrer Stelle; `NotFound` bei fremder oder unbekannter Adresse.
pub async fn load_in_org(
    conn: &mut SqliteConnection,
    org_id: i64,
    kanal_id: i64,
) -> Result<(ExterneStelle, ExterneStelleKanal), AppError> {
    let kanal = load_kanal(conn, org_id, kanal_id).await?;
    let stelle = load_conn(conn, org_id, kanal.externe_stelle_id).await?;
    Ok((stelle, kanal))
}

/// Legt eine Adresse an einer Stelle der Organisation an. Doppelte Adresse → `Conflict`.
/// `adresse` und `bezeichnung` sind schon geprüft und in Speicherform.
pub async fn create(
    pool: &SqlitePool,
    org_id: i64,
    stelle_id: i64,
    channel: KanalArt,
    address: &str,
    label: Option<&str>,
) -> Result<ExterneStelleKanal, AppError> {
    let ergebnis = write_retry!(pool, |conn| {
        load_conn(conn, org_id, stelle_id).await?;
        let id: i64 = sqlx::query_scalar(
            "INSERT INTO org_externe_stelle_kanal \
                (org_id, externe_stelle_id, kanal, adresse, bezeichnung) \
             VALUES (?, ?, ?, ?, ?) RETURNING id",
        )
        .bind(org_id)
        .bind(stelle_id)
        .bind(channel.as_str())
        .bind(address)
        .bind(label)
        .fetch_one(&mut *conn)
        .await?;
        load_kanal(conn, org_id, id).await
    });
    ergebnis.or_else(map_adresse_conflict)
}

/// Teil-Patch einer Adresse der Organisation (`NotFound` bei fremder oder unbekannter Adresse).
pub async fn update(
    pool: &SqlitePool,
    org_id: i64,
    kanal_id: i64,
    patch: KanalPatch<'_>,
) -> Result<ExterneStelleKanal, AppError> {
    let ergebnis = write_retry!(pool, |conn| {
        load_kanal(conn, org_id, kanal_id).await?;
        sqlx::query(
            "UPDATE org_externe_stelle_kanal SET \
                adresse = CASE WHEN ?1 IS NULL THEN adresse ELSE ?1 END, \
                bezeichnung = CASE WHEN ?2 IS NULL THEN bezeichnung ELSE ?3 END, \
                aktualisiert_at = datetime('now') \
             WHERE id = ?4 AND org_id = ?5",
        )
        .bind(patch.address)
        .bind(patch.label.map(|_| 1_i64))
        .bind(patch.label.and_then(|v| v))
        .bind(kanal_id)
        .bind(org_id)
        .execute(&mut *conn)
        .await?;
        load_kanal(conn, org_id, kanal_id).await
    });
    ergebnis.or_else(map_adresse_conflict)
}

/// Löscht eine Adresse der Organisation (`NotFound` bei fremder oder unbekannter Adresse).
pub async fn delete(pool: &SqlitePool, org_id: i64, kanal_id: i64) -> Result<(), AppError> {
    write_retry!(pool, |conn| {
        load_kanal(conn, org_id, kanal_id).await?;
        sqlx::query("DELETE FROM org_externe_stelle_kanal WHERE id = ? AND org_id = ?")
            .bind(kanal_id)
            .bind(org_id)
            .execute(&mut *conn)
            .await?;
        Ok(())
    })
}
