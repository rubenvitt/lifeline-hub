use crate::app::AppState;
use crate::auth::session::{AdminUser, CurrentUser};
use crate::config::{default_online_styles, OfflineKatalogEintrag, OnlineStyle, OnlineStyleTyp};
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
use std::collections::{HashMap, HashSet};
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
    /// Grober Kachel-Typ der aktiven Offline-Karte (LFH-185): `"vektor"` (pbf) oder `"raster"`
    /// (png/jpg/webp) — steuert die Style-Wahl im Frontend. `None`, wenn keine aktive Karte.
    pub offline_format: Option<String>,
    /// True, wenn der zentrale karten-service konfiguriert ist (URL+Token) → Admin darf Region-Builds
    /// anstoßen. Steuert die Sichtbarkeit der Bau-UI (LFH-203). Reine Verfügbarkeit, kein Secret.
    pub karten_bau_verfuegbar: bool,
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
    // Format gröbern (kein Datei-Open — der Wert ist operator-deklariert in der DB, LFH-185): eine
    // grobe Routing-Entscheidung darf nicht an Datei-Lesbarkeit hängen.
    let offline_format = aktiv.as_ref().map(|k| {
        match k.format.as_str() {
            "png" | "jpg" | "webp" => "raster",
            _ => "vektor",
        }
        .to_string()
    });
    // Bau-UI-Verfügbarkeit (LFH-203): reine Konfigurations-Prüfung, kein Netzwerk-Call zum
    // karten-service. Beide Werte müssen gesetzt sein — Token ohne URL (oder umgekehrt) ist keine
    // funktionsfähige Konfiguration.
    let karten_bau_verfuegbar =
        state.karten_service_url.is_some() && state.karten_service_token.is_some();
    Ok(Json(KarteConfigAntwort {
        online_styles,
        offline_verfuegbar: aktiv.is_some(),
        offline_tiles_url,
        offline_attribution,
        offline_format,
        karten_bau_verfuegbar,
    }))
}

/// GET /api/karte/offline/tiles/{z}/{x}/{y} — Kachel der aktiven Offline-MBTiles. Vektor (`pbf`)
/// wird als gzip-MVT ausgeliefert, Raster (`png`/`jpg`/`webp`) als Bild ohne Content-Encoding
/// (LFH-185). Öffnet die aktive Datei read-only (gecacht per Pfad in mbtiles::reader_fuer),
/// Y-Flip in mbtiles.rs; der Blob wird formatunabhängig durchgereicht.
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
    let Some((pfad_rel, format)) = repo::aktive_offline_karte_pfad_und_format(&state.pool).await?
    else {
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
        Ok(Some(daten)) => {
            let (content_type, encoding) = format_mime_encoding(&format);
            let mut builder = Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, content_type)
                .header(header::CACHE_CONTROL, "public, max-age=86400");
            // Content-Encoding NUR bei gzip-MVT (pbf); Raster-Blobs sind unkomprimiert.
            if let Some(enc) = encoding {
                builder = builder.header(header::CONTENT_ENCODING, enc);
            }
            Ok(builder.body(Body::from(daten)).unwrap())
        }
        Ok(None) => Ok(StatusCode::NO_CONTENT.into_response()),
        Err(e) => Err(AppError::Internal(format!("Tile lesen: {e}"))),
    }
}

/// Content-Type + optionales Content-Encoding je Kachel-Blob-Format (LFH-185). Nur Vektor (`pbf`)
/// ist gzip-komprimiert (Shortbread-MVT); Raster-Blobs (png/jpg/webp) tragen KEIN Content-Encoding.
fn format_mime_encoding(format: &str) -> (&'static str, Option<&'static str>) {
    match format {
        "png" => ("image/png", None),
        "jpg" => ("image/jpeg", None),
        "webp" => ("image/webp", None),
        _ => ("application/x-protobuf", Some("gzip")), // pbf (Vektor, Default)
    }
}

