//! Führung je Einsatz (LLH-1491, Spec `instanz-fuehrung`, Herleitung
//! `openspec/changes/archive/2026-11-09-v6hj7xl2-fuehrung-epoche/design.md`): Bedienung an einem lokalen Einsatz
//! (`/api/einsaetze/{id}/fuehrung/…`, Einsatzleitung oder Admin der Einsatz-Org) und an einer Akte
//! des Gegenübers (`/api/admin/instanz/fuehrung/{akte}/…`, Admin der Org). Regeln und
//! Transaktionen liegen in `instanz::fuehrung::dienst`. Ohne Schalter `LIFELINE_FUEHRUNG` 404.

use crate::app::AppState;
use crate::auth::admin_audit::{self, AdminAktion, AdminEintrag, Ziel, ZugangsAngaben};
use crate::auth::session::AdminUser;
use crate::auth::unterschrift::pruefen::{self, UnterschriftAssertion};
use crate::auth::unterschrift::repo as unterschrift;
use crate::auth::unterschrift::zeremonie::{self, Zeremonie};
use crate::auth::Benutzer;
use crate::einsatz::kontext::{EinsatzFuehrungszugriff, EinsatzLesezugriff};
use crate::error::AppError;
use crate::extract::{JsonBody, PeerIp, PfadParam};
use crate::instanz::code;
use crate::instanz::fuehrung::dienst::{self, FuehrungAnzeige};
use crate::instanz::fuehrung::erklaerung::{FuehrungBeweis, NotuebernahmeErklaerung};
use crate::instanz::fuehrung::repo::{self, AkteZeile};
use crate::instanz::fuehrung::{self as fuehrung};
use axum::extract::State;
use axum::Json;
use serde::{Deserialize, Serialize};
use std::net::IpAddr;
use utoipa::ToSchema;

#[derive(Debug, Deserialize)]
pub struct AnBody {
    /// Kennung des Gegenübers.
    pub an: String,
}

#[derive(Debug, Deserialize)]
pub struct GrundBody {
    pub grund: String,
}

#[derive(Debug, Deserialize)]
pub struct CodeBody {
    pub grund: String,
    pub code: String,
}

#[derive(Debug, Deserialize)]
pub struct AbschlussBody {
    pub zeremonie: String,
    pub assertion: UnterschriftAssertion,
}

/// Der Abgabecode, genau einmal angezeigt.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct FuehrungCodeAntwort {
    /// In Vierergruppen.
    pub code: String,
    pub fuehrung: FuehrungAnzeige,
}

/// Start der Unterschrift einer Notübernahme (wie die Gegenzeichnung, LLH-1490).
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct FuehrungUnterschriftStart {
    pub zeremonie: String,
    /// Challenge für `navigator.credentials.get` (Base64url): SHA-256 der Erklärung.
    pub challenge: String,
    pub rp_id: String,
    /// Die eigenen gültigen Unterschriftsschlüssel (Base64url), für `allowCredentials`.
    pub credential_ids: Vec<String>,
    /// Die Erklärung im Wortlaut.
    pub erklaerung: String,
}

// ── Gemeinsame Abläufe ───────────────────────────────────────────────────────────────────────

async fn anzeige(state: &AppState, akte_id: i64) -> Result<FuehrungAnzeige, AppError> {
    let mut conn = state.pool.acquire().await?;
    let a = repo::load(&mut conn, akte_id).await?;
    dienst::anzeige(&mut conn, &a).await
}

/// Nach einer Änderung: Live-Ereignis am Einsatzkopf (lokaler Einsatz) und die neue Anzeige.
async fn danach(state: &AppState, a: &AkteZeile) -> Result<FuehrungAnzeige, AppError> {
    if let Some(einsatz_id) = a.einsatz_id {
        crate::live::org::kopf_melden(&state.pool, &state.live, einsatz_id, &[]).await;
    }
    anzeige(state, a.id).await
}

