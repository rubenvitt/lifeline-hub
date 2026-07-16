use crate::app::AppState;
use crate::auth::session::{self, CurrentUser, SESSION_COOKIE};
use crate::auth::Benutzer;
use crate::error::AppError;
use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::response::Redirect;
use axum::Json;
use axum_extra::extract::cookie::{Cookie, CookieJar, SameSite};
use openidconnect::core::CoreAuthenticationFlow;
use openidconnect::{CsrfToken, Nonce, PkceCodeChallenge, Scope, TokenResponse};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use utoipa::ToSchema;
use webauthn_rs::prelude::{
    CreationChallengeResponse, PublicKeyCredential, RegisterPublicKeyCredential,
    RequestChallengeResponse, WebauthnError,
};

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

/// Cookie-Name für den Pending-MFA-State-Key (LFH-43, Increment 5, Task 5). Trägt NUR den
/// Schlüssel in den kurzlebigen, prozessweiten Store (`auth::totp::state`) — NIE die
/// `benutzer_id` selbst (analog `WEBAUTHN_REG_COOKIE`/`WEBAUTHN_AUTH_COOKIE`). Path-beschränkt
/// auf `/api/auth`, damit das Cookie nicht an fachfremde Routen (z. B. `/api/einsaetze/...`)
/// mitgeschickt wird.
const MFA_PENDING_COOKIE: &str = "mfa_pending";

/// Baut das Pending-MFA-State-Cookie. Analog `webauthn_reg_cookie`/`webauthn_auth_cookie`
/// (HttpOnly/SameSite=Lax/`secure` folgt dem Transport), path-beschränkt auf `/api/auth`.
fn mfa_pending_cookie(key: String, secure: bool) -> Cookie<'static> {
    Cookie::build((MFA_PENDING_COOKIE, key))
        .http_only(true)
        .same_site(SameSite::Lax)
        .secure(secure)
        .path("/api/auth")
        .build()
}

