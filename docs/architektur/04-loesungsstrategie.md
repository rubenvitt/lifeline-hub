# 4. Lösungsstrategie

Stand: 23.10.2026 (alpha dcc500f5).

Dieses Kapitel fasst die tragenden Entscheidungen in Tabellen zusammen: zuerst die
Technologiewahl, dann je Qualitätsziel aus [Kapitel 1](01-einfuehrung-und-ziele.md) die Ansätze,
mit denen das System es erreicht. Die einzelnen Entscheidungen mit Regeln und Prüfung stehen als
ADRs in [Kapitel 9](09-architekturentscheidungen.md), die Bausteine in
[Kapitel 5](05-bausteinsicht.md), die Konzepte im Detail in
[Kapitel 8](08-querschnittliche-konzepte.md).

## 4.1 Technologie und Grundgliederung

| Entscheidung | Ansatz | Beleg |
| --- | --- | --- |
| Ein Serverprozess statt verteilter Dienste | Das Backend `lifeline-hub` (Rust, `axum`, `tokio`) bedient API, Live-Kanal und Oberfläche aus einem Prozess. Nur der Kartenbau ist als eigener Dienst `karten-service` ausgelagert, weil er schwer und selten ist. | [`Cargo.toml`](../../Cargo.toml); `src/main.rs`, `src/app.rs`; `karten-service/src/main.rs` |
| Oberfläche im Binary | Das Frontend (`frontend`, React, antd, Vite) wird als `frontend/dist` per `rust-embed` eingebettet; `scripts/build-release.sh` erzwingt, dass es neu gebaut und eingebettet wird. Glyphs und Sprites der Offline-Karte liegen ebenso im Binary. | `src/static_files.rs`, `src/karte/assets.rs`; [`README.md`](../../README.md), Abschnitt „Bauen“ |
| Eingebettete Datenbank | SQLite im WAL-Modus, ins Binary kompiliert; Schema über angehängte `sqlx`-Migrationen. Nachschlage-Caches (Geocoding, Fachebenen, KRITIS) und der Tile-Cache liegen in eigenen Dateien, damit sie nicht um den einzigen Schreiber der Haupt-DB konkurrieren. | `src/db.rs`, `migrations/`; Köpfe von `src/cache_db.rs` und `src/karte/tile_cache.rs` |
| Desktop als dünne Hülle | `src-tauri` (Tauri 2) lädt die Adresse des Servers in einen Webview und ergänzt nur, was der Webview nicht kann (Druck, native Meldung, Anmeldung im Systembrowser). | [`src-tauri/AGENTS.md`](../../src-tauri/AGENTS.md) |
| Ein Vertrag zwischen Server und Client | Das Backend beschreibt seine Antworten per `utoipa` als OpenAPI; daraus entstehen die TypeScript-Typen des Frontends. Ein Gate-Schritt erkennt Drift. | `src/api_doc.rs`, `frontend/src/api/types.generated.ts`; `src/AGENTS.md`, Abschnitt „Backend↔Frontend — Typ-Codegen“ |
| Geteilte Kartentypen | Der Katalogtyp der Offline-Karten liegt im Crate `crates/karten-katalog`, das Server und `karten-service` teilen. | [`Cargo.toml`](../../Cargo.toml) (Kommentar am Eintrag `karten-katalog`) |

## 4.2 Ansätze je Qualitätsziel

### Q1 Einsatztauglichkeit

