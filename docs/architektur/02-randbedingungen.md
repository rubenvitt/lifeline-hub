# 2. Randbedingungen

Stand: 23.10.2026 (alpha dcc500f5).

Dieses Kapitel nennt die Vorgaben, die den Entwurf begrenzen. Die Regeln selbst stehen in den
verlinkten Dateien; hier steht nur, dass es sie gibt und was sie für die Architektur bedeuten.

## 2.1 Technische Randbedingungen

| Randbedingung | Bedeutung für die Architektur | Beleg |
| --- | --- | --- |
| Backend in Rust (stable, Edition 2021) auf `axum` und `tokio`, Datenzugriff über `sqlx` | Ein Prozess bedient API, Live-Kanal und die eingebettete Oberfläche | [`Cargo.toml`](../../Cargo.toml); [`README.md`](../../README.md), Abschnitt „Bauen“ |
| Cargo-Workspace mit vier Paketen: `lifeline-hub`, `crates/karten-katalog`, `karten-service`, `src-tauri` | Server und Desktop-Hülle teilen eine Versionsquelle (`[workspace.package]`) | [`Cargo.toml`](../../Cargo.toml) |
| SQLite eingebettet (`libsqlite3-sys`, Feature `bundled`) | Keine Datenbank neben dem Server; ein SQLite-CVE schließt nur ein Crate-Bump mit Neubau | [`Cargo.toml`](../../Cargo.toml); [`docs/betrieb/packaging.md`](../betrieb/packaging.md) |
| OpenSSL statisch eingebacken (`openssl`, Feature `vendored`), weil `webauthn-rs` es unbedingt zieht | Bau braucht Perl und C-Compiler; das Binary braucht keine OpenSSL-Laufzeit, das Container-Abbild bleibt distroless | [`Cargo.toml`](../../Cargo.toml); [`Dockerfile`](../../Dockerfile) |
| Ausgehendes HTTP über `reqwest` mit `rustls`; `openidconnect` ohne eigene HTTP-Features | Nur ein TLS-Stack im Graphen, sonst könnte rustls den Krypto-Anbieter nicht bestimmen | [`Cargo.toml`](../../Cargo.toml); Kopf von `src/auth/oidc/mod.rs` |
| Bilddecoder nur reines Rust (`image` ohne `-sys`-Crates) | Das Single-Binary bleibt ohne C-Bibliothek | [`Cargo.toml`](../../Cargo.toml) |
| Frontend in React 19 mit antd 6, TypeScript 6, Vite 8, MapLibre GL, als PWA über `vite-plugin-pwa` | Die Oberfläche läuft im Browser, in der Desktop-Hülle und auf gekoppelten Geräten aus demselben Bündel | [`frontend/package.json`](../../frontend/package.json) |
| Node `26.7.0` und pnpm `11.10.0` exakt gepinnt, nur über `mise` | Jede Maschine prüft dasselbe; der Abgleich mit `packageManager` und `engines` läuft im Gate | [`mise.toml`](../../mise.toml), Block `[tools]`; `scripts/check-toolversionen.sh` |
| Desktop-Hülle mit Tauri 2, ohne Anwendungslogik: der Webview lädt die Adresse des Servers | Fachlogik gibt es nur im Server und im Frontend | [`src-tauri/AGENTS.md`](../../src-tauri/AGENTS.md) |
| Konfiguration nur über die clap-`Config` in `src/config.rs`, kein `std::env::var` in anderen Modulen | Jeder Schalter steht in `--help` und im Startlog | [`docs/betrieb/env-registry.md`](../betrieb/env-registry.md); Wächter `tests/env_config_guard.rs` |
| Frontend-Typen werden aus dem OpenAPI-Dokument des Backends erzeugt (`utoipa` → `openapi-typescript`) | Backend ist die Wahrheitsquelle des Vertrags zwischen Server und Client | `src/AGENTS.md`, Abschnitt „Backend↔Frontend — Typ-Codegen“; `src/api_doc.rs`, `frontend/src/api/types.generated.ts` |
| Migrationen werden nur angehängt, nie geändert | sqlx prüft die Prüfsumme jeder Datei; eine geänderte bräche jede bestehende Datenbank | Wurzel-[`AGENTS.md`](../../AGENTS.md), Abschnitt „Backend — Migrationsvergabe“ |
| Zielplattformen: Container für amd64 und arm64, Binary auch für Windows (`--target x86_64-pc-windows-gnu`), Desktop-Pakete | Kein plattformgebundener Code im Server ohne Ausweichweg | [`README.md`](../../README.md), Abschnitte „Bauen“ und „Starten“; [`docs/betrieb/desktop-app.md`](../betrieb/desktop-app.md) |

## 2.2 Organisatorische Randbedingungen

