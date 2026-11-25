//! Drohnenquellen je Einsatz (LLH-2105): auflisten, zuschalten, abschalten unter
//! `/api/incidents/{id}/drone/sources`. Die Zuschaltung steht in `adapter_einsatz`; der Store
//! (`AppState.drohne`) bekommt sie erst nach dem Commit (die Datenbank ist maßgeblich). Ein
//! Adapter ist in höchstens einem laufenden Einsatz zugeschaltet; der Abschluss eines Einsatzes
//! räumt seine Zuschaltungen ab (`einsatz::repo::abschliessen`, dann [`sync_store`]).

use axum::body::Body;
use axum::extract::State;
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::Response;
use axum::Json;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::adapter::repo as adapter_repo;
use crate::app::AppState;
use crate::drohne::is_drohnen_art;
use crate::drohne::repo::{self, Zuschaltung};
use crate::drohne::video::{buendel, content_type_for, rewrite_playlist, ttl_for, VideoFehler};
use crate::einsatz::einstellungen;
use crate::einsatz::kontext::{EinsatzLeitungszugriff, EinsatzLesezugriff};
use crate::einsatz::modul::Lagekarte;
use crate::error::AppError;
use crate::extract::{JsonBody, PfadParam};
use crate::http_begrenzt::{DECKEL_FOTO, DECKEL_PLAYLIST, DECKEL_VIDEO};
use crate::zeit::jetzt;

/// Eine Drohnenquelle der Organisation, gesehen aus einem Einsatz.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct DroneSourceView {
    pub adapter_id: String,
    pub label: String,
    /// In diesem laufenden Einsatz zugeschaltet (ein abgeschlossener hält keine Quelle).
    pub connected: bool,
    /// Name des anderen laufenden Einsatzes, der die Quelle hält, wenn die Person ihn lesen darf.
    pub held_by_other: Option<String>,
    /// Ein anderer laufender Einsatz hält die Quelle, die Person darf ihn aber nicht lesen
    /// (dann ist `held_by_other` leer).
    pub held_by_other_hidden: bool,
    /// Das Livebild geht auch an den Lagemonitor.
    pub lagemonitor: bool,
    /// Zustand des Adapters (`aktiv`, `angehalten`, …).
    pub state: String,
    pub mission_name: Option<String>,
    pub video_keys: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, ToSchema)]
pub struct DroneSourceUpdate {
    pub lagemonitor: bool,
}

/// Der Name des anderen laufenden Einsatzes, der den Adapter hält, wenn die Person ihn lesen
/// darf; sonst `None`.
async fn halter_name(
    state: &AppState,
    benutzer_id: i64,
    halter: i64,
) -> Result<Option<String>, AppError> {
    let name: Option<String> = sqlx::query_scalar("SELECT bezeichnung FROM einsatz WHERE id = ?")
        .bind(halter)
        .fetch_optional(&state.pool)
        .await?;
    let darf = crate::einsatz::repo::rolle_von(&state.pool, halter, benutzer_id)
        .await?
        .is_some();
    Ok(name.filter(|_| darf))
}

/// Führt den Store nach einem Commit für die genannten Adapter nach: zugeschaltet bleibt nur,
/// was ein laufender Einsatz noch hält (die Datenbank ist maßgeblich).
pub async fn sync_store(state: &AppState, adapter_ids: &[String]) -> Result<(), AppError> {
    if adapter_ids.is_empty() {
        return Ok(());
    }
    let mut conn = state.pool.acquire().await?;
    for id in adapter_ids {
        let an = repo::is_active(&mut conn, id).await?;
        state.drohne.set_zugeschaltet(id, an);
    }
    Ok(())
}

