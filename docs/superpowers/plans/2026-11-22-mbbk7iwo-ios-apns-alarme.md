# iOS-App: Alarme über Apple Push (APNs) — Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Zunder: https://zunder.rubeen.dev/#/aufgabe/mbbk7iwoaarmf1z57qc8ffwo (LLH-1981)

**Goal:** Alarme und Hinweise erreichen ein iPhone mit geschlossener Lifeline-App, Ende-zu-Ende
verschlüsselt, über ein von Ruben betriebenes Push-Relais.

**Architecture:** Neue Crate `push-relais/` hält den `.p8` und spricht HTTP/2 mit APNs. Der
Server bekommt neben `src/web_push/` ein Modul `src/ios_push/`, das Anmeldungen (Konto + Gerät)
speichert, die Nutzlast je Gerät mit AES-256-GCM verschlüsselt und über das Relais versendet. Die
iOS-Hülle meldet Token und Geräteschlüssel über die Brücke, eine Notification Service Extension
entschlüsselt, ein Tippen öffnet Server und Pfad. Das Frontend zeigt den Push-Schalter in der
iOS-App über `faehigkeiten.ts`.

**Tech Stack:** Rust (axum 0.8, sqlx 0.9 SQLite, reqwest 0.13 + `http2`, openssl), Swift 6
(LifelineKern, SwiftUI, UserNotifications, CryptoKit), TypeScript/React (Vitest), xcodegen.

**Spec:** `docs/superpowers/specs/2026-11-22-mbbk7iwo-ios-apns-alarme-design.md`

## Subtasks und Kürzel

| Subtask | Kürzel | Aufgaben |
|---|---|---|
| LLH-2039 Push-Relais | `miszqjsd` | 1–3 |
| LLH-2040 Kanal im Server | `oef7agry` | 4–7 |
| LLH-2041 iOS-App | `fxj859xf` | 8–10 |
| LLH-2042 Frontend und Doku | `zevf9a3p` | 11–12 |
| alle | — | 13 (Gates, Apple, Gerätetest, PR) |

## Global Constraints

- Bezeichner: Fachbegriffe deutsch, Technik englisch (`AGENTS.md`, „Bezeichner-Sprache“); Prosa,
  Kommentare, Testnamen deutsch.
- Brücken-Wire-Namen englisch und danach fest (`ios/AGENTS.md`); Server-API-Felder deutsch.
- Kein Token, kein Schlüssel, keine Nutzlast in irgendeinem Log (Relais und Server).
- Server: Opt-in `--ios-push` / `LIFELINE_IOS_PUSH`, Standard aus; ohne es keine ausgehende
  Verbindung, Routen 404. Relais-Adresse `--ios-push-relais` / `LIFELINE_IOS_PUSH_RELAIS`, Standard
  `https://push.rubeen.dev`.
- APNs-Ablauf 12 h, `apns-priority: 10`, `apns-push-type: alert`; Alarm
  `interruption-level: time-sensitive`, Hinweis `active`; Rückfalltitel „Alarm“ / „Neue
  Benachrichtigung“.
- Verschlüsselter Teil der Nutzlast ≤ 3 KB; AES-256-GCM, Nonce 12 Byte zufällig, AAD = `kennung`.
- Relais-Limits: 600 Nachrichten je Server und Minute, 10 Registrierungen je IP und Stunde,
  höchstens 100 Nachrichten je `senden`-Aufruf.
- Ein Fehler beim iOS-Push verzögert oder scheitert nie die auslösende Anfrage (`tokio::spawn`,
  nie awaited).
- Anmeldung hängt an Konto + Gerät; `session_token_hash` ist `ON DELETE SET NULL`.
- Migrationsnummer: größer als alles auf `origin/alpha` (derzeit 0363), vor dem Push
  `scripts/check-migrationen.sh`.
- ADR-Nummer 0084 (zuerst 0082; nach dem Merge von alpha umnummeriert, dort tragen 0082 und 0083 andere Entscheidungen; vorher `scripts/check-adr-nummern.sh`).
- Swift gibt es im Linux-Container nicht: Kern-Tests (`swift test`) und App-Build belegt erst
  `ios-pruefung.yml` am PR; lokal läuft dort nichts. Jede Swift-Aufgabe trotzdem mit Tests zuerst.

## Review Focus

1. **Token wechselt oder App wird neu installiert:** neues Token mit neuer Kennung; eine Anmeldung
   mit bekanntem Token ersetzt die alte (Upsert auf `token`), alte Tokens verschwinden mit
   `token_ungueltig`. Test in Aufgabe 4 (`ein_bekanntes_token_ersetzt_die_alte_anmeldung`).
2. **Sehr langer oder mehrbyteiger Wortlaut:** wird an einer Zeichengrenze gekürzt, Nutzlast bleibt
   ≤ 3 KB und entschlüsselbar. Test in Aufgabe 7 (`langer_wortlaut_wird_an_zeichengrenze_gekuerzt`).
3. **Relais hängt oder ist weg:** `melden` kehrt sofort zurück, nach 10 s Zeitlimit eine
   Log-Zeile ohne Token. Test in Aufgabe 7 (`haengendes_relais_haelt_melden_nicht_auf`).
4. **Pfad in der Nutzlast zeigt woandershin** (absolute URL, fremder Host, `//evil`): die App öffnet
   die Startseite des Servers. Test in Aufgabe 9 (`testFremderPfadOeffnetDieStartseite`).
5. **Konto verliert Rechte nach der Anmeldung:** deaktiviert → Anmeldung gelöscht; Leserecht auf
   Meldungen entzogen → Meldung kommt ohne Absender und Wortlaut. Tests in Aufgabe 6
   (`deaktivieren_loescht_die_anmeldungen`) und Aufgabe 7
   (`ohne_leserecht_fehlen_absender_und_wortlaut`).

---

## LLH-2039 Push-Relais (`miszqjsd`)

### Task 1: Crate, Konfiguration, Speicher, Registrierung, Sperren

**Files:**
- Modify: `Cargo.toml` (`[workspace] members` + `"push-relais"`)
- Create: `push-relais/Cargo.toml`, `push-relais/src/{main.rs,lib.rs,config.rs,speicher.rs,api.rs}`,
  `push-relais/migrations/0001_server.sql`
- Test: `push-relais/tests/registrierung.rs`

