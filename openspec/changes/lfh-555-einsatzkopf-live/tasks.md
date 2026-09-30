# Tasks

Jede Aufgabe per `superpowers:test-driven-development` (erst rot, dann grün). Rust über
`cargo test` mit eigenem `CARGO_TARGET_DIR`, Vitest über
`mise exec -- pnpm -C <abs>/frontend test -- <datei>`. Vor „fertig" `verification-before-completion`
und `requesting-code-review`.

## 1. Live-Vertrag im Backend (D2)

- [x] 1.1 `src/live/mod.rs`-Tests zuerst: `gate_mengen_sind_gepinnt` um `(LiveEvent::Einsatz, &[])` ergänzen, `nur_kontroll_events_sind_ungegatet` → `ungegatet_sind_nur_lagged_und_einsatz` (`["einsatz", "lagged"]`), `sichtbar_fuer_prueft_schnittmenge` um „`Einsatz` passiert eine leere Erlaubnis-Menge". Kompiliert nicht bzw. rot belegen.
- [x] 1.2 Variante `Einsatz => "einsatz"` in `wire_enum!`, `modul_keys` → `&[]` mit Begründung (Tür des Stroms = Tür des Kopfs), Doc-Kommentar der leeren Menge fortschreiben; Kommentar der Stab-Variante auf D3 umstellen. Tests aus 1.1 grün.
- [x] 1.3 `tests/enum_wire_kontrakt.rs`: `LiveEvent::Einsatz => "einsatz"` aufnehmen; `ALLE`-Länge 32 und `contains`.

## 2. Emitter (D3)

- [x] 2.1 `tests/einsatz_live.rs` zuerst (`common::setup_mit_pool_und_live`): PATCH Kopfdaten → genau ein `einsatz` mit Nutzlast `{"einsatz_id":…}`; abgelehnter PATCH (400) → keins; Abschluss → `einsatz`; Frist setzen → `einsatz`. Rot belegen.
- [x] 2.2 `routes/einsatz.rs`: `publiziere_einsatz(id, LiveEvent::Einsatz)` nach Erfolg in `aktualisieren`, `abschliessen`, `aufbewahrungsfrist_setzen` (nach dem Commit, vor der Antwort). Tests aus 2.1 grün.
- [x] 2.3 `tests/stab.rs` (oder `einsatz_live.rs`): Lagebesprechung mit neuem Termin → `stab`, `etb` UND `einsatz`; mit demselben Termin → kein `einsatz`; ohne Schlüssel `naechste_at` → kein `einsatz`; Termin → `null` bei gesetztem Termin → `einsatz`. Rot belegen.
- [x] 2.4 `stab/repo.rs` Schritt 6: `… WHERE id = ? AND naechste_lagebesprechung_at IS NOT ?`, Rückgabe `termin_geaendert`; `routes/stab.rs` publiziert `einsatz` nur dann. Tests aus 2.3 grün, übrige `tests/stab.rs` unverändert grün (Atomaritäts-Mutationsprobe inklusive).
- [x] 2.5 SSE-Filter: Integrationstest, dass ein Mitglied ohne jede Modulfreigabe `einsatz` erhält und bei Lagebesprechung ohne Terminänderung weder `stab` noch `einsatz` (Muster der bestehenden Gate-Tests in `tests/`).
- [x] 2.6 Besetzung eines Sachgebiets → kein `einsatz` (Abwesenheitstest).

## 3. Codegen

- [x] 3.1 `scripts/check-typ-codegen.sh`; `frontend/src/api/openapi.json` und `types.generated.ts` mitcommitten.

## 4. Frontend (D4)

- [x] 4.1 `liveEvent.contract.test.ts` und `queryKeys.guard.test.ts`/`queryKeys.test.ts` zuerst: `einsatz` als Wire-Event erwartet, `EINSATZ_KEYS.einsatz` nicht mehr in `NICHT_LIVE_KEYS`, `EINSATZ_STREAM_EVENTS.einsatz` invalidiert `einsatz` und `einsatz-stab` (Literale). Rot belegen.
- [x] 4.2 `api/queryKeys.ts`: Eintrag `einsatz: [EINSATZ_KEYS.einsatz, EINSATZ_KEYS.stab]` mit Kommentar, aus `NICHT_LIVE_KEYS` entfernen, Kopfkommentar von `NICHT_LIVE_KEYS` und Kommentar an `EINSATZ_KEYS` anpassen. Tests aus 4.1 grün; `lagebildOffline.guard.test.ts` grün.
- [x] 4.3 `useEinsatzLiveStream`-Test: Ereignis `einsatz` invalidiert `['einsatz', id]` und `['einsatz-stab', id]`, `lagged` nimmt den Kopf mit.
- [x] 4.4 `EinsatzdatenPage`: Vitest „Formular offen, Kopf-Cache ändert sich (Invalidierung mit neuem Termin) → Eingaben bleiben"; ebenso eine offene `InlineAngabe`. Nur falls rot: minimaler Fix.

## 5. Nachweis Ende zu Ende

- [ ] 5.1 `e2e/einsatzkopf-live.spec.ts`: zwei Seiten im selben Kontext (Muster `sitzung-mehrere-tabs.spec.ts`), Seite B auf Einsatzdaten, Seite A schließt eine Lagebesprechung mit neuem Termin ab → B zeigt den Termin ohne Reload (Inhaltsanker, kein `networkidle`); Gegenrichtung: A ändert Termin auf Einsatzdaten → B auf der Stab-Seite folgt.
- [ ] 5.2 Mutationsprobe: `einsatz` in `EINSATZ_STREAM_EVENTS` auskommentieren → 5.1 rot; `IS NOT`-Prädikat entfernen → 2.3 rot; zurückdrehen → grün. Befund in `design.md` oder PR festhalten.

## 6. Doku

- [x] 6.1 `CLAUDE.md`, Abschnitt Query-Key-Registry: eine Zeile „Einsatzkopf ist live (`einsatz`, Gate leer = Tür des Stroms, LFH-555); benutzerbezogene Kopffelder und `lagekennzahlen` nicht".
- [ ] 6.2 Folge-Tickets anlegen (`clickup-task-anlegen`): Mitgliedschaftswechsel live (`meine_rolle`), Lagekennzahl-Umschalten live (D5).

## 7. Integration

- [ ] 7.1 `./scripts/check-all.sh` (eigenes `CARGO_TARGET_DIR` im Scratchpad) vollständig grün, Log nach „ÜBERSPRUNGEN" durchsehen.
- [ ] 7.2 `/opsx:archive lfh-555-einsatzkopf-live` im selben Branch vor dem PR.