| Ziel | Ansatz | Beleg |
| --- | --- | --- |
| Bedienbar in jedem Einsatzkontext | Eine Bedien-Leitlinie mit vier Kontexten und einer Prüfliste von 15 Kriterien gilt für jede neue oder umgebaute Seite. | Bedien-Leitlinie in [`frontend/AGENTS.md`](../../frontend/AGENTS.md) |
| Passende Dichte ohne Einstellung | Die Dichtestufe folgt aus dem Gerät, nicht aus der Person. | Spec [`bedien-dichte`](../../openspec/specs/bedien-dichte/spec.md) |
| Zusicherungen statt Augenmaß | Gerenderte Layout-Prüfungen für Trefflächen, Leisten und Fokus auf den Bezugsgrößen Fükw, Führungs-Tablet und Handschirm. | Spec [`einsatztauglichkeit-layout`](../../openspec/specs/einsatztauglichkeit-layout/spec.md) |
| Eine Gestaltungssprache | Gestaltungssprache „Instrumententafel“ und UI-Form-Leitlinie in einer Datei, Farbrollen mit Kontrastprüfung. | [`frontend/AGENTS.md`](../../frontend/AGENTS.md); Spec [`farbrollen-kontrast`](../../openspec/specs/farbrollen-kontrast/spec.md) |

### Q2 Verfügbarkeit ohne Netz und Aktualität

| Ziel | Ansatz | Beleg |
| --- | --- | --- |
| Server vor Ort ohne Internet | Ein Binary mit Oberfläche, SQLite, OpenSSL, Glyphs und Sprites; Offline-Karten als MBTiles-Dateien, deren Kacheln der Server selbst ausliefert. | [`README.md`](../../README.md); `src/karte/mbtiles.rs`, `src/routes/karte.rs` |
| Lage lesbar ohne Verbindung | Ausgewählte Abfragen (Registry `LAGEBILD_OFFLINE`) liegen in einer eigenen IndexedDB auf dem Gerät, mit Veraltungsanzeige und Löschregeln; die App-Hülle cacht ein Service Worker. | [`frontend/src/offline/AGENTS.md`](../../frontend/src/offline/AGENTS.md); Spec [`lagebild-offline-lesen`](../../openspec/specs/lagebild-offline-lesen/spec.md); `vite-plugin-pwa` in [`frontend/package.json`](../../frontend/package.json) |
| Schreiben ohne Verbindung | Offline-fähige Erfassungen gehen in eine Warteschlange mit `client_id` und Erfassungszeit nach der Serveruhr und werden beim Wiederverbinden gesendet. | [`frontend/src/offline/AGENTS.md`](../../frontend/src/offline/AGENTS.md), Abschnitt „Schreiben ohne Netz“; `frontend/src/offline/queue.ts` |
| Aktuelles Lagebild mit Verbindung | Der Server sendet Live-Ereignisse per Server-Sent Events; der Client ruft daraufhin gezielt neu ab und gleicht nach einem Wiederaufbau ab. | `src/live/`; Spec [`live-abgleich`](../../openspec/specs/live-abgleich/spec.md) |
| Fremdquellen fallen aus, die Arbeit nicht | Stale-While-Revalidate mit Cache, Status `offline` statt 5xx, Obergrenzen für Warnungen; ein Ausfall des Identitätsanbieters legt die lokale Anmeldung nicht lahm. | [`docs/fachebenen-quellen.md`](../fachebenen-quellen.md); Köpfe von `src/wetter/abruf.rs`, `src/pegel/abruf.rs`, `src/auth/oidc/mod.rs` |
| Kleine Rechner im Feld überleben fremde Antworten | Jede ausgehende Antwort wird nur bis zu einer Obergrenze eingelesen, auch entpackt. | Kopf von `src/http_begrenzt.rs` |

### Q3 Datenschutz und Sicherheit

