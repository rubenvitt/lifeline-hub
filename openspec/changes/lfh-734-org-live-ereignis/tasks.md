# Tasks

Jede Aufgabe per `superpowers:test-driven-development` (erst rot, dann grün). Rust über
`cargo test` mit eigenem `CARGO_TARGET_DIR`, Vitest über
`mise exec -- pnpm -C <abs>/frontend test -- <datei>`. Vor „fertig" `verification-before-completion`
und `requesting-code-review`.

## 1. Org-Kanal im LiveHub (D2, D3)

- [x] 1.1 Unit-Tests in `src/live/` zuerst: `OrgLiveEvent::ALLE == [Einsatzliste, Stammdaten]` mit Wire-Namen `einsatzliste`/`stammdaten`; Wire-Namen disjunkt zu `LiveEvent::ALLE`; Filter `sichtbar_fuer(abonnent)` für `Organisation` (gleiche Org ja, fremde nein) und `Einsatzleser` (org-weiter Leser gleiche Org ja, Führungskraft fremde Org nein, System-Admin fremde Org ja, genanntes Mitglied ja, sonstiges Org-Mitglied nein); Publizieren ohne Abonnent ist harmlos; Org-Nachricht landet nicht im Einsatz-Ring und verändert dessen Id-Folge nicht. Rot belegen.
- [x] 1.2 `OrgLiveEvent` (`wire_enum!`, `ToSchema`), `OrgNachricht`, `OrgEmpfaenger`, `OrgAbonnent` (Schnappschuss) und der prozessweite Broadcast-Kanal im `LiveHub` (`abonniere_org`, `publiziere_org`). Tests aus 1.1 grün; die bestehenden `src/live`-Tests (Gate-Pins von `LiveEvent`) unverändert grün.
- [x] 1.3 `src/api_doc.rs` registriert `OrgLiveEvent`; `tests/enum_wire_kontrakt.rs` bekommt `org_live_event_wire` (`ALLE`-Länge 2, `contains`) und den Eintrag im Inventar-Guard `jedes_toschema_enum_ist_gepinnt`. `cargo test --test enum_wire_kontrakt` grün.

## 2. Ströme (D1, D4, D7)

- [x] 2.1 `tests/org_live.rs` zuerst (`common::setup_mit_pool_und_live`): `GET /api/live` ohne Sitzung → 401; angemeldet → 200, erstes Byte ist der Kommentar `verbunden`; publiziertes `stammdaten` kommt ohne `id:`-Zeile an; Einsatz-Ereignisse kommen auf `/api/live` nicht an; Überlauf des Org-Kanals → `lagged`. Rot belegen.
- [x] 2.2 `routes/support.rs`: Org-Stromteil (Filter gegen `OrgAbonnent`, Ereignis ohne `id`, Überlauf → `lagged`); `routes/live.rs`: neue Route `org_stream` hinter `CurrentUser`; `app.rs` registriert `GET /api/live`; `zulassung.rs` nimmt sie in `OHNE_ZULASSUNGSGRENZE` auf. Tests aus 2.1 und `tests/zulassung_guard.rs` grün.
- [x] 2.3 Test zuerst: Ein Abonnent des Einsatz-Stroms erhält `stammdaten` seiner Org (ohne `id:`), Replay mit `Last-Event-ID` nach einem Org-Ereignis liefert genau die verpassten Einsatz-Ereignisse (Id-Folge unberührt), ein Mitglied ohne jedes ausblendbare Modul erhält `stammdaten`. Dann `routes/live.rs::stream` verschmilzt Einsatz- und Org-Teil. Grün; `tests/live_feed.rs` und `tests/modul_override.rs` unverändert grün.

## 3. Emitter `einsatzliste` (D3, D5)

