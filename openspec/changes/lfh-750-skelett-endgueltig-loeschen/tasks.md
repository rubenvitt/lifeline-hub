# Tasks

Jede Aufgabe entsteht per `superpowers:test-driven-development`: den Test zuerst rot sehen,
dann grün. Spec-Bezüge: `specs/aufbewahrung/spec.md`, `specs/aufbewahrung-archiv/spec.md`.
Entscheidungen: `design.md` D1–D7.

## 1. Schema und Klassifikation

- [x] 1.1 `git fetch origin alpha`, dann Migration `migrations/0135_aufbewahrung_skelett_loeschung.sql` nach design.md D4 (Spalte `org_einstellungen.skelett_dauer_tage`, Tabelle `aufbewahrung_loeschprotokoll` mit Index). Verifikation: `scripts/check-migrationen.sh` grün, und `db::tests::migrationsnummern_sind_eindeutig` grün
- [x] 1.2 Registry-Eintrag `aufbewahrung_loeschprotokoll` in `src/einsatz/schwaerzung_registry.rs` (`Scoping::EinsatzId`, alle Spalten Retain mit Begründung nach dem Präzedenzfall `demo_import`). Verifikation: Die Guard-Tests der Registry (`entdeckte_tabellen_gleich_registry_tabellen` u. a.) sind ohne Eintrag rot und mit Eintrag grün

## 2. Org-Einstellung `skelett_dauer_tage` (D1, D2)

- [x] 2.1 `ist_gueltige_skelett_dauer` (1..=36500) neben `ist_gueltige_retention_dauer` in `src/einsatz/einstellungen.rs`, mit Grenztest (0, 1, 36500, 36501)
- [x] 2.2 Feld in `OrgEinstellungen`, `OrgEinstellungenAnzeige`, `OrgEinstellungenDaten`, SELECT/UPSERT von `src/org/einstellungen.rs` und in `OrgEinstellungenUpdate`. Verifikation: Ein Repo-Test schreibt den Wert, liest ihn zurück und erhält `None` als Vorgabe
- [x] 2.3 `routes::org_einstellungen::setzen`: 400 außerhalb des Bereichs, 409 ohne `skelett_dauer_bestaetigt` beim erstmaligen Setzen oder Verkürzen, ohne Bestätigung beim Gleichlassen, Verlängern und Leeren, 403 für eine Führungskraft. Verifikation: Integrationstests in `tests/` für jedes Szenario aus „Frist für die endgültige Löschung“ (die 409 schreibt nichts, also den Wert danach lesen)
- [x] 2.4 `scripts/check-typ-codegen.sh` laufen lassen und `frontend/src/api/types.generated.ts` samt zweiter generierter Datei mitcommitten (`src/AGENTS.md`, Typ-Codegen). Verifikation: Das Skript ist danach grün

## 3. Zeitrechnung und Zustand (D1, D6)

- [x] 3.1 `retention::skelett_loeschung_am(abgeschlossen_at, geschwaerzt_at, skelett_dauer_tage) -> Option<String>` (Maximum aus Abschluss + N und Schwärzung, `None` ohne N oder bei unparsebarem Abschluss) und `skelett_loeschung_faellig(…, jetzt) -> bool` (nur geschwärzt, defensiv `false` bei unparsebaren Werten). Verifikation: Unit-Tests für Grenze genau bei `jetzt`, für eine Schwärzung nach Abschluss + N und für fehlende Werte
- [x] 3.2 `AufbewahrungZustand` um `LoeschungAusstehend`/`EndgueltigGeloescht` erweitern, und `retention::zustand` bekommt die Skelett-Frist (`loeschung_ausstehend` vor `geschwaerzt`). Alle Aufrufer nachziehen (`aufbewahrung::repo`). Verifikation: Die bestehenden Zustandstests bleiben grün, und neue Tests für `loeschung_ausstehend` sowie „ohne Org-Frist bleibt `geschwaerzt`“ sind grün

## 4. Löschung, Protokoll und Sperren (D3, D4, D5)

- [x] 4.1 `fk_pruefung_sicherstellen` aus `src/demo/entfernen.rs` nach `crate::db` heben (Zweck als Parameter für die Meldung). Verifikation: Die Demo-Tests in `src/demo/entfernen_tests.rs` bleiben grün
- [x] 4.2 `einsatz::skelett_loeschung::faellige(pool, jetzt)` (eigenes Modul, `repo.rs` ist zu groß) (Join auf `org_einstellungen`, nur abgeschlossen + geschwärzt + Frist gesetzt, Fälligkeit über 3.1). Verifikation: Repo-Test mit je einem Einsatz fällig, nicht fällig, nicht geschwärzt, aktiv und aus einer Org ohne Frist. Nur der erste ist Kandidat
- [x] 4.3 `einsatz::skelett_loeschung::loeschen(pool, id, jetzt)` nach D3 (eine `BEGIN IMMEDIATE`-Transaktion über `write_retry!`: erneute Prüfung, Akteur fail-closed, Protokollzeile, `DELETE` mit `status` und `geschwaerzt_at IS NOT NULL`, genau 1 Zeile). Verifikation: Tests „Protokollzeile nach der Löschung“ (genau eine Zeile, ohne Bezeichnung und Stichwort; nach dem `DELETE` keine Zeile mit `einsatz_id` mehr in einer einsatzbezogenen Tabelle, `PRAGMA foreign_key_check` leer), „Kein Akteur auffindbar“ (Einsatz bleibt, keine Zeile, mit Admin danach gelöscht), „Scheitern der Löschung“ (vorab eingefügte Protokollzeile mit derselben `einsatz_id` → Fehler, Einsatz bleibt), Race (Frist zwischen Kandidatenliste und Aufruf geleert → `Ok(false)`)
- [x] 4.4 ID-Sperre in `anlegen_tx` und Nummernsperre in der Vergabe von `nummer_lfd` über `aufbewahrung_loeschprotokoll` (D5). Verifikation: Test „Keine Wiedervergabe“ (Einsatz mit höchster ID und höchster `nummer_lfd` des Jahres löschen, neuen Einsatz desselben Jahres anlegen → weder ID noch Nummer gleich). Mutationsprobe: ohne die Protokoll-Klausel wird der Test rot, im PR-Text dokumentieren