async fn spur(
    state: &AppState,
    aktion: AdminAktion,
    benutzer: &Benutzer,
    a: &AkteZeile,
    grund: &str,
    peer_ip: Option<IpAddr>,
) {
    let einsatz = match &a.nummer {
        Some(n) => format!("{n} {}", a.bezeichnung),
        None => a.bezeichnung.clone(),
    };
    admin_audit::schreibe(
        &state.pool,
        AdminEintrag {
            aktion,
            akteur: benutzer,
            ziel: Ziel::Instanz(&a.fuehrer_name),
            angaben: Some(ZugangsAngaben {
                grund: Some(format!("{einsatz}: {grund}")),
                ..ZugangsAngaben::default()
            }),
            peer_ip,
        },
    )
    .await;
}

async fn akte_neu(state: &AppState, id: i64) -> Result<AkteZeile, AppError> {
    let mut conn = state.pool.acquire().await?;
    repo::load(&mut conn, id).await
}

async fn run_uebergeben(
    state: &AppState,
    a: &AkteZeile,
    b: &Benutzer,
    an: &str,
) -> Result<FuehrungAnzeige, AppError> {
    dienst::uebergeben(&state.pool, a.id, an, &b.anzeigename).await?;
    danach(state, &akte_neu(state, a.id).await?).await
}

async fn run_code(
    state: &AppState,
    a: &AkteZeile,
    b: &Benutzer,
    an: &str,
) -> Result<FuehrungCodeAntwort, AppError> {
    let c = dienst::code_abgeben(&state.pool, a.id, an, &b.anzeigename).await?;
    let fuehrung = danach(state, &akte_neu(state, a.id).await?).await?;
    Ok(FuehrungCodeAntwort {
        code: code::format_anzeige(&c),
        fuehrung,
    })
}

async fn run_anfragen(state: &AppState, a: &AkteZeile) -> Result<FuehrungAnzeige, AppError> {
    dienst::anfragen(&state.pool, a.id).await?;
    danach(state, &akte_neu(state, a.id).await?).await
}

async fn run_notuebernahme(
    state: &AppState,
    a: &AkteZeile,
    b: &Benutzer,
    grund: &str,
    peer_ip: Option<IpAddr>,
) -> Result<FuehrungAnzeige, AppError> {
    let vorher = a.fuehrer_name.clone();
    dienst::notuebernahme_gegen_erreichte(&state.pool, a.id, grund, &b.anzeigename).await?;
    let neu = akte_neu(state, a.id).await?;
    let text = format!("Notübernahme gegen {vorher}: {}", grund.trim());
    spur(
        state,
        AdminAktion::FuehrungNotuebernahme,
        b,
        &neu,
        &text,
        peer_ip,
    )
    .await;
    danach(state, &neu).await
}

async fn run_start(
    state: &AppState,
    a: &AkteZeile,
    b: &Benutzer,
    grund: &str,
) -> Result<FuehrungUnterschriftStart, AppError> {
    if !b.ist_admin() {
        return Err(AppError::Forbidden);
    }
    let (rp_id, _) = crate::auth::unterschrift::rp().ok_or_else(|| {
        AppError::NotImplemented("Passkeys sind an dieser Instanz nicht eingerichtet.".into())
    })?;
    let eigene = {
        let mut conn = state.pool.acquire().await?;
        unterschrift::list_gueltige_eigene(&mut conn, b.id).await?
    };
    if eigene.is_empty() {
        return Err(AppError::Conflict(
            "Ohne eigenen Unterschriftsschlüssel geht die Notübernahme nur mit dem Code des \
             Gegenübers. Unterschriftsschlüssel registrieren oder Code eingeben."
                .into(),
        ));
    }
    let e =
        dienst::build_erklaerung_gegen_meldende(&state.pool, a.id, grund, &b.anzeigename).await?;
    let erklaerung = e.to_text();
    let zeremonie = zeremonie::store(Zeremonie::Fuehrungserklaerung {
        benutzer_id: b.id,
        akte_id: a.id,
        erklaerung: erklaerung.clone(),
    })
    .map_err(|_| AppError::ServiceUnavailable("Zu viele laufende Unterschriften.".into()))?;
    Ok(FuehrungUnterschriftStart {
        zeremonie,
        challenge: pruefen::challenge(&erklaerung),
        rp_id: rp_id.to_string(),
        credential_ids: eigene.into_iter().map(|e| e.credential_id).collect(),
        erklaerung,
    })
}

