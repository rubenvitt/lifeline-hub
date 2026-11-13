//! Webhook einer Anbindung verwalten (LLH-1656, Spec `webhook-zustellung`, design.md D8).
//!
//! Lesen darf, wer den Admin-Bereich sieht; einrichten, ändern, entfernen, wieder aufnehmen und
//! ein Testereignis senden nur der System-Admin, immer für die eigene Org. Jede Änderung schreibt
//! nach ihrem Commit genau einen Eintrag in die Admin-Spur, das Umschalten der LAN-Ausnahme einen
//! eigenen. Das Testereignis ändert nichts am Zugang und schreibt keinen.
//!
//! Zugestellt wird im Hintergrund (`public_api::webhook::lauf`), nicht hier.

use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use serde::{Deserialize, Serialize};
use sqlx::SqliteConnection;
use utoipa::ToSchema;

use crate::app::AppState;
use crate::auth::admin_audit::{self, AdminAktion, AdminEintrag, Ziel, ZugangsAngaben};
use crate::auth::session::{AdminUser, CurrentUser};
use crate::auth::Benutzer;
use crate::error::AppError;
use crate::extract::{JsonBody, PeerIp, PfadParam};
use crate::public_api::events::EventType;
use crate::public_api::scope::ZugangZustand;
use crate::public_api::webhook::lauf::testereignis;
use crate::public_api::webhook::repo::{self, Eingabe, Versuch, Webhook};
use crate::public_api::webhook::ziel::{self, host_von, HttpZusteller};
use crate::public_api::webhook::{ruht_grund, RuhtGrund, WebhookFehler, WebhookZustand, URL_MAX};
use crate::public_api::zugang::{self, Zugang};
use crate::routes::anbindungen::gesperrt_grund;

/// Der letzte Fehlschlag eines Webhooks.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct WebhookLetzterFehler {
    pub at: String,
    /// HTTP-Status, falls das Ziel antwortete.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<i64>,
    pub art: WebhookFehler,
}

/// Der Webhook einer Anbindung, wie die Verwaltung ihn zeigt.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct WebhookAnzeige {
    /// Kennung des Webhooks; zugleich `aud` jeder Signatur, gegen die der Empfänger prüft.
    pub id: String,
    /// Die ganze Ziel-URL; nur für den System-Admin, weil ihr Pfad ein Token tragen kann.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    /// Der Server des Ziels; sieht jeder, der die Anbindung sieht.
    pub host: String,
    pub arten: Vec<EventType>,
    pub lan_erlaubt: bool,
    pub zustand: WebhookZustand,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ruht_grund: Option<RuhtGrund>,
    /// Erster Fehlschlag der laufenden Störung.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fehler_seit: Option<String>,
    pub fehlversuche: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub naechster_versuch_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub letzter_fehler: Option<WebhookLetzterFehler>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub letzter_erfolg_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub angehalten_at: Option<String>,
    /// Ereignisse gingen verloren, bevor sie zugestellt waren; der Empfänger muss den Stand über
    /// die Leserouten neu lesen.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub verlust_at: Option<String>,
    pub angelegt_at: String,
    /// Optimistisches Lock für Änderungen.
    pub geaendert_at: String,
}

impl WebhookAnzeige {
    /// `mit_url`: die ganze URL nur für den System-Admin (Entscheidung Ruben 13.11.2026).
    pub fn aus(w: &Webhook, z: &Zugang, jetzt: &str, mit_url: bool) -> Self {
        let ruht = ruht_grund(z, jetzt);
        let zustand = if w.is_angehalten() {
            WebhookZustand::Angehalten
        } else if ruht.is_some() {
            WebhookZustand::Ruht
        } else if w.fehler_seit.is_some() {
            WebhookZustand::Fehler
        } else {
            WebhookZustand::Aktiv
        };
        let letzter_fehler = match (&w.letzter_fehler_at, w.letzter_fehler()) {
            (Some(at), Some(art)) => Some(WebhookLetzterFehler {
                at: at.clone(),
                status: w.letzter_fehler_status,
                art,
            }),
            _ => None,
        };
        WebhookAnzeige {
            id: w.id.clone(),
            url: mit_url.then(|| w.url.clone()),
            host: host_von(&w.url).unwrap_or_default(),
            arten: w.arten(),
            lan_erlaubt: w.lan_erlaubt,
            zustand,
            ruht_grund: ruht,
            fehler_seit: w.fehler_seit.clone(),
            fehlversuche: w.fehlversuche,
            naechster_versuch_at: w.naechster_versuch_at.clone(),
            letzter_fehler,
            letzter_erfolg_at: w.letzter_erfolg_at.clone(),
            angehalten_at: w.angehalten_at.clone(),
            verlust_at: w.verlust_at.clone(),
            angelegt_at: w.angelegt_at.clone(),
            geaendert_at: w.geaendert_at.clone(),
        }
    }