**Interfaces:**
- Produces:
  - `pub struct RelaisConfig` (clap, `env`): `bind` (`PUSH_RELAIS_BIND`, Standard `0.0.0.0:8089`),
    `datenbank` (`PUSH_RELAIS_DATENBANK`), `apns_schluessel: PathBuf`
    (`PUSH_RELAIS_APNS_SCHLUESSEL`), `apns_key_id`, `apns_team_id`, `bundle_id` (Standard
    `dev.rubeen.lifeline.ios`), `limit_minute: u32` (600), `registrierungen_stunde: u32` (10),
    `hinter_proxy: bool` (`PUSH_RELAIS_HINTER_PROXY`, Standard false: dann zählt der erste Eintrag
    von `X-Forwarded-For`), versteckt `apns_basis_production`/`apns_basis_sandbox` (Standard Apple).
    Unterbefehle `serve` (Standard), `sperren <server_id>`, `entsperren <server_id>`.
  - `pub async fn speicher::oeffnen(pfad: &str) -> anyhow::Result<SqlitePool>` (führt
    `sqlx::migrate!("./migrations")` aus).
  - `pub async fn speicher::registrieren(pool, kontakt: Option<&str>, version: &str) -> Result<Zugang>`
    mit `pub struct Zugang { pub server_id: String, pub geheimnis: String }` (je 32 Byte zufällig,
    base64url; gespeichert wird `sha256(geheimnis)` hex).
  - `pub async fn speicher::pruefen(pool, server_id: &str, geheimnis: &str) -> Result<Pruefung>`
    mit `pub enum Pruefung { Gueltig, Unbekannt, Gesperrt }` (konstantzeitiger Vergleich).
  - `pub async fn speicher::sperren(pool, server_id) / entsperren(pool, server_id) -> Result<bool>`.
  - `pub fn api::router(state: RelaisState) -> axum::Router` mit `POST /v1/server`,
    `GET /v1/status` (`{ "version": … }`), `POST /v1/senden` (Aufgabe 2).
- Tabelle: `server (id TEXT PRIMARY KEY, geheimnis_hash TEXT NOT NULL, kontakt TEXT, version TEXT
  NOT NULL, erstellt_at TEXT NOT NULL, zuletzt_at TEXT, gesperrt_at TEXT)`.

- [ ] **Step 1: Tests schreiben** in `push-relais/tests/registrierung.rs` (Router mit In-Memory-DB):
  - `registrierung_liefert_zugang_und_speichert_nur_den_hash`: `POST /v1/server` `{ "version":
    "1.0.0" }` → 200, `server_id` und `geheimnis` nicht leer; Tabellenzeile enthält das Geheimnis
    nicht im Klartext.
  - `pruefen_erkennt_gueltig_unbekannt_gesperrt`: nach `sperren` → `Pruefung::Gesperrt`; falsches
    Geheimnis → `Unbekannt`.
  - `registrierungen_sind_je_ip_begrenzt`: 11. `POST /v1/server` derselben IP in einer Stunde → 429.
  - `status_nennt_die_version`.
- [ ] **Step 2:** `cargo test -p push-relais --test registrierung` → FAIL (Crate fehlt).
- [ ] **Step 3:** Crate anlegen. Abhängigkeiten nur aus dem Workspace-Lock: axum 0.8, tokio
  (`full`), clap (`derive`,`env`), serde/serde_json, sqlx 0.9 (`runtime-tokio`,`sqlite`,`migrate`),
  sha2, base64, rand, tracing, tracing-subscriber, anyhow, subtle (für den Vergleich; sonst
  `openssl::memcmp::eq`). Registrierungslimit als In-Memory-Zähler je IP mit Stundenfenster.
- [ ] **Step 4:** Tests grün: `cargo test -p push-relais --test registrierung`.
- [ ] **Step 5: Commit** `feat(push-relais): Crate mit Registrierung und Sperre` (Body mit
  `Zunder: https://zunder.rubeen.dev/#/aufgabe/miszqjsdxggv91mthq9eck6q`).

### Task 2: Senden an APNs

**Files:**
- Create: `push-relais/src/apns.rs`, `push-relais/src/senden.rs`
- Modify: `push-relais/src/api.rs`, `push-relais/Cargo.toml` (reqwest mit `["json","rustls","http2"]`,
  openssl)
- Test: `push-relais/tests/senden.rs` (APNs-Doppel: lokaler axum-Server, `axum::serve` spricht h2c;
  Client mit `http2_prior_knowledge()` nur für `http://`-Basen)

**Interfaces:**
- Consumes: `speicher::pruefen`, `RelaisConfig`.
- Produces (Wire, deutsch):
  - Request `SendenAnfrage { nachrichten: Vec<Nachricht> }`, `Nachricht { token: String, umgebung:
    Umgebung, stufe: Stufe, kollaps: Option<String>, nutzlast: String }`,
    `enum Umgebung { Sandbox, Production }` (`snake_case`), `enum Stufe { Alarm, Hinweis }`.
  - Response `SendenAntwort { ergebnisse: Vec<Ergebnis> }`, `enum Ergebnis { Zugestellt,
    TokenUngueltig, Gedrosselt, Fehler }` (`snake_case`).
  - `pub struct ApnsClient` mit `pub fn neu(cfg: &RelaisConfig) -> anyhow::Result<Self>` und
    `pub async fn senden(&self, n: &Nachricht) -> Ergebnis`.
  - `fn anbieter_token(&self, jetzt: i64) -> String` — ES256-JWT (`alg ES256`, `kid`, `iss` Team,
    `iat`), Signatur roh `r||s` wie `src/web_push/krypto.rs::vapid_kopf`, 50 Minuten im Speicher.
- Fehlerbilder: fehlender/falscher Bearer → 401 `{ "fehler": "unbekannt" }`; gesperrt → 403
  `{ "fehler": "gesperrt" }`; > 100 Nachrichten oder `nutzlast` > 4096 Zeichen → 400; Limit je
  Server überschritten → 429.

- [ ] **Step 1: Tests** in `push-relais/tests/senden.rs`:
  - `alarm_geht_zeitkritisch_mit_rueckfalltitel_an_apple`: Doppel empfängt Pfad
    `/3/device/<token>`, Köpfe `apns-topic: dev.rubeen.lifeline.ios`, `apns-push-type: alert`,
    `apns-priority: 10`, `apns-expiration` ≈ jetzt+43200, `authorization: bearer …`, Rumpf
    `aps.alert.title == "Alarm"`, `aps["interruption-level"] == "time-sensitive"`,
    `aps["mutable-content"] == 1`, `l == nutzlast`.
  - `hinweis_geht_mit_active_und_eigenem_titel`.
  - `kollaps_wird_zu_apns_collapse_id`.
  - `sandbox_geht_an_die_sandbox_basis`.
  - `apple_410_und_bad_device_token_werden_token_ungueltig`, `apple_429_wird_gedrosselt`,
    `apple_500_wird_fehler`.
  - `ohne_bearer_401_gesperrt_403`, `mehr_als_100_nachrichten_400`, `limit_je_server_429`.
  - `log_enthaelt_weder_token_noch_nutzlast` (tracing-Subscriber mit Puffer).
- [ ] **Step 2:** `cargo test -p push-relais --test senden` → FAIL.
- [ ] **Step 3:** `ApnsClient` und Handler bauen; Nachrichten eines Aufrufs nacheinander oder mit
  kleiner Nebenläufigkeit (≤ 8) senden, Reihenfolge der Ergebnisse = Reihenfolge der Eingabe.
  `zuletzt_at` je Aufruf setzen. Log: Server-ID, Anzahl, Zählung je Ergebnis.
