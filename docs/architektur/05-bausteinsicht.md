# 5. Bausteinsicht

Stand: 22.11.2026 (iOS-Push `src/ios_push` und Push-Relais `push-relais`, LLH-1981; Schlüsselwechsel des Geheimnisspeichers, LLH-2025; Android-Hülle `android`, LLH-1989; Adapter-Rahmen `src/adapter`, LLH-2017; iOS-Hülle `ios`, LLH-1978; Absturzbericht des Clients, LLH-1822; Einwurf-Zugang, LLH-1654; Lage für Maschinenzugänge, LLH-1638, mit dem entfallenen Lesezugang der Lagemonitore).

Dieses Kapitel nennt jeden Baustein des Repos mit einem Satz Zweck und seinen Schnittstellen.
Der Wächter `scripts/check-architektur.sh` verlangt, dass jedes Modul unter `src/`, jedes
Verzeichnis unter `frontend/src/`, jedes Crate unter `crates/` und jedes Teilprojekt hier steht
(Mitänderungsregel in [docs/architektur/AGENTS.md](AGENTS.md)). Äußere Nachbarn und
Fremddienste stehen in der [Kontextabgrenzung](03-kontextabgrenzung.md), Abläufe über mehrere
Bausteine in der [Laufzeitsicht](06-laufzeitsicht.md), Prozesse und Speicherorte in der
[Verteilungssicht](07-verteilungssicht.md).

## 5.1 Ebene 1: Whitebox Gesamtsystem

```mermaid
flowchart LR
  nutzer([Browser / PWA])
  website["website<br/>(Astro, statisch)"]
  tauri["src-tauri<br/>(Desktop-Hülle)"]
  ios["ios<br/>(iOS-Hülle)"]
  android["android<br/>(Android-Hülle)"]
  subgraph bin["Binary lifeline-hub"]
    hub["lifeline-hub<br/>(axum + SQLite)"]
    fe["frontend<br/>(eingebettet aus frontend/dist)"]
  end
  katalog["crates/karten-katalog"]
  mclient["crates/lifeline-machine-client"]
  fremd([Fremdsystem])
  ks["karten-service"]
  kb["karten-build"]
  relais["push-relais<br/>(APNs-Relais)"]
  apns([APNs])
  s3[(S3-Speicher)]
  nutzer -- "HTTPS: Seiten, /api, SSE" --> hub
  tauri -- "Webview lädt Server-Adresse" --> hub
  ios -- "Webview lädt Server-Adresse,<br/>GET /api/shell" --> hub
  ios -.-|gemeinsame Fälle| tauri
  hub -- "HTTPS /v1/senden<br/>(iOS-Push, verschlüsselt)" --> relais
  relais -- "HTTP/2" --> apns
  apns -. "Push" .-> ios
  android -- "WebView lädt Server-Adresse,<br/>GET /api/shell" --> hub
  android -.-|gemeinsame Fälle| tauri
  hub -- "liefert aus" --> fe
  hub -- "HTTP + Bearer-Token<br/>(Region-Bau)" --> ks
  ks -- "make tiles" --> kb
  ks -- "MBTiles + Manifest" --> s3
  hub -.-|Wire-Typen| katalog
  ks -.-|Wire-Typen| katalog
  fremd -- "HTTPS /api/v1, signiert" --> hub
  fremd -.-|Referenz-Client| mclient
  hub -.-|Kommando zugang| mclient
```

| Baustein | Verantwortung | Schnittstellen | Code |
| --- | --- | --- | --- |
| Backend `lifeline-hub` | Ein Binary: REST-API unter `/api`, Live-Kanal per SSE, SQLite-Datenbank, Hintergrund-Scheduler (u. a. Erinnerung, Purge, Sicherung) und Auslieferung des Frontends | HTTP(S), `GET /api/einsaetze/{id}/live` und `GET /api/live` (`src/routes/live.rs`), CLI-Subkommandos `backup`/`restore` (`src/config.rs`) | `src/`, Start `src/main.rs` |
| `frontend` | React-19/antd-6-Oberfläche als PWA (`frontend/package.json`); Stabsoberfläche und Gerätehülle | ruft `/api` über `frontend/src/api/client.ts`, Live über `EventSource` (`frontend/src/live/liveVerbindung.ts`) | `frontend/src/` |
| Desktop-Hülle `src-tauri` | Tauri-2-Crate `lifeline-desktop`, lädt die https-Adresse des Servers, keine Anwendungslogik | `GET /api/shell` (`src/routes/shell.rs`), Commands nach `src-tauri/build.rs`, Deeplink `lifeline://verbinden`, `POST /api/auth/app-code[/redeem]` | `src-tauri/` ([AGENTS.md](../../src-tauri/AGENTS.md)) |
| iOS-Hülle `ios` | Eigene Swift-App für iPhone und iPad (SwiftUI + WKWebView), lädt die Oberfläche des gewählten Servers, keine Anwendungslogik; testbare Logik im Swift-Paket `ios/LifelineKern`, App-Target unter `ios/App` | `GET /api/shell` (`src/routes/shell.rs`), Brücke `lifeline` mit Init-Skript `ios/App/Huelle/huelle.js`, Deeplink `lifeline://verbinden`, gemeinsame Fälle `src-tauri/faelle/` | `ios/` ([AGENTS.md](../../ios/AGENTS.md)) |
| Android-Hülle `android` | Eigene Kotlin-App für Android-Handys und -Tablets (Jetpack Compose + Android-WebView), lädt die Oberfläche des gewählten Servers in einem WebView-Profil je Server, keine Anwendungslogik; testbare Logik im Kotlin-Kern `android/kern` (ohne Android-SDK), App unter `android/app`, Versionskatalog und Gradle-Wrapper unter `android/gradle`; Auslieferung als APK mit eigenem Updater | `GET /api/shell` (`src/routes/shell.rs`), Brücke `lifeline` mit Init-Skript `android/app/src/main/assets/huelle.js`, Deeplink `lifeline://verbinden`, gemeinsame Fälle `src-tauri/faelle/`, Manifest `android.json` an den GitHub-Releases | `android/` ([AGENTS.md](../../android/AGENTS.md)) |
| `karten-service` | Zentraler Dienst, der Offline-Kartenregionen baut und in S3 ablegt | `/regions`, `/builds`, `/builds/{id}`, `/zeitplan`, `/healthz` (`karten-service/src/api.rs`) | `karten-service/` |
| `push-relais` | Eigener Dienst, den das Projekt betreibt: hält den APNs-Schlüssel und reicht verschlüsselte Pushes der Lifeline-Server an Apple weiter; kennt keine Inhalte und keine Tokens ([ADR-0090](entscheidungen/ADR-0090-ios-push-laeuft-ueber-ein-relais-mit-ende-zu-ende-verschluesselter-nutzlast.md)) | `POST /v1/server`, `POST /v1/senden`, `GET /v1/status` (`push-relais/src/api.rs`), Unterbefehle `sperren`/`entsperren` (`push-relais/src/main.rs`) | `push-relais/` ([AGENTS.md](../../push-relais/AGENTS.md)) |
| `karten-build` | Bau-zeitiges Erzeugen der Shortbread-MBTiles mit Planetiler, nie zur Laufzeit der App | `make tiles AREA=…`, `make validate` (`karten-build/README.md`) | `karten-build/` |
| `crates/karten-katalog` | Geteilte Wire-Typen des Offline-Kartenkatalogs und der Bau-Jobs | Lib-Crate, Feature `schema` für den Typ-Codegen (`crates/karten-katalog/Cargo.toml`) | `crates/karten-katalog/src/lib.rs` |
| `crates/lifeline-machine-client` | Referenz-Client des Maschinenzugangs: Code einlösen, Anfragen signieren, Antworten prüfen; absichtlich unabhängig vom Server | Lib-Crate, Feature `http` (`crates/lifeline-machine-client/Cargo.toml`); genutzt vom Kommando `lifeline-hub zugang` | `crates/lifeline-machine-client/src/lib.rs` |
| `website` | Marketing-Seite und Anwenderdoku, eigenständig, nicht im Binary | Cloudflare Pages, liest `docs/anwender/kapitel/` | `website/` ([AGENTS.md](../../website/AGENTS.md)) |