    /// Der Webhook des Zugangs, falls es einen gibt.
    pub async fn load(
        conn: &mut SqliteConnection,
        z: &Zugang,
        jetzt: &str,
        mit_url: bool,
    ) -> Result<Option<Self>, AppError> {
        Ok(repo::load_by_zugang(conn, &z.id)
            .await?
            .map(|w| Self::aus(&w, z, jetzt, mit_url)))
    }
}

/// Ein Zustellversuch im Verlauf. Der Rumpf der Antwort wird nie gespeichert.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct WebhookVersuch {
    pub at: String,
    /// Nummer des Ereignisses; fehlt beim Testereignis.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ereignis_id: Option<i64>,
    pub test: bool,
    pub erfolg: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fehler_art: Option<WebhookFehler>,
    pub dauer_ms: i64,
}

impl WebhookVersuch {
    fn aus(v: Versuch) -> Self {
        let fehler_art = v.fehler_art.as_deref().and_then(WebhookFehler::parse);
        WebhookVersuch {
            at: v.at,
            ereignis_id: v.ereignis_id,
            test: v.test,
            erfolg: v.fehler_art.is_none(),
            status: v.status,
            fehler_art,
            dauer_ms: v.dauer_ms,
        }
    }
}

/// Ergebnis eines Testereignisses.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct WebhookTestErgebnis {
    pub erfolg: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fehler_art: Option<WebhookFehler>,
    pub dauer_ms: i64,
}

/// Eingabe beim Einrichten.
#[derive(Debug, Clone, Deserialize, ToSchema)]
pub struct WebhookEingabe {
    pub url: String,
    pub arten: Vec<String>,
    #[serde(default)]
    pub lan_erlaubt: bool,
}

/// Änderung; nur die gesendeten Felder.
#[derive(Debug, Clone, Deserialize, ToSchema)]
pub struct WebhookAenderung {
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub arten: Option<Vec<String>>,
    #[serde(default)]
    pub lan_erlaubt: Option<bool>,
    /// Optimistisches Lock: `geaendert_at` beim Öffnen. Weicht er ab → 409; fehlt er („Meine
    /// Änderung übernehmen“ nach der Rückfrage), wird ohne Vergleich geschrieben.
    #[serde(default)]
    pub basis_geaendert_at: Option<String>,
}

/// Ziel-URL: Pflicht, höchstens [`URL_MAX`] Zeichen, und sie besteht den Ziel-Schutz (400).
fn check_url(roh: &str, lan_erlaubt: bool) -> Result<String, AppError> {
    let url = crate::routes::support::pflicht_max(roh, "url", URL_MAX)?;
    ziel::check_url(&url, lan_erlaubt)
        .map_err(|f| AppError::Validation(format!("url: {}", f.text())))?;
    Ok(url)
}

/// Mindestens eine bekannte Art, ohne Dopplung (400).
fn check_arten(roh: &[String]) -> Result<Vec<EventType>, AppError> {
    if roh.is_empty() {
        return Err(AppError::Validation(
            "arten: mindestens eine Ereignisart wählen".into(),
        ));
    }
    let mut arten = Vec::new();
    for a in roh {
        let art = EventType::parse(a)
            .ok_or_else(|| AppError::Validation(format!("arten: unbekannte Art „{a}“")))?;
        if !arten.contains(&art) {
            arten.push(art);
        }
    }
    Ok(arten)
}

/// Der Zugang der eigenen Org; ein widerrufener nimmt keinen Webhook mehr an (409).
async fn zugang_fuer_schreiben(
    conn: &mut SqliteConnection,
    org_id: i64,
    id: &str,
) -> Result<Zugang, AppError> {
    if let Some(grund) = gesperrt_grund(&mut *conn, org_id).await? {
        return Err(AppError::Conflict(grund));
    }
    let z = zugang::laden_in_org(&mut *conn, org_id, id)
        .await?
        .ok_or(AppError::NotFound)?;
    if z.zustand == ZugangZustand::Widerrufen {
        return Err(AppError::Conflict(
            "Eine widerrufene Anbindung bekommt keinen Webhook mehr.".into(),
        ));
    }
    Ok(z)
}

