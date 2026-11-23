# 7. Verteilungssicht

Stand: 22.11.2026 (Testjobs auf Kanal-Branches laufen zu Ende, ADR-0091; Android-App als APK, LLH-1989; CI nur auf GitHub, ADR-0078; Geheimnisspeicher und Abrufe der Adapter, LLH-2017; iOS-App über TestFlight, LLH-1978; ein Workflow je Ereignis, Ruleset-Prüfung, kein „Baut mit Ziel-Branch“; LLH-1896/1895/1899).

Lifeline Hub läuft als **ein Serverprozess** (`lifeline-hub`) mit eingebettetem Frontend und
SQLite. Die Endgeräte greifen über Browser, installierte PWA, Desktop-App, iOS-App oder Android-App darauf zu. Einen
festen Einsatzrechner gibt es nicht ([`docs/betrieb/packaging.md`](../betrieb/packaging.md),
„Datenträger: Mindest-Schreibrate“). Den Server trägt ein Mini-PC oder Notebook im
Einsatzleitwagen genauso wie ein Container beim Hoster. Gebaut werden vier Server-Plattformen
und zwei Container-Architekturen (7.2).

## 7.1 Überblick

```mermaid
flowchart LR
  subgraph EG["Endgeräte (beliebig viele)"]
    BR["Browser / PWA<br/>frontend + Service Worker<br/>IndexedDB"]
    DT["Desktop-App src-tauri<br/>(Webview, macOS/Windows)"]
    IOS["iOS-App ios<br/>(WKWebView, iPhone/iPad)"]
    AND["Android-App android<br/>(WebView, Handy/Tablet)"]
    GK["Gekoppeltes Gerät<br/>(Browser, Funktionsansicht)"]
  end
  subgraph SR["Server-Rechner (Mini-PC, Notebook, VM oder Container)"]
    RP["Reverse-Proxy (optional,<br/>TLS, X-Forwarded-Proto)"]
    LH["lifeline-hub<br/>(Binary oder Abbild)"]
    DATA[("Datenverzeichnis<br/>lifeline.db, karten/,<br/>TLS-Zertifikat")]
    BK[("--backup-verzeichnis")]
    CL["clamd (optional)"]
  end
  subgraph EXT["Außen (nur mit Internet)"]
    IDP["OIDC-Anbieter"]
    PUSH["Push-Dienste der Browser"]
    TILE["Online-Kartenanbieter"]
    GEO["Geofabrik (KRITIS-Extrakt)"]
    OS[("Objektspeicher S3/R2<br/>MBTiles + Manifest")]
    KS["karten-service<br/>+ karten-build (Docker)"]
    GH["GitHub Releases + GHCR"]
    TF["App Store Connect<br/>+ TestFlight"]
  end
  BR -->|"HTTPS (SSE, REST)"| RP
  DT -->|HTTPS| RP
  IOS -->|"HTTPS, GET /api/shell"| RP
  AND -->|"HTTPS, GET /api/shell"| RP
  GK -->|HTTPS| RP
  RP --> LH
  BR -.->|"direkt ohne Proxy"| LH
  LH --> DATA
  LH --> BK
  LH -.-> CL
  LH -.-> IDP
  LH -.-> PUSH
  LH -.-> TILE
  LH -.-> GEO
  LH -.->|"Download (Range, SHA256)"| OS
  LH -.->|"POST /builds (Token)"| KS
  KS --> OS
  DT -.->|"Update latest.json"| GH
  TF -.->|"Build installieren"| IOS
  AND -.->|"Update android.json + APK"| GH
```

Gestrichelte Pfeile sind optional oder brauchen Internet. Ohne Internet läuft der Server weiter:
Offline-Karten liegen in `karten/`, der Rest scheitert still oder ist abgeschaltet (6.7).

## 7.2 Auslieferungsformen