Belege: Der Release-Build bettet `frontend/dist` per `rust-embed` ein, der Debug-Build liest vom
Dateisystem (`src/static_files.rs`); unbekannte Pfade ohne Dateiendung fallen auf `index.html`
zurück, eingehängt als Router-Fallback in `src/app.rs`. Der Workspace umfasst `.`,
`crates/karten-katalog`, `crates/lifeline-machine-client`, `karten-service`, `push-relais` und
`src-tauri` (`Cargo.toml`). Die Kopplung an den
`karten-service` ist optional: ohne `LIFELINE_KARTEN_SERVICE_URL` und
`LIFELINE_KARTEN_SERVICE_TOKEN` ist der Region-Bau aus (`src/config.rs`); die Proxy-Routen
`/api/map/offline-maps/build|buildable-regions|build-status` stehen in `src/app.rs`. Der
`karten-service` ruft `make tiles` im Verzeichnis von `karten-build`
(`karten-service/src/build/make_runner.rs`) und schreibt über `karten-service/src/storage/s3.rs`.

## 5.2 Ebene 2: Backend `lifeline-hub`

Regeln des Backends: [src/AGENTS.md](../../src/AGENTS.md) (Statuscodes, Eingabegrenzen,
Typ-Codegen, Anhänge, Schutzköpfe, Org-Ereignisse, Benachrichtigungen, Aufbewahrung, ClamAV).

### Schichtung einer Anfrage

```mermaid
flowchart TB
  v["src/verbindung.rs<br/>Header-Timeout, unter dem Router"] --> a["src/app.rs<br/>Router, Layer: Body-Limit, Zulassung, Request-ID, Panik-Fang"]
  a --> r["src/routes/*<br/>Handler je Fachmodul"]
  r --> x["Extractors<br/>src/extract.rs, auth::session::CurrentUser,<br/>einsatz::kontext::EinsatzLesezugriff/Schreibzugriff"]
  r --> f["Fachmodul src/&lt;modul&gt;/<br/>mod.rs (Typen, Regeln) + repo.rs (SQL)"]
  f --> t["src/tx.rs<br/>write_retry!: BEGIN IMMEDIATE + Busy-Retry"]
  t --> d[("src/db.rs<br/>SQLite-Pool, WAL, Migrationen")]
  f --> l["src/live<br/>LiveHub: Einsatz- und Org-Kanal"]
  l --> s["src/routes/live.rs<br/>SSE"]
  r -.-> e["src/error.rs<br/>AppError → {error}-JSON"]
```

- **Router:** Alle Routen stehen flach in `build_router_mit` (`src/app.rs`), die Handler in
  `src/routes/` (eine Datei je Ressource, gemeinsame Helfer in `src/routes/support.rs`).
  Die Demo-Routen gibt es nur mit `RouterOptionen::demo_daten` (`--demo-daten`); die Web-Push-Routen
  sind immer eingehängt und antworten ohne `--web-push` aus dem Handler mit 404.
- **Zugriff:** Jede `/api/einsaetze/{id}/…`-Route zieht `EinsatzKontext`; der Extractor prüft
  immer die Org-Zugehörigkeit (`src/einsatz/kontext.rs`). Gerätesitzungen begrenzt
  `CurrentUser` auf eine Routenliste (`src/geraet/mod.rs`, `darf_route`).
- **Schreiben:** `write_retry!` holt den Schreib-Lock am `BEGIN` und wiederholt bis
  `MAX_VERSUCHE` = 4, danach 503 (`src/tx.rs`).
- **Live:** `LiveEvent` (Einsatz-Kanal, gefiltert nach Modulrecht über `modul_keys`) und
  `OrgLiveEvent` (`einsatzliste`, `stammdaten`, `org_benachrichtigung`) in `src/live/mod.rs` und
  `src/live/org.rs`; `stammdaten` sendet eine Middleware nach jedem erfolgreichen Schreiben auf
  einen Stammdaten-Pfad (`src/routes/live.rs`). Das Frontend filtert auf dieselben Wire-Namen
  (`frontend/src/api/queryKeys.ts`).
- **Fachmodul-Form:** Ein Modul trägt in `mod.rs` Typen, Grenzen und reine Regeln, in `repo.rs`
  (oder `repo/`) die Abfragen; ETB-Einträge aus anderen Modulen schreibt `etb::repo::anlegen_tx`; der
  eine INSERT steht in `einfuegen` (`src/etb/repo.rs`).

In den Tabellen unten bedeutet „Routen“ den Pfad-Präfix aus `src/app.rs`, „Live“ den Wire-Namen
aus `src/live/mod.rs`. `{id}` ist die Einsatz-ID.

### Einsatz & ETB

| Pfad | Zweck | Schnittstellen |
| --- | --- | --- |
| `src/einsatz` | Einsatz-Lebenszyklus, Rollen, Modulsichtbarkeit, Einstellungen, Zugriffs-Extractor, Nummernvergabe, Purge-Scheduler, Schwärzung und Archiv nach der Nachbereitung (`archiv.rs`) | Routen `/api/einsaetze`, `…/{id}/modul-zaehler`, `…/{id}/lagekennzahl-wahl`; Live `einsatz` |
| `src/einsatzakte` | Einsatzakte (LLH-1835): ZIP mit allen Anhängen (bereinigt), den Tabellen von Betroffenen, Tieren und Schäden und einem Inhaltsverzeichnis; Sammeln über die Linker, Bausperre je Einsatz und Server. Das Druckstück der Akte baut der Browser | `GET …/{id}/einsatzakte/anlagen.zip`; nutzt `routes::support::anhang_fuer_akte`, `routes::backup::chunk_stream` |
| `src/einsatz_vorlage` | Org-Katalog „Einsatz-Vorlagen“: Modulsatz, der beim Anlegen Module ausblendet | `/api/einsatz-vorlagen`; nutzt `einsatz::repo::anlegen_tx` |
| `src/einsatzabschnitt` | Abschnittsbaum mit Leiter, Fläche und Sprechgruppen; schreibt System-ETB beim Anlegen | `…/{id}/abschnitte`; Live `abschnitt` |
| `src/etb` | Einsatztagebuch: Eintragstypen, Einfügen als einzige Stelle, Lesemarke, Zähler | `…/{id}/etb`; Live `etb` |
| `src/etb_baustein` | Org-Katalog der ETB-Textbausteine, Seed für neue Organisationen | `/api/etb-bausteine` |
| `src/stichwort` | Org-weite Einsatzstichwort-Vorschläge, koppelbar an Einsatz-Vorlagen | `/api/stichwort-vorschlaege` |

### Lage & Karte

| Pfad | Zweck | Schnittstellen |
| --- | --- | --- |
| `src/karte` | Fachebenen-Aggregator (NINA, DWD, PEGELONLINE, KRITIS u. a.), Style-/Tile-Proxy mit SSRF-Schutz, MBTiles, Offline-Karten-Registry und -Download | `/api/map/…`; ruft `karten-service`; Cache in `src/cache_db.rs` |
| `src/karte_hintergrundbild` | Hochgeladene Hintergrundbilder (PNG/JPEG) mit vier Eckkoordinaten | `…/{id}/karte/hintergrundbilder`; Live `karte_bild` |
| `src/karten_ansicht` | Einsatzweit geteilte, benannte Kartenkonfiguration | `…/{id}/karten-ansichten`; Live `karten_ansicht` |
| `src/lage_snapshot` | Unveränderlicher Stand des vollen Lagebilds als JSON-Dokument | `…/{id}/lage-snapshots`; Live `lage_snapshot` |
| `src/lage_zone` | Freie Gefahren- und Absperrzonen als GeoJSON | `…/{id}/zonen`; Live `lage_zone` |
| `src/freies_zeichen` | Taktische Zeichen ohne Fachobjekt (`zeichen_spec`) | `…/{id}/freie-zeichen`; Live `freies_zeichen` |
| `src/gefahr` | Gefahrengebiete aus Zonen mit Gefahrenmatrix und Beurteilung | `…/{id}/gefahrengebiete`; Live `gefahr` |
| `src/geocoding` | Peilung (offline), Reverse-Geocoding und Ortssuche über einen Nominatim-kompatiblen Dienst mit Cache und Drossel | `/api/ort-suche`, `/api/ort-vorschau`, `…/{id}/ort-suche`, `…/{id}/ort-vorschau`, `…/{id}/karte/ort-suche` |
| `src/schaden` | Schadenregister mit Statusmaschine, Kennzahlen, Export und Anhängen | `…/{id}/schaeden`; Live `schaden` |
| `src/tier` | Tierregister mit Status, Halterbezug und Anhängen | `…/{id}/tiere`; Live `tier` |
| `src/pegel` | Maßgebliche PEGELONLINE-Pegel mit Trend und Vorhersage-Vorschlag | `…/{id}/pegel`; Cache über `karte::cache` |
| `src/wetter` | DWD-Warnungen, 24-h-Vorhersage und Messwerte über Bright Sky | `…/{id}/wetter` |

