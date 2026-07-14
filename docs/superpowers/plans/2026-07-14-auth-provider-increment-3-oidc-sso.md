# Auth-Provider-System — Increment 3 (OIDC/SSO, PocketID) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Externes OIDC/SSO-Login (self-hosted PocketID, generisch OIDC-konform) als Provider einziehen — Authorization-Code + PKCE + nonce, `id_token`-Validierung, JIT-Provisioning mit least privilege — ohne die Offline-Fähigkeit des lokalen Logins zu berühren.

**Architecture:** Der OIDC-Flow läuft über die `openidconnect`-Crate (Discovery/PKCE/Token-Validierung). Die App hält einen kurzlebigen In-Memory-State-Store (csrf/nonce/pkce), provisioniert bei erstem Login least-privilege über eine **pure** Claims→Benutzer-Funktion, und mündet — wie alle Provider — in `session::anlegen`. SSO-only-Nutzer haben **kein** lokales Passwort (Sentinel-Hash statt `passwort_hash`-NULL — kein riskanter `benutzer`-Rebuild). Discovery ist **lazy** (erste Nutzung, nicht Boot); ein unerreichbarer IdP lässt den lokalen Login unangetastet.

**Tech Stack:** Rust, axum 0.8, `openidconnect` v4 (+ `reqwest`, schon im Baum), sqlx/SQLite.

## Global Constraints

- **[MUST — Lockout-Schutz] `ist_admin_tauglich` bleibt `{passwort}` — „oidc" wird NICHT aufgenommen.** In Inc 3 sind OIDC-Nutzer JIT least-privilege; kein Admin kann sich per OIDC anmelden. Würde „oidc" admin-tauglich, ließe der Aussperr-Guard `passwort` deaktivieren → alle Admins ausgesperrt. Admin-Linking + „oidc" in der admin-tauglichen Menge + transaktionaler Guard kommen GEMEINSAM in einem späteren Increment.
- **[MUST — Offline-First] Lazy Discovery, IdP-Ausfall isoliert.** OIDC-Discovery läuft NICHT beim Serverstart, sondern bei erster OIDC-Nutzung, und wird nach Erfolg gecacht. Registry-Listing (`GET /providers`) und Provider-Konfiguration dürfen KEIN Netz berühren. IdP unerreichbar → OIDC-`start`/`callback` liefern einen Fehler, der lokale Passwort-Login funktioniert unverändert.
- **[MUST — !Send] State-Store-Guard nie über ein `await` halten.** Der Callback lockt den Store, `remove`t den Eintrag, **droppt den Guard** (Block-Scope), und ruft ERST DANN `exchange_code(...).request_async().await`. std-`Mutex`-Guard über await macht den Handler `!Send` (Memory: mutex-guard-await-send-axum; current-thread-Tests fangen es nicht).
- **Sentinel statt Migration:** SSO-only-Nutzer bekommen `passwort_hash = auth::PASSWORT_HASH_SSO_ONLY` (benannte Konstante, kein PHC-String). `password::verifizieren` liefert dagegen sicher `false` (Zeile 23, Test `verifizieren_lehnt_kaputten_hash_ab`). KEINE `passwort_hash`-nullable-Migration, KEIN `benutzer`-Rebuild (40 FK-Abhängige). Die Spalten `oidc_subject`/`oidc_issuer` existieren bereits (Migration 0083, Inc 1); Match über `(oidc_issuer, oidc_subject)`, partieller Unique-Index ist da.
- **Kein E-Mail-Auto-Link:** eine SSO-Identität wird NIE automatisch an ein bestehendes lokales Konto per E-Mail/Benutzername gebunden. Match ausschließlich über `(issuer, sub)`; unbekannt → neues Konto.
- **SSRF-Disziplin:** der OIDC-HTTP-Client setzt `redirect(reqwest::redirect::Policy::none())` (Discovery + Token-Exchange).
- **openidconnect v4-API** ist ein Build-Verify-Punkt (wie rcgen `signing_key` in Inc 2): `discover_async`, `.request_async(&http_client).await`, `id_token.claims(&verifier, &nonce)`. Version pinnen, beim ersten `cargo build` gegenprüfen.
- **Secrets nie in DB/API:** `client_secret` nur via Env. **Typ-Codegen-Gate** für den neuen `AuthProviderTyp::Oidc`-Wire-Wert + evtl. DTO. **Enum-Wire-Kontrakt** für `Oidc`. Rust-Gate `cargo test`; `cargo fmt --all`.
- **Test-Grenze:** die Bausteine (JIT-Provisioning, State-Store-TTL, Enforcement, Registry-oidc-ohne-Netz, Sentinel) sind unit-getestet. Der End-to-End-OIDC-Flow (echter IdP) ist ein `#[ignore]`-Smoke gegen PocketID — die Protokoll-/Krypto-Korrektheit liegt in der `openidconnect`-Crate.

