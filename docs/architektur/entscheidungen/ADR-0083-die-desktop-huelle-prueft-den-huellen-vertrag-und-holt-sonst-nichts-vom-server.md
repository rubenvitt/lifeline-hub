---
id: ADR-0083
titel: Die Desktop-App ist eine Tauri-Hülle ohne Anwendungslogik, die vor dem Laden nur den Hüllen-Vertrag abfragt
status: akzeptiert
datum: 2026-11-22
gilt_fuer:
  - src-tauri/**
  - frontend/package.json
  - frontend/src/huelle/**
ersetzt: ADR-0009
herleitung:
  - docs/superpowers/specs/2026-11-22-u6nydc46-huellen-vertrag-desktop-design.md
  - openspec/changes/archive/2026-09-29-lfh-720-tauri-huelle-variante-a/design.md
  - openspec/changes/archive/2026-09-30-lfh-721-desktop-app-paketieren/design.md
  - openspec/changes/archive/2026-09-30-lfh-818-anmeldung-im-systembrowser/design.md
---

# ADR-0083: Die Desktop-App ist eine Tauri-Hülle ohne Anwendungslogik, die vor dem Laden nur den Hüllen-Vertrag abfragt

## Regeln

- MUST: Der Webview der Hülle (`src-tauri/`, Tauri 2) lädt die https-Adresse des Servers; die
  Anwendung bleibt same-origin die Web-App aus [ADR-0007](ADR-0007-frontend-react-antd-tanstack-query-pwa.md).
- MUST: Bevor die Hülle den Server lädt, fragt sie `GET /api/shell` ab und lädt die Oberfläche
  nur bei einem bekannten `shell_contract` (`src-tauri/AGENTS.md`, „Hüllen-Vertrag“).
- MUST NOT: keine Anwendungslogik, keine Datenbank und kein weiterer eigener Abruf in der Hülle.
  Der einzige ist der anonyme Vertragsabruf (`GET /api/shell`, bei 404 `GET /api/health`) ohne
  Cookies in `src-tauri/src/vertrag.rs`.
- MUST: `src-tauri/ui/` enthält nur lokale Seiten der Hülle: Maske, „nicht erreichbar“,
  „nicht verträglich“ und „Verbinde…“.
- MUST NOT: kein Tauri-Paket im Frontend; die Seite erkennt Fähigkeiten der Hülle nur über
  `window.__LIFELINE_HUELLE__` (`frontend/src/huelle/faehigkeiten.ts`).
- MUST: Rechte, Commands, Fenster, Links, Anmeldung im Systembrowser und Version folgen
  `src-tauri/AGENTS.md`; diese ADR wiederholt sie nicht.

## Prüfung

```sh
verlange '"frontendDist": "ui"' src-tauri/tauri.conf.json
verbiete '^(lifeline-hub|karten-katalog|sqlx|rusqlite|axum) *=' src-tauri/Cargo.toml
verbiete 'reqwest' 'src-tauri/src/**' ':(exclude)src-tauri/src/vertrag.rs'
verbiete 'cookie' src-tauri/src/vertrag.rs
verlange '"/api/shell"' src-tauri/src/vertrag.rs
verbiete '"@tauri-apps/' frontend/package.json
verlange '^const SERVER_RECHTE' src-tauri/src/main.rs
verlange '^version\.workspace = true' src-tauri/Cargo.toml
```

## Kontext

ADR-0009 hielt die Hülle frei von jedem eigenen Server-Abruf. Seit LLH-1978 nennt der Server unter
`GET /api/shell` seinen Hüllen-Vertrag, und die iOS-Hülle lädt nur einen verträglichen Server
(ADR-0068). Die Desktop-Hülle lud bis dahin jeden Server ungeprüft; ein Abruf aus der Serverseite
käme zu spät, weil die unverträgliche Oberfläche dann schon liefe (LLH-1982).

## Konsequenzen

Die Hülle hängt mit `reqwest` am Netz, aber nur für eine anonyme Abfrage mit denselben
TLS-Bausteinen wie der Updater; Zertifikate prüft das System wie im Webview. Ein Bruch im Vertrag
zeigt eine lokale Seite statt einer halb arbeitenden Oberfläche. Die übrigen Grenzen von ADR-0009
gelten unverändert.