### Kräfte & Mittel

Regeln: [frontend/src/kraefte/AGENTS.md](../../frontend/src/kraefte/AGENTS.md) (Client und Server).

| Pfad | Zweck | Schnittstellen |
| --- | --- | --- |
| `src/einheit` | Einheiten im Einsatz bilden (auch aus Vorlage oder Nachforderung), zuordnen, Status, Stärke, Einheitstypen | `…/{id}/einheiten`, `/api/einheit-typen`; Live `einheit` |
| `src/einheit_vorlage` | Org-Katalog stehender Einheiten mit Untereinheiten, Fahrzeugen und Stammbesetzung | `/api/einheit-vorlagen` |
| `src/fahrzeug` | Fahrzeugstamm, Status-Katalog, Disposition und Besatzung im Einsatz | `/api/fahrzeuge`, `/api/fahrzeug-status`, `…/{id}/fahrzeuge`; Live `fahrzeug` |
| `src/personal` | Personalstamm, Qualifikationen, Status-Katalog und Disposition | `/api/personal`, `/api/qualifikationen`, `/api/personal-status`, `…/{id}/personal`; Live `personal` |
| `src/material` | Materialstamm, Disposition, Aufteilen und Ort im Einsatz | `/api/material`, `…/{id}/material`; Live `material` |
| `src/kraefte_disposition.rs` | Gemeinsamer Baustein „disponieren und zuordnen in einer Transaktion“, alles oder nichts mit Gründen je Zeile (422) | genutzt u. a. von `src/routes/einsatz_personal.rs`, `einsatz_fahrzeug.rs`, `einsatz_einheit.rs`, `abloesung.rs`, `src/einheit/aus_vorlage.rs`; `AppError::Zeilen` |
| `src/kraefte_disposition` | Nur die Tests zu `src/kraefte_disposition.rs` (`tests.rs`) | — |
| `src/entlassung.rs` | Lebenszustand einer Kraft: entlassen oder storniert statt löschen | genutzt von Einheit, Fahrzeug, Personal, Material, Bereitstellungsraum |
| `src/status_ruecknahme.rs` | Gemeinsame Prüfung für die Rücknahme eines Statuswechsels (wer, binnen 10 Minuten, seither unverändert) und das Streichen des zugehörigen Zeitachsen-Ereignisses | genutzt von Fahrzeug, Personal, Material, Einheit (`…/status/zuruecknehmen`) |
| `src/zeitachse` | Append-only Kräfte-Zeitachse (Alarmierung, Eintreffen, Ablösung, Entlassung), Perioden beim Lesen | `…/{id}/einheiten/zeitachse`, `…/{id}/personal/zeitachse`; feuert `einheit` |
| `src/abloesung` | Schichten von Einheiten: Fälligkeit beim Lesen berechnet, Vollzug, Vorgaben je Abschnitt; `schichtplan/` der Schichtplan (Soll-Blöcke an Einheit, UHS, Pause, Befunde beim Lesen, LLH-1552) | `…/{id}/abloesungen`, `…/abloesungen/schichtplan`; Live `abloesung` |
| `src/schichtmodell` | Org-Schichtmodelle (Rhythmus oder Wechselzeiten), Kopie am Einsatz | `/api/schichtmodelle` |
| `src/planung` | Vorplanung ohne Einsatz: Planungen der Organisation mit Posten, Blöcken und Helfern, Befunde und Kennzahlen über die Schichtplan-Prüfung, Löschfrist 90 Tage (LLH-1585); Programmpunkte der Planung (LLH-1583); Übernahme in einen neuen oder laufenden Einsatz über den Übernahme-Kern des Schichtplans, danach schreibgeschützt (LLH-1587), mit den Programmpunkten | `/api/plans`; Org-Live `planung`; `abloesung::schichtplan::uebernahme`, `einsatz::repo::anlegen_tx` |
| `src/bereitstellungsraum` | Bereitstellungsräume mit Statusmaschine, Belegung, Eintreffen und Abruf | `…/{id}/bereitstellungsraeume`; Live `bereitstellungsraum` |
| `src/staerke.rs` | Taktische Stärke Führer/Unterführer/Mannschaft, Summe berechnet | genutzt u. a. von Fahrzeug, Einheiten-Vorlage, UHS, Verpflegung |
| `src/katalog.rs` | Geteilte Grundlagen der Status-Kataloge (Dienststatus, Semantik-Kategorie, TETRA-Betriebsart) | genutzt u. a. von Fahrzeug, Personal, Material, Sprechgruppe, Einheit |

### Betroffene & Betreuung

Regeln: [frontend/src/personen/AGENTS.md](../../frontend/src/personen/AGENTS.md),
[frontend/src/betreuung/AGENTS.md](../../frontend/src/betreuung/AGENTS.md).

| Pfad | Zweck | Schnittstellen |
| --- | --- | --- |
| `src/person` | Betroffene: Sichtung, Verbleib, Transport, Maßnahmen, Verletzungen, Vermisstenabgleich, Anhänge | `…/{id}/personen`, `…/personen/{pid}/…`; Live `person` |
| `src/uhs` | Unfallhilfsstellen mit Plätzen, Belegung, Kräften, Grundriss und Anhängen | `…/{id}/uhs`; Live `uhs` |
| `src/betreuung` | Evakuierungsbezirke und Betreuungsstellen als Mengen mit append-only Meldereihen; Registrierstelle mit Haushalten und Kostform, namentlich geführte Belegung ([ADR-0017](entscheidungen/ADR-0017-belegung-einer-betreuungsstelle-hat-eine-meldereihe.md)) | `…/{id}/betreuung`, `…/betreuung/stellen/{sid}/registrierungen`, `…/abmeldungen`, `…/betreuung/kostformen`, `…/{id}/evakuierung`; Live `betreuung`, `evakuierung`, `person` |
| `src/unterkunft` | Richtwerte des Unterkunftsrechners: Basis aus `richtwerte_basis.json`, Werte je Organisation und Einsatz; Rechenkern `rechner` für die Rechner-API (LLH-1524), der den TS-Kern der Oberfläche nachbildet und mit ihm dieselbe Fallsammlung `tests/fixtures/unterkunft/faelle.json` besteht | `/api/unterkunft-richtwerte`, `/api/org-unterkunft-richtwerte/{schluessel}`, `…/{id}/unterkunft-richtwerte`; Rechnung für Fremdsysteme über `src/public_api` |
| `src/verpflegung` | Verpflegungszeitfenster, erfasster Bedarf, Ausgaben, Stellen und Org-Vorlagen | `…/{id}/verpflegung`, `/api/verpflegung-vorlagen`; Live `verpflegung` |

### Kommunikation & Meldungen

| Pfad | Zweck | Schnittstellen |
| --- | --- | --- |
| `src/kommunikation` | Gemeinsamer Unterbau: Quittung und Vollzug, polymorphe Bezüge, Auto-Fristen | genutzt von Chat, Erinnerung, Auftrag, Meldung, Nachforderung, Infotelefon |
| `src/chat` | Kanäle und Nachrichten je Einsatz, Erwähnungen, Tombstones | `…/{id}/chat/…`; Live `chat` |
| `src/erinnerung` | Fristen und Wiedervorlagen, Fälligkeit beim Lesen, Scheduler | `…/{id}/erinnerungen`; Live `erinnerung`, `sofortmeldung` |
| `src/auftrag` | Aufträge top-down: Empfänger-Quittung, Vollzug, ETB-Anordnung | `…/{id}/auftraege`; Live `auftrag` |
| `src/befehl` | Befehle nach Vorlage (Registry synchron zu `frontend/src/befehle/vorlagen.ts`) | `…/{id}/befehle`; Live `befehl` |
| `src/meldung` | Eingehende Meldungen bottom-up: Nachrichtenvordruck, Triage, Korrektur, Lagemeldungen | `…/{id}/meldungen`, `…/{id}/lage/…`; Live `meldung`, `sofortmeldung` |
| `src/nachforderung` | Nachforderung von Kräften und Mitteln mit linearem Bedarfsstatus | `…/{id}/nachforderungen`; Live `nachforderung` |
| `src/benachrichtigung` | Eine Stelle entscheidet Empfänger, schreibt je Empfänger eine Zeile, stellt zu | `/api/benachrichtigungen`; Live `benachrichtigung`, `org_benachrichtigung` |
| `src/web_push` | Web Push bei geschlossenem Tab, nur mit `--web-push`, RFC-8291-Verschlüsselung | `/api/web-push`; aus `benachrichtigung::melden` |
| `src/ios_push` | iOS-Push über das Push-Relais, nur mit `--ios-push`: Anmeldungen je Konto und Gerät, Klartext wie `GET /api/benachrichtigungen/{id}`, AES-256-GCM je Gerät, Relais-Client mit Selbstanmeldung | `/api/ios-push` (`src/routes/ios_push.rs`); aus `benachrichtigung::melden`; `POST /v1/server`, `/v1/senden` am Relais |
| `src/externe_stelle` | Org-Katalog externer Stellen als Vorschlagsquelle (Speicherform Text) | `/api/externe-stellen` |

