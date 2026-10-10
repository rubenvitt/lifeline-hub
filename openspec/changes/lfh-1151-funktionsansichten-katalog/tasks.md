# Tasks

## 1. Belege gegenlesen

- [ ] 1.1 Katalog, Bindung und 400-Fälle gegen `Funktionsansicht` (`src/geraet/mod.rs`) und
  `anlegen` (`src/routes/geraet.rs`) lesen; Nachweis: `anlegen_prueft_eingaben`,
  `uebersicht_bietet_alle_ansichten`, `verpflegungsgeraet_ist_an_keine_stelle_gebunden`,
  `uhs_eines_anderen_einsatzes_ist_404` in `tests/geraet_kopplung.rs` grün
- [ ] 1.2 Matrix-Zeilen Laptop-Kräfte und Lagemonitor gegen die Routenlisten lesen; Nachweis:
  `laptop_pflegt_die_kraefte_nur_der_eigenen_uhs`, Unit-Tests der Lagemonitor-Liste in
  `src/geraet/mod.rs` grün; der Lagemonitor-403 auf `/zonen` und `/abschnitte` folgt aus der
  Routenliste (`darf_route`), ein fehlender HTTP-Test wird als Szenario-Nachweis ergänzt
- [ ] 1.3 Ansicht Betreuungsstelle gegen Code lesen; Nachweis:
  `betreuungsstelle_kennt_nur_die_eigene_stelle`,
  `aufnahme_an_der_betreuungsstelle_bringt_in_die_eigene_stelle`,
  `betreuungsstelle_bringt_in_keine_fremde_notunterkunft`,
  `widerrufene_betreuungsstelle_verliert_jeden_zugriff` grün
- [ ] 1.4 Ansicht Einsatzabschnitt gegen Code lesen; Nachweis:
  `abschnittsgeraet_sieht_nur_seinen_teilbaum`,
  `abschnittsgeraet_quittiert_und_meldet_nur_eigene_auftraege`,
  `abschnittsgeraet_meldet_mit_eigenem_absender`,
  `abschnittsgeraet_sieht_gefahrenzonen_aber_keine_bezirke`,
  `aufgeloester_abschnitt_beendet_seine_kopplung`,
  `widerrufenes_abschnittsgeraet_verliert_jeden_zugriff` grün
- [ ] 1.5 Veralteten Doc-Kommentar an `aufgeloester_abschnitt_beendet_seine_kopplung`
  („noch nicht koppelbar“) berichtigen; Nachweis: `cargo test --test geraet_kopplung` grün

## 2. Abschluss

- [ ] 2.1 `openspec validate lfh-1151-funktionsansichten-katalog` ohne Fehler
- [ ] 2.2 Lücken, die beim Gegenlesen auffallen (Code weicht von einer Erwartung ab), als
  ClickUp-Task anlegen statt die Spec zu verbiegen; Nachweis: Task-Links im PR

## Workflow follow-up

- `/opsx:archive lfh-1151-funktionsansichten-katalog` im selben Branch, vor dem PR