async fn run_abschluss(
    state: &AppState,
    a: &AkteZeile,
    b: &Benutzer,
    body: &AbschlussBody,
    peer_ip: Option<IpAddr>,
) -> Result<FuehrungAnzeige, AppError> {
    let Some(Zeremonie::Fuehrungserklaerung {
        akte_id,
        erklaerung,
        ..
    }) = zeremonie::take(&body.zeremonie, b.id)
    else {
        return Err(AppError::Conflict(
            "Unterschrift abgelaufen oder unbekannt; bitte neu beginnen.".into(),
        ));
    };
    if akte_id != a.id {
        return Err(AppError::Validation(
            "Unterschrift gehört zu einem anderen Einsatz".into(),
        ));
    }
    let eigene = {
        let mut conn = state.pool.acquire().await?;
        unterschrift::list_gueltige_eigene(&mut conn, b.id).await?
    };
    let unterzeichner = eigene
        .iter()
        .find(|e| e.credential_id == body.assertion.credential_id)
        .ok_or_else(|| {
            AppError::UnprocessableEntity(
                "Unterschrieben mit einem Schlüssel, der kein gültiger eigener ist.".into(),
            )
        })?;
    pruefen::verify(
        &erklaerung,
        &body.assertion,
        &unterzeichner.pruef_schluessel(),
    )
    .map_err(|f| AppError::UnprocessableEntity(format!("Unterschrift ungültig: {f}")))?;
    let e = NotuebernahmeErklaerung::parse(&erklaerung)
        .ok_or_else(|| AppError::Internal("Erklärung unlesbar".into()))?;
    let vorher = a.fuehrer_name.clone();
    dienst::notuebernahme_gegen_meldende(
        &state.pool,
        a.id,
        &e,
        &FuehrungBeweis::Unterschrift {
            assertion: body.assertion.clone(),
        },
        &b.anzeigename,
    )
    .await?;
    let neu = akte_neu(state, a.id).await?;
    let text = format!("Notübernahme gegen {vorher} mit Unterschrift: {}", e.grund);
    spur(
        state,
        AdminAktion::FuehrungNotuebernahme,
        b,
        &neu,
        &text,
        peer_ip,
    )
    .await;
    danach(state, &neu).await
}

async fn run_mit_code(
    state: &AppState,
    a: &AkteZeile,
    b: &Benutzer,
    body: &CodeBody,
    peer_ip: Option<IpAddr>,
) -> Result<FuehrungAnzeige, AppError> {
    let vorher = a.fuehrer_name.clone();
    dienst::notuebernahme_mit_code(&state.pool, a.id, &body.grund, &body.code, &b.anzeigename)
        .await?;
    let neu = akte_neu(state, a.id).await?;
    let text = format!(
        "Notübernahme gegen {vorher} mit Code: {}",
        body.grund.trim()
    );
    spur(
        state,
        AdminAktion::FuehrungNotuebernahme,
        b,
        &neu,
        &text,
        peer_ip,
    )
    .await;
    danach(state, &neu).await
}

async fn run_bestaetigen(
    state: &AppState,
    a: &AkteZeile,
    b: &Benutzer,
    peer_ip: Option<IpAddr>,
) -> Result<FuehrungAnzeige, AppError> {
    dienst::bestaetigen(&state.pool, a.id, &b.anzeigename).await?;
    let neu = akte_neu(state, a.id).await?;
    let grund = neu
        .erklaerung
        .as_deref()
        .and_then(NotuebernahmeErklaerung::parse)
        .map(|e| e.grund)
        .unwrap_or_default();
    let text = format!("Notübernahme durch {} bestätigt: {grund}", neu.fuehrer_name);
    spur(
        state,
        AdminAktion::FuehrungNotuebernahme,
        b,
        &neu,
        &text,
        peer_ip,
    )
    .await;
    danach(state, &neu).await
}

