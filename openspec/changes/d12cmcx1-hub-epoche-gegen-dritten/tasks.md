# Tasks

## 1. Erklärung gegen einen Dritten hält offen (design.md D1)

- [ ] 1.1 Test `holt_der_hub_per_notuebernahme_gegen_elw_1_zurueck_haelt_elw_2_offen_ohne_alarm` in `tests/instanz_fuehrung.rs`, mit drei Instanzen: ELW 2 erklärt ohne Verbindung (2,E2) gegen den Hub, ELW 1 übernimmt am Hub mit (2,E1), der Hub holt per unterschriebener Notübernahme gegen ELW 1 mit (3,Hub) zurück, ELW 2 meldet sich mehrmals. Erwartet an ELW 2: führt weiter, `offen` mit Epoche 3, `konflikt` falsch, ohne Grund und Unterzeichner, genau eine Benachrichtigung `fuehrung_uebernommen`, keine `fuehrung_ungueltig`, kein `fuehrung_verworfen` in der Admin-Spur; am Hub führt der Hub weiter. Verifikation: rot vor 1.3 (heute Verwerfen mit Alarm).
- [ ] 1.2 Tests `bestaetigen_...` und `widersprechen_...` auf dem Stand aus 1.1: Bestätigen macht ELW 2 zum Spiegel des Hubs mit (3,Hub); Widersprechen lässt ELW 2 mit (4,E2) an beiden Seiten führen. Verifikation: grün nach 1.3.
- [ ] 1.3 `apply_eingang` in `src/instanz/fuehrung/austausch.rs`, Zweig `Greater`: An der meldenden Seite mit `nimmt_mir` und `von_sender` gilt eine lesbare Erklärung mit `fuehrer_alt ≠ ich` als „Dritter beteiligt“ und läuft über `entscheide(.., dritter = true)` in `halte_offen`. Die Ableitung „Erklärung gegen mich“ kommt in eine Hilfsfunktion, die auch `check_offene`, `dienst::anzeige`, `dienst::bestaetigen` und `dienst::widersprechen` nutzen. Verifikation: 1.1 und 1.2 grün; `uebernahme_ohne_gueltigen_beweis_wird_verworfen_mit_alarm`, `unterschriebene_erklaerung_mit_abweichendem_feld_wird_verworfen` und `unterschrift_eines_wartenden_schluessels_traegt_nicht` bleiben grün; `cargo test --lib instanz::fuehrung` grün.

## 2. Widerruf schreibt eine Erklärung (design.md D2, D3)

- [ ] 2.1 Test `holt_der_hub_per_widerruf_von_elw_1_zurueck_haelt_elw_2_offen_ohne_alarm`: Aufbau wie 1.1, aber der Admin am Hub widerruft die Org-Zuordnung von ELW 1 statt der Notübernahme. Erwartet an ELW 2 dasselbe wie in 1.1. Verifikation: rot vor 2.3 (heute „ohne Erklärung“, Verwerfen mit Alarm).
- [ ] 2.2 Test zur Spec-Szene „Ein dritter ELW sieht den Widerruf im Verlauf“: ELW 1 führt, ELW 2 kennt die Akte ohne zu führen, der Hub widerruft ELW 1. Erwartet: Der Verlauf der Akte an ELW 2 nennt den Grund „Kopplung widerrufen“ und keinen Unterzeichner. Verifikation: rot vor 2.3.
- [ ] 2.3 `repo::release_nach_widerruf` in `src/instanz/fuehrung/repo.rs` schreibt die Erklärung nach design.md D2 (ohne Beweis, Unterzeichner leer); der Aufrufer in `src/instanz/repo.rs` gibt den Org-Schlüssel der widerrufenen Zuordnung mit. `unterzeichner_der` in `austausch.rs` gibt für einen leeren Namen `None`. Verifikation: 2.1 und 2.2 grün; `nach_dem_widerruf_holt_der_elw_seinen_einsatz_zurueck`, `widerruf_raeumt_eine_offene_uebernahme` und `der_widerruf_der_kopplung_raeumt_den_konflikt_ab` bleiben grün; `cargo test --test instanz_fuehrung` grün.

## 3. Doku und Architektur

- [ ] 3.1 `docs/anwender/kapitel/instanzkopplung.md`: Der Satz „Hat der Hub die Führung inzwischen von einem anderen ELW zurückbekommen …“ nennt auch das Zurückholen per Notübernahme oder Widerruf gegen einen anderen ELW, ohne Alarm. Verifikation: `anwenderdoku.guard.test.ts` grün.
- [ ] 3.2 Neue ADR (nächste freie Nummer nach `git fetch origin alpha` und `scripts/adr-fuer.sh --alle`), `ersetzt: ADR-0028`, mit den Regeln von ADR-0028 und der erweiterten Ausnahme (Erklärung nennt einen Dritten als bisherigen Führer; ohne oder mit unlesbarer Erklärung keine Ausnahme) sowie der Regel zur Erklärung des Widerrufs. ADR-0028 bekommt `status: ersetzt` und `ersetzt_durch`. Herleitung auf das Archiv-`design.md` dieser Change. Verweise auf ADR-0028 im Code und in `AGENTS.md`-Dateien greppen und nachziehen. Verifikation: `scripts/check-architektur.sh` grün.

## 4. Abschluss

- [ ] 4.1 `./scripts/check-all.sh` ist grün (lokal mindestens `--nur schnell`, `cargo test --test instanz_fuehrung`, `cargo test --lib instanz::fuehrung`; vollständig über die CI des PRs).

## Workflow follow-up

- Review vor dem PR (`dev-zunder-ausfuehren`, „Review vor dem PR“), bestätigte Befunde behandeln.
- `/opsx:archive d12cmcx1-hub-epoche-gegen-dritten` im selben Branch vor dem PR, Verweise (Herleitung der ADR) nachziehen.
- PR gegen `alpha` mit dem Abschnitt „Review“; keine Bilder, denn die Oberfläche zeigt denselben Zustand wie D7 der Vorgänger-Change (Satz im PR).
