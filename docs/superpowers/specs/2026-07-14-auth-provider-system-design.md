# Auth-Provider-System — Design (LFH-57 / LFH-41 + LFH-43)

**Status:** entworfen · **Datum:** 2026-07-14 · **Board:** Epic LFH-57 „Auth & Sicherheit"
(bündelt LFH-41 OIDC/SSO, LFH-43 MFA — im Zuge des Brainstormings zu einem
Provider-System erweitert; neue Arbeitspakete werden als eigene Subtasks unter LFH-57 angelegt)

## Problem

Der heutige Auth-Unterbau kennt genau **einen** Login-Weg: lokaler Benutzername + argon2-Passwort,
serverseitige Session (opakes Token in `session`, Cookie `lifeline_sid`, bewusst **ohne** `Secure`
für den HTTP-LAN-/ELW-Betrieb). Gewünscht sind mehrere, **einzeln aktivierbare** Login-Methoden:

- **Dev** — Ein-Klick-Login (nur im Dev-Modus).
- **Lokal, WebAuthn-first** — app-eigene Passkeys ohne externen IdP.
- **Lokal, Passwort (+ optional TOTP)** — klassisch, OTP als zweiter Faktor.
- **OIDC/SSO** — externer Provider, konkret self-hosted **PocketID** (passkey-first, OIDC-konform).

Statt OIDC (LFH-41) und MFA (LFH-43) als zwei Silos zu bauen, werden sie zu Instanzen **einer
Auth-Provider-Architektur**. Zwei harte Randbedingungen prägen das Design:

1. **Offline-first / isoliertes LAN ohne garantierten Uplink.** Ein externer IdP kann unerreichbar
   sein → lokale Login-Wege dürfen **nie** von OIDC abhängen.
2. **Browser-WebAuthn braucht einen *secure context* (HTTPS oder `localhost`).** Auf `http://<LAN-IP>`
   (Tablet → ELW-Server-IP) ist `navigator.credentials` schlicht nicht verfügbar; dasselbe gilt für
   `Secure`-Cookies. Lokales WebAuthn erzwingt daher einen HTTPS-Transport.

## Scope (entschieden)

**Enthalten:**

- Provider-Abstraktion mit serverweitem An/Aus je Provider (Registry).
- HTTPS/TLS-Transport mit automatischer Cert-Beschaffung (mkcert bei Bedarf, sonst rcgen), BYO-Cert
  per Env, `Secure`-Cookie bei HTTPS. HTTP bleibt Bind-Option (Dev/localhost).
- Datenmodell „Credentials am Konto": ein `benutzer` = eine Identität, mehrere anhängbare Credentials.
- Provider: Dev, Passwort (+ optional TOTP), lokales WebAuthn, OIDC (PocketID, JIT least-privilege).
- Login-UX aus einer Provider-Discovery (`GET /api/auth/providers`).
- Aussperr-Guard (der letzte admin-taugliche Login-Weg lässt sich nicht deaktivieren).

**Bewusst NICHT (v1):**

