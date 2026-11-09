---
id: ADR-0014
titel: Lifeline Hub hat kein Stab-Modul, Führungsfunktionen kommen aus der Mitgliedschaft
status: akzeptiert
datum: 2026-11-08
gilt_fuer:
  - src/lib.rs
  - src/einsatz/modul.rs
  - src/fuehrung/**
  - src/infotelefon/**
  - src/fernmeldewesen/**
  - frontend/src/einsatz/modulRegistry.ts
  - frontend/src/fuehrung/**
  - frontend/src/infotelefon/**
  - frontend/src/fernmeldewesen/**
herleitung:
  - openspec/changes/archive/2026-11-08-i6k6mzed-stab-herausnehmen/design.md
---

# ADR-0014: Lifeline Hub hat kein Stab-Modul, Führungsfunktionen kommen aus der Mitgliedschaft

## Regeln

- MUST NOT: kein Modul-Key `stab` in `MODUL_KEYS` (`src/einsatz/modul.rs`) und kein
  Registry-Eintrag `stab` in `frontend/src/einsatz/modulRegistry.ts`.
- MUST NOT: keine Bausteine `src/stab/`, `src/presse/`, `frontend/src/stab/`,
  `frontend/src/presse/`; Presse und Medienarbeit (S5) führt die App nicht.
- MUST: Wer EL oder ein Sachgebiet S1 bis S7 führt, steht in der Mitgliedschaft des Einsatzes
  (`einsatz_mitgliedschaft.fuehrungsfunktion`, Auflösung in `src/fuehrung/`); eine zweite
  Besetzungstabelle gibt es nicht. Regeln: `frontend/src/fuehrung/AGENTS.md`.
- MUST: Ein Werkzeug eines Sachgebiets ist ein eigenes Modul mit eigener Freigabe
  (Fernmeldewesen, Informationstelefon, Lagebesprechung, Verpflegung), keine Unterseite einer
  Sammelseite.
- SHOULD: Wer den Stab zurückholen will, löst diese ADR mit einer neuen Change und einer neuen
  ADR (`ersetzt: ADR-0014`) ab.

## Prüfung

```sh
test ! -e src/stab
test ! -e src/presse
test ! -e frontend/src/stab
test ! -e frontend/src/presse
verbiete '^pub mod (stab|presse);' src/lib.rs
verlange '^pub const MODUL_KEYS' src/einsatz/modul.rs
test -z "$(awk '/^pub const MODUL_KEYS/,/^\];/' src/einsatz/modul.rs | grep '"stab"' || true)"
verbiete "key: 'stab'" frontend/src/einsatz/modulRegistry.ts
# Die Migrationstests in src/db.rs belegen das Löschen und nennen die Tabellen deshalb.
verbiete 'einsatz_stabsfunktion|einsatz_stab_checkliste' 'src/**/*.rs' ':(exclude)src/db.rs'
verlange 'einsatz_mitgliedschaft' 'src/fuehrung/**/*.rs'
```

## Kontext

Das Modul „Stab“ bündelte die Besetzung S1 bis S6, eine Checkliste Arbeitsaufnahme, Presse-Log
und Pressemitteilungen (S5) und das Informationstelefon. Lifeline Hub ist (noch) nicht für die
Stabsarbeit gedacht: Für diese Teile gibt es keinen Feldbeleg auf Führungsstufe B/C, die
genutzten Werkzeuge waren schon eigene Module (Entscheidung Ruben 08.11.2026 bei der Auswertung
von LLH-722). Die Besetzung stand zudem doppelt neben der Führungsfunktion der Mitglieder.

## Konsequenzen

Stab und Presse sind samt Tabellen gelöscht (Migration `0301_stab_presse_entfernen`), das
Informationstelefon ist das Modul `infotelefon` (Migration `0300_infotelefon_modul`).
„Wer ist S2?“ hat eine Quelle, gepflegt im Reiter „Zugriff“ der Einstellungen; S1 bis S7 ohne
Benutzerkonto sind nicht mehr abbildbar. Alte Adressen unter `…/stab` leiten weiter, die
Medienlage im Lagebericht ist Freitext.
