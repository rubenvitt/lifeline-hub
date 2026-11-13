//! Leserouten für Einsätze unter `/api/v1/` (LLH-1655, Spec `ereignis-abruf`, Herleitung
//! `openspec/changes/umeqho2b-outbox-ereignis-abruf/design.md`, D7 und D11).

/// Die Spalten von `einsatz`, aus denen der Einsatz der öffentlichen API entsteht. Ändert sich
/// eine davon an einem freigegebenen laufenden Einsatz, schreibt der Trigger
/// `einsatz_ereignis_kopf` ein `einsatz.updated`; er hört auf genau diese Spalten (Abgleich in
/// `tests/public_api_ereignis_trigger.rs`). Ein neues Feld im Schema `Einsatz` kommt mit seiner
/// Spalte hier dazu, und eine neue Migration baut den Trigger neu (`src/AGENTS.md`,
/// Ausgangsereignisse für Fremdsysteme).
pub const KOPF_SPALTEN: &[&str] = &[
    "einsatznummer_intern",
    "bezeichnung",
    "stichwort",
    "einsatzart",
    "leitstellen_nr",
    "einsatzort",
    "einsatzort_lat",
    "einsatzort_lon",
    "begonnen_at",
];

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::Response;
use serde::Serialize;
use sqlx::sqlite::SqliteRow;
use sqlx::{Row, SqliteConnection};
use utoipa::ToSchema;

use super::lage::LageEinsatzart;
use super::machine::MachineClient;
use super::{events, freigabe, ApiError, ErrorCode};
use crate::app::AppState;
use crate::error::AppError;

/// Ort des Einsatzes auf der Karte, WGS 84.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct Koordinate {
    /// Breite in Grad.
    pub lat: f64,
    /// Länge in Grad.
    pub lon: f64,
}

/// Ein laufender Einsatz, der für den Zugang freigegeben ist: der Kopf, ohne Sachverhalt,
/// meldende Stelle, Betroffene und Personen.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct Einsatz {
    /// Kennung des Einsatzes an dieser Instanz; dieselbe wie `einsatz_id` in den Ereignissen.
    pub id: i64,
    /// Einsatznummer der Organisation.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub einsatznummer: Option<String>,
    pub bezeichnung: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stichwort: Option<String>,
    pub einsatzart: LageEinsatzart,
    /// Nummer des Einsatzes bei der Leitstelle.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub leitstellen_nr: Option<String>,
    /// Einsatzort als Text.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub einsatzort: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub koordinate: Option<Koordinate>,
    /// Beginn in UTC, `JJJJ-MM-TT hh:mm:ss`.
    pub begonnen_at: String,
}

/// Antwort der Einsatzliste.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct EinsaetzeResponse {
    /// Stand der Ereignisse zu dieser Liste: als `after` an `GET /api/v1/events` geben, dann
    /// geht nichts verloren, was sich nach dem Lesen ändert.
    pub cursor: i64,
    /// Die laufenden Einsätze, die für den Zugang freigegeben sind. Heute höchstens einer.
    pub einsaetze: Vec<Einsatz>,
}

/// Baut den Einsatz aus einer Zeile, die [`KOPF_SPALTEN`] trägt. Liest dieser Code eine Spalte,
/// die dort fehlt, scheitert jeder Abruf: so bleibt die Liste vollständig.
fn aus_zeile(zeile: &SqliteRow) -> Result<Einsatz, AppError> {
    let einsatzart: String = zeile.try_get("einsatzart")?;
    let einsatzart = crate::einsatz::Einsatzart::parse(&einsatzart)
        .ok_or_else(|| AppError::Internal(format!("unbekannte Einsatzart: {einsatzart}")))?;
    let lat: Option<f64> = zeile.try_get("einsatzort_lat")?;
    let lon: Option<f64> = zeile.try_get("einsatzort_lon")?;
    Ok(Einsatz {
        id: zeile.try_get("id")?,
        einsatznummer: zeile.try_get("einsatznummer_intern")?,
        bezeichnung: zeile.try_get("bezeichnung")?,
        stichwort: zeile.try_get("stichwort")?,
        einsatzart: einsatzart.into(),
        leitstellen_nr: zeile.try_get("leitstellen_nr")?,
        einsatzort: zeile.try_get("einsatzort")?,
        koordinate: lat.zip(lon).map(|(lat, lon)| Koordinate { lat, lon }),
        begonnen_at: zeile.try_get("begonnen_at")?,
    })
}