- [ ] **Step 4:** Tests grün.
- [ ] **Step 5: Commit** `feat(push-relais): Versand an APNs über HTTP/2`.

### Task 3: Auslieferung, Regeln, Betriebsdoku des Relais

**Files:**
- Create: `push-relais/Dockerfile` (wie `karten-service/Dockerfile`, aber Basis distroless/cc wie
  das Hauptimage, `EXPOSE 8089`, `ENTRYPOINT ["/usr/local/bin/push-relais"]`, `CMD ["serve"]`),
  `push-relais/AGENTS.md`, `docs/betrieb/push-relais.md`
- Modify: `.github/workflows/artefakte.yml` (Schritt „push-relais bauen“ im Job `bauen` neben
  „karten-service bauen“, Job `docker-relais` nach dem Muster `docker-karten`, Tag
  `ghcr.io/${GITHUB_REPOSITORY,,}-push-relais:$VERSION`, `freigeben` braucht ihn und taggt mit),
  `AGENTS.md` (Zeile `push-relais/AGENTS.md` in der Tabelle)

- [ ] **Step 1:** `push-relais/AGENTS.md`: Relais kennt keine Inhalte, loggt nie Token/Nutzlast,
  Wire deutsch und additiv, Sperren nur per Unterbefehl, Tests mit APNs-Doppel statt Apple.
- [ ] **Step 2:** `docs/betrieb/push-relais.md`: Apple-Schlüssel anlegen, Umgebung (alle
  `PUSH_RELAIS_*`), Start per Image, Domain `push.rubeen.dev` hinter TLS-Proxy
  (`PUSH_RELAIS_HINTER_PROXY=true`), Sperren/Entsperren, Sicherung der SQLite-Datei,
  Prüfanleitung Gerätetest (Debug-Build → Sandbox).
- [ ] **Step 3:** Workflow ergänzen; lokal `actionlint` falls vorhanden, sonst YAML-Prüfung im
  Gate (`./scripts/check-all.sh --nur schnell`).
- [ ] **Step 4:** `docker build` nur, wenn Docker im Container läuft; sonst im PR-Text vermerken.
- [ ] **Step 5: Commit** `build(push-relais): Image und Betriebsdoku`.

## LLH-2040 Kanal im Server (`oef7agry`)

### Task 4: Migration, Repo, Verschlüsselung, gemeinsamer Testvektor

**Files:**
- Create: `migrations/0364_ios_push.sql`, `src/ios_push/mod.rs`, `src/ios_push/repo.rs`,
  `src/ios_push/krypto.rs`, `src/ios_push/tests.rs`, `src-tauri/faelle/push-nutzlast.json`
- Modify: `src/lib.rs` (Modul), `src/instanz/spiegel/art.rs` (`AUSGENOMMEN` +
  `("ios_push_anmeldung", "iOS-Anmeldungen hängen an einem Gerät dieser Instanz")`,
  `("ios_push_relais", …)`), `src/instanz/repo.rs` (`KopplungZeile.gegenueber_ios_push`)

**Migration 0363** (Nummer nach `scripts/check-migrationen.sh` anpassen):
```sql
CREATE TABLE ios_push_anmeldung (
    id                 INTEGER PRIMARY KEY,
    kennung            TEXT    NOT NULL UNIQUE,
    benutzer_id        INTEGER NOT NULL REFERENCES benutzer(id) ON DELETE CASCADE,
    session_token_hash TEXT REFERENCES session(token_hash) ON DELETE SET NULL,
    token              TEXT    NOT NULL UNIQUE,
    umgebung           TEXT    NOT NULL CHECK (umgebung IN ('sandbox', 'production')),
    schluessel         TEXT    NOT NULL,
    inhalt             INTEGER NOT NULL DEFAULT 0 CHECK (inhalt IN (0, 1)),
    stumm              TEXT    NOT NULL DEFAULT '[]' CHECK (json_valid(stumm) AND json_type(stumm) = 'array'),
    erstellt_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX idx_ios_push_anmeldung_benutzer ON ios_push_anmeldung(benutzer_id);
CREATE INDEX idx_ios_push_anmeldung_session ON ios_push_anmeldung(session_token_hash);
CREATE TABLE ios_push_relais (
    id          INTEGER PRIMARY KEY CHECK (id = 1),
    server_id   TEXT NOT NULL,
    geheimnis   TEXT NOT NULL,
    gesperrt_at TEXT,
    erstellt_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
ALTER TABLE instanz_kopplung ADD COLUMN gegenueber_ios_push INTEGER NOT NULL DEFAULT 0;
```

**Interfaces:**
- Produces (`src/ios_push/repo.rs`):
  - `#[derive(Debug, Clone, PartialEq, Eq, sqlx::FromRow)] pub struct Anmeldung { pub id: i64,
    pub kennung: String, pub benutzer_id: i64, pub token: String, pub umgebung: String,
    pub schluessel: String, pub inhalt: bool, pub stumm: Json<Vec<String>> }` mit
    `pub fn ist_stumm(&self, art: BenachrichtigungArt) -> bool`.
  - `pub struct Eingabe<'a> { kennung, token, umgebung, schluessel: &'a str, wahl: &web_push::repo::Wahl }`
  - `pub async fn anmelden(pool, benutzer_id: i64, token_hash: &str, e: &Eingabe<'_>) -> Result<(), AppError>`
    (Upsert auf `token`; dieselbe `kennung` mit anderem Token ersetzt ebenfalls).
  - `pub async fn abmelden(pool, benutzer_id: i64, kennung: &str) -> Result<(), AppError>`
  - `pub async fn abmelden_mit_nachweis(pool, kennung: &str, nachweis: &str) -> Result<(), AppError>`
  - `pub async fn anmeldung(pool, benutzer_id: i64, kennung: &str) -> Result<Option<Anmeldung>, AppError>`
  - `pub async fn anmeldungen_von(pool, benutzer_ids: &[i64]) -> Result<Vec<Anmeldung>, AppError>`
  - `pub async fn loeschen_fuer_sitzungen(conn: &mut SqliteConnection, token_hashes: &[String]) -> Result<(), AppError>`
  - `pub async fn loeschen_fuer_benutzer(conn: &mut SqliteConnection, benutzer_id: i64) -> Result<(), AppError>`
  - `pub async fn erloschen(pool, id: i64, token: &str) -> Result<(), AppError>`
  - `pub async fn relais_zugang(pool) -> Result<Option<RelaisZugang>, AppError>`,
    `relais_zugang_speichern(pool, &RelaisZugang)`, `relais_zugang_loeschen(pool)`,
    `relais_gesperrt_setzen(pool)`; `pub struct RelaisZugang { pub server_id: String, pub geheimnis: String, pub gesperrt: bool }`.