## File Structure

**Neu:**
- `src/auth/oidc/mod.rs` — Config→Client (lazy Discovery-Cache), `oidc_client()`, HTTP-Client mit SSRF-Policy.
- `src/auth/oidc/provisioning.rs` — **pure** `plane_benutzer(claims) -> NeuerOidcBenutzer` + `finde_oder_provisioniere(pool, …)`.
- `src/auth/oidc/state.rs` — kurzlebiger csrf/nonce/pkce-Store (LazyLock, TTL, Guard-drop-vor-await).
- `tests/oidc_smoke.rs` — `#[ignore]` End-to-End gegen PocketID.

**Geändert:**
- `Cargo.toml` — `openidconnect`.
- `src/config.rs` — OIDC-Env-Felder.
- `src/auth/mod.rs` — `pub const PASSWORT_HASH_SSO_ONLY`; `pub mod oidc` (unter provider? — hier `auth::oidc`).
- `src/auth/provider/mod.rs` — `AuthProviderTyp::Oidc` (+ `as_str`).
- `src/auth/provider/registry.rs` — `konfiguriert()` nimmt „oidc" auf, WENN issuer+client_id+secret gesetzt (rein aus Config, kein Netz); `ist_admin_tauglich` UNVERÄNDERT `{passwort}`.
- `src/routes/auth.rs` — `oidc_start`, `oidc_callback`; `login` bekommt den Enforcement-Check.
- `src/routes/dev.rs` / `src/app.rs` — Routen `/api/auth/oidc/start` + `/callback`.
- `src/api_doc.rs`, `tests/enum_wire_kontrakt.rs` — `AuthProviderTyp::Oidc`.
- `frontend/src/pages/LoginPage.tsx` — OIDC-Provider als Redirect-Button.
- `docs/betrieb-oidc.md` — Betriebsdoku (PocketID-Config).

---

## Task 1: Deps + Config + Sentinel-Konstante + Registry-„oidc" (ohne Netz)

**Files:** `Cargo.toml`, `src/config.rs`, `src/auth/mod.rs`, `src/auth/provider/mod.rs`, `src/auth/provider/registry.rs`, `src/api_doc.rs`, `tests/enum_wire_kontrakt.rs`

**Interfaces:**
- Produces: Config `oidc_issuer/oidc_client_id/oidc_client_secret/oidc_redirect_url: Option<String>`; `auth::PASSWORT_HASH_SSO_ONLY`; `AuthProviderTyp::Oidc`; `registry::konfiguriert` inkl. „oidc" (config-abgeleitet); `ID_OIDC`.

- [ ] **Step 1: Deps + Config-Flags + Sentinel + Enum**

`Cargo.toml`: `openidconnect = "4"` (Version beim Build gegenprüfen). `src/config.rs`: vier `Option<String>`-Env-Felder (`LIFELINE_OIDC_ISSUER`, `_CLIENT_ID`, `_CLIENT_SECRET` [als `GeheimesPasswort`], `_REDIRECT_URL`) im `clamav_*`-Stil. `src/auth/mod.rs`: `pub const PASSWORT_HASH_SSO_ONLY: &str = "!sso-kein-lokales-passwort";` (bewusst kein `$argon2`-Präfix → `verifizieren` gibt false). `src/auth/provider/mod.rs`: `pub const ID_OIDC: &str = "oidc";`, `AuthProviderTyp::Oidc` (+ `as_str => "oidc"`).

