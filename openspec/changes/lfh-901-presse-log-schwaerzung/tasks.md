# Tasks

Jede Aufgabe per TDD: erst der rote Test, dann die Registry-Änderung.

## 1. Einsatz-Schwärzung des Presse-Logs (D1, D2, D4)

- [x] 1.1 `schwaerzung_presse_und_infotelefon_leert_personenbezug_und_haelt_nachweis` in
  `src/einsatz/purge_scheduler.rs` umkehren und umbenennen: Thema mit Betroffenen-Freitext
  („Anfrage zu Fam. Yilmaz“), Freigabeangabe mit Namen; nach der Schwärzung tragen `medium`,
  `thema`, `antwort` den Platzhalter, `freigabe_durch` ist NULL, `art`, `status`, `eingang_at`
  bleiben. Zweiter, offener Medienkontakt ohne Antwort: `antwort` bleibt NULL, die Schwärzung
  läuft durch. Doc-Kommentar des Tests nachziehen. Verifikation: Test rot gegen den heutigen
  Stand.
- [x] 1.2 Registry `medienkontakt` nach D2 umklassifizieren (`Z_EINSATZ`), `G_PRESSE_LOG`
  entfernen, Abschnittskommentar auf Linie A und LFH-901 (D4). Verifikation: 1.1 grün,
  `cargo test --lib schwaerzung_registry` grün, `grep -n G_PRESSE_LOG src` leer.
- [x] 1.3 Modulkopf `src/presse/repo.rs` nach D4 umformulieren. Verifikation: Kommentar nennt das
  ETB als Ort des Nachweises; `cargo build` ohne Warnung.

## 2. Personen-Vollzug (D3)

- [x] 2.1 Testdaten `src/einsatz/schwaerzung_person_testdaten.rs`: `medien1` mit eindeutigem
  Medium, Thema, Antwort und Freigabeangabe, die in die Ziel-Klartexte gehen; das Thema von
  `medien2` in die Nachbar-Klartexte. Verifikation: `scrub_je_art_trifft_nur_die_zielperson`
  rot (Guard-Tests rot, solange die Markierung fehlt).
- [x] 2.2 `PERSONENBEZUEGE`, Eintrag `medienkontakt`: `medium`, `thema`, `antwort`,
  `freigabe_durch` als `Mit`. Selbsttest
  `guard_markierungen_erkennt_luecke_retain_und_ohne_an_der_wurzel` auf die neue Spaltenliste
  angleichen. Verifikation: `cargo test --lib schwaerzung_person` grün.

## 3. Audit (D5)

- [x] 3.1 Audit-Test in `src/einsatz/repo.rs` auf „… und des Presse-Logs“ erweitern (rot), dann
  `schwaerzungs_audit` anpassen. Verifikation: `cargo test --lib einsatz::repo` grün.

## 4. Abschluss

- [x] 4.1 `cargo fmt --check` und ganze Backend-Suite (`cargo test --no-fail-fast`) grün;
  `./scripts/check-all.sh --nur schnell` lokal; Vitest und e2e berührt die Änderung nicht
  (Prettier auf `frontend/src/stab/AGENTS.md` grün), das Gesamtgate belegt die CI des PRs.
  Lokal am 05.10.2026: 4216 Tests grün, 0 rot. Verifikation: Ausgabe der Läufe.
- [x] 4.2 `openspec validate lfh-901-presse-log-schwaerzung --strict` gültig, dann
  `/opsx:archive` im selben Branch. Verifikation: `scripts/check-openspec-archiv.sh` grün.
