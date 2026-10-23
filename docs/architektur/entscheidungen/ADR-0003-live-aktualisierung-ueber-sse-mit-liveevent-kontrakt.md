---
id: ADR-0003
titel: Live-Aktualisierung läuft über SSE, das Enum LiveEvent ist der Kontrakt
status: akzeptiert
datum: 2026-05-23
gilt_fuer:
  - src/live/**
  - src/routes/live.rs
  - src/routes/support.rs
  - frontend/src/live/**
  - frontend/src/api/queryKeys.ts
  - frontend/src/api/*.contract.test.ts
  - tests/enum_wire_kontrakt.rs
herleitung:
  - docs/superpowers/specs/2026-05-23-fundament-etb-kern-design.md
  - docs/superpowers/specs/2026-07-19-lfh-227-live-kanal-modul-authz-design.md
  - openspec/changes/archive/2026-10-01-lfh-734-org-live-ereignis/design.md
  - openspec/changes/archive/2026-10-06-lfh-922-live-neuladeflut/design.md
---

# ADR-0003: Live-Aktualisierung läuft über SSE, das Enum LiveEvent ist der Kontrakt

## Regeln

- MUST: Der Server schiebt Änderungen per Server-Sent Events (`axum::response::sse`) über
  genau zwei Ströme: den Einsatz-Feed und den Org-Strom (`src/routes/live.rs`). Schreiben
  läuft über normale HTTP-Requests.
- MUST NOT: kein WebSocket, weder im Server noch im Frontend noch in der Hülle.
- MUST: Jeder Ereignisname ist eine Variante von `LiveEvent` (`src/live/mod.rs`) oder, für den
  Org-Strom, von `OrgLiveEvent` (`src/live/org.rs`); der Wire-Tag kommt aus `as_str()`, nie aus
  einem String-Literal am Aufrufer.
- MUST: Eine neue Variante steht im Enum-Wire-Kontrakt (`tests/enum_wire_kontrakt.rs`) und in
  `EINSATZ_STREAM_EVENTS` bzw. `ORG_STREAM_EVENTS` (`frontend/src/api/queryKeys.ts`) oder in der
  Ausnahmeliste des Kontrakttests (`frontend/src/api/liveEvent.contract.test.ts`,
  `frontend/src/api/orgLiveEvent.contract.test.ts`).
- MUST NOT: keine sensiblen Inhalte in der Nutzlast (`LiveNachricht`, `src/live/mod.rs`); sie
  trägt Kennungen, der Client lädt über die berechtigten GETs nach. Den Filter je Event nach
  Modulrechten trägt `LiveEvent::modul_keys`; eine Benachrichtigung geht nur an ihre Empfänger.
- MUST: Nur `frontend/src/live/` öffnet eine `EventSource`, eine je Tab.

## Prüfung

```sh
verbiete 'new WebSocket\(|WebSocketUpgrade|tungstenite|axum::extract::ws' 'src/**' 'frontend/src/**' 'src-tauri/src/**'
verbiete '^(tokio-tungstenite|tungstenite|tauri-plugin-websocket) *=|^axum = .*"ws"' Cargo.toml src-tauri/Cargo.toml karten-service/Cargo.toml
verbiete '"(@tauri-apps/plugin-websocket|socket\.io-client|ws)":' frontend/package.json
verbiete 'new EventSource' 'frontend/src/**' ':(exclude,glob)frontend/src/live/**'
verbiete '\.event\("' 'src/**/*.rs'
verlange '^ *pub enum LiveEvent \{' src/live/mod.rs
verlange 'LiveEvent::ALLE' tests/enum_wire_kontrakt.rs
verlange '^ *pub enum OrgLiveEvent \{' src/live/org.rs
verlange 'EINSATZ_STREAM_EVENTS' frontend/src/api/liveEvent.contract.test.ts
verlange 'ORG_STREAM_EVENTS' frontend/src/api/orgLiveEvent.contract.test.ts
```

## Kontext

Mehrere Geräte erfassen und lesen dasselbe Einsatzgeschehen; Änderungen müssen ohne Neuladen
erscheinen. Das Fundament-Design wählte SSE, weil es HTTP-basiert und proxy-freundlich ist und
nur die Richtung Server → Client braucht. Der Review vom 11.07.2026 fand verstreute Ereignisnamen
ohne Kontrakt (F13) und einen Kanal, der Modulrechte umging (F01); daraus entstanden das zentrale
Enum (Zunder LLH-288) und der eine Einsatz-Feed mit Filter je Event (LFH-227).

## Konsequenzen

Ein neues Live-Modul ist eine Enum-Variante plus ein Map-Eintrag im Frontend; Drift zwischen
Server und Client fängt der Kontrakttest. Die Rechte eines Stroms gelten ab Verbindungsaufbau,
ein Entzug wirkt erst beim nächsten Aufbau (Lebensdauer in `src/live/strom.rs`). Ohne HTTP/2
belegt jeder Tab eine der sechs HTTP/1.1-Verbindungen je Origin.