- [ ] **Step 2: Failing tests (registry-oidc OHNE Netz + Enum + Sentinel)**

```rust
// registry.rs tests: „oidc" ist konfiguriert, wenn issuer+client_id+secret gesetzt — rein aus Config.
#[tokio::test]
async fn oidc_konfiguriert_ohne_netz() {
    let pool = crate::db::test_pool().await;
    // konfiguriert()/liste() dürfen KEIN Netz berühren — nur Config lesen.
    let liste = liste_mit_oidc(&pool, /*issuer*/ Some("https://idp.example"), Some("cid"), Some("sec")).await.unwrap();
    assert!(liste.iter().any(|p| p.id == "oidc" && p.typ == AuthProviderTyp::Oidc));
}
#[test]
fn admin_tauglich_bleibt_nur_passwort() {
    assert!(ist_admin_tauglich("passwort"));
    assert!(!ist_admin_tauglich("oidc")); // MUST: sonst Aussperr-Bug
}
// enum_wire_kontrakt: wire_eq!(AuthProviderTyp::Oidc); („oidc")
// auth::mod tests: verifizieren("egal", PASSWORT_HASH_SSO_ONLY) == false
```
(Die Registry braucht Zugriff auf die konfigurierten OIDC-Provider. Da `konfiguriert()` heute nur vom `dev-seeds`-Feature abhängt, wird die OIDC-Konfiguriertheit als Parameter/Config in die Registry gereicht — **kein** Netz, nur Bool „issuer+id+secret gesetzt". Signatur-Erweiterung im Detail in Step 3; die Advisor-Vorgabe „Registry-Listing berührt kein Netz" ist damit strukturell erfüllt.)

- [ ] **Step 3: Implementieren** — `registry::konfiguriert` erhält die OIDC-Konfiguriertheit (aus `Config`, via einen kleinen `OidcKonfiguriert`-Bool, der beim Start aus der Config abgeleitet und wie `dev_verfuegbar()` als reiner Zustand geführt wird — z.B. ein `OnceLock<bool>` `oidc_konfiguriert`, in `run_server` gesetzt, Default false → Tests/Non-OIDC unberührt). `ist_admin_tauglich` UNVERÄNDERT. `AuthProviderTyp::Oidc` in `api_doc.rs` (Schema existiert schon als `AuthProviderTyp` — nur der neue Variantenwert wird emittiert → Codegen-Gate).

- [ ] **Step 4: Gates** — `cargo test --lib auth::provider::registry auth::provider auth::password`; `cargo test --test enum_wire_kontrakt`; `bash scripts/check-typ-codegen.sh` (der neue `"oidc"`-Enumwert erscheint in `openapi.json`/`types.generated.ts` → mitcommitten). `cargo fmt --all`.

- [ ] **Step 5: Commit** — `git add Cargo.toml Cargo.lock src/config.rs src/auth/ src/api_doc.rs tests/enum_wire_kontrakt.rs frontend/src/api/openapi.json frontend/src/api/types.generated.ts` → `feat(lfh-41): OIDC-Config + Sentinel-Hash + Registry-oidc-Provider (ohne Netz) + Enum`

---

## Task 2: Pure Claims→Benutzer-Provisioning (least privilege, kein E-Mail-Link)

**Files:** `src/auth/oidc/mod.rs` (Modul-Deklaration), `src/auth/oidc/provisioning.rs`

**Interfaces:**
- Produces:
  - `pub struct OidcClaims { pub issuer: String, pub subject: String, pub preferred_username: Option<String>, pub name: Option<String> }`
  - `pub fn plane_benutzername(claims: &OidcClaims, kollision: impl Fn(&str) -> bool) -> String` (**pur**: aus Claims den Benutzernamen ableiten, bei Kollision deterministisch suffixen).
  - `pub async fn finde_oder_provisioniere(pool, claims: &OidcClaims) -> Result<Benutzer, AppError>` (find by (issuer, sub); sonst least-privilege anlegen mit Sentinel-Hash).

