use crate::app::AppState;
use crate::auth::session::{self, CurrentUser, SESSION_COOKIE};
use crate::auth::Benutzer;
use crate::error::AppError;
use crate::extract::PfadParam;
use crate::extract::{JsonBody, PeerIp};
use axum::extract::{Query, State};
use axum::http::{HeaderMap, Method, StatusCode};
use axum::response::Redirect;
use axum::Json;
use axum_extra::extract::cookie::{Cookie, CookieJar, SameSite};
use openidconnect::core::CoreAuthenticationFlow;
use openidconnect::{CsrfToken, Nonce, PkceCodeChallenge, Scope, TokenResponse};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use utoipa::ToSchema;
use webauthn_rs::prelude::{
    CreationChallengeResponse, DiscoverableKey, PublicKeyCredential, RegisterPublicKeyCredential,
    RequestChallengeResponse, WebauthnError,
};

#[derive(Debug, Deserialize)]
pub struct LoginRequest {
    pub benutzername: String,
    pub passwort: String,
}

/// Baut das Session-Cookie; `Secure` folgt dem Transport. Pur, damit beide Zweige ohne den
/// prozessweiten OnceLock testbar sind.
///
/// Persistent mit `Max-Age` = Sitzungsdauer (LFH-779): ohne Ablaufangabe verwerfen Webviews
/// (Tauri-Hülle) und Browser das Cookie beim Prozessende, und nach jedem Neustart stünde der
/// Login da. Widerruf bleibt serverseitig (Abmelden, Konto sperren, Passwortwechsel löschen die
/// Sitzung); ein übrig gebliebenes Cookie läuft dann in 401.
fn session_cookie(token: String, secure: bool) -> Cookie<'static> {
    Cookie::build((SESSION_COOKIE, token))
        .http_only(true)
        .same_site(SameSite::Lax)
        .secure(secure)
        .path("/")
        .max_age(time::Duration::days(session::SITZUNG_TAGE))
        .build()
}

/// Cookie für den Pending-MFA-Key. Trägt nur den Schlüssel in `auth::totp::state`, nie die
/// `benutzer_id`; auf `/api/auth` beschränkt.
const MFA_PENDING_COOKIE: &str = "mfa_pending";

/// Baut das Pending-MFA-Cookie (HttpOnly, Lax, `secure` nach Transport, Pfad `/api/auth`).
fn mfa_pending_cookie(key: String, secure: bool) -> Cookie<'static> {
    Cookie::build((MFA_PENDING_COOKIE, key))
        .http_only(true)
        .same_site(SameSite::Lax)
        .secure(secure)
        .path("/api/auth")
        .build()
}

/// Antwort auf `POST /api/auth/login`. `#[serde(untagged)]` serialisiert `Angemeldet`
/// byte-identisch als nackte `BenutzerAnzeige`; nur ein TOTP-Nutzer bekommt stattdessen
/// `{"mfa_erforderlich":"totp"}` ohne Benutzer-Objekt und ohne Session-Cookie. Nicht im Codegen
/// registriert — die Frontend-Union ist handgepflegt.
#[derive(Debug, Serialize)]
#[serde(untagged)]
pub enum LoginAntwort {
    Angemeldet(crate::auth::BenutzerAnzeige),
    MfaErforderlich { mfa_erforderlich: String },
}

/// POST /api/auth/login — prüft Anmeldedaten, legt Session an, setzt Cookie.
///
/// Ist der `passwort`-Provider in der Registry deaktiviert → 403. Heute hält der Aussperr-Guard
/// ihn aktiv, solange er der einzige admin-taugliche Provider ist; der Check sorgt dafür, dass
/// ein Deaktivieren serverseitig greift und nicht nur das Formular versteckt.
///
/// **Pending-State → Session:** nach erfolgreicher Passwortprüfung verzweigt der Handler auf
/// `totp_aktiviert` — **vor** `session::anlegen`. Ein TOTP-Nutzer bekommt keine Session, sondern
/// einen hochentropischen Pending-Key in `auth::totp::state` und ein HttpOnly-Cookie
/// `mfa_pending`. Der einzige Weg zur Session ist danach `/api/auth/totp/finish` mit gültigem
/// Zweitfaktor. Der Dev-Seed-Login nutzt denselben Handler und kann das nicht umgehen.
pub async fn login(
    State(state): State<AppState>,
    PeerIp(peer_ip): PeerIp,
    jar: CookieJar,
    JsonBody(req): JsonBody<LoginRequest>,
) -> Result<(CookieJar, Json<LoginAntwort>), AppError> {
    // Bremse vor jeder Passwort-Arbeit: ein gesperrter Aufrufer löst kein Hashing aus.
    if let Some(ip) = peer_ip {
        if crate::auth::rate_limit::ist_gesperrt(ip) {
            tracing::warn!(
                peer_ip = %ip,
                benutzername = %req.benutzername,
                "Anmeldeversuch abgewiesen: zu viele Fehlversuche aus dieser Quelle"
            );
            return Err(AppError::TooManyRequests(
                "Zu viele fehlgeschlagene Anmeldeversuche. Bitte kurz warten.".to_string(),
            ));
        }
    }

    let liste = crate::auth::provider::registry::liste(&state.pool).await?;
    let passwort_aktiv = liste
        .iter()
        .any(|p| p.id == crate::auth::provider::ID_PASSWORT && p.aktiviert);
    if !passwort_aktiv {
        return Err(AppError::Forbidden);
    }

    let benutzer = match crate::auth::provider::password::anmelden(
        &state.pool,
        &req.benutzername,
        &req.passwort,
    )
    .await
    {
        Ok(b) => b,
        Err(e) => {
            if let Some(ip) = peer_ip {
                crate::auth::rate_limit::fehlversuch(ip);
            }
            tracing::warn!(
                benutzername = %req.benutzername,
                peer_ip = ?peer_ip,
                "Anmeldung fehlgeschlagen"
            );
            crate::auth::audit::schreibe(
                &state.pool,
                crate::auth::audit::AuditEintrag {
                    ereignis: crate::auth::audit::Ereignis::LoginFehlgeschlagen,
                    // Der VERSUCHTE Name — er muss keinem Benutzer entsprechen.
                    benutzername: Some(&req.benutzername),
                    benutzer_id: None,
                    peer_ip: peer_ip.map(|ip| ip.to_string()),
                    provider: crate::auth::provider::ID_PASSWORT,
                },
            )
            .await;
            return Err(e);
        }
    };

    let totp_aktiviert: bool =
        sqlx::query_scalar("SELECT totp_aktiviert FROM benutzer WHERE id = ?")
            .bind(benutzer.id)
            .fetch_one(&state.pool)
            .await?;

    // Das Passwort stimmt; das gibt auch alle anderen hinter derselben IP wieder frei (NAT).
    if let Some(ip) = peer_ip {
        crate::auth::rate_limit::erfolg(ip);
    }

    if totp_aktiviert {
        // Keine Session, kein Session-Cookie (s. Doc oben). Kein `login_ok`-Audit: angemeldet ist
        // hier
        // noch niemand, den Abschluss protokolliert `totp_finish`.
        let key = session::neuer_token();
        crate::auth::totp::state::speichere(key.clone(), benutzer.id);
        let jar = jar.add(mfa_pending_cookie(key, session::cookie_secure()));
        return Ok((
            jar,
            Json(LoginAntwort::MfaErforderlich {
                mfa_erforderlich: "totp".to_string(),
            }),
        ));
    }

    let token = session::anlegen(&state.pool, benutzer.id).await?;
    let jar = jar.add(session_cookie(token, crate::auth::session::cookie_secure()));
    tracing::info!(
        benutzer_id = benutzer.id,
        benutzername = %benutzer.benutzername,
        peer_ip = ?peer_ip,
        "Anmeldung erfolgreich"
    );
    crate::auth::audit::schreibe(
        &state.pool,
        crate::auth::audit::AuditEintrag {
            ereignis: crate::auth::audit::Ereignis::LoginOk,
            benutzername: Some(&benutzer.benutzername),
            benutzer_id: Some(benutzer.id),
            peer_ip: peer_ip.map(|ip| ip.to_string()),
            provider: crate::auth::provider::ID_PASSWORT,
        },
    )
    .await;
    Ok((
        jar,
        Json(LoginAntwort::Angemeldet(benutzer.anzeige(totp_aktiviert))),
    ))
}

