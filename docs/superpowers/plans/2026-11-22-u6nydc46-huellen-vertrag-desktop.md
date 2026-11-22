# Hüllen-Vertrag in der Desktop-Hülle — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die Desktop-Hülle lädt einen Server nur, wenn sie seinen `shell_contract` aus `GET /api/shell` kennt, zeigt sonst „nicht verträglich“, und meldet `platform`/`version` in der Kennung; die Rückmeldung nennt die Plattform.

**Architecture:** Eine reine Bewertung und ein `reqwest`-Abruf in `src-tauri/src/vertrag.rs`; ein gemeinsamer Ladeweg `pruefe_und_lade` in `main.rs` für Start, Maske, Deeplink und „Erneut versuchen“; eine neue lokale Seite `nicht-vertraeglich.html` und eine Startseite `verbinde.html`; der zuletzt bestätigte Vertrag je Server in `verbindung.json`. Neue ADR ersetzt ADR-0009.

**Tech Stack:** Rust (Tauri 2.12, reqwest 0.13 mit rustls + Plattform-Verifier wie der Updater), plain JS für die lokalen Seiten, TypeScript/Vitest im Frontend.

**Spec:** `docs/superpowers/specs/2026-11-22-u6nydc46-huellen-vertrag-desktop-design.md`

## Global Constraints

- Bekannte Verträge der Hülle: `[1]`.
- Zeitlimits des Abrufs: Verbindungsaufbau 1,5 s, ganzer Abruf 5 s.
- Weiterleitungen nur auf derselben Origin; keine Cookies; nur `GET /api/shell` und bei 404 `GET /api/health`.
- `reqwest` nur in `src-tauri/src/vertrag.rs`; kein zweiter rustls-Provider (`ring` wie der Updater, nur installieren, wenn keiner gesetzt ist).
- Kennung: `platform` aus `std::env::consts::OS` (`macos`, `windows`, `linux`), `version` = `env!("CARGO_PKG_VERSION")`.
- Texte der Seite: Überschriften „App aktualisieren“ / „Server ist zu alt für diese App“; Knöpfe „Nach Update suchen“ (nur zu neu), „Erneut prüfen“, „Server wechseln“.
- Maske-Meldungen: „Der Server (Version S) ist zu alt für diese App (Version A).“ bzw. „Der Server (Version S) ist neuer als diese App (Version A). Aktualisieren Sie die App.“ Ohne bekannte Server-Version entfällt „(Version S)“.
- Rückmeldung: `ios` → „iOS-App“, `macos` → „Desktop-App (macOS)“, `windows` → „Desktop-App (Windows)“, sonst in Hülle „Desktop-App“, ohne Hülle „Browser“.
- Bezeichner: Fachbegriffe deutsch, Technik englisch (`AGENTS.md`, LFH-1312). Prosa deutsch.
- Hülle testen: `cargo test -p lifeline-desktop` (getrennt vom Server, `src-tauri/AGENTS.md`).

## Review Focus

1. Gespeicherter, unverträglicher Server + ⌘N: das Nebenfenster darf die Oberfläche nicht laden (Task 5, Test `nebenfenster_eines_unvertraeglichen_servers_zeigt_die_seite`).
2. Server antwortet 200, aber mit HTML (Captive Portal/Proxy): gilt als ohne Verbindung, nicht als „zu alt“ (Task 1, `html_mit_200_gilt_wie_ohne_verbindung`).
3. Weiterleitung von `/api/shell` auf fremde Origin: wird nicht verfolgt, gilt wie ohne Verbindung (Task 1, `fremde_weiterleitung_wird_nicht_verfolgt`).
4. Alte `verbindung.json` ohne `vertraege` bleibt lesbar; Vergessen nimmt den Vertrag mit (Task 2).
5. Maske: ein heute nicht erreichbarer Server lässt sich weiter eintragen (Task 5, `maske_speichert_nicht_erreichbaren_server`, als reine Entscheidung `speichern_nach_pruefung`).

---

### Task 1: Vertragsprüfung `vertrag.rs` und neue ADR

