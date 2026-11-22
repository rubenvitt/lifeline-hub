//! HTTP-Routen von iOS-Push (LLH-2040; Spec `ios-push`).
//!
//! GET    /api/ios-push?kennung=…   — Stand dieses Geräts (Schalter, Anmeldung samt Bindung an
//!                                    diese Sitzung, Wahl, Relais)
//! PUT    /api/ios-push/anmeldung   — Gerät für diese Sitzung anmelden, samt der Wahl „Mit
//!                                    Absender und Wortlaut“ und der stummen Arten (204)
//! DELETE /api/ios-push/anmeldung   — eigene Anmeldung abmelden (idempotent, 204)
//! POST   /api/ios-push/abmelden    — ohne Sitzung, gegen den Nachweis des Geräts (immer 204)
//!
//! Ohne `--ios-push` antworten alle vier 404 wie ein unbekannter Pfad. Die Anmeldung hängt an
//! Konto und Gerät (`kennung`), nicht an der Sitzung; die Sitzung merkt sich die Zeile nur, damit
//! „Sitzungen beenden“ und Abmelden die Anmeldung mitnehmen. Gerätesitzungen erreichen die Routen
//! nicht (keine Routenliste, 403).

use crate::app::AppState;
use crate::auth::session::{hash_token, CurrentUser, SESSION_COOKIE};
use crate::benachrichtigung::BenachrichtigungArt;
use crate::error::AppError;
use crate::extract::JsonBody;
use crate::instanz::spiegel::hinweis::Kanal;
use crate::ios_push::{repo, IosPush};
use crate::routes::web_push::{ueber_hub, PushUeberHub, STUMM_MAX};
use crate::web_push::krypto::b64_lesen;
use crate::web_push::repo::Wahl;
use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::Json;
use axum_extra::extract::CookieJar;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// Länge des Geräte-Tokens von APNs in Hex-Zeichen: 32 Byte (64) bis 100 Byte (200).
const TOKEN_MIN: usize = 64;
const TOKEN_MAX: usize = 200;
/// Länge des Schlüssels, mit dem die Nutzlast an das Gerät verschlüsselt wird (AES-256).
const SCHLUESSEL_LAENGE: usize = 32;
/// Umgebungen von APNs, die das Gerät melden darf.
const UMGEBUNGEN: [&str; 2] = ["sandbox", "production"];

/// Stand von iOS-Push für dieses Gerät.
#[derive(Debug, Serialize, ToSchema)]
pub struct IosPushStand {
    /// Die Instanz verschickt iOS-Push (`--ios-push`); sonst antworten die Routen 404, das Feld
    /// ist also in einer Antwort stets `true`.
    pub eingeschaltet: bool,
    /// Dieses Gerät ist für den angemeldeten Nutzer angemeldet.
    pub angemeldet: bool,
    /// Die Anmeldung hängt an der Sitzung dieser Anfrage; nur dann nimmt ein Logout sie mit.
    /// Nach einem Sitzungsablauf und neuem Login ist sie `angemeldet`, hier aber `false`: der
    /// Client bindet sie dann per `PUT` neu. Ohne Anmeldung `false`.
    pub an_dieser_sitzung: bool,
    /// Die Anmeldung zeigt Absender und Wortlaut; ohne Anmeldung `false`.
    pub inhalt: bool,
    /// Die stummen Eingangsarten dieses Geräts, in Katalogreihenfolge; ohne Anmeldung leer.
    pub stumm: Vec<BenachrichtigungArt>,
    /// Push für diesen Nutzer läuft über einen gekoppelten Hub; ein neues Gerät lehnt der Server
    /// dann mit 422 ab.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ueber_hub: Option<PushUeberHub>,
    /// Das Relais hat diese Instanz gesperrt; Anmeldungen bleiben, es geht aber nichts hinaus.
    pub relais_gesperrt: bool,
}

#[derive(Debug, Deserialize)]
pub struct KennungAbfrage {
    pub kennung: String,
}

