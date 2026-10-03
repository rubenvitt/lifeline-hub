# Tasks

1.1, 2.2 und 2.3 sind parallel über PR #374 auf `alpha` gelandet (`d33e1f8e`, `e6c2e638`); beim
Merge wurde deren Umsetzung übernommen und gegen die Testdaten aus 2.1 erneut geprüft.

## 1. Migrationsnummer

- [x] 1.1 `0140_einsatz_person_anhang.sql` → `0142_einsatz_person_anhang.sql` (Inhalt unverändert),
  Verweise im LFH-757-Archiv nachgezogen. Prüfen: `db::tests::migrationsnummern_sind_eindeutig` grün.

## 2. Personen-Scrub (D1, D2)

- [x] 2.1 Testdaten: Anhänge an Ziel (einer entfernt), Nachbarin und Person im anderen Einsatz;
  Dateinamen als Ziel- bzw. Nachbar-Klartexte. Prüfen: `scrub_je_art_trifft_nur_die_zielperson`
  rot vor 2.2.
- [x] 2.2 `PERSONENANHAENGE` und das DELETE in `scrubbe_person`. Prüfen:
  `scrub_betroffene_loescht_ihre_anhaenge_samt_datei` und die bestehenden Scrub-Tests grün;
  Mutationsprobe (DELETE abgeschaltet) → zwei Tests rot.
- [x] 2.3 GUARD 1 kennt beide Listen, GUARD 4 neu, Selbsttest
  `guard_anhaenge_erkennt_fehlenden_toten_und_falschen_eintrag`. Prüfen: `cargo test --lib
  schwaerzung_person` grün.

## 3. Rückfrage (Frontend)

- [x] 3.1 `personenUmfang(art)` im Dialog; bei Betroffenen „sowie ihre Fotos und Dateien“.
  Prüfen: Vitest `Loeschersuchen.test.tsx`.
