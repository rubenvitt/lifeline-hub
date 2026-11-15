# Tasks

## 1. Grenzen der Nummer

- [x] 1.1 In `src/einsatz/nummer.rs` Konstanten für Jahr (2000–9999) und laufende Nummer (1–999.999) und eine reine Prüffunktion für ein geliefertes Paar (`Value`, `Value`) anlegen; Unit-Tests für gültig, Grenzwerte, außerhalb, nur eine Zahl, keine Zahl, keine ganze Zahl — rot vor, grün nach der Funktion

## 2. Kopf-Übernahme prüft die Zahlen

- [x] 2.1 `kopf_uebernehmen` in `src/instanz/spiegel/uebernehmen.rs` leert bei ungültigem Paar `nummer_jahr` und `nummer_lfd` (Anlage und Aktualisierung) und gibt einen Hinweis in `Ergebnis::hinweise`; Test mit einer Lieferung `nummer_lfd = i64::MAX`: Spiegel ohne Zahlen, Text erhalten, Hinweis am Spiegel, übrige Zeilen übernommen; Test gültiges Paar ohne Hinweis
- [x] 2.2 Test: Spiegel mit geleerten Zahlen wird per Führungswechsel eigen, danach vergibt die Anlage die nächste Nummer ohne ihn (Spec-Szenario „Der Spiegel wird später eigen“)

## 3. Vergabe ohne Überlauf

- [x] 3.1 `anlegen_tx` in `src/einsatz/repo.rs`: `checked_add` für `max + 1` und die Ausweichschleife, sonst `AppError::UnprocessableEntity`; Test mit eigenem Einsatz `nummer_lfd = i64::MAX` → 422, kein neuer Einsatz (rot vorher: Panik im Debug-Bau)
- [x] 3.2 `ensure_freie_nummer` in `src/instanz/spiegel/nummer.rs`: dasselbe; Test mit fremdem Spiegel `nummer_lfd = i64::MAX` und belegter Nummer → Übergang scheitert mit 422, keine negative Nummer

## 4. Befunde aus dem Review

- [x] 4.1 Hinweis zur Einsatznummer haftet bis zur nächsten Übernahme des Kopfs (`abgleich::build_hinweis`); Test `der_hinweis_zur_einsatznummer_bleibt_bis_der_kopf_kommt`, rot ohne die Haftung
- [x] 4.2 Freie Nummer zählt nur eigene, wenn ein Spiegel die Zählung an die Grenze hebt (D5); Test `ein_fremder_spiegel_an_der_grenze_hebt_die_freie_nummer_nicht`, rot ohne den Rückfall
- [x] 4.3 Ausweichschleifen beider Vergaben am Höchstwert getestet (`ausweichen_ueber_den_hoechstwert_ist_422`, `ueber_dem_hoechstwert_scheitert_der_uebergang_mit_422`), rot mit `+= 1`
- [x] 4.5 Eine freie Spiegelnummer an der Grenze wird beim Eigenwerden neu vergeben (zweiter Review); Test `eine_freie_nummer_an_der_grenze_wird_neu_vergeben`, rot vorher
- [x] 4.4 ADR-0052 „Eine gekoppelte Instanz ist für die Zahlen ihres Einsatzkopfs nicht vertrauenswürdig“ und ein Satz im Anwenderkapitel Instanzkopplung; `scripts/check-architektur.sh` und `scripts/check-adr-nummern.sh origin/alpha` grün

## 5. Abschluss

- [x] 5.1 Verifiziert am 15.11.2026: `check-all.sh --nur schnell` und `--nur frontend` grün, `cargo test --lib` (4429 grün) und die Integrationstests der Kopplung, des Spiegels und der Einsatzanlage (324 grün); der volle `--geaendert`-Lauf passte nicht ins Plattenkontingent der Cloud-Sitzung, die Suiten laufen auf alpha

## Workflow follow-up

- Review vor dem PR (`dev-zunder-ausfuehren`, „Review vor dem PR“).
- `/opsx:archive bqz5qimz-spiegel-nummer-grenze` im selben Branch vor dem PR.
