# Tasks

Jede Aufgabe per TDD: erst der rote Test, dann der Code.

## 1. Server: Lebenszeichen

- [x] 1.1 `routes/support.rs`: Konstante `HEARTBEAT_EREIGNIS = "heartbeat"` neben `POSITION_EREIGNIS`, mit Verweis auf diese Change
- [x] 1.2 `live/strom.rs`: `HEARTBEAT_INTERVAL` (15 s) und `mit_heartbeat(strom)`; Unit-Test mit angehaltener Uhr: erster Schlag nach 15 s, Ereignis ohne `id:`, der Strom endet nicht vorzeitig und läuft mit dem inneren Strom weiter
- [x] 1.3 `routes/live.rs`: beide Ströme mischen das Lebenszeichen vor dem `take_until` ein; Modulkommentar ergänzen
- [x] 1.4 Integrationstest (`tests/live_feed.rs` bzw. `tests/org_live.rs`): Einsatz- und Org-Strom liefern ein `heartbeat` ohne `id:`; ein Gerätestrom bekommt es auch (`tests/geraet_kopplung.rs` oder gleichwertig); endet der Strom (Sitzungsende), endet er trotz Takt

## 2. Frontend: Wache

- [x] 2.1 `liveVerbindung.test.ts`: `FakeEventSource` merkt sich Listener und kann Ereignisse einspielen; Tests mit Fake-Timern: Stille 45 s nach `open` → `connecting`, alte Quelle zu, neue Quelle; ihr `open` → `open` und `beiWiederaufbau` genau einmal
- [x] 2.2 Tests: `heartbeat`, `position` und Fach-Ereignis setzen die Wache zurück; vor dem ersten `open` keine Meldung wegen Stille; nach `onerror`, Pause und Aufräumen feuert keine Wache mehr
- [x] 2.3 `liveVerbindung.ts`: `HEARTBEAT_TIMEOUT_MS` und die Wache nach design.md D3; Kopfkommentar von `oeffneLiveVerbindung` ergänzen

## 3. Abschluss

- [x] 3.1 Doku prüfen: `docs/architektur/` und `docs/anwender/` auf Aussagen zum Verbindungszustand (Mitänderungsregel der jeweiligen `AGENTS.md`)
- [ ] 3.2 `./scripts/check-all.sh --geaendert --ohne-e2e` grün