/// Validiert das optionale Kachel-Format aus einem Request-Body (Default `pbf`, LFH-185); liefert
/// bei ungültigem Wert eine 400-Validation (`AppError::Validation`) statt eines DB-CHECK-500 —
/// konsistent zum typ-Check in `validiere_online`.
fn validiere_format(format: Option<&str>) -> Result<String, AppError> {
    let f = format
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("pbf");
    if !matches!(f, "pbf" | "png" | "jpg" | "webp") {
        return Err(AppError::Validation(format!(
            "Ungültiges Kachel-Format (pbf/png/jpg/webp): {f}"
        )));
    }
    Ok(f.to_string())
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

    #[test]
    fn finde_nicht_registrierte_filtert_registrierte_und_part() {
        // Lokaler Region-Import (LFH-199): nur vorhandene, unregistrierte .mbtiles listen.
        let dir = std::env::temp_dir().join("lfh199-vorhandene-test");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("bremen.mbtiles"), b"x").unwrap(); // vorhanden, unregistriert
        std::fs::write(dir.join("karte-1.mbtiles"), b"xx").unwrap(); // registriert → raus
        std::fs::write(dir.join("download.mbtiles.part"), b"xxx").unwrap(); // .part → raus
        std::fs::write(dir.join("notes.txt"), b"y").unwrap(); // kein mbtiles → raus
        let registrierte: HashSet<String> = ["karte-1.mbtiles".to_string()].into_iter().collect();
        let out = finde_nicht_registrierte(&dir, &registrierte);
        assert_eq!(out.len(), 1, "nur die unregistrierte .mbtiles: {out:?}");
        assert_eq!(out[0].dateiname, "bremen.mbtiles");
        assert_eq!(out[0].groesse, 1);
        let _ = std::fs::remove_dir_all(&dir);
    }

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
    /// Kachel-Format (LFH-185): `pbf` (Default, Vektor) oder `png`/`jpg`/`webp` (Raster).
    pub format: Option<String>,
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

