use crate::app::AppState;
use crate::auth::session::{AdminUser, CurrentUser};
use crate::config::{default_online_styles, OnlineStyle};
use crate::error::AppError;
use crate::karte::quellen;
use crate::karte::registry::repo::{
    self, OfflineKarte, OfflineKarteEingabe, OnlineQuelle, OnlineQuelleEingabe,
};
use axum::body::Body;
use axum::extract::{Path, Query, State};
use axum::http::{Request, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Component, Path as FsPath};
use tower::ServiceExt; // oneshot
use tower_http::services::ServeFile;

/// Antwort von `GET /api/karte/config`. Liefert NUR, was die Karte zur Laufzeit braucht —
/// NICHT den Server-Dateipfad der PMTiles-Datei. Shape ist eingefroren (Frontend-Vertrag,
/// `frontend/src/api/karte.ts`); nur die Datenquelle wechselte von ENV/Extension auf die DB.
#[derive(Debug, Serialize)]
pub struct KarteConfigAntwort {
    pub online_styles: Vec<OnlineStyle>,
    pub pmtiles_verfuegbar: bool,
    /// Relative URL des Tile-Endpoints, wenn eine aktive Offline-Karte ausliefer-bereit ist.
    pub pmtiles_url: Option<String>,
}

/// GET /api/karte/config — Basemap-Verfügbarkeit fürs Frontend, frisch aus der DB-Registry.
pub async fn config(State(state): State<AppState>) -> Result<Json<KarteConfigAntwort>, AppError> {
    let online_styles = repo::aktive_online_styles(&state.pool).await?;
    let pmtiles_verfuegbar = repo::pmtiles_verfuegbar(&state.pool).await?;
    Ok(Json(KarteConfigAntwort {
        online_styles,
        pmtiles_verfuegbar,
        pmtiles_url: pmtiles_verfuegbar.then(|| "/api/karte/tiles.pmtiles".to_string()),
    }))
}

/// GET /api/karte/tiles.pmtiles — liefert die aktive Offline-Karte per HTTP-Range aus.
///
/// Der Pfad kommt zur Laufzeit aus der DB (nicht mehr zur Router-Bauzeit). Die Byte-/Range-/206-
/// Mechanik bleibt vollständig bei `tower_http::ServeFile` (per-Request `oneshot`) — derselbe
/// Service wie zuvor, nur mit dynamisch aufgelöstem Pfad. `Request` ist der letzte, body-
/// konsumierende Extractor; `State` davor ist zulässig.
pub async fn tiles(State(state): State<AppState>, req: Request<Body>) -> Result<Response, AppError> {
    let Some(pfad) = repo::aktive_offline_karte_pfad(&state.pool).await? else {
        return Ok(StatusCode::NOT_FOUND.into_response());
    };

    // Nur relative Pfade im verwalteten karten_dir ausliefern. Absolute Pfade und ..-Traversal →
    // 404 (kein Info-Leak am unauthentifizierten Endpunkt). Böse Pfade werden zwar schon bei der
    // Registrierung abgelehnt; dieser Guard ist Defense-in-Depth gegen Alt-/Fremddaten in der DB.
    let p = FsPath::new(&pfad);
    if p.is_absolute() || p.components().any(|c| matches!(c, Component::ParentDir)) {
        return Ok(StatusCode::NOT_FOUND.into_response());
    }
    let voll = state.karten_dir.join(p);
    // Containment via canonicalize fängt zusätzlich Symlinks: der reale Zielpfad MUSS unter dem
    // realen karten_dir liegen, sonst keine Auslieferung (z.B. ein Symlink aus dem Verzeichnis heraus).
    let basis = state
        .karten_dir
        .canonicalize()
        .map_err(|e| AppError::Internal(format!("karten_dir nicht auflösbar: {e}")))?;
    let real = match voll.canonicalize() {
        Ok(r) if r.starts_with(&basis) => r,
        _ => return Ok(StatusCode::NOT_FOUND.into_response()),
    };

    let antwort = ServeFile::new(real)
        .oneshot(req)
        .await
        .map_err(|e| AppError::Internal(format!("Tile-Auslieferung fehlgeschlagen: {e}")))?;
    Ok(antwort.map(Body::new).into_response())
}

