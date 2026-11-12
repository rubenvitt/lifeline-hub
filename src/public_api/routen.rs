//! Routen des Maschinenzugangs unter `/api/v1/` (LLH-1652, Spec `maschinenzugang`, design.md
//! D12): Einlösen eines Codes, Prüfroute und öffentlicher Instanzschlüssel.

use super::error::{ApiError, ErrorCode};
use super::machine::MachineClient;
use super::scope::Scope;
use super::zugang;
use crate::app::AppState;
use crate::auth::admin_audit::{self, AdminAktion, Ziel, ZugangsAngaben};
use crate::auth::rate_limit;
use crate::extract::PeerIp;
use crate::instanz::basis32::{fingerabdruck, parse_b64};
use crate::instanz::code as kcode;
use crate::instanz::identitaet::{self, parse_oeffentlich};
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::Response;
use axum::Json;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// Öffentlicher Ed25519-Schlüssel als JWK (RFC 8037).
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct Jwk {
    /// Immer `OKP`.
    pub kty: String,
    /// Immer `Ed25519`.
    pub crv: String,
    /// Die 32 Bytes des Schlüssels, Base64url ohne Auffüllung.
    pub x: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kid: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none", rename = "use")]
    pub verwendung: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub alg: Option<String>,
}

impl Jwk {
    fn instanz(i: &identitaet::Identitaet) -> Self {
        Jwk {
            kty: "OKP".into(),
            crv: "Ed25519".into(),
            x: i.oeffentlich_b64(),
            kid: Some(i.kennung.clone()),
            verwendung: Some("sig".into()),
            alg: Some("EdDSA".into()),
        }
    }
}

/// Body von `POST /api/v1/zugang/redeem`. Der Code selbst geht nie über die Leitung.
#[derive(Debug, Deserialize, ToSchema)]
pub struct RedeemRequest {
    /// Aus dem Code abgeleiteter Suchwert (HKDF-SHA256, Salz `lifeline-machine-client/1`,
    /// Info `suche`).
    pub lookup: String,
    /// Öffentlicher Schlüssel des Fremdsystems.
    pub public_key: Jwk,
    /// HMAC-SHA256 über das Transkript `machine-einloeser` mit dem Schlüssel `einloeser`.
    pub proof: String,
}

/// Antwort auf das Einlösen.
#[derive(Debug, Serialize, ToSchema)]
pub struct RedeemResponse {
    /// Kennung des Zugangs: `kid` und `iss` jeder Anfrage.
    pub zugang_id: String,
    /// Kennung dieser Instanz: `aud` jeder Anfrage.
    pub instanz_id: String,
    /// Schlüssel, mit dem die Instanz ihre Antworten signiert.
    pub instanz_public_key: Jwk,
    /// HMAC-SHA256 über das Transkript `machine-aussteller` mit dem Schlüssel `aussteller`:
    /// beweist, dass diese Instanz den Code ausgestellt hat.
    pub proof: String,
}

/// Org eines Zugangs.
#[derive(Debug, Serialize, ToSchema)]
pub struct MeOrg {
    pub id: i64,
    pub name: String,
}

/// Antwort der Prüfroute.
#[derive(Debug, Serialize, ToSchema)]
pub struct MeResponse {
    pub zugang_id: String,
    pub name: String,
    pub org: MeOrg,
    pub scopes: Vec<Scope>,
    /// Ablauf des Zugangs (UTC, `JJJJ-MM-TT hh:mm:ss`); ohne Ablauf `null`.
    pub valid_until_at: Option<String>,
    /// Serverzeit (UTC, `JJJJ-MM-TT hh:mm:ss`).
    pub server_time_at: String,
    /// Serverzeit minus `iat` dieser Anfrage in Sekunden. Positiv: die Uhr des Fremdsystems geht
    /// nach. Ab ±300 s scheitern Anfragen.
    pub clock_offset_s: i64,
}

/// JWKS dieser Instanz.
#[derive(Debug, Serialize, ToSchema)]
pub struct Jwks {
    pub keys: Vec<Jwk>,
}

