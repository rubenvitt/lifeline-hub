//! Helfer-Einladung (Spec `docs/superpowers/specs/2026-11-24-vakwvkpg-helfer-app-design.md`,
//! „Ablauf“, Schritt 1, und „Server“): der Einsatz-QR. Ein Code wie bei der Gerätekopplung
//! (`geraet::code`, Crockford-Base32, nur als SHA-256 gespeichert), aber mehrfach einlösbar.
//!
//! - Höchstens eine gültige Einladung je Einsatz: eine neue widerruft die alte in derselben
//!   Transaktion ([`anlegen`]).
//! - Die Gültigkeit begrenzt nur, wie lange man sich anmelden kann, nicht wie lange eine Anmeldung
//!   gilt. Vorgabe [`VORGABE_MINUTEN`], höchstens [`HOECHSTENS_MINUTEN`]. Ein geplantes Ende kennt
//!   der Einsatz nicht; mit seinem Abschluss endet die Einladung über die Prüfung „Einsatz aktiv“
//!   in [`einladung_einloesen`].

use crate::error::AppError;
use crate::geraet::code;
use serde::Serialize;
use sqlx::{SqliteConnection, SqlitePool};
use utoipa::ToSchema;

/// Vorgabe der Gültigkeit einer Einladung (4 h).
pub const VORGABE_MINUTEN: i64 = 240;
/// Höchste Gültigkeit einer Einladung (72 h).
pub const HOECHSTENS_MINUTEN: i64 = 72 * 60;
/// Höchstens so oft lässt sich eine Einladung einlösen; danach ist sie ausgeschöpft (422
/// `invitation_exhausted`), die Leitung legt eine neue an. Ein ausgehängter QR legt sonst ohne
/// Ende Gerätekonten an.
pub const EINLOESUNGEN_MAX: i64 = 200;
/// Meldung zu [`EINLOESUNGEN_MAX`]; der Handler erkennt sie und nennt den Grund.
pub const AUSGESCHOEPFT: &str =
    "Diese Einladung ist ausgeschöpft. Bitte die Einsatzleitung um einen neuen QR-Code.";

/// Bedingung „die Einladung `t` ist gültig“ (`t`: Tabelle oder Alias): nicht widerrufen, nicht
/// abgelaufen, Einsatz aktiv, nicht gelöscht und kein Spiegel (an einem Spiegel scheiterte jedes
/// Bestätigen am Schutz-Trigger, der Helfer hinge bis zum Ablauf).
fn gueltig(t: &str) -> String {
    format!(
        "{t}.widerrufen_at IS NULL AND {t}.laeuft_ab_at > datetime('now') \
         AND EXISTS (SELECT 1 FROM einsatz e WHERE e.id = {t}.einsatz_id \
                     AND e.status = 'aktiv' AND e.geloescht_at IS NULL AND e.spiegel = 0)"
    )
}

/// Eine Helfer-Einladung. Den Klartext-`code` trägt nur die Antwort auf das Anlegen, einmal.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct HelferEinladungAnzeige {
    pub id: i64,
    /// Der Code (8 Zeichen); fehlt außer in der Antwort auf das Anlegen.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
    /// `https://<server>/helfer#<CODE>`, wenn der Server seine öffentliche Adresse kennt; sonst
    /// baut der Client die Adresse aus seinem Origin (`helferAdresse`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    pub expires_at: String,
}

/// Prüft die gewünschte Gültigkeit in Minuten (400 außerhalb von 1 bis [`HOECHSTENS_MINUTEN`]:
/// der Wertebereich des Felds für sich).
pub fn pruefe_minuten(minuten: Option<i64>) -> Result<i64, AppError> {
    let minuten = minuten.unwrap_or(VORGABE_MINUTEN);
    if !(1..=HOECHSTENS_MINUTEN).contains(&minuten) {
        return Err(AppError::Validation(format!(
            "Eine Einladung gilt mindestens eine Minute und höchstens {} Stunden",
            HOECHSTENS_MINUTEN / 60
        )));
    }
    Ok(minuten)
}

/// Legt eine neue Einladung an und widerruft eine noch gültige alte desselben Einsatzes.
/// Liefert die Anzeige mit Code (ohne `url`). An einem Spiegel 409 wie jeder Schreibweg dort.
pub async fn anlegen(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    minuten: i64,
    von: i64,
) -> Result<HelferEinladungAnzeige, AppError> {
    let spiegel: bool = sqlx::query_scalar("SELECT spiegel <> 0 FROM einsatz WHERE id = ?")
        .bind(einsatz_id)
        .fetch_one(&mut *conn)
        .await?;
    if spiegel {
        return Err(AppError::Conflict(
            "Dieser Einsatz ist ein Spiegel; Helfer lädt die führende Instanz ein.".into(),
        ));
    }
    sqlx::query(
        "UPDATE helfer_einladung SET widerrufen_at = datetime('now') \
         WHERE einsatz_id = ? AND widerrufen_at IS NULL AND laeuft_ab_at > datetime('now')",
    )
    .bind(einsatz_id)
    .execute(&mut *conn)
    .await?;
    let code = code::neu();
    let (id, expires_at): (i64, String) = sqlx::query_as(
        "INSERT INTO helfer_einladung (einsatz_id, code_hash, laeuft_ab_at, erstellt_von, erstellt_at) \
         VALUES (?, ?, datetime('now', ?), ?, datetime('now')) \
         RETURNING id, laeuft_ab_at",
    )
    .bind(einsatz_id)
    .bind(code::hash(&code))
    .bind(format!("+{minuten} minutes"))
    .bind(von)
    .fetch_one(&mut *conn)
    .await?;
    Ok(HelferEinladungAnzeige {
        id,
        code: Some(code),
        url: None,
        expires_at,
    })
}