/// POST /api/auth/logout — löscht die Session und entfernt das Cookie.
///
/// Nennt der Tab den Benutzer, den er anzeigt (`X-Erwarteter-Benutzer-Id`, LFH-387), und
/// gehört die noch gültige Sitzung inzwischen jemand anderem, antwortet der Logout 412 und
/// lässt Sitzung und Cookie stehen: ein veralteter Tab darf die Sitzung des neu angemeldeten
/// Benutzers nicht beenden. Eine tote Sitzung räumt der Logout wie bisher.
pub async fn logout(
    State(state): State<AppState>,
    PeerIp(peer_ip): PeerIp,
    headers: HeaderMap,
    jar: CookieJar,
) -> Result<(CookieJar, StatusCode), AppError> {
    if let Some(cookie) = jar.get(SESSION_COOKIE) {
        if let Ok(inhaber) = session::benutzer_aus_token(&state.pool, cookie.value()).await {
            session::pruefe_erwarteten_benutzer(&Method::POST, &headers, inhaber.id)?;
        }
        // Wer sich abmeldet, wird vor dem Löschen bestimmt — danach ist die Zuordnung weg.
        let benutzer_id = session::benutzer_id_zu_token(&state.pool, cookie.value()).await;

        session::loeschen(&state.pool, cookie.value()).await?;

        tracing::info!(benutzer_id = ?benutzer_id, peer_ip = ?peer_ip, "Abmeldung");
        crate::auth::audit::schreibe(
            &state.pool,
            crate::auth::audit::AuditEintrag {
                ereignis: crate::auth::audit::Ereignis::Logout,
                benutzername: None,
                benutzer_id,
                peer_ip: peer_ip.map(|ip| ip.to_string()),
                provider: crate::auth::provider::ID_PASSWORT,
            },
        )
        .await;
    }
    let jar = jar.remove(Cookie::build((SESSION_COOKIE, "")).path("/").build());
    Ok((jar, StatusCode::NO_CONTENT))
}

/// GET /api/auth/me — der angemeldete Benutzer inkl. MFA-Status. `totp_aktiviert` wird
/// nachgeladen, weil `CurrentUser` die `totp_*`-Spalten nicht trägt.
pub async fn me(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
) -> Result<Json<crate::auth::BenutzerAnzeige>, AppError> {
    let totp_aktiviert: bool =
        sqlx::query_scalar("SELECT totp_aktiviert FROM benutzer WHERE id = ?")
            .bind(benutzer.id)
            .fetch_one(&state.pool)
            .await?;
    Ok(Json(benutzer.anzeige(totp_aktiviert)))
}

#[derive(Debug, Deserialize)]
pub struct PasswortWechsel {
    pub altes_passwort: String,
    pub neues_passwort: String,
}

/// POST /api/auth/passwort — der angemeldete Benutzer wechselt sein eigenes Passwort (LFH-471).
///
/// **Das alte Passwort ist Pflicht.** Ohne diese Prüfung machte ein übernommenes Session-Cookie
/// aus einer Sitzung ein Konto. Geprüft wird über denselben gedrosselten Weg wie beim Login
/// (`provider::password::anmelden`: KDF-Gate, angeglichene Antwortzeit); ein Fehlversuch zählt
/// in dieselbe Sperre je Quelle, sonst wäre dieser Endpunkt ein ungebremster Rateweg für jeden,
/// der ein Cookie hat.
///
/// **Statuscodes** (Konvention `src/error.rs`): leeres Alt-Passwort oder zu kurzes neues → 400;
/// falsches Alt-Passwort → 422 (Zustand, wie „Code ungültig" bei TOTP) — ausdrücklich nicht 401,
/// denn die Sitzung ist gültig, und ein 401 ließe die Sitzungswache des Frontends abmelden.
/// Abgeschalteter Passwort-Provider → 403, dieselbe Durchsetzung wie beim Login. Ein SSO-only-
/// Konto hat kein Passwort, das es nennen könnte, und landet deshalb bei 422.
///
/// **Sitzungen:** alle ANDEREN Sitzungen des Benutzers enden, in derselben Transaktion wie der
/// neue Hash. Der Wechsel ist die Antwort auf ein verratenes oder geteiltes Passwort; eine damit
/// eröffnete Sitzung dürfte sonst bis zu [`session::SITZUNG_TAGE`] Tage weiterlaufen. Die eigene
/// Sitzung bleibt, sonst würfe der Wechsel den Handelnden aus dem laufenden Einsatz. Passkeys
/// und der TOTP-Zweitfaktor bleiben unberührt: sie hängen nicht am Passwort.
pub async fn passwort_aendern(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    PeerIp(peer_ip): PeerIp,
    jar: CookieJar,
    JsonBody(req): JsonBody<PasswortWechsel>,
) -> Result<StatusCode, AppError> {
    let liste = crate::auth::provider::registry::liste(&state.pool).await?;
    let passwort_aktiv = liste
        .iter()
        .any(|p| p.id == crate::auth::provider::ID_PASSWORT && p.aktiviert);
    if !passwort_aktiv {
        return Err(AppError::Forbidden);
    }

    // Kein `pflicht`: ein Passwort wird nicht getrimmt.
    if req.altes_passwort.is_empty() {
        return Err(AppError::Validation(
            "Altes Passwort darf nicht leer sein".to_string(),
        ));
    }
    crate::routes::benutzer::pruefe_passwort_laenge(&req.neues_passwort)?;

    if let Some(ip) = peer_ip {
        if crate::auth::rate_limit::ist_gesperrt(ip) {
            return Err(AppError::TooManyRequests(
                "Zu viele fehlgeschlagene Versuche. Bitte kurz warten.".to_string(),
            ));
        }
    }

    match crate::auth::provider::password::anmelden(
        &state.pool,
        &benutzer.benutzername,
        &req.altes_passwort,
    )
    .await
    {
        Ok(_) => {}
        Err(AppError::Unauthorized) => {
            if let Some(ip) = peer_ip {
                crate::auth::rate_limit::fehlversuch(ip);
            }
            tracing::warn!(
                benutzer_id = benutzer.id,
                peer_ip = ?peer_ip,
                "Passwortwechsel abgewiesen: altes Passwort falsch"
            );
            return Err(AppError::UnprocessableEntity(
                "Das bisherige Passwort stimmt nicht.".to_string(),
            ));
        }
        Err(e) => return Err(e),
    }
    if let Some(ip) = peer_ip {
        crate::auth::rate_limit::erfolg(ip);
    }

    // Argon2 blockiert den Worker ~50–100 ms; auf den Blocking-Pool damit.
    let neues = req.neues_passwort;
    let hash = tokio::task::spawn_blocking(move || crate::auth::password::hash(&neues))
        .await
        .map_err(|e| AppError::Internal(format!("KDF-Task abgebrochen: {e}")))??;

    // `CurrentUser` hat die Sitzung eben aufgelöst; das Cookie ist also da.
    let token = jar
        .get(SESSION_COOKIE)
        .map(|c| c.value().to_string())
        .ok_or(AppError::Unauthorized)?;

    let mut tx = state.pool.begin().await?;
    sqlx::query("UPDATE benutzer SET passwort_hash = ? WHERE id = ?")
        .bind(&hash)
        .bind(benutzer.id)
        .execute(&mut *tx)
        .await?;
    let beendet = session::andere_loeschen(&mut tx, benutzer.id, &token).await?;
    tx.commit().await?;

    tracing::info!(
        benutzer_id = benutzer.id,
        peer_ip = ?peer_ip,
        andere_sitzungen_beendet = beendet,
        "Passwort gewechselt"
    );
    Ok(StatusCode::NO_CONTENT)
}

/// Öffentliche Projektion der Provider-Liste: nur aktivierte (LFH-277). Dieselbe DTO wie der
/// Admin-Endpoint.
fn public_provider_projektion(
    liste: Vec<crate::auth::provider::AuthProviderAnzeige>,
) -> Vec<crate::auth::provider::AuthProviderAnzeige> {
    liste.into_iter().filter(|p| p.aktiviert).collect()
}

/// GET /api/auth/providers — öffentlich, NUR aktivierte Provider (Login-UI).
pub async fn providers(
    State(state): State<AppState>,
) -> Result<Json<Vec<crate::auth::provider::AuthProviderAnzeige>>, AppError> {
    let liste = crate::auth::provider::registry::liste(&state.pool).await?;
    Ok(Json(public_provider_projektion(liste)))
}

/// GET /api/auth/providers/admin — volle Liste inkl. deaktivierter Provider für den
/// Admin-Bereich. Lesen darf auch die Org-Führungskraft (`darf_admin_bereich`), die Sektion
/// „Anmeldeverfahren" zeigt ihr die Liste nur lesend; Schalten bleibt Admin-only (LFH-435).
pub async fn providers_admin(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
) -> Result<Json<Vec<crate::auth::provider::AuthProviderAnzeige>>, AppError> {
    if !benutzer.darf_admin_bereich() {
        return Err(AppError::Forbidden);
    }
    let liste = crate::auth::provider::registry::liste(&state.pool).await?;
    Ok(Json(liste))
}

#[derive(Debug, Deserialize)]
pub struct ProviderSchaltenRequest {
    pub aktiviert: bool,
}

