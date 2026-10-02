# Tasks

## 1. Geteilter Vertrag (`crates/karten-katalog`)

- [x] 1.1 Test zuerst: `slug_aus_url` liefert für `https://cdn/x/bayern.20260705.shortbread.mbtiles` den Wert `bayern`. Für eine URL ohne Dateinamen oder mit leerem Präfix liefert es `None`. Danach die Funktion umsetzen, und `karten-service/src/manifest.rs:published_aus_eintrag` nutzt sie. Nachweis: `cargo test -p karten-katalog` und `cargo test -p karten-service` grün.
- [x] 1.2 Typ `Zeitplan { naechster_lauf: Option<String>, cron: String }` (Serde, `schema`-Feature) mit Round-Trip-Test. Nachweis: `cargo test -p karten-katalog` grün.

## 2. karten-service: `GET /zeitplan` (D8)

- [x] 2.1 `scheduler::starte` gibt `(JobScheduler, Uuid)` zurück. Test: Für einen 6-Feld-Ausdruck liefert `next_tick_for_job` einen Zeitpunkt in der Zukunft. Nachweis: `cargo test -p karten-service scheduler` grün.
- [x] 2.2 Tests zuerst in `api.rs`: `GET /zeitplan` ohne Token gibt 401. Mit Token kommen 200, `cron` und ein RFC-3339-`naechster_lauf`. Im Modus ohne Scheduler kommt `naechster_lauf: null`. Danach Route und `AppState`-Feld `zeitplan`, `main.rs` reicht Scheduler, UUID und Ausdruck durch. Nachweis: Die Tests sind ohne Route rot und danach grün.
- [x] 2.3 Runbook `docs/ops/lfh-204-karten-service-ops-runbook.md` korrigieren: Der Cron läuft in UTC (Tabelle `--schedule` und Abschnitt In-Service-Cron), `GET /zeitplan` nennen. Nachweis: `grep -n "Zeitzone des Server-Prozesses"` findet nichts mehr.

## 3. Hub: Update-Erkennung und gemeinsamer In-Place-Start (D3, D4)

- [x] 3.1 Tests zuerst in `update_check_tests` (`src/routes/karte.rs`): Gleiche URL mit anderem Pin trifft. Gleiche URL mit gleichem Pin trifft nicht. Gleiche URL mit installiertem `sha256 = None` trifft nicht. Ein Platzhalter trifft weiter nicht. Danach die Signatur `finde_update_eintrag(name, quell_url, sha256_installiert, katalog)` umsetzen und `offline_liste` anpassen. Nachweis: Die neuen Tests sind vorher rot, alle in `update_check_tests` danach grün.
- [x] 3.2 Den Körper von `offline_neu_laden` in `starte_in_place_reload` herausziehen. `verarbeite_in_place_ergebnis` gibt `Result<(), String>` zurück, der Spawn meldet das Ergebnis an den Wächterzustand. Nachweis: Die bestehenden In-Place-Tests in `src/routes/karte.rs` und `tests/karte.rs` bleiben unverändert grün.
- [ ] 3.3 Listenfeld `aktualisierbar: bool` in `OfflineKarteAntwort` (gemanagter Pfad und Quell-URL), Test in `tests/karte.rs` für eine heruntergeladene und eine registrierte Karte. Nachweis: Der Test ist grün, `scripts/check-typ-codegen.sh` ist grün und die generierten Dateien sind mitcommittet.

## 4. Hub: Wächter (D1, D2, D10)