/// Die Sicht auf eine Quelle. `zuschaltung` zählt nur in einem laufenden Einsatz (`laufend`):
/// ein abgeschlossener sieht weder Missionsname noch Videokennungen (Spec §7).
async fn sicht(
    state: &AppState,
    benutzer_id: i64,
    einsatz_id: i64,
    laufend: bool,
    a: &adapter_repo::Adapter,
    zuschaltung: Option<&Zuschaltung>,
) -> Result<DroneSourceView, AppError> {
    let zuschaltung = zuschaltung.filter(|_| laufend);
    let connected = zuschaltung.is_some();
    let mut held_by_other = None;
    let mut held_by_other_hidden = false;
    if !connected {
        let mut conn = state.pool.acquire().await?;
        if let Some(h) = repo::find_active_holder(&mut conn, &a.id).await? {
            if h != einsatz_id {
                drop(conn);
                held_by_other = halter_name(state, benutzer_id, h).await?;
                held_by_other_hidden = held_by_other.is_none();
            }
        }
    }
    let stand = if connected {
        state.drohne.get(&a.id)
    } else {
        None
    };
    Ok(DroneSourceView {
        adapter_id: a.id.clone(),
        label: a.name.clone(),
        connected,
        held_by_other,
        held_by_other_hidden,
        lagemonitor: zuschaltung.is_some_and(|z| z.lagemonitor),
        state: a.zustand.clone(),
        mission_name: stand.as_ref().and_then(|s| s.lage.mission_name.clone()),
        video_keys: stand
            .map(|s| s.lage.videos.iter().map(|v| v.key.clone()).collect())
            .unwrap_or_default(),
    })
}

/// GET /api/incidents/{id}/drone/sources — die Drohnenquellen der Organisation.
pub async fn liste(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff<Lagekarte>,
) -> Result<Json<Vec<DroneSourceView>>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let (adapter, zuschaltungen) = {
        let mut conn = state.pool.acquire().await?;
        (
            adapter_repo::list_in_org(&mut conn, ctx.einsatz.org_id).await?,
            repo::load_for_einsatz(&mut conn, einsatz_id).await?,
        )
    };
    let laufend = ctx.einsatz.status == crate::einsatz::EinsatzStatus::Aktiv;
    let mut aus = Vec::new();
    for a in adapter.iter().filter(|a| is_drohnen_art(&a.art)) {
        let z = zuschaltungen.iter().find(|z| z.adapter_id == a.id);
        aus.push(sicht(&state, ctx.benutzer.id, einsatz_id, laufend, a, z).await?);
    }
    Ok(Json(aus))
}

/// PUT /api/incidents/{id}/drone/sources/{aid} — zuschalten (oder die Lagemonitor-Wahl ändern).
pub async fn zuschalten(
    State(state): State<AppState>,
    ctx: EinsatzLeitungszugriff<Lagekarte>,
    PfadParam((_eid, adapter_id)): PfadParam<(i64, String)>,
    JsonBody(body): JsonBody<DroneSourceUpdate>,
) -> Result<Json<DroneSourceView>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let org_id = ctx.einsatz.org_id;
    let erfasser = ctx.benutzer.id;
    let startwert = einstellungen::etb_startwert(&state.pool, einsatz_id).await?;
    let now = jetzt();

    let (adapter, zuschaltung, etb_id) = crate::write_retry!(&state.pool, |conn| {
        let adapter = adapter_repo::load_in_org(conn, org_id, &adapter_id)
            .await?
            .ok_or(AppError::NotFound)?;
        if !is_drohnen_art(&adapter.art) {
            return Err(AppError::UnprocessableEntity(
                "Diese Quelle liefert kein Drohnenbild".into(),
            ));
        }
        // Prüfung und Schreiben in einer Transaktion: zwei gleichzeitige Zuschaltungen sehen
        // sich nicht vorbei (BEGIN IMMEDIATE).
        if let Some(halter) = repo::find_active_holder(conn, &adapter.id).await? {
            if halter != einsatz_id {
                return Err(AppError::Conflict(
                    "Die Drohnenquelle ist in einem anderen laufenden Einsatz zugeschaltet".into(),
                ));
            }
        }
        let vorher = repo::load_for_einsatz(conn, einsatz_id)
            .await?
            .into_iter()
            .find(|z| z.adapter_id == adapter.id);
        let z = Zuschaltung {
            adapter_id: adapter.id.clone(),
            einsatz_id,
            zugeschaltet_at: now.clone(),
            lagemonitor: body.lagemonitor,
        };
        repo::upsert(conn, &z).await?;
        let etb_id = if vorher.is_none() {
            Some(
                crate::etb::system_audit_tx(
                    conn,
                    einsatz_id,
                    erfasser,
                    startwert,
                    "Drohnenbild aus Suchlage zugeschaltet",
                )
                .await?,
            )
        } else {
            None
        };
        let z = vorher.map_or(z, |v| Zuschaltung {
            lagemonitor: body.lagemonitor,
            ..v
        });
        Ok((adapter, z, etb_id))
    })?;

    // Erst nach dem Commit: der Store ist nur das Abbild der Datenbank.
    state.drohne.set_zugeschaltet(&adapter.id, true);
    if let Some(id) = etb_id {
        state.live.publiziere(einsatz_id, id);
    }
    Ok(Json(
        sicht(
            &state,
            erfasser,
            einsatz_id,
            true,
            &adapter,
            Some(&zuschaltung),
        )
        .await?,
    ))
}

