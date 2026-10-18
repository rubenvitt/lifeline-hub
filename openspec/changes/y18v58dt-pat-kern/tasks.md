# Tasks

Gemeinsame Change für Welle 2 von LLH-1018. Sie umfasst LLH-1138 (`ewjfqaek`), LLH-1326
(`kxv9m07u`), LLH-1325 (`uz0emwv9`), LLH-1324 (`c1w1vvs5`), LLH-1113 (`jhos00j7`) und LLH-1120
(`ixr64ox8`). Die Folge ist fest, weil Migrationen, Typ-Codegen und die Bind-Kette im PATCH sonst
gleichzeitig entstehen (design.md, Risiken).

Für jede Aufgabe gilt:
- Sie entsteht per TDD.
- Backend wird mit `cargo test <Filter>` geprüft, Frontend mit
  `mise exec -- pnpm -C frontend exec vitest run <Datei>`.
- Nach jeder Änderung an einem DTO oder Enum laufen `scripts/check-typ-codegen.sh` und, vor jedem
  Push, `scripts/check-migrationen.sh`.

## 1. Grundlage Erfassungszeit und Idempotenz — LLH-1138 (ewjfqaek), Backend

- [x] 1.1 Migration `0217`: `client_id` und `eingegangen_at` (nullable) an `person_sichtung`, `person_verbleib` und `person_verlaufsnotiz`, dazu partielle Unique-Indizes je Einsatz. Prüfung: Migrationstest grün und `check-migrationen.sh` grün.
- [x] 1.2 Zeit-Helfer für medizinische Einträge: `support::meldezeitpunkt` plus Untergrenze `einsatz_person.erfasst_at` (design.md D5). Unit-Tests für mehr als 60 s Zukunft (400), höchstens 60 s Zukunft (jetzt), vor dem Anlegen (gekappt) und ohne Angabe (jetzt).
- [x] 1.3 Sichtung: POST nimmt `client_id` und `zeitpunkt_at` an, Replay vor `fordere_aktiv`, Cache nach jüngstem Zeitpunkt (D6), Hinweis „Sichtung I“ nur, wenn der Eintrag gewinnt, ETB mit `ereigniszeit` und „nachgetragen“, ETB-Live-Ereignis. Servertests: doppelte `client_id` ergibt einen Eintrag und einen ETB-Eintrag, ältere Sichtung ändert den Cache nicht und benachrichtigt nicht, Zukunft 400.
- [x] 1.4 Verbleib: dasselbe wie 1.3 in einem `write_retry!` samt Auto-Austritt, der nur läuft, wenn der Eintrag gewinnt. Die Kurzform wird aus der gewinnenden Zeile berechnet. Servertests: älterer Verbleib ohne Austritt, Replay idempotent.
- [x] 1.5 Notiz: `client_id` und `zeitpunkt_at`, ohne ETB. Servertest Replay.
- [x] 1.6 Bestätigung zur Erfassungszeit (D7) in `geraet::bestaetigung`. Servertest: Kraft nach der Erfassung entlassen, das Replay gelingt; Rückfall „aktiv jetzt“, wenn die Einsatzzeit fehlt.
- [x] 1.7 Typ-Codegen und Wire-Kontrakt nachgezogen, `tests/geraet_kopplung.rs` mit Replay am Gerät grün.

## 2. PAT-Nummer und Kontamination — LLH-1326 (kxv9m07u)

- [x] 2.1 Migration `0218`: `pat_nummer`, `kontamination` (CHECK 0/1, nullable). `PersonAnzeige`, `PersonAuswahl`, `PatchBody`/`PatchDaten` und die Bind-Kette in `repo::aktualisiere` neu nummerieren. Repo-Test `aktualisiere_setzt_jede_spalte_an_ihren_platz` erweitert. Servertest: ein einzelnes Feld leert keine anderen.
- [x] 2.2 `PAT_NUMMER_MAX` mit Spiegel in `frontend/src/api/eingabegrenzen.ts` und `tests/eingabegrenzen_spiegel.rs`. Servertest: über der Grenze 400.
- [x] 2.3 Aufbewahrung: `pat_nummer` Scrub `Z_BEHANDLUNG` (gepinnt, `PERSONENBEZUEGE` `Mit`), `kontamination` Retain, `behandlungsbezug_sql` erweitert. Tests: Guard grün, nur-PAT-Person hat Behandlungsbezug, Schwärzung leert die PAT-Nummer.
- [x] 2.4 Frontend: Statusvertrag `kontamination` (Rolle `achtung`, Wort), Suchtext der Spalte `reg`, Platzhalter der Suche, `PERSON_AUF_DER_PLATTE` (D9), `lagebildKuerzen` für `personenAuswahl`. Vitest: Suche findet „4711“, Kürzung lässt die PAT-Nummer aus.
- [x] 2.5 Sprungpalette: `pat_nummer` im Label „PAT …“, Ziffernzweig mit exaktem PAT-Treffer (D12). Vitest: „4711“ trifft R-4711 und R-012 mit „PAT 4711“.