**Files:**
- Create: `src-tauri/src/vertrag.rs`
- Modify: `src-tauri/Cargo.toml` (Abhängigkeit `reqwest`), `src-tauri/src/main.rs` (`mod vertrag;`)
- Create: `docs/architektur/entscheidungen/ADR-0083-die-desktop-huelle-prueft-den-huellen-vertrag-und-holt-sonst-nichts-vom-server.md` (Nummer per `scripts/adr-fuer.sh --alle` und `scripts/check-adr-nummern.sh` bestätigen)
- Modify: `docs/architektur/entscheidungen/ADR-0009-desktop-huelle-tauri-ohne-anwendungslogik.md` (`status: ersetzt`, `ersetzt_durch` nach `docs/architektur/AGENTS.md`)

**Interfaces:**
- Produces:
  - `pub const BEKANNTE_VERTRAEGE: [u32; 1] = [1];`
  - `pub struct ShellInfo { pub version: String, pub shell_contract: u32 }` (Deserialize, Clone, Debug, PartialEq, Serialize)
  - `pub enum Richtung { ZuAlt, ZuNeu }` (Clone, Copy, Debug, PartialEq, Serialize mit `rename_all = "snake_case"`)
  - `pub enum ShellAbruf { Antwort { status: u16, body: Vec<u8>, content_type: Option<String> }, Fehler }`
  - `pub enum Vertragsergebnis { Vertraeglich(ShellInfo), NichtVertraeglich { richtung: Richtung, server_version: Option<String> }, NichtErreichbar }` (Clone, Debug, PartialEq)
  - `pub fn evaluate(abruf: &ShellAbruf, letzter_vertrag: Option<u32>) -> Vertragsergebnis`
  - `pub fn richtung(vertrag: u32) -> Option<Richtung>`
  - `pub fn endpoint(server: &Url, pfad: &str) -> Url` (Wurzel des Servers + Pfad)
  - `pub fn follows_redirect(von: &Url, nach: &Url) -> bool` (gleiche Origin)
  - `pub async fn check(server: &Url, letzter_vertrag: Option<u32>) -> Vertragsergebnis` (bei `NichtVertraeglich` aus 404 trägt `server_version` die Version aus `/api/health`, falls lesbar)

- [x] **Step 1: Failing tests in `vertrag.rs` (`#[cfg(test)] mod tests`)** — als Satz benannt, gespiegelt aus `ios/LifelineKern/Tests/LifelineKernTests/VertragTests.swift`:
  - `bekannter_vertrag_ist_vertraeglich`: 200, `application/json; charset=utf-8`, `{"version":"1.0.0","shell_contract":1,"neu":true}` → `Vertraeglich(ShellInfo{version:"1.0.0", shell_contract:1})`.
  - `groesserer_vertrag_heisst_app_aktualisieren`: `shell_contract: 2`, Version `"9"` → `NichtVertraeglich{ZuNeu, Some("9")}`.
  - `kleinerer_vertrag_heisst_server_zu_alt`: `richtung(0) == Some(ZuAlt)`; Abruf mit `shell_contract: 0` → `NichtVertraeglich{ZuAlt, Some(..)}`.
  - `json_ohne_lesbaren_vertrag_ist_zu_alt`: `{"version":"1"}` → `NichtVertraeglich{ZuAlt, None}`.
  - `status_404_ist_zu_alt`: → `NichtVertraeglich{ZuAlt, None}`.
  - `html_mit_200_gilt_wie_ohne_verbindung`: 200 `text/html` → `NichtErreichbar`; mit `letzter_vertrag: Some(1)` ebenfalls `NichtErreichbar`.
  - `fehler_ohne_gemerkten_vertrag_ist_nicht_erreichbar`: `Fehler`, `None` → `NichtErreichbar`; 503 → `NichtErreichbar`; 302 → `NichtErreichbar`.
  - `ohne_verbindung_gilt_der_gemerkte_vertrag`: `Fehler`, `Some(2)` → `NichtVertraeglich{ZuNeu, None}`; `Some(1)` → `NichtErreichbar`.
  - `endpunkt_liegt_an_der_wurzel`: `endpoint("https://elw.local:8443/pfad/", "/api/shell") == "https://elw.local:8443/api/shell"`.
  - `fremde_weiterleitung_wird_nicht_verfolgt`: `follows_redirect` true für `https://elw.local:8443/api/shell` → `https://ELW.local:8443/api/shell/`; false für `https://portal.example/login`, `http://elw.local:8443/…`, `https://elw.local:8444/…`.
  - `abruf_folgt_404_zur_health_version` (I/O, `tauri::async_runtime::block_on`): ein `std::net::TcpListener` auf `127.0.0.1:0` in einem Thread beantwortet `/api/shell` mit `404` und `/api/health` mit `200 application/json {"version":"0.9.0"}`; `check(http://127.0.0.1:port/, None)` → `NichtVertraeglich{ZuAlt, Some("0.9.0")}`.
  - `abruf_eines_geschlossenen_ports_ist_nicht_erreichbar`: Port belegen und freigeben (wie `erreichbar.rs`) → `NichtErreichbar`, Dauer < 3 s.