| Form | Inhalt | Beleg |
| --- | --- | --- |
| Server-Binary | eine Datei mit API, eingebettetem `frontend/dist`, SQLite und OpenSSL statisch; Ziele `x86_64-unknown-linux-gnu`, `aarch64-unknown-linux-gnu`, `aarch64-apple-darwin`, `x86_64-pc-windows-gnu` | `src/static_files.rs` (`#[folder = "frontend/dist"]`), Matrix in `.github/workflows/artefakte.yml`, [`packaging.md`](../betrieb/packaging.md) |
| Container-Abbild `ghcr.io/rubenvitt/lifeline-hub` | dieselbe Linux-Binary auf `distroless/cc-debian13:nonroot`, `linux/amd64` und `linux/arm64`, kein Build im Abbild | `Dockerfile`, Job `docker` in `artefakte.yml` |
| PWA im Browser | dasselbe Frontend, vom Server ausgeliefert; installierbar und offline nur im sicheren Kontext | `frontend/vite.config.ts` (`VitePWA`), [`packaging.md`](../betrieb/packaging.md), „Lokaler Betrieb“ |
| Desktop-App | Tauri-Hülle ohne Anwendungslogik, lädt die https-Adresse des Servers; macOS ab 14 arm64 (`.dmg`, signiert und notarisiert), Windows 10/11 x64 (`-setup.exe`, nicht signiert); Linux wird nur übersetzt | `src-tauri/tauri.conf.json`, `.github/workflows/desktop.yml`, [`desktop-app.md`](../betrieb/desktop-app.md) |
| iOS-App | Swift-App (SwiftUI und WKWebView) ohne Anwendungslogik, lädt die Oberfläche des gewählten Servers; iPhone und iPad ab iOS 17.4, Bundle-ID `dev.rubeen.lifeline.ios`; nur über TestFlight an Tags der Kanäle `beta` und `main`, nicht im App Store | `ios/project.yml`, `.github/workflows/ios.yml`, `scripts/ios/testflight.sh`, [`ios-app.md`](../betrieb/ios-app.md) |
| Android-App | Kotlin-App (Jetpack Compose und Android-WebView) ohne Anwendungslogik, lädt die Oberfläche des gewählten Servers; Handys und Tablets ab Android 10 (`minSdk` 29), Paket `dev.rubeen.lifeline.android`; nur als signierte APK an den GitHub-Releases jedes Kanals, nicht über Google Play; eigener Updater liest `android.json` seines Kanals | `android/app/build.gradle.kts`, `.github/workflows/android.yml`, `scripts/android/release-apk.sh`, `scripts/release/android-kanal.mjs`, [`android-app.md`](../betrieb/android-app.md) |
| `karten-service` | Region-Build-Dienst; Linux-Binary und Abbild `ghcr.io/rubenvitt/lifeline-hub-karten-service` auf `debian:13-slim` mit `make`, `sqlite3` und Docker-CLI | `karten-service/Dockerfile`, Job `docker-karten` in `artefakte.yml`, [Runbook](../ops/lfh-204-karten-service-ops-runbook.md) |
| `website` | statische Astro-Seite auf Cloudflare Pages, Produktions-Branch `alpha`, nicht im Binary | [`website/AGENTS.md`](../../website/AGENTS.md) |

`compose.yml` und `garage.toml` sind **reine Entwicklungsinfrastruktur**: ein lokaler
S3-kompatibler Objektspeicher (Garage) für den `karten-service`. Der Server selbst braucht
kein Docker (Kopf von `compose.yml`).

## 7.3 Prozesse und Ports

| Prozess | Port (Vorgabe) | Beleg |
| --- | --- | --- |
| `lifeline-hub` | `127.0.0.1:8080` (`--bind`, `LIFELINE_BIND`); im Abbild `0.0.0.0:8080`. `--tls` ändert den Port nicht | `src/config.rs`, `Dockerfile`, [`betrieb-tls.md`](../betrieb-tls.md) |
| `lifeline-hub` Health | `GET /api/health`: 200 mit Version, 503 ohne Datenbank | `src/routes/health.rs` |
| `karten-service` | `0.0.0.0:8088` (`KS_BIND`), `GET /healthz`, Bearer-Token `KS_TOKEN` | `karten-service/src/config.rs`, `karten-service/src/api.rs` |
| Garage (nur Dev) | `3900` S3-API, `3902` unsignierter Lesepfad | `compose.yml` |