/// PUT /api/auth/providers/{id} — Provider an/aus. Admin-only. Guard gegen Aussperren.
pub async fn provider_schalten(
    State(state): State<AppState>,
    _admin: crate::auth::session::AdminUser,
    PfadParam(id): PfadParam<String>,
    JsonBody(req): JsonBody<ProviderSchaltenRequest>,
) -> Result<Json<Vec<crate::auth::provider::AuthProviderAnzeige>>, AppError> {
    crate::auth::provider::registry::schalten(&state.pool, &id, req.aktiviert).await?;
    let liste = crate::auth::provider::registry::liste(&state.pool).await?;
    Ok(Json(liste))
}

#[derive(Debug, Deserialize)]
pub struct OidcStartQuery {
    von: Option<String>,
}

/// Ziel-Pfad nach erfolgreichem OIDC-Login aus `?von=` (Vorgabe `/einsaetze`), weil der
/// OIDC-Flow die SPA per Browser-Redirect verlässt. Nur App-lokale Pfade werden übernommen
/// (Open-Redirect-Schutz). Abgelehnt werden neben `//…` auch Backslashes und Control-Zeichen:
/// Browser entfernen Tab/Newline und machen aus `/\` ein protokoll-relatives `//` (WHATWG-URL),
/// beides sonst ein Bypass. Pfade dieser App enthalten beides nie.
fn ziel_pfad_aus_query(von: Option<String>) -> String {
    match von {
        Some(pfad)
            if pfad.starts_with('/')
                && !pfad.starts_with("//")
                && !pfad.contains('\\')
                && !pfad.chars().any(|c| c.is_control()) =>
        {
            pfad
        }
        _ => "/einsaetze".to_string(),
    }
}

/// Binding-Cookie für den OIDC-`state` (Session-Fixation-Schutz, LFH-277). `oidc_callback`
/// verlangt zusätzlich zum State-Store, dass der Cookie-Wert exakt dem `state`-Query
/// entspricht; der Store allein bindet den `state` an keinen Browser, und ein Angreifer könnte
/// einen selbst erzeugten `state` in den Browser eines Opfers injizieren.
const OIDC_STATE_COOKIE: &str = "oidc_state";

/// Baut das HttpOnly-Binding-Cookie für den OIDC-`state`, pfadweit, weil der Callback unter
/// einem anderen Pfad liegt als `start`.
///
/// **SameSite=Lax, nicht Strict:** der Callback kommt als Cross-Site-Top-Level-Redirect vom IdP;
/// unter `Strict` fehlte das Cookie dort, und jeder OIDC-Login schlüge fehl.
///
/// Kein `max_age`: das Cookie wird auf jedem Rückgabepfad von `oidc_callback` geräumt, und die
/// TTL des State-Stores begrenzt einen offenen Flow ohnehin.
fn baue_oidc_state_cookie(state: String, secure: bool) -> Cookie<'static> {
    Cookie::build((OIDC_STATE_COOKIE, state))
        .http_only(true)
        .same_site(SameSite::Lax)
        .secure(secure)
        .path("/")
        .build()
}

/// Removal-Cookie für `OIDC_STATE_COOKIE` (gleicher `path`); eigene Funktion, weil
/// `oidc_callback` es auf jedem Rückgabepfad braucht.
fn raeume_oidc_state_cookie() -> Cookie<'static> {
    Cookie::build((OIDC_STATE_COOKIE, "")).path("/").build()
}

/// True nur, wenn der Binding-Cookie-Wert exakt dem `state`-Query entspricht (LFH-277).
fn oidc_state_binding_ok(cookie_state: Option<&str>, state_query: &str) -> bool {
    cookie_state == Some(state_query)
}

/// GET /api/auth/oidc/start — Authorization-Redirect zum OIDC-Provider. Ist `oidc` nicht
/// konfiguriert oder deaktiviert → 404. Ein IdP-/Discovery-Fehler wird kein 500, sondern ein
/// Redirect auf die Login-Seite mit generischem Hinweis. Setzt das `oidc_state`-Binding-Cookie.
pub async fn oidc_start(
    State(state): State<AppState>,
    jar: CookieJar,
    Query(query): Query<OidcStartQuery>,
) -> Result<(CookieJar, Redirect), AppError> {
    let liste = crate::auth::provider::registry::liste(&state.pool).await?;
    let oidc_aktiv = liste
        .iter()
        .any(|p| p.id == crate::auth::provider::ID_OIDC && p.aktiviert);
    if !oidc_aktiv {
        return Err(AppError::NotFound);
    }

    let client = match crate::auth::oidc::oidc_client(crate::auth::oidc::oidc_settings()).await {
        Ok(client) => client,
        // Noch kein `state` gespeichert, also kein Binding-Cookie.
        Err(_) => return Ok((jar, oidc_fehler_redirect())),
    };

    let ziel_pfad = ziel_pfad_aus_query(query.von);

    let (pkce_challenge, pkce_verifier) = PkceCodeChallenge::new_random_sha256();
    let (auth_url, csrf, nonce) = client
        .authorize_url(
            CoreAuthenticationFlow::AuthorizationCode,
            CsrfToken::new_random,
            Nonce::new_random,
        )
        .add_scope(Scope::new("openid".to_string()))
        .add_scope(Scope::new("profile".to_string()))
        .set_pkce_challenge(pkce_challenge)
        .url();

    // Synchron, kein Guard über ein `.await`.
    crate::auth::oidc::state::speichere(
        csrf.secret().clone(),
        crate::auth::oidc::state::StateEintrag {
            nonce: nonce.secret().clone(),
            pkce_verifier: pkce_verifier.secret().clone(),
            ziel_pfad,
        },
    );

    // Binding-Cookie, s. `baue_oidc_state_cookie`.
    let jar = jar.add(baue_oidc_state_cookie(
        csrf.secret().clone(),
        session::cookie_secure(),
    ));
    Ok((jar, Redirect::to(auth_url.as_str())))
}

/// Alle Felder optional: der IdP kann statt `code`/`state` ein `error` liefern (RFC 6749
/// 4.1.2.1, z. B. abgelehnte Zustimmung). Als Pflichtfelder lehnte der `Query`-Extractor das mit
/// einem rohen 400 ab, statt auf die Login-Seite umzuleiten.
#[derive(Debug, Deserialize)]
pub struct OidcCallbackQuery {
    code: Option<String>,
    state: Option<String>,
    error: Option<String>,
}

/// Generischer Fehler-Redirect des OIDC-Callbacks: jeder Fehler (state, Token, Discovery,
/// `id_token`, deaktiviertes Konto) endet in derselben Meldung, ohne IdP-/Validierungsdetail.
fn oidc_fehler_redirect() -> Redirect {
    Redirect::to("/login?fehler=oidc")
}