## 3. Transport — LLH-1325 (uz0emwv9)

- [x] 3.1 Migration `0219`: Tabelle `person_transport` (Stand, `zeitpunkt_at`, `erfasst_at`, Erfasser, Bestätigung, `client_id`) und Cache-Spalten an `einsatz_person`. Wire-Enums für Priorität, Art und Fachrichtung mit Wire-Kontrakt.
- [x] 3.2 `POST …/personen/{pid}/transport` mit Bestätigung, Erfassungszeit, Cache nach jüngstem Zeitpunkt und ETB nur bei Prioritätswechsel („Person R-012: Transportpriorität dringlich“, „… aufgehoben“, „, bestätigt: Name“). `PersonDetail.transporte`. Servertests: Rechte, Org-Isolation, 400/409/422, kein ETB bei reinem Art- oder Fachrichtungswechsel, Leak-Test (Art und Fachrichtung weder in ETB noch in SSE), Replay.
- [x] 3.3 Aufbewahrung (D4) und Gerät: `UHS_TABLET`/`UHS_LAPTOP`, Betreuungsstelle 403, fremde UHS 404. Tests: Schwärzungs-Guards, `tests/geraet_kopplung.rs`.
- [x] 3.4 Sortierung: `dringlichkeit.ts` mit Priorität als zweitem Schlüssel und `dringlichkeitsWert` mit Zwischenschritt. Vitest mit den beiden Szenarien der Spec `personen-transport`. Spalte „Transport“ in `personenSpalten.tsx` (sortierbar, Budget), Marke in der Transportspalte des Grundrisses. Vitest.

## 4. Maßnahmen — LLH-1324 (c1w1vvs5)

- [x] 4.1 Migration `0220`: Tabelle `person_massnahme` (Art, `zeitpunkt_at` als Durchführung, `erfasst_at`, Erfasser, Bestätigung, `aufgehoben_*`, `client_id`). Wire-Enum mit Wire-Kontrakt.
- [x] 4.2 `POST …/massnahmen` und `POST …/massnahmen/{mid}/aufheben` (D1, rennsicheres 409). `PersonDetail.massnahmen`. Servertests: Rechte, Org-Isolation, unbekannte Maßnahme 400, storniert 409, vermisst 422, zweimal aufheben 409 auch gleichzeitig, Leak-Test, Replay.
- [x] 4.3 Aufbewahrung und Gerät wie 3.3. Tests grün.

## 5. Verletzungen — LLH-1113 (jhos00j7)

- [x] 5.1 Migration `0221`: Tabelle `person_verletzung` (Ansicht, Region, Art, Schwere, `x`, `y`, `notiz`, Zeiten, Erfasser, Bestätigung, `aufgehoben_*`, `client_id`). Wire-Enums mit Wire-Kontrakt, `VERLETZUNG_NOTIZ_MAX` mit Spiegel.
- [x] 5.2 `POST …/verletzungen` und `…/verletzungen/{vid}/aufheben` mit Prüfung der Paare aus Ansicht und Region (422) und Lage 0..1 (400). `PersonDetail.verletzungen`. Servertests in `tests/person_verletzung.rs`: Rechte, Org-Isolation, Gerät, Katalog 400, Paare 422, zweimal aufheben 409, Leak-Test (Region, Art und Notiz weder in ETB noch in SSE), Replay.
- [x] 5.3 Aufbewahrung: `x`/`y`/`notiz` Scrub `Z_BEHANDLUNG` gepinnt, Fixture in `purge_scheduler.rs` für `schwaerzung_hinterlaesst_keine_altbytes`. Gerät wie 3.3. Tests grün.

## 6. Patientenkopf und Verlauf — LLH-1324, LLH-1325, LLH-1326, LLH-1113

- [x] 6.1 API-Funktionen in `api/einsatzPerson.ts` für Transport, Maßnahme, Verletzung (erfassen und aufheben). Test-Fixtures bekommen die neuen Pflichtfelder (`PersonVerlauf.test.tsx`, `Grundriss.test.tsx` u. a.). `tsc -b` grün.
- [ ] 6.2 `Patientenkopf.tsx`: Kopfzeile mit PAT-Nummer und „kontaminiert“, Raster in zwei Spalten ab `lg` mit Transport, Maßnahmen und Verletzungen und Kürzung „+ n weitere“ (D14). Vitest für Lesen, voll, leer und ohne Schreibrecht.
- [ ] 6.3 Paneele „Transport festlegen“ und „Maßnahme erfassen“ mit „Bestätigt von“ am Gerät, Ablehnung am Ort, ein Paneel zugleich, Wechsel beim Speichern gesperrt. PAT-Nummer und Kontamination inline über den PATCH, ohne Netz gesperrt. Vitest mit verzögerter Antwort und Ablehnung.
- [ ] 6.4 `PersonVerlauf.tsx`: Transport, Maßnahme (auch aufgehoben) und Verletzung (auch aufgehoben) als Einträge, nachgetragene Einträge erkennbar. Vitest.

