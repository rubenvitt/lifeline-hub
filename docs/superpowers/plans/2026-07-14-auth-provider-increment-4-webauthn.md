# Auth-Provider-System — Increment 4 (Lokales WebAuthn/Passkeys) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** App-eigene Passkeys (WebAuthn) als Provider: ein angemeldeter Nutzer registriert einen Passkey aus seinem Profil, danach passwortloser Login per Passkey — als zusätzlicher lokaler Login-Weg neben Passwort/OIDC.

**Architecture:** `webauthn-rs` fährt die Registrierungs-/Authentifizierungs-Zeremonien. Ein beim Serverstart **eager** gebautes `Webauthn` (rp_id/rp_origin aus Config) — schlägt der Bau fehl, wird der Provider gar nicht gelistet (fail-fast-sichtbar, kein Netz, keine lazy-Maschinerie). Ceremony-State (Registration/Authentication) liegt kurzlebig in einem prozessweiten Store. Passkeys werden als **opake serialisierte `Passkey`-Blobs** gespeichert; der Counter wird nach jeder Auth zurückgeschrieben (Clone-Detection). Jeder erfolgreiche Login mündet in `session::anlegen`.

**Tech Stack:** Rust, axum 0.8, `webauthn-rs` (+ `uuid`), sqlx/SQLite; Frontend `navigator.credentials` (React/TS).

## Global Constraints