/// Antwort auf `POST /api/auth/login` (LFH-43, Increment 5, Task 5). **Neutralitäts-MUST des
/// Plans:** `#[serde(untagged)]` lässt den `Angemeldet`-Zweig BYTE-IDENTISCH als die nackte
/// `BenutzerAnzeige` serialisieren (kein zusätzliches Wrapper-Feld) — ein `totp_aktiviert = 0`-
/// Login (der Normalfall) ist damit exakt wie vor diesem Increment. Nur ein `totp_aktiviert = 1`-
/// Nutzer sieht stattdessen die schmale `{"mfa_erforderlich":"totp"}`-Form (kein Benutzer-Objekt,
/// kein Session-Cookie — s. `login`-Doc). Bewusst NICHT in `api_doc.rs`/Codegen registriert
/// (Konvention CLAUDE.md „Backend↔Frontend-Typ-Codegen"): die Nicht-TOTP-Form ist unverändert
/// `BenutzerAnzeige`, die Frontend-Union wird in Task 7 handgepflegt.
#[derive(Debug, Serialize)]
#[serde(untagged)]
pub enum LoginAntwort {
    Angemeldet(crate::auth::BenutzerAnzeige),
    MfaErforderlich { mfa_erforderlich: String },
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
///
/// **[MUST — der Crux, LFH-43 Increment 5 Task 5] Pending-State→Session-Gating:** nach
/// erfolgreicher Passwort-Prüfung verzweigt der Handler auf `totp_aktiviert` — **VOR**
/// `session::anlegen`. Ein `totp_aktiviert`-Nutzer mit korrektem Passwort bekommt KEINE Session
/// und KEIN Session-Cookie, sondern einen frischen, high-entropy Pending-Key
/// (`session::neuer_token()`, dieselbe CSPRNG-Quelle wie ein echter Session-Token) im
/// prozessweiten `auth::totp::state`-Store (`benutzer_id` dahinter) sowie ein HttpOnly-
/// `mfa_pending`-Cookie, das NUR diesen Key trägt. Die einzige Brücke zur Session ist danach
/// `/api/auth/totp/finish` (unten) — der EINZIGE Pfad zu `session::anlegen` für einen
/// `totp_aktiviert`-Nutzer ist ein verifizierter Zweitfaktor. Ein `totp_aktiviert = 0`-Nutzer
/// (der Normalfall) durchläuft unverändert den bestehenden Sofort-Session-Zweig — s.
/// `LoginAntwort`-Doc für die Byte-Identität der Response in diesem Fall.
///
/// Der `dev-seeds`-Login (`routes::dev::users`) POSTet auf denselben Handler und erbt diesen
/// Branch — bewusst kein zweiter Passwort→Session-Pfad, der ihn umgehen könnte (Plan-MUST).
pub async fn login(
    State(state): State<AppState>,
    jar: CookieJar,
    Json(req): Json<LoginRequest>,
) -> Result<(CookieJar, Json<LoginAntwort>), AppError> {
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

    let totp_aktiviert: bool =
        sqlx::query_scalar("SELECT totp_aktiviert FROM benutzer WHERE id = ?")
            .bind(benutzer.id)
            .fetch_one(&state.pool)
            .await?;

    if totp_aktiviert {
        // KEINE Session, KEIN Session-Cookie — s. Doc-Kommentar oben (Plan-Crux).
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
    // An dieser Stelle ist `totp_aktiviert` bereits als `false` erwiesen — der `if`-Zweig oben
    // ist bei `true` bereits mit `return` verlassen worden.
    Ok((
        jar,
        Json(LoginAntwort::Angemeldet(benutzer.anzeige(totp_aktiviert))),
    ))
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

/// GET /api/auth/me — liefert den aktuell angemeldeten Benutzer (inkl. MFA-Status,
/// LFH-43 Increment 5 Task 6). Lädt `totp_aktiviert` per gezieltem Zusatz-SELECT nach — der
/// `CurrentUser`-Extractor liefert einen `Benutzer` OHNE `totp_*`-Spalten (s. `Benutzer::anzeige`-
/// Doc).
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

/// Cookie-Name für das OIDC-`state`-Binding-Cookie (Session-Fixation-Defense, LFH-277). Trägt
/// NUR den `state`/`csrf`-Wert, den `oidc_start` auch als `state`-Query-Param an den IdP
/// weitergibt — `oidc_callback` erzwingt zusätzlich zum State-Store-Lookup (`state::entnehme`),
/// dass dieser Cookie-Wert exakt dem zurückgegebenen `state`-Query entspricht. Ohne diese Bindung
/// könnte ein Angreifer einen selbst erzeugten `state` (z. B. per `<img>`-Tag oder Redirect) in
/// den Browser eines Opfers injizieren (Session-Fixation): der State-Store allein bindet den
/// `state` an KEINEN bestimmten Browser, nur an eine bestimmte Zeitspanne.
const OIDC_STATE_COOKIE: &str = "oidc_state";

/// Baut das HttpOnly-Binding-Cookie für den OIDC-`state`. Analog `mfa_pending_cookie`/
/// `webauthn_reg_cookie` (HttpOnly, `secure` als expliziter Parameter statt direktem
/// `cookie_secure()`-Read — pur testbar ohne den prozessweiten OnceLock), pfadweit (`/`), da der
/// Callback unter einem anderen Pfad (`/api/auth/oidc/callback`) liegt als `start`
/// (`/api/auth/oidc/start`) und das Cookie dort ankommen muss.
///
/// **SameSite=Lax (MUST, nicht Strict):** der Callback trifft als Cross-Site-Top-Level-Redirect
/// vom IdP ein — bei `Strict` würde der Browser das Cookie dort NICHT mitsenden, der Binding-
/// Check in `oidc_callback` schlüge dann IMMER fehl und OIDC-Login wäre kaputt. Bewusst NICHT
/// blind das Session-Cookie-`SameSite` übernommen (zufällig ebenfalls `Lax`, aber aus einem
/// anderen Grund — kein Kopiervorlage-Argument).
///
/// Kein `max_age`/`Expires`: wie die übrigen State-Cookies in dieser Datei (`mfa_pending`,
/// `webauthn_reg`, `webauthn_auth`) trägt dieses Cookie keine explizite Lebensdauer — es wird
/// stattdessen aktiv auf JEDEM `oidc_callback`-Rückgabepfad entfernt (`raeume_oidc_state_cookie`).
/// Das Backend-`state`-Store-TTL (`auth::oidc::state`, 10 Minuten) begrenzt ohnehin, wie lange
/// ein nicht abgeschlossener Flow überhaupt noch gültig wäre. (`time::Duration` für `max_age`
/// steht hier zudem gar nicht zur Verfügung — die `time`-Crate ist nur eine transitive
/// `cookie`-Abhängigkeit, nicht in `Cargo.toml` direkt deklariert.)
fn baue_oidc_state_cookie(state: String, secure: bool) -> Cookie<'static> {
    Cookie::build((OIDC_STATE_COOKIE, state))
        .http_only(true)
        .same_site(SameSite::Lax)
        .secure(secure)
        .path("/")
        .build()
}

/// Removal-Cookie für `OIDC_STATE_COOKIE` — analog den `jar.remove(Cookie::build((NAME, ""))…)`-
/// Aufrufen in `logout`/`webauthn_register_finish`/`webauthn_auth_finish`/`totp_finish`: leerer
/// Wert, `path` muss dem Setz-Cookie entsprechen, damit der Browser ihn matcht. Eigene Funktion
/// (statt Inline wie an den anderen Stellen), weil `oidc_callback` sie auf JEDEM Rückgabepfad
/// braucht (Erfolg wie jeder Fehlerzweig) — Inline würde sich mehrfach wiederholen.
fn raeume_oidc_state_cookie() -> Cookie<'static> {
    Cookie::build((OIDC_STATE_COOKIE, "")).path("/").build()
}

/// True nur, wenn der Binding-Cookie-Wert exakt dem zurückgegebenen `state`-Query entspricht
/// (Session-Fixation-Defense, LFH-277). Pur/ohne `CookieJar`, damit die Kernlogik ohne
/// HTTP-Harness testbar ist.
fn oidc_state_binding_ok(cookie_state: Option<&str>, state_query: &str) -> bool {
    cookie_state == Some(state_query)
}

/// GET /api/auth/oidc/start — Authorization-Redirect zum konfigurierten OIDC-Provider
/// (PocketID, LFH-41). Enforcement über die Provider-Registry: ist `oidc` nicht gelistet
/// (nicht konfiguriert) oder deaktiviert, liefert dieser Handler `404` — genau wie ein
/// unbekannter Provider bei `provider_schalten`. Ein IdP-/Discovery-Fehler (unerreichbarer
/// Server, kaputte Metadaten) leakt NICHT als 500, sondern leitet zurück auf die Login-Seite
/// mit einem generischen Fehlerhinweis — der lokale Passwort-Login bleibt davon unberührt.
///
/// Setzt (nach `state::speichere`) das HttpOnly-`oidc_state`-Binding-Cookie mit dem `csrf`-Wert
/// (Session-Fixation-Defense, LFH-277) — `oidc_callback` erzwingt später, dass dieser Cookie-
/// Wert exakt dem zurückgegebenen `state`-Query entspricht.
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
        // Noch kein `state` erzeugt/gespeichert — kein Binding-Cookie zu setzen, `jar` geht
        // unverändert durch.
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