### Führungsorganisation

Regeln: [frontend/src/infotelefon/AGENTS.md](../../frontend/src/infotelefon/AGENTS.md),
[frontend/src/fernmeldewesen/AGENTS.md](../../frontend/src/fernmeldewesen/AGENTS.md),
[frontend/src/fuehrung/AGENTS.md](../../frontend/src/fuehrung/AGENTS.md),
[frontend/src/lagebesprechung/AGENTS.md](../../frontend/src/lagebesprechung/AGENTS.md).

| Pfad | Zweck | Schnittstellen |
| --- | --- | --- |
| `src/fernmeldewesen` | Kommunikationsplan und Fernmeldeskizze des Moduls Fernmeldewesen | `…/{id}/stab/kommunikationsplan`, `…/{id}/stab/fernmeldeskizze`; Live `fernmeldewesen` |
| `src/fuehrung` | Geschlossener Katalog der Führungsfunktionen (FwDV 100) mit Org-Labels, Sachgebiete S1–S6 | `/api/fuehrungsfunktionen`, `/api/org-fuehrungsfunktionen/{funktion}` |
| `src/lagebesprechung` | Termin, Abschluss mit Entschluss und Verlauf, eigenes Modul | `…/{id}/lagebesprechung[en]`; Live `lagebesprechung` |
| `src/programmpunkt` | Programmpunkte der Veranstaltung (Ablauf), Quelle der nächsten Marken und des Lagemonitors | `…/{id}/programmpunkte`, Feld `programm` von `…/{id}/lagemonitor`; Live `einsatz` |
| `src/lagebericht` | Lageberichte nach Vorlage (Registry synchron zu `frontend/src/lageberichte/vorlagen.ts`) | `…/{id}/lageberichte`; Live `lagebericht` |
| `src/vorlagendokument` | Gemeinsamer Kern von Befehl und Lagebericht: Entwurf, Freigabe als ETB-Snapshot, Fortschreibung, Anlagen, Verteiler | von `src/befehl`, `src/lagebericht` genutzt |
| `src/infotelefon` | Bürgertelefon, eigenes Modul `infotelefon`: Anrufprotokoll mit Rückrufbedarf | `…/{id}/stab/infotelefon`; Live `infotelefon` |
| `src/sprechgruppe` | TETRA-Sprechgruppen im Stamm und einsatzlokal, Zuordnung zu Zielen | `/api/sprechgruppen`, `…/{id}/sprechgruppen` |

Die Führungsstelle eines Einsatzes liegt in `src/einsatz` (`fuehrungsstelle.rs`, Routen
`…/{id}/fuehrungsstelle`).

### Geräte

Regeln: [frontend/src/geraet/AGENTS.md](../../frontend/src/geraet/AGENTS.md).

| Pfad | Zweck | Schnittstellen |
| --- | --- | --- |
| `src/geraet` | Gerätekopplung per Code, Gerätekonto, Funktionsansicht, Stellenbindung, Routen-Whitelist | `…/{id}/geraete`, `POST /api/geraete/koppeln`, `…/{id}/lagemonitor` |
| `src/lagebild_extern` | Lagebild für Externe (LLH-1496): Link je Empfänger ohne Konto (Schlüssel nur als Hash), Stufen „Lagebild“ und „Öffentlich“, Ablauf und Widerruf, Protokoll je Öffnung ohne IP; Extractor `LagebildZugriff` für den Abruf, `KartenZugriff` öffnet den Karten-Proxy für Sitzung oder gültigen Link; gilt nur an der ausgebenden Instanz (aus dem Spiegel ausgenommen) | `…/{id}/lagebild-freigaben`, `GET /api/extern/v1/lagebild` (Bearer) |
| `src/public_api` | Öffentliche API für Fremdsysteme unter `/api/v1/` (LLH-1653, [ADR-0022](entscheidungen/ADR-0022-fremdsysteme-sprechen-signiert-mit-der-oeffentlichen-api-v1.md)): Router und OpenAPI-Dokument entstehen zusammen (`utoipa-axum`), Fehler `{error, code}` mit stabilem Code (`ApiError`, `ErrorCode`), Schichten für `code` und `no-store`, Body-Grenze 64 KiB vor jedem Handler. Maschinenzugang (LLH-1652): Extractor `MachineClient` (Signatur, Widerruf, Ablauf, Drosselung, Scope), Repo der Zugänge, Codes, `jti` und Abrufe, Kommando `lifeline-hub zugang`. Lage für Fremdsysteme (LLH-1638, [ADR-0035](entscheidungen/ADR-0035-ein-maschinenzugang-liest-einsatzbezogen-nur-was-die-einsatzleitung-freigegeben-hat.md)): `lage` baut das Lagebild aus der Verdichtung des Lagemonitors in eigenen v1-Schemas, `freigabe` hält, welchen Einsatz ein Zugang liest (höchstens einen, nicht gespiegelt). Einwurf für Absender ohne Signatur (LLH-1654, [ADR-0023](entscheidungen/ADR-0023-absender-ohne-signatur-werfen-ueber-einen-einwurf-zugang-ein.md), `src/public_api/einwurf/`): Schlüssel `llh_ew_` im Pfad, Prüfreihenfolge in `einwurf/routen.rs`, Ablage der Alarmmeldungen (roh, mit Doppelerkennung) und der letzten Position je Kennung in `einwurf/ablage.rs`, Maskierung des Protokollpfads. Webhooks (LLH-1656, [ADR-0046](entscheidungen/ADR-0046-webhooks-sind-mit-dem-instanzschluessel-signiert-und-gehen-nur-an-gepruefte-adressen.md), `src/public_api/webhook/`): zweiter Leser der Outbox, ein Hintergrundlauf (`lauf`) stellt je Webhook der Reihe nach zu, `ziel` prüft Adressen und hält die Auflösung fest, `zustand` rechnet Backoff und Anhalten, `repo` hält Cursor, Störung und Verlauf. Rechner-API Unterkunft und Zelte (LLH-1524, `rechner`): eigene Wire-Formen, strenge Prüfung der Anfrage (400 je Feld, 422 im Zusammenhang), Richtwerte Anfrage vor Einsatz vor Organisation vor Basis, der Einsatz nur über `freigabe` (LLH-1856) | `GET /api/v1/openapi.json`, versioniert als `docs/api/public-v1.json`; `POST /api/v1/zugang/redeem`, `GET /api/v1/me`, `GET /api/v1/instanz/jwks.json`, `GET /api/v1/lage`; `POST /api/v1/rechner/unterkunft`, `GET /api/v1/rechner/unterkunft/richtwerte` (Scope `rechner:use`, optional `einsatz_id`); `GET`/`POST /api/v1/einwurf/{schluessel}/alarmmeldung` und `…/position`; Verwaltung über `/api/admin/integrations` (`src/routes/anbindungen.rs`, Webhook `…/{id}/webhook` in `src/routes/anbindungen_webhook.rs`) und `/api/admin/intake-credentials` (`src/routes/einwurf_zugaenge.rs`), Freigabe durch die Einsatzleitung über `…/{id}/anbindungen` (`src/routes/einsatz_anbindungen.rs`) |
| `src/adapter` | Adapter-Rahmen (LLH-2017, [ADR-0077](entscheidungen/ADR-0077-geheimnisse-der-adapter-liegen-nur-verschluesselt-und-adapter-rufen-nur-ueber-den-rahmen-ab.md)): Anbindungen, die Lifeline Hub selbst abruft. `geheimnis` verschlüsselt Geheimnisse mit age an den Schlüssel aus Umgebung oder Datei und liest während eines Schlüsselwechsels auch mit dem alten, `art` beschreibt eine Adapterart (Plätze, Felder, Abruf in zwei Phasen) und das Verzeichnis der Arten, `ziel` ist der einzige Weg nach draußen (Zielschutz der Webhooks, keine Weiterleitung, Deckel), `lauf` ruft im Hintergrund ab und schlüsselt beim Start auf den neuen Schlüssel um, `zustand` rechnet Wartezeit und Anhalten, `repo` hält Adapter, Geheimnisse und Verlauf. Produktiv noch ohne Art | Verwaltung über `/api/admin/adapter` (`src/routes/adapter.rs`); Konfiguration `LIFELINE_GEHEIMNIS_SCHLUESSEL`, `…_DATEI`, `…_ALT`, `…_ALT_DATEI` |
| `src/instanz` | Instanzkopplung (LLH-1490): Identität und Ed25519-Schlüssel der Instanz, Kopplungscode, signierte Anfragen und Antworten, Extractor `GekoppelteInstanz`, Melden im Hintergrund, Widerruf ([ADR-0034](entscheidungen/ADR-0034-maschinen-weisen-sich-mit-schluesselpaar-aus-ausser-beim-einwurf.md)); `src/instanz/stammdaten` verteilt die Stammdaten einer Org von der erreichten zur meldenden Instanz (LLH-1493: Änderungslog und Schreibschutz per Trigger, Nachlieferung mit jeder Meldung, Kontogeheimnisse mit age); `src/instanz/fuehrung` hält je Einsatz die führende Instanz mit Epoche, tauscht die Akten in der Meldung und richtet den Spiegel danach aus: wer nicht führt, hält den Einsatz als Spiegel (LLH-1491, LLH-1641, LLH-1678, [ADR-0044](entscheidungen/ADR-0044-ueber-eine-direktkopplung-gibt-keine-seite-ohne-beweis-und-einsatzleitung-ab.md)); `src/instanz/spiegel` hält Einsätze einer gekoppelten Instanz als Spiegel in denselben Tabellen (LLH-1492, [ADR-0018](entscheidungen/ADR-0018-ein-einsatz-wird-als-spiegel-in-denselben-tabellen-gehalten.md)): Beschreibung der Tabellen und Trigger-Generator (`art`, `schema`), Liefern und Übernehmen über den Stand im Änderungslog `einsatz_aenderung`, Anhänge auf Abruf (`anhang`), Anträge am Spiegel und Ausführen beim Führer (`antrag`), eigener Takt (`takt`); Direktkopplung vor Ort (LLH-1497, [ADR-0029](entscheidungen/ADR-0029-eine-direktkopplung-beglaubigt-das-tls-zertifikat-per-signierter-aussage.md)): Art der Kopplung und ihre Flüsse (`InstanzKopplungArt::traegt`), Regel des Führungswechsels (`wechselregel`), beglaubigtes TLS-Zertifikat (`zertifikat`), LAN-Entdeckung per mDNS (`entdeckung`), Ursprungskennung der Stammdaten (`stammdaten::herkunft`, `spiegel::abbildung`) | `/api/admin/instanz/…`, `/api/einsaetze/{id}/fuehrung/…`, `GET /api/instanz/stammdaten/herkunft`, `POST /api/instanz/koppeln`, `POST /api/instanz/melden`, `POST /api/instanz/spiegel`, `POST /api/instanz/zertifikat` (signiert); `GET /api/admin/instanz/lan`; `GET /api/einsaetze/{id}/antraege`, `DELETE …/antraege/{antrag_id}`, `GET /api/antraege/abgelehnt`, `DELETE /api/antraege/abgelehnt/{antrag_id}` (LLH-1648, nach der Verwahrung); Unterschriftsschlüssel in `src/auth/unterschrift` |