- **[MUST — irreversibel] User-Handle ist ein gespeicherter zufälliger Opaque-Wert**, NICHT aus `benutzer.id` abgeleitet. Additive Spalte `benutzer.webauthn_user_handle` (random UUID/16 Bytes, einmalig generiert), EIN Helfer liefert/erzeugt ihn, genutzt von Register UND Auth. Authenticatoren speichern `(rp_id, handle)` dauerhaft — eine spätere Handle-Änderung würde jeden Passkey invalidieren; die Ableitung aus der laufenden PK verböte zudem den sauberen späteren Wechsel auf discoverable/usernameless. Der Handle darf keine PII enthalten.
- **[MUST — rp_id ist ein Hostname, keine IP]** `WebauthnBuilder::new(rp_id, &rp_origin)` verlangt, dass `rp_id` eine effektive Domain von `rp_origin` ist. Auf `https://<IP>` funktioniert WebAuthn NICHT. rp_id/origin kommen aus `LIFELINE_WEBAUTHN_RP_ID`/`LIFELINE_WEBAUTHN_RP_ORIGIN` (z.B. `elw.local` / `https://elw.local:8443`). Doku: LAN-Deployment braucht einen Hostnamen (mDNS/DNS) + ein Cert, das ihn abdeckt (koppelt an `--tls-hostname` + Task 1).
- **[MUST — eager Boot-Validierung]** Beim Serverstart `WebauthnBuilder::new(rp_id, &origin)?.build()` versuchen; nur bei `Ok` den `webauthn`-Provider als konfiguriert markieren (OnceLock, wie `oidc_konfiguriert`). Bei `Err`/fehlender Config: `tracing::warn!` + Provider NICHT listen (kein Fake-Button — direkte Anwendung des OIDC-redirect_url-Footgun-Fixes). **Keine** lazy/offline-Discovery-Maschinerie (WebAuthn ruft nichts auf).
- **[MUST — Counter-Rückschreiben]** Nach `finish_passkey_authentication` → `AuthenticationResult` prüfen (Counter > gespeichert; sonst mögliche Clone → ablehnen), dann `passkey.update_credential(&auth_result)` und den **re-serialisierten** Passkey persistieren. Clone-Detection ist nur so stark wie der zurückgeschriebene Counter.
- **[MUST — Storage opak]** Den ganzen serialisierten `Passkey` (serde) als **eigene** Spalte/Blob speichern (additive Migration; die `webauthn_credential`-Tabelle aus Inc 1 ist leer). `credential_id` (aus `passkey.cred_id()`) bleibt für den UNIQUE-Index + `exclude_credentials` extrahiert. `public_key`/`sign_count`-Spalten NICHT missbrauchen.
- **[MUST — Enrollment authentifiziert]** Registrierung läuft hinter `CurrentUser` aus einem angemeldeten Profil-/Benutzer-Bereich. Der Passkey-**Login**-Button gehört auf die LoginPage; die **Enroll**-UI gehört in den authentifizierten Bereich — NICHT vermischen. (Bootstrap: erst per Passwort/OIDC anmelden → Passkey enrollen → danach passwortlos.)
- `ist_admin_tauglich` bleibt `{passwort}` (wie „oidc": WebAuthn-Enrollment ist an ein bestehendes Konto gebunden, aber ein Admin könnte einen Passkey haben — dennoch bleibt Passwort der garantierte Admin-Weg, bis Admin-Linking/Policy das ändert; siehe LFH-277).
- **Guard-drop-vor-await:** `finish_*` ist synchron, aber `session::anlegen` danach ist async → den Ceremony-State-Guard vor dem await droppen (wie oidc/state).
- **exclude_credentials** bei register/start mit den bereits registrierten Credentials des Nutzers füllen (keine Doppel-Registrierung). credential_id-UNIQUE-Verletzung bei finish → sauberes **409**, kein 500.
- **Test-Grenze:** die Zeremonien sind end-to-end nur mit echtem Authenticator testbar → `#[ignore]`-Browser-Smoke. Unit-getestet: Handle-Helfer (stabil+random), Storage (roundtrip/Counter-Update/UNIQUE), Registry-webauthn-Verfügbarkeit, State-Store-TTL, rp_id-Boot-Validierung (ok/err). `webauthn-rs`-API ist Build-Verify-Punkt (Version pinnen). Rust-Gate `cargo test`; `cargo fmt --all`.

## File Structure
- **Task 1 (Prereq):** `src/tls/mod.rs` — SAN-aware Cache-Invalidierung.
- **Neu:** `src/auth/webauthn/mod.rs` (Webauthn-Build + Boot-Validierung + Config), `src/auth/webauthn/storage.rs` (Passkey-Persistenz), `src/auth/webauthn/state.rs` (Ceremony-State), `tests/webauthn_smoke.rs` (`#[ignore]`).
- **Geändert:** `Cargo.toml`; `migrations/00NN_webauthn.sql` (Handle-Spalte + Passkey-Blob-Spalte); `src/config.rs`; `src/auth/mod.rs`; `src/auth/provider/{mod,registry}.rs` (`AuthProviderTyp::Webauthn`, „webauthn"); `src/routes/auth.rs` (4 Endpoints); `src/app.rs`; `src/main.rs`; `src/api_doc.rs`; `tests/enum_wire_kontrakt.rs`; Frontend Profil-Bereich + `LoginPage.tsx`; `docs/betrieb-webauthn.md`.

---

## Task 1: TLS-Cache SAN-aware invalidieren (Vorbedingung)

**Files:** `src/tls/mod.rs`

**Why first:** Ein Operator, der für WebAuthn `--tls-hostname elw.local` setzt, bekäme sonst ein still weiter-serviertes altes Cache-Cert ohne diesen SAN → WebAuthn scheitert an der TLS-Schicht (Origin-Mismatch/untrusted). (Inc-2-Review-Finding #1.)

- [ ] **Step 1: Failing test** — `cache_gueltig` (oder eine neue `cache_passend(cert, key, sans)`) muss ein Cache-Cert VERWERFEN, dessen SAN-Set nicht dem aktuell berechneten entspricht. Ansatz: beim Cache-Schreiben die SANs in eine Sidecar-Datei `lifeline-tls-sans.txt` (sortiert, `\n`-getrennt) schreiben; `cache_passend` liest die Sidecar und vergleicht mit den erwarteten SANs → nur bei Match gültig. Test: (a) gleiche SANs → gültig; (b) geänderte/zusätzliche SAN (z.B. `elw.local` neu) → NICHT gültig (Neuerzeugung wird erzwungen); (c) fehlende Sidecar → nicht gültig (konservativ).
- [ ] **Step 2: Implementieren** — `erzeuge_und_cache_rcgen` + der mkcert-Zweig schreiben die Sidecar mit; `beschaffe_cert` nutzt `cache_passend(&cache_cert, &cache_key, &sans)` statt `cache_gueltig`. (Optional zusätzlich: `tracing::warn!`, wenn ein vorhandenes Cache-Cert wegen SAN-Mismatch neu erzeugt wird.) BYO bleibt unberührt (operator-managed).
- [ ] **Step 3: Gates** — `cargo test --lib tls::` PASS (bestehende 11 + neue SAN-Tests); Canary `tls::tests::rcgen_pem_ist_per_rustls_ladbar` PASS; `cargo fmt --all`.
- [ ] **Step 4: Commit** — `fix(lfh-275): TLS-Cache SAN-aware invalidieren (Vorbedingung WebAuthn/--tls-hostname)`

---

## Task 2: Deps + Config + Handle-/Blob-Migration + eager Webauthn-Build + Registry-„webauthn"

**Files:** `Cargo.toml`, `migrations/00NN_webauthn.sql`, `src/config.rs`, `src/auth/mod.rs`, `src/auth/webauthn/mod.rs`, `src/auth/provider/{mod,registry}.rs`, `src/main.rs`, `src/api_doc.rs`, `tests/enum_wire_kontrakt.rs`

**Interfaces:**
- Produces: Config `webauthn_rp_id`/`webauthn_rp_origin: Option<String>`; `AuthProviderTyp::Webauthn`; `ID_WEBAUTHN`; `webauthn::baue(cfg) -> Result<Webauthn, AppError>`; `registry::set_webauthn_konfiguriert(bool)`; `benutzer.webauthn_user_handle`; `webauthn_credential.passkey_json` (Blob/Text).

- [ ] **Step 1: Deps + Config + Enum + Migration**
  - `Cargo.toml`: `webauthn-rs = "0.5"` (Version beim Build gegenprüfen; Feature-Flags nach Bedarf), `uuid = { version = "1", features = ["v4","serde"] }` (falls nicht vorhanden).
  - `src/config.rs`: `webauthn_rp_id` (`LIFELINE_WEBAUTHN_RP_ID`), `webauthn_rp_origin` (`LIFELINE_WEBAUTHN_RP_ORIGIN`).
  - `src/auth/provider/mod.rs`: `ID_WEBAUTHN = "webauthn"`, `AuthProviderTyp::Webauthn` (+ `as_str => "webauthn"`).
  - Migration `00NN_webauthn.sql` (Nummer beim Umsetzen prüfen): `ALTER TABLE benutzer ADD COLUMN webauthn_user_handle BLOB;` (nullable, einmalig gefüllt) + `ALTER TABLE webauthn_credential ADD COLUMN passkey_json TEXT;` (der opake serialisierte Passkey). `credential_id`/`benutzer_id` bleiben für Lookup/UNIQUE/exclude.
- [ ] **Step 2: Handle-Helfer + Webauthn-Build (Tests-first)**
  - `src/auth/webauthn/mod.rs`: `pub async fn user_handle(pool, benutzer_id) -> Result<Uuid, AppError>` — liest `webauthn_user_handle`; ist NULL → `Uuid::new_v4()`, persistieren, zurückgeben (idempotent, EINE Quelle). `pub fn baue(rp_id: &str, rp_origin: &str) -> Result<Webauthn, AppError>` — `WebauthnBuilder::new(rp_id, &Url::parse(rp_origin)?)?.build()?`.
  - Tests: `user_handle` stabil (2× → gleich), random (2 Nutzer → verschieden), kein PII; `baue` ok bei validem Hostname-Origin, `Err` bei IP-rp_id / kaputtem Origin (Boot-Validierung).
- [ ] **Step 3: Registry-Verfügbarkeit ohne Netz + Boot-Wiring**
  - `registry`: `set_webauthn_konfiguriert`/OnceLock (wie `oidc_konfiguriert`); `konfiguriert()` nimmt `ID_WEBAUTHN` auf, wenn gesetzt. `typ(ID_WEBAUTHN)=Webauthn`, `anzeigename="Passkey"`. **`ist_admin_tauglich` UNVERÄNDERT `{passwort}`** (+ Test `admin_tauglich_ohne_webauthn`).
  - `src/main.rs`: beim Start `webauthn::baue(rp_id, origin)` versuchen; `Ok` → `set_webauthn_konfiguriert(true)` + das `Webauthn` prozessweit halten (OnceLock, wie das gebaute Objekt gebraucht wird); `Err`/keine Config → `warn!` + nicht listen.
  - `api_doc.rs` + `enum_wire_kontrakt`: `AuthProviderTyp::Webauthn`.
- [ ] **Step 4: Gates** — `cargo test --lib auth::webauthn auth::provider::registry`; `cargo test --test enum_wire_kontrakt`; `bash scripts/check-typ-codegen.sh` (neuer „webauthn"-Enumwert → regenerieren+committen); `cargo build`; `cargo fmt --all`.
- [ ] **Step 5: Commit** — `feat(lfh-275): WebAuthn-Config + user_handle + eager Boot-Build + Registry-webauthn + Enum + Migration`

---

## Task 3: Passkey-Storage (opak, Counter-Rückschreiben, UNIQUE→409)

**Files:** `src/auth/webauthn/storage.rs`

**Interfaces:**
- Produces: `speichere_passkey(pool, benutzer_id, &Passkey) -> Result<(), AppError>` (serialisiert, `credential_id` extrahiert; UNIQUE-Verletzung → `AppError::Conflict`); `passkeys_fuer_benutzer(pool, benutzer_id) -> Result<Vec<Passkey>, AppError>`; `passkey_je_credential_id(pool, cred_id) -> Result<Option<(i64 /*benutzer_id*/, Passkey)>, AppError>`; `aktualisiere_counter(pool, &Passkey) -> Result<(), AppError>` (re-serialisiert nach `update_credential`).

- [ ] **Step 1: Failing tests** — roundtrip (speichern→laden liefert denselben Passkey via serde-Vergleich der JSON); zweites Speichern derselben `credential_id` → `Conflict` (UNIQUE); `aktualisiere_counter` schreibt den geänderten Passkey zurück (geladener Counter danach höher). (Passkey-Fixtures: da echte Authenticator-Daten fehlen, entweder ein deserialisierter Passkey aus einem eingecheckten JSON-Fixture ODER `webauthn-rs`-Testhilfen, falls vorhanden — im Zweifel ein festes JSON-Fixture eines Passkeys verwenden.)
- [ ] **Step 2: Implementieren** — `serde_json` (schon im Baum) für Passkey↔TEXT; `credential_id = passkey.cred_id().as_ref()` (Bytes) in die `credential_id`-Spalte. `is_unique_violation()` → `AppError::Conflict("Passkey bereits registriert")`.
- [ ] **Step 3: Gates** — `cargo test --lib auth::webauthn::storage`; `cargo fmt --all`.
- [ ] **Step 4: Commit** — `feat(lfh-275): Passkey-Storage (opak serialisiert, Counter-Rückschreiben, UNIQUE→409)`

---

## Task 4: Ceremony-State-Store (Registration + Authentication)

**Files:** `src/auth/webauthn/state.rs`

**Interfaces:** Analog `oidc/state.rs`: prozessweiter `LazyLock<Mutex<HashMap<String, (Zustand, Instant)>>>`, TTL, Einmal-Nutzung, Guard-sync-only (kein `.await` im Modul). `Zustand` = enum `RegState(PasskeyRegistration)` | `AuthState(PasskeyAuthentication)` (beide serde-serialisierbar, aber hier in-memory als Wert gehalten). `speichere(key, zustand)` / `entnehme(key) -> Option<Zustand>`.

- [ ] **Step 1: Failing tests** — speichere→entnehme roundtrip (Reg + Auth); zweites entnehme → None; Ablauf → None; opportunistischer TTL-Sweep in `speichere` (wie oidc/state-Fix). Kein `.await` im Modul (Guard vor Rückkehr freigegeben).
- [ ] **Step 2: Implementieren** — 1:1 am `oidc/state.rs`-Muster (inkl. Poison-safe-Lock + Sweep).
- [ ] **Step 3: Gates** — `cargo test --lib auth::webauthn::state`; `cargo fmt --all`.
- [ ] **Step 4: Commit** — `feat(lfh-275): WebAuthn-Ceremony-State-Store (TTL, Einmal-Nutzung)`

---

## Task 5: Registrierungs-Endpoints (CurrentUser)

**Files:** `src/routes/auth.rs`, `src/app.rs`

**Endpoints (beide `CurrentUser`-gegated, Enforcement: webauthn-Provider aktiv sonst 404):**
- `POST /api/auth/webauthn/register/start` → `webauthn.start_passkey_registration(user_handle, benutzername, anzeigename, Some(exclude))` (exclude = credential_ids der bestehenden Passkeys des Nutzers) → `state::speichere(key, RegState(reg))` → `Json(ccr)` (+ den state-key, z.B. als Feld/Cookie, damit finish ihn wiederfindet — an ein kurzlebiges HttpOnly-Cookie oder ein Response-Feld binden).
- `POST /api/auth/webauthn/register/finish` → Body = `RegisterPublicKeyCredential` + state-key → `entnehme` (Guard weg) → `webauthn.finish_passkey_registration(&reg, &state)?` → `storage::speichere_passkey(pool, benutzer_id, &passkey)` (UNIQUE→409) → 200/201.

- [ ] **Step 1** — Handler + Request/Response-DTOs (nur DTOs, die für die Ceremony nötig sind; `CreationChallengeResponse`/`RegisterPublicKeyCredential` kommen aus `webauthn-rs`, sind serde). state-key-Bindung: kurzlebiges HttpOnly-Cookie (registrations-scoped), damit finish den richtigen State findet.
- [ ] **Step 2** — Routen in `app.rs`.
- [ ] **Step 3** — Integrationstest ohne Authenticator: `register/start` OHNE Session → 401; mit Session aber webauthn-Provider deaktiviert → 404. (Der volle Ceremony-Erfolg → `#[ignore]`-Smoke.) `cargo build` (Handler `Send`: Guard vor `await`).
- [ ] **Step 4: Commit** — `feat(lfh-275): WebAuthn-Registrierung (register/start|finish, exclude, UNIQUE→409)`

---

## Task 6: Authentifizierungs-Endpoints (passwortloser Login)

**Files:** `src/routes/auth.rs`, `src/app.rs`

**Endpoints (Enforcement: webauthn aktiv sonst 404):**
- `POST /api/auth/webauthn/auth/start` → Body `{ benutzername }` → Nutzer laden (aktiv), `passkeys_fuer_benutzer` → hat keine Passkeys → generischer Fehler (kein Enumerations-Leak) → `webauthn.start_passkey_authentication(&passkeys)` → `state::speichere` → `Json(rcr)` (+ state-key-Cookie).
- `POST /api/auth/webauthn/auth/finish` → Body `PublicKeyCredential` + state-key → `entnehme` (Guard weg) → `webauthn.finish_passkey_authentication(&cred, &state)?` → **AuthenticationResult:** Counter-Check + `passkey.update_credential(&res)` → `storage::aktualisiere_counter` → Nutzer bestimmen (über die `credential_id` aus `res` → `passkey_je_credential_id` → benutzer_id) → `benutzer.aktiv` prüfen → `session::anlegen` + Cookie (`session_cookie(token, cookie_secure())`) → 200.

- [ ] **Step 1** — Handler. Reihenfolge kritisch: `entnehme` (sync, Guard weg) VOR `session::anlegen().await`. Counter-Writeback PFLICHT vor Session. Fehler → generisch (kein „Nutzer existiert nicht"/Detail-Leak).
- [ ] **Step 2** — Routen in `app.rs`.
- [ ] **Step 3** — Integrationstest: `auth/start` mit webauthn deaktiviert → 404; `auth/start` für einen Nutzer ohne Passkeys → generischer Fehler (nicht 200, kein Enumerations-Signal). Voller Login → `#[ignore]`-Smoke. `cargo build` (`Send`).
- [ ] **Step 4: Commit** — `feat(lfh-275): WebAuthn-Login (auth/start|finish, Counter-Check+Writeback, Session)`

---

## Task 7: Frontend — Enroll (Profil) + Passkey-Login (LoginPage)

**Files:** authentifizierter Profil-/Benutzer-Bereich (Bestand prüfen: wo Nutzer ihr Konto sehen), `frontend/src/pages/LoginPage.tsx`, `frontend/src/api/*`

- [ ] **Step 1: Enroll-UI (authentifiziert)** — im Profil/Benutzer-Bereich ein „Passkey registrieren"-Button: `register/start` → `navigator.credentials.create({ publicKey: ccr.publicKey })` → `register/finish`. Nur anzeigen, wenn `window.isSecureContext` (WebAuthn braucht secure context) und der webauthn-Provider verfügbar ist. Fehler sauber anzeigen.
- [ ] **Step 2: Passkey-Login (LoginPage)** — für den `webauthn`-Provider einen „Mit Passkey anmelden"-Button (nur bei `isSecureContext`): Nutzer gibt Benutzernamen ein → `auth/start` → `navigator.credentials.get({ publicKey: rcr.publicKey })` → `auth/finish` → bei Erfolg `AuthContext` aktualisieren + navigieren. Base64url-Kodierung der ArrayBuffers beachten (webauthn-rs liefert/erwartet base64url — die Response-Typen sind i.d.R. direkt an `navigator.credentials` übergebbar via die Helfer, sonst `@simplewebauthn/browser` erwägen — im Zweifel manuell base64url).
- [ ] **Step 3: Gates** — Vitest (Buttons erscheinen bei secure context + verfügbarem Provider; `navigator.credentials` gemockt), `lint`, `typecheck` (via mise). Bestehende LoginPage-Tests grün.
- [ ] **Step 4: Commit** — `feat(lfh-275): Frontend Passkey-Enroll (Profil) + Passkey-Login (LoginPage)`

---

## Task 8: Voll-Gate + #[ignore]-Browser-Smoke + Doku

**Files:** `tests/webauthn_smoke.rs`, `docs/betrieb-webauthn.md`

- [ ] **Step 1** — `tests/webauthn_smoke.rs` `#[ignore]`: dokumentiert den manuellen End-to-End-Flow (HTTPS + Hostname + Browser mit Authenticator: einloggen → Passkey enrollen → ausloggen → passwortlos per Passkey einloggen; Clone-Check/Counter). `docs/betrieb-webauthn.md`: **rp_id muss ein Hostname sein** (keine IP) → LAN braucht mDNS/DNS + ein Cert für den Hostnamen (`--tls-hostname` + Cache-SAN-Invalidierung aus Task 1); `LIFELINE_WEBAUTHN_RP_ID`/`_RP_ORIGIN`; Enroll aus dem Profil, danach passwortloser Login; Passkey ist an ein bestehendes Konto gebunden (kein Self-Signup).
- [ ] **Step 2 (Controller)** — Voll-Suite env-hygienisch; Codegen-Drift-Gate; Frontend-Voll-Gate; manueller WebAuthn-Browser-Smoke (Hostname+Cert+Authenticator).
- [ ] **Step 3: Commit** — `docs(lfh-275): WebAuthn-Betriebsdoku (Hostname-rp_id) + #[ignore]-Smoke`

---

## Self-Review

**Spec coverage (Design Sektion 3/8):** app-eigene Passkeys, passwortloser Primär-Login → Tasks 5/6/7. sign_count-Fortschreibung/Clone-Detection → Task 6 (MUST). RP-ID/Origin aus konfiguriertem Host → Task 2 (MUST, Hostname). Braucht TLS (Inc 2) + Cache-SAN (Task 1).

**Advisor-MUSTs verankert:** (1) User-Handle random+gespeichert (Task 2 Spalte+Helfer); (2) eager Boot-Validierung, Provider nur bei Build-ok (Task 2/3); (3) opake Passkey-Blob-Storage + Counter-Rückschreiben (Task 3/6); (4) Enroll authentifiziert, getrennt vom Login-Button (Task 5/7 + MUST); (5) Task 1 SAN-aware Invalidierung spezifisch; (6) exclude_credentials, UNIQUE→409, Guard-drop-vor-await.

**Placeholder/Build-Verify-Punkte (bewusst):** webauthn-rs-0.5-API (Ceremony-Signaturen, `cred_id()`, `update_credential`, base64url der Frontend-Typen) + Migrationsnummer → beim Build/Umsetzen gegenprüfen (wie openidconnect/rcgen in Inc 2/3). Passkey-Test-Fixture (echte Authenticator-Daten fehlen) → eingechecktes JSON-Fixture.

**Offen (bewusst, → LFH-277):** discoverable/usernameless Login (der random Handle hält den Weg offen), Passkey-Verwaltung (umbenennen/löschen/mehrere), Admin-Linking. `ist_admin_tauglich` bleibt `{passwort}`.