/// GET /api/auth/oidc/callback — Token-Tausch, `id_token`-Validierung, JIT-Provisioning,
/// Session. **Security-kritisch**, die Reihenfolge ist bewusst:
///
/// 1. Registry-Prüfung wie `oidc_start` → 404.
/// 2. IdP-Error oder fehlendes `code`/`state`: State-Eintrag noch konsumieren, dann
///    generischer Redirect.
/// 3. **Binding-Check (LFH-277):** den `oidc_state`-Cookie-Wert lesen, BEVOR er aus dem `jar`
///    geräumt wird (danach sähe `get` nichts mehr). Ab dem Räumen trägt jeder Rückgabepfad das
///    Removal-Cookie. Passt der Wert nicht zum `state`-Query → Redirect, OHNE den
///    State-Store-Eintrag zu konsumieren — der legitime Flow des Opfer-Browsers bleibt nutzbar.
/// 4. `state::entnehme` synchron und vor jedem Netzzugriff; `None` → Redirect.
/// 5. Token-Tausch.
/// 6. `id_token`-Validierung (Signatur/JWKS, `nonce`, `iss`, `aud`, `exp`).
/// 7. JIT-Provisioning (Match nur über `(issuer, sub)`).
/// 8. `finde_oder_provisioniere` ignoriert `benutzer.aktiv` — ein deaktiviertes Konto wird HIER
///    abgewiesen.
/// 9. Session, Cookie, Redirect auf den bereits geprüften `ziel_pfad`.
///
/// Jeder Fehler ab Schritt 2 endet im selben generischen Redirect; nur Datenbankfehler
/// propagieren als `AppError` (generisches 500, ohne IdP-Details).
pub async fn oidc_callback(
    State(state): State<AppState>,
    jar: CookieJar,
    Query(query): Query<OidcCallbackQuery>,
) -> Result<(CookieJar, Redirect), AppError> {
    let liste = crate::auth::provider::registry::liste(&state.pool).await?;
    let oidc_aktiv = liste
        .iter()
        .any(|p| p.id == crate::auth::provider::ID_OIDC && p.aktiviert);
    if !oidc_aktiv {
        return Err(AppError::NotFound);
    }

    // IdP-Error-Callback oder Query ohne `code`/`state`: generischer Redirect. Ein gespeicherter
    // State-Eintrag wird konsumiert, damit er nicht bis zum TTL-Ablauf in der Map hängt.
    if query.error.is_some() || query.code.is_none() || query.state.is_none() {
        if let Some(s) = &query.state {
            let _ = crate::auth::oidc::state::entnehme(s);
        }
        return Ok((
            jar.remove(raeume_oidc_state_cookie()),
            oidc_fehler_redirect(),
        ));
    }
    let code = query.code.expect("Guard oben stellt sicher: code ist Some");
    let state_key = query
        .state
        .expect("Guard oben stellt sicher: state ist Some");

    // Binding-Check (Punkt 3 oben): den Cookie-Wert VOR dem Räumen lesen, sonst schlüge jede
    // Anmeldung fehl.
    let cookie_state = jar.get(OIDC_STATE_COOKIE).map(|c| c.value().to_string());
    // Ab hier trägt jeder Rückgabepfad das geräumte Cookie.
    let jar = jar.remove(raeume_oidc_state_cookie());
    if !oidc_state_binding_ok(cookie_state.as_deref(), &state_key) {
        // Kein `state::entnehme`: ein Binding-Fehlschlag darf den State-Store-Eintrag nicht
        // verbrennen.
        return Ok((jar, oidc_fehler_redirect()));
    }

    // Synchron und VOR Token-Tausch/Discovery: ein unbekannter oder abgelaufener `state` muss vor
    // jedem Netzzugriff kurzschließen. Kein Test pinnt diese Reihenfolge.
    //
    // Die `let … else { redirect }`-Arme bis zum Aktiv-Check verwerfen den Fehlerinhalt bewusst.
    // Ein `?` reichte Token-/IdP-Details über `AppError::ServiceUnavailable` in die Antwort durch.
    let Some(eintrag) = crate::auth::oidc::state::entnehme(&state_key) else {
        return Ok((jar, oidc_fehler_redirect()));
    };

    let Ok(client) = crate::auth::oidc::oidc_client(crate::auth::oidc::oidc_settings()).await
    else {
        return Ok((jar, oidc_fehler_redirect()));
    };

    let Ok(token_response) =
        crate::auth::oidc::tausche_code_gegen_token(&client, code, eintrag.pkce_verifier).await
    else {
        return Ok((jar, oidc_fehler_redirect()));
    };

    let Some(id_token) = token_response.id_token() else {
        return Ok((jar, oidc_fehler_redirect()));
    };

    // Signatur (JWKS), `nonce`, `iss`, `aud`, `exp` — s. Punkt 6.
    let Ok(claims) = id_token.claims(&client.id_token_verifier(), &Nonce::new(eintrag.nonce))
    else {
        return Ok((jar, oidc_fehler_redirect()));
    };

    // `name` ist ein lokalisierter Claim; ohne Sprachpräferenz der Default-Wert, sonst der erste.
    let name = claims.name().and_then(|localized| {
        localized
            .get(None)
            .or_else(|| localized.iter().next().map(|(_, wert)| wert))
    });

    let oidc_claims = crate::auth::oidc::provisioning::OidcClaims {
        issuer: claims.issuer().as_str().to_string(),
        subject: claims.subject().as_str().to_string(),
        preferred_username: claims.preferred_username().map(|u| u.as_str().to_string()),
        name: name.map(|n| n.as_str().to_string()),
    };

    let benutzer =
        crate::auth::oidc::provisioning::finde_oder_provisioniere(&state.pool, &oidc_claims)
            .await?;

    // Punkt 8 oben.
    if !benutzer.aktiv {
        return Ok((jar, oidc_fehler_redirect()));
    }

    let token = session::anlegen(&state.pool, benutzer.id).await?;
    let jar = jar.add(session_cookie(token, crate::auth::session::cookie_secure()));
    Ok((jar, Redirect::to(&eintrag.ziel_pfad)))
}

/// Cookie für den Registrierungs-State-Key. Trägt nur den Schlüssel in `auth::webauthn::state`,
/// nie die Zeremonie selbst; auf `/api/auth/webauthn` beschränkt.
const WEBAUTHN_REG_COOKIE: &str = "webauthn_reg";

/// Baut das Registrierungs-State-Cookie (HttpOnly, Lax, `secure` nach Transport).
fn webauthn_reg_cookie(key: String, secure: bool) -> Cookie<'static> {
    Cookie::build((WEBAUTHN_REG_COOKIE, key))
        .http_only(true)
        .same_site(SameSite::Lax)
        .secure(secure)
        .path("/api/auth/webauthn")
        .build()
}

/// Ist der `webauthn`-Provider konfiguriert und nicht ausgeschaltet? Sonst liefern die
/// Endpoints 404 statt eines Flows, der mitten in der Zeremonie scheitert.
async fn webauthn_aktiv(pool: &SqlitePool) -> Result<bool, AppError> {
    let liste = crate::auth::provider::registry::liste(pool).await?;
    Ok(liste
        .iter()
        .any(|p| p.id == crate::auth::provider::ID_WEBAUTHN && p.aktiviert))
}

/// POST /api/auth/webauthn/register/start — beginnt eine Passkey-Registrierung für den
/// angemeldeten Nutzer; 404, wenn `webauthn` nicht aktiv ist.
///
/// `exclude_credentials` enthält die bereits registrierten Passkeys, damit derselbe
/// Authenticator nicht zweimal registriert wird (die UNIQUE-Spalte finge es sonst erst als 409
/// ab). Der Zeremonie-State bleibt serverseitig; der Client bekommt nur dessen Schlüssel im
/// Cookie `webauthn_reg`.
pub async fn webauthn_register_start(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    jar: CookieJar,
) -> Result<(CookieJar, Json<CreationChallengeResponse>), AppError> {
    if !webauthn_aktiv(&state.pool).await? {
        return Err(AppError::NotFound);
    }
    let webauthn = crate::auth::webauthn::webauthn().ok_or(AppError::NotFound)?;

    let handle = crate::auth::webauthn::user_handle(&state.pool, benutzer.id).await?;
    let vorhandene =
        crate::auth::webauthn::storage::passkeys_fuer_benutzer(&state.pool, benutzer.id).await?;
    let exclude: Vec<_> = vorhandene.iter().map(|p| p.cred_id().clone()).collect();
    let exclude = if exclude.is_empty() {
        None
    } else {
        Some(exclude)
    };

    // Nicht clientauslösbar (alle Eingaben aus der eigenen DB): `Internal` hält das Detail aus der
    // Antwort.
    let (ccr, reg) = webauthn
        .start_passkey_registration(
            handle,
            &benutzer.benutzername,
            &benutzer.anzeigename,
            exclude,
        )
        .map_err(|e| {
            AppError::Internal(format!("WebAuthn-Registrierung konnte nicht starten: {e}"))
        })?;

    let key = session::neuer_token();
    crate::auth::webauthn::state::speichere(
        key.clone(),
        crate::auth::webauthn::state::CeremonyZustand::Registrierung(reg),
    );

    let jar = jar.add(webauthn_reg_cookie(key, session::cookie_secure()));
    Ok((jar, Json(ccr)))
}

/// POST /api/auth/webauthn/register/finish — schließt die Passkey-Registrierung ab; 404, wenn
/// `webauthn` nicht aktiv ist.
///
/// `entnehme` läuft synchron vor jedem `.await` (!Send). Ein unbekannter, verbrauchter oder auf
/// eine andere Zeremonie-Art zeigender Key endet im selben generischen 400. Eine doppelte
/// `credential_id` liefert `speichere_passkey` bereits als 409.
pub async fn webauthn_register_finish(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    jar: CookieJar,
    JsonBody(body): JsonBody<RegisterPublicKeyCredential>,
) -> Result<(CookieJar, StatusCode), AppError> {
    if !webauthn_aktiv(&state.pool).await? {
        return Err(AppError::NotFound);
    }
    let webauthn = crate::auth::webauthn::webauthn().ok_or(AppError::NotFound)?;

    let key = jar
        .get(WEBAUTHN_REG_COOKIE)
        .map(|c| c.value().to_string())
        .ok_or_else(|| AppError::Validation("Keine laufende Registrierung".to_string()))?;

    // Synchron, Guard vor jedem folgenden `.await` freigegeben.
    let reg = match crate::auth::webauthn::state::entnehme(&key) {
        Some(crate::auth::webauthn::state::CeremonyZustand::Registrierung(reg)) => reg,
        _ => {
            return Err(AppError::Validation(
                "Registrierung abgelaufen oder unbekannt".to_string(),
            ))
        }
    };

    // Ein Fehler hier ist ein Zeremonie-/Client-Fehler. Die `webauthn-rs`-Meldungen sind statisch
    // und PII-frei und dürfen an den Client (anders als OIDC-Details).
    let passkey = webauthn
        .finish_passkey_registration(&body, &reg)
        .map_err(|e| AppError::Validation(format!("WebAuthn-Registrierung fehlgeschlagen: {e}")))?;

    crate::auth::webauthn::storage::speichere_passkey(&state.pool, benutzer.id, &passkey).await?;

    let jar = jar.remove(
        Cookie::build((WEBAUTHN_REG_COOKIE, ""))
            .path("/api/auth/webauthn")
            .build(),
    );
    Ok((jar, StatusCode::CREATED))
}

