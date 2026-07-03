use crate::app::AppState;
use crate::auth::session::{AdminUser, CurrentUser};
use crate::config::{
    default_offline_katalog, default_online_styles, OfflineKatalogEintrag, OnlineStyle,
    OnlineStyleTyp,
};
use crate::error::AppError;
use crate::karte::download::{self, Fortschritt};
use crate::karte::proxy;
use crate::karte::quellen;
use crate::karte::tile_cache;
use crate::karte::registry::repo::{
    self, OfflineKarte, OfflineKarteEingabe, OnlineQuelle, OnlineQuelleEingabe,
};
use axum::body::Body;
use axum::extract::{Path, Query, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Component, Path as FsPath};
use std::sync::atomic::Ordering;
use std::sync::Arc;

/// Antwort von `GET /api/karte/config`. Liefert NUR, was die Karte zur Laufzeit braucht —
/// NICHT den Server-Dateipfad der Offline-Kartendatei. Shape ist eingefroren (Frontend-Vertrag,
/// `frontend/src/api/karte.ts`); nur die Datenquelle wechselte von ENV/Extension auf die DB.
#[derive(Debug, Serialize)]
pub struct KarteConfigAntwort {
    pub online_styles: Vec<OnlineStyle>,
    pub offline_verfuegbar: bool,
    /// Tile-Endpoint-Template der aktiven Offline-Karte inkl. Cache-Bust `?v=<token>`.
    /// Der Token wechselt bei Karten-Swap, sonst cacht MapLibre den alten Tile-Aufbau unter
    /// gleicher URL → korrupte Tiles.
    pub offline_tiles_url: Option<String>,
    /// Pflicht-Attribution der aktiven Offline-Karte (offline sichtbar, z.B. ODbL). `None`,
    /// wenn keine aktive Karte oder keine Lizenz hinterlegt ist.
    pub offline_attribution: Option<String>,
}

/// GET /api/karte/config — Basemap-Verfügbarkeit fürs Frontend, frisch aus der DB-Registry.
pub async fn config(State(state): State<AppState>) -> Result<Json<KarteConfigAntwort>, AppError> {
    // Proxied Quellen (proxy=1) bekommen relative /api/karte/proxy/...-URLs; die Upstream-`url`
    // (inkl. Key) verlässt den Server NIE über diesen öffentlichen Endpunkt. Direkte Quellen
    // (proxy=0) werden unverändert ausgeliefert (Browser lädt sie selbst).
    let online_styles: Vec<OnlineStyle> = repo::aktive_online_quellen_fuer_config(&state.pool)
        .await?
        .into_iter()
        .map(|q| {
            let typ = match q.typ.as_str() {
                "raster" => OnlineStyleTyp::Raster,
                _ => OnlineStyleTyp::Vektor,
            };
            let url = if q.proxy {
                proxy::proxy_config_url(q.id, &typ)
            } else {
                q.url
            };
            OnlineStyle {
                name: q.name,
                url,
                typ,
                attribution: q.attribution,
            }
        })
        .collect();
    let aktiv = repo::aktive_offline_karte(&state.pool).await?;
    let (offline_tiles_url, offline_attribution) = match &aktiv {
        Some(k) => {
            // Cache-Bust-Token URL-safe halten (geaendert_at enthält Leerzeichen/Doppelpunkte).
            let v: String = k.version.chars().filter(|c| c.is_ascii_alphanumeric()).collect();
            (
                Some(format!("/api/karte/offline/tiles/{{z}}/{{x}}/{{y}}?v={v}")),
                k.lizenz.clone(),
            )
        }
        None => (None, None),
    };
    Ok(Json(KarteConfigAntwort {
        online_styles,
        offline_verfuegbar: aktiv.is_some(),
        offline_tiles_url,
        offline_attribution,
    }))
}

/// GET /api/karte/offline/tiles/{z}/{x}/{y} — Vektor-Kachel der aktiven Offline-MBTiles.
/// Öffnet die aktive Datei read-only (gecacht per Pfad in mbtiles::reader_fuer), Y-Flip + gzip in mbtiles.rs.
pub async fn offline_tiles(
    State(state): State<AppState>,
    Path((z, x, y)): Path<(i64, i64, i64)>,
) -> Result<Response, AppError> {
    use crate::karte::mbtiles;
    // Range-Guard VOR jedem Datei-/DB-Zugriff: z/x/y kommen roh (netzwerk-kontrolliert) aus der
    // URL. `lies_tile` shiftet `1i64 << z` für den TMS-Y-Flip — ein absurdes z (negativ oder
    // > 24) würde im Debug-Build panicken bzw. im Release-Build maskiert überlaufen. Kein valider
    // XYZ-Zoom liegt außerhalb von 0..=24.
    if !(0..=24).contains(&z) || x < 0 || y < 0 {
        return Ok(StatusCode::NO_CONTENT.into_response());
    }
    let Some(pfad_rel) = repo::aktive_offline_karte_pfad(&state.pool).await? else {
        return Ok(StatusCode::NO_CONTENT.into_response());
    };
    // Pfad-Guard analog zum bisherigen tiles-Handler (relativ, kein Traversal).
    let p = FsPath::new(&pfad_rel);
    if p.is_absolute() || p.components().any(|c| matches!(c, Component::ParentDir)) {
        return Ok(StatusCode::NO_CONTENT.into_response());
    }
    let voll = state.karten_dir.join(p);
    // Containment via canonicalize fängt zusätzlich Symlinks: der reale Zielpfad MUSS unter dem
    // realen karten_dir liegen, sonst keine Auslieferung (Parität zum `tiles`-Handler,
    // Defense-in-Depth gegen einen Symlink auf eine fremde SQLite-Datei → kein Blob-Leak).
    let basis = state
        .karten_dir
        .canonicalize()
        .map_err(|e| AppError::Internal(format!("karten_dir nicht auflösbar: {e}")))?;
    let real = match voll.canonicalize() {
        Ok(r) if r.starts_with(&basis) => r,
        _ => return Ok(StatusCode::NO_CONTENT.into_response()),
    };
    let pool = mbtiles::reader_fuer(&real)
        .await
        .map_err(|e| AppError::Internal(format!("MBTiles öffnen: {e}")))?;
    match mbtiles::lies_tile(&pool, z, x, y).await {
        Ok(Some(daten)) => Ok(Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, "application/x-protobuf")
            .header(header::CONTENT_ENCODING, "gzip")
            .header(header::CACHE_CONTROL, "public, max-age=86400")
            .body(Body::from(daten))
            .unwrap()),
        Ok(None) => Ok(StatusCode::NO_CONTENT.into_response()),
        Err(e) => Err(AppError::Internal(format!("Tile lesen: {e}"))),
    }
}