/// Extrahiert `(geladen, gesamt)`-Bytes aus einem Download-Fortschritt für die Liste. `gesamt` ist
/// `None`, wenn die Quelle keine Content-Length lieferte (`0` = unbekannt).
fn fortschritt_werte(f: &Fortschritt) -> (i64, Option<i64>) {
    let g = f.gesamt.load(Ordering::Relaxed);
    (f.geladen.load(Ordering::Relaxed) as i64, (g > 0).then_some(g as i64))
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
    // Hybrid-Katalog aus dem prozessweiten Cache (LFH-199) — kein Netz-Call in der Liste; den Fetch
    // macht der `offline_katalog`-Handler und füllt den Cache, den wir hier für den Update-Check
    // mitnutzen.
    let katalog = crate::karte::katalog::katalog_aus_cache();
    // Ladende Karten mit Live-Bytes aus dem In-Memory-Fortschritt anreichern (kein await unter
    // dem Lock).
    let map = state.download_fortschritt.read().unwrap();
    let antwort: Vec<OfflineKarteAntwort> = rows
        .into_iter()
        .map(|k| {
            // Fortschritt für JEDE Zeile mit laufendem Download-Eintrag zeigen — nicht nur
            // status='laedt' (Neu-Zeile-Download), sondern auch den In-Place-Reload (B3), der die
            // Zeile bewusst 'bereit'+aktiv lässt, damit die alte Datei bis zum Swap weiterserviert.
            let (geladen, gesamt) = match map.get(&k.id) {
                Some(f) => {
                    let (g, ge) = fortschritt_werte(f);
                    (Some(g), ge)
                }
                None => (None, None),
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
    let format = validiere_format(body.format.as_deref())?;
    let eingabe = OfflineKarteEingabe {
        name: name.to_string(),
        pfad: pfad.to_string(),
        quell_url: body.quell_url,
        lizenz: Some(lizenz),
        kachel_schema,
        format,
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

/// Eine im karten_dir vorhandene, aber noch nicht registrierte MBTiles-Datei — Kandidat für den
/// lokalen Import gebauter Region-Packs (LFH-199, ohne Download/Hosting).
#[derive(Debug, Serialize, PartialEq)]
pub struct VorhandeneKarte {
    pub dateiname: String,
    pub groesse: i64,
}

/// Scannt `karten_dir` nach `*.mbtiles`-Dateien, die in `registrierte` (Registry-Pfade) NICHT
/// vorkommen. `.part` (laufende Downloads) und Nicht-mbtiles werden übersprungen. Best-effort:
/// Lesefehler → leere Liste. Ergebnis nach Dateiname sortiert (stabile UI-Reihenfolge).
fn finde_nicht_registrierte(
    karten_dir: &FsPath,
    registrierte: &HashSet<String>,
) -> Vec<VorhandeneKarte> {
    let Ok(eintraege) = std::fs::read_dir(karten_dir) else {
        return Vec::new();
    };
    let mut out: Vec<VorhandeneKarte> = eintraege
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().to_str()?.to_string();
            // Nur echte .mbtiles (`.mbtiles.part` endet auf `.part` → raus), nicht bereits registriert.
            if !name.ends_with(".mbtiles") || registrierte.contains(&name) {
                return None;
            }
            let groesse = e.metadata().ok()?.len() as i64;
            Some(VorhandeneKarte {
                dateiname: name,
                groesse,
            })
        })
        .collect();
    out.sort_by(|a, b| a.dateiname.cmp(&b.dateiname));
    out
}

/// GET /api/karte/offline-karten/vorhandene — im karten_dir liegende, noch nicht registrierte
/// MBTiles (lokaler Import gebauter Region-Packs, LFH-199). Admin only.
pub async fn offline_vorhandene(
    State(state): State<AppState>,
    _admin: AdminUser,
) -> Result<Json<Vec<VorhandeneKarte>>, AppError> {
    let registrierte: HashSet<String> = repo::liste_offline_karten(&state.pool)
        .await?
        .into_iter()
        .map(|k| k.pfad)
        .collect();
    Ok(Json(finde_nicht_registrierte(&state.karten_dir, &registrierte)))
}

/// GET /api/karte/offline-karten/katalog — kuratierter Download-Vorschlagskatalog (Admin).
/// Hybrid (LFH-199): compiled-in Default ∪ best-effort geholtes Remote-Manifest (füllt den Cache,
/// den `offline_liste` mitnutzt). Fetch-Fehler → nur compiled-in.
pub async fn offline_katalog(
    State(state): State<AppState>,
    _admin: AdminUser,
) -> Result<Json<Vec<OfflineKatalogEintrag>>, AppError> {
    // Kurz getimeboxter Client (fachebenen: 8 s), NICHT der GB-download_client (kein Globaltimeout) —
    // der Manifest-Abruf ist ein kleiner JSON-Request und darf den Handler nicht lange blockieren.
    Ok(Json(
        crate::karte::katalog::effektiver_katalog(&state.fachebenen.client).await,
    ))
}

/// Request-Body zum Starten eines Offline-Karten-Downloads (aus Katalog oder eigener URL).
#[derive(Debug, Deserialize)]
pub struct OfflineDownloadBody {
    pub name: String,
    pub url: String,
    pub lizenz: String,
    pub kachel_schema: Option<String>,
    /// Kachel-Format (LFH-185): `pbf` (Default, Vektor) oder `png`/`jpg`/`webp` (Raster).
    #[serde(default)]
    pub format: Option<String>,
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

/// Finalisiert einen In-Place-Hot-Swap (B3, LFH-187): benennt die fertige `.part`-Datei atomar über
/// die weiterhin aktive Datei `karte-{id}.mbtiles`, aktualisiert die Metadaten DERSELBEN Zeile
/// (Größe/sha256/geaendert_at → neuer Cache-Bust-Token) und verwirft den Reader-Cache. Die Zeile
/// bleibt durchgehend `bereit`+aktiv → die Live-Karte serviert bis zum atomaren Swap die alte
/// Datei, danach die neue. Fehler werden zurückgegeben; die `.part` räumt der Aufrufer auf.
async fn finalisiere_in_place_download(
    pool: &sqlx::SqlitePool,
    karten_dir: &FsPath,
    id: i64,
    groesse: i64,
    sha256: &str,
    neue_quell_url: &str,
) -> Result<(), String> {
    let dateiname = format!("karte-{id}.mbtiles");
    let part = karten_dir.join(format!("{dateiname}.part"));
    let ziel = karten_dir.join(&dateiname);
    // Atomarer Swap: POSIX-rename ersetzt die Zieldatei in-place; die alte Inode bleibt für bereits
    // geöffnete Reader gültig, bis invalidate_reader() den gecachten Pool verwirft.
    tokio::fs::rename(&part, &ziel).await.map_err(|e| format!("Rename: {e}"))?;
    // Reader-Cache VOR dem DB-Update verwerfen: die Datei hat eine neue Inode, der gecachte Pool
    // (per Pfad gekeyt) hält sonst das alte Handle → würde die alte Datei weiterservieren.
    crate::karte::mbtiles::invalidate_reader().await;
    repo::markiere_bereit(pool, id, &dateiname, groesse, sha256)
        .await
        .map_err(|e| format!("markiere_bereit: {e}"))?;
    // quell_url auf die neue (Katalog-)URL setzen — sonst bliebe die Update-Erkennung
    // (quell_url != katalog.url) dauerhaft „Update verfügbar" und das „Stand"-Datum veraltet.
    repo::aktualisiere_quell_url(pool, id, neue_quell_url)
        .await
        .map_err(|e| format!("quell_url: {e}"))?;
    Ok(())
}

/// Verarbeitet das Download-Ergebnis eines In-Place-Reloads (B3): bei Erfolg atomarer Swap +
/// Metadaten-Update; bei Fehler NUR `.part`-Cleanup — bewusst KEIN `status='fehler'`, denn die alte
/// Datei ist intakt und bleibt aktiv+ausgeliefert (ein Downgrade würde die Live-Karte grundlos
/// abschalten). In den Handler-Task ausgelagert, damit der Fehlerpfad ohne AppState testbar ist.
async fn verarbeite_in_place_ergebnis(
    pool: &sqlx::SqlitePool,
    karten_dir: &FsPath,
    id: i64,
    neue_quell_url: &str,
    ergebnis: Result<download::DownloadErgebnis, download::DownloadFehler>,
) {
    let part = karten_dir.join(format!("karte-{id}.mbtiles.part"));
    match ergebnis {
        Ok(erg) => match finalisiere_in_place_download(
            pool,
            karten_dir,
            id,
            erg.groesse,
            &erg.sha256,
            neue_quell_url,
        )
        .await
        {
            Ok(()) => {
                tracing::info!("Offline-Karte {id}: In-Place-Reload fertig ({} Bytes)", erg.groesse)
            }
            Err(e) => {
                tracing::error!("In-Place-Swap {id} fehlgeschlagen: {e}");
                // .part aufräumen (bei erfolgtem Rename ein No-op); alte Karte bleibt aktiv.
                let _ = tokio::fs::remove_file(&part).await;
            }
        },
        Err(fehler) => {
            tracing::warn!("In-Place-Reload der Karte {id} fehlgeschlagen: {fehler}");
            let _ = tokio::fs::remove_file(&part).await;
        }
    }
}

/// Request-Body für den In-Place-Reload (B3): neue Quell-URL + optionale Größe/Pin. Lizenz/Name
/// bleiben die der bestehenden Karte (ein Update, kein neuer Eintrag).
#[derive(Debug, Deserialize)]
pub struct OfflineNeuLadenBody {
    pub url: String,
    #[serde(default)]
    pub groesse_erwartet: Option<i64>,
    #[serde(default)]
    pub sha256_erwartet: Option<String>,
}

/// POST /api/karte/offline-karten/{id}/neu-laden — In-Place-Hot-Swap (B3, LFH-187).
///
/// Lädt ein Update der bestehenden GEMANAGTEN Karte in DIESELBE Zeile/Datei. Anders als
/// `offline_download` (neue Zeile) wird KEINE neue Zeile angelegt: die alte Datei bleibt während
/// des Downloads `bereit`+aktiv und wird ausgeliefert; erst nach vollständigem Download erfolgt der
/// atomare Swap + Cache-Bust. Bei Download-Fehler bleibt die alte Karte unangetastet aktiv (KEIN
/// Status-Downgrade). `404` unbekannt; `422` bei extern registrierter Karte oder laufendem Download.
pub async fn offline_neu_laden(
    State(state): State<AppState>,
    _admin: AdminUser,
    Path(id): Path<i64>,
    Json(body): Json<OfflineNeuLadenBody>,
) -> Result<(StatusCode, Json<OfflineKarte>), AppError> {
    let karte = repo::finde_offline_karte(&state.pool, id)
        .await?
        .ok_or(AppError::NotFound)?;
    // Nur unsere gemanagten Downloads (`karte-{id}.mbtiles`) dürfen in-place ersetzt werden —
    // extern registrierte Karten (beliebiger admin-gelieferter Pfad) verwalten wir nicht.
    if karte.pfad != format!("karte-{id}.mbtiles") {
        return Err(AppError::UnprocessableEntity(
            "In-Place-Neu-Laden nur für heruntergeladene Karten (nicht extern registrierte)".into(),
        ));
    }
    let url = download::validiere_download_url(&body.url).map_err(AppError::Validation)?;
    // Sofortiger Plattenplatz-Check bei bekannter Größe (der Per-URL-Content-Length-Check in
    // lade_datei bleibt der Backstop).
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

    // Atomare Slot-Reservierung (Check+Insert unter EINEM write-Lock) — verhindert das TOCTOU zweier
    // paralleler In-Place-Reloads auf dieselbe id, die sonst denselben `.part` truncaten/interleaven
    // und eine korrupte Datei über die Live-Karte swappen würden (der sha256-Pin fängt das NICHT,
    // da lade_datei den eigenen Stream hasht, nicht die Datei auf Platte).
    let fortschritt = Arc::new(Fortschritt::default());
    if !download::reserviere_fortschritt(&state.download_fortschritt, id, fortschritt.clone()) {
        return Err(AppError::UnprocessableEntity(
            "Für diese Karte läuft bereits ein Download".into(),
        ));
    }

    let pool = state.pool.clone();
    let client = state.download_client.clone();
    let karten_dir = state.karten_dir.clone();
    let fortschritt_map = state.download_fortschritt.clone();
    let sha256_erwartet = body.sha256_erwartet.clone();
    let neue_quell_url = url.to_string();
    tokio::spawn(async move {
        let part = karten_dir.join(format!("karte-{id}.mbtiles.part"));
        tracing::info!("Offline-Karte {id}: In-Place-Reload startet von {url}");
        let ergebnis = download::lade_datei(
            &client,
            url,
            &part,
            &fortschritt,
            sha256_erwartet.as_deref(),
            download::MAX_DOWNLOAD_BYTES,
        )
        .await;
        verarbeite_in_place_ergebnis(&pool, &karten_dir, id, &neue_quell_url, ergebnis).await;
        fortschritt_map.write().unwrap().remove(&id);
    });

    Ok((StatusCode::ACCEPTED, Json(karte)))
}

/// POST /api/karte/offline-karten/download — startet einen Hintergrund-Download (Admin).
///
/// Legt IMMER eine NEUE Zeile an (kein Re-Download in eine aktive Karte) — die Live-Lagekarte
/// bleibt während des Mehr-GB-Downloads verfügbar, bis der Admin die neue Karte aktiviert.
/// Antwortet sofort `202` mit der Zeile (Status `laedt`); das Frontend pollt die Liste.
/// „Aktualisieren" = neue Karte laden + aktivieren + alte löschen; „Neu laden" (B3) = In-Place-Swap
/// derselben Zeile (siehe `offline_neu_laden`).
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

    let format = validiere_format(body.format.as_deref())?;
    let karte = repo::neue_download_karte(
        &state.pool,
        &repo::OfflineDownloadEingabe {
            name: name.to_string(),
            quell_url: url.to_string(),
            lizenz: lizenz.to_string(),
            kachel_schema,
            format,
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

/// POST /api/karte/offline-karten/{id}/abbrechen — laufenden Download ODER In-Place-Reload
/// abbrechen (Admin). Setzt das Abbruch-Flag; der Task bricht beim nächsten Chunk ab und räumt die
/// `.part`-Datei auf. Ein Neu-Zeile-Download (`offline_download`) geht danach auf Status `fehler`;
/// ein In-Place-Reload (`offline_neu_laden`) lässt die alte Karte bewusst UNANGETASTET bereit+aktiv
/// (kein Downgrade). `404`, wenn für die `id` kein Download/Reload läuft.
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
            format: "pbf".into(),
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

    // B3 (LFH-187): In-Place-Hot-Swap. Die aktive Zeile bleibt aktiv, ihre Datei wird atomar
    // getauscht und der Cache-Bust-Token (Version = sha256) wechselt.
    #[tokio::test]
    async fn in_place_swap_erhaelt_aktiv_bumpt_version_und_tauscht_datei() {
        let pool = crate::db::test_pool().await;
        let tmp = tempfile::tempdir().unwrap();
        let id = bereite_karte(&pool, "DE").await; // markiere_bereit(sha256="h")
        repo::aktiviere_offline_karte(&pool, id).await.unwrap();
        let vorher = repo::aktive_offline_karte(&pool).await.unwrap().unwrap();
        let ziel = tmp.path().join(format!("karte-{id}.mbtiles"));
        std::fs::write(&ziel, b"ALT").unwrap();
        std::fs::write(tmp.path().join(format!("karte-{id}.mbtiles.part")), b"NEU").unwrap();

        finalisiere_in_place_download(
            &pool,
            tmp.path(),
            id,
            3,
            "neuersha256",
            "https://example.test/de_neu_20260401.mbtiles",
        )
        .await
        .expect("Swap ok");

        assert_eq!(std::fs::read(&ziel).unwrap(), b"NEU", "Datei atomar getauscht");
        assert!(
            !tmp.path().join(format!("karte-{id}.mbtiles.part")).exists(),
            ".part wurde umbenannt (kein Rest)"
        );
        let nachher = repo::aktive_offline_karte(&pool).await.unwrap().expect("weiter aktiv");
        assert_eq!(nachher.version, "neuersha256");
        assert_ne!(nachher.version, vorher.version, "Cache-Bust-Token gewechselt");
        // quell_url auf die neue URL gesetzt → „Update verfügbar" verschwindet.
        let zeile = repo::finde_offline_karte(&pool, id).await.unwrap().unwrap();
        assert_eq!(
            zeile.quell_url.as_deref(),
            Some("https://example.test/de_neu_20260401.mbtiles"),
            "quell_url auf neue Katalog-URL aktualisiert"
        );
    }

    // B3-Fehlerpfad: schlägt der Reload-Download fehl, bleibt die alte Karte UNANGETASTET aktiv
    // (kein status='fehler'-Downgrade) und die .part wird aufgeräumt.
    #[tokio::test]
    async fn in_place_fehler_laesst_aktive_karte_unangetastet() {
        let pool = crate::db::test_pool().await;
        let tmp = tempfile::tempdir().unwrap();
        let id = bereite_karte(&pool, "DE").await;
        repo::aktiviere_offline_karte(&pool, id).await.unwrap();
        let vorher = repo::finde_offline_karte(&pool, id).await.unwrap().unwrap();
        // .part-Rest, den der Cleanup entfernen muss.
        std::fs::write(tmp.path().join(format!("karte-{id}.mbtiles.part")), b"halb").unwrap();

        verarbeite_in_place_ergebnis(
            &pool,
            tmp.path(),
            id,
            "https://example.test/neu.mbtiles",
            Err(download::DownloadFehler::Abgebrochen),
        )
        .await;

        let nachher = repo::finde_offline_karte(&pool, id).await.unwrap().unwrap();
        assert_eq!(nachher.status, "bereit", "kein Status-Downgrade bei Fehler");
        assert!(nachher.aktiv_basemap, "alte Karte bleibt aktiv");
        assert_eq!(nachher.sha256, vorher.sha256, "Version/Datei-Metadaten unverändert");
        assert_eq!(nachher.quell_url, vorher.quell_url, "quell_url unverändert bei Fehler");
        assert!(
            !tmp.path().join(format!("karte-{id}.mbtiles.part")).exists(),
            ".part aufgeräumt"
        );
    }

    // B3: `fortschritt_werte` — gesamt=None ohne Content-Length (0), sonst Some.
    #[test]
    fn fortschritt_werte_gesamt_none_wenn_null() {
        let f = Fortschritt::default();
        f.geladen.store(500, Ordering::Relaxed);
        assert_eq!(fortschritt_werte(&f), (500, None), "ohne Content-Length gesamt=None");
        f.gesamt.store(1000, Ordering::Relaxed);
        assert_eq!(fortschritt_werte(&f), (500, Some(1000)));
    }
}