- Produces (`src/ios_push/krypto.rs`, OpenSSL):
  - `pub fn verschluesseln(schluessel: &[u8; 32], kennung: &str, klartext: &[u8], nonce: [u8; 12]) -> Result<Vec<u8>, KryptoFehler>` (Chiffrat ‖ 16-Byte-Tag)
  - `pub fn umschlag(kennung: &str, nonce: &[u8; 12], chiffrat: &[u8]) -> String` → base64url von
    kompaktem JSON `{"k":kennung,"n":b64(nonce),"c":b64(chiffrat)}`
  - `pub fn nachweis(schluessel: &[u8; 32], kennung: &str) -> String` = base64url(HMAC-SHA256(schluessel, "abmelden:" + kennung))
- `src-tauri/faelle/push-nutzlast.json`: `{ zweck, faelle: [{ beschreibung, schluessel, kennung,
  nonce, klartext, chiffrat, umschlag, nachweis }] }`, mindestens zwei Fälle (ASCII, Umlaute/Emoji).

- [ ] **Step 1: Tests** in `src/ios_push/tests.rs` (`crate::db::test_pool()`):
  - `anmelden_und_lesen`, `ein_bekanntes_token_ersetzt_die_alte_anmeldung` (Review Focus 1),
    `sitzungsablauf_laesst_die_anmeldung_stehen` (Sitzung löschen → Zeile bleibt,
    `session_token_hash` NULL), `benutzer_loeschen_loescht_per_cascade`,
    `abmelden_mit_falschem_nachweis_aendert_nichts`, `erloschen_nur_bei_gleichem_token`,
    `krypto_folgt_dem_gemeinsamen_testvektor` (liest `push-nutzlast.json` per `include_str!`,
    verschlüsselt mit fester Nonce → `chiffrat`, `umschlag`, `nachweis` gleich).
  - `db::tests::migrationsnummern_sind_eindeutig` bleibt grün.
- [ ] **Step 2:** `cargo test --lib ios_push` → FAIL.
- [ ] **Step 3:** Migration, Repo und Krypto bauen; Testvektor einmal mit dem Code erzeugen und
  einfrieren. `art.rs` und `KopplungZeile` mitziehen.
- [ ] **Step 4:** `cargo test --lib ios_push` und `cargo test --lib art::tests` grün;
  `scripts/check-migrationen.sh` grün.
- [ ] **Step 5: Commit** `feat(ios-push): Anmeldungen, Verschlüsselung und Testvektor`
  (`Zunder: …/aufgabe/oef7agryqhghli646wuyrbs4`).

### Task 5: Konfiguration, ausgehender Zweck, Relais-Client

**Files:**
- Modify: `src/config.rs` (neben L536-549), `src/ausgehend.rs` (`Zweck::IosPush`, `name()`, Test
  `jede_kennung_ist_ein_gueltiger_header`), `src/live/mod.rs` (`ios_push: Arc<OnceLock<IosPush>>`,
  `ios_push_einrichten`, `ios_push()`), `src/main.rs` (neben L228-236), `src/ios_push/mod.rs`,
  `Cargo.toml` (reqwest + `"http2"`), `docs/betrieb/env-registry.md`
- Test: `src/ios_push/tests.rs`, `src/config.rs` (Test neben L1119)

**Interfaces:**
- Config: `#[arg(long, env = "LIFELINE_IOS_PUSH", default_value_t = false)] pub ios_push: bool`,
  `#[arg(long, env = "LIFELINE_IOS_PUSH_RELAIS", default_value = "https://push.rubeen.dev")] pub ios_push_relais: String`,
  `pub fn ios_push_relais(&self) -> anyhow::Result<Option<Url>>` (None ohne Schalter; nur `https`
  außer in Tests).
- `#[derive(Clone)] pub struct IosPush { inner: Arc<Inner> }` mit
  `pub fn einrichten(pool: SqlitePool, relais: Url, kontakt: Option<String>) -> anyhow::Result<Self>`,
  `pub fn einrichten_fuer_test(pool: SqlitePool, relais: Url) -> anyhow::Result<Self>` (erlaubt `http`).
- Relais-Client (privat in `mod.rs`): `async fn zugang(&self) -> Result<Option<RelaisZugang>, …>`
  (registriert beim ersten Bedarf, `POST /v1/server` `{ kontakt, version }`; gesperrt → None),
  `async fn senden(&self, nachrichten: &[RelaisNachricht]) -> Result<Vec<RelaisErgebnis>, RelaisFehler>`;
  401 → Zugang löschen, einmal neu registrieren und wiederholen; 403 `gesperrt` →
  `relais_gesperrt_setzen` + `tracing::warn!`, keine Neuregistrierung. Wire-Typen gespiegelt zu
  Aufgabe 2 (eigene Structs im Server, keine Abhängigkeit auf die Relais-Crate).

- [ ] **Step 1: Tests:** `ios_push_vorgabe_aus_und_relais_standard` (config);
  `ohne_bedarf_kein_kontakt_zum_relais` (einrichten ohne Versand → Relais-Doppel sieht nichts);
  `erster_versand_registriert_einmal`; `unbekannt_401_fuehrt_zu_neuer_registrierung`;
  `gesperrt_403_merkt_sperre_und_registriert_nicht_neu`. Relais-Doppel als lokaler axum-Server wie
  `push_dienst` in `tests/web_push.rs`.
- [ ] **Step 2:** `cargo test --lib ios_push config::tests::ios_push` → FAIL.
- [ ] **Step 3:** Umsetzen; Client über `ausgehend::client_builder(Zweck::IosPush)`, Zeitlimit 10 s,
  Verbindung 5 s, keine Weiterleitung, `https_only` außer Test. `env-registry.md` um beide Variablen.
- [ ] **Step 4:** grün, dazu `cargo test --test ausgehend_kennung_guard`.
- [ ] **Step 5: Commit** `feat(ios-push): Schalter und Relais-Client`.

### Task 6: Routen, Typ-Codegen, Lebensdauer

**Files:**
- Create: `src/routes/ios_push.rs`, `tests/ios_push.rs`
- Modify: `src/routes/mod.rs`, `src/app.rs` (neben L326-331), `src/api_doc.rs`,
  `src/routes/auth.rs` (`logout` L442), `src/auth/session.rs` (`beenden` L232),
  `src/routes/benutzer.rs` (`deaktivieren` L291), generiert: `frontend/src/api/openapi.json`,
  `frontend/src/api/types.generated.ts`, `frontend/src/api/types.ts` (Re-Export)

**Interfaces:**
- `GET /api/ios-push?kennung=<uuid>` → `IosPushStand { eingeschaltet: bool, angemeldet: bool,
  inhalt: bool, stumm: Vec<BenachrichtigungArt>, ueber_hub: Option<PushUeberHub>,
  relais_gesperrt: bool }` (`ToSchema`). Ohne `--ios-push` 404.
- `PUT /api/ios-push/anmeldung` Body `IosPushAnmeldung { kennung, token, umgebung, schluessel,
  #[serde(default)] inhalt, #[serde(default)] stumm: Vec<String> }` → 204; 400 bei Format
  (kennung UUID, token 64–200 Hex, schluessel base64url = 32 Byte, umgebung aus der Liste,
  stumm ≤ `STUMM_MAX`); 422 bei Push über den Hub (`push_hub_fuer` mit Kanal iOS, Aufgabe 7).