- [x] **Step 2: Run** `cargo test -p lifeline-desktop vertrag::` — Expected: FAIL (Modul/Funktionen fehlen).

- [x] **Step 3: Implement.** `Cargo.toml`: `reqwest = { version = "0.13", default-features = false, features = ["rustls-no-provider", "json"] }` (dieselbe Version wie im Lockfile; vor dem Commit `cargo tree -p lifeline-desktop -i rustls -e features` zeigt weiter nur `ring`). `check`: Client per `reqwest::Client::builder().connect_timeout(1.5 s).timeout(5 s).redirect(Policy::custom(|a| if follows_redirect(erste_url, a.url()) { a.follow() } else { a.stop() }))` (Ausgangs-URL aus `a.previous()[0]`), kein `cookie_store`; vor dem Bau `rustls::crypto::ring::default_provider().install_default()`, falls `CryptoProvider::get_default()` leer ist — dafür `rustls` nur als bereits vorhandene transitive Abhängigkeit direkt aufnehmen (gleiche Version, Feature `ring`). Medientyp-Prüfung wie `ShellAbruf.isJson` in Swift.

- [x] **Step 4: Run** `cargo test -p lifeline-desktop vertrag::` — Expected: PASS.

- [x] **Step 5: ADR.** Neue ADR nach `VORLAGE.md`, `status: akzeptiert`, `datum: 2026-11-22`, `ersetzt: ADR-0009`, `gilt_fuer` wie 0009, `herleitung`: Design-Doc dieses Tasks plus die drei Herleitungen von 0009. Regeln: alle Regeln von 0009 sinngemäß, mit den zwei Lockerungen (einziger eigener Abruf = anonymer Vertragsabruf `GET /api/shell`, bei 404 `GET /api/health`, ohne Cookies; `src-tauri/ui/` enthält Maske, „nicht erreichbar“, „nicht verträglich“ und „Verbinde…“). Prüfung:
  ```sh
  verlange '"frontendDist": "ui"' src-tauri/tauri.conf.json
  verbiete '^(lifeline-hub|karten-katalog|sqlx|rusqlite|axum) *=' src-tauri/Cargo.toml
  verbiete 'reqwest' 'src-tauri/src/**' ':(exclude)src-tauri/src/vertrag.rs'
  verbiete 'cookie_store' src-tauri/src/vertrag.rs
  verbiete '"@tauri-apps/' frontend/package.json
  verlange '^const SERVER_RECHTE' src-tauri/src/main.rs
  verlange '^version\.workspace = true' src-tauri/Cargo.toml
  ```
  ADR-0009: nur Kopf auf `status: ersetzt` (+ Verweisfeld laut `docs/architektur/AGENTS.md`), Text bleibt.

- [x] **Step 6: Verify** `scripts/check-adr.sh` bzw. den ADR-Schritt von `check-all.sh` (`./scripts/check-all.sh --nur adr` oder wie der Skriptkopf ihn nennt) und `scripts/check-adr-nummern.sh` — Expected: grün.

- [x] **Step 7: Commit** `feat(huelle): Vertragsprüfung gegen GET /api/shell in der Desktop-Hülle (LLH-1982)` mit Zunder-Zeile.

### Task 2: Gemerkter Vertrag in `verbindung.rs`

**Files:**
- Modify: `src-tauri/src/verbindung.rs` (Struct `Datei`, neue Funktionen, `vergessen`, `schreiben`)

