# Auth-Provider-System — Increment 5 (MFA/TOTP) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Opt-in TOTP-Zweitfaktor für lokale Passwort-Nutzer: aus dem Profil ein TOTP-Secret einrichten (+ einmalige Recovery-Codes), danach zweistufiger Passwort→TOTP-Login. SSO/Passkey-Nutzer sind unberührt (schon MFA-stark).

**Architecture:** `totp-rs` (RFC 6238). Der Passwort-Login verzweigt bei `totp_aktiviert` **vor** der Session-Anlage in einen zweiten Schritt: Passwort ok → „MFA required" + kurzlebiger, single-use Pending-State (hält `benutzer_id`, HttpOnly-Cookie) → `/auth/totp/finish` (TOTP- ODER Recovery-Code) → Session. Recovery-Codes werden gehasht + atomar-einmalig verbraucht. TOTP ist deterministisch → der ganze Flow ist integrationstestbar (kein Browser/Smoke). Schema (`totp_secret`/`totp_aktiviert`/`totp_recovery_code`) liegt aus Inc 1 (Migration 0083).

**Tech Stack:** Rust, axum 0.8, `totp-rs` (RFC 6238), sqlx/SQLite, sha2; Frontend React/TS (QR).

## Global Constraints

- **[MUST — der Crux] Pending-State→Session-Gating:** Für einen `totp_aktiviert`-Nutzer ist der EINZIGE Pfad zu `session::anlegen` ein verifizierter Zweitfaktor.
  - `routes/auth.rs::login` verzweigt auf `benutzer.totp_aktiviert` **VOR** `session::anlegen`. Passwort-ok für einen TOTP-Nutzer → Antwort „MFA required" + high-entropy Pending-Key (`session::neuer_token()`), **KEINE** Session, **KEIN** Session-Cookie.
  - `/auth/totp/finish` leitet `benutzer_id` AUS dem **Pending-State** ab — NIE aus einem client-gelieferten Username/Passwort. Der Endpoint nimmt weder Passwort noch Username.
  - Pending-State: **single-use** (`entnehme` entfernt), kurze TTL, prozessweit server-side (1:1 `oidc/state.rs`-Muster). Träger = **HttpOnly-Cookie** (wie OIDC/WebAuthn-Ceremonies).
  - **Kein zweiter Passwort→Session-Pfad umgeht den Branch.** Der dev-seeds-Login POSTet auf denselben `/api/auth/login`-Handler und erbt den Check — explizit so lassen, keinen Bypass einbauen.
- **[MUST — Recovery-Codes atomar single-use]:** Verbrauch via EIN `UPDATE totp_recovery_code SET benutzt_at = datetime('now') WHERE benutzer_id = ? AND code_hash = ? AND benutzt_at IS NULL` + Prüfung `rows_affected() == 1` (KEIN SELECT-then-UPDATE → kein Double-Spend-Race). Codes sind high-entropy random → **sha256** (nicht argon2). Nur **Hashes** speichern; die Klartext-Codes werden **einmalig** bei `enroll/finish` (nach bestätigendem Code) zurückgegeben.
- **[Entscheidung — Replay-Fenster bewusst deferred]:** skew=1 / 30 s ⇒ ein Code ist ~90 s gültig und in diesem Fenster wiederverwendbar, sofern man nicht den zuletzt verbrauchten Zeitschritt trackt (bräuchte eine `benutzer.totp_last_step`-Spalte). Threat-Model hier (opt-in MFA, Trusted-LAN, Cookie bewusst ohne `Secure`) → within-window-Replay-Schutz **deferred** mit Note an LFH-277. Bewusste Entscheidung, kein Silent-Gap.
- **[Entscheidung — Retry]:** Pending-State ist **strikt single-use** (ein Versuch je Passwort-Eingabe; falscher Code → Passwort erneut eingeben). Ein Retry-Budget (z.B. 3 Versuche) ist die freundlichere Alternative, braucht aber einen Attempt-Zähler → LFH-277-UX-Kandidat.
- **Admin-Reset** (AdminUser): setzt `totp_secret = NULL`, `totp_aktiviert = 0` UND **löscht** die Recovery-Codes des Nutzers (keine stale Codes nach Reset).
- **TOTP-Secret plaintext at-rest** (muss zur Verifikation rekonstruierbar sein → nicht hashbar). Dokumentierte akzeptierte Posture (konsistent mit dem HTTP-LAN-Modell); App-Key-Verschlüsselung = LFH-277-Kandidat.
- **[MUST — Neutralität]:** Ein `totp_aktiviert = 0`-Nutzer (der Normalfall) loggt sich **byte-identisch** zu heute ein (sofort Session). Test dafür.
- `ist_admin_tauglich` bleibt `{passwort}` (unberührt — MFA ist orthogonal). Guard-drop-vor-await (Pending-State-Guard vor `session::anlegen().await`). `totp-rs` = Build-Verify-Punkt (Version pinnen, API gegenprüfen). Migrationsnummer beim Umsetzen prüfen. **Typ-Codegen-Gate** für neue Response-DTOs. Rust-Gate `cargo test`; `cargo fmt --all`.
- **Betriebs-Footgun dokumentieren:** ein Alleinstell-Admin, der TOTP aktiviert und Authenticator **und** Recovery-Codes verliert, ist ohne zweiten Admin ausgesperrt → Enroll-UI zeigt die Recovery-Codes eindringlich; Doku: Admin-Reset braucht einen ANDEREN Admin.

