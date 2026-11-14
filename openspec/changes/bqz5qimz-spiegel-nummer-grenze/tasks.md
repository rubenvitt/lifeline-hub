# Tasks

## 1. Grenzen der Nummer

- [ ] 1.1 In `src/einsatz/nummer.rs` Konstanten für Jahr (2000–9999) und laufende Nummer (1–999.999) und eine reine Prüffunktion für ein geliefertes Paar (`Value`, `Value`) anlegen; Unit-Tests für gültig, Grenzwerte, außerhalb, nur eine Zahl, keine Zahl, keine ganze Zahl — rot vor, grün nach der Funktion

## 2. Kopf-Übernahme prüft die Zahlen

- [ ] 2.1 `kopf_uebernehmen` in `src/instanz/spiegel/uebernehmen.rs` leert bei ungültigem Paar `nummer_jahr` und `nummer_lfd` (Anlage und Aktualisierung) und gibt einen Hinweis in `Ergebnis::hinweise`; Test mit einer Lieferung `nummer_lfd = i64::MAX`: Spiegel ohne Zahlen, Text erhalten, Hinweis am Spiegel, übrige Zeilen übernommen; Test gültiges Paar ohne Hinweis
- [ ] 2.2 Test: Spiegel mit geleerten Zahlen wird per Führungswechsel eigen, danach vergibt die Anlage die nächste Nummer ohne ihn (Spec-Szenario „Der Spiegel wird später eigen“)

## 3. Vergabe ohne Überlauf

- [ ] 3.1 `anlegen_tx` in `src/einsatz/repo.rs`: `checked_add` für `max + 1` und die Ausweichschleife, sonst `AppError::UnprocessableEntity`; Test mit eigenem Einsatz `nummer_lfd = i64::MAX` → 422, kein neuer Einsatz (rot vorher: Panik im Debug-Bau)
- [ ] 3.2 `ensure_freie_nummer` in `src/instanz/spiegel/nummer.rs`: dasselbe; Test mit fremdem Spiegel `nummer_lfd = i64::MAX` und belegter Nummer → Übergang scheitert mit 422, keine negative Nummer

## 4. Abschluss

- [ ] 4.1 `cargo test` für die berührten Module und `./scripts/check-all.sh --geaendert` grün (bzw. Verweis auf den CI-Lauf des PRs)

## Workflow follow-up

- Review vor dem PR (`dev-zunder-ausfuehren`, „Review vor dem PR“).
- `/opsx:archive bqz5qimz-spiegel-nummer-grenze` im selben Branch vor dem PR.