| Randbedingung | Bedeutung | Beleg |
| --- | --- | --- |
| Lizenz „alle Rechte vorbehalten“, keine Open-Source-Lizenz; Beiträge von außen werden nicht angenommen | Der Quelltext ist öffentlich einsehbar, Nutzung braucht eine Anfrage | [`README.md`](../../README.md), Abschnitt „Lizenz — alle Rechte vorbehalten“ |
| Frühe Alpha ohne Release-Zusage für Migrationspfade | Datenmodell und Schnittstellen dürfen sich ändern | [`README.md`](../../README.md) |
| Branches: `alpha` ist Entwicklungs- und Vorabkanal, `beta` Vorabkanal, `main` stabil; Freigaben als Merge-Commit, nicht Squash | Releases je Kanal über semantic-release aus Conventional Commits | [`release.config.mjs`](../../release.config.mjs), `branches`; Wurzel-[`AGENTS.md`](../../AGENTS.md), Abschnitt „Backend — Migrationsvergabe“ |
| Release erst nach grünem Bau aller Plattformen, Ausrollen per Pull-Agent auf dem Zielserver | Kein eingehender Weg von GitHub auf den Server | [`scripts/AGENTS.md`](../../scripts/AGENTS.md); Kopf von [`.github/workflows/deployment.yml`](../../.github/workflows/deployment.yml) |
| Ein Gate vor jedem Merge: `scripts/check-all.sh`, die CI ruft es unverändert | Neue Prüfungen kommen ins Skript, nicht in die Workflows | Wurzel-[`AGENTS.md`](../../AGENTS.md), Abschnitt „Qualitäts-Gates“; [`scripts/AGENTS.md`](../../scripts/AGENTS.md); [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) |
| Planung über OpenSpec (Änderungszyklus), Arbeitsdisziplin über Superpowers; eine Change nur auf der Route `entwurf` | Entscheidungen haben eine Herleitung im Archiv (`openspec/changes/archive/*/design.md`) | Wurzel-[`AGENTS.md`](../../AGENTS.md), Abschnitt „Planung und Ausführung“ |
| Aufgabenverwaltung in Zunder; alte Kennungen `LFH-<n>` bleiben gültig | Kennungen in Kommentaren, Commits und dieser Doku führen auf Aufgaben | Wurzel-[`AGENTS.md`](../../AGENTS.md), Abschnitt „Zunder“ |
| Regeln liegen in `AGENTS.md`-Dateien beim betroffenen Code; es gibt keine `CLAUDE.md` | Eine Regel steht genau einmal; diese Doku verweist darauf | Wurzel-[`AGENTS.md`](../../AGENTS.md), Abschnitt „Wo die Regeln stehen“ |
| Lizenzauflagen der Fremddaten: Pflicht-Attribution, teils nur nicht-gewerbliche Nutzung (NINA), ODbL für OpenStreetMap | Attribution reist mit jeder Fachebene bis in die Karte | [`docs/fachebenen-quellen.md`](../fachebenen-quellen.md) |
| LGPL-Bibliothek `libheif-js` im Browser mit Austauschweg und Quelltextpaket je Release | Der Betreiber darf die Bibliothek ersetzen (`--heic-decoder-verzeichnis`) | `frontend/src/heic/LIESMICH.md`; [`docs/betrieb/env-registry.md`](../betrieb/env-registry.md); [`scripts/AGENTS.md`](../../scripts/AGENTS.md) |

## 2.3 Konventionen

| Konvention | Wo sie steht |
| --- | --- |
| Bezeichner: Fachbegriffe deutsch, Technik englisch; Prosa deutsch | Wurzel-[`AGENTS.md`](../../AGENTS.md), Abschnitt „Bezeichner-Sprache“; Spec [`bezeichner-sprache`](../../openspec/specs/bezeichner-sprache/spec.md) |
| Schreibweise der Dateinamen | Spec [`dateinamen-schreibweise`](../../openspec/specs/dateinamen-schreibweise/spec.md); Wächter `scripts/check-schreibweisen.sh` |
| Commit-Nachrichten nach Conventional Commits | [`README.md`](../../README.md), Abschnitt „Entwickeln“ |
| Statuscodes, Eingabegrenzen, Schutzköpfe, Anhänge im Backend | [`src/AGENTS.md`](../../src/AGENTS.md) |
| Gestaltungssprache, UI-Form, Bedien-Leitlinie, Erfassung, Deeplinks, Query-Keys, Browserspeicher | [`frontend/AGENTS.md`](../../frontend/AGENTS.md) |
| Fachbegriffe der Oberfläche | Spec [`bedien-begriffe`](../../openspec/specs/bedien-begriffe/spec.md) |
| Mitänderung der Anwenderdoku bei Änderungen an der Oberfläche | [`docs/anwender/AGENTS.md`](../anwender/AGENTS.md) |
| Mitänderung dieser Architekturdoku und ADR-Format | [`AGENTS.md`](AGENTS.md) dieses Verzeichnisses |