### Auth & Organisation

Regeln: [frontend/src/auth/AGENTS.md](../../frontend/src/auth/AGENTS.md) (Client und Server).

| Pfad | Zweck | Schnittstellen |
| --- | --- | --- |
| `src/auth` | Passwort, TOTP, WebAuthn, OIDC, Hüllen-Anmeldung (PKCE), Sitzungen, Drosseln, Anmelde- und Admin-Spur, Benutzerverwaltung, Unterschriftsschlüssel der Org-Admins (`unterschrift`, LLH-1490) | `/api/auth/…`, `/api/benutzer`, `/api/zugangsprotokoll/…` |
| `src/org` | Org-Einstellungen, Modul-Vorgaben, Logo, Aufbewahrungsfristen je Kategorie, Archiv-Schlüssel mit Schlüsselprobe | `/api/organisation`, `/api/org-einstellungen`, `/api/org-modul-einstellungen`, `/api/org-archiv-schluessel` |
| `src/benutzer_einstellungen` | Schlüssel/Wert-Fach je Benutzer mit Whitelist (erster Nutzer: Sprungpalette) | `/api/benutzer-einstellungen` |

### Aufbewahrung & Dokumente

| Pfad | Zweck | Schnittstellen |
| --- | --- | --- |
| `src/anhang` | Generische Anhänge als BLOB in SQLite: Allowlist, 25 MiB, Scan, Vorschaubilder, Audit | `…/{id}/anhaenge`; von ETB, Person, Tier, Schaden, UHS, Dokument genutzt |
| `src/dokument` | Dokumentenablage eines Einsatzes mit Kategorie und Bezug, Bytes in `anhang` | `…/{id}/dokumente`; Live `dokument` |
| `src/aufbewahrung` | Lesender Archivpfad des Org-Admins: Übersicht, pseudonyme Archivakte, Wiederherstellen, Schwärzungsantrag, Download des verschlüsselten Archivs | `/api/retention` |
| `src/backup` | Konsistente Sicherung (auch verschlüsselt mit `age`), Download, Restore, Scheduler | `GET /api/backup`, CLI `backup`/`restore` |
| `src/storno.rs` | Soft-Delete einer Zeile genau einmal, mit 404/409-Semantik | von den Fachmodulen genutzt |
| `src/feld_cas.rs` | Feldvergleich beim Speichern (`erwartet`): Altwerte je Feld gegen den Stand prüfen, 409 bei fremder Änderung, 422 bei unvollständigem Paar | genutzt von Einsatzkopf, Einheit, Führungsstelle, Personendaten |

### Plattform & Infrastruktur

