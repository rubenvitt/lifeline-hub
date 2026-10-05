# Tasks

## 1. Gemeinsamer Nachlauf für Anhänge und Bilder (design.md D4)

- [ ] 1.1 Bedingung „zur Entfernung vorgesehen“ aus `src/anhang/repo.rs` an eine gemeinsame Stelle im Modul `einsatz` verlegen, mit Liste `EINZELN_GELOESCHT = ["anhang", "karte_hintergrundbild"]`; `anhang::repo` nutzt sie unverändert weiter. Prüfen: bestehende Tests in `anhang` und `purge_scheduler` (`verwaisten_sweep_uebergeht_vorgesehene_anhaenge`) bleiben grün.
- [ ] 1.2 `entferne_vorgesehene` zum gemeinsamen Nachlauf über beide Tabellen machen (je Zeile eine Transaktion, Wächter im `DELETE`) und alle Aufrufer umstellen (Einsatz-Schwärzung, Kategorie-Schwärzung, Purge-Tick, Tests). Prüfen: neuer roter Test zuerst, dass ein vorgesehenes Bild im Nachlauf fällt und das Bild eines nicht geschwärzten Einsatzes bleibt.
- [ ] 1.3 Phase D der Skelett-Löschung (`skelett_loeschung::faellige`) wartet auch auf Bilder der Lagekarte. Prüfen: Test analog `phase_d_wartet_auf_den_nachlauf` mit einem Bild statt eines Anhangs.

## 2. Klassifikation in der Registry (design.md D1–D3)

- [ ] 2.1 Regel `karte_hintergrundbild`: jede Spalte Scrub mit `ZeileEinzelnLoeschen` und `Z_ANHAENGE`, Kommentar mit Begründung und Verweis auf diese Change. Prüfen: der Assert „Bild-BLOB (Kartografie) bleibt erhalten“ in `phase_b_schwaerzt_alle_pii_inkl_stornierte_und_haelt_skelett` wird zuerst rot und dann umgekehrt (Bild nach Nachlauf weg).
- [ ] 2.2 Guard `ZeileEinzelnLoeschen` in `scrubbe_aus_registry` und in den Registry-Tests auf `EINZELN_GELOESCHT` umstellen; für `karte_hintergrundbild` gibt es keine Verknüpfungen zu lösen. Prüfen: Guard-Tests grün, `kategorie_zuordnung_ist_gepinnt` führt die Spalten unter `anhaenge`.
- [ ] 2.3 Test, der die Klassifikation festschreibt (Spec `aufbewahrung`, Szenario „Klassifikation ist festgeschrieben“): jede Spalte der Tabelle ist Scrub, `ZeileEinzelnLoeschen`, `anhaenge`. Prüfen: Test rot vor 2.1, grün danach.
- [ ] 2.4 Person-Schwärzung (`schwaerzung_person`) unberührt lassen und belegen: `person_bezug` der Tabelle bleibt `None`. Prüfen: `schwaerzung_person_tests` grün.

## 3. Lesewege (design.md D5)

- [ ] 3.1 `liste`, `laden`, `meta_fuer_download`, `laden_bytes` in `src/karte_hintergrundbild/repo.rs` übergehen vorgesehene Bilder. Prüfen: Test „zwischen Schwärzung und Nachlauf“: Liste leer, Download-Route 404.
- [ ] 3.2 Lagekarte im Frontend verkraftet ein fehlendes Bild eines Lage-Stands (404 beim Download) ohne Fehlerbanner. Prüfen: vorhandenes Verhalten mit einem Vitest in `frontend/src/pages/lagekarte/` belegen; nur wenn er rot wird, beheben.

## 4. Kategorie-Schwärzung und physische Entfernung

- [ ] 4.1 Kategorie `anhaenge` schwärzen entfernt auch die Bilder, andere Objekte der Lagekarte bleiben. Prüfen: Test im Stil der bestehenden `anhaenge`-Tests in `purge_scheduler.rs`.
- [ ] 4.2 Gepflanzter Klartext in einem Bild der Lagekarte ist nach Schwärzung und Nachlauf weder in der Datenbankdatei noch im WAL. Prüfen: `faelliger_einsatz_mit_klartext` um ein Bild erweitern, `enthaelt_klartext` bleibt falsch.
- [ ] 4.3 Atomarer Vorgang schreibt bei 4 Bildern zu je 5 MB weniger als 1 MB ins WAL. Prüfen: Test analog zu dem für Anhänge aus LFH-905.
- [ ] 4.4 Bestand (design.md D6): ein schon früher geschwärzter Einsatz mit gespeichertem Bild verliert es im nächsten Purge-Lauf, ohne neuen ETB-Eintrag. Prüfen: Test, der das Bild per SQL an einen geschwärzten Einsatz hängt und einen Tick laufen lässt.

## 5. Texte und Dokumentation

- [ ] 5.1 `KATEGORIE_TEXT.anhaenge.daten` in `frontend/src/aufbewahrung/kategorieText.ts` nennt die Bilder der Lagekarte. Prüfen: `KategorieFristen.test.tsx` bzw. ein Text-Test in den Org-Einstellungen findet „Bilder der Lagekarte“.
- [ ] 5.2 Doc-Kommentare nachziehen: `Strategie::ZeileEinzelnLoeschen` („nur `anhang`“) und der Kopf des Nachlaufs. Verweise auf den alten Namen per `rg entferne_vorgesehene` prüfen.
- [ ] 5.3 `src/AGENTS.md`, Abschnitt Aufbewahrung, prüfen und nur ändern, wenn er die Bilder als Retain nennt. Prüfen: `rg -n "hintergrund" src/AGENTS.md`.

## 6. Abschluss

- [ ] 6.1 `./scripts/check-all.sh` grün (bzw. umgebungsbedingte Schritte gegen `alpha` gegengeprüft), Vitest und `cargo test` grün.
- [ ] 6.2 Change archivieren (`/opsx:archive`) samt Spec-Sync, im selben Branch vor dem PR.