async fn run_widersprechen(
    state: &AppState,
    a: &AkteZeile,
    b: &Benutzer,
    peer_ip: Option<IpAddr>,
) -> Result<FuehrungAnzeige, AppError> {
    dienst::widersprechen(&state.pool, a.id, &b.anzeigename).await?;
    let neu = akte_neu(state, a.id).await?;
    spur(
        state,
        AdminAktion::FuehrungWiderspruch,
        b,
        &neu,
        "Notübernahme widersprochen",
        peer_ip,
    )
    .await;
    danach(state, &neu).await
}

// ── Lokaler Einsatz ──────────────────────────────────────────────────────────────────────────

async fn akte_des_einsatzes(state: &AppState, einsatz_id: i64) -> Result<AkteZeile, AppError> {
    dienst::load_fuer_einsatz(&state.pool, einsatz_id).await
}

/// GET /api/einsaetze/{id}/fuehrung — Führung des Einsatzes samt Verlauf; wer den Einsatz liest.
pub async fn lesen(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff,
) -> Result<Json<FuehrungAnzeige>, AppError> {
    fuehrung::fordere_enabled(&state.pool).await?;
    let a = akte_des_einsatzes(&state, ctx.einsatz.id).await?;
    Ok(Json(anzeige(&state, a.id).await?))
}

/// POST /api/einsaetze/{id}/fuehrung/uebergeben — reguläre Übergabe an ein Gegenüber.
pub async fn uebergeben(
    State(state): State<AppState>,
    ctx: EinsatzFuehrungszugriff,
    JsonBody(body): JsonBody<AnBody>,
) -> Result<Json<FuehrungAnzeige>, AppError> {
    let a = akte_des_einsatzes(&state, ctx.einsatz.id).await?;
    Ok(Json(
        run_uebergeben(&state, &a, &ctx.benutzer, &body.an).await?,
    ))
}

/// POST /api/einsaetze/{id}/fuehrung/code — Abgabe per Code (meldende Seite).
pub async fn code_abgeben(
    State(state): State<AppState>,
    ctx: EinsatzFuehrungszugriff,
    JsonBody(body): JsonBody<AnBody>,
) -> Result<Json<FuehrungCodeAntwort>, AppError> {
    let a = akte_des_einsatzes(&state, ctx.einsatz.id).await?;
    Ok(Json(run_code(&state, &a, &ctx.benutzer, &body.an).await?))
}

/// POST /api/einsaetze/{id}/fuehrung/anfragen — die Führung beim Gegenüber erbitten.
pub async fn anfragen(
    State(state): State<AppState>,
    ctx: EinsatzFuehrungszugriff,
) -> Result<Json<FuehrungAnzeige>, AppError> {
    let a = akte_des_einsatzes(&state, ctx.einsatz.id).await?;
    Ok(Json(run_anfragen(&state, &a).await?))
}

/// POST /api/einsaetze/{id}/fuehrung/notuebernahme — gegen die erreichte Seite, mit Grund.
pub async fn notuebernahme(
    State(state): State<AppState>,
    PeerIp(peer_ip): PeerIp,
    ctx: EinsatzFuehrungszugriff,
    JsonBody(body): JsonBody<GrundBody>,
) -> Result<Json<FuehrungAnzeige>, AppError> {
    let a = akte_des_einsatzes(&state, ctx.einsatz.id).await?;
    Ok(Json(
        run_notuebernahme(&state, &a, &ctx.benutzer, &body.grund, peer_ip).await?,
    ))
}

/// POST /api/einsaetze/{id}/fuehrung/notuebernahme/start — Erklärung gegen die meldende Seite
/// zum Unterschreiben.
pub async fn notuebernahme_start(
    State(state): State<AppState>,
    ctx: EinsatzFuehrungszugriff,
    JsonBody(body): JsonBody<GrundBody>,
) -> Result<Json<FuehrungUnterschriftStart>, AppError> {
    let a = akte_des_einsatzes(&state, ctx.einsatz.id).await?;
    Ok(Json(
        run_start(&state, &a, &ctx.benutzer, &body.grund).await?,
    ))
}