| Pfad | Zweck | Schnittstellen |
| --- | --- | --- |
| `src/main.rs` | Start: Konfiguration, DB, Migrationen, Scheduler, TLS, Server, Herunterfahren | Binary `lifeline-hub` |
| `src/lib.rs` | Modulbaum des Crates | — |
| `src/config.rs` | CLI- und ENV-Konfiguration (`clap`), maskierte Geheimnisse, Subkommandos | `LIFELINE_*`-Variablen |
| `src/lizenz.rs` | Lizenztext aus `LICENSE`, eingebettet; Hinweis bei `--help` und jedem Start, Volltext beim ersten Start | Subkommando `lifeline-hub lizenz` |
| `src/app.rs` | `AppState`, Router mit allen Routen und Layern, statischer Fallback | `build_router`, `build_router_mit` |
| `src/routes` | HTTP-Handler je Ressource, gemeinsame Helfer in `support.rs`; `client_fehler.rs` nimmt den Absturzbericht des Clients an und schreibt ihn nur gedrosselt ins Log ([Kapitel 8](08-querschnittliche-konzepte.md), Abschnitt 8.30) | alle `/api`-Routen, darunter `POST /api/client-fehler` |
| `src/extract.rs` | Extractors mit `{error}`-Vertrag (`JsonBody`, `PfadParam`) und Quell-IP hinter vertrauten Proxys | von allen Handlern genutzt |
| `src/error.rs` | `AppError` → JSON `{ "error": … }` mit Statuscode, Zeilenfehler (422) | Statuscode-Konvention in `src/AGENTS.md` |
| `src/db.rs` | SQLite-Pool (WAL, Foreign Keys, `secure_delete`), Migrationen, Test-Pools | `connect`, `migrate` |
| `src/db` | Physisches Überschreiben geschwärzter Werte, LIKE-Suche der Listen | `db::suche::like_muster` |
| `src/tx.rs` | Schreibtransaktion mit `BEGIN IMMEDIATE` und Busy-Retry | Makro `write_retry!` |
| `src/live` | Broadcast je Einsatz mit Replay-Ring, Org-Kanal, Stromgrenzen | `LiveHub`, `LiveEvent`, `OrgLiveEvent` |
| `src/api_doc.rs` | OpenAPI-Schemas als Quelle der Frontend-Typen | `frontend/src/api/types.generated.ts`, `scripts/check-typ-codegen.sh` |
| `src/static_files.rs` | Eingebettetes Frontend, MIME, Cache-Header, SPA-Fallback | Router-Fallback |
| `src/cache_db.rs` | Eigene SQLite-Datei für Nachschlage-Caches, getrennt vom operativen Writer | genutzt von `src/karte`, `src/routes/pegel.rs`, `wetter.rs`, `ort_vorschau.rs` |
| `src/tls` | HTTPS-Zertifikat in Präzedenz BYO → Cache → mkcert → rcgen | Start in `src/main.rs` |
| `src/verbindung.rs` | Schutz unter dem Router: Header-Lese-Timeout gegen Slow Loris | hyper-Ebene |
| `src/zulassung.rs` | Zeitbudget und Höchstzahl gleichzeitiger Requests, Lastabwurf | Layer in `src/app.rs` |
| `src/transfer.rs` | Upload- und Download-Grenzen für große Transfers; volle Upload-Grenze → 503 mit `Retry-After` | `UploadGrenze`, `DownloadGrenze` |
| `src/http_begrenzt.rs` | Begrenztes Einlesen fremder HTTP-Antworten | Geocoder, Fachebenen, OIDC |
| `src/ausgehend.rs` | Einziger Bau der HTTP-Clients: Kennung im `User-Agent` mit Zweck, Softwarestand, Projektadresse und `--betreiber-kontakt` | `client_builder`, `tests/ausgehend_kennung_guard.rs` |
| `src/log_drossel.rs` | Sammelzeilen für fremdausgelöste Logereignisse | Lastabwurf, Pool, 503 |
| `src/zeit.rs` | Ein Zeitformat für DB und Wire: UTC, sekundengenau | überall |
| `src/zeitdarstellung.rs` | Zeitpunkte in fertigen Servertexten (ETB-Sätze, Hinweise) in der Darstellung von Einsatz bzw. Organisation, Vorgabe taktisch | Gegenstück `frontend/src/anzeige/zeitDarstellung.ts` |
| `src/uhrzeit.rs` | Wanduhrzeit `HH:MM` ohne Datum und Zone | Verpflegungsplan |
| `src/wire_enum.rs` | Makro `wire_enum!`: Enum, Serde, Schema und `as_str()` aus einer Liste | Live-Ereignisse, Domänen-Enums |
| `src/datentraeger` | Prüfung der Datenträgerverschlüsselung beim Start und stündlich | `GET /api/system/datentraeger` |
| `src/versionsstand` | Versionsstand der Instanz, Versionswechsel erkennen | `/api/release-notes` |
| `src/demo` | Übungseinsatz samt Stammdaten einspielen und entfernen, nur mit `--demo-daten` | `/api/demo-daten` |
| `src/dev` | Seed-Benutzer für die Entwicklung, nur mit Feature `dev-seeds` (`src/lib.rs`) | `/api/dev/users` |
| `src/test_log.rs` | Fängt Log-Ausgabe in Tests ein, nur unter `cfg(test)` | Tests |

## 5.3 Ebene 2: `frontend`

Regeln: [frontend/AGENTS.md](../../frontend/AGENTS.md) (Gestaltungssprache, UI-Form,
Bedien-Leitlinie, Erfassung, Deeplinks, Query-Keys, Browserspeicher); Bereichsdateien sind in
den Tabellen verlinkt.

### Struktur

```mermaid
flowchart TB
  main["main.tsx<br/>QueryClientProvider, RouterProvider, registerSW"] --> app["App.tsx<br/>Routenbaum"]
  app --> routing["routing / routes<br/>Pfade, Deeplinks, RequireAuth"]
  app --> pages["pages + Fachverzeichnisse<br/>(etb, kraefte, personen, fernmeldewesen …)"]
  pages --> ds["components, theme, icons, anzeige<br/>Gestaltungssprache"]
  pages --> api["api<br/>client.ts, queryKeys.ts, types.generated.ts"]
  live["live<br/>EventSource → Invalidierung"] --> api
  offline["offline<br/>IndexedDB: Queue + Lagebild"] --> api
  api -- "HTTPS /api" --> hub["lifeline-hub"]
  live -- "SSE" --> hub
```

- **Einstieg:** `frontend/src/main.tsx` baut den Router mit `createBrowserRouter` aus dem
  Routenbaum in `frontend/src/App.tsx` und registriert den Service Worker (`virtual:pwa-register`).
- **API-Schicht:** Ein Modul je Ressource in `frontend/src/api/`; die Response-Typen sind aus
  Rust generiert (`types.generated.ts`, Barrel `types.ts`, Regel „Typ-Codegen“ in
  `src/AGENTS.md`). Query-Keys und Live-Zuordnung in `frontend/src/api/queryKeys.ts`.
- **Live:** Höchstens eine `EventSource` je Tab, Einsatz- oder Org-Strom
  (`frontend/src/live/liveVerbindung.ts`, `frontend/src/live/einsatzStromStore.ts`).
- **Offline:** Schreib-Queue in der IndexedDB `lifeline-offline` (`frontend/src/offline/queue.ts`)
  und ein eigener Lagebild-Speicher daneben (`frontend/src/offline/lagebildSpeicher.ts`).
- **Gestaltung:** Bausteine der „Instrumententafel“ in `frontend/src/components/instrument/`;
  das Design System wird aus dem Code erzeugt (`frontend/scripts/design-system/`, Wächter
  `frontend/src/designSystem.guard.test.ts`).

### Grundgerüst und Querschnitt

| Pfad | Zweck | Gegenstück im Backend |
| --- | --- | --- |
| `frontend/src/routing` | Deeplink-Builder an einer Stelle, Pfadwahl Stabsoberfläche/Gerätehülle, Query-Param-Selektion | Routen des Routers |
| `frontend/src/routes` | `RequireAuth`: Weiterleitung ohne Sitzung, Gerätehülle abschirmen | `src/auth`, `src/geraet` |
| `frontend/src/api` | API-Client, Ressourcen-Module, generierte Typen, `openapi.json`, Eingabegrenzen-Spiegel, Absturzbericht (`clientFehler.ts`) | `src/routes`, `src/api_doc.rs` |
| `frontend/src/live` | Live-Strom, gesammelte Invalidierung, Statusbanner, Benachrichtigungs- und Org-Listener | `src/live`, `src/routes/live.rs` |
| `frontend/src/offline` | Lagebild ohne Netz, Schreiben ohne Netz, Sync, Serveruhr ([AGENTS.md](../../frontend/src/offline/AGENTS.md)) | offlinefähige Schreibrouten |
| `frontend/src/pwa` | App-Aktualisierung nach Bedienerklick | Service Worker aus `vite-plugin-pwa` |
| `frontend/src/auth` | Anmeldung, Sitzung über mehrere Tabs, Sitzungsliste, TOTP, Passwortwechsel ([AGENTS.md](../../frontend/src/auth/AGENTS.md)) | `src/auth` |
| `frontend/src/lib` | `sichererSpeicher`: einziger Zugang zu `localStorage` | — |
| `frontend/src/components` | Geteilte Komponenten, Layout, Bausteine `instrument/`, Organigramm, Druckteile | — |
| `frontend/src/theme` | Farb- und Formrollen, Hell/Dunkel, Dichte, Schriften, Statusfarben | — |
| `frontend/src/icons` | Einziger Importort für Icons (generiert aus `scripts/icons/`) | — |
| `frontend/src/anzeige` | Anzeige-Konventionen: Zeit, Koordinaten, Stärke, Ortsfelder, Zeitpunkteingabe | `src/zeit.rs`, `src/staerke.rs` |
| `frontend/src/assets` | Schriftdateien (`fonts/`) | — |
| `frontend/src/marke` | Bildmarke „Lebenslinie“ und PWA-Manifest | — |
| `frontend/src/huelle` | Einzige Stelle, die die Kennung der Hüllen liest (`__LIFELINE_HUELLE__`) | `src-tauri`, `ios`, `android` |
| `frontend/src/heic` | HEIC-Vorschau im Browser per `libheif-js` (LGPL, `heic/LIESMICH.md`) | WASM aus `src/static_files.rs` |
| `frontend/src/command-palette` | Sprungpalette mit Befehlen, Datensätzen, Adress- und Koordinatensprung ([AGENTS.md](../../frontend/src/command-palette/AGENTS.md)) | `src/benutzer_einstellungen` |
| `frontend/src/druck` | Druckmechanik und Listendruck ([AGENTS.md](../../frontend/src/druck/AGENTS.md)) | Listenrouten der Fachmodule |
| `frontend/src/hilfe` | Hilfe-Seite mit den Kapiteln aus `docs/anwender/kapitel/` | — |
| `frontend/src/neuigkeiten` | Versionshinweise aus dem CHANGELOG | `src/versionsstand` |
| `frontend/src/rueckmeldung` | Adresse des Rückmeldeformulars (GitHub-Issue) mit Version und Routenmuster | `.github/workflows/rueckmeldung.yml` |
| `frontend/src/alarm` | Benachrichtigungen, Alarmton, Badge, Desktop-Alarm, Anmeldung für Web Push und iOS-Push (`pushKanal.ts` wählt) | `src/benachrichtigung`, `src/web_push`, `src/ios_push` |
| `frontend/src/test` | Test-Setup, Attrappen und Hilfen der Vitest-Suite | — |
| `frontend/src/pages` | Seiten der Module; Unterordner u. a. `lagekarte` ([AGENTS.md](../../frontend/src/pages/lagekarte/AGENTS.md)), `lage-dashboard`, `uhs`, `gefahren`, `einstellungen` | je Modul |