/// Hex-kodiert die ersten 16 Bytes (128 Bit reichen als ETag) eines Hashes.
fn hex_kurz(bytes: &[u8]) -> String {
    bytes.iter().take(16).map(|b| format!("{b:02x}")).collect()
}

/// Baut die Antwort für ein eingebettetes Offline-Asset (Glyphs/Sprite) oder `404`, wenn es
/// unter `pfad` nicht in `KartenAssets` liegt.
///
/// Cache (LFH-198): die Asset-URLs sind versionslos (`fonts/{stack}/{range}.pbf`,
/// `sprites/basemap…`). Ein langes `max-age` würde Clients nach einem Placeholder→real-Asset-Swap
/// (neues Binary, gleiche URL) bis zu einer Woche stale cachen lassen. Stattdessen ein
/// content-abhängiger, starker `ETag` (rust-embed liefert den sha256 der eingebetteten Datei zur
/// Compile-Zeit) + `Cache-Control: no-cache`: der Client darf cachen, MUSS aber bei jedem Load
/// revalidieren → `304`, solange das Asset gleich ist; frische Bytes, sobald es sich ändert.
fn embedded_antwort(pfad: &str, content_type: &str, if_none_match: Option<&str>) -> Response {
    let Some(f) = crate::karte::assets::KartenAssets::get(pfad) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let etag = format!("\"{}\"", hex_kurz(&f.metadata.sha256_hash()));
    if if_none_match == Some(etag.as_str()) {
        return Response::builder()
            .status(StatusCode::NOT_MODIFIED)
            .header(header::ETAG, &etag)
            .header(header::CACHE_CONTROL, "no-cache")
            .body(Body::empty())
            .unwrap();
    }
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::CACHE_CONTROL, "no-cache")
        .header(header::ETAG, &etag)
        .body(Body::from(f.data.into_owned()))
        .unwrap()
}

/// Liest den `If-None-Match`-Header (für die Conditional-Requests der eingebetteten Assets).
fn if_none_match(headers: &HeaderMap) -> Option<&str> {
    headers.get(header::IF_NONE_MATCH).and_then(|v| v.to_str().ok())
}

/// GET /api/karte/offline/fonts/{fontstack}/{datei} — eingebettete SDF-Glyphs (OFL).
/// `{datei}` = `<range>.pbf` (z. B. `0-255.pbf`), so wie MapLibres glyphs-Template es anfragt.
pub async fn offline_fonts(
    headers: HeaderMap,
    Path((fontstack, datei)): Path<(String, String)>,
) -> Response {
    // `.pbf` abstreifen: validiere_range erwartet `<int>-<int>` OHNE Suffix (src/karte/proxy.rs).
    let Some(range) = datei.strip_suffix(".pbf") else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    // Proxy-Validatoren gegen Path-Traversal wiederverwenden.
    if proxy::validiere_fontstack(&fontstack).is_err() || proxy::validiere_range(range).is_err() {
        return StatusCode::BAD_REQUEST.into_response();
    }
    embedded_antwort(
        &format!("fonts/{fontstack}/{datei}"),
        "application/x-protobuf",
        if_none_match(&headers),
    )
}

/// GET /api/karte/offline/sprites/{datei} — eingebettetes Sprite (png/json, +@2x).
pub async fn offline_sprite(headers: HeaderMap, Path(datei): Path<String>) -> Response {
    // Nur bekannte Basisnamen zulassen (kein Traversal).
    let ct = if datei.ends_with(".png") {
        "image/png"
    } else if datei.ends_with(".json") {
        "application/json"
    } else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    if datei.contains('/') || datei.contains("..") {
        return StatusCode::BAD_REQUEST.into_response();
    }
    embedded_antwort(&format!("sprites/{datei}"), ct, if_none_match(&headers))
}

#[cfg(test)]
mod offline_assets_tests {
    use super::*;

    #[tokio::test]
    async fn offline_fonts_lehnt_bad_range_ab() {
        // Handler direkt aufrufen (kein Server nötig): Path ist ein Tuple-Wrapper.
        let r = offline_fonts(
            HeaderMap::new(),
            axum::extract::Path(("Noto Sans Regular".into(), "boese.pbf".into())),
        )
        .await;
        assert_eq!(r.status(), StatusCode::BAD_REQUEST);
        // Ohne .pbf-Suffix ebenfalls ablehnen.
        let r2 = offline_fonts(
            HeaderMap::new(),
            axum::extract::Path(("Noto Sans Regular".into(), "0-255".into())),
        )
        .await;
        assert_eq!(r2.status(), StatusCode::BAD_REQUEST);
    }