- [ ] **Step 1: Failing unit tests** — (a) `plane_benutzername`: aus `preferred_username`, Fallback `sub`; bei Kollision `name-2`, `name-3`. (b) `finde_oder_provisioniere`: unbekannter (issuer,sub) → neuer Benutzer mit `system_rolle=keiner`, `org_rolle=keine`, `passwort_hash=PASSWORT_HASH_SSO_ONLY`, `oidc_issuer`/`oidc_subject` gesetzt; bekannter (issuer,sub) → derselbe Benutzer (kein Doppel-Insert); ein bestehendes LOKALES Konto mit gleichem Benutzernamen aber ohne oidc_subject wird NICHT verlinkt (neues Konto mit gesuffixtem Namen).
- [ ] **Step 2: Implementieren** — Single-Org (die eine `organisation`, wie `routes/benutzer.rs::anlegen`). `plane_benutzername` pur; `finde_oder_provisioniere` nutzt sie mit einer Kollisions-Closure gegen `benutzer.benutzername`.
- [ ] **Step 3: Gates** — `cargo test --lib auth::oidc::provisioning`. `cargo fmt --all`.
- [ ] **Step 4: Commit** — `feat(lfh-41): pure OIDC-Provisioning (least privilege, Sentinel, kein E-Mail-Link)`

---

## Task 3: State-Store (csrf/nonce/pkce) — TTL, Guard-drop-vor-await

**Files:** `src/auth/oidc/state.rs`

**Interfaces:**
- Produces: `StateEintrag { csrf, nonce, pkce_verifier, ziel_pfad, ablauf }`; `pub fn speichere(eintrag) -> String` (liefert state-Key); `pub fn entnehme(state: &str) -> Option<StateEintrag>` (entfernt + liefert, `None` wenn unbekannt/abgelaufen). Prozessweiter `LazyLock<Mutex<HashMap<..>>>` (kein AppState-Feld).

- [ ] **Step 1: Failing tests** — speichere→entnehme roundtrip; zweites entnehme desselben state → None (Einmal-Nutzung); abgelaufener Eintrag → None. (Zeit: TTL relativ; da `Date::now` in Tests i.O. — Std-`Instant` nutzen.)
- [ ] **Step 2: Implementieren** — `Instant`-basierte Ablaufzeit (z.B. 10 min). WICHTIG: `entnehme` lockt, `remove`t, gibt den Guard SOFORT frei (Funktion endet vor jedem await des Aufrufers). Kein `.await` in diesem Modul.
- [ ] **Step 3: Gates** — `cargo test --lib auth::oidc::state`. `cargo fmt --all`.
- [ ] **Step 4: Commit** — `feat(lfh-41): kurzlebiger OIDC-State-Store (Einmal-Nutzung, TTL)`

---

## Task 4: OIDC-Client + lazy gecachte Discovery + SSRF-HTTP-Client

**Files:** `src/auth/oidc/mod.rs`

**Interfaces:**
- Produces: `pub async fn oidc_client(cfg: &Config) -> Result<CoreClient..., AppError>` — baut den HTTP-Client (`redirect(Policy::none())`), macht **lazy** `discover_async` (nach Erfolg gecacht via `tokio::sync::OnceCell` o.ä.), `CoreClient::from_provider_metadata(md, client_id, Some(client_secret)).set_redirect_uri(redirect_url)`.

- [ ] **Step 1: Test (offline-Isolation, ohne echten IdP)** — ein Test, der belegt, dass die **Registry/Provider-Konstruktion kein Netz** macht (aus Task 1 schon abgedeckt) und dass `oidc_client` bei fehlender/kaputter Discovery einen `AppError` liefert statt zu panicen/zu blockieren (z.B. issuer=`http://127.0.0.1:1` → Connection-Fehler → `Err`, kein Panik). Kennzeichnen: dieser Test macht bewusst einen (scheiternden) lokalen Connect; kein externer IdP.
- [ ] **Step 2: Implementieren** — `openidconnect::reqwest`-Client mit `Policy::none()`. Discovery-Cache: `static DISCOVERY: OnceCell<ProviderMetadata>` (tokio), beim ersten `oidc_client` gefüllt. openidconnect-v4-API beim Build gegenprüfen (`discover_async`, Client-Generics). Fehler → `AppError::Internal`/`ServiceUnavailable`.
- [ ] **Step 3: Gates** — `cargo test --lib auth::oidc` (+ der offline-Isolationstest). `cargo build`. `cargo fmt --all`.
- [ ] **Step 4: Commit** — `feat(lfh-41): OIDC-Client + lazy gecachte Discovery (offline-tolerant, SSRF-Policy)`