## File Structure
- **Neu:** `src/auth/totp/mod.rs` (pure: Secret/otpauth/Verify + Recovery-Gen/Hash), `src/auth/totp/storage.rs` (Recovery-Persistenz + atomarer Verbrauch), `src/auth/totp/state.rs` (Pending-MFA-State).
- **Geändert:** `Cargo.toml`; `src/auth/mod.rs`; `src/routes/auth.rs` (login-Branch + `totp_enroll_start/finish`, `totp_finish`, `totp_reset`); `src/app.rs`; `src/api_doc.rs` (+ evtl. Enum/DTO); Frontend `ProfilPage.tsx` + `LoginPage.tsx` (+ `api/totp.ts`); `docs/betrieb-mfa.md`.
- **Kein** `#[ignore]`-Smoke — TOTP ist deterministisch, alles integrationstestbar.

---

## Task 1: Deps + pure TOTP-/Recovery-Core

**Files:** `Cargo.toml`, `src/auth/totp/mod.rs` (+ `pub mod totp;` in `src/auth/mod.rs`)

**Interfaces:**
- Produces: `neues_secret() -> String` (base32); `otpauth_url(secret_base32, benutzername) -> Result<String, AppError>`; `pruefe_code(secret_base32, code, jetzt_unix: u64) -> bool` (SHA1/6/skew1/30); `neue_recovery_codes() -> Vec<String>` (N high-entropy); `hash_recovery(code) -> String` (sha256 hex).

- [ ] **Step 1: Deps** — `Cargo.toml`: `totp-rs = { version = "5", features = ["otpauth", "gen_secret"] }` (Version beim Build gegenprüfen); `sha2` (falls nicht vorhanden — prüfen). Der TOTP-Issuer ist die Konstante `"lifeline-hub"`.
- [ ] **Step 2: Failing tests (pure)** —
  - `pruefe_code`: für ein bekanntes Secret + festen Timestamp einen gültigen Code (via `totp.generate(ts)`) erzeugen und `pruefe_code(secret, code, ts) == true`; ein falscher Code → false; ein Code aus dem Nachbar-Zeitschritt (skew) → true.
  - `neues_secret`: liefert nichtleeres base32, zwei Aufrufe verschieden.
  - `neue_recovery_codes`: N (z.B. 10) verschiedene, hinreichend lange Codes; `hash_recovery` deterministisch + ≠ Klartext.
- [ ] **Step 3: Implementieren** — `TOTP::new(Algorithm::SHA1, 6, 1, 30, Secret::Encoded(secret).to_bytes()?, Some("lifeline-hub".into()), benutzername)`; `secret.get_secret_base32()` / `get_url()` für otpauth; `check(code, ts)` für die deterministische Prüfung (nutze die timestamp-Variante, damit Tests fix sind). Recovery-Codes: 10× `Secret::generate_secret()`-Bytes → base32/gekürzt oder 10 Bytes hex; sha256(code) hex.
- [ ] **Step 4: Gates** — `cargo test --lib auth::totp`; `cargo build`; `cargo fmt --all`.
- [ ] **Step 5: Commit** — `feat(lfh-43): pure TOTP-Core (Secret/otpauth/Verify) + Recovery-Codes (sha256)`

---

## Task 2: Recovery-Storage (atomarer single-use Verbrauch)

**Files:** `src/auth/totp/storage.rs`