async fn spur(
    state: &AppState,
    admin: &Benutzer,
    aktion: AdminAktion,
    zugang: &Zugang,
    url: &str,
    peer_ip: Option<std::net::IpAddr>,
) {
    admin_audit::schreibe(
        &state.pool,
        AdminEintrag {
            aktion,
            akteur: admin,
            ziel: Ziel::Maschinenzugang(&zugang.name),
            angaben: Some(ZugangsAngaben {
                zugang_id: Some(zugang.id.clone()),
                host: host_von(url),
                ..Default::default()
            }),
            peer_ip,
        },
    )
    .await;
}

/// POST /api/admin/anbindungen/{id}/webhook — richtet den Webhook ein (201). Schon einer da: 409.
/// Admin-Spur `maschinenzugang_webhook_angelegt`, mit LAN-Ausnahme zusätzlich `…_lan_erlaubt`.
pub async fn create(
    State(state): State<AppState>,
    AdminUser(admin): AdminUser,
    PeerIp(peer_ip): PeerIp,
    PfadParam(id): PfadParam<String>,
    JsonBody(body): JsonBody<WebhookEingabe>,
) -> Result<(StatusCode, Json<WebhookAnzeige>), AppError> {
    let jetzt = crate::zeit::jetzt();
    let eingabe = Eingabe {
        url: check_url(&body.url, body.lan_erlaubt)?,
        arten: check_arten(&body.arten)?,
        lan_erlaubt: body.lan_erlaubt,
    };
    let org_id = admin.org_id;
    let (z, w) = crate::write_retry!(&state.pool, |conn| {
        let z = zugang_fuer_schreiben(&mut *conn, org_id, &id).await?;
        let w = repo::create(&mut *conn, &z.id, &eingabe, &jetzt).await?;
        Ok((z, w))
    })?;
    spur(
        &state,
        &admin,
        AdminAktion::MaschinenzugangWebhookAngelegt,
        &z,
        &w.url,
        peer_ip,
    )
    .await;
    if w.lan_erlaubt {
        spur(
            &state,
            &admin,
            AdminAktion::MaschinenzugangWebhookLanErlaubt,
            &z,
            &w.url,
            peer_ip,
        )
        .await;
    }
    Ok((
        StatusCode::CREATED,
        Json(WebhookAnzeige::aus(&w, &z, &jetzt, true)),
    ))
}

/// PATCH /api/admin/anbindungen/{id}/webhook — ändert Ziel, Arten oder LAN-Ausnahme; Konflikt
/// über `basis_geaendert_at` (409). Admin-Spur `…_geaendert` bei geändertem Ziel oder geänderten
/// Arten, `…_lan_erlaubt`/`…_lan_entzogen` beim Umschalten der Ausnahme.
pub async fn update(
    State(state): State<AppState>,
    AdminUser(admin): AdminUser,
    PeerIp(peer_ip): PeerIp,
    PfadParam(id): PfadParam<String>,
    JsonBody(body): JsonBody<WebhookAenderung>,
) -> Result<Json<WebhookAnzeige>, AppError> {
    let jetzt = crate::zeit::jetzt();
    let arten = body.arten.as_deref().map(check_arten).transpose()?;
    let org_id = admin.org_id;
    let (z, vorher, nachher) = crate::write_retry!(&state.pool, |conn| {
        let z = zugang_fuer_schreiben(&mut *conn, org_id, &id).await?;
        let vorher = repo::load_by_zugang(&mut *conn, &z.id)
            .await?
            .ok_or(AppError::NotFound)?;
        let lan_erlaubt = body.lan_erlaubt.unwrap_or(vorher.lan_erlaubt);
        // Auch ein unverändertes Ziel wird mit der neuen Ausnahme geprüft: ohne sie darf ein
        // LAN-Ziel nicht stehen bleiben.
        let url = check_url(body.url.as_deref().unwrap_or(&vorher.url), lan_erlaubt)?;
        let eingabe = Eingabe {
            url,
            arten: arten.clone().unwrap_or_else(|| vorher.arten()),
            lan_erlaubt,
        };
        let (vorher, nachher) = repo::update(
            &mut *conn,
            &z.id,
            body.basis_geaendert_at.as_deref(),
            &eingabe,
            &jetzt,
        )
        .await?
        .ok_or(AppError::NotFound)?;
        Ok((z, vorher, nachher))
    })?;
    if vorher.url != nachher.url || vorher.arten_json != nachher.arten_json {
        spur(
            &state,
            &admin,
            AdminAktion::MaschinenzugangWebhookGeaendert,
            &z,
            &nachher.url,
            peer_ip,
        )
        .await;
    }
    if vorher.lan_erlaubt != nachher.lan_erlaubt {
        let aktion = if nachher.lan_erlaubt {
            AdminAktion::MaschinenzugangWebhookLanErlaubt
        } else {
            AdminAktion::MaschinenzugangWebhookLanEntzogen
        };
        spur(&state, &admin, aktion, &z, &nachher.url, peer_ip).await;
    }
    Ok(Json(WebhookAnzeige::aus(&nachher, &z, &jetzt, true)))
}