/// Die laufenden Einsätze, die der Zugang liest, in der Form der öffentlichen API. Welche das
/// sind, sagt allein `freigabe` (ADR-0035); die Org wird trotzdem mitgeprüft, denn ein fremder
/// Einsatz hier wäre ein Datenabfluss.
async fn lesbare_einsaetze(
    conn: &mut SqliteConnection,
    zugang_id: &str,
    org_id: i64,
) -> Result<Vec<Einsatz>, AppError> {
    let sql = format!(
        "SELECT id, {} FROM einsatz WHERE id = ? AND org_id = ?",
        KOPF_SPALTEN.join(", ")
    );
    let mut einsaetze = Vec::new();
    for id in freigabe::freigegebene_einsaetze(conn, zugang_id).await? {
        let zeile = sqlx::query(sqlx::AssertSqlSafe(sql.as_str()))
            .bind(id)
            .bind(org_id)
            .fetch_optional(&mut *conn)
            .await?;
        match zeile {
            Some(zeile) => einsaetze.push(aus_zeile(&zeile)?),
            None => tracing::error!(
                zugang_id,
                einsatz_id = id,
                "Freigabe zeigt auf einen Einsatz einer anderen Organisation"
            ),
        }
    }
    Ok(einsaetze)
}

/// Die laufenden Einsätze, die die Einsatzleitung für den Zugang freigegeben hat, mit dem Cursor
/// für `GET /api/v1/events`. Dient dem ersten Aufbau und dem Neuaufbau nach `cursor_expired`.
#[utoipa::path(
    get,
    path = "/api/v1/einsaetze",
    tag = "Einsätze",
    operation_id = "get_einsaetze",
    security(("machine" = ["einsaetze:read"])),
    responses(
        (status = 200, description = "Freigegebene laufende Einsätze (ohne Freigabe eine leere Liste) und der Cursor dazu; Antwort signiert im Kopf `Lifeline-Signature`", body = EinsaetzeResponse),
        (status = 401, description = "Anmeldung fehlgeschlagen (Grund nur am Zugang)", body = super::ApiErrorBody),
        (status = 403, description = "Dem Zugang fehlt `einsaetze:read` (`missing_scope`)", body = super::ApiErrorBody),
        (status = 429, description = "Gedrosselt; `Retry-After` nennt die Wartezeit", body = super::ApiErrorBody),
        (status = "default", description = "Fehler mit stabilem `code`", body = super::ApiErrorBody),
    ),
)]
pub async fn liste(
    State(state): State<AppState>,
    client: MachineClient,
) -> Result<Response, ApiError> {
    // Der Cursor zuerst: was sich nach diesem Stand ändert, liefert der Abruf ab ihm.
    let cursor = events::hoechststand(&state.pool).await?;
    let mut conn = state.pool.acquire().await?;
    let einsaetze = lesbare_einsaetze(&mut conn, &client.zugang.id, client.zugang.org_id).await?;
    drop(conn);
    Ok(client.antwort(StatusCode::OK, &EinsaetzeResponse { cursor, einsaetze }))
}