- Server-erzwungene Pflicht-MFA (Policy „alle Nutzer müssen TOTP haben") — nachrüstbar. TOTP ist v1 opt-in.
- Mehrere OIDC-Provider gleichzeitig / Multi-Org-Claim-Mapping (Single-Org-Annahme bleibt). Ein
  konfigurierter OIDC-Provider.
- Auto-Linking einer SSO-Identität an ein bestehendes lokales Konto per E-Mail (Übernahme-Risiko) —
  Verknüpfung ist eine bewusste Admin-Aktion.
- Rollen-Mapping aus OIDC-Claims/Gruppen. JIT provisioniert mit least privilege; Admin stuft hoch.
- Remote-Trust-Verteilung der mkcert-Root-CA auf Fremdgeräte (bleibt ein Ops-Schritt, s. u.).

## Architektur-Überblick

Aus „OIDC + MFA" wird **ein Auth-Provider-System**. Alle Login-Wege konvergieren auf das
bestehende, unveränderte **Session-Modell** (`session::anlegen` → opakes Token → Cookie). Ein
„Provider" ist serverweit an/aus; welche Credential-Art jemand vorlegt, entscheidet den Login.

Neue Modulstruktur (Backend):

```
src/auth/provider/
  mod.rs        — gemeinsame Typen (ProviderId, ProviderInfo), Re-Exports
  registry.rs   — welche Provider konfiguriert + aktiviert sind; Aussperr-Guard
  password.rs   — Passwort-Login (Refactor des heutigen Flows) + TOTP-Kopplung
  totp.rs       — TOTP-Enrollment/-Verifikation + Recovery-Codes
  webauthn.rs   — lokale Passkeys (webauthn-rs)
  oidc.rs       — Authorization-Code-Flow (openidconnect)
  dev.rs        — Ein-Klick-Dev-Login
```

**Bewusst keine erzwungene Einheits-Trait** über völlig verschiedene Flows (Extractor-artiger
Passwort-Post vs. Redirect-basierter OIDC-Flow vs. Challenge/Response-WebAuthn). Die verbindende
Klammer ist zweifach:

1. die **Registry** (Quelle der Wahrheit, welche Provider konfiguriert und aktiviert sind — treibt
   sowohl `/providers` als auch die Guards), und
2. dass jeder erfolgreiche Flow in `session::anlegen(pool, benutzer_id)` mündet und dasselbe Cookie setzt.

## Datenmodell (Credentials am Konto)

Eine Migration `0083_auth_provider.sql` (Nummer beim Umsetzen gegen den dann aktuellen Stand prüfen —
parallele Branches vergeben Nummern doppelt):

- `benutzer.passwort_hash` → **nullable** machen (SSO-/Passkey-only-Nutzer haben kein lokales
  Passwort). SQLite: Spalten-Nullability-Änderung = Tabellen-Rebuild; FK-sichere Nicht-Leaf-Rebuilds
  sind seit sqlx 0.9 (LFH-163) machbar. Rebuild-Rezept + Verifikation gegen eine `lifeline.db`-Kopie
  beachten (Präzedenz 0078/0079/0082).
- `benutzer.oidc_subject TEXT NULL` + `benutzer.oidc_issuer TEXT NULL`, **UNIQUE(oidc_issuer, oidc_subject)**.
  Match ausschließlich über den stabilen `sub`-Claim (E-Mail kann wechseln), gebunden an den Issuer.
- `benutzer.totp_secret TEXT NULL`, `benutzer.totp_aktiviert INTEGER NOT NULL DEFAULT 0`.
- Kind-Tabelle `webauthn_credential(id INTEGER PK, benutzer_id INTEGER NOT NULL REFERENCES benutzer(id)
  ON DELETE CASCADE, credential_id BLOB NOT NULL UNIQUE, public_key BLOB NOT NULL, sign_count INTEGER
  NOT NULL, label TEXT, erstellt_at TEXT NOT NULL DEFAULT (datetime('now')))`.
- Kind-Tabelle `totp_recovery_code(id INTEGER PK, benutzer_id INTEGER NOT NULL REFERENCES benutzer(id)
  ON DELETE CASCADE, code_hash TEXT NOT NULL, benutzt_at TEXT NULL)`. Codes werden gehasht gespeichert
  (nicht im Klartext), einmalig verwendbar.
- Tabelle `auth_provider(id TEXT PRIMARY KEY, aktiviert INTEGER NOT NULL DEFAULT 1)` — beim
  Server-Start mit den **konfigurierten** Providern abgeglichen (nicht konfigurierte Provider
  erscheinen nicht; neu konfigurierte werden mit Default-Zustand angelegt). Hält die Runtime-Toggles.

**PII-Hinweis:** Neue personenbezogene Auth-Spalten (`oidc_subject`, WebAuthn-Credentials) gehören in
`schwaerze_einsatz`/die DSGVO-Schwärzung geprüft, falls sie in Einsatz-Kontexte einfließen — hier
primär org-/benutzerweit, daher voraussichtlich nicht einsatzgebunden; beim Umsetzen bestätigen.

## Provider im Detail

### Dev
Ein-Klick-Login als vorbestimmter (Test-)Benutzer. **Nur** wenn Dev-Modus aktiv — in einem
Produktionslauf **hart** aus (nicht nur Toggle-aus), damit kein versehentliches Aktivieren möglich
ist. Erkennung z. B. über ein explizites `LIFELINE_DEV_AUTH=1` **und** Nicht-Release-Kontext; die
genaue Gate-Bedingung wird im Plan festgelegt (fail-safe: im Zweifel aus).

### Passwort (+ optional TOTP)
Der heutige Flow (`routes/auth.rs::login`, argon2, User-Enumeration-Schutz) wird 1:1 in den
„password provider" refaktoriert — **kein Verhaltenswechsel** in diesem Schritt. Hat der Benutzer
`totp_aktiviert = 1`, wird der Login **zweistufig**: Passwort korrekt → Zwischenzustand → TOTP-Code
(oder Recovery-Code) → Session. *Default:* TOTP **opt-in** (Selbst-Enrollment über einen
authentifizierten Endpunkt: Secret erzeugen, QR/otpauth-URI anzeigen, ersten Code zur Bestätigung
verlangen, dann Recovery-Codes einmalig anzeigen). Admin kann TOTP eines Nutzers zurücksetzen. Keine
serverseitige Zwangs-MFA in v1.

### Lokal WebAuthn
App-eigene Passkeys via `webauthn-rs`. „first" = Passkey ist **primärer, passwortloser** Login für
lokale Konten (Registrierung durch den authentifizierten Nutzer; Login per Assertion). Braucht einen
stabilen HTTPS-Origin → RP-ID/Origin aus dem konfigurierten Host. Ohne secure context bietet sich der
Provider nicht an (Registry meldet ihn dann als nicht verfügbar). `sign_count`-Fortschreibung gegen
Cloning.

### OIDC (PocketID)
`openidconnect`-Crate, generisch gegen OIDC-Discovery, verifiziert gegen PocketID:

- Discovery-Dokument beim Start/erste Nutzung laden und cachen.
- `GET /api/auth/oidc/{id}/start` → `state` + PKCE-`code_verifier` + `nonce` serverseitig kurz
  vorhalten (kurzlebiger Store), Redirect zur IdP-Authorize-URL.
- `GET /api/auth/oidc/{id}/callback` → `code` gegen Token tauschen, `id_token` validieren
  (Signatur via JWKS, `iss`, `aud`, `exp`, `nonce`, `state`), **find-or-JIT-create** anhand
  `(issuer, sub)`:
  - Bekannt → Session.
  - Unbekannt → neuen `benutzer` anlegen: Single-Org, `system_rolle = keiner`, `org_rolle = keine`
    (**least privilege**), `anzeigename`/`benutzername` aus Claims (`name`/`preferred_username`,
    Kollision auf `benutzername` deterministisch auflösen), kein `passwort_hash`. Danach Session.
- **Funktioniert auch über reines HTTP** (PKCE + state + nonce schützen den Flow) → OIDC ist **nicht**
  vom HTTPS-Increment blockiert.
- Config deploy-time (s. u.); `client_secret` **nie** in DB/API.

## HTTPS/TLS-Transport (Auto-Cert)

Heute: `axum::serve` über reines HTTP (Default `127.0.0.1:8080`), kein server-seitiges TLS. Neu: ein
optionaler HTTPS-Modus. Im HTTPS-Modus wird das Cert in **Präzedenz** aufgelöst und **bei Bedarf
automatisch erzeugt**:

1. **BYO** — `LIFELINE_TLS_CERT` / `LIFELINE_TLS_KEY` (PEM-Pfade) gesetzt → nutzen.
2. **Gecacht** — gültiges Cert neben der DB vorhanden → nutzen.
3. **mkcert** — Binary auf PATH → automatisch ausführen: für die konfigurierten Host(s) (`localhost`,
   Bind-IP, optionaler Hostname) Cert+Key generieren und cachen. Die lokale CA wird bei Bedarf per
   `mkcert -install` sichergestellt — das **mutiert den Trust-Store** (ggf. `sudo`), daher hinter
   `LIFELINE_TLS_MKCERT_INSTALL` (Default an, abschaltbar).
4. **rcgen** — self-signed in-binary als letzter Fallback.

Erkennung via `Command`/PATH-Check; fehlt mkcert oder scheitert es → **sauberer Fallback auf rcgen**
mit Log-Hinweis (kein harter Abbruch). Ein Trigger zum Cert-Erneuern (`--tls-cert-erneuern` o. ä.).
Bei aktivem HTTPS bekommt das Session-Cookie `Secure`. Startet der HTTPS-Modus mit einer
kaputten BYO-Cert-Konfig → **fail fast** mit klarer Meldung.

**Ehrlicher Caveat (löst Auto-mkcert NICHT):** `mkcert -install` macht die CA nur auf dem
**Server-Host** vertrauenswürdig. **LAN-Tablets** müssen die Root-CA (`mkcert -CAROOT`) **einmalig
ausgerollt** bekommen, sonst dort weiterhin Cert-Warnung und **kein sauberes WebAuthn**. Auto-mkcert
löst sofort *Same-Machine/localhost* und die *Cert-Erzeugung*; die *Remote-Trust-Verteilung* bleibt
ein Ops-Schritt. mkcert ist zudem ausdrücklich kein Produktions-Tool (der breit vertrauenswürdige
CA-Key liegt auf der Maschine) — bewusster Pragmatismus fürs vertrauenswürdige LAN. Für „richtige"
Deployments ist BYO-Cert mit eigener lokaler CA (z. B. `step-ca`) der saubere Weg.

## Konfiguration / Steuerung (Hybrid)

- **Deploy-time (Env/CLI, `LIFELINE_*`-Muster wie bestehend):** OIDC `issuer`/`client_id`/
  `client_secret`/`redirect_url`, TLS-Cert/Key bzw. mkcert-Schalter, HTTPS-Bind. **Secrets nie in DB/UI.**
- **Runtime (Admin-UI, DB-gestützt):** pro-Provider **An/Aus** über `auth_provider.aktiviert`. Ein
  Provider ist nur togglebar, wenn er **konfiguriert** und **verfügbar** ist (OIDC nur mit gesetztem
  Issuer/Secret; WebAuthn nur im secure context; Dev nur im Dev-Modus).

## Login-UX / Daten-Fluss

- `GET /api/auth/providers` liefert die **aktivierten, verfügbaren** Provider + Metadaten (Typ,
  Anzeigename, ggf. Start-URL). Response-DTO neu → Typ-Codegen-Gate.
- Frontend-`LoginPage` rendert daraus dynamisch: SSO-Buttons („Login mit PocketID" → Redirect auf
  `/api/auth/oidc/{id}/start`), lokaler Block (Passkey-Button + Passwort-Formular mit **bedingter**
  TOTP-Stufe), Dev-Button (nur wenn Dev-Provider vorhanden).
- `AuthContext` behält den `me()`-Bootstrap; nach OIDC-Callback landet der Nutzer per Redirect
  angemeldet in der App.

## Sicherheits-Guardrails

- **Aussperr-Schutz** (analog „letzter aktiver Admin", `routes/benutzer.rs::deaktivieren`): Der letzte
  Login-Weg, über den sich noch ein **Admin** anmelden kann, lässt sich nicht deaktivieren. Konkret:
  Deaktivieren eines Providers wird verweigert, wenn danach **kein** aktiver Admin mehr ein
  nutzbares Credential über einen aktivierten Provider hätte.
- Dev-Provider im Produktionslauf hart aus.
- OIDC-`client_secret` / TLS-Key nie in DB/API.
- WebAuthn-Provider bietet sich nur im secure context an.
- **Offline-Resilienz:** IdP unerreichbar → lokale Provider funktionieren unverändert weiter
  (OIDC ist keine Hard-Dependency; Fehler beim Discovery/Token führen nicht zum Ausfall der
  lokalen Logins).

## Fehlerbehandlung

- **OIDC:** IdP unerreichbar / Discovery-Fehler / ungültiges `id_token` / `state`-Mismatch /
  `nonce`-Mismatch → klarer Fehler an der Callback-Route, Nutzer landet wieder auf der LoginPage mit
  Hinweis, andere aktivierte Provider bleiben nutzbar.
- **TLS:** kaputte BYO-Konfig → fail fast; mkcert fehlt/scheitert → Fallback rcgen + Log.
- **WebAuthn:** kein secure context → Provider nicht angeboten; Assertion-Fehler → generischer
  Login-Fehler (keine Enumeration).
- **TOTP:** falscher Code → generischer Fehler; verbrauchter Recovery-Code → abgelehnt.

## Tests

- **Unit:** `id_token`-Validierung (gültig/abgelaufen/falscher `aud`/`nonce`), JIT-Provisioning
  (neu vs. bekannt, `benutzername`-Kollision), Registry-Toggles + Verfügbarkeits-Ableitung,
  **Aussperr-Guard**, TOTP-Verifikation + Recovery-Code-Einmaligkeit, Cert-Auflösungs-Präzedenz
  (mkcert-vorhanden vs. -fehlt → korrekter Zweig, Fallback rcgen).
- **Integration (gegen `test_pool`):** je Provider ein Login-Flow bis Session/Cookie; Passwort→TOTP
  zweistufig; Provider-Discovery-Endpunkt. OIDC gegen einen **Mock-Issuer** (Discovery + JWKS + Token
  gestellt), nicht gegen echtes PocketID (deterministisch, offline-testbar).
- **WebAuthn:** über die `webauthn-rs`-Testhilfen (Register/Assert-Roundtrip).
- **Gates:** `check-typ-codegen.sh` für neue Response-DTOs (`AuthProvider`-Liste, MFA-/Credential-Status).
  Falls ein Provider hinter ein Cargo-Feature gelegt wird (wie `clamav`): zusätzlicher
  `cargo test --features <x>`-Lauf, sonst rottet der Pfad still.
- **Frontend:** LoginPage rendert Provider aus `/providers` (Mock), bedingte TOTP-Stufe, Passkey-Button
  nur im secure context. Volle Vitest-Suite via `--no-file-parallelism` (Flaky-Vermeidung).

## Zerlegung in Umsetzungspläne (abhängigkeits-geordnet)

Ein gemeinsames Design (dieses Dokument), dann **je Increment ein eigener writing-plans-Plan**,
Umsetzung in dieser Reihenfolge:

1. **Fundament** — Datenmodell-Migration (nullable `passwort_hash`, neue Spalten/Kind-Tabellen,
   `auth_provider`); Provider-**Registry** + `GET /api/auth/providers`; Refactor des heutigen
   Passwort-Logins in den „password provider" (kein Verhaltenswechsel); Admin-**Toggle** (DB) +
   **Aussperr-Guard**; `LoginPage` rendert aus `/providers`.
2. **HTTPS/TLS-Transport** — HTTPS-Bind, Cert-Auflösung (BYO → cache → mkcert → rcgen), `mkcert`-
   Auto-Ausführung + `-install`-Schalter, `Secure`-Cookie bei HTTPS, Dev-Doku (mkcert). *(unblockt #4)*
3. **OIDC-Provider (PocketID)** — Discovery/Auth-Code/PKCE/nonce, `id_token`-Validierung, JIT
   least-privilege, `oidc_subject`-Link, Admin-Link-Aktion, Config via Env, Toggle. *(nicht von #2 blockiert)*
4. **Lokal WebAuthn** — Passkey register/login (`webauthn-rs`). *(braucht #2 für secure context)*
5. **TOTP-2. Faktor** — Enrollment + Recovery-Codes + zweistufiger Passwort-Login. („falls einfach",
   niedrigste Prio.)

**Dev-Provider** wird pragmatisch in Increment 1 mit angelegt (kleinster Provider, nützlich für die
Flow-Tests der Folge-Increments).

## Offene Punkte für die Umsetzung (bewusst festgehalten, nicht blockierend)

- Genaue Gate-Bedingung „Dev-Modus" (Env + Build-Kontext) im Fundament-Plan festzurren.
- Zwischenzustand des zweistufigen Passwort→TOTP-Logins: kurzlebiges serverseitiges Pending-Token vs.
  signierter Client-Token — im TOTP-Plan entscheiden (Default: serverseitig, analog OIDC-state-Store).
- Migrationsnummer beim Umsetzen gegen den dann aktuellen `migrations/`-Stand prüfen (Kollisionsgefahr).
