use crate::app::AppState;
use crate::auth::session::{self, CurrentUser, SESSION_COOKIE};
use crate::error::AppError;
use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::response::Redirect;
use axum::Json;
use axum_extra::extract::cookie::{Cookie, CookieJar, SameSite};
use openidconnect::core::CoreAuthenticationFlow;
use openidconnect::{CsrfToken, Nonce, PkceCodeChallenge, Scope, TokenResponse};
use serde::Deserialize;
use sqlx::SqlitePool;
use webauthn_rs::prelude::{CreationChallengeResponse, RegisterPublicKeyCredential};

#[derive(Debug, Deserialize)]
pub struct LoginRequest {
    pub benutzername: String,
    pub passwort: String,
}

/// Baut das Session-Cookie. `Secure` folgt jetzt dem Transport (HTTPS → an,
/// HTTP → aus), gesteuert vom Aufrufer (siehe Spec Abschnitt 14). Pur, damit
/// beide Zweige ohne den prozessweiten OnceLock testbar sind — der Aufrufer
/// (`login`) liest `cookie_secure()`.
fn session_cookie(token: String, secure: bool) -> Cookie<'static> {
    Cookie::build((SESSION_COOKIE, token))
        .http_only(true)
        .same_site(SameSite::Lax)
        .secure(secure)
        .path("/")
        .build()
}

/// POST /api/auth/login — prüft Anmeldedaten, legt Session an, setzt Cookie.
///
/// Enforcement-Seam (LFH-41, Increment 3, defensiv/zukunftssicher): vor `password::anmelden`
/// wird über dieselbe Registry-Prüfung wie bei `oidc_start`/`oidc_callback` geprüft, ob der
/// `passwort`-Provider aktiviert ist — nicht aktiviert → `403` statt Authentifizierung. Heute
/// ist dieser Zweig praktisch unerreichbar: der Aussperr-Guard (`registry::schalten` via
/// `darf_deaktivieren`) hält `passwort` undeaktivierbar, solange noch ein aktiver Admin
/// existiert (einzig admin-tauglicher Provider in Increment 3, siehe `ist_admin_tauglich`).
/// Sobald ein späteres Increment einen zweiten admin-tauglichen Provider hinzufügt (z. B.
/// Admin-Linking für OIDC/WebAuthn), wird `passwort` dadurch legitim deaktivierbar — dieser
/// Seam stellt sicher, dass ein deaktivierter Passwort-Provider `POST /api/auth/login` dann
/// serverseitig tatsächlich blockiert, statt nur das Formular im Frontend zu verstecken.
pub async fn login(
    State(state): State<AppState>,
    jar: CookieJar,
    Json(req): Json<LoginRequest>,
) -> Result<(CookieJar, Json<crate::auth::BenutzerAnzeige>), AppError> {
    let liste = crate::auth::provider::registry::liste(&state.pool).await?;
    let passwort_aktiv = liste
        .iter()
        .any(|p| p.id == crate::auth::provider::ID_PASSWORT && p.aktiviert);
    if !passwort_aktiv {
        return Err(AppError::Forbidden);
    }

    let benutzer =
        crate::auth::provider::password::anmelden(&state.pool, &req.benutzername, &req.passwort)
            .await?;

    let token = session::anlegen(&state.pool, benutzer.id).await?;
    let jar = jar.add(session_cookie(token, crate::auth::session::cookie_secure()));
    Ok((jar, Json(benutzer.anzeige())))
}

/// POST /api/auth/logout — löscht die Session und entfernt das Cookie.
pub async fn logout(
    State(state): State<AppState>,
    jar: CookieJar,
) -> Result<(CookieJar, StatusCode), AppError> {
    if let Some(cookie) = jar.get(SESSION_COOKIE) {
        session::loeschen(&state.pool, cookie.value()).await?;
    }
    let jar = jar.remove(Cookie::build((SESSION_COOKIE, "")).path("/").build());
    Ok((jar, StatusCode::NO_CONTENT))
}

/// GET /api/auth/me — liefert den aktuell angemeldeten Benutzer.
pub async fn me(CurrentUser(benutzer): CurrentUser) -> Json<crate::auth::BenutzerAnzeige> {
    Json(benutzer.anzeige())
}

/// GET /api/auth/providers — verfügbare Login-Provider (öffentlich, für die Login-UI).
pub async fn providers(
    State(state): State<AppState>,
) -> Result<Json<Vec<crate::auth::provider::AuthProviderAnzeige>>, AppError> {
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
    axum::extract::Path(id): axum::extract::Path<String>,
    Json(req): Json<ProviderSchaltenRequest>,
) -> Result<Json<Vec<crate::auth::provider::AuthProviderAnzeige>>, AppError> {
    crate::auth::provider::registry::schalten(&state.pool, &id, req.aktiviert).await?;
    let liste = crate::auth::provider::registry::liste(&state.pool).await?;
    Ok(Json(liste))
}