/// Cookie für den Authentifizierungs-State-Key; trägt nur den Schlüssel, nie die Zeremonie.
const WEBAUTHN_AUTH_COOKIE: &str = "webauthn_auth";

/// Baut das Authentifizierungs-State-Cookie (HttpOnly, Lax, `secure` nach Transport).
fn webauthn_auth_cookie(key: String, secure: bool) -> Cookie<'static> {
    Cookie::build((WEBAUTHN_AUTH_COOKIE, key))
        .http_only(true)
        .same_site(SameSite::Lax)
        .secure(secure)
        .path("/api/auth/webauthn")
        .build()
}

#[derive(Debug, Deserialize)]
pub struct WebauthnAuthStartRequest {
    pub benutzername: String,
}

/// POST /api/auth/webauthn/auth/start — beginnt eine passwortlose Passkey-Authentifizierung
/// (öffentlich); 404, wenn `webauthn` nicht aktiv ist.
///
/// **Keine Benutzer-Enumeration:** unbekannter oder inaktiver Name, Benutzer ohne Passkey und
/// jeder weitere Fehler vor dem Start enden im selben 401 (wie `password::anmelden`).
/// Protokoll-inhärent verrät `allowCredentials` Anzahl/IDs der Credentials, sobald ein Nutzer
/// Passkeys hat; verhindert wird, dass Status oder Fehlertext die Fälle unterscheiden. Der
/// discoverable Login hat diesen Tradeoff nicht.
pub async fn webauthn_auth_start(
    State(state): State<AppState>,
    jar: CookieJar,
    JsonBody(req): JsonBody<WebauthnAuthStartRequest>,
) -> Result<(CookieJar, Json<RequestChallengeResponse>), AppError> {
    if !webauthn_aktiv(&state.pool).await? {
        return Err(AppError::NotFound);
    }
    let webauthn = crate::auth::webauthn::webauthn().ok_or(AppError::NotFound)?;

    let benutzer = sqlx::query_as::<_, Benutzer>(
        "SELECT id, org_id, anzeigename, benutzername, passwort_hash, system_rolle, org_rolle, \
         aktiv, erstellt_at FROM benutzer WHERE benutzername = ? AND aktiv = 1",
    )
    .bind(&req.benutzername)
    .fetch_optional(&state.pool)
    .await?;

    // Derselbe generische Fehler für alle Fälle (keine Enumeration, s. Doc oben).
    let Some(benutzer) = benutzer else {
        return Err(AppError::Unauthorized);
    };

    let passkeys =
        crate::auth::webauthn::storage::passkeys_fuer_benutzer(&state.pool, benutzer.id).await?;
    if passkeys.is_empty() {
        return Err(AppError::Unauthorized);
    }

    let (rcr, auth_state) = webauthn
        .start_passkey_authentication(&passkeys)
        .map_err(|_| AppError::Unauthorized)?;

    let key = session::neuer_token();
    crate::auth::webauthn::state::speichere(
        key.clone(),
        crate::auth::webauthn::state::CeremonyZustand::Authentifizierung(auth_state),
    );

    let jar = jar.add(webauthn_auth_cookie(key, session::cookie_secure()));
    Ok((jar, Json(rcr)))
}

/// POST /api/auth/webauthn/auth/finish — schließt die Passkey-Authentifizierung ab
/// (öffentlich). **Security-kritisch**, Reihenfolge bewusst:
///
/// 1. 404, wenn `webauthn` nicht aktiv ist.
/// 2. `entnehme` synchron vor jedem `.await` (!Send). Fehlendes Cookie, unbekannter oder
///    verbrauchter Key oder falsche Zeremonie-Art → 401.
/// 3. `finish_passkey_authentication` — prüft auch Counter/Klon (s. u.). Jeder Fehler → 401.
/// 4. Counter-Writeback: gespeicherten Passkey laden, `update_credential`, per
///    `storage::aktualisiere_counter` persistieren.
/// 5. Ein inzwischen deaktiviertes Konto bekommt trotz gültiger Signatur keine Session.
/// 6. Session anlegen, Cookie setzen, `webauthn_auth`-Cookie entfernen, 200.
///
/// # Counter-Prüfung in webauthn-rs 0.5
///
/// `WebauthnBuilder::build()` setzt `require_valid_counter_value: true` fest. Ist
/// `auth_data.counter <= cred.counter` und einer der beiden > 0, liefert die Bibliothek
/// `CredentialPossibleCompromise` statt eines Ergebnisses — ein Klon/Replay scheitert, bevor
/// dieser Handler zurückschreibt; der Check wird hier nicht nachgebaut. Passkeys, die nie einen
/// Counter führen (viele synchronisierte Platform-Passkeys), überspringen den Vergleich
/// protokollbedingt.
///
/// Das Zurückschreiben ist trotzdem Pflicht: nur so sieht der nächste Versuch den höheren
/// Counter als Vergleichsbasis.
pub async fn webauthn_auth_finish(
    State(state): State<AppState>,
    jar: CookieJar,
    JsonBody(body): JsonBody<PublicKeyCredential>,
) -> Result<(CookieJar, StatusCode), AppError> {
    if !webauthn_aktiv(&state.pool).await? {
        return Err(AppError::NotFound);
    }
    let webauthn = crate::auth::webauthn::webauthn().ok_or(AppError::NotFound)?;

    let key = jar
        .get(WEBAUTHN_AUTH_COOKIE)
        .map(|c| c.value().to_string())
        .ok_or(AppError::Unauthorized)?;

    // Synchron, Guard vor jedem folgenden `.await` freigegeben (Punkt 2).
    let auth_state = match crate::auth::webauthn::state::entnehme(&key) {
        Some(crate::auth::webauthn::state::CeremonyZustand::Authentifizierung(auth_state)) => {
            auth_state
        }
        _ => return Err(AppError::Unauthorized),
    };

    // Counter-/Klon-Check in der Bibliothek, s. Doc oben.
    let auth_result = match webauthn.finish_passkey_authentication(&body, &auth_state) {
        Ok(r) => r,
        Err(WebauthnError::CredentialPossibleCompromise) => {
            // Nur ins Log (Signal für ein mögliches Klon-Gerät); der Client bekommt das generische
            // 401.
            tracing::warn!("WebAuthn-Login abgelehnt: möglicher Klon (Counter-Regression) erkannt");
            return Err(AppError::Unauthorized);
        }
        Err(_) => return Err(AppError::Unauthorized),
    };

    // Counter-Writeback, Punkt 4.
    let gefunden = crate::auth::webauthn::storage::passkey_je_credential_id(
        &state.pool,
        auth_result.cred_id().as_ref(),
    )
    .await?;
    let Some((benutzer_id, mut passkey)) = gefunden else {
        return Err(AppError::Unauthorized);
    };

    // `update_credential` liefert `None` nur bei `cred_id`-Mismatch — unerreichbar, weil der
    // Passkey über genau diese `cred_id` geladen wurde. Deshalb 500 statt 401.
    if passkey.update_credential(&auth_result).is_none() {
        return Err(AppError::Internal(
            "WebAuthn: credential_id-Mismatch beim Counter-Update".to_string(),
        ));
    }
    crate::auth::webauthn::storage::aktualisiere_counter(&state.pool, &passkey).await?;

    let benutzer = sqlx::query_as::<_, Benutzer>(
        "SELECT id, org_id, anzeigename, benutzername, passwort_hash, system_rolle, org_rolle, \
         aktiv, erstellt_at FROM benutzer WHERE id = ?",
    )
    .bind(benutzer_id)
    .fetch_optional(&state.pool)
    .await?;

    // Deaktiviertes Konto → keine Session (Punkt 5).
    let Some(benutzer) = benutzer else {
        return Err(AppError::Unauthorized);
    };
    if !benutzer.aktiv {
        return Err(AppError::Unauthorized);
    }

    let token = session::anlegen(&state.pool, benutzer.id).await?;
    let jar = jar.add(session_cookie(token, session::cookie_secure()));
    let jar = jar.remove(
        Cookie::build((WEBAUTHN_AUTH_COOKIE, ""))
            .path("/api/auth/webauthn")
            .build(),
    );
    Ok((jar, StatusCode::OK))
}

/// Cookie für den discoverable-State-Key (LFH-313). Ein eigener Name, damit benutzergebundene
/// und discoverable Flows schon transportseitig disjunkt sind.
const WEBAUTHN_DISC_COOKIE: &str = "webauthn_disc";

/// Baut das discoverable-State-Cookie (analog `webauthn_auth_cookie`).
fn webauthn_disc_cookie(key: String, secure: bool) -> Cookie<'static> {
    Cookie::build((WEBAUTHN_DISC_COOKIE, key))
        .http_only(true)
        .same_site(SameSite::Lax)
        .secure(secure)
        .path("/api/auth/webauthn")
        .build()
}