**Interfaces:**
- Produces:
  - `pub fn letzter_vertrag(konfig_dir: &Path, server: &Url) -> Option<u32>`
  - `pub fn merke_vertrag(konfig_dir: &Path, server: &Url, vertrag: u32) -> io::Result<()>` (nur für bekannte Server; Schlüssel = `server.origin().ascii_serialization()`)
  - `Datei.vertraege: BTreeMap<String, u32>` mit `#[serde(default, skip_serializing_if = "BTreeMap::is_empty")]`

- [x] **Step 1: Failing tests** (im bestehenden Testmodul):
  - `alte_datei_ohne_vertraege_bleibt_lesbar`: Datei `{"server":"https://elw.local:8443/"}` → `lesen` liefert die Adresse, `letzter_vertrag` = `None`.
  - `gemerkter_vertrag_gilt_je_origin`: `schreiben(A)`, `merke_vertrag(A, 1)` → `letzter_vertrag(A) == Some(1)`, auch für `A` mit anderem Pfad; `letzter_vertrag(B) == None`.
  - `unbekannter_server_wird_nicht_gemerkt`: `merke_vertrag(C, 1)` ohne `schreiben(C)` → `letzter_vertrag(C) == None`.
  - `schreiben_und_vergessen_erhalten_bzw_entfernen_den_vertrag`: nach `schreiben(B)` gilt `letzter_vertrag(A)` weiter; nach `vergessen(A)` ist er `None`.
- [x] **Step 2: Run** `cargo test -p lifeline-desktop verbindung::` — FAIL.
- [x] **Step 3: Implement**; `schreiben` und `vergessen` übernehmen `vertraege` und streichen Einträge, deren Origin nicht mehr in `bekannt`/`server` steht.
- [x] **Step 4: Run** — PASS.
- [x] **Step 5: Commit** `feat(huelle): zuletzt bestätigten Hüllen-Vertrag je Server merken (LLH-1982)`.

### Task 3: Kennung mit `platform` und `version`

**Files:**
- Create: `src-tauri/src/kennung.js`
- Modify: `src-tauri/src/main.rs` (`KENNUNG_SKRIPT`, `fn kennung_skript() -> String`, `baue_fenster`: als erstes Init-Skript; Test `init_skripte_ergaenzen_dieselbe_kennung`)

**Interfaces:**
- Produces: `fn kennung_skript() -> String` — ersetzt in `kennung.js` die Platzhalter `__PLATFORM__` und `__VERSION__` durch `serde_json::to_string` der Werte (Zeichenketten samt Anführungszeichen).

- [x] **Step 1: Failing tests** in `main.rs`:
  - `kennung_nennt_plattform_und_version`: `kennung_skript()` enthält `platform: "{std::env::consts::OS}"` und `version: "{CARGO_PKG_VERSION}"`, keinen Platzhalter `__` mehr.
  - `init_skripte_ergaenzen_dieselbe_kennung` um `include_str!("kennung.js")` erweitern.
- [x] **Step 2: Run** `cargo test -p lifeline-desktop kennung` — FAIL.
- [x] **Step 3: Implement** `kennung.js` (Kopfkommentar wie die anderen Skripte: läuft in jeder Hülle, zuerst, gelesen nur in `frontend/src/huelle/faehigkeiten.ts`; Spec `huellen-vertrag`):
  ```js
  (() => {
    window.__LIFELINE_HUELLE__ = Object.freeze({
      ...window.__LIFELINE_HUELLE__,
      platform: __PLATFORM__,
      version: __VERSION__,
    });
  })();
  ```
  In `baue_fenster` `.initialization_script(kennung_skript())` vor `BENACHRICHTIGUNG_SKRIPT`; den Kommentar dort nachziehen.
- [x] **Step 4: Run** — PASS.
- [x] **Step 5: Commit** `feat(huelle): Kennung der Desktop-Hülle nennt platform und version (LLH-1982)`.

### Task 4: Lokale Seiten „nicht verträglich“ und „Verbinde…“, ihre Commands und Rechte