Der Server begrenzt sich selbst: höchstens 1024 Verbindungen, Kopflesefrist 15 s, HTTP/1-Köpfe
bis 32 KiB (`src/verbindung.rs`). Per mDNS kündigt er sich nur mit `--lan-entdeckung`
an, zusammen mit `--tls` und nicht auf einem Loopback-Bind, als `_lifeline-hub._tcp` über
UDP 5353 (`src/instanz/entdeckung.rs`, LLH-1497); sonst kommt der Hostname vom Betriebssystem
oder vom lokalen DNS ([`packaging.md`](../betrieb/packaging.md), „Lokaler Betrieb“). Beim Herunterfahren bekommen offene Verbindungen 10 s, eine laufende Sicherung bis
45 s und das Schließen des Pools bis 10 s (`src/main.rs`).

## 7.4 Speicherorte

| Ort | Inhalt | Beleg |
| --- | --- | --- |
| `--db-path` (Vorgabe `lifeline.db`, Abbild `/data/lifeline.db`) | Datenbank im WAL-Modus; Anhänge als BLOB in der Tabelle `anhang`, Schlüssel des Web Push | `src/config.rs`, `migrations/0052_anhang.sql`, `src/web_push/mod.rs` |
| `<Verzeichnis von --db-path>/karten` | Offline-Karten (MBTiles), `tile-cache.db`, Welt-Übersicht, `kritis/` | `default_karten_dir` in `src/config.rs`, `src/karte/tile_cache.rs`, `src/karte/kritis/scheduler.rs` |
| neben der Datenbank | `lifeline-tls-cert.pem`/`lifeline-tls-key.pem` (Zertifikat-Cache), `lifeline-download-…` (Kopie für den Sicherungs-Download) | `src/tls/mod.rs`, `src/backup/mod.rs` |
| `--backup-verzeichnis` | automatische Sicherungen, Vorgabe alle 360 min, 7 behalten, mit `--backup-empfaenger` per age verschlüsselt | `src/config.rs`, [`backup-restore.md`](../betrieb/backup-restore.md) |
| `LIFELINE_GEHEIMNIS_SCHLUESSEL` (nur Umgebung oder Flag, nie Datei oder Datenbank) | privater age-Schlüssel des Geheimnisspeichers der Adapter; in der Datenbank liegen nur Chiffrate mit seinem Fingerabdruck (`adapter_geheimnis`). Getrennt sichern: ohne ihn sind die Geheimnisse nach einer Wiederherstellung neu zu setzen | `src/config.rs`, `src/adapter/geheimnis.rs`, [ADR-0077](entscheidungen/ADR-0077-geheimnisse-der-adapter-liegen-nur-verschluesselt-und-adapter-rufen-nur-ueber-den-rahmen-ab.md), [`backup-restore.md`](../betrieb/backup-restore.md) |
| Endgerät, Browserprofil oder Webview | IndexedDB `lifeline-lagebild`, `lifeline-offline`, `lifeline-ortcache`, ETB-Entwürfe; Liste aller Orte in `GERAETESPEICHER` | `frontend/src/offline/geraetRaeumung.ts`, [`endgeraete.md`](../betrieb/endgeraete.md) |
| Desktop-App | `verbindung.json` (Server, `bekannt`), `kanal.json` (Update-Kanal) im App-Konfigurationsverzeichnis (`app_config_dir`, Kennung `dev.rubeen.lifeline.desktop`) | `src-tauri/src/verbindung.rs`, `src-tauri/src/kanal.rs`, [`desktop-app.md`](../betrieb/desktop-app.md) |
| iOS-App | Serverliste `server.json` in Application Support, Schalter „Haptik“ in `UserDefaults`; je Server ein eigener `WKWebsiteDataStore` mit der UUID des Eintrags (Cookies, IndexedDB, Cache) | `ios/LifelineKern/Sources/LifelineKern/Huellenhilfen.swift` (`Serverablage`), `ios/App/Webview.swift` (`Webviewfabrik`), [`ios-app.md`](../betrieb/ios-app.md) |
| Android-App | Serverliste `filesDir/lifeline/server.json`; Schalter „Haptik“, Update-Kanal und Stand des Updaters in `SharedPreferences("lifeline")`; geladenes Update unter `noBackupFilesDir/update/`, Downloads zum Teilen höchstens 24 h unter `cacheDir/downloads/`; je Server ein eigenes WebView-Profil mit der UUID des Eintrags (Cookies, IndexedDB, Service Worker, Cache); keine Cloud-Sicherung (`allowBackup="false"`) | `android/app/src/main/kotlin/dev/rubeen/lifeline/android/MainActivity.kt`, `android/kern/src/main/kotlin/dev/rubeen/lifeline/kern/Serverablage.kt`, `android/app/src/main/kotlin/dev/rubeen/lifeline/android/web/WebviewFabrik.kt`, `android/app/src/main/AndroidManifest.xml`, [`android-app.md`](../betrieb/android-app.md) |
| `karten-service` | Volume `/opt/karten-build/out`, Ergebnis im Objektspeicher | `karten-service/Dockerfile`, `karten-service/src/storage/s3.rs` |