#[derive(Debug, Deserialize)]
pub struct OidcStartQuery {
    von: Option<String>,
}

/// Ziel-Pfad nach erfolgreichem OIDC-Login: mirrort `LoginPage`s `zielPfad`
/// (Default `/einsaetze`), aber aus einem Query-Param statt Router-State — der
/// OIDC-Flow verlässt die SPA per echtem Browser-Redirect, React-Router-State
/// überlebt das nicht. Nur App-lokale Pfade werden übernommen, sonst der
/// Default — schützt vor Open-Redirect über `?von=`. Neben `//…` (protokoll-
/// relativ) werden auch Backslashes und Control-Zeichen (u. a. Tab, CR, LF)
/// abgelehnt: Browser entfernen laut WHATWG-URL-Spec ASCII-Tab/Newline aus der
/// URL und normalisieren Backslash direkt nach dem führenden Slash zu einem
/// protokoll-relativen `//…` — beides sonst ein Bypass des reinen `//`-Checks
/// (z. B. `/\evil.com` oder `/%09/evil.com`). Pfade dieser App enthalten nie
/// `\` oder Control-Zeichen, daher ist das Verbot diskriminierend, nicht
/// überstreng.
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

/// GET /api/auth/oidc/start — Authorization-Redirect zum konfigurierten OIDC-Provider
/// (PocketID, LFH-41). Enforcement über die Provider-Registry: ist `oidc` nicht gelistet
/// (nicht konfiguriert) oder deaktiviert, liefert dieser Handler `404` — genau wie ein
/// unbekannter Provider bei `provider_schalten`. Ein IdP-/Discovery-Fehler (unerreichbarer
/// Server, kaputte Metadaten) leakt NICHT als 500, sondern leitet zurück auf die Login-Seite
/// mit einem generischen Fehlerhinweis — der lokale Passwort-Login bleibt davon unberührt.
pub async fn oidc_start(
    State(state): State<AppState>,
    Query(query): Query<OidcStartQuery>,
) -> Result<Redirect, AppError> {
    let liste = crate::auth::provider::registry::liste(&state.pool).await?;
    let oidc_aktiv = liste
        .iter()
        .any(|p| p.id == crate::auth::provider::ID_OIDC && p.aktiviert);
    if !oidc_aktiv {
        return Err(AppError::NotFound);
    }

    let client = match crate::auth::oidc::oidc_client(crate::auth::oidc::oidc_settings()).await {
        Ok(client) => client,
        Err(_) => return Ok(oidc_fehler_redirect()),
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

    // Sync — kein Guard über ein `.await` hinweg (Plan-MUST „!Send"). `speichere` kehrt
    // zurück, bevor irgendein weiteres `.await` folgt (hier: gar keins mehr).
    crate::auth::oidc::state::speichere(
        csrf.secret().clone(),
        crate::auth::oidc::state::StateEintrag {
            nonce: nonce.secret().clone(),
            pkce_verifier: pkce_verifier.secret().clone(),
            ziel_pfad,
        },
    );

    Ok(Redirect::to(auth_url.as_str()))
}

/// Alle drei Felder optional: der IdP kann statt `code`/`state` einen `error`-Query-Param
/// zurückliefern (z. B. `?error=access_denied&state=...` bei abgelehnter Zustimmung — ein
/// spec-konformer, normaler Ablauf, RFC 6749 Abschnitt 4.1.2.1). Mit `code`/`state` als
/// Pflichtfeldern hätte axums `Query`-Extractor diesen Fall mit einem rohen 400 abgelehnt, statt
/// dem Handler die Chance zu geben, sauber auf die LoginPage umzuleiten.
#[derive(Debug, Deserialize)]
pub struct OidcCallbackQuery {
    code: Option<String>,
    state: Option<String>,
    error: Option<String>,
}

/// Generischer Fehler-Redirect für den OIDC-Callback: unbekannter/abgelaufener `state`,
/// Token-Tausch-/Discovery-Fehler, fehlendes/ungültiges `id_token` ODER ein deaktiviertes
/// SSO-Konto münden ALLE in denselben Pfad/dieselbe Fehlermeldung — kein IdP-/Validierungs-
/// detail leakt in die HTTP-Antwort (Security-MUST des Plans). Der lokale Passwort-Login
/// bleibt von jedem dieser Fehler unberührt.
fn oidc_fehler_redirect() -> Redirect {
    Redirect::to("/login?fehler=oidc")
}

/// GET /api/auth/oidc/callback — Token-Tausch, `id_token`-Validierung, JIT-Provisioning,
/// Session (LFH-41, Increment 3). **Security-kritisch**, Reihenfolge ist bewusst:
///
/// 1. Enforcement wie `oidc_start` (dieselbe Registry-Prüfung) → 404, falls `oidc` nicht
///    konfiguriert/aktiviert ist.
/// 2. IdP-Error-Callback (`?error=...`, ein normaler Ablauf bei abgelehnter Zustimmung) ODER
///    fehlendes `code`/`state`: ein evtl. vorhandener State-Eintrag wird noch konsumiert, dann
///    generischer Redirect — NOCH VOR `state::entnehme`s eigentlicher Verwendung unten.
/// 3. `state::entnehme(state)` — **SYNC, GANZ ZUERST** (nach Schritt 2): der State-Store-Guard
///    wird darin bereits vor der Rückgabe freigegeben (Task 3/Modul-Doc `state.rs`). Ab hier darf
///    beliebig `.await`et werden, ohne einen std-Mutex-Guard über eine Await-Grenze zu halten
///    (Plan-MUST „!Send"). `None` (unbekannt/abgelaufen/schon verbraucht) → generischer Redirect,
///    NOCH VOR jedem Netzzugriff (Token-Tausch/Discovery).
/// 4. Token-Tausch (`tausche_code_gegen_token`) — erst NACH dem Guard-Drop.
/// 5. `id_token`-Validierung über `openidconnect` (`id_token.claims(&verifier, &nonce)`):
///    verifiziert Signatur (JWKS), `nonce`, `iss`, `aud`, `exp`.
/// 6. JIT-Provisioning (`finde_oder_provisioniere`, Match ausschließlich über `(issuer, sub)`).
/// 7. **[MUST — Task-2-Handoff]** `finde_oder_provisioniere` matcht/legt unabhängig von
///    `benutzer.aktiv` an — ein deaktiviertes SSO-Konto wird HIER zurückgewiesen, es entsteht
///    keine Session.
/// 8. Session anlegen, Cookie setzen, Redirect auf `eintrag.ziel_pfad` (bereits in Task 5
///    Open-Redirect-geprüft, daher hier sicher ausgebbar).
///
/// JEDER Fehler ab Schritt 2 (IdP-Error/fehlende Felder/state/Token/Validierung/Aktiv-Check)
/// mündet in DENSELBEN generischen Redirect — kein Server-Fehler, kein IdP-/Token-Detail-Leak.
/// Nur Datenbankfehler (Registry-Lookup, Provisioning, Session) propagieren als `AppError`
/// (generisches 500, wie überall sonst) — sie enthalten keine IdP-/Token-Details.
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

    // IdP-Error-Callback (z. B. `?error=access_denied&state=...` bei abgelehnter Zustimmung —
    // ein normaler, spec-konformer Ablauf, RFC 6749 4.1.2.1) ODER ein Query-String ohne `code`/
    // `state` (durch die jetzt optionalen Felder lehnt der `Query`-Extractor das nicht mehr mit
    // einer rohen 400 ab): kein Token-Tausch, generischer Redirect wie jeder andere Fehler. Ein
    // evtl. bereits gespeicherter State-Eintrag wird noch KONSUMIERT (nicht nur ignoriert), damit
    // er nicht bis zum TTL-Ablauf verwaist in der Map hängen bleibt.
    if query.error.is_some() || query.code.is_none() || query.state.is_none() {
        if let Some(s) = &query.state {
            let _ = crate::auth::oidc::state::entnehme(s);
        }
        return Ok((jar, oidc_fehler_redirect()));
    }
    // Ab hier sind `code`/`state` durch den Guard oben beide garantiert vorhanden.
    let code = query.code.expect("Guard oben stellt sicher: code ist Some");
    let state_key = query
        .state
        .expect("Guard oben stellt sicher: state ist Some");

    // SYNC, VOR jedem `.await`: siehe Doc-Kommentar oben (Punkt 2) + `state.rs`. Lastragend
    // (nicht nur !Send-relevant): dieser Aufruf MUSS vor dem Token-Tausch/Discovery unten stehen,
    // damit ein unbekannter/abgelaufener `state` VOR jedem Netzzugriff zum Fehler-Redirect
    // kurzschließt (Security-Reihenfolge, kein Test pinnt das — ein Refactor darf diese Zeile
    // nicht hinter `oidc_client`/`tausche_code_gegen_token` verschieben).
    //
    // ⚠️ Ab hier (und in der gesamten restlichen Kette bis zum Aktiv-Check) bleiben die
    // `let Ok(...)/Some(...) = ... else { redirect }`-Arme bewusst DISCARD-NICHT-`?`: jeder
    // Fehlerinhalt (Token-/IdP-/Claims-Detail) wird verworfen statt propagiert. Ein `?` an einer
    // dieser Stellen würde den rohen Fehlertext (`AppError::ServiceUnavailable`/`Display`) in die
    // HTTP-Antwort durchreichen — genau das Detail-Leak, das dieser Handler verhindern soll
    // (Security-MUST des Plans; siehe auch `tausche_code_gegen_token`s Härtung in `oidc/mod.rs`).
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

    // Verifiziert Signatur (JWKS), `nonce`, `iss`, `aud`, `exp` — siehe Doc-Kommentar Punkt 4.
    let Ok(claims) = id_token.claims(&client.id_token_verifier(), &Nonce::new(eintrag.nonce))
    else {
        return Ok((jar, oidc_fehler_redirect()));
    };

    // `name` ist ein lokalisierter Claim (Sprachtag → Wert); ohne Sprachpräferenz wird der
    // Default-Wert genommen, sonst der erste vorhandene.
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

    // [MUST — Task-2-Handoff] siehe Doc-Kommentar Punkt 6.
    if !benutzer.aktiv {
        return Ok((jar, oidc_fehler_redirect()));
    }

    let token = session::anlegen(&state.pool, benutzer.id).await?;
    let jar = jar.add(session_cookie(token, crate::auth::session::cookie_secure()));
    Ok((jar, Redirect::to(&eintrag.ziel_pfad)))
}