- [x] 4.1 Vorgabe-Schalter in `src/config.rs` (`karten_auto_aktualisierung`, `…_intervall_stunden`, 1…168), Hilfetext „Vorgabe, solange in der Verwaltung nichts gespeichert ist“, Tests nach dem Vorbild `kritis_extrakt_default_an_und_abschaltbar`. Beide Werte ins Startup-Log und in `docs/betrieb/env-registry.md`, falls Karten-Schalter dort geführt werden. Nachweis: `cargo test config` und `cargo test --test env_config_guard` grün.
- [x] 4.1a Migration `migrations/0134_karte_auto_aktualisierung.sql` (D10) und Repo-Funktionen `lade_auto_aktualisierung` / `speichere_auto_aktualisierung` in `src/karte/registry/repo.rs`. Tests zuerst: Ohne Zeile kommt `None`, Speichern und Lesen ergeben einen Round-Trip, ein zweites Speichern überschreibt und legt keine zweite Zeile an. Nachweis: Die Tests sind vorher rot und danach grün, `git fetch origin alpha && scripts/check-migrationen.sh` grün.
- [x] 4.1b Effektivwert `effektive_einstellung(pool, vorgabe)` (gespeichert, sonst Vorgabe) mit Test für beide Zweige. Nachweis: `cargo test auto_aktualisierung` grün.
- [x] 4.2 Modul `src/karte/auto_aktualisierung.rs` mit `WaechterZustand` und `tick_einmal`. Tests zuerst, gegen einen Mock-karten-service (Loopback-Axum wie in `tests/karte.rs`) und einen Mock-Katalog:
  - (a) Ein neuerer Stand startet genau einen Download.
  - (b) Zwei fällige Karten ergeben einen Download je Tick.
  - (c) Eine registrierte Karte wird nie angefasst.
  - (d) Automatik aus (gespeichert) heißt kein Download ohne ausstehenden Bau und keine `naechste_pruefung_at`.
  - (d2) Ein verkürzter Prüfabstand macht die Prüfung sofort fällig, ohne Neustart.
  - (e) Bau `done` erzwingt den frischen Katalog und den Download.
  - (f) Bau `failed` oder ein unbekannter Job ergibt einen Fehler an der Karte.
  - (g) Nach 15 Minuten „wartet auf Katalog“ steht der Fehler an der Karte.
  - (h) Ein Prüfsummenfehler sperrt dieselbe (URL, Pin)-Kombination.
  - (i) Ein Erfolg löscht den Fehler.

  Nachweis: Jeder Fall ist vor seiner Umsetzung rot und danach grün (`cargo test auto_aktualisierung`).
- [x] 4.3 Task-Start in `src/main.rs` (Startverzögerung 60 s, Takt nach D1, `Notify`), Zustand im `AppState`. Nachweis: `neuerer_stand_landet_ohne_request_auf_dem_geraet` (Unit-Test im Wächter-Modul statt in `tests/karte.rs`): Ein neuerer Katalogstand landet ohne Request auf dem Gerät, mit echtem Download von einem Loopback-Server und echtem Tausch derselben Zeile. Ein Test unter `tests/` könnte das nicht, weil der SSRF-Guard Loopback-Downloads prozessweit verwehrt.
- [x] 4.4 Mutationsprobe: Ohne die Sperre `auto_laeuft` färbt sich Fall 4.2 (b) rot, ohne den SHA-Vergleich der Fall aus 3.1. Ergebnis im PR-Text vermerken. Ergebnis 02.10.2026: Ohne `z.auto_laeuft = Some(..)` werden `zwei_faellige_karten_nacheinander` und der End-to-End-Fall rot. Mit `&& false` im SHA-Vergleich wird `zweiter_bau_am_selben_tag_mit_anderem_pin_ist_update` rot.

## 5. Hub: Endpunkte (D6, D7)

- [ ] 5.1 Tests zuerst in `tests/karte.rs` für `POST /api/karte/offline-karten/{id}/jetzt-aktualisieren`:
  - 403 für einen Nicht-Admin, 422 für eine registrierte Karte, 422 bei laufendem Download.
  - `laedt`, wenn der Katalog einen neueren Stand führt (kein `POST /builds` am Mock).
  - `bau_wartet` mit genau einem `POST /builds`. Bei aktivem Job für den Slug kommt kein zweiter.
  - `aktuell` ohne karten-service, 502 bei einem unerreichbaren Dienst.

  Danach Handler, Route in `src/app.rs`, `api_doc.rs`, Enum `JetztPhase` in `tests/enum_wire_kontrakt.rs`. Nachweis: Die Tests sind vorher rot und danach grün, `scripts/check-typ-codegen.sh` ist grün.
- [ ] 5.2 Tests zuerst für `GET /api/karte/offline-karten/aktualisierung`:
  - Lesbar für Führungskraft und Admin, 403 sonst.
  - `bau_dienst` ist `nicht_konfiguriert`, `erreichbar` oder `unerreichbar` (Mock antwortet nicht → 200 mit `unerreichbar`).
  - Ein Cron-Bau eines passenden Slugs ergibt `baut` an der Karte.
  - `naechster_bau_at` kommt aus `/zeitplan`. Ein Dienst ohne `/zeitplan` (404) ergibt `null`.

  Danach Handler, Route, `api_doc.rs`, Enums `AktualisierungsPhase` und `BauDienst` in `tests/enum_wire_kontrakt.rs`. Nachweis: Die Tests sind vorher rot und danach grün, `scripts/check-typ-codegen.sh` ist grün.