    // Binding-Cookie (Session-Fixation-Defense, LFH-277) — s. `baue_oidc_state_cookie`-Doc.
    let jar = jar.add(baue_oidc_state_cookie(
        csrf.secret().clone(),
        session::cookie_secure(),
    ));
    Ok((jar, Redirect::to(auth_url.as_str())))
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
/// Session (LFH-41, Increment 3; state-Cookie-Bindung LFH-277). **Security-kritisch**,
/// Reihenfolge ist bewusst:
///
/// 1. Enforcement wie `oidc_start` (dieselbe Registry-Prüfung) → 404, falls `oidc` nicht
///    konfiguriert/aktiviert ist.
/// 2. IdP-Error-Callback (`?error=...`, ein normaler Ablauf bei abgelehnter Zustimmung) ODER
///    fehlendes `code`/`state`: ein evtl. vorhandener State-Eintrag wird noch konsumiert, dann
///    generischer Redirect (MIT geräumtem Binding-Cookie) — NOCH VOR `state::entnehme`s
///    eigentlicher Verwendung unten.
/// 3. **[LFH-277] Binding-Check:** der `oidc_state`-Cookie-Wert wird gelesen — **VOR** dem
///    Räumen (das Räum-Cookie überschreibt sonst denselben Namen im `jar`, ein Lesen danach sähe
///    nur noch den leeren Removal-Wert). Erst NACH dem Lesen wird das Removal-Cookie zum `jar`
///    hinzugefügt (`raeume_oidc_state_cookie`) — ab hier trägt JEDER weitere Rückgabepfad (Erfolg
///    wie Fehler) das geräumte Cookie. Stimmt der gelesene Cookie-Wert nicht exakt mit dem
///    `state`-Query überein (`oidc_state_binding_ok`, auch bei fehlendem Cookie), generischer
///    Redirect — **NOCH VOR** `state::entnehme`: ein Binding-Fehlschlag konsumiert den
///    State-Store-Eintrag nicht (der legitime, vom Opfer-Browser gestartete Flow bleibt nutzbar).
/// 4. `state::entnehme(state)` — **SYNC** (nach Schritt 3): der State-Store-Guard wird darin
///    bereits vor der Rückgabe freigegeben (Task 3/Modul-Doc `state.rs`). Ab hier darf beliebig
///    `.await`et werden, ohne einen std-Mutex-Guard über eine Await-Grenze zu halten (Plan-MUST
///    „!Send"). `None` (unbekannt/abgelaufen/schon verbraucht) → generischer Redirect, NOCH VOR
///    jedem Netzzugriff (Token-Tausch/Discovery).
/// 5. Token-Tausch (`tausche_code_gegen_token`) — erst NACH dem Guard-Drop.
/// 6. `id_token`-Validierung über `openidconnect` (`id_token.claims(&verifier, &nonce)`):
///    verifiziert Signatur (JWKS), `nonce`, `iss`, `aud`, `exp`.
/// 7. JIT-Provisioning (`finde_oder_provisioniere`, Match ausschließlich über `(issuer, sub)`).
/// 8. **[MUST — Task-2-Handoff]** `finde_oder_provisioniere` matcht/legt unabhängig von
///    `benutzer.aktiv` an — ein deaktiviertes SSO-Konto wird HIER zurückgewiesen, es entsteht
///    keine Session.
/// 9. Session anlegen, Cookie setzen, Redirect auf `eintrag.ziel_pfad` (bereits in Task 5
///    Open-Redirect-geprüft, daher hier sicher ausgebbar).
///
/// JEDER Fehler ab Schritt 2 (IdP-Error/fehlende Felder/Binding/state/Token/Validierung/
/// Aktiv-Check) mündet in DENSELBEN generischen Redirect — kein Server-Fehler, kein IdP-/
/// Token-Detail-Leak. Nur Datenbankfehler (Registry-Lookup, Provisioning, Session) propagieren
/// als `AppError` (generisches 500, wie überall sonst) — sie enthalten keine IdP-/Token-Details.
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
    // er nicht bis zum TTL-Ablauf verwaist in der Map hängen bleibt. Binding-Cookie räumen wie
    // auf jedem anderen Rückgabepfad (LFH-277).
    if query.error.is_some() || query.code.is_none() || query.state.is_none() {
        if let Some(s) = &query.state {
            let _ = crate::auth::oidc::state::entnehme(s);
        }
        return Ok((jar.add(raeume_oidc_state_cookie()), oidc_fehler_redirect()));
    }
    // Ab hier sind `code`/`state` durch den Guard oben beide garantiert vorhanden.
    let code = query.code.expect("Guard oben stellt sicher: code ist Some");
    let state_key = query
        .state
        .expect("Guard oben stellt sicher: state ist Some");