/// Cookie-Name für den WebAuthn-Registrierungs-State-Key (LFH-275, Task 5). Trägt NUR den
/// Schlüssel in den kurzlebigen, prozessweiten Ceremony-Store (`auth::webauthn::state`) — NIE
/// die Ceremony (`PasskeyRegistration`) selbst, die bleibt serverseitig. Kurzlebig/registrations-
/// scoped über `path("/api/auth/webauthn")`: das Cookie ist außerhalb dieses Endpoint-Zweigs
/// (z.B. für `/api/auth/login`) irrelevant und wird dem Browser dort auch nicht mitgeschickt.
const WEBAUTHN_REG_COOKIE: &str = "webauthn_reg";

/// Baut das Registrierungs-State-Cookie. Analog `session_cookie` (HttpOnly/SameSite=Lax/
/// `secure` folgt dem Transport), aber path-beschränkt auf die WebAuthn-Routen.
fn webauthn_reg_cookie(key: String, secure: bool) -> Cookie<'static> {
    Cookie::build((WEBAUTHN_REG_COOKIE, key))
        .http_only(true)
        .same_site(SameSite::Lax)
        .secure(secure)
        .path("/api/auth/webauthn")
        .build()
}

/// Enforcement-Check (LFH-275): ist der `webauthn`-Provider registry-seitig aktiviert
/// (konfiguriert UND nicht per Override ausgeschaltet)? Geteilt zwischen `register/start` und
/// `register/finish` — beide liefern `404`, wenn nicht, statt eines Fake-Flows, der erst mitten
/// in der Ceremony scheitert (dieselbe Enforcement-Idee wie `oidc_start`/`oidc_callback`).
async fn webauthn_aktiv(pool: &SqlitePool) -> Result<bool, AppError> {
    let liste = crate::auth::provider::registry::liste(pool).await?;
    Ok(liste
        .iter()
        .any(|p| p.id == crate::auth::provider::ID_WEBAUTHN && p.aktiviert))
}