- `DELETE /api/ios-push/anmeldung` Body `{ kennung }` → 204 idempotent.
- `POST /api/ios-push/abmelden` (ohne `CurrentUser`, im Router außerhalb der Anmeldepflicht wie
  andere öffentliche Routen) Body `{ kennung, nachweis }` → immer 204.
- Bodies nur über `crate::extract::JsonBody`, Query über den vorhandenen Query-Extraktor.
- Lebensdauer: `logout` löscht vor `session::loeschen` die Anmeldungen der Sitzung
  (`loeschen_fuer_sitzungen`); `session::beenden` löscht in derselben Transaktion die Anmeldungen
  der beendeten Sitzungen und bei `Auswahl::AlleAusser(None)` alle des Benutzers
  (`loeschen_fuer_benutzer`); `deaktivieren` löscht alle des Benutzers.

- [ ] **Step 1: Tests** in `tests/ios_push.rs` (Helfer aus `tests/common`):
  `ohne_schalter_404`, `geraetekonto_403`, `anmelden_stand_abmelden`,
  `validierung_400_je_feld`, `abmelden_ohne_sitzung_immer_204_und_nur_mit_nachweis_wirksam`,
  `logout_loescht_die_anmeldung_dieser_sitzung`,
  `sitzungen_beenden_alle_loescht_alle_anmeldungen`,
  `eine_sitzung_beenden_loescht_nur_deren_anmeldung`,
  `deaktivieren_loescht_die_anmeldungen` (Review Focus 5),
  `ablauf_der_sitzung_laesst_anmeldung_und_versand_bestehen`.
- [ ] **Step 2:** `cargo test --test ios_push` → FAIL.
- [ ] **Step 3:** Routen und Hooks bauen; DTOs in `api_doc.rs` registrieren.
- [ ] **Step 4:** `cargo test --test ios_push`, `cargo test --test json_extractor_guard`,
  `cargo test --test path_extractor_guard`, `scripts/check-typ-codegen.sh` grün; generierte Dateien
  mitcommitten.
- [ ] **Step 5: Commit** `feat(ios-push): Routen und Lebensdauer der Anmeldung`.

### Task 7: Versand in `ausliefern`, Inhalt mit Leserecht, Kopplung je Kanal

**Files:**
- Create: `src/ios_push/inhalt.rs`
- Modify: `src/ios_push/mod.rs`, `src/benachrichtigung/mod.rs` (`ausliefern` L583, `melden` L453),
  `src/instanz/spiegel/hinweis.rs` (L133-198), `src/instanz/melden.rs` (`MeldenAntwort` L172,
  `handle_meldung` L1284, Speichern L901), `src/instanz/repo.rs` (`save_faehigkeiten` L633),
  `src/routes/instanz.rs` (L825-835), `src/routes/web_push.rs` (Kanal-Parameter bei `ueber_hub`)
- Test: `src/ios_push/tests.rs`, `tests/ios_push.rs`, `tests/instanz_hinweise.rs`

**Interfaces:**
- `pub struct IosSendung { pub benutzer_id: i64, pub ereignis: BenachrichtigungEreignis, pub alarm: bool }`
- `impl IosPush { pub fn versenden(&self, sendungen: Vec<IosSendung>) -> tokio::task::JoinHandle<()> }`
  — lädt `anmeldungen_von`, filtert `alarm || !ist_stumm(art)`, baut je Anmeldung den Klartext,
  verschlüsselt, bündelt je 100, `TokenUngueltig` → `erloschen`.
- `inhalt.rs`: `pub struct Klartext { v: u8, s: String, e: i64, b: i64, stufe, titel, detail: Option<String>, pfad, absender: Option<String>, wortlaut: Option<String> }` (Serde-Feldnamen wie im Design);
  `pub async fn klartext(pool, benutzer: &Benutzer, ereignis: &BenachrichtigungEreignis, mit_inhalt: bool) -> Result<Klartext, AppError>`
  — Titel/Detail/Pfad über `text::bilden_mit_einheit` wie `routes::benachrichtigung::anzeige`;
  Absender/Wortlaut nur bei `mit_inhalt` und Bezug Meldung und wenn der Benutzer lesen darf:
  `EinsatzKontext` so bauen wie der Extraktor (`src/einsatz/kontext.rs` L189ff), dann
  `fordere_lesezugriff()` und `fordere_modul_zugriff::<Meldungen>()`, Daten über
  `meldung::repo::laden_im_einsatz` mit demselben `erfasst_von`-Filter wie `routes::meldung::detail`.
  `s` = `crate::instanz::name()`.
  `pub fn kuerzen(k: &mut Klartext, max_bytes: usize)` kürzt `wortlaut` (dann `detail`) an einer
  `char`-Grenze mit „…“, bis `serde_json::to_vec(k).len() + 16 ≤ max_bytes`.
- `kollaps` = erste 32 Hex-Zeichen von `sha256(server_id + ":" + benachrichtigung_id)`.
- `ausliefern(…, ueber_hub: &UeberHub)` mit `pub struct UeberHub { pub web_push: HashSet<i64>, pub ios_push: HashSet<i64> }`.
- Kopplung: `pub struct Ziel { pub kopplung_org_id: i64, pub web_push: bool, pub ios_push: bool }`;
  `pub enum Kanal { WebPush, IosPush }`; `pub fn pusht_ueber_hub(ziele: &[Ziel], kanal: Kanal) -> bool`;
  `pub async fn push_hub_fuer(conn, benutzer_id, kanal: Kanal) -> …`; `MeldenAntwort.ios_push: bool`
  mit `#[serde(default)]`; `handle_meldung(…, web_push: bool, ios_push: bool)`;
  `save_faehigkeiten(conn, id, hinweise, web_push, ios_push, rolle_mitarbeit)`.

- [ ] **Step 1: Tests:**
  - `alarm_kommt_trotz_stumm_hinweis_nicht`, `still_erreicht_kein_geraet`,
  - `nutzlast_entschluesselt_ergibt_titel_detail_pfad_wie_die_anzeige` (Vergleich mit
    `GET /api/benachrichtigungen/{id}`),
  - `mit_inhalt_kommen_absender_und_wortlaut`,
    `ohne_leserecht_fehlen_absender_und_wortlaut` (Review Focus 5),
  - `langer_wortlaut_wird_an_zeichengrenze_gekuerzt` (10 000 × „ä🚑“, Umschlag ≤ 4096, Klartext
    gültiges UTF-8; Review Focus 2),
  - `token_ungueltig_loescht_die_anmeldung`,
  - `haengendes_relais_haelt_melden_nicht_auf` (`melden` < 200 ms; Review Focus 3),
  - `kollaps_verraet_keine_ids`,
  - in `tests/instanz_hinweise.rs`: `elw_ueberspringt_hub_konten_nur_im_kanal_den_der_hub_kann`
    (Hub mit Web Push ohne iOS → ELW pusht iOS selbst; Hub mit iOS ohne Web Push → umgekehrt),
    `elw_lehnt_ios_anmeldung_fuer_hub_konto_mit_422_ab_wenn_der_hub_ios_kann`.