### Einsatz, Lage und Karte

| Pfad | Zweck | Gegenstück im Backend |
| --- | --- | --- |
| `frontend/src/einsatz` | Einsatz-Layout, Modulregistry, Navigation, Schreibrecht, Modulsperre | `src/einsatz` |
| `frontend/src/etb` | Zeitachse, Erfassung, Bausteine, Druck, Entwürfe ([AGENTS.md](../../frontend/src/etb/AGENTS.md)) | `src/etb`, `src/etb_baustein` |
| `frontend/src/lage` | Nur der Fixture-Test der Zählregeln (`tests/fixtures/verdichtung/regeln.json`) | `src/einsatz/zaehler.rs` (Gegenprobe `tests/verdichtung_fixture.rs`) |
| `frontend/src/lagemeldungen` | Zeitachse der Lagemeldungen | `src/meldung` |
| `frontend/src/karten` | Verwaltung der Online-Quellen und Offline-Karten samt Region-Bau | `src/karte` |
| `frontend/src/zeichen` | Taktische Zeichen: Übersetzung der Fachobjekte nach `@einsatzzeichen` | `src/freies_zeichen` |
| `frontend/src/wetter` | Wetter- und Pegel-Paneele, Unwetterhinweis | `src/wetter`, `src/pegel` |
| `frontend/src/pegel` | Pegel-Kennzahl | `src/pegel` |

### Kräfte und Mittel

| Pfad | Zweck | Gegenstück im Backend |
| --- | --- | --- |
| `frontend/src/kraefte` | Kräfteübersicht, Disposition, FMS, Material, Kräfte-Zeitachse ([AGENTS.md](../../frontend/src/kraefte/AGENTS.md)) | `src/einheit`, `src/fahrzeug`, `src/personal`, `src/material`, `src/zeitachse` |
| `frontend/src/einheit` | Kern „Einheit aus Vorlage bilden“ | `src/einheit` |
| `frontend/src/abloesung` | Ablösung, Einstufung, Schichtmodell-Dialog | `src/abloesung`, `src/schichtmodell` |
| `frontend/src/bereitstellungsraum` | BR-Zahlen und Eintreffen-Keys | `src/bereitstellungsraum` |
| `frontend/src/stammdaten` | Org-Kataloge: Fahrzeuge, Personal, Material, Vorlagen, Bausteine, Stellen, Funktionen | `src/fahrzeug`, `src/personal`, `src/einheit_vorlage`, `src/einsatz_vorlage`, `src/externe_stelle`, `src/org` |

### Betroffene und Betreuung

| Pfad | Zweck | Gegenstück im Backend |
| --- | --- | --- |
| `frontend/src/personen` | Betroffene, Sichtung, Patientenkopf, Erfassung, Druck ([AGENTS.md](../../frontend/src/personen/AGENTS.md)) | `src/person`, `src/uhs` |
| `frontend/src/planung` | Vorplanung ohne Einsatz: Liste, Planungsseite mit Kopf, Posten, Helfern und Plan; Adapter `planungZeilen.ts` auf Raster, Blockdialog und Handy-Liste des Schichtplans (LLH-1586); Dialog „In Einsatz übernehmen“ mit der Vorschau des Einlesens (LLH-1587); Reiter „Ablauf“ über `AblaufListe` (LLH-1583) | `src/planung`, `frontend/src/abloesung/schichtplan` |
| `frontend/src/betreuung` | Evakuierungsbezirke und Betreuungsstellen ([AGENTS.md](../../frontend/src/betreuung/AGENTS.md)) | `src/betreuung` |
| `frontend/src/verpflegung` | Zeitfenster, Deckung, Ausgabeansicht, Stellen | `src/verpflegung` |

### Kommunikation und Meldungen

| Pfad | Zweck | Gegenstück im Backend |
| --- | --- | --- |
| `frontend/src/kommunikation` | Geteilte Primitive für Chat, Erinnerung, Auftrag, Meldung, Nachforderung | `src/kommunikation` |
| `frontend/src/chat` | Kanäle, Nachrichtenstrom, Erwähnungen, Heraufstufen | `src/chat` |
| `frontend/src/erinnerung` | Erinnerungsliste und -formular | `src/erinnerung` |
| `frontend/src/auftraege` | Aufträge und Befehle: Liste, Detail, Erteilen, Vollzug, Druck | `src/auftrag`, `src/befehl` |
| `frontend/src/befehle` | Befehlsvorlagen und Aktionsleiste | `src/befehl` |
| `frontend/src/meldungen` | Meldungsformular, Liste, Korrektur, Rückmeldung | `src/meldung` |
| `frontend/src/nachforderungen` | Board, Zusage, Übernahme als Einheit oder Material | `src/nachforderung` |

### Führungsorganisation

| Pfad | Zweck | Gegenstück im Backend |
| --- | --- | --- |
| `frontend/src/fernmeldewesen` | Funkplan, Skizze, Sprechgruppen, Kommunikationsplan ([AGENTS.md](../../frontend/src/fernmeldewesen/AGENTS.md)) | `src/fernmeldewesen`, `src/sprechgruppe` |
| `frontend/src/fuehrung` | Auswahl von Führungsfunktionen und Empfängern ([AGENTS.md](../../frontend/src/fuehrung/AGENTS.md)) | `src/fuehrung` |
| `frontend/src/lagebesprechung` | Termin, Vorbereitung, Abschluss, Verlauf ([AGENTS.md](../../frontend/src/lagebesprechung/AGENTS.md)) | `src/lagebesprechung` |
| `frontend/src/programmpunkt` | Paneel „Ablauf“ der Einsatzdaten, `AblaufListe` ohne Datenquelle auch für die Planung, anstehende Programmpunkte | `src/programmpunkt` |
| `frontend/src/lageberichte` | Lageberichte mit Übernahmen aus der Lage | `src/lagebericht` |
| `frontend/src/entwurf` | Gegliederte Dokumente `DokumentEntwurf`, Freigabe, Anlagen, Verteiler ([AGENTS.md](../../frontend/src/entwurf/AGENTS.md)) | `src/vorlagendokument` |
| `frontend/src/infotelefon` | Anruferfassung ([AGENTS.md](../../frontend/src/infotelefon/AGENTS.md)) | `src/infotelefon` |
| `frontend/src/dokumente` | Dokument ablegen und bearbeiten | `src/dokument` |

### Geräte, Verwaltung und Archiv

| Pfad | Zweck | Gegenstück im Backend |
| --- | --- | --- |
| `frontend/src/geraet` | Gerätehülle, Funktionsansichten, Koppeln, Lagemonitor ([AGENTS.md](../../frontend/src/geraet/AGENTS.md)) | `src/geraet` |
| `frontend/src/extern` | Seite `/extern` des Lagebilds für Externe, ohne Anmeldung, Schlüssel aus dem Fragment | `src/lagebild_extern` |
| `frontend/src/admin` | Verwaltungslayout, Datenträgerwarnung, Demo-Daten | `src/datentraeger`, `src/demo` |
| `frontend/src/instanz` | Verwaltungsseite „Instanzkopplung“: Identität, Kopplungen, Unterschriftsschlüssel (WebAuthn), Stammdaten-Stand, „ELW verloren“; Herkunfts-Abzeichen und Sperre „Wird am Hub gepflegt“ für die Stammdaten-Seiten (`herkunft.tsx`); Führung je Einsatz: Paneel, Hinweisband, „Einsätze beim Gegenüber“ (LLH-1491); Direktkopplung vor Ort: „Code vor Ort“, „Im Netz suchen“, Chip und Zertifikat an der Kopplung (LLH-1497) | `src/instanz`, `src/auth/unterschrift` |
| `frontend/src/zugangsprotokoll` | Anmelde- und Admin-Spur | `src/auth` (`/api/zugangsprotokoll`) |
| `frontend/src/aufbewahrung` | Aufbewahrungsübersicht, Archivakte, Fristen, Schwärzungsantrag, Archiv-Download | `src/aufbewahrung`, `src/org` |