/// DELETE /api/admin/anbindungen/{id}/webhook — entfernt den Webhook samt Verlauf (204).
/// Admin-Spur `maschinenzugang_webhook_entfernt`.
pub async fn delete(
    State(state): State<AppState>,
    AdminUser(admin): AdminUser,
    PeerIp(peer_ip): PeerIp,
    PfadParam(id): PfadParam<String>,
) -> Result<StatusCode, AppError> {
    let org_id = admin.org_id;
    let (z, w) = crate::write_retry!(&state.pool, |conn| {
        if let Some(grund) = gesperrt_grund(&mut *conn, org_id).await? {
            return Err(AppError::Conflict(grund));
        }
        let z = zugang::laden_in_org(&mut *conn, org_id, &id)
            .await?
            .ok_or(AppError::NotFound)?;
        let w = repo::delete(&mut *conn, &z.id)
            .await?
            .ok_or(AppError::NotFound)?;
        Ok((z, w))
    })?;
    spur(
        &state,
        &admin,
        AdminAktion::MaschinenzugangWebhookEntfernt,
        &z,
        &w.url,
        peer_ip,
    )
    .await;
    Ok(StatusCode::NO_CONTENT)
}

/// POST /api/admin/anbindungen/{id}/webhook/wieder-aufnehmen — nur aus „angehalten“, sonst 409.
/// Admin-Spur `maschinenzugang_webhook_wieder_aufgenommen`.
pub async fn wieder_aufnehmen(
    State(state): State<AppState>,
    AdminUser(admin): AdminUser,
    PeerIp(peer_ip): PeerIp,
    PfadParam(id): PfadParam<String>,
) -> Result<Json<WebhookAnzeige>, AppError> {
    let jetzt = crate::zeit::jetzt();
    let org_id = admin.org_id;
    let (z, w) = crate::write_retry!(&state.pool, |conn| {
        let z = zugang_fuer_schreiben(&mut *conn, org_id, &id).await?;
        let w = repo::wieder_aufnehmen(&mut *conn, &z.id, &jetzt)
            .await?
            .ok_or(AppError::NotFound)?;
        Ok((z, w))
    })?;
    spur(
        &state,
        &admin,
        AdminAktion::MaschinenzugangWebhookWiederAufgenommen,
        &z,
        &w.url,
        peer_ip,
    )
    .await;
    Ok(Json(WebhookAnzeige::aus(&w, &z, &jetzt, true)))
}

/// POST /api/admin/anbindungen/{id}/webhook/test — sendet ein signiertes `ping` und wartet auf
/// die Antwort. Cursor, Zustand und Wartezeit bleiben; kein Eintrag in der Admin-Spur.
pub async fn test(
    State(state): State<AppState>,
    AdminUser(admin): AdminUser,
    PfadParam(id): PfadParam<String>,
) -> Result<Json<WebhookTestErgebnis>, AppError> {
    let w = {
        let mut conn = state.pool.acquire().await?;
        let z = zugang_fuer_schreiben(&mut conn, admin.org_id, &id).await?;
        repo::load_by_zugang(&mut conn, &z.id)
            .await?
            .ok_or(AppError::NotFound)?
    };
    let e = testereignis(&state.pool, &HttpZusteller, &w, chrono::Utc::now()).await?;
    Ok(Json(WebhookTestErgebnis {
        erfolg: e.is_erfolg(),
        status: e.status.map(i64::from),
        fehler_art: e.fehler,
        dauer_ms: e.dauer_ms,
    }))
}

/// GET /api/admin/anbindungen/{id}/webhook/versuche — die letzten Zustellversuche, neueste
/// zuerst.
pub async fn versuche(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    PfadParam(id): PfadParam<String>,
) -> Result<Json<Vec<WebhookVersuch>>, AppError> {
    if !benutzer.darf_admin_bereich() {
        return Err(AppError::Forbidden);
    }
    let mut conn = state.pool.acquire().await?;
    let z = zugang::laden_in_org(&mut conn, benutzer.org_id, &id)
        .await?
        .ok_or(AppError::NotFound)?;
    let w = repo::load_by_zugang(&mut conn, &z.id)
        .await?
        .ok_or(AppError::NotFound)?;
    Ok(Json(
        repo::versuche(&mut conn, &w.id)
            .await?
            .into_iter()
            .map(WebhookVersuch::aus)
            .collect(),
    ))
}