/// DELETE /api/incidents/{id}/drone/sources/{aid} — abschalten.
pub async fn abschalten(
    State(state): State<AppState>,
    ctx: EinsatzLeitungszugriff<Lagekarte>,
    PfadParam((_eid, adapter_id)): PfadParam<(i64, String)>,
) -> Result<StatusCode, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let org_id = ctx.einsatz.org_id;
    let erfasser = ctx.benutzer.id;
    let startwert = einstellungen::etb_startwert(&state.pool, einsatz_id).await?;

    let (etb_id, noch_gehalten) = crate::write_retry!(&state.pool, |conn| {
        let adapter = adapter_repo::load_in_org(conn, org_id, &adapter_id)
            .await?
            .ok_or(AppError::NotFound)?;
        let war = repo::delete(conn, &adapter.id, einsatz_id).await?;
        let etb_id = if war {
            Some(
                crate::etb::system_audit_tx(
                    conn,
                    einsatz_id,
                    erfasser,
                    startwert,
                    "Drohnenbild aus Suchlage abgeschaltet",
                )
                .await?,
            )
        } else {
            None
        };
        // Hält ein anderer laufender Einsatz die Quelle (etwa ein früher abgeschlossener
        // Einsatz hielt sie nicht), bleibt sie im Store an.
        let noch = repo::is_active(conn, &adapter.id).await?;
        Ok((etb_id, noch))
    })?;

    state.drohne.set_zugeschaltet(&adapter_id, noch_gehalten);
    if let Some(id) = etb_id {
        state.live.publiziere(einsatz_id, id);
    }
    Ok(StatusCode::NO_CONTENT)
}

/// GET /api/incidents/{id}/map/drone — die Drohnenlage als Fachebene (GeoJSON-Umschlag mit
/// ETag). Die erste Zuschaltung des Einsatzes zählt; ohne Zuschaltung, ohne Stand oder in einem
/// abgeschlossenen Einsatz ist die Ebene `offline`. Fotos vor dem Zuschalten fehlen.
pub async fn karte(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff<Lagekarte>,
    headers: HeaderMap,
) -> Result<Response, AppError> {
    let antwort = if ctx.einsatz.status != crate::einsatz::EinsatzStatus::Aktiv {
        crate::drohne::karte::offline()
    } else {
        let zuschaltungen = {
            let mut conn = state.pool.acquire().await?;
            repo::load_for_einsatz(&mut conn, ctx.einsatz.id).await?
        };
        let erste = zuschaltungen
            .iter()
            .filter_map(|z| {
                let ms = crate::zeit::parse_utc(&z.zugeschaltet_at)?.timestamp_millis();
                Some((ms, z))
            })
            .min_by_key(|(ms, _)| *ms);
        match erste {
            Some((ms, z)) => match state.drohne.get(&z.adapter_id) {
                Some(stand) => crate::drohne::karte::build_fachebene(&stand.lage, ms),
                None => crate::drohne::karte::offline(),
            },
            None => crate::drohne::karte::offline(),
        }
    };
    crate::routes::karte::fachebene_antwort(&antwort, &headers)
}