Das Abbild legt Datenbank und `karten/` auf **ein** Volume `/data`, weil der Kartenpfad aus dem
Datenbankpfad folgt (`Dockerfile`). Datenbank, Sicherungen und Swap gehören auf einen
verschlüsselten Datenträger; die Anwendung verschlüsselt nicht selbst und prüft das stündlich
([`packaging.md`](../betrieb/packaging.md), „Datenträgerverschlüsselung ist Pflicht“).

## 7.5 TLS

| Betriebsart | Verhalten | Beleg |
| --- | --- | --- |
| eigenes TLS (`--tls`) | Zertifikat in der Reihenfolge eigenes Paar, Cache neben der DB, `mkcert`, selbst signiert (`rcgen`); `--bind` muss IP:Port sein; HTTP/2 per ALPN | `src/tls/mod.rs`, `src/main.rs`, [`betrieb-tls.md`](../betrieb-tls.md) |
| hinter einem Reverse-Proxy | `X-Forwarded-Proto: https` setzt `Secure` je Anfrage; `--trusted-proxies` legt fest, wem `X-Forwarded-For` geglaubt wird | `SichererTransport` (`src/auth/session.rs`), `extract::init_vertraute_proxys` (`src/main.rs`) |
| Einwurf (`/api/v1/einwurf/`) | nur über TLS: `--tls`, oder `X-Forwarded-Proto: https` von einer Gegenstelle aus `--trusted-proxies`; sonst `403 tls_required`. `--einwurf-allow-http` hebt das für ein Netz auf, das selbst verschlüsselt | `is_tls_nachgewiesen` (`src/extract.rs`), `check_einwurf` (`src/public_api/einwurf/routen.rs`), `RouterOptionen` (`src/app.rs`), [`betrieb-tls.md`](../betrieb-tls.md) |
| Klartext-HTTP | funktioniert, aber ohne Service Worker, PWA, Passkey, Eigenposition und Einwurf | [`packaging.md`](../betrieb/packaging.md), „Lokaler Betrieb“ |

Die Desktop-App nimmt nur `https` mit Hostnamen an ([`desktop-app.md`](../betrieb/desktop-app.md),
„Erster Start“), iOS- und Android-App ebenso (gemeinsame Fälle `src-tauri/faelle/`). Sie prüfen
Zertifikate wie das System ohne Ausnahme: ein Server im Einsatz-LAN braucht ein Zertifikat aus
mkcert oder einer eigenen CA, deren Profil (iOS) bzw. CA-Zertifikat (Android, Nutzer-CAs laut
`android/app/src/main/res/xml/network_security_config.xml`) auf dem Gerät installiert ist; das
selbst signierte Rückfall-Zertifikat aus `src/tls/mod.rs` reicht dafür nicht
([`ios-app.md`](../betrieb/ios-app.md), „CA-Profil für das Einsatz-LAN“;
[`android-app.md`](../betrieb/android-app.md), „CA-Zertifikat für das Einsatz-LAN“). Ohne HTTP/2 teilen sich alle Tabs eines Profils etwa sechs Verbindungen je Origin; jede offene
SSE-Verbindung belegt eine davon ([`betrieb-tls.md`](../betrieb-tls.md), LFH-264).