/// POST /api/auth/webauthn/discoverable/start — beginnt eine **usernameless**
/// Passkey-Zeremonie (öffentlich, LFH-313). Kein Body: der Authenticator entdeckt den Benutzer
/// selbst, die Antwort verrät nichts über Konten oder Passkeys. 404, wenn `webauthn` nicht aktiv
/// ist.
///
/// `mediation` wird auf `None` gesetzt: die Bibliothek setzt `Conditional` (Autofill), gewollt
/// ist der Button-Flow. Das Frontend reicht ohnehin nur `rcr.publicKey` weiter; das Nullen
/// sichert ein künftiges Frontend ab, das den ganzen Wrapper übergäbe.
pub async fn webauthn_discoverable_start(
    State(state): State<AppState>,
    jar: CookieJar,
) -> Result<(CookieJar, Json<RequestChallengeResponse>), AppError> {
    if !webauthn_aktiv(&state.pool).await? {
        return Err(AppError::NotFound);
    }
    let webauthn = crate::auth::webauthn::webauthn().ok_or(AppError::NotFound)?;

    // Ohne Nutzerbezug ist ein Fehler hier ein echter Serverfehler (500).
    let (mut rcr, disc_state) = webauthn.start_discoverable_authentication().map_err(|e| {
        AppError::Internal(format!("WebAuthn-Discoverable-Start fehlgeschlagen: {e}"))
    })?;
    rcr.mediation = None;

    let key = session::neuer_token();
    crate::auth::webauthn::state::speichere(
        key.clone(),
        crate::auth::webauthn::state::CeremonyZustand::AuthentifizierungDiscoverable(disc_state),
    );

    let jar = jar.add(webauthn_disc_cookie(key, session::cookie_secure()));
    Ok((jar, Json(rcr)))
}

/// POST /api/auth/webauthn/discoverable/finish — schließt den usernameless Login ab
/// (öffentlich, LFH-313). **Security-kritisch**, Ablauf wie `webauthn_auth_finish`, außer bei
/// der Benutzer-Auflösung:
///
/// 1. 404, wenn `webauthn` aus; `entnehme` synchron und nur für die Variante
///    `AuthentifizierungDiscoverable`, sonst 401.
/// 2. `identify_discoverable_authentication` liefert den User-Handle aus der Assertion.
/// 3. Benutzer per `benutzer_je_user_handle` (nur aktive) → sonst 401; dessen Passkeys als
///    `DiscoverableKey`-Kandidaten laden.
/// 4. `finish_discoverable_authentication` prüft Signatur und Counter/Klon; jeder Fehler → 401.
/// 5. Counter-Writeback über die genutzte `cred_id`; der darüber gefundene Benutzer MUSS der
///    per Handle aufgelöste sein.
/// 6. Aktiv-Check, Session, Cookies, `LoginOk`-Audit, 200.
pub async fn webauthn_discoverable_finish(
    State(state): State<AppState>,
    PeerIp(peer_ip): PeerIp,
    jar: CookieJar,
    JsonBody(body): JsonBody<PublicKeyCredential>,
) -> Result<(CookieJar, StatusCode), AppError> {
    if !webauthn_aktiv(&state.pool).await? {
        return Err(AppError::NotFound);
    }
    let webauthn = crate::auth::webauthn::webauthn().ok_or(AppError::NotFound)?;

    let key = jar
        .get(WEBAUTHN_DISC_COOKIE)
        .map(|c| c.value().to_string())
        .ok_or(AppError::Unauthorized)?;

    // Synchron, Guard vor jedem folgenden `.await` freigegeben.
    let disc_state = match crate::auth::webauthn::state::entnehme(&key) {
        Some(crate::auth::webauthn::state::CeremonyZustand::AuthentifizierungDiscoverable(s)) => s,
        _ => return Err(AppError::Unauthorized),
    };

    let (handle, _cred_id) = webauthn
        .identify_discoverable_authentication(&body)
        .map_err(|_| AppError::Unauthorized)?;

    // Unbekannt oder inaktiv → generischer 401.
    let benutzer_id = crate::auth::webauthn::benutzer_je_user_handle(&state.pool, handle)
        .await?
        .ok_or(AppError::Unauthorized)?;

    // Die Kandidaten-Passkeys injiziert `finish_discoverable_authentication` erst jetzt als
    // erlaubte Credentials in den Zeremonie-State.
    let passkeys =
        crate::auth::webauthn::storage::passkeys_fuer_benutzer(&state.pool, benutzer_id).await?;
    if passkeys.is_empty() {
        return Err(AppError::Unauthorized);
    }
    let kandidaten: Vec<DiscoverableKey> = passkeys
        .iter()
        .map(|pk| DiscoverableKey::from(pk))
        .collect();

    // Counter-/Klon-Check in der Bibliothek, wie im Passkey-Flow.
    let auth_result = match webauthn.finish_discoverable_authentication(
        &body,
        disc_state,
        &kandidaten,
    ) {
        Ok(r) => r,
        Err(WebauthnError::CredentialPossibleCompromise) => {
            tracing::warn!(
                    "WebAuthn-Discoverable-Login abgelehnt: möglicher Klon (Counter-Regression) erkannt"
                );
            return Err(AppError::Unauthorized);
        }
        Err(_) => return Err(AppError::Unauthorized),
    };

    // Counter-Writeback über die genutzte `cred_id`; der gefundene Benutzer muss der per Handle
    // aufgelöste sein, sonst 401.
    let gefunden = crate::auth::webauthn::storage::passkey_je_credential_id(
        &state.pool,
        auth_result.cred_id().as_ref(),
    )
    .await?;
    let Some((cred_benutzer_id, mut passkey)) = gefunden else {
        return Err(AppError::Unauthorized);
    };
    if cred_benutzer_id != benutzer_id {
        return Err(AppError::Unauthorized);
    }

    if passkey.update_credential(&auth_result).is_none() {
        return Err(AppError::Internal(
            "WebAuthn: credential_id-Mismatch beim Counter-Update".to_string(),
        ));
    }
    crate::auth::webauthn::storage::aktualisiere_counter(&state.pool, &passkey).await?;

    let benutzer = sqlx::query_as::<_, Benutzer>(
        "SELECT id, org_id, anzeigename, benutzername, passwort_hash, system_rolle, org_rolle, \
         aktiv, erstellt_at FROM benutzer WHERE id = ?",
    )
    .bind(benutzer_id)
    .fetch_optional(&state.pool)
    .await?;
    let Some(benutzer) = benutzer else {
        return Err(AppError::Unauthorized);
    };
    if !benutzer.aktiv {
        return Err(AppError::Unauthorized);
    }

    let token = session::anlegen(&state.pool, benutzer.id).await?;
    let jar = jar.add(session_cookie(token, session::cookie_secure()));
    let jar = jar.remove(
        Cookie::build((WEBAUTHN_DISC_COOKIE, ""))
            .path("/api/auth/webauthn")
            .build(),
    );

    tracing::info!(
        benutzer_id = benutzer.id,
        benutzername = %benutzer.benutzername,
        peer_ip = ?peer_ip,
        "WebAuthn-Discoverable-Anmeldung erfolgreich"
    );
    crate::auth::audit::schreibe(
        &state.pool,
        crate::auth::audit::AuditEintrag {
            ereignis: crate::auth::audit::Ereignis::LoginOk,
            benutzername: Some(&benutzer.benutzername),
            benutzer_id: Some(benutzer.id),
            peer_ip: peer_ip.map(|ip| ip.to_string()),
            provider: crate::auth::provider::ID_WEBAUTHN,
        },
    )
    .await;

    Ok((jar, StatusCode::OK))
}

/// Antwort auf `POST /api/auth/totp/enroll/start` (LFH-43, Task 4): das frisch erzeugte,
/// noch NICHT aktive TOTP-Secret. `otpauth_url` ist für den QR-Code-Scan gedacht,
/// `secret_base32` als Klartext-Fallback zum manuellen Eintragen in die Authenticator-App.
#[derive(Debug, Serialize, ToSchema)]
pub struct TotpEnrollStart {
    pub otpauth_url: String,
    pub secret_base32: String,
}

/// Body von `POST /api/auth/totp/enroll/finish` (Request-DTO, handgepflegt, nicht im Codegen).
#[derive(Debug, Deserialize)]
pub struct TotpEnrollFinishRequest {
    pub code: String,
}

/// Antwort auf `POST /api/auth/totp/enroll/finish` (LFH-43, Task 4): die frisch erzeugten
/// Recovery-Codes im KLARTEXT — werden NUR HIER, EINMALIG zurückgegeben. Ab dem nächsten
/// Request existieren nur noch ihre sha256-Hashes in `totp_recovery_code`
/// (`totp::storage::speichere_recovery_codes`); ein Verlust dieser Antwort ist nicht
/// rekonstruierbar (Betriebs-Hinweis: Frontend muss die Codes eindringlich anzeigen).
#[derive(Debug, Serialize, ToSchema)]
pub struct TotpEnrollFinish {
    pub recovery_codes: Vec<String>,
}