    // [LFH-277] Binding-Check — s. Doc-Kommentar oben (Punkt 3). Cookie-Wert VOR dem Räumen
    // lesen: das Räum-Cookie trägt denselben Namen (`OIDC_STATE_COOKIE`) im `jar` — ein `get`
    // NACH dem `add` sähe nur noch den leeren Removal-Wert, jede Anmeldung würde dann fälschlich
    // am Binding-Check scheitern.
    let cookie_state = jar.get(OIDC_STATE_COOKIE).map(|c| c.value().to_string());
    // Ab hier trägt jeder weitere Rückgabepfad (Erfolg wie Fehler) das geräumte Cookie.
    let jar = jar.add(raeume_oidc_state_cookie());
    if !oidc_state_binding_ok(cookie_state.as_deref(), &state_key) {
        // Bewusst KEIN `state::entnehme` hier: ein Binding-Fehlschlag darf den State-Store-
        // Eintrag NICHT konsumieren — s. Doc-Kommentar Punkt 3 (der legitime Flow des Opfer-
        // Browsers bleibt dadurch nutzbar, statt von einem gefälschten Callback-Versuch
        // "verbrannt" zu werden).
        return Ok((jar, oidc_fehler_redirect()));
    }

    // SYNC, VOR jedem `.await`: siehe Doc-Kommentar oben (Punkt 4) + `state.rs`. Lastragend
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

    // Verifiziert Signatur (JWKS), `nonce`, `iss`, `aud`, `exp` — siehe Doc-Kommentar Punkt 6.
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