**Files:**
- Create: `src-tauri/ui/nicht-vertraeglich.html`, `src-tauri/ui/nicht-vertraeglich.js`, `src-tauri/ui/verbinde.html`, `src-tauri/capabilities/nicht-vertraeglich.json`
- Modify: `src-tauri/build.rs` (Commands `nicht_vertraeglich`, `update_suchen`), `src-tauri/src/main.rs` (Struct `Unvertraeglich`, Feld `Zustand.unvertraeglich: Mutex<HashMap<String, Unvertraeglich>>` je Fenster, Commands, `invoke_handler`, `show_nicht_vertraeglich`, `Destroyed`-Aufräumen), `src-tauri/ui/stil.css` nur falls nötig

**Interfaces:**
- Consumes: `vertrag::Richtung`.
- Produces:
  - `#[derive(Clone)] struct Unvertraeglich { ziel: Url, richtung: Richtung, server_version: Option<String> }`
  - `fn show_nicht_vertraeglich(app: &AppHandle, label: &str, ausfall: Unvertraeglich)` — setzt den Zustand, beendet Wache und `ausfaelle` des Fensters, navigiert auf `NICHT_VERTRAEGLICH` (`tauri://localhost/nicht-vertraeglich.html` bzw. `http://tauri.localhost/…` unter Windows).
  - `const VERBINDE: &str` (lokale Startseite, `verbinde.html`) und `fn verbinde_seite(server: &Url) -> WebviewUrl` (`verbinde.html?server=<origin, URL-kodiert>`).
  - Command `nicht_vertraeglich(app, fenster) -> Result<NichtVertraeglichAnzeige, String>` mit `#[derive(Serialize)] struct NichtVertraeglichAnzeige { adresse: String, richtung: Richtung, server_version: Option<String>, app_version: &'static str }`.
  - Command `update_suchen(app)` → `update::auf_wunsch_pruefen(app)`.
  - `erneut_versuchen` liest das Ziel künftig aus `ausfaelle` **oder** `unvertraeglich` (Task 5 setzt dann `pruefe_und_lade` ein).

- [x] **Step 1: Failing test** `anzeige_nicht_vertraeglich_ist_lokal_und_setzt_keine_adresse` (Muster wie `anzeige_nicht_erreichbar_ist_lokal_und_setzt_keine_adresse`): Capability ohne `remote`, Fenster `main` und `neben-*`, Rechte genau `core:default`, `allow-nicht-vertraeglich`, `allow-erneut-versuchen`, `allow-server-wechseln`, `allow-update-suchen`; keins davon in `SERVER_RECHTE`; `lokal.json` enthält `allow-update-suchen` nicht. Dazu `verbinde_seite_traegt_nur_die_origin`: `verbinde_seite("https://elw.local:8443/einsatz/1?q=x")` ist `WebviewUrl::App` mit Query `server=https%3A%2F%2Felw.local%3A8443`.
- [x] **Step 2: Run** `cargo test -p lifeline-desktop anzeige_nicht_vertraeglich verbinde_seite` — FAIL.
- [x] **Step 3: Implement.** HTML nach `nicht-erreichbar.html` (Kopfkommentar, `stil.css`, `defer`-Skript): Überschrift (per JS nach `richtung`), `<code id="adresse">`, Zeilen „Server-Version: …“ (ausgeblendet ohne Wert) und „App-Version: …“, Hinweissatz (zu neu: „Dieser Server spricht einen neueren Vertrag, als diese App kennt.“; zu alt: „Aktualisieren Sie den Server; die App lädt ihn danach von selbst nach ‚Erneut prüfen‘.“), Knöpfe `#update` (nur zu neu, primär), `#erneut` („Erneut prüfen“), `#wechseln` („Server wechseln“); Sperre mit Wort wie in `nicht-erreichbar.js`. `verbinde.html`: ohne Skript-IPC, liest `server` aus `location.search` und zeigt „Verbinde mit <host> …“ (CSP erlaubt nur `'self'`-Skripte: eigenes `verbinde.js`, kein Inline-Skript).
- [x] **Step 4: Run** `cargo test -p lifeline-desktop` — PASS; `cargo build -p lifeline-desktop` baut (Permissions erzeugt).
- [x] **Step 5: Commit** `feat(huelle): Seite „nicht verträglich“ und Startseite „Verbinde…“ (LLH-1982)` inkl. `src-tauri/permissions/autogenerated/*` falls neu erzeugt.

### Task 5: Ladeweg `pruefe_und_lade`, Maske, Deeplink, Start und Urteil je Server

