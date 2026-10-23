---
id: ADR-0009
titel: Die Desktop-App ist eine Tauri-Hülle ohne Anwendungslogik, die die Server-Adresse lädt
status: akzeptiert
datum: 2026-09-25
gilt_fuer:
  - src-tauri/**
  - frontend/package.json
  - frontend/src/huelle/**
herleitung:
  - openspec/changes/archive/2026-09-29-lfh-720-tauri-huelle-variante-a/design.md
  - openspec/changes/archive/2026-09-30-lfh-721-desktop-app-paketieren/design.md
  - openspec/changes/archive/2026-09-30-lfh-818-anmeldung-im-systembrowser/design.md
---

# ADR-0009: Die Desktop-App ist eine Tauri-Hülle ohne Anwendungslogik, die die Server-Adresse lädt

## Regeln

- MUST: Der Webview der Hülle (`src-tauri/`, Tauri 2) lädt die https-Adresse des Servers; die
  Anwendung bleibt same-origin die Web-App aus [ADR-0007](ADR-0007-frontend-react-antd-tanstack-query-pwa.md).
- MUST NOT: keine Anwendungslogik, keine Datenbank und kein eigener Server-Client in der Hülle
  (`src-tauri/AGENTS.md`, „Keine Anwendungslogik in der Hülle“); `src-tauri/ui/` enthält nur die
  lokale Maske und die Anzeige „nicht erreichbar“.
- MUST NOT: kein Tauri-Paket im Frontend; die Seite erkennt Fähigkeiten der Hülle nur über
  `window.__LIFELINE_HUELLE__` (`frontend/src/huelle/faehigkeiten.ts`).
- MUST: Rechte, Commands, Fenster, Links, Anmeldung im Systembrowser und Version folgen
  `src-tauri/AGENTS.md`; diese ADR wiederholt sie nicht.

## Prüfung

```sh
verlange '"frontendDist": "ui"' src-tauri/tauri.conf.json
verbiete '^(lifeline-hub|karten-katalog|sqlx|rusqlite|axum|reqwest) *=' src-tauri/Cargo.toml
verbiete '"@tauri-apps/' frontend/package.json
verlange '^const SERVER_RECHTE' src-tauri/src/main.rs
verlange '^version\.workspace = true' src-tauri/Cargo.toml
```

## Kontext

Einsatzkräfte wollen ein Programm im Dock statt eines Browser-Tabs, mit nativen Meldungen, Druck
und Updates. Entschieden wurde am 25.09.2026 Variante A: Die Hülle lädt den Server, statt eine
zweite App mitzubringen; der Spike LFH-720 hat gemessen, dass WKWebView und WebView2 dafür
tragen. So bleibt genau eine Web-App zu pflegen.

## Konsequenzen

Ein Server-Release erreicht Desktop und Browser zugleich; die Hülle braucht nur für eigene
Fähigkeiten ein Update. Ist der Server nicht erreichbar, zeigt die Hülle ihre lokale Anzeige
(`src-tauri/src/erreichbar.rs`). Grenzen des Webviews (Passkeys, Anmeldung über OIDC) löst die
Hülle mit eigenem Code, etwa `ASWebAuthenticationSession` unter macOS
(`src-tauri/src/aswas.rs`).