| Ziel | Ansatz | Beleg |
| --- | --- | --- |
| Rechte im einzelnen Einsatz | Rollen `Einsatzleitung`, `Fuehrungspersonal`, `Beobachter` je Einsatz; die Modulfreigabe hat eine Quelle, den Server. | `src/einsatz/mod.rs`, `src/einsatz/berechtigung.rs`; Specs [`einsatz-zugriff`](../../openspec/specs/einsatz-zugriff/spec.md), [`modul-freigabe`](../../openspec/specs/modul-freigabe/spec.md) |
| Personendaten nur so lange wie nötig | Sperre nach Frist, Schwärzung nach Karenz, pseudonymes ETB-Skelett, Löschprotokoll; Offline-Bestände auf Geräten werden mitgeräumt. | `src/aufbewahrung/`; Spec [`aufbewahrung`](../../openspec/specs/aufbewahrung/spec.md); `frontend/src/offline/schwaerzungsWaechter.ts` |
| Geräte ohne Personenkonto | Befristete, widerrufbare Kopplung an genau einen Einsatz mit eigener Urheberschaft in ETB und Audit. | `src/geraet/`; Spec [`geraete-kopplung`](../../openspec/specs/geraete-kopplung/spec.md) |
| Anmeldung | Passwort (Argon2), TOTP als zweiter Faktor, Passkeys (WebAuthn), OIDC; Bremse gegen Fehlversuche je Quelle. | `src/auth/`; `argon2`, `totp-rs`, `webauthn-rs`, `openidconnect` in [`Cargo.toml`](../../Cargo.toml); [`docs/betrieb/env-registry.md`](../betrieb/env-registry.md) |
| Nachweis von Zugriffen | Zugangsprotokoll der Verwaltung, Zugriffsprotokoll je Person. | Specs [`zugangsprotokoll`](../../openspec/specs/zugangsprotokoll/spec.md), [`personen-zugriffsprotokoll`](../../openspec/specs/personen-zugriffsprotokoll/spec.md) |
| Abwehr am Rand | Schutzköpfe an jeder Antwort, Eingabegrenzen an Schreibendpunkten, SSRF-Schutz für admin-eingegebene Ziele, Virenscan der Uploads, sofern ein clamd angebunden ist, mit Abweisung bei Scanner-Ausfall, verschlüsselte Sicherungen an `age`-Empfänger. | [`src/AGENTS.md`](../../src/AGENTS.md); `src/karte/download.rs`, `src/karte/proxy.rs`; `src/backup/verschluesselung.rs` |

### Q4 Datenintegrität bei Nebenläufigkeit

| Ziel | Ansatz | Beleg |
| --- | --- | --- |
| Kein `SQLITE_BUSY` beim Lock-Upgrade | Schreibtransaktionen beginnen mit `BEGIN IMMEDIATE`, eine zentrale Schicht wiederholt bei Belegung und endet mit 503. | Kopf von `src/tx.rs` |
| Kein stilles Überschreiben | Zeilen- und Feld-CAS mit 409 bei zwischenzeitlicher Änderung. | [`src/AGENTS.md`](../../src/AGENTS.md), Abschnitt „Backend — Statuscode-Konvention“ |
| Kein doppelter Eintrag beim Wiederholen | Unique-Index auf `(einsatz_id, client_id)` und idempotentes Anlegen. | `anlegen_idempotent` in `src/etb/repo.rs`; `migrations/0088_etb_client_id.sql` |
| Dokumentation bleibt Dokumentation | ETB-Einträge werden nicht geändert, nur berichtigt. | Spec [`etb-berichtigung`](../../openspec/specs/etb-berichtigung/spec.md) |

### Q5 Wartbarkeit

| Ziel | Ansatz | Beleg |
| --- | --- | --- |
| Eine Durchsetzungsinstanz | `scripts/check-all.sh` vor jedem Merge, die CI ruft es unverändert. | Wurzel-[`AGENTS.md`](../../AGENTS.md), Abschnitt „Qualitäts-Gates“; [`scripts/AGENTS.md`](../../scripts/AGENTS.md) |
| Regeln beim Code | `AGENTS.md` je Bereich, eine Regel steht genau einmal. | Wurzel-[`AGENTS.md`](../../AGENTS.md), Abschnitt „Wo die Regeln stehen“ |
| Nachvollziehbare Änderungen | OpenSpec-Changes mit `design.md`, Fähigkeits-Specs unter `openspec/specs/`, ADRs mit maschineller Prüfung. | Wurzel-[`AGENTS.md`](../../AGENTS.md), Abschnitt „Planung und Ausführung“; [`AGENTS.md`](AGENTS.md) dieses Verzeichnisses |
| Lesbarer Code | Fachbegriffe deutsch, Technik englisch. | Wurzel-[`AGENTS.md`](../../AGENTS.md), Abschnitt „Bezeichner-Sprache“ |