- [ ] 5.3 Tests zuerst für `PUT /api/karte/offline-karten/aktualisierung/einstellung`:
  - 403 für eine Führungskraft.
  - 400 für einen Prüfabstand von 0 und von 169, die bisherige Einstellung bleibt.
  - 200 mit Status, der die neue Einstellung trägt.
  - Ein anschließendes `GET …/aktualisierung` und ein neu aufgebauter `AppState` mit derselben DB (simulierter Neustart) liefern denselben Wert.

  Danach Handler, Route, `api_doc.rs`, Wecken des Wächters. Nachweis: Die Tests sind vorher rot und danach grün, `scripts/check-typ-codegen.sh` ist grün.

## 6. Frontend: Offline-Karten-Verwaltung (D9)

Vor dem Start `frontend/AGENTS.md` lesen (Gestaltungssprache, Query-Keys, Zeitformen).

- [ ] 6.1 Seam in `api/offlineKarten.ts` (`ladeAktualisierungsStatus`, `starteJetztAktualisieren`, `speichereAutoAktualisierung`, Typen als Re-Export der generierten Schemas) und Key `globalKeys.adminKarteBereich('aktualisierung')`. Nachweis: `api/offlineKarten.test.ts`, `api/globalKeys.test.ts` und `api/apiResponseTypen.guard.test.ts` grün.
- [ ] 6.2 Tests zuerst in `karten/OfflineKartenVerwaltung.test.tsx`:
  - Zeile „Automatisch aktualisieren: an · zuletzt geprüft … · nächste Prüfung … · nächster Kartenbau …“.
  - Varianten „aus“, „Kartenbau-Dienst nicht erreichbar“ und ohne Dienst.
  - Ein Admin sieht Schalter und Auswahlfeld. Ausschalten und ein anderer Abstand senden je ein `PUT` mit dem erwarteten Body, bei einem Fehler springt die Anzeige zurück. Ein gespeicherter Wert außerhalb der Liste erscheint als Option.
  - Eine Führungskraft sieht denselben Inhalt als Text, ohne Bedienelemente.
  - Danach die Umsetzung. Nachweis: Die Tests sind vorher rot und danach grün.
- [ ] 6.3 Tests zuerst: Die Name-Spalte zeigt „Stand …“ und „auf dem Gerät seit …“ in Ortszeit, aus einem `download_at` in UTC. Die Status-Spalte zeigt je Phase „Neubau wartet“, „wird neu gebaut“, „wird veröffentlicht“ und „aktualisiert“ mit Fortschritt, außerdem „Update fehlgeschlagen“ mit dem Grund. Danach die Umsetzung. Nachweis: Die Tests sind vorher rot und danach grün, unter `test/prozessZone.ts`.
- [ ] 6.4 Tests zuerst: „Jetzt aktualisieren“ erscheint nur für `aktualisierbar` ohne laufende Phase und nur für Admins. „Aktualisieren“ und „Neu laden“ sind weg. Die Rückmeldung je Antwort-Phase stimmt, das Polling ist bei aktiver Phase 2 s, sonst 60 s, und die Liste pollt bei Phase `laedt` mit. Danach die Umsetzung. Nachweis: Die Tests sind vorher rot und danach grün.
- [ ] 6.5 Die bestehenden Guards bleiben grün: `components/aktionsabstand.guard.test.ts`, `components/feldbreiten.guard.test.ts`, `components/katalogTabelle.guard.test.ts` und Spaltenschalter. Nachweis: `pnpm vitest run src/karten src/components src/api` grün.

## 7. Abschluss

- [ ] 7.1 `./scripts/check-all.sh` grün. Wo die Umgebung einen Schritt nicht ausführen kann, ist die CI des PRs der Nachweis, mit Angabe, was lokal lief.
- [ ] 7.2 Folgetask auf dem Entwicklungsboard anlegen: Wird `ersetzt_karte_id` von `POST /offline-karten/download` noch gebraucht? Nachweis: Link im PR-Text.
- [ ] 7.3 Review (`requesting-code-review`) und Findings abarbeiten. Danach `/opsx:archive` im selben Branch, Verweise auf den Change-Pfad nachziehen, erst dann der PR.