- [x] 3.1 Tests zuerst in `tests/org_live.rs` (Empfänger über `abonniere_org` mit Schnappschüssen): Anlage → org-weiter Leser derselben Org und System-Admin fremder Org erhalten `einsatzliste` mit Nutzlast `{}`, ein Org-Benutzer ohne Bezug und eine Führungskraft fremder Org nicht; abgelehnte Anlage (400/403) → keins. Rot belegen.
- [x] 3.2 Helfer `einsatzliste_melden` (Org und Mitglieder nach dem Commit, optional Zusatz-Benutzer) und Aufruf in `routes/einsatz.rs::anlegen`. Tests aus 3.1 grün.
- [x] 3.3 Tests zuerst: Kopf-PATCH, Abschluss, Fristsetzen, Lagebesprechung mit neuem Termin → je `einsatz` UND `einsatzliste` (Mitglied erhält es); Lagebesprechung ohne Terminänderung und Stab-Besetzung → kein `einsatzliste`. Dann `kopf_geaendert` (und der Stab-Pfad) ruft den Helfer mit auf. Grün; `tests/einsatz_live.rs` unverändert grün.
- [x] 3.4 Tests zuerst: Mitglied setzen → das neue Mitglied erhält `einsatzliste`; Mitglied entfernen → die entfernte Person erhält es noch. Dann Emitter in `routes/einsatz.rs` (Mitgliedschaft). Grün.
- [x] 3.5 Tests zuerst: Wiederherstellen (`routes/aufbewahrung.rs`) → `einsatzliste`; Soft-Delete durch `purge_scheduler::tick_einmal` → `einsatzliste`. Dann Emitter; `starte_purge_scheduler(pool, live)` und `main.rs` nachziehen. Grün; `tests/aufbewahrung*.rs` unverändert grün.
- [x] 3.6 Tests zuerst in `tests/demo_daten.rs`: Import, Neu-Import, Entfernen → `einsatzliste` (Mitglieder vor dem `DELETE` gelesen) und `stammdaten` an die eigene Org, nichts an eine fremde Org; der bestehende `lagged`-Test bleibt. Dann Emitter in `routes/demo_daten.rs` (`entfernen_tx` gibt die Mitglieder zurück). Grün.

## 4. Emitter `stammdaten` per Middleware (D5)

- [x] 4.1 Tests zuerst: je Katalog mindestens eine Schreibroute → `stammdaten` an die eigene Org, nicht an eine fremde; GET → nichts; abgelehnte Schreibanfrage (403 als Nicht-Admin, 400) → nichts. Rot belegen.
- [x] 4.2 Middleware `stammdaten_live` (`src/routes/live.rs`) am Router mit der Präfixliste `STAMMDATEN_PFADE` (nach 2xx und Nicht-GET an `benutzer.org_id`), montiert in `app.rs`. Tests aus 4.1 grün; `tests/org_scope_guard.rs`, `tests/zulassung_guard.rs`, `tests/fehler_vertrag.rs` unverändert grün.
- [x] 4.3 Guard `tests/stammdaten_live_guard.rs`: Jede schreibende Route eines Katalog-Moduls außerhalb `/api/einsaetze/` liegt unter einem Präfix aus `STAMMDATEN_PFADE`, jeder Präfix deckt eine schreibende Route, die Middleware ist montiert. Mutationsprobe: `/api/material` durch einen toten Präfix ersetzt → beide Guards rot; zurück → grün.

## 5. Codegen

- [x] 5.1 `scripts/check-typ-codegen.sh`; `frontend/src/api/openapi.json` und `types.generated.ts` mitcommitten.

## 6. Frontend (D6)

