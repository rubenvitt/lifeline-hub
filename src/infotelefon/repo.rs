//! Persistenz des Informationstelefons (LFH-554).
//!
//! **Statuscodes:** 400 für unbekannte Enum-Werte (Route); 422 für „Rückruf nötig“ ohne
//! Rückrufnummer und für einen Statuswechsel auf den bestehenden Status; 404 für einen fremden
//! Anruf. Kein ETB-Eintrag: das Protokoll ist selbst der Nachweis.

use sqlx::{SqliteConnection, SqlitePool};

use super::{InfotelefonAnliegen, InfotelefonAnrufAnzeige, InfotelefonStatus};
use crate::error::AppError;

/// Eingabe „Anruf erfassen“. Anliegen und Eingang hat die Route gelesen und normalisiert.
#[derive(Debug, Clone)]
pub struct AnrufEingabe {
    pub anliegen: InfotelefonAnliegen,
    pub notiz: Option<String>,
    pub anrufer_name: Option<String>,
    pub rueckruf: Option<String>,
    pub rueckruf_noetig: bool,
    pub eingang_at: String,
}

#[derive(sqlx::FromRow)]
struct Zeile {
    id: i64,
    einsatz_id: i64,
    anliegen: String,
    notiz: Option<String>,
    anrufer_name: Option<String>,
    rueckruf: Option<String>,
    status: String,
    eingang_at: String,
    erledigt_von_id: Option<i64>,
    erledigt_von_name: Option<String>,
    erledigt_at: Option<String>,
    angelegt_von_id: i64,
    angelegt_at: String,
}

impl TryFrom<Zeile> for InfotelefonAnrufAnzeige {
    type Error = AppError;
    fn try_from(z: Zeile) -> Result<Self, AppError> {
        Ok(Self {
            id: z.id,
            einsatz_id: z.einsatz_id,
            anliegen: InfotelefonAnliegen::parse(&z.anliegen).ok_or_else(|| {
                AppError::Internal(format!("Unbekanntes Anliegen: {}", z.anliegen))
            })?,
            notiz: z.notiz,
            anrufer_name: z.anrufer_name,
            rueckruf: z.rueckruf,
            status: InfotelefonStatus::parse(&z.status)
                .ok_or_else(|| AppError::Internal(format!("Unbekannter Status: {}", z.status)))?,
            eingang_at: z.eingang_at,
            erledigt_von_id: z.erledigt_von_id,
            erledigt_von_name: z.erledigt_von_name,
            erledigt_at: z.erledigt_at,
            angelegt_von_id: z.angelegt_von_id,
            angelegt_at: z.angelegt_at,
        })
    }
}

macro_rules! anruf_select {
    () => {
        "SELECT a.id, a.einsatz_id, a.anliegen, a.notiz, a.anrufer_name, a.rueckruf, a.status, \
                a.eingang_at, a.erledigt_von_id, b.anzeigename AS erledigt_von_name, \
                a.erledigt_at, a.angelegt_von_id, a.angelegt_at \
         FROM infotelefon_anruf a LEFT JOIN benutzer b ON b.id = a.erledigt_von_id "
    };
}

/// Alle Anrufe des Einsatzes, jüngster Eingang zuerst (ein Protokoll wird gelesen).
pub async fn liste(
    pool: &SqlitePool,
    einsatz_id: i64,
) -> Result<Vec<InfotelefonAnrufAnzeige>, AppError> {
    sqlx::query_as::<_, Zeile>(concat!(
        anruf_select!(),
        "WHERE a.einsatz_id = ? ORDER BY a.eingang_at DESC, a.id DESC"
    ))
    .bind(einsatz_id)
    .fetch_all(pool)
    .await?
    .into_iter()
    .map(TryInto::try_into)
    .collect()
}

/// Lädt einen Anruf. `NotFound`, wenn er nicht zum Einsatz gehört.
pub async fn laden(
    executor: impl sqlx::Executor<'_, Database = sqlx::Sqlite>,
    einsatz_id: i64,
    id: i64,
) -> Result<InfotelefonAnrufAnzeige, AppError> {
    sqlx::query_as::<_, Zeile>(concat!(
        anruf_select!(),
        "WHERE a.einsatz_id = ? AND a.id = ?"
    ))
    .bind(einsatz_id)
    .bind(id)
    .fetch_optional(executor)
    .await?
    .ok_or(AppError::NotFound)?
    .try_into()
}

fn text_opt(s: Option<&str>) -> Option<String> {
    s.map(str::trim)
        .filter(|t| !t.is_empty())
        .map(str::to_string)
}

/// Erfasst einen Anruf. Mit Rückrufbedarf beginnt er `offen` und braucht eine Nummer (sonst
/// 422), ohne beginnt er `erledigt`. Liefert die Kennung.
pub async fn anlegen_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    benutzer_id: i64,
    e: &AnrufEingabe,
) -> Result<i64, AppError> {
    let rueckruf = text_opt(e.rueckruf.as_deref());
    if e.rueckruf_noetig && rueckruf.is_none() {
        return Err(AppError::UnprocessableEntity(
            "Für einen Rückruf fehlt die Rückrufnummer".into(),
        ));
    }
    let status = if e.rueckruf_noetig {
        InfotelefonStatus::Offen
    } else {
        InfotelefonStatus::Erledigt
    };
    let id: i64 = sqlx::query_scalar(
        "INSERT INTO infotelefon_anruf \
            (einsatz_id, anliegen, notiz, anrufer_name, rueckruf, status, eingang_at, \
             angelegt_von_id) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(einsatz_id)
    .bind(e.anliegen.as_str())
    .bind(text_opt(e.notiz.as_deref()))
    .bind(text_opt(e.anrufer_name.as_deref()))
    .bind(rueckruf)
    .bind(status.as_str())
    .bind(&e.eingang_at)
    .bind(benutzer_id)
    .fetch_one(&mut *conn)
    .await?;
    Ok(id)
}

/// Erledigt einen offenen Rückruf oder öffnet einen erledigten wieder. Wiederöffnen verlangt
/// eine Rückrufnummer (422 ohne); derselbe Status ist 422.
pub async fn status_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    id: i64,
    benutzer_id: i64,
    ziel: InfotelefonStatus,
) -> Result<(), AppError> {
    let alt = laden(&mut *conn, einsatz_id, id).await?;
    if alt.status == ziel {
        return Err(AppError::UnprocessableEntity(format!(
            "Der Anruf steht bereits auf „{}“",
            ziel.as_str()
        )));
    }
    match ziel {
        InfotelefonStatus::Erledigt => {
            sqlx::query(
                "UPDATE infotelefon_anruf SET status = 'erledigt', erledigt_von_id = ?, \
                    erledigt_at = ? WHERE einsatz_id = ? AND id = ?",
            )
            .bind(benutzer_id)
            .bind(crate::zeit::jetzt())
            .bind(einsatz_id)
            .bind(id)
            .execute(&mut *conn)
            .await?;
        }
        InfotelefonStatus::Offen => {
            if alt.rueckruf.is_none() {
                return Err(AppError::UnprocessableEntity(
                    "Ohne Rückrufnummer gibt es keinen offenen Rückruf".into(),
                ));
            }
            sqlx::query(
                "UPDATE infotelefon_anruf SET status = 'offen', erledigt_von_id = NULL, \
                    erledigt_at = NULL WHERE einsatz_id = ? AND id = ?",
            )
            .bind(einsatz_id)
            .bind(id)
            .execute(&mut *conn)
            .await?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests;