---

## Task 5: `GET /api/auth/oidc/start` (Authorize-Redirect) + Enforcement

**Files:** `src/routes/auth.rs`, `src/app.rs`

- [ ] **Step 1** — Handler: wenn `oidc`-Provider deaktiviert (`registry`) → 404/403. Sonst `oidc_client` holen, `authorize_url(AuthorizationCode, CsrfToken::new_random, Nonce::new_random).add_scope(openid/profile).set_pkce_challenge(PkceCodeChallenge::new_random_sha256())` , `speichere` (csrf/nonce/pkce_verifier/ziel), `Redirect::to(auth_url)`. IdP-Discovery-Fehler → Redirect zurück auf LoginPage mit Fehlerhinweis.
- [ ] **Step 2** — Route `GET /api/auth/oidc/start` in `app.rs`.
- [ ] **Step 3** — Integrationstest (ohne echten IdP): bei deaktiviertem/nicht-konfiguriertem oidc → 404; (der Erfolgsfall braucht Discovery → im `#[ignore]`-Smoke). `cargo fmt --all`.
- [ ] **Step 4: Commit** — `feat(lfh-41): GET /api/auth/oidc/start (PKCE/nonce/state, Enforcement)`

---

## Task 6: `GET /api/auth/oidc/callback` (Token-Tausch, Validierung, JIT, Session)

**Files:** `src/routes/auth.rs`, `src/app.rs`

