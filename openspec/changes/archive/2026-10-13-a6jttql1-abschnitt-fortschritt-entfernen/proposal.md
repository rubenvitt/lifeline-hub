# Proposal

## Why

Seit LFH-1208 hat der Fortschritt eines Einsatzabschnitts keine Oberfläche mehr: Detail, Vorschau,
Funktionsansicht und Führungsüberblick zeigen ihn nicht, das Frontend schreibt ihn nicht. Spalte,
DTO und Schreibweg blieben damals bewusst für Altdaten stehen, das Entfernen war als eigenes
Aufräumen vorgesehen (LFH-1208, D7). Ein Wert, den niemand sieht und niemand pflegt, ist eine
Verbindlichkeit: Er wandert durch Demo-Daten, Schwärzungsregister, Lage-Rückblicke und Typen und
täuscht eine Fähigkeit vor, die es nicht mehr gibt.

Zunder: https://zunder.rubeen.dev/#/aufgabe/a6jttql1gp823x9via7jalef (LLH-1170)

## What Changes

- **BREAKING (Datenbank):** Neue Migration entfernt die Spalte `einsatzabschnitt.fortschritt`
  (angelegt in `0109_einsatzabschnitt_lage.sql`). Gespeicherte Altwerte gehen dabei verloren.
- **BREAKING (API):** `EinsatzabschnittAnzeige` verliert das Feld `fortschritt`. POST und PATCH
  auf `/api/einsaetze/{id}/abschnitte` kennen das Feld nicht mehr; ein Client, der es noch
  schickt, wird nicht abgewiesen, der Wert wird verworfen. Die Prüfung `pruefe_fortschritt`
  (400 außerhalb 0–100) entfällt.
- Typ-Codegen (`openapi.json`, `types.generated.ts`) und `AbschnittEingabe` im Frontend ohne
  `fortschritt`.
- Demo-Szenario ohne Fortschrittswerte, Schwärzungsregister ohne die Spalte.
- Tests, Test-Fixtures und veraltete Kommentare, die den Abschnittsfortschritt noch nennen,
  werden bereinigt; die Anwenderdoku (Funktionsansicht Einsatzabschnitt, Überblick) nennt ihn
  nicht mehr.
- Eingefrorene Lage-Rückblicke bleiben unangetastet (s. `design.md`).

## Capabilities

### New Capabilities

<!-- keine -->

### Modified Capabilities

- `einsatzabschnitt-bearbeitung`: Das Requirement „Fortschritt erscheint nicht“ verlangt heute,
  dass ein gespeicherter Wert erhalten bleibt. Es wird ersetzt: Ein Abschnitt trägt keinen
  Fortschritt mehr, weder gespeichert noch im Austausch mit dem Server.

## Impact

- **Backend:** `migrations/` (neue Nummer nach 0185), `src/einsatzabschnitt/{mod.rs,repo.rs}`,
  `src/routes/einsatzabschnitt.rs`, `src/demo/{szenario.rs,import.rs,import_tests.rs}`,
  `src/einsatz/schwaerzung_registry.rs`, `tests/einsatzabschnitt_lage.rs`.
- **Frontend:** `api/openapi.json`, `api/types.generated.ts`, `api/einsatzabschnitte.ts`,
  Test-Fixtures in `pages/EinsatzabschnittePage.test.tsx`,
  `pages/einsatzabschnitte/{AbschnittDetail,AbschnittVorschau}.test.tsx`,
  `pages/fuehrung/{UeberblickPage.test.tsx,ueberblickDaten.test.ts}`, Kommentare in
  `pages/fuehrung/UeberblickPage.tsx`.
- **Doku:** `docs/anwender/kapitel/geraet-einsatzabschnitt.md`, `docs/anwender/kapitel/ueberblick.md`.
- **Nicht betroffen:** Export, Einsatzbericht und Druck lesen den Wert nicht (geprüft).
  Upload- und Download-Fortschritt (Karten, Dokumente, Anhänge) sind andere Dinge und bleiben.
