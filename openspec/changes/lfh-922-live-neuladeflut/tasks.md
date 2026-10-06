## 1. Server: Position beim Aufbau des Einsatz-Stroms (D4)

- [x] 1.1 Test zuerst (`tests/live_feed.rs`): Ein frisch geöffneter Einsatz-Strom sendet nach `verbunden` und `retry:` das Kontroll-Ereignis `position` mit `id:` und Daten (WebKit übernimmt eine `id` ohne Daten nicht); das erste Frame bleibt reiner Kommentar.
- [x] 1.2 Test: Ein Neuverbinden mit dieser Position ohne zwischenzeitliches Ereignis liefert nichts nach und kein `lagged`; mit einem zwischenzeitlichen Ereignis genau dieses.
- [x] 1.3 Test: Ein Kanal ohne bisherige Nachricht liefert eine Position, die beim Neuverbinden „nichts verpasst“ ergibt (Unit-Test in `src/live/mod.rs`).
- [x] 1.4 `LiveHub::abonniere_mit_position` liefert die Position unter derselben Sperre; `sse_stream_mit_replay` sendet sie nach dem Replay-Vorspann; `routes/live.rs` reicht sie durch. Mutationsprobe: Position weglassen → 1.1 und 1.2 rot.

## 2. Frontend: Sammler (D1, D2)

- [x] 2.1 Tests zuerst (`frontend/src/live/liveInvalidierung.test.ts`, Fake-Timer): N Vormerkungen desselben Keys → genau ein `invalidateQueries` nach 300 ms mit `cancelRefetch: false`; verschiedene Keys je einmal; verdeckter Tab beim Ablauf → `refetchType: 'none'`, sichtbar → `'active'`; `raeumen()` vor Ablauf → kein Aufruf.
- [x] 2.2 `live/liveInvalidierung.ts` umsetzen. Mutationsprobe: Bündelung entfernen bzw. `cancelRefetch` weglassen → 2.1 rot.

## 3. Frontend: Ströme auf den Sammler umstellen (D1)

- [x] 3.1 `useEinsatzLiveStream`: `inval`/`invalAlle`/`vollabgleich` merken über den Sammler vor; Cleanup räumt ihn. Alarmton, `lfh:sofortmeldung`, Erinnerungs- und Ablösungsalarm bleiben sofort.
- [x] 3.2 `orgListener` und `invalidiereOrgLiveKeys` nehmen den Sammler statt des `QueryClient`; `useOrgLiveStream` legt einen eigenen an.
- [x] 3.3 Bestehende Fälle in `useEinsatzLiveStream.test.tsx` und `useOrgLiveStream.test.tsx` auf das Sammelfenster umstellen (Fake-Timer oder `waitFor`), Erwartungen nicht lockern.
- [x] 3.4 Neue Fälle: Burst aus 50 Ereignissen → je Key ein Invalidate mit `cancelRefetch: false`; verdeckter Tab → `refetchType: 'none'`; `sofortmeldung` → Alarm-Event sofort, vor dem Fenster; `lagged` direkt nach einem Vollabgleich-Open → eine Abrufwelle.

## 4. Frontend: Wiederaufbau und Schonfrist (D3, D5, D6)

- [x] 4.1 Tests zuerst (`useEinsatzLiveStream.test.tsx`, F14-Fall „invalidiert beim Re-Open alle Registry-Keys“ aufteilen): Re-Open derselben `EventSource` → nur Org-Keys; neue `EventSource` nach `probeUndReconnect` → alle Keys.
- [x] 4.2 Tests: `onerror` mit `CONNECTING` und `open` innerhalb von 8 s → kein `connecting`-Status; ohne `open` nach 8 s → `connecting`; `CLOSED` → `lost` sofort.
- [x] 4.3 `liveVerbindung.ts`: Option `beiNachlieferung`, Unterscheidung der Opens, Schonfrist, Zufallsaufschlag im Backoff. Mutationsprobe: Weiche bzw. Schonfrist entfernen → 4.1 bzw. 4.2 rot.
- [x] 4.4 `useEinsatzLiveStream` übergibt `beiNachlieferung` (nur Org-Keys); `useOrgLiveStream` bleibt beim Abgleich seiner Org-Keys.

## 5. Regel und Abschluss

- [x] 5.1 `frontend/AGENTS.md`, „Query-Key-Registry“: Regel aus D7.
- [ ] 5.2 Lint, Typecheck, Vitest der berührten Dateien, Rust-Tests von `live_feed`, `org_live`, `modul_override` und `live::`.
- [ ] 5.3 `./scripts/check-all.sh` (Bündel `schnell`, Rust, Vitest; e2e der Live-Specs).

## 6. Nachzug aus dem Review

- [x] 6.1 Position als Kontroll-Ereignis `position` mit Daten; Browser-Neuaufbau gilt nur nach erhaltener Position als Nachlieferung (Test „ohne erhaltene Position voll ab“, Mutationsprobe rot).
- [x] 6.2 Sammler legt Keys mit laufendem Abruf ins nächste Fenster (Test, Mutationsprobe rot).
- [x] 6.3 `raeumen()` markiert Vorgemerktes mit `refetchType: 'none'` statt es zu verwerfen.