## 7.6 Konfiguration

Der Server liest seine Konfiguration nur in `src/config.rs` aus Flags oder `LIFELINE_*`. Die
vollständige Liste gibt `lifeline-hub --help` aus. Welche Schalter eine Vertrauensgrenze
verschieben, steht in [`docs/betrieb/env-registry.md`](../betrieb/env-registry.md). Den
`karten-service` konfigurieren `KS_*` und `AWS_*` (`karten-service/src/config.rs`,
[Runbook](../ops/lfh-204-karten-service-ops-runbook.md)). Die Kartenquellen stehen nicht in der
Umgebung, sondern in der Datenbank und werden unter `/admin/karten` gepflegt
([`packaging.md`](../betrieb/packaging.md), „Lagekarte / Basemap“).

Diese ausgehenden Verbindungen hängen an Schaltern (Vorgaben aus `src/config.rs`):

| Ziel | Schalter, Vorgabe |
| --- | --- |
| Geofabrik-Extrakt für KRITIS (rund 4–5 GB je neuem Stand) | `--kritis-extrakt` aus; eingeschaltet alle 168 h |
| Katalog und neue Stände der Offline-Karten | `--karten-auto-aktualisierung` an, alle 6 h |
| `karten-service` | `--karten-service-url` und `--karten-service-token`, beide nötig |
| clamd | `--clamav-addr`, ohne Angabe ungescannt; nicht erreichbar → 503 außer `--clamav-fail-open` |
| Push-Dienste der Browser | `--web-push` aus |
| OIDC-Anbieter | alle vier `--oidc-*` gesetzt |
| Webhook-Empfänger der Anbindungen | je eingerichtetem Webhook; nur `https`, ohne Weiterleitung, LAN nur mit Ausnahme (ADR-0046) |
| Quellen der Adapter (Divera, HiOrg …) | je angelegtem Adapter im Intervall, Vorgabe der Art; nur `https`, ohne Weiterleitung, LAN nur mit Ausnahme (ADR-0077). Ohne Adapter kein Abruf |

## 7.7 Release-Kette und Kanäle

```mermaid
flowchart LR
  PR["PR auf alpha"] -->|jeder Push| CIPR["pr.yml<br/>Schnellprüfungen"]
  PR -->|Merge| CI["ci.yml auf alpha, beta, main<br/>Schnellprüfungen und Suiten,<br/>laufende Tests enden, ein Push wartet"]
  PR -->|Merge| KAN["migrationen-kanal.yml,<br/>ruleset.yml (nur alpha)"]
  CIPR -->|"Label voll: ruft auf"| SU["suiten.yml<br/>Rust, Frontend, Bericht"]
  CI -->|ruft auf| SU
  SU -->|ruft auf| E2E["e2e.yml<br/>e2e-Binary, e2e 1/4 bis 4/4"]
  CI -->|"Tests grün,<br/>nicht abgebrochen"| REL["release.yml<br/>Ruhefenster, semantic-release"]
  REL --> TAG["Tag, Versions-Commit,<br/>Release als Entwurf"]
  TAG --> ART["artefakte.yml"]
  ART --> B["bauen: 4 Binaries,<br/>karten-service, SBOM"]
  ART --> D["docker, docker-karten<br/>(GHCR)"]
  ART --> DS["desktop (nur stabil)"]
  NZ["kanal-nachziehen.yml<br/>Alpha-Tag nach beta"] -->|Push auf beta| CI
  B --> F["freigeben"]
  D --> F
  DS --> F
  F --> PUB["Release veröffentlicht,<br/>latest, alpha oder beta am Abbild"]
  F -->|alpha| DEP["deployment.yml<br/>→ Pull-Agent am Server"]
  F -->|alpha, beta| DA["desktop-alpha<br/>→ desktop-kanal"]
  F -->|beta, stabil| IOSJ["ios → ios.yml<br/>→ TestFlight"]
  F -->|"alpha, beta, stabil"| ANDJ["android → android.yml<br/>→ APK, android-alpha/-beta/-stabil"]
```