    // Positivpfad Glyphs: gültiger Fontstack (mit Leerzeichen) + Range → eingebettetes .pbf als
    // application/x-protobuf. Cache-Header bewusst nicht geprüft (siehe embedded_antwort-Tests).
    #[tokio::test]
    async fn offline_fonts_liefert_eingebettetes_pbf() {
        let r = offline_fonts(
            HeaderMap::new(),
            axum::extract::Path(("Noto Sans Regular".into(), "0-255.pbf".into())),
        )
        .await;
        assert_eq!(r.status(), StatusCode::OK);
        assert_eq!(
            r.headers().get(header::CONTENT_TYPE).unwrap(),
            "application/x-protobuf"
        );
    }

    // Positivpfad Sprite: .json → application/json, .png → image/png.
    #[tokio::test]
    async fn offline_sprite_liefert_json_und_png() {
        let j = offline_sprite(HeaderMap::new(), axum::extract::Path("basemap.json".into())).await;
        assert_eq!(j.status(), StatusCode::OK);
        assert_eq!(j.headers().get(header::CONTENT_TYPE).unwrap(), "application/json");
        let p = offline_sprite(HeaderMap::new(), axum::extract::Path("basemap.png".into())).await;
        assert_eq!(p.status(), StatusCode::OK);
        assert_eq!(p.headers().get(header::CONTENT_TYPE).unwrap(), "image/png");
    }

    // Sprite-Guards: unbekannte Endung → 400, Traversal → 400.
    #[tokio::test]
    async fn offline_sprite_lehnt_fremde_endung_und_traversal_ab() {
        assert_eq!(
            offline_sprite(HeaderMap::new(), axum::extract::Path("basemap.txt".into()))
                .await
                .status(),
            StatusCode::BAD_REQUEST
        );
        assert_eq!(
            offline_sprite(HeaderMap::new(), axum::extract::Path("../geheim.png".into()))
                .await
                .status(),
            StatusCode::BAD_REQUEST
        );
    }

    // A2 (LFH-198): eingebettete Assets tragen versionslose URLs. Statt 1-Woche-max-age (der beim
    // Placeholder→real-Asset-Swap bis 7 Tage stale cachen würde) → content-abhängiger ETag +
    // `no-cache` (Client cacht, revalidiert aber). Kein Staleness nach einem Binary-Update.
    #[test]
    fn embedded_antwort_setzt_etag_und_no_cache() {
        let r = embedded_antwort("sprites/basemap.json", "application/json", None);
        assert_eq!(r.status(), StatusCode::OK);
        assert_eq!(r.headers().get(header::CACHE_CONTROL).unwrap(), "no-cache");
        assert!(r.headers().get(header::ETAG).is_some(), "ETag gesetzt");
    }

    // Passendes If-None-Match → 304 (kein Body neu übertragen), ETag weiterhin gesetzt.
    #[test]
    fn embedded_antwort_304_bei_passendem_if_none_match() {
        let etag = embedded_antwort("sprites/basemap.json", "application/json", None)
            .headers()
            .get(header::ETAG)
            .unwrap()
            .to_str()
            .unwrap()
            .to_string();
        let r = embedded_antwort("sprites/basemap.json", "application/json", Some(&etag));
        assert_eq!(r.status(), StatusCode::NOT_MODIFIED);
        assert_eq!(r.headers().get(header::ETAG).unwrap(), &etag);
    }

