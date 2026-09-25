use crate::app::AppState;
use crate::auth::session::{AdminUser, CurrentUser};
use crate::error::AppError;
use crate::extract::JsonBody;
use crate::org::logo::{self as logo, OrgLogoAnzeige};
use crate::routes::support::{etag_von, if_none_match_matcht};
use axum::extract::{Multipart, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use utoipa::ToSchema;

/// Org-Stammdaten inkl. DV-102-Org-Default (`tz_organisation`) und Logo-Metadaten.
#[derive(Debug, Serialize, sqlx::FromRow, ToSchema)]
pub struct OrganisationAnzeige {
    pub id: i64,
    pub name: String,
    pub tz_organisation: Option<String>,
    /// Logo der Organisation (LFH-22) ohne Bytes; fehlt, wenn keines hinterlegt ist. Die
    /// Bytes liefert `GET /api/organisation/logo`.
    #[sqlx(skip)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub logo: Option<OrgLogoAnzeige>,
}

/// GET /api/organisation — Org-Stammdaten inkl. DV-102-Org-Default.
/// Jeder eingeloggte Nutzer.
pub async fn lesen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
) -> Result<Json<OrganisationAnzeige>, AppError> {
    // Die EIGENE Organisation (F05/LFH-232), nicht `ORDER BY id LIMIT 1`: sonst sähe ein
    // Nutzer der zweiten Org die Stammdaten der ersten — inkl. `tz_organisation`, das die
    // taktischen Zeichen der gesamten Oberfläche steuert.
    Ok(Json(lade_anzeige(&state.pool, benutzer.org_id).await?))
}

/// Lädt die Stammdaten einer Organisation samt Logo-Metadaten (ohne BLOB). Eine Quelle
/// für GET, PATCH und den Logo-Upload, damit jede Antwort dieselbe Form trägt — sonst
/// verlöre ein Client, der seinen Cache aus der PATCH-Antwort setzt, das Logo still.
async fn lade_anzeige(pool: &SqlitePool, org_id: i64) -> Result<OrganisationAnzeige, AppError> {
    let mut org = sqlx::query_as::<_, OrganisationAnzeige>(
        "SELECT id, name, tz_organisation FROM organisation WHERE id = ?",
    )
    .bind(org_id)
    .fetch_one(pool)
    .await?;
    org.logo = logo::meta(pool, org_id).await?;
    Ok(org)
}

/// PATCH-Body (LFH-22, design.md D7): beide Felder optional, aber mindestens eines muss
/// kommen. Der bisherige Aufruf `{ tz_organisation }` des Frontends bleibt gültig.
#[derive(Debug, Deserialize)]
pub struct OrgPatch {
    pub name: Option<String>,
    pub tz_organisation: Option<String>,
}

/// Höchstlänge des Namens in Zeichen (nicht in Bytes: „ä" zählt einmal).
pub const MAX_NAME_ZEICHEN: usize = 120;

/// Erlaubte DV-102-Organisationsschlüssel (taktische-zeichen-core).
const ERLAUBTE_ORG: &[&str] = &[
    "feuerwehr",
    "thw",
    "fuehrung",
    "polizei",
    "gefahrenabwehr",
    "hilfsorganisation",
    "bundeswehr",
    "zivil",
];

/// PATCH /api/organisation — Name und/oder Org-Default setzen. Nur Admin.
pub async fn aktualisieren(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    JsonBody(body): JsonBody<OrgPatch>,
) -> Result<Json<OrganisationAnzeige>, AppError> {
    // Ein Aufruf ohne jedes änderbare Feld ist für sich unbrauchbar → 400.
    if body.name.is_none() && body.tz_organisation.is_none() {
        return Err(AppError::Validation(
            "Kein änderbares Feld angegeben (name, tz_organisation)".into(),
        ));
    }
    // Erst ALLE Felder prüfen, dann schreiben: ein ungültiger Name neben einer gültigen
    // Vorgabe darf die Vorgabe nicht halb übernehmen.
    let name = match body.name.as_deref().map(str::trim) {
        None => None,
        Some("") => return Err(AppError::Validation("Name darf nicht leer sein".into())),
        Some(n) if n.chars().count() > MAX_NAME_ZEICHEN => {
            return Err(AppError::Validation(format!(
                "Name ist zu lang (höchstens {MAX_NAME_ZEICHEN} Zeichen)"
            )))
        }
        Some(n) => Some(n.to_string()),
    };
    // Allowlist-Prüfung eines Einzelfelds — enum-artig, scheitert am Feld selbst → 400
    // (LFH-305).
    if let Some(tz) = body.tz_organisation.as_deref() {
        if !ERLAUBTE_ORG.contains(&tz) {
            return Err(AppError::Validation("Unbekannte Organisation".into()));
        }
    }
    // Der Admin pflegt seine EIGENE Organisation (F05/LFH-232). Er ist zwar serverweit
    // berechtigt, aber „welche Org" darf nicht von der Zeilenreihenfolge abhängen.
    // `COALESCE` lässt ein nicht geliefertes Feld stehen (ein Statement, statisches SQL).
    sqlx::query(
        "UPDATE organisation SET name = COALESCE(?, name), \
         tz_organisation = COALESCE(?, tz_organisation) WHERE id = ?",
    )
    .bind(name)
    .bind(body.tz_organisation)
    .bind(benutzer.org_id)
    .execute(&state.pool)
    .await?;
    Ok(Json(lade_anzeige(&state.pool, benutzer.org_id).await?))
}