**Interfaces:** `speichere_recovery_codes(pool, benutzer_id, codes_klartext: &[String]) -> Result<(), AppError>` (hasht + INSERT, ersetzt vorhandene); `verbrauche_recovery_code(pool, benutzer_id, code_klartext) -> Result<bool, AppError>` (atomar, true bei Erfolg); `loesche_recovery_codes(pool, benutzer_id)`.

- [ ] **Step 1: Failing tests** — speichern → `verbrauche_recovery_code` mit gültigem Code → true; zweiter Verbrauch desselben Codes → false (single-use); unbekannter Code → false; `verbrauche` eines anderen Nutzers Code → false (benutzer_id-gebunden); `loesche_recovery_codes` entfernt alle.
- [ ] **Step 2: Implementieren** — `speichere`: DELETE bestehende + INSERT der `hash_recovery(code)`. `verbrauche`: `UPDATE totp_recovery_code SET benutzt_at = datetime('now') WHERE benutzer_id = ? AND code_hash = ? AND benutzt_at IS NULL` → `rows_affected() == 1`. (Atomar; kein SELECT-then-UPDATE.)
- [ ] **Step 3: Gates** — `cargo test --lib auth::totp::storage`; `cargo fmt --all`.
- [ ] **Step 4: Commit** — `feat(lfh-43): Recovery-Code-Storage (atomarer single-use Verbrauch)`

---

## Task 3: Pending-MFA-State-Store

**Files:** `src/auth/totp/state.rs`

**Interfaces:** 1:1 `oidc/state.rs`-Muster: `LazyLock<Mutex<HashMap<String, (i64 /*benutzer_id*/, Instant)>>>`, TTL (~5 min), single-use, Guard-sync-only, opportunistischer Sweep. `speichere(key, benutzer_id)` / `entnehme(key) -> Option<i64>`.

- [ ] **Step 1: Failing tests** — roundtrip (speichere→entnehme liefert benutzer_id); zweites entnehme → None (single-use); unbekannt → None; abgelaufen → None (past-Instant via `#[cfg(test)]`-Helfer); Sweep. Kein `.await` im Modul.
- [ ] **Step 2: Implementieren** — Kopie des `oidc/state.rs`-Musters (poison-safe Lock, `drop(store)` vor Rückkehr, Sweep in `speichere`).
- [ ] **Step 3: Gates** — `cargo test --lib auth::totp::state`; `cargo fmt --all`.
- [ ] **Step 4: Commit** — `feat(lfh-43): Pending-MFA-State-Store (single-use, TTL)`

---

## Task 4: Enroll-Endpoints (CurrentUser, aus dem Profil)

**Files:** `src/routes/auth.rs`, `src/app.rs`

**Endpoints (`CurrentUser`):**
- `POST /api/auth/totp/enroll/start` → `neues_secret()`; `UPDATE benutzer SET totp_secret = ?, totp_aktiviert = 0 WHERE id = ?` (Secret gespeichert, noch NICHT aktiv); `Json({ otpauth_url, secret_base32 })`.
- `POST /api/auth/totp/enroll/finish` → Body `{ code }`; lade `totp_secret`; `pruefe_code(secret, code, now)` → false → 422 „Code falsch"; true → `UPDATE benutzer SET totp_aktiviert = 1`; `neue_recovery_codes()` → `speichere_recovery_codes` (hashed) → `Json({ recovery_codes })` (Klartext, **einmalig**). (Falls schon `totp_aktiviert=1` beim start → 409 „bereits aktiv" oder erlaube Re-Enroll mit neuem Secret — entscheiden: Re-Enroll überschreibt Secret+Codes.)

- [ ] **Step 1** — Handler + DTOs. Enroll ist idempotent-fähig: ein erneuter `start` überschreibt das (noch inaktive) Secret; ein `start` bei bereits aktivem TOTP beginnt ein Re-Enroll (Secret neu, `aktiviert` bleibt bis `finish` bestätigt — oder auf 0 setzen; sauber dokumentieren).
- [ ] **Step 2** — Routen in `app.rs`.
- [ ] **Step 3: Integrationstest (deterministisch, MIT gültigem Code)** — enroll/start (mit Session) → 200 + otpauth_url/secret; aus dem zurückgegebenen `secret_base32` einen gültigen Code via `totp::` erzeugen → enroll/finish → 200 + genau N recovery_codes, und `totp_aktiviert=1` in der DB; enroll/start OHNE Session → 401.
- [ ] **Step 4: Commit** — `feat(lfh-43): TOTP-Enroll (start/finish, Recovery-Codes einmalig)`

