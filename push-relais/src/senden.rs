//! `POST /v1/senden`: prüft den Server, begrenzt und reicht Nachrichten an APNs weiter.
use crate::{
    api::RelaisState,
    apns::{self, Ergebnis, Nachricht},
    speicher::{self, Pruefung},
};
use axum::{
    extract::State,
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use futures::stream::{self, StreamExt};
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tokio::time::Instant;

const MAX_NACHRICHTEN: usize = 100;
const MAX_NUTZLAST: usize = 4096;
/// Körper eines `senden`-Aufrufs: 100 Nachrichten zu je höchstens 4096 Byte Push, 200 Zeichen
/// Token, 64 Byte Kollaps und den Feldnamen passen darunter. Mehr lehnt axum mit 413 ab.
pub const KOERPER_MAX: usize = 512 * 1024;
/// So viele Anfragen eines Aufrufs laufen zugleich über die HTTP/2-Verbindung zu Apple. Eine
/// hängende Anfrage hält so die übrigen nicht auf; 100 Nachrichten brauchen sieben Runden.
const GLEICHZEITIG: usize = 16;
/// Gesamtfrist eines `senden`-Aufrufs: was bis dahin nicht zugestellt ist, wird `fehler`. Klar
/// unter der Frist, die der Lifeline-Server dem Aufruf gibt (`RELAIS_SENDEN_FRIST`, 30 s, in
/// `src/ios_push/mod.rs`), damit er die Ergebnisse noch liest und erloschene Token löscht.
/// Ohne sie dauerte der schlimmste Fall sieben Runden zu je [`crate::apns::APNS_FRIST`].
pub const GESAMTFRIST: Duration = Duration::from_secs(20);

#[derive(Deserialize)]
pub struct SendenAnfrage {
    pub nachrichten: Vec<Nachricht>,
}

#[derive(Serialize)]
pub struct SendenAntwort {
    pub ergebnisse: Vec<Ergebnis>,
}

fn fehler(status: StatusCode, art: &str) -> Response {
    (status, Json(serde_json::json!({ "fehler": art }))).into_response()
}

/// `Authorization: Bearer <server_id>.<geheimnis>`
fn zugang(headers: &HeaderMap) -> Option<(&str, &str)> {
    let wert = headers.get(header::AUTHORIZATION)?.to_str().ok()?;
    let (schema, rest) = wert.split_once(' ')?;
    if !schema.eq_ignore_ascii_case("bearer") {
        return None;
    }
    rest.trim().split_once('.')
}

pub async fn senden(
    State(state): State<RelaisState>,
    headers: HeaderMap,
    Json(anfrage): Json<SendenAnfrage>,
) -> Response {
    let Some((server_id, geheimnis)) = zugang(&headers) else {
        return fehler(StatusCode::UNAUTHORIZED, "unbekannt");
    };
    match speicher::pruefen(&state.pool, server_id, geheimnis).await {
        Ok(Pruefung::Gueltig) => {}
        Ok(Pruefung::Unbekannt) => return fehler(StatusCode::UNAUTHORIZED, "unbekannt"),
        Ok(Pruefung::Gesperrt) => return fehler(StatusCode::FORBIDDEN, "gesperrt"),
        Err(e) => {
            tracing::error!(fehler = %e, "Prüfung des Servers fehlgeschlagen");
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        }
    }
    let nachrichten = anfrage.nachrichten;
    // Was Apple ohnehin ablehnte (zu großer Push, ungültige Kollaps-Kennung), weist das Relais
    // gleich ab; der Server schickt so etwas nie.
    if nachrichten.len() > MAX_NACHRICHTEN
        || nachrichten.iter().any(|n| {
            n.nutzlast.len() > MAX_NUTZLAST
                || apns::rumpf(n).len() > apns::RUMPF_MAX
                || n.kollaps
                    .as_deref()
                    .is_some_and(|k| !apns::kollaps_gueltig(k))
        })
    {
        return StatusCode::BAD_REQUEST.into_response();
    }
    // Ein Thema außerhalb der erlaubten Bundle-IDs (ADR-0104): nichts geht hinaus.
    if nachrichten.iter().any(|n| {
        n.thema
            .as_deref()
            .is_some_and(|t| !state.apns.thema_erlaubt(t))
    }) {
        return fehler(StatusCode::UNPROCESSABLE_ENTITY, "thema");
    }
    if !state.minute_zaehlen(server_id, nachrichten.len() as u32) {
        return StatusCode::TOO_MANY_REQUESTS.into_response();
    }

    // Nebenläufig, die Ergebnisse in Eingabe-Reihenfolge (`buffered`). Was nach der Gesamtfrist
    // noch läuft oder erst beginnen würde, ist `fehler`; was nicht begonnen hat, geht nicht hinaus.
    let frist = Instant::now() + state.gesamtfrist;
    let ergebnisse: Vec<Ergebnis> = stream::iter(nachrichten)
        .map(|n| {
            let apns = state.apns.clone();
            async move {
                if Instant::now() >= frist {
                    return Ergebnis::Fehler;
                }
                tokio::time::timeout_at(frist, apns.senden(&n))
                    .await
                    .unwrap_or(Ergebnis::Fehler)
            }
        })
        .buffered(GLEICHZEITIG)
        .collect()
        .await;

    // Best effort: ein Fehler beim Vermerken des letzten Aufrufs ändert das Ergebnis nicht.
    let _ = sqlx::query(
        "UPDATE server SET zuletzt_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?",
    )
    .bind(server_id)
    .execute(&state.pool)
    .await;

    let zaehlen = |e: Ergebnis| ergebnisse.iter().filter(|x| **x == e).count();
    tracing::info!(
        server_id,
        anzahl = ergebnisse.len(),
        zugestellt = zaehlen(Ergebnis::Zugestellt),
        token_ungueltig = zaehlen(Ergebnis::TokenUngueltig),
        gedrosselt = zaehlen(Ergebnis::Gedrosselt),
        fehler = zaehlen(Ergebnis::Fehler),
        "senden"
    );
    Json(SendenAntwort { ergebnisse }).into_response()
}