## 7. Körperschema — LLH-1120 (ixr64ox8)

- [ ] 7.1 `personen/koerperschema/geometrie.ts`: Regionen im normierten Rahmen, drei Umrisse, Trefferzonen für Hand, Fuß und Hals über die Silhouette hinaus. Vitest: jeder Regionsmittelpunkt liegt in jedem Umriss, jede Region hat ihre Ansicht nach den Paaren der Spec.
- [ ] 7.2 `personen/koerperschema/koerperschemaKern.ts`: Figur aus Geschlecht, Name „Unterarm links, vorn“, feste Nummerierung mit Lücken. Vitest.
- [ ] 7.3 `personen/Koerperschema.tsx`: Lesen und Markieren, Wahl der Art als Flächen, Speichern mit dem zweiten Tipp, Aufheben am Sternchen, Ablehnung am Schema, Tastatur in fester Folge, vorn und hinten ab `md` bzw. umschaltbar. Vitest für Lesen, Markieren, Aufheben, gesperrt, Ablehnung und Tastatur.
- [ ] 7.4 Einbau: Datenfeld „Verletzungen“ mit Mini-Figur im Kopf, Paneel „Verletzung markieren“, Schnellansicht lesend. Vitest.
- [ ] 7.5 Druckseite `/einsaetze/:id/personen/:pid/druck`: Route, einmal laden, „Neu laden“, Audit `druck` mit `person_id`, unbekannte Person, nicht am Gerät. Server- und Seitentest. Eintrag in `playwright.config.ts` `DRUCK_SPECS` und e2e `koerperschema-druck.spec.ts` schwarz-weiß.
- [ ] 7.6 Kontrast: `theme/koerperschemaKontrast.test.ts` (Silhouette und Sternchen in Tag und Nacht) und `e2e/betroffene-kontrast.spec.ts` erweitert. Trefferflächen in `e2e/trefflaeche-pruefflaechen.spec.ts` (72 × 72 in der Handschuh-Stufe, auch für die Hand).

## 8. Ohne Netz im Frontend — LLH-1138 (ewjfqaek)

- [ ] 8.1 `offline/schreiben.ts`, `queue.ts`, `useOfflineSync.ts`, `OfflineRecoveryDrawer.tsx`: Aktionsarten Sichtung, Verbleib, Notiz, Transport, Maßnahme, Verletzung über `mitErfassungszeitOfflineFaehig`. Vitest mit `setzeOnline`: vorgemerkt, übertragen und abgelehnt mit Grund im Wiederherstellungsbereich.
- [ ] 8.2 Ansatzstellen auf die vorgemerkten Wege umstellen (`saveSichtung`, Verbleib-Mutationen samt Grundriss-Transport, Notizzeile, die neuen Paneele) mit `networkMode: 'always'` und Quittung „Offline vorgemerkt“ am Ort. Vitest je Stelle.
- [ ] 8.3 e2e am UHS-Tablet: Nachsichtung, Verbleib und Notiz ohne Netz, danach genau einmal mit Erfassungszeit im Verlauf.

## 9. Regeln, Doku, Nachweise

- [ ] 9.1 Regeln: `frontend/AGENTS.md` („Ein Iconsatz“ mit Körperschema), `frontend/src/personen/AGENTS.md` (Patientenkopf, Körperschema, Verlauf), `frontend/src/geraet/AGENTS.md` (Bestätigt von, „Nichts auf der Platte“ mit Warteschlange), `frontend/src/offline/AGENTS.md` (Personen-Schreibwege, Positivliste). Kommentare in `migrations/0022`, `sichtung_repo.rs`, `verbleib_repo.rs` korrigiert. Prettier grün.
- [ ] 9.2 Anwenderdoku: `betroffene.md`, `geraet-uhs.md`, `ohne-netz.md`, `unfallhilfsstellen.md`, `aufbewahrung.md`. Bilder `betroffene` und `geraet-uhs` neu (`pnpm doku:bilder --grep …`). Doku-Wächter grün.
- [ ] 9.3 e2e `personen-detail.spec.ts`: voller PAT-Kern bei 1280 × 800 und 1440 × 900 ohne Bildlauf, Transport festlegen, Maßnahme erfassen, Verletzung markieren und aufheben. `geraet-uhs-tablet.spec.ts`: Markieren mit „Bestätigt von“. `tsc` und `eslint` über `frontend/e2e` grün.
- [ ] 9.4 Gate-Bündel `schnell` und `frontend` von `scripts/check-all.sh` grün, Rust gezielt für alle berührten Testdateien grün.