/// Aktueller Unix-Zeitstempel für TOTP. Tests erzeugen ihren Vergleichscode mit eigenem
/// `SystemTime::now()`; der ±1-Schritt-Skew deckt die Differenz ab.
fn jetzt_unix() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// POST /api/auth/totp/enroll/start — beginnt oder erneuert ein TOTP-Enrollment. Das neue
/// Secret wird sofort gespeichert, aber erst `enroll/finish` aktiviert MFA.
///
/// Ein erneuter `start` überschreibt das Secret und setzt `totp_aktiviert` auf 0 — auch bei
/// bereits aktivem TOTP. Bis zur Bestätigung ist der Nutzer dann ohne Zweitfaktor; das
/// vermeidet ein zusätzliches „Pending-Secret“-Feld und ist unkritisch, weil der Nutzer selbst
/// aus seinem Profil handelt.
pub async fn totp_enroll_start(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
) -> Result<Json<TotpEnrollStart>, AppError> {
    let secret = crate::auth::totp::neues_secret();

    sqlx::query("UPDATE benutzer SET totp_secret = ?, totp_aktiviert = 0 WHERE id = ?")
        .bind(&secret)
        .bind(benutzer.id)
        .execute(&state.pool)
        .await?;

    let otpauth_url = crate::auth::totp::otpauth_url(&secret, &benutzer.benutzername)?;
    Ok(Json(TotpEnrollStart {
        otpauth_url,
        secret_base32: secret,
    }))
}

/// POST /api/auth/totp/enroll/finish — schließt ein Enrollment ab. `totp_secret` wird frisch
/// gelesen, weil `CurrentUser` die `totp_*`-Spalten nicht trägt.
///
/// Ohne `totp_secret` → 400 „Kein TOTP-Enrollment gestartet“. Ein falscher Code → 422, MFA wird
/// nie ohne gültigen Code aktiviert. Ein gültiger Code aktiviert MFA, erzeugt zehn
/// Klartext-Recovery-Codes und ersetzt alte.
pub async fn totp_enroll_finish(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    JsonBody(req): JsonBody<TotpEnrollFinishRequest>,
) -> Result<Json<TotpEnrollFinish>, AppError> {
    let secret: Option<String> =
        sqlx::query_scalar("SELECT totp_secret FROM benutzer WHERE id = ?")
            .bind(benutzer.id)
            .fetch_one(&state.pool)
            .await?;
    let secret =
        secret.ok_or_else(|| AppError::Validation("Kein TOTP-Enrollment gestartet".to_string()))?;

    if !crate::auth::totp::pruefe_code(&secret, &req.code, jetzt_unix()) {
        return Err(AppError::UnprocessableEntity("Code ungültig".to_string()));
    }

    sqlx::query("UPDATE benutzer SET totp_aktiviert = 1 WHERE id = ?")
        .bind(benutzer.id)
        .execute(&state.pool)
        .await?;

    let codes = crate::auth::totp::neue_recovery_codes();
    crate::auth::totp::storage::speichere_recovery_codes(&state.pool, benutzer.id, &codes).await?;

    Ok(Json(TotpEnrollFinish {
        recovery_codes: codes,
    }))
}

/// Body von `POST /api/auth/totp/finish` (handgepflegt). Trägt weder Passwort noch
/// Benutzername — die Identität kommt ausschließlich aus dem Pending-State.
#[derive(Debug, Deserialize)]
pub struct TotpFinishRequest {
    pub code: String,
}

/// POST /api/auth/totp/finish — zweiter Schritt des Passwort→TOTP-Logins (öffentlich,
/// **Security-kritisch**). Die Identität kommt AUSSCHLIESSLICH aus dem `mfa_pending`-State.
///
/// 1. `entnehme` synchron vor jedem `.await` (!Send) und single-use. Fehlendes Cookie oder
///    unbekannter/abgelaufener/verbrauchter Key → 401.
/// 2. `benutzer` frisch per `id` laden. Deaktiviertes Konto oder fehlendes `totp_secret` (etwa
///    nach einem Admin-Reset zwischen `login` und `finish`) → 401.
/// 3. `totp::pruefe_code`, nur bei Fehlschlag EIN atomarer `verbrauche_recovery_code`. Beides
///    `false` → 401, ohne zu verraten, welcher Weg scheiterte.
/// 4. Erst dann Session und Cookie, `mfa_pending` entfernen, 200 mit `BenutzerAnzeige`.
pub async fn totp_finish(
    State(state): State<AppState>,
    jar: CookieJar,
    JsonBody(req): JsonBody<TotpFinishRequest>,
) -> Result<(CookieJar, Json<crate::auth::BenutzerAnzeige>), AppError> {
    let key = jar
        .get(MFA_PENDING_COOKIE)
        .map(|c| c.value().to_string())
        .ok_or(AppError::Unauthorized)?;

    // Synchron, Guard vor jedem folgenden `.await` freigegeben (Punkt 1).
    let benutzer_id = crate::auth::totp::state::entnehme(&key).ok_or(AppError::Unauthorized)?;

    let benutzer = sqlx::query_as::<_, Benutzer>(
        "SELECT id, org_id, anzeigename, benutzername, passwort_hash, system_rolle, org_rolle, \
         aktiv, erstellt_at FROM benutzer WHERE id = ?",
    )
    .bind(benutzer_id)
    .fetch_optional(&state.pool)
    .await?;
    let Some(benutzer) = benutzer else {
        return Err(AppError::Unauthorized);
    };
    if !benutzer.aktiv {
        return Err(AppError::Unauthorized);
    }

    let secret: Option<String> =
        sqlx::query_scalar("SELECT totp_secret FROM benutzer WHERE id = ?")
            .bind(benutzer_id)
            .fetch_one(&state.pool)
            .await?;
    let Some(secret) = secret else {
        return Err(AppError::Unauthorized);
    };

    // `||` schließt kurz: bei gültigem TOTP-Code wird kein Recovery-Code verbraucht.
    let gueltig = crate::auth::totp::pruefe_code(&secret, &req.code, jetzt_unix())
        || crate::auth::totp::storage::verbrauche_recovery_code(
            &state.pool,
            benutzer_id,
            &req.code,
        )
        .await?;
    if !gueltig {
        return Err(AppError::Unauthorized);
    }

    let token = session::anlegen(&state.pool, benutzer.id).await?;
    let jar = jar.add(session_cookie(token, session::cookie_secure()));
    let jar = jar.remove(
        Cookie::build((MFA_PENDING_COOKIE, ""))
            .path("/api/auth")
            .build(),
    );
    // Der Pending-State entsteht nur im TOTP-Zweig von `login`; der Status ist hier sicher `true`.
    Ok((jar, Json(benutzer.anzeige(true))))
}

/// Body von `POST /api/auth/app-code` (LFH-818).
#[derive(Debug, Deserialize)]
pub struct AppCodeAnfrage {
    pub challenge: String,
}

/// Antwort von `POST /api/auth/app-code`: der Einmalcode für den Rücksprung in die Mac-App.
#[derive(Debug, Serialize, ToSchema)]
pub struct AppCode {
    pub code: String,
}

/// Body von `POST /api/auth/app-code/einloesen` (LFH-818).
#[derive(Debug, Deserialize)]
pub struct AppCodeEinloesen {
    pub code: String,
    pub verifier: String,
}

/// POST /api/auth/app-code — stellt aus der bestehenden Browsersitzung einen Einmalcode aus,
/// gebunden an die `challenge` der macOS-Hülle (LFH-818). Die Webanwendung ruft das erst nach
/// der ausdrücklichen Bestätigung auf `/app-anmeldung` auf. Ohne Sitzung 401, `challenge` in
/// falscher Form 400.
pub async fn app_code_ausstellen(
    CurrentUser(benutzer): CurrentUser,
    JsonBody(req): JsonBody<AppCodeAnfrage>,
) -> Result<Json<AppCode>, AppError> {
    if !crate::auth::huelle::pkce::challenge_gueltig(&req.challenge) {
        return Err(AppError::Validation(
            "challenge muss aus 43 base64url-Zeichen bestehen".to_string(),
        ));
    }
    let code = session::neuer_token();
    crate::auth::huelle::state::speichere(
        code.clone(),
        crate::auth::huelle::state::CodeEintrag {
            benutzer_id: benutzer.id,
            challenge: req.challenge,
        },
    );
    Ok(Json(AppCode { code }))
}