Jeder Workflow hört entweder auf einen PR oder auf einen Push, damit ein PR keine Jobs der
Kanal-Branches als übersprungene Einträge trägt. Im PR prüft `pr.yml` jeden Push mit den
Schnellprüfungen. Pflicht sind daneben nur `Migrationsnummern` und `ADR-Nummern`
(`migrationen.yml`); die Liste steht in `scripts/ruleset-pruefen.sh`, und
`ruleset.yml` prüft das Ruleset von `alpha` dagegen. Rust-, Frontend- und e2e-Suite
(`suiten.yml`) fährt ein PR nur mit dem Label `voll`, ohne Pflicht. Auf `alpha`, `beta` und
`main` läuft `ci.yml` bei jedem Push voll; gestartete Testjobs laufen zu Ende, je Job wartet
höchstens ein Lauf, und ein laufender Release bricht nie ab (`concurrency` der Jobs in
`suiten.yml` und `ci.yml`,
[ADR-0048](entscheidungen/ADR-0048-ein-workflow-je-ereignis-ein-pr-prueft-leicht-und-das-ruleset-wird-geprueft.md),
[ADR-0091](entscheidungen/ADR-0091-testjobs-auf-kanal-branches-laufen-zu-ende.md)).
Nach dem Push bewertet `migrationen-kanal.yml` die Nummern der offenen PRs neu; einen Kompilierlauf
je offenem PR gibt es nicht mehr
([ADR-0049](entscheidungen/ADR-0049-kein-pflicht-check-baut-mit-ziel-branch-bei-rotem-alpha-ist-genau-ein-pr-zustaendig.md)).
Brüche, die erst der Build oder ein Test zeigt, fallen so auf `alpha` auf (11.2, R41).

| Kanal | Branch | Version | Desktop-Update liest |
| --- | --- | --- | --- |
| Vorabversion | `alpha` (Default-Branch, jeder Merge) | `X.Y.Z-alpha.N` | Release `desktop-alpha`, `latest.json` |
| Beta | `beta`, nur durch den Workflow „Beta nachziehen“ mit einem Alpha-Tag | `X.Y.Z-beta.N` | Release `desktop-beta`, `latest.json` |
| Stabil | `main`, nur durch Merge `alpha → main` | `X.Y.Z` | `releases/latest/download/latest.json` |

- Kanäle und Versionsquelle: `release.config.mjs`. `prepareCmd` setzt die Version in
  `Cargo.toml` und `frontend/package.json`; Server und Hülle erben sie aus `[workspace.package]`.
  `release.yml` läuft nur nach grünem und nicht abgebrochenem Gate bei einem Push (`ci.yml`,
  Job `release`).
- Ein Release erscheint erst, wenn alle Bau-, Abbild- und bei stabilen Tags auch Desktop-Jobs
  grün sind (Job `freigeben`, Kopf von `artefakte.yml`). Die Desktop-Pakete einer Alpha
  entstehen danach und halten nichts auf (Job `desktop-alpha` in `artefakte.yml`, `desktop.yml`).
- Die iOS-App geht nach der Freigabe eines Beta- oder stabilen Tags zu TestFlight (Job `ios` in
  `artefakte.yml`, `ios.yml`, `scripts/ios/testflight.sh`), nie bei Alpha; ein roter Upload hält
  das Release nicht auf. `ios.yml` lässt sich auch von Hand mit einem Tag starten. Signiert wird
  automatisch über einen App-Store-Connect-API-Schlüssel ([`ios-app.md`](../betrieb/ios-app.md)).
