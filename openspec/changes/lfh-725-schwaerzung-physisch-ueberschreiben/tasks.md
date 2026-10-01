# Tasks

## 1. `secure_delete` im Pool

- [ ] 1.1 Test `connect_setzt_secure_delete_on` in `src/db.rs` (analog `connect_enables_wal_and_foreign_keys`, `PRAGMA secure_delete` liest `1` auf **jeder** Pool-Verbindung, also mehrere gleichzeitig ausleihen) zuerst rot sehen, dann in `db::connect` `.pragma("secure_delete", "ON")` setzen und grün sehen; den Doc-Kommentar von `connect` um Grund und Verweis auf diese Change ergänzen
- [ ] 1.2 `test_pool_datei` bekommt dasselbe PRAGMA (Produktionsparität); belegt durch eine Assertion im Test aus 1.1 bzw. einen eigenen Test auf `test_pool_datei`

## 2. WAL-Rückschrieb nach der Schwärzung

- [ ] 2.1 `db::wal_zurueckschreiben(pool) -> Result<bool, AppError>` (`PRAGMA wal_checkpoint(TRUNCATE)`, `true` nur bei `busy = 0`) mit Test: nach einem Schreibvorgang ist `<db>-wal` danach 0 Bytes; mit einer offenen Lesetransaktion auf einer zweiten Verbindung liefert sie `false`
- [ ] 2.2 Purge-Scheduler: nach Phase B mit mindestens einer Schwärzung `wal_zurueckschreiben` aufrufen; bei `false` oder Fehler `checkpoint_ausstehend` in der Scheduler-Schleife merken und in jedem folgenden Tick erneut versuchen, bis `true`; `tracing` für Erfolg/Nachholen. Test (Datei-Pool): Leser blockiert den ersten Rückschrieb, der nächste Tick holt ihn nach (Spec-Szenario „Rückschrieb blockiert“)
- [ ] 2.3 Akzeptanztest `schwaerzung_hinterlaesst_keine_altbytes` (Datei-Pool mit Produktionsoptionen, also über `db::connect` auf einem Temp-Pfad + `migrate`): Einsatz mit eindeutigem Klartext in einer Scrub-Spalte (z. B. Personenname) und in einem Anhang-BLOB (> 1 Seite, damit Overflow-Seiten entstehen) anlegen, abschließen, vormerken, Karenz ablaufen lassen, `tick_einmal` + Rückschrieb; dann DB-Datei und `-wal` byteweise durchsuchen → nicht gefunden. Gegenprobe im selben Test oder per Mutationsprobe: ohne `secure_delete` bzw. ohne Rückschrieb wird der Klartext gefunden (Mutationsprobe im PR-Text dokumentieren)

## 3. Altbestand beim Start

- [ ] 3.1 `db::bereinige_altbestand_einmalig(pool)`: fehlt `app_meta.physisch_bereinigt_lfh725`, dann `VACUUM`, Schlüssel setzen, `wal_zurueckschreiben`; Fehler werden zurückgegeben, nicht verschluckt. Tests: (a) eine DB, in der vor dem Aufruf unter `secure_delete = OFF` ein Klartext gelöscht wurde, enthält ihn danach nicht mehr in der Datei; (b) ein zweiter Aufruf führt kein `VACUUM` aus (z. B. über einen danach gelöschten Klartext unter OFF, der stehen bleibt, oder über einen Rückgabewert `Ok(false)`)
- [ ] 3.2 `src/main.rs`: nach `migrate` und vor dem Router `wal_zurueckschreiben` und `bereinige_altbestand_einmalig` aufrufen; Fehler per `tracing::error!` melden, Start nicht abbrechen; Log nennt Beginn, Dauer und Ergebnis. Verifikation: `cargo build` und ein manueller Start auf einer Kopie mit Altbytes (Log-Zeile sichtbar, Marker gesetzt)

## 4. Restore einer Sicherung von vor der Schwärzung

- [ ] 4.1 Test (`tests/aufbewahrung.rs` oder `src/backup/`): vorgemerkten Einsatz per `erzeuge_sicherung` sichern, dann schwärzen, Sicherung über die Restore-Funktion zurückspielen, neu verbinden, `tick_einmal` mit einem Zeitpunkt nach der Karenz → Einsatz geschwärzt, `geloescht_at` unverändert aus der Sicherung (Spec-Szenario „Restore nach Ablauf der Karenz“)

## 5. Messung

- [ ] 5.1 `#[ignore]`-Test `secure_delete_messung` in `src/db.rs` (Lasten aus `design.md`, Entscheidung 5, inkl. 500 MB Anhänge für die Sperrdauer); mit `cargo test --release secure_delete_messung -- --ignored --nocapture` laufen lassen und die Zahlen in `design.md` (Abschnitt Messung) eintragen; überschreitet die Commit-Zeit der Schwärzung bei 500 MB den `busy_timeout` von 5 s, als Befund am Review-Checkpoint vorlegen

## 6. Regeln und Betriebsdoku

- [ ] 6.1 `src/AGENTS.md`, Abschnitt „Backend — Aufbewahrung (LFH-23)“: Bullet zu LFH-725 (Haupt-DB nur über `db::connect`, `secure_delete = ON` dort tragend, nicht `FAST`; Rückschrieb nach Phase B; Herleitung dieser Change). Verifikation: `grep -n "secure_delete" src/AGENTS.md`
- [ ] 6.2 `docs/betrieb/backup-restore.md`: Abschnitt „Sicherungen und Schwärzung“ (Laufzeit PII in Auto-Sicherungen = behalten × Intervall, Vorgabe ≈ 42 h; Downloads/externe Kopien nach der Karenz vernichten; Restore schwärzt vorgemerkte Einsätze erneut, Restore von vor der Vormerkung startet die Karenz neu; Platzbedarf des einmaligen Verdichtens beim ersten Start; Datenträgerverschlüsselung gegen Spuren unterhalb von SQLite). Verifikation: Abschnitt vorhanden, Vorgabewerte stimmen mit `src/config.rs` überein

## 7. Abschluss

- [ ] 7.1 `cargo test` (Backend) und `./scripts/check-all.sh` grün (bzw. mit Verweis auf den CI-Lauf des PRs abhaken)
