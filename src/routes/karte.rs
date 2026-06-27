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
use crate::karte::registry::repo::{
    self, OfflineKarte, OfflineKarteEingabe, OnlineQuelle, OnlineQuelleEingabe,
};
use axum::body::Body;
use axum::extract::{Path, Query, State};
use axum::http::{header, Request, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Component, Path as FsPath};
use std::sync::atomic::Ordering;
use std::sync::Arc;
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
    /// Trägt `?v=<token>` (Cache-Bust): wechselt bei Karten-Swap, sonst cacht die pmtiles-Lib
    /// den alten Archiv-Aufbau unter gleicher URL → korrupte Tiles.
    pub pmtiles_url: Option<String>,
    /// Pflicht-Attribution der aktiven Offline-Karte (offline sichtbar, z.B. ODbL). `None`,
    /// wenn keine aktive Karte oder keine Lizenz hinterlegt ist.
    pub pmtiles_attribution: Option<String>,
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
            let typ = if q.typ == "raster" {
                OnlineStyleTyp::Raster
            } else {
                OnlineStyleTyp::Vektor
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
    let (pmtiles_url, pmtiles_attribution) = match &aktiv {
        Some(k) => {
            // Cache-Bust-Token URL-safe halten (geaendert_at enthält Leerzeichen/Doppelpunkte).
            let v: String = k.version.chars().filter(|c| c.is_ascii_alphanumeric()).collect();
            (Some(format!("/api/karte/tiles.pmtiles?v={v}")), k.lizenz.clone())
        }
        None => (None, None),
    };
    Ok(Json(KarteConfigAntwort {
        online_styles,
        pmtiles_verfuegbar: aktiv.is_some(),
        pmtiles_url,
        pmtiles_attribution,
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
    /// Serverseitig proxen (key-basierte Anbieter, LFH-182). Default false → Quelle läuft direkt.
    #[serde(default)]
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
    // Proxied Quellen (key-basiert): URL roh speichern (kein Url-Roundtrip — würde `{}`
    // percent-kodieren), aber vorab validieren: nur unterstützte Platzhalter, und SSRF-Check auf
    // einer materialisierten Probe (Platzhalter durch 0/Dummy ersetzt). Direkte Quellen (proxy=0)
    // bleiben unverändert: der Browser lädt sie selbst, keine Server-seitige Prüfung nötig.
    if body.proxy {
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
        proxy: body.proxy,
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
    // rendert sie quellen-unabhängig (config.pmtiles_attribution); ohne Lizenz würde eine
    // aktivierte registrierte Karte offline ohne Pflicht-Attribution gezeigt (Lizenzverstoß).
    let lizenz = body
        .lizenz
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| AppError::Validation("Lizenz/Attribution ist Pflicht (offline sichtbar)".into()))?
        .to_string();
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
/// Entfernt zusätzlich die vom Download-Manager VERWALTETE Datei (`karte-{id}.pmtiles` + evtl.
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
            k.download_at.is_some() || k.pfad.is_empty() || k.pfad == format!("karte-{id}.pmtiles");
        if ist_gemanagt {
            download::entferne_download_dateien(&state.karten_dir, id).await;
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
        .unwrap_or("protomaps")
        .to_string();

    // Plattenplatz-Check vorab gegen die erwartete (Katalog-)Größe, mit 10 % Reserve.
    if let Some(erwartet) = body.groesse_erwartet.filter(|g| *g > 0) {
        if let Ok(frei) = fs4::available_space(&state.karten_dir) {
            let benoetigt = (erwartet as u64).saturating_add(erwartet as u64 / 10);
            if frei < benoetigt {
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
        let dateiname = format!("karte-{id}.pmtiles");
        let part = karten_dir.join(format!("{dateiname}.part"));
        tracing::info!("Offline-Karte {id}: Download startet von {url}");
        let ergebnis =
            download::lade_datei(&client, url, &part, &fortschritt, sha256_erwartet.as_deref()).await;
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
                    if let Some(alt) = ersetzt_karte_id {
                        // One-Click-Update (B2): neue Version aktivieren (erbt Aktiv-Status), alte
                        // Karte + Datei entfernen. Bei Download-Fehler kommen wir hier nicht hin →
                        // die alte Karte bleibt aktiv (fail-safe).
                        match repo::ersetze_aktive_offline_karte(&pool, id, alt).await {
                            Ok(Some(_)) => {
                                download::entferne_download_dateien(&karten_dir, alt).await;
                                tracing::info!(
                                    "Offline-Karte {id}: Update aktiviert, alte Karte {alt} entfernt"
                                );
                            }
                            Ok(None) => {
                                tracing::warn!("Update-Swap {id}: neue Karte verschwand")
                            }
                            Err(e) => {
                                tracing::error!("Update-Swap {id}->ersetzt {alt} fehlgeschlagen: {e}")
                            }
                        }
                    } else {
                        // Erst-Download: erste fertige Karte automatisch aktivieren, solange noch
                        // keine andere aktiv ist. Eine bereits aktive Karte wird NICHT verdrängt.
                        match repo::aktiviere_wenn_keine_aktive(&pool, id).await {
                            Ok(true) => {
                                tracing::info!("Offline-Karte {id}: als Basemap aktiviert (erste bereite)");
                            }
                            Ok(false) => {}
                            Err(e) => {
                                tracing::warn!("Auto-Aktivieren der Offline-Karte {id} fehlgeschlagen: {e}");
                            }
                        }
                    }
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

/// Holt ein Binär-Asset über den geteilten Proxy-Client (SSRF-gepinnt) und baut die Antwort.
async fn proxy_asset(u: reqwest::Url) -> Result<Response, AppError> {
    let asset = proxy::hole_asset(proxy::proxy_client(), u, proxy::ASSET_BYTE_CAP)
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
    proxy_asset(u).await
}

/// GET /api/karte/proxy/{id}/tile/{slot}/{z}/{x}/{y} — Vektor-/Raster-Tile aus einem Style-Slot.
pub async fn proxy_tile(
    State(state): State<AppState>,
    Path((id, slot, z, x, y)): Path<(i64, i64, i64, i64, i64)>,
) -> Result<Response, AppError> {
    aktive_proxy_quelle(&state, id).await?;
    let template = slot_oder_nf(&state, id, slot, proxy::SlotArt::Template).await?;
    let u = ssrf_geprueft(&proxy::subst_template(&template, z, x, y))?;
    proxy_asset(u).await
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
    proxy_asset(u).await
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
    proxy_asset(u).await
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