---

## Task 5: Zweistufiger Login (der Crux) + `/auth/totp/finish`

**Files:** `src/routes/auth.rs`, `src/app.rs`

- [ ] **Step 1: `login` verzweigen (verhaltensneutral für Nicht-TOTP)** — nach `password::anmelden(...)` (+ dem bestehenden passwort-Provider-Enforcement aus Inc 3):
  ```
  if benutzer.totp_aktiviert {
      let key = session::neuer_token();
      totp::state::speichere(key.clone(), benutzer.id);   // KEINE Session
      // HttpOnly-Cookie `mfa_pending = key` (SameSite=Lax, path /api/auth, secure(cookie_secure()))
      return Ok((jar_mit_pending_cookie, Json(LoginAntwort::MfaErforderlich)));  // z.B. { "mfa": "totp" }
  }
  // sonst unverändert: session::anlegen + Cookie + BenutzerAnzeige
  ```
  Die Response für den MFA-Fall ist bewusst schmal (kein Benutzer-Objekt, kein Session-Cookie) — das Frontend erkennt „MFA nötig".
- [ ] **Step 2: `POST /api/auth/totp/finish`** — Body `{ code }` (TOTP ODER Recovery-Code) + `mfa_pending`-Cookie:
  1. `entnehme(&pending_key)` → `benutzer_id` (None → 401). **Guard released.**
  2. Lade `benutzer` (id, aktiv, totp_secret). `!aktiv` → 401.
  3. Verifiziere: `totp::pruefe_code(secret, code, now)` ODER (falls das fehlschlägt) `storage::verbrauche_recovery_code(pool, benutzer_id, code)`. Beides false → 401 (generisch). Ein gültiger Recovery-Code wird dabei atomar verbraucht.
  4. `session::anlegen` + Session-Cookie; `mfa_pending`-Cookie entfernen; `Json(BenutzerAnzeige)`.
  - Der Endpoint nimmt **kein** Passwort/Username — die Identität kommt aus dem Pending-State.
- [ ] **Step 3: Routen + Neutralitäts-/Security-Tests** —
  - **Neutralität:** ein Nicht-TOTP-Nutzer-Login gibt weiter sofort 200 + Session-Cookie (bestehende Login-Tests bleiben grün).
  - **Crux-Tests (deterministisch):** ein `totp_aktiviert`-Nutzer: `/login` mit korrektem Passwort → **kein** Session-Cookie, MFA-Response + `mfa_pending`-Cookie; `/auth/totp/finish` mit einem gültigen TOTP-Code (aus dem Secret erzeugt) + Cookie → 200 + Session-Cookie; mit falschem Code → 401, keine Session; `/auth/totp/finish` OHNE Pending-Cookie → 401; ein gültiger **Recovery-Code** → 200 + Session, und derselbe Recovery-Code ein zweites Mal → 401 (verbraucht).
- [ ] **Step 4: Commit** — `feat(lfh-43): zweistufiger Passwort→TOTP-Login (Pending-State-Gating, Recovery-Fallback)`

---

## Task 6: Admin-Reset + Enroll-Status

**Files:** `src/routes/auth.rs`/`src/routes/benutzer.rs`, `src/app.rs`

- [ ] **Step 1** — `POST /api/benutzer/{id}/totp/reset` (AdminUser): `UPDATE benutzer SET totp_secret = NULL, totp_aktiviert = 0 WHERE id = ?` + `storage::loesche_recovery_codes(pool, id)`; Sessions des Nutzers optional invalidieren. Und ein Feld `totp_aktiviert` in `BenutzerAnzeige` (oder ein `me`-Detail), damit Profil/Admin den Status sehen (Codegen-Gate, falls DTO geändert). Der eigene MFA-Status kommt über `GET /api/auth/me` (Feld ergänzen) oder einen `totp/status`-Endpoint.
- [ ] **Step 2** — Routen. Tests: Admin-Reset eines TOTP-Nutzers → `totp_aktiviert=0`, Secret NULL, Recovery-Codes weg; Reset ohne Admin → 401/403.
- [ ] **Step 3: Commit** — `feat(lfh-43): Admin-TOTP-Reset + MFA-Status`

---

## Task 7: Frontend — Enroll (Profil) + zweite Login-Stufe