/// Ob `file` ein einfacher Dateiname ist: ein sicheres Segment ohne `..` darin.
fn is_dateiname(file: &str) -> bool {
    crate::drohne::is_safe_segment(file) && !file.contains("..")
}

/// Holt eine HLS-Datei der Quelle. Der `LiveKontext` entsteht hier, im Abruf, und fällt mit ihm
/// (`src/AGENTS.md`, „Adapter“): er geht nie ins Bündel.
async fn hls_abrufen(
    state: AppState,
    org_id: i64,
    adapter_id: String,
    gateway_sn: String,
    file: String,
) -> Result<axum::body::Bytes, VideoFehler> {
    use crate::adapter::live::{live_kontext, LiveVerweigert};
    use age::secrecy::ExposeSecret;

    let kontext = live_kontext(
        &state.pool,
        &state.adapter,
        &state.adapter.arten,
        org_id,
        &adapter_id,
        crate::drohne::ART,
    )
    .await
    .map_err(|v| match v {
        LiveVerweigert::Intern => VideoFehler::Intern,
        _ => VideoFehler::Verweigert,
    })?;
    let basis = kontext
        .einstellung_text("basis_url")
        .ok_or(VideoFehler::Verweigert)?;
    let token = kontext.geheimnis("token").ok_or(VideoFehler::Verweigert)?;
    // Tiefenverteidigung: auch was aus dem Speicher kommt, geht nur als sicheres Segment in den Pfad.
    if !crate::drohne::is_safe_segment(&gateway_sn) || !crate::drohne::is_safe_segment(&file) {
        return Err(VideoFehler::Upstream);
    }
    let url = format!(
        "{}/api/lagemonitor/v1/video/{gateway_sn}/hls/{file}",
        basis.trim_end_matches('/')
    );
    let fehl = |f: crate::adapter::art::Fehlschlag| {
        // Nur Code und Status, nie URL oder Seriennummer.
        tracing::warn!("Livebild-Abruf gescheitert: {:?}", f);
        VideoFehler::Upstream
    };
    let anfrage = kontext
        .get(&url)
        .map_err(fehl)?
        .bearer_auth(token.expose_secret());
    let antwort = kontext.send(anfrage).await.map_err(fehl)?;
    let is_playlist = crate::drohne::video::is_playlist(&file);
    let deckel = if is_playlist {
        DECKEL_PLAYLIST
    } else {
        DECKEL_VIDEO
    };
    let bytes = kontext.read_bytes(antwort, deckel).await.map_err(fehl)?;
    if is_playlist {
        let playlist_url = reqwest::Url::parse(&url).map_err(|_| VideoFehler::Upstream)?;
        return rewrite_playlist(&bytes, &playlist_url, kontext.lan_erlaubt(), false);
    }
    Ok(bytes)
}