- Die Android-App baut nach der Freigabe jedes Tags der Kanäle `alpha`, `beta` und `main` eine
  signierte APK (Job `android` in `artefakte.yml`, `android.yml`, `scripts/android/release-apk.sh`)
  und hängt sie ans Release, ohne je eine schon abgelegte zu überschreiben
  (`scripts/android/apk-ablegen.sh`); ein roter Bau hält das Release nicht auf. Das Manifest
  `android.json` und eine APK unter festem Namen liegen in den Kanal-Releases `android-alpha`,
  `android-beta` und `android-stabil`, nur vorwärts (`scripts/release/android-kanal.mjs`); auch
  stabil nicht unter `releases/latest/download/`, das bis zum fertigen Bau leer wäre. Signiert wird mit einem Schlüssel für immer aus den
  Geheimnissen `ANDROID_KEY*` ([`android-app.md`](../betrieb/android-app.md)).
- Beta (LLH-1545, [ADR-0019](entscheidungen/ADR-0019-beta-zaehlt-neben-alpha-und-zieht-nur-alpha-tags-nach.md)):
  `kanal-nachziehen.yml` bringt einen veröffentlichten Alpha-Tag nach `beta`
  (`scripts/release/kanal-nachziehen.sh`, Angleich-Commit gegen die Konflikte des
  Versions-Commits). Alpha zählt daneben weiter. Jeder Desktop-Kanal und jeder gleitende
  Abbild-Tag (`:latest`, `:alpha`, `:beta`) führt nur Releases seines Kanals, nur vorwärts
  (`scripts/release/desktop-kanal.mjs`, `scripts/release/abbild-kanal.mjs`). Beta legt kein
  Deployment an.
- `deployment.yml` rollt nichts aus: es legt ein GitHub-Deployment an, das ein Pull-Agent auf dem
  Zielserver abholt. Der Agent liegt nicht in diesem Repo (Kopf von `deployment.yml`).
- Regeln für Release-Skripte: [`scripts/AGENTS.md`](../../scripts/AGENTS.md); Ablauf und
  Signaturschlüssel der Desktop-App: [`desktop-app.md`](../betrieb/desktop-app.md).
- **Wo die CI läuft** ([ADR-0078](entscheidungen/ADR-0078-alle-ci-jobs-laufen-auf-github.md)):
  alle Jobs auf den gehosteten Runnern von GitHub (`ubuntu-latest`, die Desktop- und iOS-Builds
  auf ihren Plattformen, die Android-APK auf `ubuntu-latest` mit dessen Android-SDK). Der eigene Server für Rust-Suite und e2e (LLH-1666, LLH-2014) ist am
  22.11.2026 zurückgebaut.

## 7.8 Beobachtbarkeit und Betrieb

- Logs gehen auf stdout, nicht blockierend mit höchstens 16 Ki Zeilen Puffer; bei Stau fallen
  Zeilen weg (`src/main.rs`). Request-ID, Log-Flut-Schutz, Auth-Audit, Admin-Spur und
  Zugangsprotokoll: [`docs/betrieb/observability.md`](../betrieb/observability.md).
- Die Datenträgerprüfung meldet einen unverschlüsselten oder unbekannten Ort im Log und in einer
  Warnleiste für System-Admins (`src/datentraeger/mod.rs`, [`packaging.md`](../betrieb/packaging.md)).
- Sicherung im laufenden Betrieb über `VACUUM INTO`, Download unter `/api/backup`, Unterkommandos
  `backup` und `restore`: [`docs/betrieb/backup-restore.md`](../betrieb/backup-restore.md).
- Vorgaben für Endgeräte (Verschlüsselung, Bildschirmsperre, Gemeinschaftsgeräte, Verlust):
  [`docs/betrieb/endgeraete.md`](../betrieb/endgeraete.md). Web Push:
  [`docs/betrieb/web-push.md`](../betrieb/web-push.md).