**Files:** `frontend/src/pages/ProfilPage.tsx`, `frontend/src/pages/LoginPage.tsx`, `frontend/src/api/totp.ts`

- [ ] **Step 1: Enroll (ProfilPage)** — „Zwei-Faktor (TOTP) einrichten"-Bereich: `enroll/start` → QR aus der `otpauth_url` rendern (kleine QR-Lib als Dep, z.B. `qrcode` — oder eine vorhandene; sonst die otpauth-URL + base32 zum manuellen Eintragen anzeigen) + Code-Eingabe → `enroll/finish` → die **Recovery-Codes eindringlich** einmalig anzeigen (Kopier-/Download-Hinweis, „jetzt sichern"). MFA-Status anzeigen (aktiv/aus), „deaktivieren"? (v1: Deaktivieren via Admin-Reset oder ein self-`disable` — entscheiden; mind. Status + Enroll).
- [ ] **Step 2: Zweite Login-Stufe (LoginPage)** — wenn `login()` die „MFA erforderlich"-Antwort liefert (statt eines Benutzers), auf eine TOTP-Code-Eingabe umschalten → `totp/finish` → bei Erfolg `AuthContext.aktualisiere()` + navigieren. „Recovery-Code verwenden"-Option (dasselbe Feld/Endpoint). Das `AuthContext.login` muss die zwei Fälle unterscheiden (Benutzer vs. MFA-nötig) — API/Context minimal erweitern.
- [ ] **Step 3: Gates** — Vitest (Enroll-Flow gemockt: start→QR/Code→finish→Recovery-Anzeige; Login-zweite-Stufe: mfa-Response→Code→session), `lint`, `typecheck`. Bestehende LoginPage/ProfilPage-Tests grün.
- [ ] **Step 4: Commit** — `feat(lfh-43): Frontend TOTP-Enroll (Profil) + zweite Login-Stufe`

---

## Task 8: Voll-Gate + Betriebsdoku

**Files:** `docs/betrieb-mfa.md`

- [ ] **Step 1** — `docs/betrieb-mfa.md`: opt-in TOTP als 2. Faktor für Passwort-Nutzer (SSO/Passkey schon MFA-stark); Enroll aus dem Profil (Authenticator-App scannt QR); **Recovery-Codes sichern** — einziger Ausweg bei Geräteverlust; **Admin-Reset braucht einen ANDEREN Admin** (Alleinstell-Admin-Lockout-Warnung); akzeptierte Posture: TOTP-Secret plaintext at-rest (nicht hashbar), within-window-Replay deferred (LFH-277).
- [ ] **Step 2 (Controller)** — Voll-Suite env-hygienisch; Codegen-Drift-Gate (falls `BenutzerAnzeige`/DTO geändert); Frontend-Voll-Gate. (Kein manueller Smoke nötig — TOTP ist deterministisch getestet.)
- [ ] **Step 3: Commit** — `docs(lfh-43): MFA/TOTP-Betriebsdoku`

---

## Self-Review

**Spec coverage (Design Sektion 3 „Passwort (+ optional TOTP)"):** TOTP opt-in Self-Enrollment (Secret + otpauth-QR + Bestätigungscode) → Task 4. Recovery-Codes → Task 1/2/4. Zweistufiger Login → Task 5. Admin-Reset → Task 6. Frontend → Task 7.

**Advisor-MUSTs verankert:** (1) Pending-State→Session-Gating als Crux (Task 5, login-Branch VOR session::anlegen; finish leitet id aus Pending-State; single-use HttpOnly-Cookie; dev-seeds erbt den Check); (2) Recovery atomar single-use sha256 (Task 2); (3) Replay-Fenster deferred als STATED decision (Global Constraints + LFH-277); (4) Retry strikt single-use (stated); (5) Admin-Reset löscht Secret+aktiviert+Codes (Task 6); (6) TOTP-Secret plaintext dokumentiert; (7) Neutralität für Nicht-TOTP (Task 5 Test); totp-rs Build-Verify.

**Placeholder/Build-Verify:** totp-rs-5-API (`TOTP::new`, `Secret`, `check`, `get_url`/`get_secret_base32`), QR-Lib-Wahl (Frontend), Migrationsnummer (keine neue Migration nötig — Spalten aus 0083) → beim Umsetzen bestätigen.

**Offen (→ LFH-277):** within-window-Replay (totp_last_step), Retry-Budget, TOTP-Secret-Verschlüsselung at-rest, self-`disable` ohne Admin.
