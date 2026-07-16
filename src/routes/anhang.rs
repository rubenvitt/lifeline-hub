use crate::anhang::{self, AnhangAnzeige};
use crate::app::AppState;
use crate::einsatz::kontext::EinsatzKontext;
use crate::error::AppError;
use axum::extract::{Multipart, Path, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::IntoResponse;
use axum::Json;

/// POST /api/einsaetze/{id}/anhaenge — generischer Datei-Upload (multipart).
/// Schreibrecht + aktiver Einsatz. Jedes Datei-Feld wird einzeln validiert
/// (Größe, MIME aus Endung), den AV-Scan-Seam (scan-vor-persist) durchlaufen und
/// als BLOB persistiert. Liefert die Metadaten der angelegten Anhänge; das
/// Verknüpfen mit einer Chat-Nachricht passiert separat beim Nachricht-Senden.
pub async fn hochladen(
    State(state): State<AppState>,
    ctx: EinsatzKontext,
    mut multipart: Multipart,
) -> Result<(StatusCode, Json<Vec<AnhangAnzeige>>), AppError> {
    ctx.fordere_schreibrecht()?;
    ctx.fordere_aktiv()?;
    let einsatz_id = ctx.einsatz.id;

    // Best-Effort pro Feld (vorbestehendes LFH-102-Muster, keine umschließende Transaktion):
    // scheitert ein späteres Feld (MIME/Größe oder AV-Fund, LFH-114), bleiben die bereits
    // persistierten sauberen BLOBs verwaist zurück. Bewusst toleriert — es landet KEIN
    // gefundener Schadcode in der DB (scan-vor-persist pro Feld), und verwaiste Anhänge werden
    // vom selben Einsatz-Lebenszyklus (DSGVO-Schwärzung) eingesammelt wie „hochgeladen-nicht-
    // gesendet". Atomarität (Tx über alle Felder) wäre ein eigener Task, nicht Teil von LFH-114.
    let mut angelegt = Vec::new();
    while let Some(feld) = multipart
        .next_field()
        .await
        .map_err(|e| AppError::Validation(format!("Multipart-Fehler: {e}")))?
    {
        // Nur echte Datei-Felder (mit Dateiname) verarbeiten; sonstige überspringen.
        let Some(dateiname) = feld.file_name().map(str::to_string) else {
            continue;
        };
        let mime = anhang::ermittle_mime(&dateiname)?;
        let daten = feld
            .bytes()
            .await
            .map_err(|e| AppError::Validation(format!("Datei lesen fehlgeschlagen: {e}")))?;
        anhang::pruefe_groesse(daten.len())?;
        // AV-Scan (LFH-114): scan-vor-persist gegen clamd (config-getrieben, Default
        // fail-closed). Ohne konfigurierten clamd ein No-op.
        anhang::scan(anhang::scan_config(), &daten).await?;
        let a = anhang::repo::anlegen(
            &state.pool,
            einsatz_id,
            ctx.benutzer.id,
            &dateiname,
            &mime,
            &daten,
        )
        .await?;
        angelegt.push(a);
    }

    if angelegt.is_empty() {
        return Err(AppError::Validation("Keine Datei im Upload".into()));
    }
    Ok((StatusCode::CREATED, Json(angelegt)))
}

/// GET /api/einsaetze/{id}/anhaenge/{aid} — Anhang herunterladen.
/// Lesezugriff (inkl. Beobachter) + Pflicht-Ownership-Guard gegen Cross-Einsatz-
/// Zugriff (fremder Einsatz → NotFound, kein ID-Raten).
///
/// Gatet zusätzlich (LFH-116) auf den Chat-Tombstone: hängt der Anhang NUR noch an
/// soft-gelöschten Nachrichten, ist er gesperrt (404) — der Direkt-Deeplink umgeht
/// sonst die Frontend-Ausblendung. Verwaiste oder an einer lebenden Nachricht hängende
/// Anhänge bleiben ladbar (n:m-Semantik). Heute referenziert nur `chat_nachricht_anhang`
/// die `anhang`-Tabelle; ein zweiter Linker (ETB/Lageobjekte) erfordert eine Aggregation.
pub async fn herunterladen(
    State(state): State<AppState>,
    ctx: EinsatzKontext,
    Path((einsatz_id, anhang_id)): Path<(i64, i64)>,
) -> Result<impl IntoResponse, AppError> {
    ctx.fordere_lesezugriff()?;

    if !anhang::repo::gehoert_anhang_zu_einsatz(&state.pool, anhang_id, einsatz_id).await? {
        return Err(AppError::NotFound);
    }
    // LFH-116: Sperren, wenn der Anhang nur noch an soft-gelöschten Chat-Nachrichten
    // hängt (Tombstone) — der Direkt-Deeplink umgeht sonst die Frontend-Ausblendung.
    if crate::chat::repo::anhang_nur_an_geloeschten_nachrichten(&state.pool, anhang_id).await? {
        return Err(AppError::NotFound);
    }
    let (dateiname, mime, daten) = anhang::repo::laden_bytes(&state.pool, anhang_id).await?;

    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_str(&mime)
            .unwrap_or(HeaderValue::from_static("application/octet-stream")),
    );
    // Content-Disposition mit ASCII-Fallback + RFC-5987 filename* (Umlaute etc.);
    // geteilte Infrastruktur in `anhang::content_disposition` (LFH-238).
    headers.insert(
        header::CONTENT_DISPOSITION,
        HeaderValue::from_str(&anhang::content_disposition(&dateiname))
            .map_err(|e| AppError::Internal(format!("Ungültiger Header: {e}")))?,
    );
    Ok((headers, daten))
}

/// DELETE /api/einsaetze/{id}/anhaenge/{aid} — Anhang hart löschen (Freigabepfad, LFH-250).
/// Schreibrecht + aktiver Einsatz; die Ownership erzwingt die einsatz-gescopte Query
/// (fremder Anhang → NotFound). Der `ON DELETE CASCADE`-FK räumt die
/// `chat_nachricht_anhang`-Verknüpfungen mit.
pub async fn loeschen(
    State(state): State<AppState>,
    ctx: EinsatzKontext,
    Path((einsatz_id, anhang_id)): Path<(i64, i64)>,
) -> Result<StatusCode, AppError> {
    ctx.fordere_schreibrecht()?;
    ctx.fordere_aktiv()?;
    anhang::repo::loeschen(&state.pool, einsatz_id, anhang_id).await?;
    Ok(StatusCode::NO_CONTENT)
}