/// GET /api/incidents/{id}/drone/video/{key}/hls/{*file} — das Livebild einer Drohnenquelle,
/// gebündelt: viele Zuschauer, ein Abruf je Datei. Die Quelle muss in diesem
/// laufenden Einsatz zugeschaltet sein und die Videokennung zu ihr gehören, sonst 404; die Query
/// der Anfrage wird verworfen.
pub async fn video(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff<Lagekarte>,
    PfadParam((_eid, key, file)): PfadParam<(i64, String, String)>,
) -> Result<Response, AppError> {
    // Ein abgeschlossener Einsatz hält keine Quelle (Spec §7), auch nicht mit einer übrig
    // gebliebenen Zeile.
    if ctx.einsatz.status != crate::einsatz::EinsatzStatus::Aktiv || !is_dateiname(&file) {
        return Err(AppError::NotFound);
    }
    let (Some(ttl), Some(content_type)) = (ttl_for(&file), content_type_for(&file)) else {
        return Err(AppError::NotFound);
    };
    let (adapter_id, gateway_sn) = state.drohne.find_video(&key).ok_or(AppError::NotFound)?;
    let zugeschaltet = {
        let mut conn = state.pool.acquire().await?;
        repo::load_for_einsatz(&mut conn, ctx.einsatz.id)
            .await?
            .iter()
            .any(|z| z.adapter_id == adapter_id)
    };
    if !zugeschaltet {
        return Err(AppError::NotFound);
    }
    let org_id = ctx.einsatz.org_id;
    let is_playlist = crate::drohne::video::is_playlist(&file);
    let schluessel = (adapter_id.clone(), key, file.clone());
    let bytes = buendel()
        .get_or_fetch(schluessel, ttl, move || {
            hls_abrufen(state, org_id, adapter_id, gateway_sn, file)
        })
        .await
        .map_err(|f| match f {
            VideoFehler::Verweigert => AppError::ServiceUnavailable("Kein Livebild".into()),
            VideoFehler::Intern => AppError::Internal("Livebild nicht abrufbar".into()),
            VideoFehler::Upstream | VideoFehler::Unbereinigbar => {
                AppError::BadGateway("Livebild nicht abrufbar".into())
            }
        })?;
    let cache = if is_playlist {
        "private, no-cache"
    } else {
        "private, max-age=30"
    };
    let mut antwort = Response::new(Body::from(bytes));
    let kopf = antwort.headers_mut();
    kopf.insert(
        header::CONTENT_TYPE,
        header::HeaderValue::from_static(content_type),
    );
    kopf.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        header::HeaderValue::from_static("nosniff"),
    );
    kopf.insert(
        header::CACHE_CONTROL,
        header::HeaderValue::from_static(cache),
    );
    Ok(antwort)
}

/// Holt die Vorschau eines Fotos und bereinigt sie. Der `LiveKontext` entsteht hier, im Abruf,
/// und fällt mit ihm (`src/AGENTS.md`, „Adapter“): ins Bündel kommen nur bereinigte Bytes.
async fn foto_abrufen(
    state: AppState,
    org_id: i64,
    adapter_id: String,
    thumb_url: String,
) -> Result<axum::body::Bytes, VideoFehler> {
    use crate::adapter::live::{live_kontext, LiveVerweigert};
    use age::secrecy::ExposeSecret;

    // Tiefenverteidigung: auch was aus dem Speicher kommt, hängt nur in der erwarteten Form an
    // die Basisadresse.
    if !crate::drohne::suchlage::is_thumb_pfad(&thumb_url) {
        return Err(VideoFehler::Upstream);
    }
    let kontext = live_kontext(
        &state.pool,
        &state.adapter,
        &state.adapter.arten,
        org_id,
        &adapter_id,
        crate::drohne::ART,
    )
    .await
    .map_err(|v| match v {
        LiveVerweigert::Intern => VideoFehler::Intern,
        _ => VideoFehler::Verweigert,
    })?;
    let basis = kontext
        .einstellung_text("basis_url")
        .ok_or(VideoFehler::Verweigert)?;
    let token = kontext.geheimnis("token").ok_or(VideoFehler::Verweigert)?;
    let url = format!("{}{thumb_url}", basis.trim_end_matches('/'));
    let fehl = |f: crate::adapter::art::Fehlschlag| {
        // Nur Code und Status, nie URL oder Token.
        tracing::warn!("Fotovorschau-Abruf gescheitert: {:?}", f);
        VideoFehler::Upstream
    };
    let anfrage = kontext
        .get(&url)
        .map_err(fehl)?
        .bearer_auth(token.expose_secret());
    let antwort = kontext.send(anfrage).await.map_err(fehl)?;
    let roh = kontext
        .read_bytes(antwort, DECKEL_FOTO)
        .await
        .map_err(fehl)?;
    drop(kontext);
    crate::drohne::foto::clean_thumb(&roh)
        .map(axum::body::Bytes::from)
        .map_err(|_| VideoFehler::Unbereinigbar)
}