/// POST /api/auth/webauthn/register/start — beginnt eine Passkey-Registrierungs-Ceremony für
/// den angemeldeten Nutzer (`CurrentUser`-gegated, LFH-275 Task 5). Enforcement: `webauthn`-
/// Provider nicht aktiviert (nicht konfiguriert ODER per Registry ausgeschaltet) → `404`.
///
/// `exclude_credentials` wird mit den `credential_id`s der bereits registrierten Passkeys des
/// Nutzers gefüllt (Plan-MUST) — verhindert, dass derselbe Authenticator zweimal für denselben
/// Nutzer registriert wird (`finish_passkey_registration`/`speichere_passkey` würde das ohnehin
/// über die `credential_id`-UNIQUE-Spalte als 409 abweisen, das hier ist die frühere, für den
/// Client sichtbare Absicherung direkt im Browser-Dialog).
///
/// Der Ceremony-State (`PasskeyRegistration`) landet unter einem frischen, zufälligen Schlüssel
/// im prozessweiten Store (`auth::webauthn::state`, Task 4) — NUR dieser Schlüssel geht als
/// kurzlebiges HttpOnly-Cookie an den Client (`webauthn_reg`), damit `register/finish` dieselbe
/// Ceremony wiederfindet. Die eigentliche `CreationChallengeResponse` (die der Browser für
/// `navigator.credentials.create` braucht) ist reguläres, client-lesbares JSON.
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

    // Serverseitiger Konfigurations-/Bibliotheksfehler (nicht clientauslösbar: `handle`/
    // `benutzername`/`anzeigename` kommen aus der eigenen DB, `exclude` aus eigenen Daten) —
    // `Internal` redigiert die Detailmeldung gegenüber dem Client (nur geloggt), analog `baue()`.
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