fn unauthorized() -> ApiError {
    ApiError::new(ErrorCode::Unauthorized, "Anmeldung fehlgeschlagen")
}

/// Einen Einmal-Code einlösen und den Schlüssel des Fremdsystems an den Zugang binden.
#[utoipa::path(
    post,
    path = "/api/v1/zugang/redeem",
    tag = "Anmeldung",
    operation_id = "redeem_zugang",
    request_body = RedeemRequest,
    responses(
        (status = 200, description = "Schlüssel gebunden", body = RedeemResponse),
        (status = 400, description = "Schlüssel unlesbar", body = super::ApiErrorBody),
        (status = 401, description = "Code unbekannt, abgelaufen, schon eingelöst oder Prüfwert falsch", body = super::ApiErrorBody),
        (status = 429, description = "Zu viele gescheiterte Einlösungen von dieser Quelle", body = super::ApiErrorBody),
        (status = "default", description = "Fehler mit stabilem `code`", body = super::ApiErrorBody),
    ),
)]
pub async fn redeem(
    State(state): State<AppState>,
    PeerIp(peer_ip): PeerIp,
    crate::extract::JsonBody(body): crate::extract::JsonBody<RedeemRequest>,
) -> Result<Json<RedeemResponse>, ApiError> {
    let fehlversuch = || {
        if let Some(ip) = peer_ip {
            rate_limit::maschine::fehlversuch(ip);
        }
    };
    if let Some(ip) = peer_ip {
        if matches!(
            rate_limit::maschine::sperre(ip),
            rate_limit::Sperre::Gesperrt { .. }
        ) {
            return Err(ApiError::rate_limited(60));
        }
    }
    let pk = &body.public_key;
    if pk.kty != "OKP" || pk.crv != "Ed25519" || parse_oeffentlich(&pk.x).is_none() {
        return Err(ApiError::new(
            ErrorCode::InvalidField,
            "public_key: kein Ed25519-Schlüssel (kty OKP, crv Ed25519, x mit 32 Bytes)",
        ));
    }
    let jetzt = crate::zeit::jetzt();

    let code = {
        let mut conn = state.pool.acquire().await?;
        zugang::find_offener_code(&mut conn, &body.lookup, &jetzt).await?
    };
    let Some(code) = code else {
        fehlversuch();
        return Err(unauthorized());
    };
    if !kcode::is_pruefwert_valid(
        &code.k_einloeser,
        &kcode::transkript_machine_einloeser(&body.lookup, &pk.x),
        &body.proof,
    ) {
        fehlversuch();
        return Err(unauthorized());
    }

    let lookup = body.lookup.clone();
    let schluessel = pk.x.clone();
    let zugang_id = code.zugang_id.clone();
    /// Was das Einlösen ergab.
    enum Einloesung {
        Gebunden(zugang::Zugang, Option<String>),
        /// Ein anderer hat den Code gerade eingelöst.
        Verbraucht,
        /// Die Org meldet sich bei einem Hub (Konzept D8): der Code bleibt offen.
        AmElw(zugang::Zugang),
    }
    let ergebnis = crate::write_retry!(&state.pool, |conn| {
        let z = zugang::laden(&mut *conn, &zugang_id)
            .await?
            .ok_or(crate::error::AppError::NotFound)?;
        // Vor dem Verbrauch: am gekoppelten ELW bleibt der Code einlösbar, falls die Kopplung
        // endet, und der Grund steht am Zugang.
        if zugang::hub_fuer_org(&mut *conn, z.org_id).await?.is_some() {
            return Ok(Einloesung::AmElw(z));
        }
        if !zugang::consume_code(&mut *conn, &lookup, &jetzt).await? {
            return Ok(Einloesung::Verbraucht);
        }
        let vorher = zugang::schluessel_binden(&mut *conn, &zugang_id, &schluessel).await?;
        Ok(Einloesung::Gebunden(z, vorher))
    })?;
    let (z, vorher) = match ergebnis {
        Einloesung::Gebunden(z, vorher) => (z, vorher),
        Einloesung::Verbraucht => return Err(unauthorized()),
        Einloesung::AmElw(z) => {
            zugang::ablehnung_festhalten(
                &state.pool,
                &z.id,
                super::scope::AblehnungGrund::InstanzGekoppelt,
                None,
                &jetzt,
            )
            .await?;
            return Err(unauthorized());
        }
    };

    let fp = |b64: &str| parse_b64(b64).map(|b| fingerabdruck(&b));
    admin_audit::schreibe_ohne_akteur(
        &state.pool,
        AdminAktion::MaschinenzugangSchluesselGebunden,
        z.org_id,
        &z.name,
        Ziel::Maschinenzugang(&z.name),
        Some(ZugangsAngaben {
            zugang_id: Some(z.id.clone()),
            scopes: Some(z.scopes.iter().map(|s| s.as_str().to_string()).collect()),
            fingerabdruck: fp(&schluessel),
            fingerabdruck_vorher: vorher.as_deref().and_then(fp),
            ..Default::default()
        }),
        peer_ip,
    )
    .await;

    let i = identitaet::load_or_create(&state.pool)
        .await
        .map_err(|e| crate::error::AppError::Internal(e.to_string()))?;
    let proof = kcode::pruefwert(
        &code.k_aussteller,
        &kcode::transkript_machine_aussteller(
            &lookup,
            &schluessel,
            &i.kennung,
            &i.oeffentlich_b64(),
            &z.id,
        ),
    );
    Ok(Json(RedeemResponse {
        zugang_id: z.id,
        instanz_id: i.kennung.clone(),
        instanz_public_key: Jwk::instanz(&i),
        proof,
    }))
}

