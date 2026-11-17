# Tasks

Gliederung nach Unteraufgabe: `r9up3kp5` = LLH-1831 (Konfliktprüfung), `mdopfgqk` = LLH-1834
(Änderungsvermerk). Jede Aufgabe per `superpowers:test-driven-development`: erst der rote Test.

## 1. Gemeinsamer Feld-CAS-Baustein im Backend (r9up3kp5)

- [x] 1.1 `ExpectedValue` und Suffix-Bau aus `person::repo` in `src/feld_cas.rs` lösen (eigener `refactor`-Commit); `person::repo::aktualisiere` nutzt ihn; verifiziert: bestehende Personen-Tests (`tests/einsatz_person*.rs`, `person::repo` Unit-Tests) grün ohne Änderung
- [x] 1.2 Gemeinsame Handler-Prüfung „Altwert nur mit Änderung desselben Felds, Koordinate als Paar“ als Funktion über eine Feldliste; `pruefe_erwartet` der Personen nutzt sie; verifiziert: Unit-Tests für 422 bei Altwert ohne Änderung und halbem Paar

## 2. Vermerk-Tabelle (mdopfgqk)

- [x] 2.1 Migration `einsatz_feld_vermerk` (Nummer > höchste auf `origin/alpha`) samt Spiegel-Triggern aus `spiegel::art::trigger_sql`; verifiziert: `scripts/check-migrationen.sh`, `db::tests::migrationsnummern_sind_eindeutig`
- [x] 2.2 Einordnung: `schwaerzung_registry::TABELLEN`, `instanz::spiegel::art` (`GESPIEGELT`, Kategorie `Fuehrung`), Archiv-Klassifikation; verifiziert: `art::tests::jede_einsatztabelle_ist_eingeordnet`, `trigger_passen_zur_beschreibung`, `jede_gespiegelte_tabelle_hat_einen_primaerschluessel`, `schema::tests::*`, `jede_archivspalte_ist_retain` grün
- [x] 2.3 Repo `einsatz::feld_vermerk`: Upsert auf einer Transaktion (feste Feldliste je Objektart), Laden je Objekt und je Einsatz/Objektart (eine Abfrage, Anzeigename per Join); verifiziert: Unit-Tests für Upsert, kein Upsert ohne Wertänderung, Laden mit fehlendem Benutzer (`von: null`), CASCADE beim Löschen des Einsatzes
- [ ] 2.4 `vermerke` in `EinsatzAnzeige`, `EinheitAnzeige` (Liste ohne N+1) und `FuehrungsstelleAnzeige`; `scripts/check-typ-codegen.sh` und beide generierten Dateien mitcommitten; verifiziert: Integrationstest „frisch angelegte Einheit liefert keine Vermerke“

## 3. Kopfdaten (r9up3kp5, mdopfgqk)

- [x] 3.1 `KopfdatenPatch.erwartet` + Prüfung (Paar, nur mit Änderung) und Suffix in `patche_kopf` auf einer Transaktion, Vermerk-Upsert für geänderte Felder (Koordinate als `einsatzort_koordinate`); verifiziert: Integrationstests in `tests/` für Szenarien „Leitstellen-Nr. mit veraltetem Stand“ (409, Wert bleibt, kein Vermerk), „Andere Zeile dazwischen“, „Adresse mit Treffer“, „Halbe Koordinate erwartet“ (422), „ohne erwartet wie bisher“, „gleicher Wert erneut gesendet“ (Vermerk unverändert)
- [x] 3.2 `patche_kopf_setzt_jede_spalte_an_ihren_platz` bleibt grün; Mutationsprobe: Suffix entfernen macht 3.1 rot

## 4. Einheit (r9up3kp5, mdopfgqk)

- [x] 4.1 `EinheitPatchBody.erwartet` (Spaltenfelder, `fuehrer_id`, Soll-Trio, `quali_soll`, `verbindungen`) + Prüfung; `patche`, Führerwechsel und Verbindungen in einer `BEGIN IMMEDIATE`-Transaktion mit Suffix bzw. Vergleich vor dem Schreiben; ETB und Live erst nach Commit; verifiziert: Integrationstests in `tests/einsatz_einheit.rs` für „Bemerkung mit veraltetem Stand“, „Verbindungen als Ganzes“, „Status dazwischen“, „Einheitsführer mit Altwert“ (ETB nur ein Eintrag), „Ein Feld veraltet, zwei gesendet“, „Altwert ohne Änderung“ (422)
- [x] 4.2 Vermerk-Upsert für jedes geänderte Feld (Sprechgruppen nicht); kein ETB-Eintrag aus dem Vermerk; verifiziert: Test „Bemerkung geändert → Vermerk, kein ETB-Eintrag“, bestehende ETB-Tests für Führer- und Abschnittswechsel grün
- [x] 4.3 Bestehender Vertrag LLH-1692 (Sprechgruppen nach `patche`) bleibt: bestehende Tests in `tests/einsatz_einheit.rs` grün