## 5.4 Ebene 2: weitere Teilprojekte

### `src-tauri`

Crate `lifeline-desktop` (Tauri 2), Regeln in [src-tauri/AGENTS.md](../../src-tauri/AGENTS.md).
`src-tauri/src/main.rs` baut Fenster, Plugins und Commands, `menue.rs` das Menü;
`adresse.rs`, `deeplink.rs` und `verbindung.rs` tragen Serveradresse, Deeplink
`lifeline://verbinden` und gespeicherte Verbindungen; `anmeldung.rs`, `aswas.rs` und `pkce.rs` die
Anmeldung im Systembrowser; `links.rs` und `erreichbar.rs` neue Fenster, Links und die Wache über
das Laden des Servers; `vertrag.rs` die Prüfung des Hüllen-Vertrags vor jedem Laden (`GET
/api/shell`, LLH-1982); `kanal.rs` und `update.rs` Update-Kanal und Updater. Die Init-Skripte
(`kennung.js`, `faehigkeiten.js`, `benachrichtigung.js`, `druck.js`) liegen daneben, die Rechte
unter `src-tauri/capabilities/`.

### `ios`

Die iOS-Hülle (LLH-1978, ADR-0068), Regeln in [ios/AGENTS.md](../../ios/AGENTS.md).
`ios/LifelineKern` ist ein Swift-Paket ohne UIKit und WebKit (`ios/LifelineKern/Package.swift`):
Adressprüfung (`Adresse.swift`), Deeplink (`Deeplink.swift`), Linkregeln (`Linkregeln.swift`),
Serverliste (`Serverliste.swift`), Vertragsprüfung gegen `GET /api/shell` (`Vertrag.swift`),
Onboarding (`Onboarding.swift`), Haptik-Abbildung (`Haptik.swift`) sowie Nutzlast und Anmeldungen
des iOS-Push (`PushNutzlast.swift`, `PushAnmeldungen.swift`). Seine Suite liest die gemeinsamen
Fälle der Desktop-Hülle aus `src-tauri/faelle/` und läuft auch unter Linux (Schritt 18 von
`scripts/check-all.sh`); `AppVersion.swift` liest die Version aus der Info.plist. `ios/App` trägt
das App-Target `LifelineHub` (Einstieg `ios/App/LifelineHubApp.swift`); das Init-Skript
`ios/App/Huelle/huelle.js` meldet der Seite die Kennung `__LIFELINE_HUELLE__` und beschreibt das
Wire-Format der Brücke in seinem Kopf. Die Notification Service Extension
`ios/Benachrichtigungsdienst` entschlüsselt Push-Meldungen über APNs (`Dienst.swift`);
Schlüsselbund, Entschlüsseln und App Group teilt sie mit der App über `ios/Gemeinsam`. Das
Xcode-Projekt erzeugt XcodeGen aus `ios/project.yml` (App, Extension, `ios/AppTests`,
`ios/AppUITests`, lokales Paket `LifelineKern`), die Version schreibt `scripts/ios/version.sh`.

### `android`

Die Android-Hülle (LLH-1989, ADR-0084), Regeln in [android/AGENTS.md](../../android/AGENTS.md).
`android/kern` ist ein eigener Gradle-Build für Kotlin/JVM ohne Android-SDK
(`android/kern/build.gradle.kts`), Gegenstück zu `ios/LifelineKern`: Adressprüfung
(`Adresse.kt`), Deeplink, Linkregeln und Linkweiche, Serverliste und ihre Ablage, Vertragsprüfung
gegen `GET /api/shell` (`Vertrag.kt`), Ablauf und Onboarding, Brücke und ihre Ausführung,
Anmeldung im Browser, Statustexte, Testzustände, Kanal und Update-Entscheidungen (`Kanal.kt`,
`Update.kt`). Seine Suite liest die gemeinsamen Fälle aus `src-tauri/faelle/` und braucht nur ein
JDK (Schritt 20 von `scripts/check-all.sh`). `android/app` ist die App
`dev.rubeen.lifeline.android` (Einstieg `MainActivity.kt`, Ausführung in `AppModell.kt`): native
Seiten unter `seiten/`, WebView je Profil, Brücke und Vertragsabruf unter `web/`, Systemdienste
(Haptik, Meldung, Druck, Downloads, Anmeldung) unter `dienste/`, Updater unter `update/`; das
Init-Skript `android/app/src/main/assets/huelle.js` meldet der Seite die Kennung
`__LIFELINE_HUELLE__` und beschreibt das Wire-Format in seinem Kopf. `android/gradle` trägt
Wrapper und Versionskatalog `libs.versions.toml`, `android/settings.gradle.kts` bindet den Kern per
`includeBuild` ein; die Version schreibt `scripts/android/version.sh`.

### `push-relais`

Eigenes Binary im Workspace (`push-relais/Cargo.toml`, Abbild `push-relais/Dockerfile`), Regeln in
[push-relais/AGENTS.md](../../push-relais/AGENTS.md), Betrieb in
[`docs/betrieb/push-relais.md`](../betrieb/push-relais.md). `push-relais/src/api.rs` trägt die
Routen samt Bearer-Prüfung und Grenzen (Nachrichten je Server und Minute, Registrierungen je IP und
Stunde), `senden.rs` einen Aufruf von `/v1/senden` (Prüfung des Servers, Versand, Zählung im Log),
`apns.rs` den HTTP/2-Client mit dem Anbieter-Token (ES256 aus dem `.p8`) und die Abbildung der
Apple-Antworten auf `zugestellt`, `token_ungueltig`, `gedrosselt` und `fehler`, `speicher.rs` die
SQLite-Tabelle `server` (Hash des Geheimnisses, Kontakt, Version, Sperre), `config.rs` die Umgebung
`PUSH_RELAIS_*`. Es gehört nicht zur ausgelieferten Anwendung.

### `karten-service`

Eigenes Binary im Workspace (`karten-service/Cargo.toml`, Abbild `karten-service/Dockerfile`).
`karten-service/src/api.rs` trägt die HTTP-API, `regions.rs` den Regionssatz, `jobs.rs`,
`worker.rs` und `scheduler.rs` Job-Registry, Abarbeitung (ein Build-Slot) und zeitgesteuerte
Bauten mit Warteschlangengrenze, `build/` den `MakeRunner` (ruft `make tiles` in `karten-build`)
und die Validierung, `storage/s3.rs` die Ablage, `manifest.rs` den veröffentlichten Bestand. Lokal
dient Garage als S3-Speicher (`compose.yml`).

### `crates/karten-katalog`

Lib-Crate mit `OfflineKatalogEintrag` und den Job-Typen des Kartenbaus
(`crates/karten-katalog/src/lib.rs`); `lifeline-hub` bindet es mit Feature `schema` für den
Typ-Codegen ein, `karten-service` ohne (`Cargo.toml`, `karten-service/Cargo.toml`).

### `crates/lifeline-machine-client`

Lib-Crate für Fremdsysteme (`crates/lifeline-machine-client/src/lib.rs`): Code ableiten und
einlösen (`prepare_redeem`, `finish_redeem`), Anfragen signieren (`Credentials::sign_request`),
Antworten prüfen (`verify_response`), mit Feature `http` auch `redeem` und `me`. Es hängt nicht vom
Server ab; die Testvektoren `docs/api/machine-auth-testvektoren.json` prüfen beide gegeneinander.
`lifeline-hub` bindet es für das Kommando `zugang` ein (`src/public_api/kommando.rs`).

### `karten-build`

`Makefile` und Skripte (`gen-assets.sh`, `gen-world-overview.sh`) um das Abbild
`versatiles/versatiles-planetiler`; Ergebnis ist `out/result/osm*.mbtiles` mit `.sha256`. Ein
gebautes Paket wird von Hand in `default_offline_katalog()` in `src/config.rs` eingetragen
(`karten-build/README.md`).

### `website`

Eigenständiges Astro-Projekt (`website/package.json`), Seiten unter `website/src/pages/`
(Start, `404.astro`, `doku/`). Kopien aus dem Frontend (Rollen-CSS, Modulliste, Bildmarke,
Hilfe-Gruppen) und die Bereitstellung über Cloudflare Pages regelt
[website/AGENTS.md](../../website/AGENTS.md).