/// Prüfroute: Zugang, Org, Scopes, Serverzeit und Abweichung der Uhr. Der erste Aufruf jeder
/// Anbindung.
#[utoipa::path(
    get,
    path = "/api/v1/me",
    tag = "Anmeldung",
    operation_id = "get_me",
    security(("machine" = [])),
    responses(
        (status = 200, description = "Angemeldet; Antwort signiert im Kopf `Lifeline-Signature`", body = MeResponse),
        (status = 401, description = "Anmeldung fehlgeschlagen (Grund nur am Zugang)", body = super::ApiErrorBody),
        (status = 429, description = "Gedrosselt; `Retry-After` nennt die Wartezeit", body = super::ApiErrorBody),
        (status = "default", description = "Fehler mit stabilem `code`", body = super::ApiErrorBody),
    ),
)]
pub async fn me(
    State(state): State<AppState>,
    client: MachineClient,
) -> Result<Response, ApiError> {
    let org_name: Option<String> = sqlx::query_scalar("SELECT name FROM organisation WHERE id = ?")
        .bind(client.zugang.org_id)
        .fetch_optional(&state.pool)
        .await?;
    let z = &client.zugang;
    Ok(client.antwort(
        StatusCode::OK,
        &MeResponse {
            zugang_id: z.id.clone(),
            name: z.name.clone(),
            org: MeOrg {
                id: z.org_id,
                name: org_name.unwrap_or_default(),
            },
            scopes: z.scopes.clone(),
            valid_until_at: z.gueltig_bis.clone(),
            server_time_at: crate::zeit::jetzt(),
            clock_offset_s: client.clock_offset_s,
        },
    ))
}

/// Öffentlicher Schlüssel dieser Instanz, ohne Anmeldung. Dient dem Schlüsselwechsel; die erste
/// Bindung kommt mit dem Einlösen.
#[utoipa::path(
    get,
    path = "/api/v1/instanz/jwks.json",
    tag = "Anmeldung",
    operation_id = "get_instanz_jwks",
    responses(
        (status = 200, description = "JWKS mit dem Ed25519-Schlüssel der Instanz", body = Jwks),
        (status = "default", description = "Fehler mit stabilem `code`", body = super::ApiErrorBody),
    ),
)]
pub async fn jwks(State(state): State<AppState>) -> Result<Json<Jwks>, ApiError> {
    let i = identitaet::load_or_create(&state.pool)
        .await
        .map_err(|e| crate::error::AppError::Internal(e.to_string()))?;
    Ok(Json(Jwks {
        keys: vec![Jwk::instanz(&i)],
    }))
}