**Files:**
- Modify: `src-tauri/src/main.rs`

**Interfaces:**
- Consumes: `vertrag::{check, Vertragsergebnis, Richtung}`, `verbindung::{letzter_vertrag, merke_vertrag}`, `show_nicht_vertraeglich`, `verbinde_seite`, `Unvertraeglich`.
- Produces:
  - `Zustand.urteile: Mutex<HashMap<String, Unvertraeglich>>` (Schlüssel: Origin des Servers; nur unverträgliche; `Vertraeglich` entfernt den Eintrag)
  - `async fn pruefe_und_lade(app: AppHandle, label: String, ziel: Url) -> Result<(), String>` — prüft mit `letzter_vertrag` des verbundenen Servers, wertet aus: `Vertraeglich` → `merke_vertrag`, Urteil löschen, `server_freigeben`, laden (Fenster vorhanden: `load_in_fenster`; Hauptfenster zu: Wache + `baue_fenster` wie bisher in `lade_server`); `NichtErreichbar` → laden wie bisher (Urteil unverändert); `NichtVertraeglich` → Urteil setzen, `show_nicht_vertraeglich` (Hauptfenster zu: erst mit `verbinde_seite` bauen). Fensteroperationen über `app.run_on_main_thread` bzw. so, dass unter Windows kein synchroner Fensterbau in einem Webview-Ereignis passiert.
  - `fn maske_meldung(richtung: Richtung, server_version: Option<&str>, app_version: &str) -> String` — Texte aus „Global Constraints“.
  - `fn speichern_nach_pruefung(ergebnis: &Vertragsergebnis) -> bool` — `true` außer bei `NichtVertraeglich`.
  - `fn nebenfenster_seite(urteil: Option<&Unvertraeglich>, ziel: Url) -> NebenfensterStart` mit `enum NebenfensterStart { Server(Url), NichtVertraeglich(Unvertraeglich) }`.

- [x] **Step 1: Failing tests** (reine Funktionen):
  - `maske_nennt_beide_versionen_und_die_richtung`: `maske_meldung(ZuAlt, Some("1.0.0-alpha.120"), "1.0.0-alpha.195")` == „Der Server (Version 1.0.0-alpha.120) ist zu alt für diese App (Version 1.0.0-alpha.195).“; `ZuNeu`, `None` → „Der Server ist neuer als diese App (Version 1.0.0-alpha.195). Aktualisieren Sie die App.“
  - `maske_speichert_nicht_erreichbaren_server`: `speichern_nach_pruefung(&NichtErreichbar)` und `(&Vertraeglich(..))` true, `(&NichtVertraeglich{..})` false.
  - `nebenfenster_eines_unvertraeglichen_servers_zeigt_die_seite`: mit Urteil → `NichtVertraeglich`, ohne → `Server(ziel)`.
- [x] **Step 2: Run** `cargo test -p lifeline-desktop maske_ nebenfenster_eines` — FAIL.
- [x] **Step 3: Implement** die Funktionen, dann verdrahten:
  - `setup`: gespeicherter Server → `baue_fenster(FENSTER, verbinde_seite(&server))`, dann `tauri::async_runtime::spawn(pruefe_und_lade(handle, "main", server))`; ohne Server Maske wie bisher. Updater-Start unverändert daneben.
  - `lade_server` wird zum dünnen Wrapper: Nebenfenster-Aufräumen wie bisher, dann `pruefe_und_lade` für `main`.
  - `verbinden` → `async`: `pruefe_adresse`, `check(&server, letzter_vertrag)`; bei `NichtVertraeglich` `Err(maske_meldung(..))` ohne Speichern; sonst `schreiben` und `pruefe_und_lade` (die zweite Prüfung darin ist bewusst in Kauf genommen — einfacher als ein Sonderweg; bei `Vertraeglich` ist sie schnell).
  - `abbrechen`, `erneut_versuchen`: über `pruefe_und_lade` (async Commands).
  - `bestaetige_wechsel`: im Dialog-Callback `spawn`: `check`; `NichtVertraeglich` → nativer Dialog mit `maske_meldung`, nicht speichern; sonst `schreiben` + `lade_server`.
  - `open_nebenfenster`: vor dem Bau `nebenfenster_seite(urteil des verbundenen Servers, ziel)`; bei `NichtVertraeglich` Fenster mit lokaler Seite bauen und `show_nicht_vertraeglich`-Zustand setzen statt Wache.