/// Ein laufender Einsatz, der für den Zugang freigegeben ist.
#[utoipa::path(
    get,
    path = "/api/v1/einsaetze/{id}",
    tag = "Einsätze",
    operation_id = "get_einsatz",
    security(("machine" = ["einsaetze:read"])),
    params(("id" = i64, Path, description = "Kennung des Einsatzes, wie `einsatz_id` in den Ereignissen")),
    responses(
        (status = 200, description = "Der Einsatz; Antwort signiert im Kopf `Lifeline-Signature`", body = Einsatz),
        (status = 401, description = "Anmeldung fehlgeschlagen (Grund nur am Zugang)", body = super::ApiErrorBody),
        (status = 403, description = "Dem Zugang fehlt `einsaetze:read` (`missing_scope`)", body = super::ApiErrorBody),
        (status = 404, description = "Kein laufender Einsatz mit dieser Kennung, der für den Zugang freigegeben ist (`not_found`); die Antwort verrät nicht, ob es den Einsatz gibt", body = super::ApiErrorBody),
        (status = 429, description = "Gedrosselt; `Retry-After` nennt die Wartezeit", body = super::ApiErrorBody),
        (status = "default", description = "Fehler mit stabilem `code`", body = super::ApiErrorBody),
    ),
)]
pub async fn einzeln(
    State(state): State<AppState>,
    Path(id): Path<String>,
    client: MachineClient,
) -> Result<Response, ApiError> {
    // Dieselbe Antwort für „nicht freigegeben“, „fremd“, „beendet“, „unbekannt“ und eine
    // Kennung, die keine Zahl ist.
    let nicht_gefunden = || {
        ApiError::new(
            ErrorCode::NotFound,
            "Kein laufender Einsatz mit dieser Kennung ist für diesen Zugang freigegeben.",
        )
    };
    let id: i64 = id.parse().map_err(|_| nicht_gefunden())?;
    let mut conn = state.pool.acquire().await?;
    let einsatz = lesbare_einsaetze(&mut conn, &client.zugang.id, client.zugang.org_id)
        .await?
        .into_iter()
        .find(|e| e.id == id)
        .ok_or_else(nicht_gefunden)?;
    drop(conn);
    Ok(client.antwort(StatusCode::OK, &einsatz))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn einsatz() -> Einsatz {
        Einsatz {
            id: 7,
            einsatznummer: Some("2026-0007".into()),
            bezeichnung: "Hochwasser".into(),
            stichwort: None,
            einsatzart: LageEinsatzart::Realeinsatz,
            leitstellen_nr: None,
            einsatzort: None,
            koordinate: None,
            begonnen_at: "2026-11-12 08:30:00".into(),
        }
    }

    #[test]
    fn leere_felder_fehlen_in_der_antwort() {
        let v = serde_json::to_value(einsatz()).unwrap();
        let o = v.as_object().unwrap();
        for fehlt in ["stichwort", "leitstellen_nr", "einsatzort", "koordinate"] {
            assert!(
                !o.contains_key(fehlt),
                "{fehlt} fehlt, wenn es leer ist: {v}"
            );
        }
        assert_eq!(o["einsatznummer"], "2026-0007");
        assert_eq!(o["einsatzart"], "realeinsatz");
    }

    /// Der Einsatz der öffentlichen API trägt genau diese Felder (Spec `ereignis-abruf`): ein
    /// neues Feld ist eine bewusste Entscheidung, kein Nebenprodukt.
    #[test]
    fn der_einsatz_traegt_genau_die_felder_des_kopfs() {
        let voll = Einsatz {
            stichwort: Some("B3".into()),
            leitstellen_nr: Some("L-1".into()),
            einsatzort: Some("Marktplatz 1".into()),
            koordinate: Some(Koordinate {
                lat: 52.1,
                lon: 9.3,
            }),
            ..einsatz()
        };
        let v = serde_json::to_value(voll).unwrap();
        let mut felder: Vec<&str> = v.as_object().unwrap().keys().map(String::as_str).collect();
        felder.sort();
        assert_eq!(
            felder,
            [
                "begonnen_at",
                "bezeichnung",
                "einsatzart",
                "einsatznummer",
                "einsatzort",
                "id",
                "koordinate",
                "leitstellen_nr",
                "stichwort"
            ]
        );
        assert_eq!(
            v["koordinate"],
            serde_json::json!({ "lat": 52.1, "lon": 9.3 })
        );
    }
}