- [x] 6.1 `api/queryKeys` zuerst: Guard „jeder `GLOBAL_KEYS`-Eintrag in genau einer Klasse (`ORG_STREAM_EVENTS` oder `NICHT_LIVE_GLOBAL_KEYS`)", Literal-Erwartung für beide Einträge von `ORG_STREAM_EVENTS`, neuer Kontrakttest `orgLiveEvent.contract.test.ts` (`OrgLiveEvent` aus den generierten Typen gleich den Schlüsseln von `ORG_STREAM_EVENTS`) und Disjunktheit zu `FeWireEvent`. Rot belegen.
- [x] 6.2 `ORG_STREAM_EVENTS` und `NICHT_LIVE_GLOBAL_KEYS` in `api/queryKeys.ts`, Kommentar an `GLOBAL_KEYS` auf die Partition umstellen; `lagebildOffline.guard.test.ts` grün. Tests aus 6.1 grün.
- [x] 6.3 Charakterisierungstests für `useEinsatzLiveStream` (Backoff, 401-Probe, Status, Wiederaufbau-Vollabgleich) vervollständigen, dann den Verbindungsbau nach `live/liveVerbindung.ts` auslagern. Bestehende `useEinsatzLiveStream.test.tsx` und `EinsatzLayout.test.tsx` unverändert grün.
- [x] 6.4 Test zuerst: Einsatz-Strom invalidiert bei `einsatzliste`/`stammdaten` die einstelligen globalen Prefixe (Literale, auch Sub-Key `['personal','alle']`), `lagged` und Wiederaufbau nehmen die Org-Keys mit. Dann Umsetzung im Einsatz-Hook. Grün.
- [x] 6.5 Test zuerst für `useOrgLiveStream`: öffnet `/api/live` nur angemeldet und nur, solange kein Einsatz-Strom offen ist (`einsatzStromStore`), invalidiert bei jedem `onopen` (auch dem ersten) die Org-Keys, schließt beim Betreten eines Einsatzes; `BetriebsLayout`-Test: auf `/einsaetze` genau eine Verbindung zu `/api/live`, auf `/einsaetze/7/…` genau eine zu `/api/einsaetze/7/live`, auf `/login` keine. Dann Hook und Einbau in `App.tsx`. Grün.

## 7. Nachweis Ende zu Ende

- [ ] 7.1 `e2e/org-live.spec.ts` (Muster `einsatzkopf-live.spec.ts`, zwei Seiten im selben Kontext): Seite B auf der Einsatzliste, Seite A legt einen Einsatz an → B zeigt ihn ohne Reload (Inhaltsanker); Seite B in einem Einsatz mit offenem Switcher, Seite A schließt einen anderen aktiven Einsatz ab → der Switcher verliert ihn; Seite B auf der Personal-Verwaltung, Seite A legt eine Person an → B zeigt sie.
- [ ] 7.2 Mutationsproben: `einsatzliste` aus `ORG_STREAM_EVENTS` nehmen → 7.1 rot; Mitglieder-Abfrage im Helfer weglassen → 3.4 rot; Empfängerfilter auf „ganze Org" stellen → 3.1 rot; zurückdrehen → grün. Befund in `design.md` oder im PR festhalten.

## 8. Doku

- [x] 8.1 `frontend/AGENTS.md`, Query-Key-Registry: Zeile zu `ORG_STREAM_EVENTS`/`NICHT_LIVE_GLOBAL_KEYS` (XOR, Guard) und „ein Tab, eine Live-Verbindung: der Einsatz-Strom trägt die Org-Ereignisse mit" (LFH-734). `src/AGENTS.md`: Zeile „Katalog-Schreibrouten gehören in den Stammdaten-Teil-Router (Middleware `stammdaten_live`, Guard aus 4.3); `einsatzliste` nur über den Helfer" (LFH-734). Kommentar im Kopf von `useEinsatzLiveStream.ts` nachziehen. Prettier für `frontend/` grün.

## 9. Integration

- [ ] 9.1 `./scripts/check-all.sh` (eigenes `CARGO_TARGET_DIR` im Scratchpad) vollständig grün, Log nach „ÜBERSPRUNGEN" durchsehen. Belegt durch die CI des Merge-PR (`ci.yml` ruft `check-all.sh`).
- [ ] 9.2 `/opsx:archive lfh-734-org-live-ereignis` im selben Branch vor dem PR.
