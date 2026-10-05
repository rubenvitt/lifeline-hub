# Tasks

## 1. Atomare Schwärzung ohne Anhang-Zeilen

- [x] 1.1 Test zuerst: Nach der atomaren Schwärzung eines Einsatzes mit 6 × 5 MB Anhängen (ohne Nachlauf) ist der WAL kleiner als 1 MB, die Anhang-Zeilen stehen noch, kein Linker verweist mehr auf sie (am ETB-Linker geprüft; alle Linker kommen aus demselben Register `CHAT_LINKER` + `MODUL_LINKER`), der Abruf liefert 404; Mutationsprobe: löscht der atomare Vorgang die Zeilen wieder selbst, werden die Tests rot
- [x] 1.2 Registry-Strategie `ZeileEinzelnLoeschen` für `anhang` in `schwaerzung_registry.rs`: `scrubbe_aus_registry` löscht die Linker-Zeilen (`CHAT_LINKER` und `MODUL_LINKER`) statt der Zeile; Guard-Tests der Registry und 1.1 grün
- [x] 1.3 Prüfung „zur Entfernung vorgesehen“ (Einsatz geschwärzt oder Kategorie `anhaenge` geschwärzt, Einsatz abgeschlossen) als eine SQL-Bedingung in `anhang::repo`; die Lese-Funktionen (`meta_fuer_download`, `laden_bytes`, `anzeige_laden`) liefern dafür 404; Test über den generischen Abruf der hochladenden Person grün

## 2. Nachlauf je Anhang

- [x] 2.1 Test zuerst: Nachlauf löscht jeden vorgesehenen Anhang in einer eigenen Transaktion, Anhänge anderer Einsätze bleiben, der WAL bleibt über den ganzen Nachlauf kleiner als zwei Anhänge; Mutationsprobe: ein `DELETE` für alle macht den Test rot (WAL 30 MB)
- [x] 2.2 `anhang::repo::entferne_vorgesehene(pool, einsatz: Option<i64>)` mit `write_retry!` je Anhang implementieren; 2.1 grün
- [x] 2.3 `schwaerze_einsatz`, `aufbewahrung_kategorie::schwaerzen` (bei `Anhaenge`) und `antrag::vollziehen_ergebnis` (bei `Vollzug::Einsatz`) rufen den Nachlauf nach dem Commit; ein Fehler im Nachlauf wird geloggt und ändert das Ergebnis nicht; bestehende Schwärzungs-, Kategorie- und Antrags-Tests grün
- [x] 2.4 Purge-Tick: globaler Nachlauf nach Phase B und vor Phase D, gelöschte Anhänge lösen den Rückschrieb aus; Test „Abbruch nach der atomaren Schwärzung“ (atomar geschwärzt, Anhänge mit Klartext stehen, Tick läuft → Klartext weder in Datei noch WAL) grün
- [x] 2.5 `skelett_loeschung::faellige` übergeht Einsätze mit verbliebenen Anhängen; Test „Endgültige Löschung wartet auf den Nachlauf“ grün
- [x] 2.6 Kommentare nachziehen: Registry-Eintrag `anhang` und die Linker-Einträge (CASCADE-Hinweise), Doku von `schwaerze_einsatz`, Modulkopf `purge_scheduler.rs` (Phasenliste), `db/physisch.rs` (Herleitung); `rg "CASCADE räumt" src/einsatz/schwaerzung_registry.rs` zeigt keinen veralteten Hinweis

## 3. Messung

- [x] 3.1 `secure_delete_messung` um den Modus `ON-einzeln` erweitern (atomarer Scrub ohne Anhänge, dann ein `DELETE` je Anhang; Ausgabe längste Tx und Summe); Lauf im Container mit `LFH725_MB=50,200,500`, Werte in `design.md` „Messung“
- [x] 3.2 Messung auf dem Pi mit SD-Karte und mit SSD (Ruben) mit demselben Befehl; Werte in `design.md` „Messung“, Einordnung gegen `busy_timeout` — entfällt, es gibt keinen Pi und die Zielhardware steht noch nicht fest (Ruben, 05.10.2026); `design.md` „Messung“ begründet die Grenze hardwareunabhängig, die Messung auf dem künftigen Rechner ist eine eigene Aufgabe

## 4. Integration

- [x] 4.1 `cargo test --lib` (Schwärzung, Kategorie, Antrag, Purge, Registry, Anhang) und `./scripts/check-all.sh` grün (Cloud-Sitzung: Bündel `rust` mit 4268 Tests und `schnell` grün; Schritt 4 nur wegen der Desktop-Hülle ohne GTK rot, auf `alpha` ebenso; Frontend und e2e ohne Änderung, voller Lauf in der CI)
- [x] 4.2 `openspec validate lfh-905-schwaerzung-schreibsperre-begrenzen --strict` grün