- [ ] **Step 2:** `cargo test --lib ios_push` und `cargo test --test ios_push --test instanz_hinweise --test web_push` → neue FAIL, alte grün.
- [ ] **Step 3:** Umsetzen. Web Push bleibt im Verhalten gleich (bestehende Tests unverändert grün).
- [ ] **Step 4:** grün, dazu `scripts/check-typ-codegen.sh` (falls `MeldenAntwort` im Schema).
- [ ] **Step 5: Commit** `feat(ios-push): Versand neben Web Push, Kopplung je Kanal`.

## LLH-2041 iOS-App (`fxj859xf`)

### Task 8: Kern — Brückenbefehle, Anmeldungen, Nutzlast lesen; `huelle.js`

**Files:**
- Create: `ios/LifelineKern/Sources/LifelineKern/PushNutzlast.swift`,
  `ios/LifelineKern/Sources/LifelineKern/PushAnmeldungen.swift`,
  `ios/LifelineKern/Tests/LifelineKernTests/PushNutzlastTests.swift`,
  `ios/LifelineKern/Tests/LifelineKernTests/PushAnmeldungenTests.swift`
- Modify: `Brueckenbefehl.swift` (Fälle, `parse`, `Huellendienste`, `Brueckenausfuehrung.run`),
  `BrueckenbefehlTests.swift` (Attrappe `Dienste`), `ios/AppTests/WebviewTests.swift` (`Attrappe`),
  `ios/App/Huelle/huelle.js` (Kopf + Kennung), `frontend/src/huelle/iosHuelle.test.ts`

**Interfaces:**
- `Antwortwert` bekommt `case objekt([String: String])` (JSON-Objekt im Reply-Skript).
- `Brueckenbefehl`: `case pushRegister(id: Int)`, `case pushUnregister(id: Int)`,
  `case pushState(id: Int)`; Wire `push_register`, `push_unregister`, `push_state`.
- `Huellendienste` neu: `func registerPush() async throws -> PushRegistrierung`,
  `func unregisterPush() async throws`, `func pushState() async -> (Meldungsfreigabe, kennung: String?)`.
  `public struct PushRegistrierung: Equatable, Sendable { kennung, token, umgebung, schluessel: String }`.
  Antwort von `push_register`: `{ registration_id, token, environment, key }`; Fehler `denied` /
  `unavailable`. `push_state`: `{ permission: granted|denied|undetermined, registration_id? }`.
- `PushAnmeldungen` (Codable, persistiert über eine Ablage wie `Serverablage`, Datei
  `push.json`): `mutating func kennung(fuer server: UUID) -> String` (erzeugt einmalig UUID),
  `func server(zu kennung: String) -> UUID?`, `mutating func entfernen(server: UUID) -> [String]`.
- `PushNutzlast`: `static func umschlag(_ l: String) -> Umschlag?` (`Umschlag { kennung: String, nonce: Data, chiffrat: Data }`),
  `static func meldung(aus klartext: Data, serverAnzahl: Int) -> PushMeldung?`
  (`PushMeldung { titel, untertitel: String?, text: String?, thread, pfad, einsatzId: Int }`;
  Titel bei Absender „‹titel› · ‹absender›“ wie `pushInhalt` in `alarm-sw.js`; Text = Wortlaut
  sonst Detail; Untertitel = `s` nur bei `serverAnzahl > 1`; Thread = „‹kennung›-‹e›“).
  Die Entschlüsselung selbst lebt nicht im Kern (kein CryptoKit unter Linux, Aufgabe 10).
- `huelle.js`: Kennung um `push: true`, `pushRegister: () => frage('push_register', {})`,
  `pushUnregister`, `pushState`; Kopfkommentar um die drei Befehle.

- [ ] **Step 1: Tests:** Swift: `testParseKenntDiePushBefehle`,
  `testPushRegisterLiefertKennungTokenUmgebungSchluessel`, `testPushRegisterVerweigertMeldetDenied`,
  `testKennungIstJeServerStabil`, `testEntfernenLiefertDieKennungenDesServers`,
  `testUmschlagLiestKennungNonceChiffrat` (aus `push-nutzlast.json` via `GemeinsameFaelle`),
  `testMeldungTraegtAbsenderImTitel`, `testUntertitelNurBeiMehrerenServern`,
  `testKaputterKlartextGibtNil`. Vitest in `iosHuelle.test.ts`: `push_register` sendet
  `{ cmd: 'push_register', id }` und löst mit dem Reply auf; „setzt die Kennung vollständig“ um die
  neuen Felder erweitern.
- [ ] **Step 2:** Vitest: `mise exec -- pnpm -C frontend exec vitest run src/huelle/iosHuelle.test.ts`
  → FAIL. Swift-Tests laufen erst in `ios-pruefung.yml`.
- [ ] **Step 3:** Umsetzen.
- [ ] **Step 4:** Vitest grün; Swift-Tests am PR.
- [ ] **Step 5: Commit** `feat(ios): Push-Befehle der Brücke und Nutzlast im Kern`
  (`Zunder: …/aufgabe/fxj859xfsx1i4p1ujypx4u73`).

### Task 9: Kern — Tippen auf eine Meldung öffnet Server und Pfad

**Files:**
- Modify: `ios/LifelineKern/Sources/LifelineKern/Ablauf.swift`, `Linkregeln.swift`
  (Hilfsfunktion), `src-tauri/faelle/deeplink.json` (neuer Abschnitt `push_pfad`),
  `ios/LifelineKern/Tests/LifelineKernTests/AblaufTests.swift`, `LinkregelnTests.swift`,
  `src-tauri/src/deeplink.rs` (liest den neuen Abschnitt nur, wenn die Desktop-Hülle ihn nutzt;
  sonst Rust-Test ignoriert den Abschnitt ausdrücklich)

**Interfaces:**
- `Ablauf.Event.meldungAngetippt(ServerEintrag?, pfad: String?)` — der App-Teil löst die Kennung
  über `PushAnmeldungen.server(zu:)` und `Serverliste` zum Eintrag auf.
- `Ablauf.Effect.ladePfad(ServerEintrag, String)`; `Ablauf.next`:
  - Eintrag nil → keine Änderung.
  - Eintrag = aktiv und Seite `.web` → `[.ladePfad(e, sicher)]`.
  - Eintrag ≠ aktiv → `.pruefung(e)` mit `[.check(e)]` und gemerktem Pfad; nach
    `.ergebnis(kompatibel)` statt `.load` → `.ladePfad(e, pfad)`. Der Pfad wird im Zustand
    `Seite.pruefung` mitgeführt (`case pruefung(ServerEintrag, pfad: String? = nil)`).
- `Linkregeln.sichererPfad(_ pfad: String?, server: URL) -> String` — `/` außer der Pfad beginnt mit
  genau einem `/`, enthält kein Schema/Host und `belongsToServer` stimmt.

