# Tasks

Jede Aufgabe entsteht per TDD (`superpowers:test-driven-development`): erst der rote Test, dann der
Code. Die Übernahme wird über zwei echte Instanzen geprüft, in `tests/instanz_stammdaten_kataloge.rs`
(Helfer `tests/instanz_hilfen/mod.rs`).

## 1. Beschreibung erweitern (D2, D3, D4)

- [x] 1.1 `natuerlich` wird `&'static [&'static str]`, die zwölf bestehenden Einträge ziehen mit; Abgleich in `uebernehmen::upsert` über alle Spalten. Nachweis: bestehende Tests grün, neuer Test „Abgleich über zwei Spalten trifft nur die passende Zeile“.
- [x] 1.2 Feld `bereich` in `ArtBeschreibung`, angewandt in `liefern::load_daten` und im Abgleich. Nachweis: Test „Zeile außerhalb des Bereichs wird als Löschung geliefert und nie abgeglichen“.
- [x] 1.3 Feld `exklusiv` in `ArtBeschreibung`, angewandt in `upsert` vor dem Schreiben. Nachweis: Test „gelieferte Vorgabe nimmt der lokalen die Markierung“ (Schichtmodell).

## 2. Nachgeholte Löschung (D5)

- [x] 2.1 `delete_zeile` sammelt eine am Fremdschlüssel gescheiterte Löschung im ersten Durchgang und versucht sie nach Upserts und Verweisen in umgekehrter Rangfolge erneut; erst dann stilllegen bzw. Herkunft lösen. Nachweis: Test „Schichtmodell und Vorlage im selben Paket: Modell gelöscht, Vorlage ohne Modell“ und Test „lokale Vorlage zeigt drauf: Modell bleibt, gehört der Instanz“.

## 3. Acht Arten (D1)

- [x] 3.1 `StammdatenArt` um acht Wire-Werte, `art::BESCHREIBUNGEN` um acht Einträge (Rang laut D1), `uebernehmen::art_name` und `zeilen_name` (`text`). Nachweis: Guards in `art::tests` (Rang, Spalten) grün.
- [x] 3.2 Migration (nächste freie Nummer über `alpha`, `scripts/check-migrationen.sh`): Log- und Schutz-Trigger für die acht Tabellen und `einsatz_vorlage_modul_aus` (`_schutz_i`), Sprechgruppen mit `WHEN … einsatz_id IS NULL`, Grundstock ins Änderungslog. Nachweis: `art::tests::trigger_und_spalten_passen_zur_beschreibung`, Test „einsatz-lokale Sprechgruppe erhöht keinen Stand“.
- [x] 3.3 Typen neu erzeugen (`scripts/check-typ-codegen.sh`), beide generierten Dateien im Commit. Nachweis: Skript grün.
- [x] 3.4 Ende-zu-Ende in `tests/instanz_stammdaten_kataloge.rs`: Einsatz-Vorlage mit Schichtmodell und ausgeblendeten Modulen samt Stichwort kommt an; je eine Zeile jeder neuen Art ist am ELW gesperrt (409); Unterkunft-Richtwert vom Hub gesperrt, eigener Richtwert eines anderen Schlüssels setzbar; Sprechgruppen-Abgleich TMO/DMO. Nachweis: Tests grün.

## 4. Oberfläche (D6)

- [x] 4.1 Abzeichen „vom Hub“/„nur hier“ und Sperre in `SchichtmodelleTab`, `EinsatzVorlagenTab`, `StichworteTab` (auch Vorlagen-Auswahl), `VerpflegungsplanTab`, `SprechgruppenTab`, `EtbBausteineTab`, `ExterneStellenTab`. Nachweis: je Reiter ein Vitest mit überschriebenem Herkunfts-Handler (Muster `FahrzeugeTab.test.tsx`).
- [x] 4.2 `UnterkunftRichtwerteTab`/`RichtwerteListe`: Abzeichen und Sperre je Schlüssel. Nachweis: Vitest „gesetzter Schlüssel vom Hub gesperrt, anderer setzbar“.

## 5. Doku und Abschluss

- [x] 5.1 `docs/anwender/kapitel/instanzkopplung.md` (Arten, Sprechgruppen nur Katalog, Vorgabe folgt dem Hub) und `src/AGENTS.md` „Instanzkopplung“ (Felder `bereich`, `exklusiv`). Nachweis: Doku-Wächter in `check-all.sh` grün.
- [x] 5.2 `./scripts/check-all.sh` grün (lokal: Bündel `schnell` grün, betroffene Rust- und Vitest-Suiten grün; das volle Rust-Bündel scheiterte lokal am Plattenplatz der Sitzung und läuft in der CI des PRs).

## Workflow follow-up

- `/opsx:archive kjezbk06-stammdaten-kataloge` im selben Branch vor dem PR.
- Bilder der Änderung (Reiter mit „vom Hub“ und Sperre) in PR und Meldung.