/// POST /api/auth/webauthn/register/finish — schließt die Passkey-Registrierung ab
/// (`CurrentUser`-gegated, LFH-275 Task 5). Enforcement wie `register/start` (`404`, falls
/// `webauthn` nicht aktiviert ist).
///
/// Reihenfolge ist bewusst: der State-Key kommt aus dem `webauthn_reg`-Cookie, `entnehme`
/// (SYNC, Guard sofort freigegeben — siehe `auth::webauthn::state`-Moduldoc) läuft VOR jedem
/// weiteren `.await` in diesem Handler, damit kein std-Mutex-Guard über eine Await-Grenze
/// gehalten wird (Plan-MUST „!Send" — sonst wäre der Handler nicht `Send`, `cargo build`
/// bricht das ab). Ein unbekannter/fremder/bereits verbrauchter Key sowie ein Key, der (State-
/// Verwechslung) zufällig auf eine Authentifizierungs-Ceremony zeigt, münden in denselben
/// generischen `400`.
///
/// `speichere_passkey` liefert bei einer `credential_id`-UNIQUE-Verletzung bereits
/// `AppError::Conflict` (409, siehe `storage.rs`) — kein manuelles Mapping hier nötig.
pub async fn webauthn_register_finish(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    jar: CookieJar,
    Json(body): Json<RegisterPublicKeyCredential>,
) -> Result<(CookieJar, StatusCode), AppError> {
    if !webauthn_aktiv(&state.pool).await? {
        return Err(AppError::NotFound);
    }
    let webauthn = crate::auth::webauthn::webauthn().ok_or(AppError::NotFound)?;

    let key = jar
        .get(WEBAUTHN_REG_COOKIE)
        .map(|c| c.value().to_string())
        .ok_or_else(|| AppError::Validation("Keine laufende Registrierung".to_string()))?;

    // SYNC, Guard freigegeben VOR jedem folgenden `.await` — siehe Doc-Kommentar oben.
    let reg = match crate::auth::webauthn::state::entnehme(&key) {
        Some(crate::auth::webauthn::state::CeremonyZustand::Registrierung(reg)) => reg,
        _ => {
            return Err(AppError::Validation(
                "Registrierung abgelaufen oder unbekannt".to_string(),
            ))
        }
    };

    // Fehlschlag hier ist ein echter Ceremony-/Client-Fehler (falsche Challenge, Origin-
    // Mismatch, kaputte Attestation) — die `webauthn-rs`-Fehlermeldungen sind statische,
    // PII-freie Protokollmeldungen (kein Secret-/Config-Leak), daher unbedenklich an den
    // Client durchreichbar (anders als bei OIDC-Token-/IdP-Details).
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_cookie_secure_folgt_parameter() {
        // Diskriminierend: beide Zweige geprüft (kein OnceLock im Test).
        assert_eq!(session_cookie("t".into(), true).secure(), Some(true));
        assert_ne!(session_cookie("t".into(), false).secure(), Some(true));
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
        // Backslash-Bypass: Browser normalisieren "/\evil.com" (WHATWG-URL-Spec) zu
        // einer protokoll-relativen URL → ohne Backslash-Check ein Open-Redirect.
        assert_eq!(
            ziel_pfad_aus_query(Some("/\\evil.com".to_string())),
            "/einsaetze"
        );
        assert_eq!(ziel_pfad_aus_query(Some("/x\\y".to_string())), "/einsaetze");
        // Control-Zeichen (Tab/CR/LF): Browser entfernen diese beim URL-Parsen
        // (WHATWG-URL-Spec) — "/\t/evil.com" würde so zu "//evil.com".
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
}