/// Widerruft eine Einladung. Eine Einladung eines anderen Einsatzes ist 404; eine schon
/// widerrufene bleibt, wie sie ist.
pub async fn widerrufen(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    einladung_id: i64,
) -> Result<(), AppError> {
    let gefunden: Option<i64> =
        sqlx::query_scalar("SELECT id FROM helfer_einladung WHERE id = ? AND einsatz_id = ?")
            .bind(einladung_id)
            .bind(einsatz_id)
            .fetch_optional(&mut *conn)
            .await?;
    gefunden.ok_or(AppError::NotFound)?;
    sqlx::query(
        "UPDATE helfer_einladung SET widerrufen_at = datetime('now') \
         WHERE id = ? AND widerrufen_at IS NULL",
    )
    .bind(einladung_id)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// Die gültige Einladung des Einsatzes, ohne Code.
pub async fn gueltige(
    pool: &SqlitePool,
    einsatz_id: i64,
) -> Result<Option<HelferEinladungAnzeige>, AppError> {
    let zeile: Option<(i64, String)> = sqlx::query_as(
        "SELECT id, laeuft_ab_at FROM helfer_einladung \
         WHERE einsatz_id = ? AND widerrufen_at IS NULL AND laeuft_ab_at > datetime('now') \
         ORDER BY id DESC LIMIT 1",
    )
    .bind(einsatz_id)
    .fetch_optional(pool)
    .await?;
    Ok(zeile.map(|(id, expires_at)| HelferEinladungAnzeige {
        id,
        code: None,
        url: None,
        expires_at,
    }))
}

/// Ob eine sonst gültige Einladung zum Code [`EINLOESUNGEN_MAX`] erreicht hat.
async fn ist_ausgeschoepft(conn: &mut SqliteConnection, code_hash: &str) -> Result<bool, AppError> {
    Ok(sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
        "SELECT EXISTS (SELECT 1 FROM helfer_einladung h \
         WHERE h.code_hash = ? AND h.einloesungen >= ? AND {})",
        gueltig("h")
    )))
    .bind(code_hash)
    .bind(EINLOESUNGEN_MAX)
    .fetch_one(&mut *conn)
    .await?)
}

/// Löst einen Einladungscode ein und zählt `einloesungen` hoch. Liefert
/// `(einladung_id, einsatz_id, org_id)`. Ein unbekannter, abgelaufener oder widerrufener Code und
/// ein nicht mehr aktiver Einsatz oder ein Spiegel sind einheitlich 401, damit die Antwort nichts
/// verrät; ebenso eine Eingabe, die nicht die Form eines Codes hat. Eine ausgeschöpfte Einladung
/// ist 422 mit [`AUSGESCHOEPFT`].
pub async fn einladung_einloesen(
    conn: &mut SqliteConnection,
    code: &str,
) -> Result<(i64, i64, i64), AppError> {
    let code = code::normalisiere(code).ok_or(AppError::Unauthorized)?;
    let code_hash = code::hash(&code);
    let treffer: Option<(i64, i64, i64)> = sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "UPDATE helfer_einladung SET einloesungen = einloesungen + 1 \
         WHERE code_hash = ? AND einloesungen < ? AND {} \
         RETURNING id, einsatz_id, \
                   (SELECT e.org_id FROM einsatz e WHERE e.id = helfer_einladung.einsatz_id)",
        gueltig("helfer_einladung")
    )))
    .bind(&code_hash)
    .bind(EINLOESUNGEN_MAX)
    .fetch_optional(&mut *conn)
    .await?;
    match treffer {
        Some(t) => Ok(t),
        None if ist_ausgeschoepft(conn, &code_hash).await? => {
            Err(AppError::UnprocessableEntity(AUSGESCHOEPFT.into()))
        }
        None => Err(AppError::Unauthorized),
    }
}

/// Eine gültige Einladung zu einem Code, ohne sie einzulösen (Zielliste vor dem Anmelden).
/// Liefert `(einladung_id, einsatz_id, org_id)`; jeder Fehlschlag ist 401 wie bei
/// [`einladung_einloesen`], eine ausgeschöpfte Einladung ebenso 422.
pub async fn einladung_pruefen(pool: &SqlitePool, code: &str) -> Result<(i64, i64, i64), AppError> {
    let code = code::normalisiere(code).ok_or(AppError::Unauthorized)?;
    let mut conn = pool.acquire().await?;
    let treffer: Option<(i64, i64, i64, i64)> = sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "SELECT h.id, h.einsatz_id, e.org_id, h.einloesungen FROM helfer_einladung h \
         JOIN einsatz e ON e.id = h.einsatz_id \
         WHERE h.code_hash = ? AND {}",
        gueltig("h")
    )))
    .bind(code::hash(&code))
    .fetch_optional(&mut *conn)
    .await?;
    match treffer {
        Some((_, _, _, n)) if n >= EINLOESUNGEN_MAX => {
            Err(AppError::UnprocessableEntity(AUSGESCHOEPFT.into()))
        }
        Some((id, einsatz_id, org_id, _)) => Ok((id, einsatz_id, org_id)),
        None => Err(AppError::Unauthorized),
    }
}

/// Wer die Einladung angelegt hat; die Helfer-Kopplung trägt ihn als `erstellt_von`.
pub async fn ersteller(conn: &mut SqliteConnection, einladung_id: i64) -> Result<i64, AppError> {
    Ok(
        sqlx::query_scalar("SELECT erstellt_von FROM helfer_einladung WHERE id = ?")
            .bind(einladung_id)
            .fetch_one(&mut *conn)
            .await?,
    )
}