- [ ] **Step 1: Tests:** `testTippenAufAktivenServerLaedtDenPfad`,
  `testTippenAufAnderenServerWechseltSichtbarUndLaedtDanachDenPfad`,
  `testUnbekannteKennungAendertNichts`, `testFremderPfadOeffnetDieStartseite` (Fälle aus
  `deeplink.json` → `push_pfad`: `https://evil.example/x`, `//evil.example`, `javascript:…`,
  `/einsaetze/7` ok; Review Focus 4).
- [ ] **Step 2–4:** Umsetzen; `cargo test -p lifeline-desktop` grün (JSON-Format bleibt lesbar);
  Swift am PR.
- [ ] **Step 5: Commit** `feat(ios): Tippen auf eine Meldung öffnet Server und Pfad`.

### Task 10: App — Capabilities, Extension, Token, Entschlüsseln, Abmelden

**Files:**
- Create: `ios/App/LifelineHub.entitlements`, `ios/Benachrichtigungsdienst/Dienst.swift`,
  `ios/Benachrichtigungsdienst/Info.plist` (generiert über `project.yml`),
  `ios/Benachrichtigungsdienst/Benachrichtigungsdienst.entitlements`,
  `ios/Gemeinsam/Schluesselbund.swift`, `ios/Gemeinsam/Entschluesseler.swift`,
  `ios/AppTests/EntschluesselerTests.swift`
- Modify: `ios/project.yml`, `ios/App/LifelineHubApp.swift`, `ios/App/Systemdienste.swift`,
  `ios/App/AppModell.swift`, `ios/AppTests/InfoPlistTests.swift`, `scripts/ios/testflight.sh`
  (nur falls das zweite Target eigene Export-Angaben braucht)

**Festlegungen:**
- `project.yml`: App-Target `CODE_SIGN_ENTITLEMENTS: App/LifelineHub.entitlements`, Abhängigkeit
  auf Target `Benachrichtigungsdienst` (`type: app-extension`, Bundle
  `dev.rubeen.lifeline.ios.benachrichtigung`, `NSExtension.NSExtensionPointIdentifier =
  com.apple.usernotifications.service`, Klasse `$(PRODUCT_MODULE_NAME).Dienst`); `ios/Gemeinsam/`
  in beiden Targets.
- Entitlements App: `aps-environment` = `$(APS_UMGEBUNG)` mit Debug `development`, Release
  `production`; `com.apple.developer.usernotifications.time-sensitive = true`;
  `com.apple.security.application-groups = [group.dev.rubeen.lifeline.ios]`;
  `keychain-access-groups = [$(AppIdentifierPrefix)dev.rubeen.lifeline.ios.gemeinsam]`. Extension:
  App Group und Keychain-Group.
- `Schluesselbund`: `speichern(kennung:schluessel:)`, `lesen(kennung:) -> Data?`,
  `loeschen(kennung:)`, Accessibility `kSecAttrAccessibleAfterFirstUnlock`, Access-Group wie oben.
- `Entschluesseler.oeffnen(_ u: Umschlag, schluessel: Data) -> Data?` mit CryptoKit
  `AES.GCM.SealedBox(nonce:ciphertext:tag:)`, AAD = Kennung.
- `LifelineHubApp`: `@UIApplicationDelegateAdaptor(AppDelegat.self)`; `AppDelegat` reicht
  `didRegisterForRemoteNotificationsWithDeviceToken` / `didFail…` an `Systemdienste` weiter
  (wartende Continuation). `Meldungsdelegat.didReceive` → `AppModell.meldungAngetippt(kennung:pfad:)`;
  `willPresent` für Remote-Meldungen des aktiven Servers → `[]`, sonst `[.banner, .list, .sound]`.
- `Systemdienste.registerPush`: Freigabe mit `[.alert, .sound, .badge]` (zeitkritisch trägt die
  Capability, keine eigene Option), `registerForRemoteNotifications()`, Token hex, Umgebung aus `#if DEBUG` (`sandbox`/`production`),
  Kennung aus `PushAnmeldungen`, Schlüssel 32 Byte `SymmetricKey` einmalig je Kennung im
  Schlüsselbund.
- `AppModell`: nach jeder Änderung der Serverliste `UserDefaults(suiteName: "group.dev.rubeen.lifeline.ios")`
  `"serverAnzahl"` setzen; beim Entfernen eines Servers für jede Kennung einmal
  `POST <server>/api/ios-push/abmelden` `{ kennung, nachweis }` per `URLSession` (ohne Wiederholen),
  dann Schlüssel löschen.
- `Dienst` (Extension): `didReceive(_:withContentHandler:)` → `l` lesen, Schlüssel holen,
  entschlüsseln, `PushNutzlast.meldung`, Inhalt setzen (`title`, `subtitle`, `body`,
  `threadIdentifier`, `userInfo["kennung"]`, `userInfo["pfad"]`); bei jedem Fehler bleibt der
  Rückfalltitel und `body` = „Öffnen, um die Meldung zu sehen“. `serviceExtensionTimeWillExpire`
  liefert denselben Rückfall.

- [ ] **Step 1: Tests:** `EntschluesselerTests.testGemeinsamerTestvektor` (liest
  `src-tauri/faelle/push-nutzlast.json` aus dem Repo-Pfad wie `GemeinsameFaelle`),
  `InfoPlistTests` um `NSExtension` der Extension und die Entitlements-Schlüssel.
- [ ] **Step 2–4:** Umsetzen; Beleg ist `ios-pruefung.yml` (Simulator baut beide Targets mit
  `CODE_SIGNING_ALLOWED=NO`, Tests grün).
- [ ] **Step 5: Commit** `feat(ios): Push-Berechtigung, Extension und Entschlüsselung`.

## LLH-2042 Frontend und Doku (`zevf9a3p`)

### Task 11: Frontend — Push-Schalter in der iOS-App

**Files:**
- Create: `frontend/src/api/iosPush.ts`, `frontend/src/alarm/iosPush.ts`,
  `frontend/src/alarm/pushKanal.ts`, `frontend/src/alarm/iosPush.test.ts`
- Modify: `frontend/src/huelle/faehigkeiten.ts`, `frontend/src/pages/BenachrichtigungenPage.tsx`
  (`PushSchalter` L117-205), `frontend/src/auth/AuthContext.tsx` (L177, L322),
  `frontend/src/alarm/EingaengeKnopf.tsx` (L173), `frontend/src/huelle/iosStart.test.tsx`
  (L72-80, L113)

**Interfaces:**
- `faehigkeiten.ts`: `export type HuellePush = { register(): Promise<{ registration_id: string; token: string; environment: 'sandbox' | 'production'; key: string }>; unregister(): Promise<void>; state(): Promise<{ permission: 'granted' | 'denied' | 'undetermined'; registration_id?: string }> }`;
  `export function huellePush(): HuellePush | null` (nur wenn `push === true` und alle drei
  Funktionen da sind).
