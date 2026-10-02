# Tasks

Jede Aufgabe entsteht per TDD: zuerst schlägt der angepasste Test rot fehl, dann wird der Code
geändert, danach ist der Test grün.

## 1. Schaden ohne Ort und Adressat (D1)

- [x] 1.1 Der Test in `tests/einsatz_schaden.rs` zum Anlage-Eintrag (bisher „ETB nennt den Ort“) prüft neu: Der Eintrag lautet „Schaden S-… angelegt: {typ} ({ausmass})“ und enthält den Ort nicht. Danach `routes/einsatz_schaden.rs::anlegen` umstellen, `ort_kurz` samt Unit-Test in `src/schaden/mod.rs` entfernen. Verifiziert durch `cargo test --test einsatz_schaden`.
- [x] 1.2 Der Übergabe-Test in `tests/einsatz_schaden.rs` (bisher „übergeben an Bauhof“) erwartet „Schaden S-… übergeben“ ohne den Adressaten, der Adressat steht aber weiter in der Antwort der Schadenzeile. Danach `::uebergeben` umstellen. Verifiziert durch `cargo test --test einsatz_schaden`.

## 2. Verbleib und UHS-Austritt ohne Ziel und Notiz (D1)

- [x] 2.1 Unit-Tests von `VerbleibArt::etb_sachverhalt` (`src/person/mod.rs`) auf die Signatur ohne `ziel` umstellen. `tests/einsatz_person.rs` (Transport „KH Mitte“, Notunterkunft „Turnhalle Ost“) erwartet „abtransportiert“ bzw. „in Notunterkunft“ ohne Ziel und das Ziel weiter in Verbleib und Personenzeile. Danach Helfer und `routes/einsatz_person.rs::verbleib` umstellen. Verifiziert durch `cargo test --lib person` und `cargo test --test einsatz_person`.
- [x] 2.2 Neuer Test in `tests/einsatz_uhs.rs`: Ein manueller Austritt mit Notiz schreibt „Person R-…: verlässt {UHS}“ ohne Notiz, die Notiz steht weiter an der Belegung. Danach den Austritt-Zweig in `formatiere_belegungs_etb` umstellen. Die Tests des automatischen Austritts mit festem Anlass bleiben unverändert grün. Verifiziert durch `cargo test --test einsatz_uhs`.

## 3. Dokumente ohne Titel (D2)

- [x] 3.1 `tests/dokument.rs` anpassen:
  - Ablage erwartet „Dokument abgelegt (Lagekarte/Plan)“ ohne Titel.
  - Entfernen erwartet „Dokument entfernt: Ablage ETB {n} ({kategorie})“.
  - Titeländerung erwartet „Dokument geändert: Ablage ETB {n} (Befehl) — Titel geändert“, ohne alten und neuen Titel.
  - Neuer Fall zur Kategorieänderung erwartet „Kategorie: Sonstiges → …“.

  Danach `ablegen`, `aendern` und `entfernen` in `src/dokument/repo.rs` umstellen; die laufende Nummer kommt über `einsatz_dokument.etb_eintrag_id`. Verifiziert durch `cargo test --test dokument`.
- [x] 3.2 Den Kommentar der Registry an `einsatz_dokument` (`src/einsatz/schwaerzung_registry.rs`) und den Schwärzungstest in `src/einsatz/repo.rs` (`schwaerzung_loescht_dokument_samt_anhang_und_haelt_den_etb_nachweis`) auf den neuen Wortlaut ziehen: Der ETB-Nachweis bleibt, der Titel stand nie darin. Verifiziert durch `cargo test --lib einsatz::repo`.
- [x] 3.3 Prüfen, ob `frontend/e2e/dokumente.spec.ts` nur das Präfix „Dokument geändert:“ liest. Wenn ja, keine Änderung nötig. Verifiziert durch grep auf Titel-Literale in ETB-Assertions der e2e-Suite.

## 4. Ausnahmeliste und Ende-zu-Ende-Nachweis (D3, D4)

- [x] 4.1 `AUSNAHMEN_SYSTEM_ETB` in `tests/aufbewahrung_e2e.rs` umbauen:
  - 8 Einträge entfernen: Schaden ort und uebergeben_an, die drei Verbleib-Spalten, UHS-Notiz, Dokumenttitel bei ablegen und entfernen.
  - `dokument/repo.rs::aendern` · `einsatz_dokument.kategorie` ergänzen.
  - Feld `gruppe` einführen, das den Zweck trägt: Doc-Kommentar je Variante und Abschnittskommentar je Gruppe. Die Begründungen bleiben Fundstellen (design.md D3).

  Verifiziert durch die Zählung 56 und den Selbsttest.
- [x] 4.2 Selbsttest um die Sperrliste erweitern: keine Spalte aus `einsatz_schaden*`, `einsatz_person`, `person_*`, `einsatz_tier`, nicht `einsatz_dokument.titel`. Zuerst eine gesperrte Spalte probeweise eintragen und den roten Test sehen, dann die Probe wieder entfernen. Verifiziert durch `cargo test --test aufbewahrung_e2e ausnahmeliste`.
- [x] 4.3 Ende-zu-Ende-Ablauf umstellen:
  - `Birkenallee-9`, `Dachdecker-Ruehl` und `Klinikum-Nordstadt` wandern nach `GEHEIM`.
  - Eine Zone mit dem Label `Sperrzone-Lindenplatz` kommt dazu, als gepinnter Wert in `AUSNAHME_WERTE`, erwartet genau im Anlage-Eintrag der Zone.
  - Den Modulkopf auf die Entscheidung LFH-752 statt „entscheidet LFH-752“ ziehen.

  Verifiziert durch `cargo test --test aufbewahrung_e2e`.
- [x] 4.4 `src/AGENTS.md`, Abschnitt Aufbewahrung: Die Regel „Scrub-Werte in System-ETB-Texten“ nennt neu, dass Werte von Betroffenen und Dokumenttitel nie ins ETB gehören, dass die Liste nie länger wird und welche Gruppen es gibt. Verweis auf diese Change. Verifiziert durch Lesen und grep auf Verweise nach `AUSNAHMEN_SYSTEM_ETB`.

## 5. Integration

- [ ] 5.1 `cargo test` über alle Tests und `./scripts/check-all.sh` grün (Bündel laut Skriptkopf). Die übrigen Treffer der Durchsicht (`tests/aufbewahrung.rs`, `src/demo/import_tests.rs`, `tests/gefahr.rs`) bleiben unverändert grün. Verifiziert durch die Ausgabe des Laufs bzw. die CI des PRs.