/// POST /api/einsaetze/{id}/fuehrung/notuebernahme/abschluss — prüft die Unterschrift und
/// übernimmt.
pub async fn notuebernahme_abschluss(
    State(state): State<AppState>,
    PeerIp(peer_ip): PeerIp,
    ctx: EinsatzFuehrungszugriff,
    JsonBody(body): JsonBody<AbschlussBody>,
) -> Result<Json<FuehrungAnzeige>, AppError> {
    let a = akte_des_einsatzes(&state, ctx.einsatz.id).await?;
    Ok(Json(
        run_abschluss(&state, &a, &ctx.benutzer, &body, peer_ip).await?,
    ))
}

/// POST /api/einsaetze/{id}/fuehrung/notuebernahme/code — mit dem Abgabecode des Gegenübers.
pub async fn notuebernahme_code(
    State(state): State<AppState>,
    PeerIp(peer_ip): PeerIp,
    ctx: EinsatzFuehrungszugriff,
    JsonBody(body): JsonBody<CodeBody>,
) -> Result<Json<FuehrungAnzeige>, AppError> {
    let a = akte_des_einsatzes(&state, ctx.einsatz.id).await?;
    Ok(Json(
        run_mit_code(&state, &a, &ctx.benutzer, &body, peer_ip).await?,
    ))
}

/// POST /api/einsaetze/{id}/fuehrung/bestaetigen — offene Übernahme gelten lassen.
pub async fn bestaetigen(
    State(state): State<AppState>,
    PeerIp(peer_ip): PeerIp,
    ctx: EinsatzFuehrungszugriff,
) -> Result<Json<FuehrungAnzeige>, AppError> {
    let a = akte_des_einsatzes(&state, ctx.einsatz.id).await?;
    Ok(Json(
        run_bestaetigen(&state, &a, &ctx.benutzer, peer_ip).await?,
    ))
}

/// POST /api/einsaetze/{id}/fuehrung/widersprechen — offene Übernahme zurückweisen, weiter
/// führen.
pub async fn widersprechen(
    State(state): State<AppState>,
    PeerIp(peer_ip): PeerIp,
    ctx: EinsatzFuehrungszugriff,
) -> Result<Json<FuehrungAnzeige>, AppError> {
    let a = akte_des_einsatzes(&state, ctx.einsatz.id).await?;
    Ok(Json(
        run_widersprechen(&state, &a, &ctx.benutzer, peer_ip).await?,
    ))
}

// ── Akten des Gegenübers (Admin) ─────────────────────────────────────────────────────────────

async fn akte_fremd(state: &AppState, admin: &Benutzer, id: i64) -> Result<AkteZeile, AppError> {
    fuehrung::fordere_enabled(&state.pool).await?;
    dienst::load_fremde(&state.pool, admin.org_id, id).await
}

/// GET /api/admin/instanz/fuehrung — Einsätze beim Gegenüber (Akten ohne lokalen Einsatz).
pub async fn admin_liste(
    State(state): State<AppState>,
    AdminUser(admin): AdminUser,
) -> Result<Json<Vec<FuehrungAnzeige>>, AppError> {
    fuehrung::fordere_enabled(&state.pool).await?;
    crate::write_retry!(&state.pool, |conn| { repo::ensure_akten(conn).await })?;
    let mut conn = state.pool.acquire().await?;
    let mut aus = Vec::new();
    for a in repo::list_fremde_der_org(&mut conn, admin.org_id).await? {
        aus.push(dienst::anzeige(&mut conn, &a).await?);
    }
    Ok(Json(aus))
}