- `api/iosPush.ts`: `ladeIosPushStand(kennung?: string)`, `meldeIosPushAn(e: IosPushAnmeldungEingabe)`,
  `meldeIosPushAb(kennung: string)`; Typen `IosPushStand` aus `types.ts`.
- `alarm/pushKanal.ts`: `export type PushKanal = { ladeStand(): Promise<PushStand>; einschalten(benutzerId: number): Promise<PushZustand>; ausschalten(benutzerId: number): Promise<PushZustand>; inhaltSetzen(benutzerId: number, an: boolean): Promise<boolean>; abgleichen(benutzerId: number, o?: { nurBeiBedarf?: boolean }): Promise<void> }`;
  `export function pushKanal(): PushKanal` — iOS-Push, wenn `huellePush()` da ist, sonst Web Push
  (bestehende Funktionen aus `webPush.ts`, unverändert).
- `alarm/iosPush.ts` implementiert `PushKanal`; `blockiert` bei `permission === 'denied'`;
  `relais_gesperrt` → Zustand `'fehlt'` mit Hinweis „Der Push-Dienst nimmt diesen Server nicht an.
  Bitte den Betreiber informieren.“ (Feld `hinweis?: string` in `PushStand`).
- `PushSchalter` und die drei Aufrufer nutzen `pushKanal()` statt der Web-Push-Funktionen direkt.

- [ ] **Step 1: Tests:** `iosPush.test.ts`: `einschalten_meldet_token_und_schluessel_mit_inhalt_und_stumm`,
  `verweigerte_berechtigung_ergibt_blockiert`, `abgleichen_meldet_geaendertes_token_neu`,
  `ueber_hub_zeigt_den_hub`, `gesperrtes_relais_zeigt_den_hinweis`. `iosStart.test.tsx`:
  ohne `push` in der Kennung bleibt alles still (bisheriger Test), mit `push: true` und Server
  `eingeschaltet` erscheint der Schalter `PUSH_SCHALTER`. Desktop-Hülle: Schalter weiterhin weg.
- [ ] **Step 2:** `mise exec -- pnpm -C frontend exec vitest run src/alarm src/huelle src/pages/BenachrichtigungenPage` → FAIL.
- [ ] **Step 3:** Umsetzen.
- [ ] **Step 4:** Vitest grün, `mise exec -- pnpm -C frontend run typecheck`, Lint und Prettier
  über das Gate.
- [ ] **Step 5: Commit** `feat(frontend): Push-Schalter in der iOS-App`
  (`Zunder: …/aufgabe/zevf9a3pw5huu6hnr0pcyrnu`).

### Task 12: Regeln, Architektur, Betriebs- und Anwenderdoku

**Files:**
- Create: `docs/architektur/entscheidungen/ADR-0084-ios-push-laeuft-ueber-ein-relais-mit-ende-zu-ende-verschluesselter-nutzlast.md`
- Modify: `src/AGENTS.md` (Abschnitt „iOS-Push“, Kopf-Tabelle), `ios/AGENTS.md` (Push-Befehle,
  Extension dünn, einzige native Netzanfrage), `AGENTS.md` (Tabelle: `src/AGENTS.md`-Inhalt um
  „iOS-Push“), `docs/architektur/` Kap. 3 (externer Dienst Push-Relais/APNs, Diagramm, Tabelle),
  Kap. 5 (Baustein `push-relais`), Kap. 6 (Ablauf Anmeldung → Versand → Tippen), Kap. 7
  (Image, Port 8089), Kap. 8 falls Konzept „Push“ dort steht, Kap. 11 (R45 umschreiben, neues
  Risiko „Relais ist ein Einzeldienst“), Kap. 12 (Begriffe Relais, Kennung);
  `docs/betrieb/ios-app.md` („Grenzen“ → Abschnitt „Meldungen im Hintergrund“),
  `docs/betrieb/web-push.md` (Verweis auf iOS-Push), `docs/anwender/kapitel/einsatz-oberflaeche.md`
  („Benachrichtigungen bei geschlossener App“ L280-313: iOS-App jetzt mit Schalter)

- [ ] **Step 1:** ADR nach `VORLAGE.md` mit Regeln (MUST: Schlüssel nur im Relais; Nutzlast nur
  verschlüsselt; kein Token im Log; Anmeldung an Konto + Gerät) und Prüfung
  (`verbiete 'tracing::.*token' src/ios_push push-relais/src` o. ä., sonst `manuell:`).
- [ ] **Step 2:** Bereichsdateien und Doku nach den Festlegungen des Design-Docs.
- [ ] **Step 3:** `scripts/check-adr-nummern.sh`, `scripts/adr-fuer.sh src/ios_push/mod.rs`
  (nennt ADR-0084), Anwenderdoku-Wächter
  `mise exec -- pnpm -C frontend exec vitest run src/hilfe/anwenderdoku.guard.test.ts`, Wächter der
  Architekturkapitel aus `check-all.sh --nur schnell`.
- [ ] **Step 4: Commit** `docs: iOS-Push in Regeln, Architektur und Doku`.

## Abschluss

### Task 13: Gates, Apple-Einrichtung, Gerätetest, PR

- [ ] **Step 1:** `./scripts/check-all.sh --geaendert --ohne-e2e` in einem Aufruf (im Hintergrund,
  falls nötig) → grün.
- [ ] **Step 2:** Review nach Ermessen: Anlass ist gegeben (Eingaben von außen, Sitzung,
  Live-Verteilung, > 600 Zeilen, Backend + Frontend mit neuer Schnittstelle) → zwei Review-Agenten
  getrennt nach Backend/Relais und iOS/Frontend mit `references/review-pruefliste.md`; Befunde
  abarbeiten.
- [ ] **Step 3:** Bilder der Änderung: Benachrichtigungsseite in der iOS-Hülle (Wegwerf-Spec
  `frontend/e2e/doku-bilder/zz-mbbk7iwo.bilder.ts` mit `starteIosHuelle`-Attrappe, Zustände aus,
  an, blockiert); Sperrbildschirm-Bild aus dem Gerätetest (Step 6).
- [ ] **Step 4:** Branch pushen, PR gegen `alpha` öffnen (Design-Doc, Plan, Umsetzung); Status
  `review`, `pr_url` an Parent und Subtasks. **Kein Auto-Merge.**
- [ ] **Step 5: Apple-Einrichtung per Browser** auf `r-mac` (Remote Control, Ruben meldet sich an):
  App-IDs, Capabilities, App Group, `.p8` anlegen; `.p8` auf `r-server` übertragen ohne Ausgabe,
  Kopie im Download-Ordner löschen; Key-ID und Team-ID an Ruben.
- [ ] **Step 6:** Ruben deployt das Relais und testet mit Debug-Build (Sandbox); Akzeptanz 1–6 des
  Design-Docs abhaken.
- [ ] **Step 7:** Merge nach Rubens Freigabe; danach `done` für Parent und Subtasks,
  `release_task`, Abschlussmeldung.