/// GET /api/incidents/{id}/drone/photos/{key}/thumb — die Vorschau eines Drohnenfotos, bereinigt
/// und kurz gebündelt; nichts wird gespeichert. Die Quelle muss in diesem laufenden Einsatz
/// zugeschaltet sein, die Fotokennung zu ihr gehören und das Foto nicht vor der Zuschaltung
/// dieser Quelle entstanden sein, sonst 404.
pub async fn foto_vorschau(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff<Lagekarte>,
    PfadParam((_eid, key)): PfadParam<(i64, String)>,
) -> Result<Response, AppError> {
    if ctx.einsatz.status != crate::einsatz::EinsatzStatus::Aktiv {
        return Err(AppError::NotFound);
    }
    let (adapter_id, thumb_url) = state.drohne.find_photo(&key).ok_or(AppError::NotFound)?;
    let zuschaltungen = {
        let mut conn = state.pool.acquire().await?;
        repo::load_for_einsatz(&mut conn, ctx.einsatz.id).await?
    };
    let zuschalt_ms = zuschaltungen
        .iter()
        .find(|z| z.adapter_id == adapter_id)
        .and_then(|z| crate::zeit::parse_utc(&z.zugeschaltet_at))
        .map(|t| t.timestamp_millis())
        .ok_or(AppError::NotFound)?;
    let aufgenommen = state.drohne.get(&adapter_id).and_then(|s| {
        s.lage
            .fotos
            .iter()
            .find(|f| f.key == key)
            .map(|f| f.taken_at_ms)
    });
    if !aufgenommen.is_some_and(|ms| ms >= zuschalt_ms) {
        return Err(AppError::NotFound);
    }
    let org_id = ctx.einsatz.org_id;
    let schluessel = (
        adapter_id.clone(),
        key,
        crate::drohne::foto::DATEI.to_string(),
    );
    let bytes = crate::drohne::foto::buendel()
        .get_or_fetch(schluessel, crate::drohne::foto::TTL, move || {
            foto_abrufen(state, org_id, adapter_id, thumb_url)
        })
        .await
        .map_err(|f| match f {
            VideoFehler::Verweigert => AppError::ServiceUnavailable("Kein Foto".into()),
            VideoFehler::Intern => AppError::Internal("Foto nicht abrufbar".into()),
            VideoFehler::Upstream => AppError::BadGateway("Foto nicht abrufbar".into()),
            VideoFehler::Unbereinigbar => {
                AppError::UnprocessableEntity("Das Foto lässt sich nicht sicher anzeigen".into())
            }
        })?;
    let mut antwort = Response::new(Body::from(bytes));
    let kopf = antwort.headers_mut();
    kopf.insert(
        header::CONTENT_TYPE,
        header::HeaderValue::from_static("image/jpeg"),
    );
    kopf.insert(
        header::CONTENT_DISPOSITION,
        header::HeaderValue::from_static("inline"),
    );
    kopf.insert(
        header::CONTENT_SECURITY_POLICY,
        header::HeaderValue::from_static(crate::routes::support::ANHANG_CSP),
    );
    kopf.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        header::HeaderValue::from_static("nosniff"),
    );
    kopf.insert(
        header::CACHE_CONTROL,
        header::HeaderValue::from_static("private, max-age=300"),
    );
    Ok(antwort)
}
