# Tasks

Jede Aufgabe entsteht per `superpowers:test-driven-development` (erst der rote Test, dann der
Code). Vor jedem „fertig“ gelten `verification-before-completion` und `requesting-code-review`.

## 1. Datenmodell und Perioden-Kern

- [x] 1.1 Migration `0127_kraefte_zeitachse.sql` anlegen (Tabelle `einsatz_kraft_zeitachse` mit CHECKs auf Art, Quelle und genau eine Kraft; Indizes; `zeitachse_marke` an `fahrzeug_status` und `personal_status`). Nachweis: `scripts/check-migrationen.sh` grün gegen `origin/alpha`, und ein DB-Test belegt, dass eine Zeile mit beiden oder keiner Kraft am CHECK scheitert.
- [x] 1.2 Enums `ZeitachseArt`, `ZeitachseQuelle`, `ZeitachseMarke` mit Wire-Namen in `src/zeitachse/mod.rs`. Nachweis: Einträge in `tests/enum_wire_kontrakt.rs` grün.
- [x] 1.3 Reine Perioden-Funktion `perioden::bilde` und `perioden::pruefe_einfuegen`/`pruefe_streichen` über einer sortierten Folge. Nachweis: Unit-Tests für jedes Szenario der Requirements „Einsatzperioden“ und „Einsatzdauer und Ruhezeit“ (Anker Alarmierung vor Eintreffen, zwei Perioden, Ende ohne Periode, Alarmierung nach Eintreffen, Nachtrag, der eine frühere Periode zerbräche).
- [x] 1.4 Schwärzungsregel für `einsatz_kraft_zeitachse` (`notiz`, `streichgrund` schwärzen, Rest retain). Nachweis: die bestehenden Registry-Guards und `jede_archivspalte_ist_retain` sind grün.

## 2. Schreibpfad, Fan-out und Streichung

- [x] 2.1 `zeitachse::repo::schreibe_tx` mit Perioden-Prüfung und Ergebnis `Geschrieben | Ausgelassen`. Nachweis: Repo-Tests für Schreiben, Auslassen und die Reihenfolge nach Zeitpunkt.
- [x] 2.2 Fan-out auf die zugeordneten Personen in derselben Transaktion (`quelle = einheit`, `ursprung_id`). Nachweis: Tests „Einheit trifft ein“, „Person schon eingetroffen“, „Nachträglich zugeordnet“.
- [x] 2.3 `zeitachse::repo::streiche_tx` samt Fan-out-Kette und Perioden-Prüfung. Nachweis: Tests für Streichung mit Kette, doppelte Streichung (422) und einen Streich-Verstoß gegen die Perioden (422).
- [x] 2.4 Append-only-Guard: Ein Test liest den Quelltext von `src/zeitachse/repo.rs` und schlägt bei jedem `DELETE` oder bei einem `UPDATE`, das nicht die Streich-Spalten setzt, an. Nachweis: eine Mutationsprobe mit einem eingefügten `UPDATE … SET art` macht ihn rot.

## 3. Ereignisse aus Statuswechseln

- [ ] 3.1 Personal: Disposition und Status-PATCH in `routes/einsatz_personal.rs` rufen `schreibe_tx`, wenn der neue Status eine Marke trägt. `Ausgelassen` wird verschluckt. Nachweis: Integrationstests „Person wird alarmiert“, „Unpassendes Ereignis bricht den Status nicht“, „Status ohne Marke“.
- [ ] 3.2 Fahrzeug einer Einheit: Beginn-Marken nach der Regel „erstes Fahrzeug“, Entlassung nach der Regel „alle Fahrzeuge“, jeweils mit Fan-out. Nachweis: Integrationstests „Erstes Fahrzeug trifft ein“, „Entlassung erst mit dem letzten Fahrzeug“, und ein Fahrzeug ohne Einheit schreibt nichts.
- [ ] 3.3 Handstatus einer Einheit ohne Fahrzeug (`setze_hand_status_tx`) wirkt wie ein Wechsel an der Einheit. Nachweis: Integrationstest mit Fan-out.
- [ ] 3.4 Katalog: `zeitachse_marke` in den Katalog-DTOs und -Routen (400 bei unbekannter Marke, Rechte wie bisher), Startliste Personal mit den drei Marken, Bestand ohne Marke. Nachweis: Tests „Unbekannte Marke“, „Bestand ohne Marke“ und der erweiterte Bootstrap-Test `seedet_personal_status_startliste_fuer_neue_org`.

## 4. Kopplung an die Ablösung

- [ ] 4.1 `abloesung::repo::vollziehe` schreibt das Ereignis `abloesung` samt Fan-out, und die Rücknahme streicht es mit dem Grund „Ablösung zurückgenommen“. Nachweis: Tests „Vollzug beendet die Periode“, „Rücknahme öffnet die Periode wieder“, „Einheit ohne Periode“ und die Rücknahme nach einer zweiten Ablösung derselben Einheit. Die bestehenden Tests unter `tests/abloesung*.rs` bleiben grün.
- [ ] 4.2 Eine Schicht ohne Beginn übernimmt das Eintreffen der offenen Periode (MODIFIED `kraefte-abloesung`). Nachweis: Tests „Beginn fehlt, Einheit ist eingetroffen“ und „Beginn fehlt“.

## 5. API

