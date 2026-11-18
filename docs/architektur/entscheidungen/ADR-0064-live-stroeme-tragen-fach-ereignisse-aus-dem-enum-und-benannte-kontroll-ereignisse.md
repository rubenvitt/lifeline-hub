---
id: ADR-0064
titel: Live-Ströme tragen Fach-Ereignisse aus dem Enum und benannte Kontroll-Ereignisse
status: vorgeschlagen
datum: 2026-11-17
ersetzt: ADR-0003
gilt_fuer:
  - src/live/**
  - src/routes/live.rs
  - src/routes/support.rs
  - frontend/src/live/**
  - frontend/src/api/queryKeys.ts
  - frontend/src/api/*.contract.test.ts
  - tests/enum_wire_kontrakt.rs
herleitung:
  - openspec/changes/archive/2026-11-17-l39v43md-sse-herzschlag/design.md
  - openspec/changes/archive/2026-10-06-lfh-922-live-neuladeflut/design.md
---

# ADR-0064: Live-Ströme tragen Fach-Ereignisse aus dem Enum und benannte Kontroll-Ereignisse

## Regeln

- MUST: Der Server schiebt Änderungen per Server-Sent Events (`axum::response::sse`) über
  genau zwei Ströme: den Einsatz-Feed und den Org-Strom (`src/routes/live.rs`). Schreiben
  läuft über normale HTTP-Requests.
- MUST NOT: kein WebSocket, weder im Server noch im Frontend noch in der Hülle.
- MUST: Jedes Fach-Ereignis ist eine Variante von `LiveEvent` (`src/live/mod.rs`) oder, für den
  Org-Strom, von `OrgLiveEvent` (`src/live/org.rs`); der Wire-Tag kommt aus `as_str()`, nie aus
  einem String-Literal am Aufrufer.
- MUST: Ein Kontroll-Ereignis (gehört keinem Modul, löst keinen Abgleich aus: `position`,
  `heartbeat`) ist eine Konstante `…_EREIGNIS` in `src/routes/support.rs` und läuft an Modul- und
  Gerätefilter vorbei; nur `frontend/src/live/liveVerbindung.ts` hört es.
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
verbiete '^pub const [A-Z_]+_EREIGNIS: &str' 'src/**/*.rs' ':(exclude)src/routes/support.rs'
verlange '^pub const POSITION_EREIGNIS: &str' src/routes/support.rs
verlange '^pub const HEARTBEAT_EREIGNIS: &str' src/routes/support.rs
verlange '^ *pub enum LiveEvent \{' src/live/mod.rs
verlange 'LiveEvent::ALLE' tests/enum_wire_kontrakt.rs
verlange '^ *pub enum OrgLiveEvent \{' src/live/org.rs
verlange 'EINSATZ_STREAM_EVENTS' frontend/src/api/liveEvent.contract.test.ts
verlange 'ORG_STREAM_EVENTS' frontend/src/api/orgLiveEvent.contract.test.ts
```

## Kontext

ADR-0003 verlangt wörtlich, dass jeder Ereignisname eine Variante von `LiveEvent` oder
`OrgLiveEvent` ist. Schon die Position des Einsatz-Stroms (LFH-922) ist das nicht, und das
Lebenszeichen gegen stumme Leitungen (LLH-1935) braucht ein zweites Kontroll-Ereignis, das jede
Verbindung erreicht. Diese ADR übernimmt die Regeln von ADR-0003 und trennt Fach- von
Kontroll-Ereignissen.

## Konsequenzen

Fach-Ereignisse bleiben im Enum-Kontrakt mit Filter je Modul. Kontroll-Ereignisse liegen an
einer Stelle und sind ohne Enum-Variante erlaubt; wer eins hinzufügt, legt die Konstante dort an
und hört es nur in `liveVerbindung.ts`. Mit der Annahme bekommt ADR-0003 `status: ersetzt` und
`ersetzt_durch: ADR-0064`.