- [ ] **Step 1** — Handler (die security-kritische Stelle):
  1. Query `code`, `state`. `entnehme(state)` → Eintrag (None → Fehler „ungültiger/abgelaufener state"). **Guard ist damit schon freigegeben (Task 3).**
  2. `oidc_client`, `exchange_code(AuthorizationCode::new(code)).set_pkce_verifier(eintrag.pkce_verifier).request_async(&http_client).await` — **erst NACH dem Guard-Drop**.
  3. `id_token = token_response.id_token()`; `claims = id_token.claims(&client.id_token_verifier(), &eintrag.nonce)?` (verifiziert Sig/nonce/iss/aud/exp). Fehler → „Token-Validierung fehlgeschlagen".
  4. `OidcClaims` aus `issuer`/`subject`/`preferred_username`/`name`; `finde_oder_provisioniere`.
  5. `session::anlegen`, Cookie (`session_cookie(token, cookie_secure())`), `Redirect` auf `eintrag.ziel_pfad`.
  Alle IdP-/Validierungsfehler → Redirect auf LoginPage mit generischem Fehler (kein Detail-Leak); lokale Provider bleiben nutzbar.
- [ ] **Step 2** — Route `GET /api/auth/oidc/callback`.
- [ ] **Step 3** — Kompilier-/Send-Check: der Handler MUSS `Send` sein (Guard nicht über await — Task-3-Disziplin). `cargo build` + `cargo test --test auth` (bestehende Login-Pfade unberührt). Voller Flow im `#[ignore]`-Smoke.
- [ ] **Step 4: Commit** — `feat(lfh-41): GET /api/auth/oidc/callback (Token-Validierung, JIT, Session)`

---

## Task 7: Enforcement-Seam im Passwort-Login (defensiv)

**Files:** `src/routes/auth.rs`

- [ ] **Step 1** — `login` prüft vor `password::anmelden`, ob der `passwort`-Provider aktiviert ist (`registry`); sonst 403 „Passwort-Login deaktiviert". (Heute unerreichbar, weil der Aussperr-Guard `passwort` undeaktivierbar hält — defensiv/zukunftssicher; dokumentieren.) Test: mit deaktiviertem passwort-Provider (direkt in `auth_provider` gesetzt, Guard umgangen im Test-Setup) → login 403. `cargo fmt --all`.
- [ ] **Step 2: Commit** — `feat(lfh-41): Enforcement-Seam — Passwort-Login respektiert Provider-Toggle`

---

## Task 8: Frontend — OIDC-Provider als Redirect-Button

**Files:** `frontend/src/pages/LoginPage.tsx`, ggf. `frontend/src/pages/LoginPage.test.tsx`

- [ ] **Step 1** — Die Provider-Liste (aus `/api/auth/providers`, schon vorhanden) um den Typ `oidc` erweitern: für `typ === 'oidc'` einen Button „Mit PocketID anmelden" rendern, der per `window.location` auf `/api/auth/oidc/start` leitet (Redirect-Flow, kein fetch). Vitest: bei einem aktiven oidc-Provider erscheint der Button; Klick navigiert auf `/api/auth/oidc/start`.
- [ ] **Step 2: Gates** — `mise exec pnpm@11.10.0 -- pnpm -C <FE> test --no-file-parallelism LoginPage`, `lint`, `typecheck`.
- [ ] **Step 3: Commit** — `feat(lfh-41): LoginPage OIDC-Redirect-Button`

---

## Task 9: Voll-Gate + `#[ignore]`-PocketID-Smoke + Betriebsdoku

**Files:** `tests/oidc_smoke.rs`, `docs/betrieb-oidc.md`

- [ ] **Step 1** — `tests/oidc_smoke.rs` `#[ignore]`: dokumentiert den manuellen End-to-End-Flow gegen ein echtes PocketID (`LIFELINE_OIDC_*` gesetzt, Browser-Redirect, Callback, JIT-Konto). `docs/betrieb-oidc.md`: PocketID-Client anlegen, Redirect-URL `https://<host>/api/auth/oidc/callback`, Env-Konfig, JIT-least-privilege-Hinweis (Admin stuft hoch), kein E-Mail-Link.
- [ ] **Step 2 (Controller)** — Voll-Suite env-hygienisch; Codegen-Drift-Gate; Frontend-Voll-Gate; **manueller** OIDC-Smoke gegen eine lokale PocketID-Instanz (falls verfügbar) ODER dokumentierter Hand-Test.
- [ ] **Step 3: Commit** — `docs(lfh-41): OIDC-Betriebsdoku + #[ignore]-PocketID-Smoke`

---

## Self-Review

**Spec coverage (Design OIDC-Sektion):** Discovery/PKCE/state/nonce → Task 4/5/6. id_token-Validierung → Task 6. find-or-JIT-create by (issuer,sub), least privilege, kein E-Mail-Link → Task 2. Config deploy-time (Secrets Env) → Task 1. Toggle/Registry → Task 1. Offline-Resilienz (lazy Discovery, IdP-Ausfall isoliert) → Global Constraints + Task 4. Enforcement-Seam → Task 5/6/7. Sentinel statt Migration → Global Constraints + Task 1/2.

**MUST-Fixes (Advisor) verankert:** `ist_admin_tauglich` bleibt `{passwort}` (Task 1 Test `admin_tauglich_bleibt_nur_passwort`); lazy/offline-tolerante Discovery (Task 4 + Constraint); Guard-drop-vor-await (Task 3/6 + Constraint); Sentinel als Konstante; SSRF-Policy; pure Provisioning-Funktion (Task 2).

**Placeholder-Scan:** Task 1 Step 3 (`OidcKonfiguriert`-Zustandsführung) und Task 4 (openidconnect-v4-Generics) sind als Build-Verify-Punkte markiert — bewusst, weil die exakte v4-Client-Typsignatur beim Build zu bestätigen ist (wie rcgen in Inc 2). Kein blindes Placeholder in security-kritischen Pfaden: Token-Validierung (Task 6) nutzt die Crate-`claims(&verifier, &nonce)`-Prüfung explizit.

**Offen (bewusst):** Admin-Linking bestehender Konten an SSO, claims→Rollen-Mapping, „oidc" in `ist_admin_tauglich` + transaktionaler Guard, enabled-only-public-`/providers`-Split → alle einem SPÄTEREN Increment zugewiesen (an LFH-41/LFH-275 getrackt). Cache-SAN-Awareness (Inc-2-#1) ist LFH-275.