- [ ] 5.1 Routen nach D6 (Listen je Modul, Detail, Nachtrag, Streichung) mit `JsonBody`/`PfadParam`, Rechten nach Requirement „Rechte“ und System-ETB für Nachtrag und Streichung. Nachweis: Integrationstests für jedes Szenario von „Nachtrag von Hand“, „Streichung“ und „Rechte“. Die Guards `tests/einsatz_kontext_guard.rs`, `json_extractor_guard.rs`, `path_extractor_guard.rs` und `tests/fehler_vertrag.rs` sind grün.
- [ ] 5.2 Nachtrag und Streichung senden das Live-Event der Kraft (`einheit` bzw. `personal`). Nachweis: ein Test im Stil der bestehenden Live-Tests empfängt das Event.
- [ ] 5.3 Response-DTOs mit `ToSchema` in `src/api_doc.rs`, dann `scripts/check-typ-codegen.sh`. Nachweis: das Skript ist grün, und `openapi.json` und `types.generated.ts` sind mitcommittet.

## 6. Frontend: Kern, Query-Keys, Katalog

- [ ] 6.1 `kraefte/zeitachse.ts`: Dauer aus Perioden und Uhr, Formatierung („7 h 40“, „40 min“), Leerfall `null`, Herkunftswort. Nachweis: Vitest für jedes Szenario von „Einsatzdauer und Ruhezeit“ und für die Herkunftswörter.
- [ ] 6.2 `einsatzKeys.kraefteZeitachse` in `api/queryKeys.ts`, eingeordnet unter `EINSATZ_STREAM_EVENTS` (`einheit`, `personal`, `fahrzeug`, `abloesung`) und `LAGEBILD_OFFLINE`, dazu der API-Client. Nachweis: `queryKeys.guard.test.ts`, `queryKeys.test.ts` und `lagebildOffline.guard.test.ts` sind grün.
- [ ] 6.3 `stammdaten/StatusKatalogTab.tsx`: Auswahl „Zeitachse“ je Eintrag (leer = keine) und ein Hinweis, wenn kein Eintrag eine Marke trägt. Nachweis: ein Komponententest für das Setzen und Leeren und für den Hinweis.

## 7. Frontend: Anzeige

- [ ] 7.1 Meldebild: Spalte „Im Einsatz“ (Mono, `tabular-nums`, Anker als zugängliche Beschreibung, „—“ ohne Periode), auch im Druck. Nachweis: Vitest „Meldebild ohne Ereignisse“ (Abwesenheit einer Zahl) und „Meldebild mit laufender Periode“, dazu `kraefteuebersichtPrint.test.ts` mit der Spalte.
- [ ] 7.2 Zeitachsen-Bauteil (Liste von `Zeitachseneintrag`, gestrichen durchgestrichen mit Grund, Herkunftswort) und Nachtrag-Modal über `ErfassungsModal` (drei Felder) mit `SpeicherFehler`. Nachweis: Komponententests „Herkunft sichtbar“, Enter sendet, und eine 422 steht an der Seite, nicht im Toast.
- [ ] 7.3 Einheit-Detailseite: Paneel „Zeitachse“ mit Nachtrag und Streichen (Aktionsmenü, Rückfrage mit `danger`, Grund Pflicht). Ohne Schreibrecht erscheint `RechteHinweis`, und die Aktionen sind gesperrt sichtbar. Nachweis: Seitentests für Schreib- und Leserolle.
- [ ] 7.4 Personal-Seite: Spalten „Einsatzdauer“ und „Ruhe“ und aufklappbare Zeitachse über `Datensicht.aufklappen` mit Nachtrag. Nachweis: Seitentests, der Spaltenschalter zählt die neuen Spalten, und `datensicht.guard.test.ts` ist grün.
- [ ] 7.5 Prüfliste Einsatztauglichkeit (15 Kriterien) für Meldebild, Einheit-Detail und Personal als `openspec/changes/lfh-552-kraefte-zeitachse/pruefliste.md`, jede Zeile mit Verdikt. Nachweis: die Datei liegt vor, und kein Kriterium steht auf „nicht geprüft“.
- [ ] 7.6 e2e: Nachtrag an einer Einheit → Spalte „Im Einsatz“ im Meldebild, gemessen als Beobachter und als Führungskraft über `e2e/rollen-kern.ts`, Warten auf einen Inhaltsanker (kein `networkidle`). Nachweis: die neue Spec ist in `pnpm e2e` grün.

## 8. Abschluss

- [ ] 8.1 `CLAUDE.md` um einen Absatz „Kräfte-Zeitachse (LFH-552)“ ergänzen (Tabelle, Marke am Katalog, Fan-out, kein Stab-Ort, Bruch von LFH-46 E17 mit Datum). Nachweis: der Absatz verweist auf den Archivpfad der Change.
- [ ] 8.2 `./scripts/check-all.sh` ist grün. Nachweis: die Gesamtübersicht des Skripts, bzw. der CI-Lauf des PRs.
- [ ] 8.3 `/opsx:archive lfh-552-kraefte-zeitachse` im selben Branch vor dem PR (Spec-Sync nach `openspec/specs/kraefte-zeitachse/` und `kraefte-abloesung/`, Verweise nachgezogen). Nachweis: `scripts/check-openspec-archiv.sh` ist grün.