## 5. Führungsstelle (r9up3kp5, mdopfgqk)

- [ ] 5.1 `FuehrungsstellePatchBody.erwartet` (Art, Bezeichnung, Standort samt Paar, Rufname, Verbindungen, Fahrzeuge als Menge, Einsatzleiter) + Prüfung in `patch_tx` vor jedem Schreiben; Vermerk-Upsert; verifiziert: Tests in `tests/einsatz_fuehrungsstelle.rs` für „Rufname mit veraltetem Stand“, „Einsatzleiter gleichzeitig übergeben“ (nur ein Übergabe-Eintrag), „Ohne Altwert wie bisher“
- [ ] 5.2 Demo-Import (`demo/import.rs`) ruft `patch_tx` ohne `erwartet` weiter; verifiziert: Demo-Test grün

## 6. Frontend-Baustein (r9up3kp5)

- [ ] 6.1 `InlineAngabe`: Wert beim Öffnen einfrieren, als `{ beimOeffnen }` an `onSpeichern`; Hinweis „Inzwischen geändert[ von X, HH:MM]: …“ bei abweichendem Live-`wert`, Entwurf bleibt, Hinweis verschwindet bei Rückkehr; Prop `vermerk`; verifiziert: Vitest für alle drei Szenarien aus `formularseiten` „Fremder Wert im offenen Feld“ und unverändertes Verhalten ohne neue Props
- [ ] 6.2 `useFeldKonflikt` aus `Personendaten.tsx` lösen: Dialog mit „Meine Änderung übernehmen“ / „Verwerfen und neu laden“, Wer/Wann aus dem frischen Vermerk, Escape = `OFFEN_LASSEN`, 409 ohne Feldänderung an die Angabe; verifiziert: Vitest für die Szenarien aus `formularseiten` „Einheitlicher Dialog“ und „409 ohne fremde Änderung“
- [ ] 6.3 `Personendaten.tsx` auf den Hook umstellen (Wortlaut „Meine Änderung übernehmen“); bestehende Tests und e2e mit „Überschreiben“ anpassen; verifiziert: `grep -rn "Überschreiben" frontend/src frontend/e2e` findet den Personendialog nicht mehr, Personendaten-Tests grün

## 7. Frontend-Ansichten (r9up3kp5, mdopfgqk)

- [ ] 7.1 API-Funktionen `patcheEinsatz`, `patcheEinheit`, `patcheFuehrungsstelle` nehmen optionales `erwartet`; verifiziert: Vitest der API-Schicht (Body enthält `erwartet` nur, wenn übergeben)
- [ ] 7.2 `EinsatzdatenPage` (Kopfzeilen, Paneel Einsatzort mit Paar und Adresse+Treffer) und `EinsatzleiterAngabe` senden `erwartet` und nutzen `useFeldKonflikt`; Vermerk an der Zeile, jüngster im Paneelkopf (`meta`); verifiziert: Vitest für „Leitstellen-Nr. mit veraltetem Stand“ (Dialog), Paneelkopf „Zuletzt geändert von B, 14:05“, ohne Vermerk kein Kopftext
- [ ] 7.3 `EinheitKopf` und `EinheitFunk` (inkl. Bemerkung, Verbindungen, Führer, Soll-Trio, Qualifikationssoll) ebenso; verifiziert: Vitest für Bemerkung-Konflikt und Vermerk an der Zeile
- [ ] 7.4 e2e mit zwei Browserkontexten: A und B öffnen Einheit › Bemerkung bzw. Einsatzdaten › Leitstellen-Nr.; B sieht den Hinweis im offenen Feld, dann den Dialog; nichts still überschrieben; verifiziert: neue Spec unter `frontend/e2e/` grün

## 8. Regeln und Doku (r9up3kp5, mdopfgqk)

- [ ] 8.1 `frontend/AGENTS.md` („Bearbeiten in der Ansicht“): auch eine Einzelangabe trägt den Feldvergleich über `useFeldKonflikt`; `src/AGENTS.md`: neue 409-Quelle Feld-CAS an Einheit/Kopf/Führungsstelle und die Vermerk-Tabelle; verifiziert: Prettier über `frontend/`, Verweise per `grep` stimmig
- [ ] 8.2 Anwenderdoku (`docs/anwender/kapitel/` zu Einsatzdaten und Einheit, Konfliktdialog der Personendaten) nach `docs/anwender/AGENTS.md` (Mitänderungsregel, Bilder); verifiziert: Doku-Wächter aus `check-all.sh` grün

## 9. Integration

- [ ] 9.1 `./scripts/check-all.sh --geaendert --ohne-e2e` grün; die e2e aus 7.4 lokal einzeln grün

## Workflow follow-up

- Review vor dem PR über den ganzen Branch (Phase 4 von `dev-zunder-orchestrieren`).
- `/opsx:archive nvhnqynd-konflikt-und-aenderungsvermerk` im selben Branch vor dem PR.
- Folgeaufgaben aus `design.md` („Folgeaufgaben“) auf dem Board, Links im PR.