    // [MUST — Task-2-Handoff] siehe Doc-Kommentar Punkt 8.
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

/// Cookie-Name für den WebAuthn-Authentifizierungs-State-Key (LFH-275, Task 6). Analog
/// `WEBAUTHN_REG_COOKIE` (Task 5): trägt NUR den Schlüssel in den kurzlebigen, prozessweiten
/// Ceremony-Store (`auth::webauthn::state`) — NIE die Ceremony (`PasskeyAuthentication`) selbst.
const WEBAUTHN_AUTH_COOKIE: &str = "webauthn_auth";

/// Baut das Authentifizierungs-State-Cookie. Analog `webauthn_reg_cookie` (HttpOnly/
/// SameSite=Lax/`secure` folgt dem Transport), path-beschränkt auf die WebAuthn-Routen.
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

/// SELECT-Feldliste für `Benutzer`, identisch zu `session.rs`/`password.rs` (sqlx-0.9
/// `SqlSafeStr` verlangt `&'static str` je Aufrufstelle — Memory: sqlx-09-sqlsafestr-query-as;
/// die Liste wird bewusst je Query dupliziert statt "zentral" geteilt).
///
/// POST /api/auth/webauthn/auth/start — beginnt eine passwortlose Passkey-Authentifizierungs-
/// Ceremony (öffentlich, PRE-Login, LFH-275 Task 6). Enforcement wie `register/start`/`finish`
/// (`404`, falls `webauthn` nicht aktiviert ist).
///
/// **NO-user-enumeration (MUST):** ein unbekannter/inaktiver Benutzername, ein existierender
/// Benutzer OHNE registrierten Passkey und jeder weitere Fehler vor dem eigentlichen
/// Ceremony-Start münden alle in DENSELBEN generischen `401` (`AppError::Unauthorized`,
/// Meldungstext „Nicht angemeldet") — exakt das Präzedenzmuster aus `password::anmelden` (dort
/// ebenfalls `Unauthorized` sowohl für „Nutzer existiert nicht" als auch „falsches Passwort").
///
/// Dokumentierter Tradeoff (Plan/Task-Brief): WebAuthn selbst gibt über `allowCredentials` in der
/// zurückgegebenen `RequestChallengeResponse` implizit etwas preis (Anzahl/IDs der Credentials),
/// sobald ein Nutzer mindestens einen Passkey hat — das ist protokoll-inhärent und ohne
/// discoverable/usernameless Login (bewusst zurückgestellt, LFH-277) serverseitig nicht
/// vermeidbar. Was HIER verhindert wird: dass die HTTP-Antwort selbst (Statuscode/Fehlertext)
/// zwischen „Nutzer existiert nicht" und „Nutzer hat keinen Passkey" unterscheidet.
pub async fn webauthn_auth_start(
    State(state): State<AppState>,
    jar: CookieJar,
    Json(req): Json<WebauthnAuthStartRequest>,
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

    // Generischer Fehler ab hier für ALLE drei Fälle (NO-Enumeration-MUST, s. Doc oben):
    // unbekannter/inaktiver Benutzername, existierender Benutzer ohne Passkey, Ceremony-Start-
    // Fehler der Bibliothek.
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

/// POST /api/auth/webauthn/auth/finish — schließt die passwortlose Passkey-Authentifizierung ab
/// (öffentlich, PRE-Login, LFH-275 Task 6). **Security-kritisch** — Reihenfolge/Guards bewusst:
///
/// 1. Enforcement wie `auth/start` (`404`, falls `webauthn` nicht aktiviert ist).
/// 2. State-Key aus dem `webauthn_auth`-Cookie; `entnehme` (SYNC, Guard sofort freigegeben — s.
///    `auth::webauthn::state`-Moduldoc) läuft VOR jedem weiteren `.await` in diesem Handler
///    (Plan-MUST „!Send" — sonst wäre der Handler nicht `Send`, `cargo build` bricht das ab).
///    Fehlendes Cookie, unbekannter/verbrauchter Key ODER ein Key, der (State-Verwechslung)
///    zufällig auf eine Registrierungs- statt Authentifizierungs-Ceremony zeigt → derselbe
///    generische `401`.
/// 3. `webauthn.finish_passkey_authentication(&body, &auth_state)` — **der Counter-/Klon-Check
///    passiert HIER BEREITS INNERHALB der Bibliothek**, s. Abschnitt „Verifizierte Semantik"
///    unten. Jeder Fehler (inkl. Klon-Signal) → derselbe generische `401`, keine Session.
/// 4. Counter-Writeback (Plan-MUST): den zur `cred_id` gehörenden gespeicherten Passkey laden,
///    `passkey.update_credential(&auth_result)` (aktualisiert den lokalen Counter/Backup-Flags),
///    dann re-serialisiert über `storage::aktualisiere_counter` persistieren.
/// 5. `benutzer.aktiv` prüfen — ein zwischenzeitlich deaktiviertes Konto bekommt trotz gültiger
///    Signatur keine Session (analog OIDC Task-2-Handoff).
/// 6. Session anlegen, Cookie setzen, `webauthn_auth`-Cookie entfernen, `200`.
///
/// # Verifizierte webauthn-rs-0.5.5-Semantik (Security-Crux dieses Tasks)
///
/// Gegen den Crate-Quelltext geprüft (`webauthn-rs-core-0.5.5/src/core.rs`,
/// `authenticate_credential`, ca. Zeilen 1139–1175): `WebauthnCore::new_unsafe_experts_only`
/// (aufgerufen von `WebauthnBuilder::build()`, `webauthn-rs-0.5.5/src/lib.rs`) setzt
/// `require_valid_counter_value: true` FEST — die sichere `webauthn-rs`-Fassade exponiert dafür
/// KEINEN Abschalt-Knopf. Mit diesem Flag prüft `authenticate_credential` selbst: ist
/// `auth_data.counter <= cred.counter` (der Zustand, der beim `auth/start` in die
/// `PasskeyAuthentication` eingefroren wurde) UND war mindestens einer der beiden Counter > 0, so
/// liefert die Funktion `Err(WebauthnError::CredentialPossibleCompromise)` — **kein
/// `AuthenticationResult`**, die Ceremony schlägt fehl, BEVOR unser Handler-Code überhaupt
/// `update_credential`/`aktualisiere_counter` erreicht. Ein Klon-/Replay-Versuch mit
/// gleichem-oder-kleinerem Counter wird also bereits von der Bibliothek abgelehnt, nicht erst
/// nachträglich von uns erkannt — unser Code muss (und darf) diesen Check NICHT selbst
/// nachbauen, nur den `Err`-Fall generisch behandeln (s. u.) und im Erfolgsfall zurückschreiben.
///
/// **Ausnahme (protokoll-inhärent, keine Schwächung unsererseits):** Passkeys mit `counter == 0`
/// bei JEDER Authentisierung (viele synchronisierte Platform-Passkeys, z. B. iCloud-Keychain-
/// Passkeys, führen nie einen Hardware-Counter) überspringen den Vergleich komplett (`counter >
/// 0 || cred.counter > 0` ist dann `false`) — für diese Geräteklasse ist Counter-basierte
/// Klon-Erkennung laut WebAuthn-Spezifikation selbst nicht verfügbar, das ist keine Lücke dieses
/// Codes.
///
/// Trotzdem MÜSSEN wir `update_credential` + `aktualisiere_counter` aufrufen (Plan-MUST): für
/// Authenticatoren, die den Counter sehr wohl führen (Hardware-Keys, viele Roaming-
/// Authenticatoren), ist das Zurückschreiben die einzige Möglichkeit, dass der NÄCHSTE
/// Auth-Versuch den jetzt validierten (höheren) Counter als neue Vergleichsbasis sieht —
/// unterbleibt das Schreiben, bliebe der gespeicherte Counter für immer auf dem alten Wert stehen
/// und der Schutz wäre nutzlos („Clone-Detection ist nur so stark wie der zurückgeschriebene
/// Counter", `storage.rs`-Moduldoc).
pub async fn webauthn_auth_finish(
    State(state): State<AppState>,
    jar: CookieJar,
    Json(body): Json<PublicKeyCredential>,
) -> Result<(CookieJar, StatusCode), AppError> {
    if !webauthn_aktiv(&state.pool).await? {
        return Err(AppError::NotFound);
    }
    let webauthn = crate::auth::webauthn::webauthn().ok_or(AppError::NotFound)?;

    let key = jar
        .get(WEBAUTHN_AUTH_COOKIE)
        .map(|c| c.value().to_string())
        .ok_or(AppError::Unauthorized)?;

    // SYNC, Guard freigegeben VOR jedem folgenden `.await` — s. Doc-Kommentar oben (Punkt 2).
    let auth_state = match crate::auth::webauthn::state::entnehme(&key) {
        Some(crate::auth::webauthn::state::CeremonyZustand::Authentifizierung(auth_state)) => {
            auth_state
        }
        _ => return Err(AppError::Unauthorized),
    };

    // Counter-/Klon-Check passiert HIER BEREITS in der Bibliothek — s. Doc-Kommentar oben.
    let auth_result = match webauthn.finish_passkey_authentication(&body, &auth_state) {
        Ok(r) => r,
        Err(WebauthnError::CredentialPossibleCompromise) => {
            // Nur serverseitig geloggt (Ops-Signal für ein mögliches Klon-/Replay-Gerät) — der
            // Client bekommt denselben generischen 401 wie jeder andere Ceremony-Fehler.
            tracing::warn!("WebAuthn-Login abgelehnt: möglicher Klon (Counter-Regression) erkannt");
            return Err(AppError::Unauthorized);
        }
        Err(_) => return Err(AppError::Unauthorized),
    };

    // Counter-Writeback (Plan-MUST) — s. Doc-Kommentar Punkt 4.
    let gefunden = crate::auth::webauthn::storage::passkey_je_credential_id(
        &state.pool,
        auth_result.cred_id().as_ref(),
    )
    .await?;
    let Some((benutzer_id, mut passkey)) = gefunden else {
        return Err(AppError::Unauthorized);
    };

    // `update_credential` liefert `None` NUR bei `cred_id`-Mismatch — strukturell unerreichbar,
    // da `passkey` gerade ÜBER genau diese `cred_id` geladen wurde. Ein internes Invarianten-
    // Problem (keine Nutzereingabe-Ursache), daher `Internal`/500 statt des generischen Auth-401.
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

    // [MUST] zwischenzeitlich deaktiviertes Konto → keine Session, s. Doc-Kommentar Punkt 5.
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

/// Antwort auf `POST /api/auth/totp/enroll/start` (LFH-43, Task 4): das frisch erzeugte,
/// noch NICHT aktive TOTP-Secret. `otpauth_url` ist für den QR-Code-Scan gedacht,
/// `secret_base32` als Klartext-Fallback zum manuellen Eintragen in die Authenticator-App.
#[derive(Debug, Serialize, ToSchema)]
pub struct TotpEnrollStart {
    pub otpauth_url: String,
    pub secret_base32: String,
}

/// Body von `POST /api/auth/totp/enroll/finish`. Request-DTO, bewusst nicht in
/// `api_doc.rs`/Codegen (Konvention: Eingabe-Bodies bleiben handgepflegt, s. CLAUDE.md).
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

/// Aktueller Unix-Zeitstempel (Sekunden) für die TOTP-Prüfung/-Erzeugung. Kein eingefrorener
/// Testzeitpunkt nötig: die deterministischen Enroll-Tests erzeugen ihren Vergleichscode über
/// `totp::generiere_code` mit einem eigenen `SystemTime::now()`-Aufruf — der ±1-Zeitschritt-
/// Skew von `pruefe_code` deckt die paar Millisekunden zwischen beiden Aufrufen ab.
fn jetzt_unix() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// POST /api/auth/totp/enroll/start — beginnt (oder erneuert) ein TOTP-Enrollment für den
/// angemeldeten Nutzer (`CurrentUser`-gegated, LFH-43 Task 4). Erzeugt ein frisches Secret und
/// speichert es SOFORT, aber NOCH NICHT aktiviert (`totp_aktiviert = 0`) — erst ein bestätigender
/// Code in `enroll/finish` aktiviert MFA.
///
/// **Re-Enroll-Entscheidung (Plan Task 4, bewusst dokumentiert):** ein erneuter `start` — egal ob
/// ein vorheriges Enrollment nie bestätigt wurde ODER TOTP bereits aktiv war — überschreibt das
/// Secret und setzt `totp_aktiviert` unbedingt auf 0 zurück. Ein Nutzer, der TOTP bereits aktiv
/// hat und `start` erneut aufruft (Re-Enroll, z. B. neues Gerät), verliert also SOFORT seinen
/// aktiven zweiten Faktor, bis er den neuen Code in `enroll/finish` bestätigt — ein
/// abgebrochener/fehlgeschlagener Re-Enroll lässt den Nutzer währenddessen ohne MFA (nicht mit
/// dem alten Secret weiter aktiv). Das ist der einfachere, im Plan vorgezeichnete Pfad
/// gegenüber einem „aktiviert bleibt bis bestätigt"-Zwischenzustand (der ein zusätzliches
/// „Pending-Secret"-Feld bräuchte) und im Enroll-Kontext (Nutzer handelt selbst, aus dem eigenen
/// Profil) unkritisch.
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

/// POST /api/auth/totp/enroll/finish — schließt ein laufendes Enrollment ab (`CurrentUser`-
/// gegated, LFH-43 Task 4). Lädt `totp_secret` FRISCH per SELECT statt aus dem
/// `CurrentUser`-Snapshot: der `Benutzer`-Extractor-Typ trägt die `totp_*`-Spalten (noch) gar
/// nicht, UND ein `start` in genau demselben Request-Zyklus muss ohnehin sichtbar sein.
///
/// Kein `totp_secret` gesetzt (nie `enroll/start` aufgerufen) → `400` „Kein TOTP-Enrollment
/// gestartet" (Validierungsfehler wie das analoge `webauthn_register_finish`-Cookie-Fehlen).
/// Ein falscher Code → `422` (Zustandsfehler: ein Enrollment läuft, aber der Bestätigungscode
/// stimmt nicht) — `totp_aktiviert` bleibt dabei unverändert, MFA wird also NIE ohne einen
/// gültigen Code aktiviert. Erst ein gültiger Code aktiviert MFA, generiert die zehn
/// Klartext-Recovery-Codes und ersetzt (via `speichere_recovery_codes`) etwaige alte.
pub async fn totp_enroll_finish(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Json(req): Json<TotpEnrollFinishRequest>,
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

/// Body von `POST /api/auth/totp/finish`. Request-DTO, bewusst nicht in `api_doc.rs`/Codegen
/// (Konvention: Eingabe-Bodies bleiben handgepflegt, s. CLAUDE.md). Trägt WEDER Passwort noch
/// Benutzername — die Identität kommt ausschließlich aus dem `mfa_pending`-Pending-State (s.
/// `totp_finish`-Doc, Plan-MUST).
#[derive(Debug, Deserialize)]
pub struct TotpFinishRequest {
    pub code: String,
}

/// POST /api/auth/totp/finish — schließt den zweiten Schritt des Passwort→TOTP-Logins ab
/// (öffentlich, PRE-Session, LFH-43 Increment 5 Task 5 — **der Crux, Security-kritisch**).
/// Nimmt weder Passwort noch Benutzername entgegen: die Identität kommt AUSSCHLIESSLICH aus
/// dem `mfa_pending`-Pending-State, der im vorherigen `login`-Schritt angelegt wurde.
///
/// Reihenfolge ist bewusst:
///
/// 1. State-Key aus dem `mfa_pending`-Cookie; `entnehme` (SYNC, Guard sofort freigegeben — s.
///    `auth::totp::state`-Moduldoc) läuft VOR jedem weiteren `.await` in diesem Handler
///    (Plan-MUST „!Send" — sonst wäre der Handler nicht `Send`, `cargo build` bricht das ab).
///    **Single-use**: `entnehme` entfernt den Eintrag beim Zugriff — ein zweiter Versuch mit
///    demselben Cookie(-Wert) liefert `None`. Fehlendes Cookie ODER unbekannter/abgelaufener/
///    bereits verbrauchter Key → derselbe generische `401`.
/// 2. `benutzer` frisch per `id` laden (NICHT aus dem Pending-State/Client übernommen — der
///    Pending-State trägt nur die `benutzer_id`, keine sonstigen Felder). Ein zwischenzeitlich
///    deaktiviertes Konto (`!aktiv`) ODER ein fehlendes/gelöschtes `totp_secret` (z. B. durch
///    einen Admin-Reset zwischen `login` und `finish`) → derselbe generische `401` (analog OIDC-
///    /WebAuthn-Task-2-Handoff).
/// 3. Verifikation: `totp::pruefe_code` ODER (nur falls das scheitert, `||` kurzschließt) EIN
///    `storage::verbrauche_recovery_code`-Aufruf, der einen gültigen Recovery-Code dabei atomar
///    als verbraucht markiert (single-use, s. `storage.rs`-Moduldoc). Beides `false` → derselbe
///    generische `401` (keine Unterscheidung „TOTP falsch" vs. „Recovery-Code falsch" — kein
///    Detail-Leak).
/// 4. Erst danach `session::anlegen` + Session-Cookie setzen, `mfa_pending`-Cookie entfernen,
///    `200` mit der `BenutzerAnzeige` — identisch zum bestehenden Sofort-Login-Erfolgspfad.
pub async fn totp_finish(
    State(state): State<AppState>,
    jar: CookieJar,
    Json(req): Json<TotpFinishRequest>,
) -> Result<(CookieJar, Json<crate::auth::BenutzerAnzeige>), AppError> {
    let key = jar
        .get(MFA_PENDING_COOKIE)
        .map(|c| c.value().to_string())
        .ok_or(AppError::Unauthorized)?;

    // SYNC, Guard freigegeben VOR jedem folgenden `.await` — s. Doc-Kommentar oben (Punkt 1).
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

    // `||` kurzschließt: bei gültigem TOTP-Code wird KEIN Recovery-Code angerührt/verbraucht.
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
    // Dieser Handler ist nur für `totp_aktiviert = true`-Nutzer überhaupt erreichbar (der
    // Pending-State entsteht ausschließlich im `totp_aktiviert`-Zweig von `login`) — der Status
    // ist an dieser Stelle unbedingt `true`, kein Zusatz-SELECT nötig.
    Ok((jar, Json(benutzer.anzeige(true))))
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

    // ===== OIDC-state-Cookie-Bindung (Session-Fixation-Defense, LFH-277) =====

    #[test]
    fn oidc_state_cookie_ist_httponly_lax_und_pfadweit() {
        let c = baue_oidc_state_cookie("abc123".to_string(), true);
        assert_eq!(c.name(), OIDC_STATE_COOKIE);
        assert_eq!(c.value(), "abc123");
        assert_eq!(c.http_only(), Some(true));
        // MUST Lax (nicht Strict): Cross-Site-Redirect vom IdP muss das Cookie mitschicken.
        assert_eq!(c.same_site(), Some(SameSite::Lax));
        assert_eq!(c.path(), Some("/"));
        assert_eq!(c.secure(), Some(true));
    }

    #[test]
    fn oidc_state_cookie_secure_folgt_parameter() {
        // Diskriminierend wie `session_cookie_secure_folgt_parameter`: beide Zweige geprüft,
        // kein prozessweiter OnceLock im Test.
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
}