/// GET /api/karte/fachebenen/{quelle} — externe Lagedaten als GeoJSON-Umschlag.
pub async fn fachebenen(
    State(state): State<AppState>,
    Path(quelle): Path<String>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<Json<crate::karte::typen::FachebeneAntwort>, AppError> {
    let bbox = params.get("bbox").map(|s| s.as_str());
    let antwort = match quelle.as_str() {
        "dwd" => quellen::fetch_dwd(&state.fachebenen, &state.pool).await,
        "pegelonline" => quellen::fetch_pegelonline(&state.fachebenen, &state.pool).await,
        "nina" => quellen::fetch_nina(&state.fachebenen, &state.pool).await,
        "kritis" => {
            let bbox =
                bbox.ok_or_else(|| AppError::Validation("bbox-Parameter erforderlich".into()))?;
            quellen::fetch_kritis(&state.fachebenen, &state.pool, bbox).await?
        }
        _ => return Err(AppError::Validation(format!("Unbekannte Quelle: {quelle}"))),
    };
    Ok(Json(antwort))
}

// ===== Admin-CRUD der Karten-Registry (alle hinter AdminUser) =====

fn default_aktiv() -> bool {
    true
}

/// Request-Body zum Anlegen/Aktualisieren einer Online-Quelle.
#[derive(Debug, Deserialize)]
pub struct OnlineQuelleBody {
    pub name: String,
    pub url: String,
    pub typ: String,
    pub attribution: Option<String>,
    #[serde(default)]
    pub sortier: i64,
    #[serde(default = "default_aktiv")]
    pub aktiv: bool,
}

/// Request-Body zum Registrieren einer Offline-Karte (Grundstein: vorhandene Datei).
#[derive(Debug, Deserialize)]
pub struct OfflineKarteBody {
    pub name: String,
    pub pfad: String,
    pub quell_url: Option<String>,
    pub lizenz: Option<String>,
    pub kachel_schema: Option<String>,
    #[serde(default)]
    pub sortier: i64,
}

/// Validiert + normalisiert einen Online-Quelle-Body (Anlegen wie Vollersatz-PATCH teilen das).
/// Name/URL nicht leer (getrimmt), `typ ∈ {vektor,raster}`, **Attribution Pflicht** (Lizenzauflage).
fn validiere_online(body: OnlineQuelleBody) -> Result<OnlineQuelleEingabe, AppError> {
    let name = body.name.trim();
    if name.is_empty() {
        return Err(AppError::Validation("Name darf nicht leer sein".into()));
    }
    let url = body.url.trim();
    if url.is_empty() {
        return Err(AppError::Validation("URL darf nicht leer sein".into()));
    }
    if body.typ != "vektor" && body.typ != "raster" {
        return Err(AppError::Validation(
            "Typ muss 'vektor' oder 'raster' sein".into(),
        ));
    }
    let attribution = body
        .attribution
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| {
            AppError::Validation("Attribution ist Pflicht (Lizenzauflage)".into())
        })?
        .to_string();
    Ok(OnlineQuelleEingabe {
        name: name.to_string(),
        url: url.to_string(),
        typ: body.typ,
        attribution: Some(attribution),
        sortier: body.sortier,
        aktiv: body.aktiv,
    })
}

/// GET /api/karte/online-quellen — alle Online-Quellen. Lesen: admin ODER Führungskraft
/// (read-only), Muster wie `org_einstellungen` — Schreiben bleibt admin-only.
pub async fn online_liste(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
) -> Result<Json<Vec<OnlineQuelle>>, AppError> {
    if !benutzer.darf_admin_bereich() {
        return Err(AppError::Forbidden);
    }
    Ok(Json(repo::liste_online_quellen(&state.pool).await?))
}

/// POST /api/karte/online-quellen — neue Online-Quelle anlegen (Admin).
pub async fn online_anlegen(
    State(state): State<AppState>,
    _admin: AdminUser,
    Json(body): Json<OnlineQuelleBody>,
) -> Result<(StatusCode, Json<OnlineQuelle>), AppError> {
    let eingabe = validiere_online(body)?;
    let quelle = repo::anlegen_online_quelle(&state.pool, &eingabe).await?;
    Ok((StatusCode::CREATED, Json(quelle)))
}