pub async fn admin_uebergeben(
    State(state): State<AppState>,
    AdminUser(admin): AdminUser,
    PfadParam(id): PfadParam<i64>,
    JsonBody(body): JsonBody<AnBody>,
) -> Result<Json<FuehrungAnzeige>, AppError> {
    let a = akte_fremd(&state, &admin, id).await?;
    Ok(Json(run_uebergeben(&state, &a, &admin, &body.an).await?))
}

pub async fn admin_code_abgeben(
    State(state): State<AppState>,
    AdminUser(admin): AdminUser,
    PfadParam(id): PfadParam<i64>,
    JsonBody(body): JsonBody<AnBody>,
) -> Result<Json<FuehrungCodeAntwort>, AppError> {
    let a = akte_fremd(&state, &admin, id).await?;
    Ok(Json(run_code(&state, &a, &admin, &body.an).await?))
}

pub async fn admin_anfragen(
    State(state): State<AppState>,
    AdminUser(admin): AdminUser,
    PfadParam(id): PfadParam<i64>,
) -> Result<Json<FuehrungAnzeige>, AppError> {
    let a = akte_fremd(&state, &admin, id).await?;
    Ok(Json(run_anfragen(&state, &a).await?))
}

pub async fn admin_notuebernahme(
    State(state): State<AppState>,
    AdminUser(admin): AdminUser,
    PeerIp(peer_ip): PeerIp,
    PfadParam(id): PfadParam<i64>,
    JsonBody(body): JsonBody<GrundBody>,
) -> Result<Json<FuehrungAnzeige>, AppError> {
    let a = akte_fremd(&state, &admin, id).await?;
    Ok(Json(
        run_notuebernahme(&state, &a, &admin, &body.grund, peer_ip).await?,
    ))
}

pub async fn admin_notuebernahme_start(
    State(state): State<AppState>,
    AdminUser(admin): AdminUser,
    PfadParam(id): PfadParam<i64>,
    JsonBody(body): JsonBody<GrundBody>,
) -> Result<Json<FuehrungUnterschriftStart>, AppError> {
    let a = akte_fremd(&state, &admin, id).await?;
    Ok(Json(run_start(&state, &a, &admin, &body.grund).await?))
}

pub async fn admin_notuebernahme_abschluss(
    State(state): State<AppState>,
    AdminUser(admin): AdminUser,
    PeerIp(peer_ip): PeerIp,
    PfadParam(id): PfadParam<i64>,
    JsonBody(body): JsonBody<AbschlussBody>,
) -> Result<Json<FuehrungAnzeige>, AppError> {
    let a = akte_fremd(&state, &admin, id).await?;
    Ok(Json(
        run_abschluss(&state, &a, &admin, &body, peer_ip).await?,
    ))
}

pub async fn admin_notuebernahme_code(
    State(state): State<AppState>,
    AdminUser(admin): AdminUser,
    PeerIp(peer_ip): PeerIp,
    PfadParam(id): PfadParam<i64>,
    JsonBody(body): JsonBody<CodeBody>,
) -> Result<Json<FuehrungAnzeige>, AppError> {
    let a = akte_fremd(&state, &admin, id).await?;
    Ok(Json(
        run_mit_code(&state, &a, &admin, &body, peer_ip).await?,
    ))
}

pub async fn admin_bestaetigen(
    State(state): State<AppState>,
    AdminUser(admin): AdminUser,
    PeerIp(peer_ip): PeerIp,
    PfadParam(id): PfadParam<i64>,
) -> Result<Json<FuehrungAnzeige>, AppError> {
    let a = akte_fremd(&state, &admin, id).await?;
    Ok(Json(run_bestaetigen(&state, &a, &admin, peer_ip).await?))
}

pub async fn admin_widersprechen(
    State(state): State<AppState>,
    AdminUser(admin): AdminUser,
    PeerIp(peer_ip): PeerIp,
    PfadParam(id): PfadParam<i64>,
) -> Result<Json<FuehrungAnzeige>, AppError> {
    let a = akte_fremd(&state, &admin, id).await?;
    Ok(Json(run_widersprechen(&state, &a, &admin, peer_ip).await?))
}