## 5. Purge-Lauf Phase D (D3)

- [x] 5.1 Phase D in `tick_mit_rueckschrieb` nach Phase C, Rückschrieb auch bei `geloescht > 0`. Den Modul-Doc-Kommentar um Phase D ergänzen. Verifikation: Tests in `purge_scheduler::tests`: „Fällig“ (Einsatz samt ETB, Personen, Tieren, Schäden, Anhängen weg), „Noch nicht fällig“, „Fremde Organisation“, „Frist abgelaufen, aber noch nicht geschwärzt“ (vorgemerkt mit abgelaufener Skelett-Frist: kein Löschen vor dem Lauf, der ihn schwärzt; im Schwärzungslauf geschwärzt und danach gelöscht), zweiter Lauf idempotent (liefert 0), „Ohne Skelett-Frist“ bleibt das Skelett
- [x] 5.2 Akzeptanztest `skelett_loeschung_hinterlaesst_keine_altbytes` (Datei-Pool über `db::connect` wie `schwaerzung_hinterlaesst_keine_altbytes`): eindeutiger Text im ETB eines geschwärzten Einsatzes, Löschung über `tick_mit_rueckschrieb`, danach DB-Datei und `-wal` byteweise durchsuchen → nicht gefunden. Mutationsprobe: ohne Rückschrieb nach Phase D gefunden, im PR-Text dokumentieren
- [x] 5.3 Restore-Test analog `restore_von_vor_der_schwaerzung_wird_erneut_geschwaerzt`: Sicherung vor der Löschung, löschen, zurückspielen, `tick_einmal` → wieder gelöscht, genau eine Protokollzeile

## 6. Übersicht „Aufbewahrung“ (D6)

- [x] 6.1 `AufbewahrungEintragAnzeige`: `bezeichnung: Option<String>`, neu `loeschung_am` und `endgueltig_geloescht_at`. `aufbewahrung::repo::uebersicht` lädt Org-Frist und Protokollzeilen der Org. Verifikation: Repo-Tests für die Szenarien „Löschung am“, „Löschung ausstehend“, „Endgültig gelöscht“ und „Löschprotokoll einer fremden Organisation“. Der bestehende Test „Zustände“ bleibt grün
- [x] 6.2 Guard `archiv_namensraum_nur_lesend_und_admin` (`tests/aufbewahrung.rs`) bleibt grün (keine neue Route). Neuer Integrationstest: Die Archivakte eines endgültig gelöschten Einsatzes liefert 404
- [x] 6.3 `scripts/check-typ-codegen.sh` erneut laufen lassen und die generierten Dateien mitcommitten. Verifikation: Das Skript ist grün
- [x] 6.4 `frontend/src/aufbewahrung/AufbewahrungUebersicht.tsx`: Etiketten und Filter für `loeschung_ausstehend`/`endgueltig_geloescht`, Spalte „Löschung am“, bei gelöschten Zeilen kein Sprung in die Akte und der Hinweis „endgültig gelöscht“ statt der Bezeichnung (Regeln aus `frontend/AGENTS.md`). Verifikation: Vitest in `AufbewahrungUebersicht.test.tsx` für die Szenarien „Gelöschter Einsatz“ und „Sprung in die Akte“

## 7. Einstellungsseite (D7)

- [ ] 7.1 `orgEinstellungenForm.ts` übernimmt `skelett_dauer_tage` in den Voll-PUT, `skelett_dauer_bestaetigt` nur nach der Bestätigung. Verifikation: `orgEinstellungenForm.test.ts` (Feld wird gesendet, Leerwert wird zu `null`)
- [ ] 7.2 `EinsatzDefaults.tsx`: Feld im Abschnitt „Aufbewahrung“ mit Tooltip und Bestätigungsdialog beim Setzen oder Verkürzen (kein Dialog beim Verlängern oder Leeren). Verifikation: `EinsatzDefaults.test.tsx` für Setzen mit Dialog → PUT mit `true`, Abbrechen → kein PUT, Verlängern ohne Dialog

## 8. Regeln und Betriebsdoku

- [ ] 8.1 `src/AGENTS.md`, Abschnitt „Backend — Aufbewahrung (LFH-23)“: Bullet zu LFH-750 (Phase D, Löschprotokoll als einzige Spur, fail-closed, ID- und Nummernsperre über das Protokoll, Bestätigung 409, Herleitung dieser Change). Dazu im Abschnitt Demo-Daten die Regel „Einsatz-IDs werden nie wiederverwendet“ um das Protokoll ergänzen. Verifikation: `grep -n "LFH-750" src/AGENTS.md`
- [ ] 8.2 `docs/betrieb/backup-restore.md`: Ein Restore bringt endgültig gelöschte Skelette bis zum nächsten Purge-Lauf zurück. Verifikation: Der Absatz steht im Abschnitt „Sicherungen und Schwärzung“

## 9. Abschluss

- [ ] 9.1 `cargo test --workspace --exclude lifeline-desktop`, Vitest und `./scripts/check-all.sh` grün (bzw. mit Verweis auf den CI-Lauf des PRs abhaken)