/// Anmeldung eines Geräts.
#[derive(Debug, Deserialize)]
pub struct IosPushAnmeldung {
    /// Zufällige UUID, die das Gerät selbst erzeugt und behält.
    pub kennung: String,
    /// Geräte-Token von APNs, Hex.
    pub token: String,
    /// `sandbox` oder `production`.
    pub umgebung: String,
    /// 32 Byte als Base64url: der Schlüssel dieses Geräts für die Nutzlast und den Nachweis.
    pub schluessel: String,
    /// „Mit Absender und Wortlaut“; fehlt es, bleibt die Anmeldung ohne Inhalt.
    #[serde(default)]
    pub inhalt: bool,
    /// Wire-Werte der stummen Eingangsarten; unbekannte und nicht stellbare fallen still weg.
    #[serde(default)]
    pub stumm: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct KennungBody {
    pub kennung: String,
}

#[derive(Debug, Deserialize)]
pub struct AbmeldenBody {
    pub kennung: String,
    pub nachweis: String,
}

fn ios_push(state: &AppState) -> Result<&IosPush, AppError> {
    state.live.ios_push().ok_or(AppError::NotFound)
}

/// Der Hash des Sitzungstokens; `CurrentUser` hat das Cookie schon geprüft.
fn sitzung(jar: &CookieJar) -> Result<String, AppError> {
    jar.get(SESSION_COOKIE)
        .map(|c| hash_token(c.value()))
        .ok_or(AppError::Unauthorized)
}

fn kennung_pruefen(kennung: &str) -> Result<(), AppError> {
    uuid::Uuid::parse_str(kennung)
        .map(|_| ())
        .map_err(|_| AppError::Validation("kennung ist keine UUID".into()))
}

/// GET /api/ios-push?kennung=…
pub async fn stand(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    jar: CookieJar,
    Query(abfrage): Query<KennungAbfrage>,
) -> Result<Json<IosPushStand>, AppError> {
    ios_push(&state)?;
    kennung_pruefen(&abfrage.kennung)?;
    let anmeldung = repo::anmeldung(&state.pool, benutzer.id, &abfrage.kennung).await?;
    let an_dieser_sitzung = anmeldung.is_some()
        && repo::an_sitzung(&state.pool, benutzer.id, &abfrage.kennung, &sitzung(&jar)?).await?;
    let relais_gesperrt = repo::relais_zugang(&state.pool)
        .await?
        .is_some_and(|z| z.gesperrt);
    let angemeldet = anmeldung.is_some();
    let (inhalt, stumm) = anmeldung.map_or((false, Vec::new()), |a| {
        let wahl = Wahl {
            inhalt: a.inhalt,
            stumm: a
                .stumm
                .iter()
                .filter_map(|s| BenachrichtigungArt::parse(s))
                .collect(),
        };
        (
            wahl.inhalt,
            crate::web_push::repo::stumm_bereinigt(&wahl.stumm),
        )
    });
    Ok(Json(IosPushStand {
        eingeschaltet: true,
        angemeldet,
        an_dieser_sitzung,
        inhalt,
        stumm,
        // Nur wenn der Hub selbst iOS-Push anbietet; sonst pusht diese Instanz (je Kanal).
        ueber_hub: ueber_hub(&state, benutzer.id, Kanal::IosPush).await?,
        relais_gesperrt,
    }))
}

/// PUT /api/ios-push/anmeldung — 400, wenn ein Feld für sich nicht taugt.
pub async fn anmelden(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    jar: CookieJar,
    JsonBody(req): JsonBody<IosPushAnmeldung>,
) -> Result<StatusCode, AppError> {
    ios_push(&state)?;
    kennung_pruefen(&req.kennung)?;
    let token = req.token.trim();
    if !(TOKEN_MIN..=TOKEN_MAX).contains(&token.len())
        || !token.chars().all(|c| c.is_ascii_hexdigit())
    {
        return Err(AppError::Validation(format!(
            "token muss {TOKEN_MIN} bis {TOKEN_MAX} Hex-Zeichen lang sein"
        )));
    }
    if !UMGEBUNGEN.contains(&req.umgebung.as_str()) {
        return Err(AppError::Validation(
            "umgebung muss sandbox oder production sein".into(),
        ));
    }
    let schluessel = req.schluessel.trim();
    if !b64_lesen(schluessel).is_some_and(|b| b.len() == SCHLUESSEL_LAENGE) {
        return Err(AppError::Validation(
            "schluessel muss 32 Byte als Base64url sein".into(),
        ));
    }
    if req.stumm.len() > STUMM_MAX {
        return Err(AppError::Validation(format!(
            "stumm darf höchstens {STUMM_MAX} Arten nennen"
        )));
    }
    let stumm: Vec<BenachrichtigungArt> = req
        .stumm
        .iter()
        .filter_map(|a| BenachrichtigungArt::parse(a))
        .collect();
    // Gekoppelter ELW: ein Zustand, nicht das Feld, also 422 (wie Web Push). Bestehende
    // Anmeldungen bleiben und gelten nach dem Entkoppeln wieder.
    if let Some(hub) = ueber_hub(&state, benutzer.id, Kanal::IosPush).await? {
        return Err(AppError::UnprocessableEntity(format!(
            "Push läuft über {}.",
            hub.name
        )));
    }
    repo::anmelden(
        &state.pool,
        benutzer.id,
        &sitzung(&jar)?,
        &repo::Eingabe {
            kennung: &req.kennung,
            token: &token.to_ascii_lowercase(),
            umgebung: &req.umgebung,
            // Normalisiert speichern: ohne Auffüllung, wie der Versand ihn liest.
            schluessel: &crate::web_push::krypto::b64(&b64_lesen(schluessel).unwrap_or_default()),
            wahl: &Wahl {
                inhalt: req.inhalt,
                stumm,
            },
        },
    )
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

/// DELETE /api/ios-push/anmeldung
pub async fn abmelden(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    JsonBody(req): JsonBody<KennungBody>,
) -> Result<StatusCode, AppError> {
    ios_push(&state)?;
    repo::abmelden(&state.pool, benutzer.id, &req.kennung).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// POST /api/ios-push/abmelden — ohne Sitzung (öffentlich): das Gerät beweist den Besitz mit dem
/// Nachweis aus seinem Schlüssel. Die Antwort ist immer 204 und verrät weder, ob die Kennung
/// bekannt ist, noch, ob der Nachweis stimmte.
pub async fn abmelden_mit_nachweis(
    State(state): State<AppState>,
    JsonBody(req): JsonBody<AbmeldenBody>,
) -> Result<StatusCode, AppError> {
    ios_push(&state)?;
    match repo::abmelden_mit_nachweis(&state.pool, &req.kennung, &req.nachweis).await {
        Ok(()) | Err(AppError::Forbidden) => Ok(StatusCode::NO_CONTENT),
        Err(e) => Err(e),
    }
}