/// POST /api/auth/app-code/einloesen — löst einen Einmalcode mit dem `verifier` ein und legt im
/// anfragenden Cookie-Speicher (Webview der Hülle) eine eigene Sitzung an (LFH-818).
///
/// Reihenfolge: Form (400) → Sperre der Adresse (429) → Code entnehmen (damit verbraucht, gleich
/// wie es ausgeht) → `verifier` und aktives Konto. Jedes Scheitern danach ist einheitlich 401,
/// damit die Antwort keinen Grund verrät (unbekannt, abgelaufen, verbraucht, falsch gebunden,
/// deaktiviert); Herleitung: `openspec/changes/lfh-818-anmeldung-im-systembrowser/design.md`,
/// Entscheidung 5.
pub async fn app_code_einloesen(
    State(state): State<AppState>,
    PeerIp(peer_ip): PeerIp,
    jar: CookieJar,
    JsonBody(req): JsonBody<AppCodeEinloesen>,
) -> Result<(CookieJar, StatusCode), AppError> {
    use crate::auth::huelle::{pkce, state as codes, PROVIDER};

    if !codes::code_gueltig(&req.code) || !pkce::verifier_gueltig(&req.verifier) {
        return Err(AppError::Validation(
            "code oder verifier hat nicht die erwartete Form".to_string(),
        ));
    }
    if let Some(ip) = peer_ip {
        if crate::auth::rate_limit::ist_gesperrt(ip) {
            return Err(AppError::TooManyRequests(
                "Zu viele fehlgeschlagene Anmeldeversuche. Bitte kurz warten.".to_string(),
            ));
        }
    }

    // Synchron entnommen, der Guard ist vor dem ersten `.await` frei.
    let eintrag = codes::entnehme(&req.code);
    let gebunden = eintrag
        .as_ref()
        .filter(|e| pkce::passt(&req.verifier, &e.challenge));
    let benutzer = match gebunden {
        Some(e) => {
            sqlx::query_as::<_, Benutzer>(
                "SELECT id, org_id, anzeigename, benutzername, passwort_hash, system_rolle, \
             org_rolle, aktiv, erstellt_at FROM benutzer WHERE id = ? AND aktiv = 1",
            )
            .bind(e.benutzer_id)
            .fetch_optional(&state.pool)
            .await?
        }
        None => None,
    };
    let Some(benutzer) = benutzer else {
        if let Some(ip) = peer_ip {
            crate::auth::rate_limit::fehlversuch(ip);
        }
        tracing::warn!(peer_ip = ?peer_ip, "Anmeldung aus dem Browser abgewiesen");
        crate::auth::audit::schreibe(
            &state.pool,
            crate::auth::audit::AuditEintrag {
                ereignis: crate::auth::audit::Ereignis::LoginFehlgeschlagen,
                benutzername: None,
                benutzer_id: eintrag.map(|e| e.benutzer_id),
                peer_ip: peer_ip.map(|ip| ip.to_string()),
                provider: PROVIDER,
            },
        )
        .await;
        return Err(AppError::Unauthorized);
    };

    if let Some(ip) = peer_ip {
        crate::auth::rate_limit::erfolg(ip);
    }
    // Eine übrig gebliebene Sitzung im Webview würde sonst verwaist in der Tabelle stehen.
    if let Some(alt) = jar.get(SESSION_COOKIE) {
        session::loeschen(&state.pool, alt.value()).await?;
    }
    let token = session::anlegen(&state.pool, benutzer.id).await?;
    let jar = jar.add(session_cookie(token, session::cookie_secure()));
    tracing::info!(
        benutzer_id = benutzer.id,
        benutzername = %benutzer.benutzername,
        peer_ip = ?peer_ip,
        "Anmeldung aus dem Browser eingelöst"
    );
    crate::auth::audit::schreibe(
        &state.pool,
        crate::auth::audit::AuditEintrag {
            ereignis: crate::auth::audit::Ereignis::LoginOk,
            benutzername: Some(&benutzer.benutzername),
            benutzer_id: Some(benutzer.id),
            peer_ip: peer_ip.map(|ip| ip.to_string()),
            provider: PROVIDER,
        },
    )
    .await;
    Ok((jar, StatusCode::NO_CONTENT))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_cookie_secure_folgt_parameter() {
        // Beide Zweige, ohne OnceLock.
        assert_eq!(session_cookie("t".into(), true).secure(), Some(true));
        assert_ne!(session_cookie("t".into(), false).secure(), Some(true));
    }

    #[test]
    fn session_cookie_lebt_so_lange_wie_die_serversitzung() {
        // LFH-779: ohne Max-Age verwirft eine Webview das Cookie beim Neustart.
        assert_eq!(
            session_cookie("t".into(), false).max_age(),
            Some(time::Duration::days(7))
        );
    }

    #[test]
    fn ziel_pfad_aus_query_akzeptiert_app_lokale_pfade() {
        assert_eq!(
            ziel_pfad_aus_query(Some("/einsaetze".to_string())),
            "/einsaetze"
        );
        assert_eq!(ziel_pfad_aus_query(Some("/uhs/5".to_string())), "/uhs/5");
        assert_eq!(ziel_pfad_aus_query(Some("/".to_string())), "/");
    }

    #[test]
    fn ziel_pfad_aus_query_lehnt_open_redirect_versuche_ab() {
        // Protokoll-relativ.
        assert_eq!(
            ziel_pfad_aus_query(Some("//evil.com".to_string())),
            "/einsaetze"
        );
        // Browser normalisieren "/\evil.com" zu einer protokoll-relativen URL.
        assert_eq!(
            ziel_pfad_aus_query(Some("/\\evil.com".to_string())),
            "/einsaetze"
        );
        assert_eq!(ziel_pfad_aus_query(Some("/x\\y".to_string())), "/einsaetze");
        // Browser entfernen Tab/CR/LF beim Parsen — "/\t/evil.com" würde zu "//evil.com".
        assert_eq!(
            ziel_pfad_aus_query(Some("/\t/evil.com".to_string())),
            "/einsaetze"
        );
        assert_eq!(
            ziel_pfad_aus_query(Some("/\r/evil.com".to_string())),
            "/einsaetze"
        );
        assert_eq!(
            ziel_pfad_aus_query(Some("/\n/evil.com".to_string())),
            "/einsaetze"
        );
        // Kein führender Slash — absolute fremde URL.
        assert_eq!(
            ziel_pfad_aus_query(Some("https://evil.com".to_string())),
            "/einsaetze"
        );
        assert_eq!(ziel_pfad_aus_query(None), "/einsaetze");
        assert_eq!(ziel_pfad_aus_query(Some(String::new())), "/einsaetze");
    }

    // ===== OIDC-state-Cookie-Bindung (LFH-277) =====

    #[test]
    fn oidc_state_cookie_ist_httponly_lax_und_pfadweit() {
        let c = baue_oidc_state_cookie("abc123".to_string(), true);
        assert_eq!(c.name(), OIDC_STATE_COOKIE);
        assert_eq!(c.value(), "abc123");
        assert_eq!(c.http_only(), Some(true));
        // Lax, nicht Strict: der Cross-Site-Redirect vom IdP muss das Cookie mitschicken.
        assert_eq!(c.same_site(), Some(SameSite::Lax));
        assert_eq!(c.path(), Some("/"));
        assert_eq!(c.secure(), Some(true));
    }

    #[test]
    fn oidc_state_cookie_secure_folgt_parameter() {
        // Beide Zweige, ohne OnceLock.
        assert_eq!(
            baue_oidc_state_cookie("x".into(), true).secure(),
            Some(true)
        );
        assert_ne!(
            baue_oidc_state_cookie("x".into(), false).secure(),
            Some(true)
        );
    }

    #[test]
    fn oidc_state_removal_cookie_leert_wert_und_pfad() {
        let c = raeume_oidc_state_cookie();
        assert_eq!(c.name(), OIDC_STATE_COOKIE);
        assert_eq!(c.value(), "");
        assert_eq!(c.path(), Some("/"));
    }

    #[test]
    fn binding_match_nur_bei_gleichem_state() {
        assert!(oidc_state_binding_ok(Some("s1"), "s1"));
        assert!(!oidc_state_binding_ok(Some("anders"), "s1"));
        assert!(!oidc_state_binding_ok(None, "s1"));
    }

    // ===== Public-vs-Admin-Provider-Projektion (LFH-277) =====

    #[tokio::test]
    async fn public_providers_verbergen_deaktivierte_admin_zeigt_sie() {
        crate::auth::provider::registry::set_oidc_konfiguriert(true);
        let pool = crate::db::test_pool().await;
        crate::auth::provider::registry::schalten(&pool, crate::auth::provider::ID_OIDC, false)
            .await
            .unwrap();

        let public = public_provider_projektion(
            crate::auth::provider::registry::liste(&pool).await.unwrap(),
        );
        assert!(public.iter().all(|p| p.aktiviert), "public: nur aktivierte");
        assert!(
            !public.iter().any(|p| p.id == "oidc"),
            "public: deaktiviertes oidc nicht sichtbar"
        );

        let admin = crate::auth::provider::registry::liste(&pool).await.unwrap();
        assert!(
            admin.iter().any(|p| p.id == "oidc" && !p.aktiviert),
            "admin: deaktiviertes oidc sichtbar"
        );
    }
}