- [x] **Step 4: Run** `cargo test -p lifeline-desktop` und `cargo clippy -p lifeline-desktop` — PASS, keine neuen Warnungen.
- [x] **Step 5: Commit** `feat(huelle): Server nur nach bestandener Vertragsprüfung laden (LLH-1982)`.

### Task 6: Frontend — Oberfläche der Rückmeldung nach Plattform

**Files:**
- Modify: `frontend/src/rueckmeldung/adresse.ts` (`oberflaecheText`), `frontend/src/rueckmeldung/adresse.test.ts`, `frontend/src/huelle/faehigkeiten.ts` (Doku-Kommentare: Desktop-Hüllen setzen `platform` und `version`)

- [x] **Step 1: Failing tests** in `adresse.test.ts` (Block mit `oberflaeche()`):
  - `nennt in der macOS-Hülle die Desktop-App (macOS)`: Kennung `{ platform: 'macos', version: '1.0.0' }` → `'Desktop-App (macOS)'`.
  - `nennt in der Windows-Hülle die Desktop-App (Windows)`: `'windows'` → `'Desktop-App (Windows)'`.
  - `nennt in einer Hülle mit unbekannter Plattform die Desktop-App`: `'linux'` → `'Desktop-App'`.
  - Bestehende Tests (`iOS-App`, ohne Plattform `Desktop-App`, Browser) bleiben.
- [x] **Step 2: Run** `mise exec -- pnpm -C frontend exec vitest run src/rueckmeldung` — FAIL.
- [x] **Step 3: Implement** `oberflaecheText` mit Tabelle `{ ios: 'iOS-App', macos: 'Desktop-App (macOS)', windows: 'Desktop-App (Windows)' }`; Kommentar der Funktion und in `faehigkeiten.ts` (`platform`/`version`-Felder, `huellePlatform`, `huelleVersion`) nachziehen.
- [x] **Step 4: Run** dieselben Tests + `vitest run src/huelle` — PASS; `mise exec -- pnpm -C frontend exec prettier --check src/rueckmeldung src/huelle` grün.
- [x] **Step 5: Commit** `feat(rueckmeldung): Desktop-App nennt ihre Plattform (LLH-1982)`.

### Task 7: Regeln, Doku, Folgeaufgabe, Gates

**Files:**
- Modify: `src-tauri/AGENTS.md` (neuer Abschnitt „Hüllen-Vertrag (LLH-1982)“; Abschnitt „Rechte“ um Capability `nicht-vertraeglich`; „Native Meldung“-Absatz: Kennung über `kennung.js` zuerst)
- Modify: `docs/betrieb/desktop-app.md` (unter „Erster Start und Serveradresse“: Prüfung; neuer Unterabschnitt „Server nicht verträglich (LLH-1982)“ mit Tabelle wie `ios-app.md`, „Status-Seiten“)
- Modify: `docs/architektur/08-querschnittliche-konzepte.md` (Hüllen-Vertrag: Desktop prüft auch), `docs/architektur/05-bausteinsicht.md` (Desktop-Hülle: `GET /api/shell`, `vertrag.rs`), weitere Stellen nach der Mitänderungstabelle in `docs/architektur/AGENTS.md`
- Modify: `docs/anwender/kapitel/rueckmeldung.md` Zeile ~63 (Oberfläche nennt bei der Desktop-App die Plattform), Regeln aus `docs/anwender/AGENTS.md` beachten

- [x] **Step 1:** Texte schreiben; `grep -rn "ADR-0009" docs src-tauri .claude` und Verweise auf die neue ADR umstellen, wo sie Regeln zitieren.
- [x] **Step 2:** Folgeaufgabe per `zunder-task-anlegen`: gemeinsame Vertragsfälle `src-tauri/faelle/vertrag.json` für Rust- und Swift-Tests.
- [x] **Step 3: Run** `./scripts/check-all.sh --geaendert --ohne-e2e` — Expected: alle Schritte grün.
- [x] **Step 4: Commit** `docs(huelle): Hüllen-Vertrag der Desktop-Hülle in Regeln und Betrieb (LLH-1982)`.