// --- Logo (LFH-22, design.md D8) ------------------------------------------------------
//
// Alle drei Routen lesen die Organisation aus `benutzer.org_id` (LFH-232) und nehmen
// keine Org-Kennung entgegen: ein Admin ändert immer nur das Logo seiner eigenen Org.

/// POST /api/organisation/logo — Logo setzen oder ersetzen. Nur Admin. Multipart-Feld
/// `datei`; PNG oder JPEG (am Inhalt erkannt), 1 Byte bis 1 MiB, vor dem Speichern
/// gescannt. Antwort: die `OrganisationAnzeige` mit dem neuen `logo` (200, ein Upsert).
pub async fn logo_hochladen(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    mut multipart: Multipart,
) -> Result<Json<OrganisationAnzeige>, AppError> {
    let mut bytes: Option<Vec<u8>> = None;
    while let Some(feld) = multipart
        .next_field()
        .await
        .map_err(|e| AppError::Validation(format!("Multipart-Fehler: {e}")))?
    {
        if feld.name() == Some("datei") {
            let b = feld
                .bytes()
                .await
                .map_err(|e| AppError::Validation(format!("Datei lesen fehlgeschlagen: {e}")))?;
            bytes = Some(b.to_vec());
        }
    }
    let bytes = bytes.ok_or_else(|| AppError::Validation("Keine Datei im Upload".into()))?;

    // Reihenfolge: leer/zu groß → Typ am Inhalt (SVG fällt hier durch) → Virenscan. Alles
    // vor dem Schreiben: ein abgelehnter Upload lässt das bisherige Logo stehen.
    logo::pruefe_groesse(bytes.len())?;
    let mime = crate::karte_hintergrundbild::erkenne_bild_mime(&bytes)?;
    crate::anhang::scan(crate::anhang::scan_config(), &bytes).await?;

    logo::setzen(&state.pool, benutzer.org_id, mime, &bytes, benutzer.id).await?;
    Ok(Json(lade_anzeige(&state.pool, benutzer.org_id).await?))
}

/// GET /api/organisation/logo — die Bytes des eigenen Logos. Jede angemeldete Person.
/// Erst die Metadaten ohne BLOB: passt `If-None-Match`, antwortet die Route 304 ohne den
/// BLOB zu lesen. Sonst Typ, Prüfsumme und Bytes in EINER Abfrage (`logo::inhalt`) — die
/// Kopfzeilen der Antwort kommen aus derselben Zeile wie die Bytes, auch wenn zwischen
/// beiden Abfragen ein Ersetzen lag. Kein Logo → 404.
pub async fn logo_lesen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    req_headers: HeaderMap,
) -> Result<Response, AppError> {
    let meta = logo::meta(&state.pool, benutzer.org_id)
        .await?
        .ok_or(AppError::NotFound)?;
    if if_none_match_matcht(&req_headers, &etag_von(&meta.sha256)) {
        return Ok((StatusCode::NOT_MODIFIED, logo_kopf(&meta.sha256)?).into_response());
    }

    // Zwischen Metadaten und Inhalt kann ein paralleles DELETE liegen → dann 404.
    let inhalt = logo::inhalt(&state.pool, benutzer.org_id)
        .await?
        .ok_or(AppError::NotFound)?;
    let mut headers = logo_kopf(&inhalt.sha256)?;
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_str(&inhalt.mime)
            .map_err(|e| AppError::Internal(format!("Ungültiger Content-Type: {e}")))?,
    );
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    Ok((headers, inhalt.daten).into_response())
}

/// ETag und `Cache-Control` des Logo-Abrufs — für 304 und 200 aus derselben Prüfsumme.
fn logo_kopf(sha256: &str) -> Result<HeaderMap, AppError> {
    let mut headers = HeaderMap::new();
    headers.insert(
        header::ETAG,
        HeaderValue::from_str(&etag_von(sha256))
            .map_err(|e| AppError::Internal(format!("Ungültiger ETag: {e}")))?,
    );
    headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static(logo::CACHE_CONTROL),
    );
    Ok(headers)
}

/// DELETE /api/organisation/logo — Logo entfernen. Nur Admin. 204, auch ohne Logo.
pub async fn logo_entfernen(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
) -> Result<StatusCode, AppError> {
    logo::entfernen(&state.pool, benutzer.org_id).await?;
    Ok(StatusCode::NO_CONTENT)
}