    // Nicht-passender ETag → normale 200-Auslieferung.
    #[test]
    fn embedded_antwort_200_bei_fremdem_if_none_match() {
        let r = embedded_antwort("sprites/basemap.json", "application/json", Some("\"veraltet\""));
        assert_eq!(r.status(), StatusCode::OK);
    }
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

/// Proxy ist Default-an (LFH-190): neue Quellen werden serverseitig geproxt + gecacht. Abschaltbar
/// pro Quelle (manche Anbieter, z. B. OSM-Standard-Tiles, verbieten Proxying/Caching).
fn default_proxy() -> bool {
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
    /// Serverseitig proxen + cachen (LFH-182/190). Default **true** (Weglassen ⇒ proxen);
    /// abschaltbar pro Quelle für proxy-verbotene Anbieter.
    #[serde(default = "default_proxy")]
    pub proxy: bool,
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
    let proxy_effektiv = body.proxy;
    // Proxied Quellen (key-basiert): URL roh speichern (kein Url-Roundtrip — würde `{}`
    // percent-kodieren), aber vorab validieren: nur unterstützte Platzhalter, und SSRF-Check auf
    // einer materialisierten Probe (Platzhalter durch 0/Dummy ersetzt). Direkte Quellen (proxy=0)
    // bleiben unverändert: der Browser lädt sie selbst, keine Server-seitige Prüfung nötig.
    if proxy_effektiv {
        let unbekannt = proxy::unbekannte_platzhalter(url);
        if !unbekannt.is_empty() {
            return Err(AppError::Validation(format!(
                "Nicht unterstützte Platzhalter in der Proxy-URL: {}",
                unbekannt.join(", ")
            )));
        }
        let probe = proxy::subst_template(&proxy::subst_glyphs(url, "a", "0-0"), 0, 0, 0);
        let parsed = reqwest::Url::parse(&probe)
            .map_err(|e| AppError::Validation(format!("Ungültige Proxy-URL: {e}")))?;
        download::url_ist_sicher(&parsed).map_err(AppError::Validation)?;
    }
    Ok(OnlineQuelleEingabe {
        name: name.to_string(),
        url: url.to_string(),
        typ: body.typ,
        attribution: Some(attribution),
        sortier: body.sortier,
        aktiv: body.aktiv,
        proxy: proxy_effektiv,
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
    let mut quellen = repo::liste_online_quellen(&state.pool).await?;
    // darf_admin_bereich() schließt Führungskräfte (read-only) ein. Die Upstream-`url` einer
    // proxied Quelle enthält den Key → nur dem echten Admin (der sie eingegeben hat) im Klartext
    // zeigen, für alle anderen maskieren.
    if !benutzer.ist_admin() {
        for q in &mut quellen {
            if q.proxy {
                q.url = "***".into();
            }
        }
    }
    Ok(Json(quellen))
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
    let aktualisiert = repo::aktualisiere_online_quelle(&state.pool, id, &eingabe).await?;
    if aktualisiert.is_some() {
        // URL kann sich geändert haben → alte Proxy-Slots sind stale und müssen weg.
        repo::slots_loeschen(&state.pool, id).await?;
    }
    aktualisiert.map(Json).ok_or(AppError::NotFound)
}

/// DELETE /api/karte/online-quellen/{id} — Online-Quelle löschen (Admin).
pub async fn online_loeschen(
    State(state): State<AppState>,
    _admin: AdminUser,
    Path(id): Path<i64>,
) -> Result<StatusCode, AppError> {
    if repo::loesche_online_quelle(&state.pool, id).await? {
        // Verwaiste Proxy-Slots explizit entfernen (zusätzlich zu ON DELETE CASCADE, dessen
        // Enforcement in SQLite PRAGMA-abhängig ist).
        repo::slots_loeschen(&state.pool, id).await?;
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(AppError::NotFound)
    }
}

/// GET /api/karte/offline-karten — alle Offline-Karten. Lesen: admin ODER Führungskraft (read-only).
/// Listen-Antwort = DB-Zeile + Live-Download-Fortschritt. `geladen`/`gesamt` (Bytes) kommen nur
/// für `status='laedt'` aus dem transienten In-Memory-State (keine DB-Spalte); `gesamt` ist
/// `null`, wenn die Quelle keine Content-Length lieferte. Das Frontend rendert daraus den
/// Fortschrittsbalken.
#[derive(Debug, Serialize)]
pub struct OfflineKarteAntwort {
    #[serde(flatten)]
    pub karte: OfflineKarte,
    pub geladen: Option<i64>,
    pub gesamt: Option<i64>,
    /// True, wenn der Katalog für DIESELBE Karte (über den Namen) inzwischen eine ANDERE (neuere)
    /// Quell-URL führt als die installierte `quell_url` → im UI „Update verfügbar". Offline-Check
    /// (rein gegen den eingebauten Katalog, kein Netz). Lädt der Katalog/Mirror einen neueren
    /// Stand (anderes Datum in der URL), wird das hier automatisch sichtbar.
    pub update_verfuegbar: bool,
    /// Aktuelle Katalog-URL dieser Karte, wenn ein Update verfügbar ist (für den Re-Download).
    pub katalog_url: Option<String>,
    /// SHA256-Pin der aktuellen Katalog-URL (für den verifizierten Re-Download beim Update).
    pub katalog_sha256: Option<String>,
}

/// GET /api/karte/offline-karten — alle Offline-Karten. Lesen: admin ODER Führungskraft (read-only).
pub async fn offline_liste(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
) -> Result<Json<Vec<OfflineKarteAntwort>>, AppError> {
    if !benutzer.darf_admin_bereich() {
        return Err(AppError::Forbidden);
    }
    let rows = repo::liste_offline_karten(&state.pool).await?;
    let katalog = default_offline_katalog();
    // Ladende Karten mit Live-Bytes aus dem In-Memory-Fortschritt anreichern (kein await unter
    // dem Lock).
    let map = state.download_fortschritt.read().unwrap();
    let antwort: Vec<OfflineKarteAntwort> = rows
        .into_iter()
        .map(|k| {
            let (geladen, gesamt) = if k.status == "laedt" {
                match map.get(&k.id) {
                    Some(f) => {
                        let g = f.gesamt.load(Ordering::Relaxed);
                        (
                            Some(f.geladen.load(Ordering::Relaxed) as i64),
                            (g > 0).then_some(g as i64),
                        )
                    }
                    None => (None, None),
                }
            } else {
                (None, None)
            };
            // Update-Erkennung: gleicher Karten-Name, aber der Katalog führt eine andere URL als
            // die installierte Quelle (= neuerer Build). Karten ohne quell_url / ohne Katalog-Treffer
            // (z.B. eigene URL) gelten als aktuell.
            let neuere = k
                .quell_url
                .as_ref()
                .and_then(|qu| katalog.iter().find(|e| e.name == k.name && &e.url != qu));
            OfflineKarteAntwort {
                karte: k,
                geladen,
                gesamt,
                update_verfuegbar: neuere.is_some(),
                katalog_url: neuere.map(|e| e.url.clone()),
                katalog_sha256: neuere.and_then(|e| e.sha256.clone()),
            }
        })
        .collect();
    drop(map);
    Ok(Json(antwort))
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
    // Attribution ist Pflicht — Parität zu offline_download/validiere_online. Die Offline-Basemap
    // rendert sie quellen-unabhängig (config.offline_attribution); ohne Lizenz würde eine
    // aktivierte registrierte Karte offline ohne Pflicht-Attribution gezeigt (Lizenzverstoß).
    let lizenz = body
        .lizenz
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| AppError::Validation("Lizenz/Attribution ist Pflicht (offline sichtbar)".into()))?
        .to_string();
    // Kachel-Schema ist erweiterbar; ohne Angabe gilt der Shortbread-Default (Migration-Default).
    let kachel_schema = body
        .kachel_schema
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("shortbread")
        .to_string();
    let eingabe = OfflineKarteEingabe {
        name: name.to_string(),
        pfad: pfad.to_string(),
        quell_url: body.quell_url,
        lizenz: Some(lizenz),
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
///
/// Entfernt zusätzlich die vom Download-Manager VERWALTETE Datei (`karte-{id}.mbtiles` + evtl.
/// `.part`), sonst leckt jeder Download→Löschen-Zyklus mehrere GB. Extern registrierte Karten
/// (beliebiger admin-gelieferter Pfad) werden bewusst NICHT von der Platte gelöscht.
pub async fn offline_loeschen(
    State(state): State<AppState>,
    _admin: AdminUser,
    Path(id): Path<i64>,
) -> Result<StatusCode, AppError> {
    // Zeile vor dem DB-Delete lesen, um gemanagte Downloads von extern Registrierten zu trennen.
    let karte = repo::finde_offline_karte(&state.pool, id).await?;
    if !repo::loesche_offline_karte(&state.pool, id).await? {
        return Err(AppError::NotFound);
    }
    if let Some(k) = karte {
        // Gemanagt = von uns heruntergeladen: download_at gesetzt, Pfad-Platzhalter (Download lief
        // bzw. scheiterte vor markiere_bereit) oder der abgeleitete Download-Dateiname.
        let ist_gemanagt =
            k.download_at.is_some() || k.pfad.is_empty() || k.pfad == format!("karte-{id}.mbtiles");
        if ist_gemanagt {
            download::entferne_download_dateien(&state.karten_dir, id).await;
            // Reader-Cache ist NUR nach Pfad gekeyt: ein Neu-Download kann denselben Pfad
            // (`karte-{id}.mbtiles`, rowid-Wiederverwendung ohne AUTOINCREMENT) bei neuer Inode
            // erhalten — ohne Invalidierung würde der alte, gecachte Reader (Datei-Handle auf die
            // entlinkte Datei) weiterservieren.
            crate::karte::mbtiles::invalidate_reader().await;
        }
    }
    Ok(StatusCode::NO_CONTENT)
}

// ===== Offline-Karten-Download-Manager (LFH-181) =====

/// GET /api/karte/offline-karten/katalog — kuratierter Download-Vorschlagskatalog (Admin).
pub async fn offline_katalog(
    _admin: AdminUser,
) -> Result<Json<Vec<OfflineKatalogEintrag>>, AppError> {
    Ok(Json(default_offline_katalog()))
}

/// Request-Body zum Starten eines Offline-Karten-Downloads (aus Katalog oder eigener URL).
#[derive(Debug, Deserialize)]
pub struct OfflineDownloadBody {
    pub name: String,
    pub url: String,
    pub lizenz: String,
    pub kachel_schema: Option<String>,
    /// Erwartete Größe (Bytes) aus dem Katalog — für den Plattenplatz-Check vorab.
    #[serde(default)]
    pub groesse_erwartet: Option<i64>,
    /// Erwarteter SHA256 (hex) aus dem Katalog-Pin — gegen den berechneten Hash verifiziert.
    #[serde(default)]
    pub sha256_erwartet: Option<String>,
    /// One-Click-Update (B2): id der Karte, die dieser Download ERSETZT. Nach Erfolg wird die neue
    /// Karte aktiviert und die alte (id) gelöscht. `None` = normaler Erst-Download.
    #[serde(default)]
    pub ersetzt_karte_id: Option<i64>,
}

/// Finalisiert einen erfolgreich heruntergeladenen Download: aktiviert die fertige Karte passend.
/// Bei einem Update (`ersetzt_karte_id = Some`) wird die neue Version aktiviert (erbt den
/// Aktiv-Status der alten) und die alte Karte + Datei entfernt; sonst wird die erste bereite Karte
/// automatisch aktiviert, solange keine andere aktiv ist (Bestand bleibt). Best-effort — Fehler
/// werden geloggt, nicht propagiert (der Download selbst ist bereits `bereit`).
async fn finalisiere_erfolgreichen_download(
    pool: &sqlx::SqlitePool,
    karten_dir: &FsPath,
    id: i64,
    ersetzt_karte_id: Option<i64>,
) {
    if let Some(alt) = ersetzt_karte_id {
        // One-Click-Update (B2): neue Version aktivieren (erbt Aktiv-Status), alte Karte + Datei
        // entfernen. Bei Download-Fehler wird diese Fn nicht aufgerufen → alte Karte bleibt aktiv.
        match repo::ersetze_aktive_offline_karte(pool, id, alt).await {
            Ok(Some(_)) => {
                download::entferne_download_dateien(karten_dir, alt).await;
                // Reader-Cache s. offline_loeschen: gleicher Pfad, neue Inode möglich — sonst
                // würde der alte, gecachte Reader die entlinkte Datei weiterservieren.
                crate::karte::mbtiles::invalidate_reader().await;
                tracing::info!("Offline-Karte {id}: Update aktiviert, alte Karte {alt} entfernt");
            }
            Ok(None) => tracing::warn!("Update-Swap {id}: neue Karte verschwand"),
            Err(e) => tracing::error!("Update-Swap {id}->ersetzt {alt} fehlgeschlagen: {e}"),
        }
    } else {
        // Erst-Download: erste fertige Karte automatisch aktivieren, solange keine andere aktiv ist.
        match repo::aktiviere_wenn_keine_aktive(pool, id).await {
            Ok(true) => tracing::info!("Offline-Karte {id}: als Basemap aktiviert (erste bereite)"),
            Ok(false) => {}
            Err(e) => tracing::warn!("Auto-Aktivieren der Offline-Karte {id} fehlgeschlagen: {e}"),
        }
    }
}

/// POST /api/karte/offline-karten/download — startet einen Hintergrund-Download (Admin).
///
/// Legt IMMER eine NEUE Zeile an (kein Re-Download in eine aktive Karte) — die Live-Lagekarte
/// bleibt während des Mehr-GB-Downloads verfügbar, bis der Admin die neue Karte aktiviert.
/// Antwortet sofort `202` mit der Zeile (Status `laedt`); das Frontend pollt die Liste.
/// „Aktualisieren" = neue Karte laden + aktivieren + alte löschen (In-Place-Hot-Swap ist v1.x).
pub async fn offline_download(
    State(state): State<AppState>,
    _admin: AdminUser,
    Json(body): Json<OfflineDownloadBody>,
) -> Result<(StatusCode, Json<OfflineKarte>), AppError> {
    let name = body.name.trim();
    if name.is_empty() {
        return Err(AppError::Validation("Name darf nicht leer sein".into()));
    }
    // Attribution ist Pflicht (Lizenzauflage, offline sichtbar) — Parität zur Online-Quelle.
    let lizenz = body.lizenz.trim();
    if lizenz.is_empty() {
        return Err(AppError::Validation(
            "Lizenz/Attribution ist Pflicht (offline sichtbar)".into(),
        ));
    }
    // SSRF-Guard: nur https, keine internen Ziele. Redirects werden je Hop erneut geprüft.
    let url = download::validiere_download_url(&body.url).map_err(AppError::Validation)?;
    let kachel_schema = body
        .kachel_schema
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("shortbread")
        .to_string();

    // Plattenplatz-Check vorab gegen die erwartete (Katalog-)Größe, mit 10 % Reserve — für den
    // sofortigen 422 im Katalog-Pfad. Der Per-URL-Pfad (ohne groesse_erwartet) wird zusätzlich in
    // lade_datei anhand der Content-Length geprüft (LFH-187/B2).
    if let Some(erwartet) = body.groesse_erwartet.filter(|g| *g > 0) {
        if let Ok(frei) = fs4::available_space(&state.karten_dir) {
            if !download::genug_platz(frei, erwartet as u64) {
                let benoetigt = (erwartet as u64).saturating_add(erwartet as u64 / 10);
                return Err(AppError::UnprocessableEntity(format!(
                    "Nicht genug Speicherplatz im Kartenverzeichnis: {frei} Bytes frei, \
                     ~{benoetigt} Bytes benötigt"
                )));
            }
        }
    }

    let karte = repo::neue_download_karte(
        &state.pool,
        &repo::OfflineDownloadEingabe {
            name: name.to_string(),
            quell_url: url.to_string(),
            lizenz: lizenz.to_string(),
            kachel_schema,
            sortier: 0,
        },
    )
    .await?;

    // Fortschritt registrieren, dann den eigentlichen Download in einen Hintergrund-Task auslagern.
    let fortschritt = Arc::new(Fortschritt::default());
    state
        .download_fortschritt
        .write()
        .unwrap()
        .insert(karte.id, fortschritt.clone());

    let pool = state.pool.clone();
    let client = state.download_client.clone();
    let karten_dir = state.karten_dir.clone();
    let fortschritt_map = state.download_fortschritt.clone();
    let id = karte.id;
    let sha256_erwartet = body.sha256_erwartet.clone();
    let ersetzt_karte_id = body.ersetzt_karte_id;
    tokio::spawn(async move {
        let dateiname = format!("karte-{id}.mbtiles");
        let part = karten_dir.join(format!("{dateiname}.part"));
        tracing::info!("Offline-Karte {id}: Download startet von {url}");
        let ergebnis = download::lade_datei(
            &client,
            url,
            &part,
            &fortschritt,
            sha256_erwartet.as_deref(),
            download::MAX_DOWNLOAD_BYTES,
        )
        .await;
        match ergebnis {
            Ok(erg) => {
                // Atomarer Swap: erst nach vollständigem Download .part → finalen Pfad.
                let ziel = karten_dir.join(&dateiname);
                if let Err(e) = tokio::fs::rename(&part, &ziel).await {
                    tracing::error!("Rename der Kartendatei {id} fehlgeschlagen: {e}");
                    let _ = tokio::fs::remove_file(&part).await;
                    let _ = repo::setze_status(&pool, id, "fehler").await;
                } else if let Err(e) =
                    repo::markiere_bereit(&pool, id, &dateiname, erg.groesse, &erg.sha256).await
                {
                    tracing::error!("markiere_bereit({id}) fehlgeschlagen: {e}");
                    // Bereits umbenannte finale Datei aufräumen, sonst verwaist sie ohne DB-Record.
                    let _ = tokio::fs::remove_file(&ziel).await;
                    let _ = repo::setze_status(&pool, id, "fehler").await;
                } else {
                    tracing::info!(
                        "Offline-Karte {id}: Download fertig ({} Bytes)",
                        erg.groesse
                    );
                    finalisiere_erfolgreichen_download(&pool, &karten_dir, id, ersetzt_karte_id)
                        .await;
                }
            }
            Err(fehler) => {
                tracing::warn!("Download der Karte {id} fehlgeschlagen: {fehler}");
                let _ = tokio::fs::remove_file(&part).await; // Teil-Datei aufräumen
                let _ = repo::setze_status(&pool, id, "fehler").await;
            }
        }
        // Fortschritt-Eintrag in JEDEM Ausgang entfernen (sonst wächst die Map unbegrenzt).
        fortschritt_map.write().unwrap().remove(&id);
    });

    Ok((StatusCode::ACCEPTED, Json(karte)))
}

/// POST /api/karte/offline-karten/{id}/abbrechen — laufenden Download abbrechen (Admin).
/// Setzt das Abbruch-Flag; der Task bricht beim nächsten Chunk ab, räumt die `.part`-Datei auf
/// und setzt den Status auf `fehler`. `404`, wenn für die `id` kein Download läuft.
pub async fn offline_abbrechen(
    State(state): State<AppState>,
    _admin: AdminUser,
    Path(id): Path<i64>,
) -> Result<StatusCode, AppError> {
    let laufend = state.download_fortschritt.read().unwrap().get(&id).cloned();
    match laufend {
        Some(f) => {
            f.abbruch.store(true, Ordering::Relaxed);
            Ok(StatusCode::NO_CONTENT)
        }
        None => Err(AppError::NotFound),
    }
}

// ===== Style-/Tile-Proxy (LFH-182, öffentlich — wie /config & /tiles) =====
//
// Alle Endpunkte: Quelle muss existieren + proxy=1 + aktiv=1 (sonst 404). Jede Upstream-URL läuft
// VOR dem Fetch durch `url_ist_sicher` (Schema/Literal); der `proxy_client` ergänzt den pinnenden
// DNS-Resolver (Anti-Rebinding) + per-Hop-Redirect-Prüfung. Clients können nie eine eigene
// Ziel-URL wählen — nur die gespeicherte Quelle-`url` (style/raster) bzw. recordete Slots.

/// Lädt die Quelle und stellt sicher, dass sie geproxyt werden DARF (existiert, proxy=1, aktiv=1).
async fn aktive_proxy_quelle(state: &AppState, id: i64) -> Result<OnlineQuelle, AppError> {
    match repo::finde_online_quelle(&state.pool, id).await? {
        Some(q) if q.proxy && q.aktiv => Ok(q),
        _ => Err(AppError::NotFound),
    }
}

/// SSRF-Gate vor jedem Upstream-Fetch: parst die URL und prüft Schema/Literal-IP.
fn ssrf_geprueft(upstream: &str) -> Result<reqwest::Url, AppError> {
    let u = reqwest::Url::parse(upstream)
        .map_err(|e| AppError::Internal(format!("ungültige Upstream-URL: {e}")))?;
    download::url_ist_sicher(&u).map_err(AppError::Internal)?;
    Ok(u)
}

/// JSON-Proxy-Antwort (style.json / tilejson): key-frei, nicht cachen.
fn json_proxy_antwort(json: String) -> Response {
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "application/json")
        .header(header::CACHE_CONTROL, "no-cache")
        .body(Body::from(json))
        .unwrap()
}

/// Binär-Asset-Antwort (Tiles/Sprite/Glyphs): hygienisierte Header + nosniff durchreichen.
fn asset_antwort(a: crate::karte::proxy::AssetAntwort) -> Response {
    let mut b = Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, a.content_type)
        .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff");
    if let Some(ce) = a.content_encoding {
        b = b.header(header::CONTENT_ENCODING, ce);
    }
    if let Some(cc) = a.cache_control {
        b = b.header(header::CACHE_CONTROL, cc);
    }
    if let Some(et) = a.etag {
        b = b.header(header::ETAG, et);
    }
    b.body(Body::from(a.bytes)).unwrap()
}

/// Löst einen Slot der Quelle auf (scoped auf `quelle_id` UND `art`) oder liefert `404`.
async fn slot_oder_nf(
    state: &AppState,
    id: i64,
    slot: i64,
    art: proxy::SlotArt,
) -> Result<String, AppError> {
    repo::slot_aufloesen(&state.pool, id, slot, art.as_str())
        .await?
        .ok_or(AppError::NotFound)
}

/// Holt ein Binär-Asset über den geteilten Proxy-Client (SSRF-gepinnt), **serverseitig gecacht**
/// (LFH-190, separate `tile-cache.db` im `karten_dir`), und baut die Antwort.
async fn proxy_asset(state: &AppState, u: reqwest::Url) -> Result<Response, AppError> {
    // Pool-Beschaffung + Fallback liegen in tile_cache (Modulvertrag „Cache-Fehler sind nie
    // fatal"): ist die Cache-DB nicht verfügbar, wird auf einen Direkt-Fetch ohne Cache degradiert
    // statt die Kachel-Auslieferung mit 500 abzuwürgen.
    let asset = tile_cache::hole_asset_via_cache_oder_direkt(
        &state.karten_dir,
        proxy::proxy_client(),
        u,
        proxy::ASSET_BYTE_CAP,
        tile_cache::unix_now(),
    )
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;
    Ok(asset_antwort(asset))
}

/// GET /api/karte/proxy/{id}/style.json — Vektor-Style serverseitig holen + key-frei umschreiben.
pub async fn proxy_style(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<Response, AppError> {
    let q = aktive_proxy_quelle(&state, id).await?;
    let u = ssrf_geprueft(&q.url)?;
    let json = proxy::hole_style(proxy::proxy_client(), &state.pool, id, u)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    Ok(json_proxy_antwort(json))
}

/// GET /api/karte/proxy/{id}/raster/{z}/{x}/{y} — Raster-Tile aus der gespeicherten Template-URL.
pub async fn proxy_raster(
    State(state): State<AppState>,
    Path((id, z, x, y)): Path<(i64, i64, i64, i64)>,
) -> Result<Response, AppError> {
    let q = aktive_proxy_quelle(&state, id).await?;
    let u = ssrf_geprueft(&proxy::subst_template(&q.url, z, x, y))?;
    proxy_asset(&state, u).await
}

/// GET /api/karte/proxy/{id}/tile/{slot}/{z}/{x}/{y} — Vektor-/Raster-Tile aus einem Style-Slot.
pub async fn proxy_tile(
    State(state): State<AppState>,
    Path((id, slot, z, x, y)): Path<(i64, i64, i64, i64, i64)>,
) -> Result<Response, AppError> {
    aktive_proxy_quelle(&state, id).await?;
    let template = slot_oder_nf(&state, id, slot, proxy::SlotArt::Template).await?;
    let u = ssrf_geprueft(&proxy::subst_template(&template, z, x, y))?;
    proxy_asset(&state, u).await
}

/// GET /api/karte/proxy/{id}/tilejson/{slot} — TileJSON-Indirektion holen + key-frei umschreiben.
pub async fn proxy_tilejson(
    State(state): State<AppState>,
    Path((id, slot)): Path<(i64, i64)>,
) -> Result<Response, AppError> {
    aktive_proxy_quelle(&state, id).await?;
    let upstream = slot_oder_nf(&state, id, slot, proxy::SlotArt::Tilejson).await?;
    let u = ssrf_geprueft(&upstream)?;
    let json = proxy::hole_tilejson(proxy::proxy_client(), &state.pool, id, u)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    Ok(json_proxy_antwort(json))
}

/// GET /api/karte/proxy/{id}/sprite/{rest} — Sprite (`{rest}` = `{slot}.json|.png|@2x…`).
pub async fn proxy_sprite(
    State(state): State<AppState>,
    Path((id, rest)): Path<(i64, String)>,
) -> Result<Response, AppError> {
    aktive_proxy_quelle(&state, id).await?;
    let (slot, suffix) = proxy::split_slot_suffix(&rest).map_err(AppError::Validation)?;
    let base = slot_oder_nf(&state, id, slot, proxy::SlotArt::Sprite).await?;
    let u = ssrf_geprueft(&proxy::sprite_upstream(&base, &suffix))?;
    proxy_asset(&state, u).await
}

/// GET /api/karte/proxy/{id}/glyphs/{slot}/{fontstack}/{range} — Glyphs aus einem Style-Slot.
pub async fn proxy_glyphs(
    State(state): State<AppState>,
    Path((id, slot, fontstack, range)): Path<(i64, i64, String, String)>,
) -> Result<Response, AppError> {
    aktive_proxy_quelle(&state, id).await?;
    proxy::validiere_fontstack(&fontstack).map_err(AppError::Validation)?;
    proxy::validiere_range(&range).map_err(AppError::Validation)?;
    let template = slot_oder_nf(&state, id, slot, proxy::SlotArt::Glyphs).await?;
    let u = ssrf_geprueft(&proxy::subst_glyphs(&template, &fontstack, &range))?;
    proxy_asset(&state, u).await
}

#[cfg(test)]
mod proxy_antwort_tests {
    use super::*;

    #[test]
    fn asset_antwort_setzt_nosniff_und_reicht_header_durch() {
        let a = proxy::AssetAntwort {
            bytes: b"TILE".to_vec(),
            content_type: "application/x-protobuf".into(),
            content_encoding: Some("gzip".into()),
            cache_control: Some("public, max-age=60".into()),
            etag: Some("\"abc\"".into()),
        };
        let r = asset_antwort(a);
        assert_eq!(r.status(), StatusCode::OK);
        let h = r.headers();
        assert_eq!(h.get(header::CONTENT_TYPE).unwrap(), "application/x-protobuf");
        assert_eq!(h.get(header::X_CONTENT_TYPE_OPTIONS).unwrap(), "nosniff");
        assert_eq!(h.get(header::CONTENT_ENCODING).unwrap(), "gzip");
        assert_eq!(h.get(header::CACHE_CONTROL).unwrap(), "public, max-age=60");
        assert_eq!(h.get(header::ETAG).unwrap(), "\"abc\"");
    }

    #[test]
    fn json_proxy_antwort_ist_json_no_cache() {
        let r = json_proxy_antwort("{}".into());
        assert_eq!(r.status(), StatusCode::OK);
        assert_eq!(r.headers().get(header::CONTENT_TYPE).unwrap(), "application/json");
        assert_eq!(r.headers().get(header::CACHE_CONTROL).unwrap(), "no-cache");
    }
}

#[cfg(test)]
mod finalisierung_tests {
    use super::*;

    fn dl(name: &str) -> repo::OfflineDownloadEingabe {
        repo::OfflineDownloadEingabe {
            name: name.into(),
            quell_url: format!("https://example.test/{name}.pmtiles"),
            lizenz: "© OpenStreetMap contributors (ODbL)".into(),
            kachel_schema: "shortbread".into(),
            sortier: 0,
        }
    }

    async fn bereite_karte(pool: &sqlx::SqlitePool, name: &str) -> i64 {
        let k = repo::neue_download_karte(pool, &dl(name)).await.unwrap();
        repo::markiere_bereit(pool, k.id, &format!("karte-{}.mbtiles", k.id), 10, "h")
            .await
            .unwrap();
        k.id
    }

    // One-Click-Update über die Handler-Finalisierung: aktiviert die neue Version, entfernt alt.
    #[tokio::test]
    async fn finalisiere_update_aktiviert_neu_und_entfernt_alt() {
        let pool = crate::db::test_pool().await;
        let tmp = tempfile::tempdir().unwrap();
        let alt = bereite_karte(&pool, "A").await;
        repo::aktiviere_offline_karte(&pool, alt).await.unwrap();
        let neu = bereite_karte(&pool, "A2").await;

        finalisiere_erfolgreichen_download(&pool, tmp.path(), neu, Some(alt)).await;

        let liste = repo::liste_offline_karten(&pool).await.unwrap();
        assert!(liste.iter().all(|k| k.id != alt), "alte Karte entfernt");
        assert!(
            liste.iter().find(|k| k.id == neu).unwrap().aktiv_basemap,
            "neue Version aktiv"
        );
    }

    // Erst-Download (ohne ersetzt_karte_id): erste bereite Karte wird automatisch aktiviert.
    #[tokio::test]
    async fn finalisiere_erstdownload_aktiviert_erste_bereite() {
        let pool = crate::db::test_pool().await;
        let tmp = tempfile::tempdir().unwrap();
        let m = bereite_karte(&pool, "M").await;

        finalisiere_erfolgreichen_download(&pool, tmp.path(), m, None).await;

        let liste = repo::liste_offline_karten(&pool).await.unwrap();
        assert!(
            liste.iter().find(|k| k.id == m).unwrap().aktiv_basemap,
            "erste bereite Karte automatisch aktiviert"
        );
    }
}