/// GET /api/karte/online-quellen/katalog — kuratierter Vorschlagskatalog (eingebaute Shortlist).
pub async fn online_katalog(_admin: AdminUser) -> Result<Json<Vec<OnlineStyle>>, AppError> {
    Ok(Json(default_online_styles()))
}

/// PATCH /api/karte/online-quellen/{id} — Online-Quelle vollständig aktualisieren (Admin).
pub async fn online_aktualisieren(
    State(state): State<AppState>,
    _admin: AdminUser,
    Path(id): Path<i64>,
    Json(body): Json<OnlineQuelleBody>,
) -> Result<Json<OnlineQuelle>, AppError> {
    let eingabe = validiere_online(body)?;
    repo::aktualisiere_online_quelle(&state.pool, id, &eingabe)
        .await?
        .map(Json)
        .ok_or(AppError::NotFound)
}

/// DELETE /api/karte/online-quellen/{id} — Online-Quelle löschen (Admin).
pub async fn online_loeschen(
    State(state): State<AppState>,
    _admin: AdminUser,
    Path(id): Path<i64>,
) -> Result<StatusCode, AppError> {
    if repo::loesche_online_quelle(&state.pool, id).await? {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(AppError::NotFound)
    }
}

/// GET /api/karte/offline-karten — alle Offline-Karten. Lesen: admin ODER Führungskraft (read-only).
pub async fn offline_liste(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
) -> Result<Json<Vec<OfflineKarte>>, AppError> {
    if !benutzer.darf_admin_bereich() {
        return Err(AppError::Forbidden);
    }
    Ok(Json(repo::liste_offline_karten(&state.pool).await?))
}

/// POST /api/karte/offline-karten — vorhandene Offline-Karte registrieren (Admin).
pub async fn offline_registrieren(
    State(state): State<AppState>,
    _admin: AdminUser,
    Json(body): Json<OfflineKarteBody>,
) -> Result<(StatusCode, Json<OfflineKarte>), AppError> {
    let name = body.name.trim();
    if name.is_empty() {
        return Err(AppError::Validation("Name darf nicht leer sein".into()));
    }
    let pfad = body.pfad.trim();
    if pfad.is_empty() {
        return Err(AppError::Validation("Pfad darf nicht leer sein".into()));
    }
    // Pfade müssen relativ zum verwalteten karten_dir sein. Absolute/Traversal-Pfade würden über
    // den unauthentifizierten Tile-Endpunkt beliebige Server-Dateien exponieren → ablehnen.
    let pfad_geprueft = FsPath::new(pfad);
    if pfad_geprueft.is_absolute()
        || pfad_geprueft
            .components()
            .any(|c| matches!(c, Component::ParentDir))
    {
        return Err(AppError::Validation(
            "Kartenpfad muss relativ und ohne '..' sein".into(),
        ));
    }
    // Kachel-Schema ist erweiterbar; ohne Angabe gilt der Protomaps-Default (Migration-Default).
    let kachel_schema = body
        .kachel_schema
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("protomaps")
        .to_string();
    let eingabe = OfflineKarteEingabe {
        name: name.to_string(),
        pfad: pfad.to_string(),
        quell_url: body.quell_url,
        lizenz: body.lizenz,
        kachel_schema,
        sortier: body.sortier,
    };
    let karte = repo::registriere_offline_karte(&state.pool, &eingabe).await?;
    Ok((StatusCode::CREATED, Json(karte)))
}

/// POST /api/karte/offline-karten/{id}/aktivieren — als aktive Basemap setzen (Admin).
pub async fn offline_aktivieren(
    State(state): State<AppState>,
    _admin: AdminUser,
    Path(id): Path<i64>,
) -> Result<Json<OfflineKarte>, AppError> {
    repo::aktiviere_offline_karte(&state.pool, id)
        .await?
        .map(Json)
        .ok_or(AppError::NotFound)
}

/// DELETE /api/karte/offline-karten/{id} — Offline-Karte löschen (Admin).
pub async fn offline_loeschen(
    State(state): State<AppState>,
    _admin: AdminUser,
    Path(id): Path<i64>,
) -> Result<StatusCode, AppError> {
    if repo::loesche_offline_karte(&state.pool, id).await? {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(AppError::NotFound)
    }
}
