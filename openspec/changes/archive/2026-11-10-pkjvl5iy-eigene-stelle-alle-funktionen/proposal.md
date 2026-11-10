# Proposal

Zunder: https://zunder.rubeen.dev/#/aufgabe/pkjvl5iyff9evxb5f13vsfqd (LLH-1606)

## Why

Seit i6k6mzed (LLH-1602) folgt die Führungsfunktion eines Benutzers aus seiner Mitgliedschaft und
umfasst den ganzen Katalog. Die Sicht „meine Stelle“ im Paneel „Offene Vorgänge“ kennt aber nur
S1–S6: Sie liest `meine_sachgebiete`, und dort fehlen S7, Fachberater und Führungshilfspersonal.
Wer eine dieser Funktionen trägt, sieht unter „meine Stelle“ keinen Auftrag, keine Meldung und keine
Erinnerung an seine Funktion.

## What Changes

- Der Einsatzkopf (`EinsatzAnzeige`, Detail und Liste) trägt zusätzlich den **Katalogcode der
  eigenen Funktion** (`meine_funktion_code`) und, bei Fachberater und Führungshilfspersonal, deren
  **Bezeichnung** (`meine_funktion_bezeichnung`). Beide
  folgen aus derselben Ableitung wie `meine_funktion`: Führungsfunktion der Mitgliedschaft, ohne sie
  mit Rolle Einsatzleitung „el“. Der Lage-Snapshot trägt beide nicht.
- „meine Stelle“ liest diesen Code statt `meine_sachgebiete`. Damit zählen S7, Fachberater und
  Führungshilfspersonal als eigene Funktion.
- Bei Fachberater und Führungshilfspersonal gilt ein Vorgang nur dann als eigener, wenn auch die
  Bezeichnung passt (ohne Groß-/Kleinschreibung, Leerraum am Rand ignoriert). Fehlt einer Seite die
  Bezeichnung, genügt der Code.
- `meine_sachgebiete` bleibt unverändert auf dem Wire (keine **BREAKING**-Änderung).
- Die Anwenderdoku zum Überblick beschreibt „meine Stelle“ mit dem ganzen Katalog.

## Capabilities

### New Capabilities

Keine.

### Modified Capabilities

- `ueberblick-offene-vorgaenge`: Requirement „Sicht „alle“ und „meine Stelle““. Eigene Funktion
  ist die Funktion aus der Mitgliedschaft (ganzer Katalog), nicht mehr nur das besetzte Sachgebiet;
  bei Fachberater und Führungshilfspersonal zählt die Bezeichnung mit.
- `einsatzkopf-live`: Requirement „Funktionsfelder folgen der Mitgliedschaft“. Die neuen Felder
  (Code und Bezeichnung der eigenen Funktion) folgen wie die übrigen der Mitgliedschaft.

## Impact

- Backend: `src/einsatz/mod.rs` (`EinsatzAnzeige`, `MeineFelder::ableiten`),
  `src/einsatz/funktion.rs` (`Funktion` trägt den Code), `src/einsatz/repo.rs` (Listenpfad baut
  über `MeineFelder` mit), Tests in `tests/einsatz_funktion.rs`.
- Wire/Codegen: zwei neue optionale Felder in `EinsatzAnzeige`, `types.generated.ts` neu erzeugt.
- Frontend: `frontend/src/pages/fuehrung/offeneVorgaenge.ts` (`meineStelle`, Abgleich je
  Vorgangsart), Tests daneben und in `UeberblickPage.test.tsx`.
- Doku: `docs/anwender/kapitel/ueberblick.md`.
- Keine Migration, kein neues Recht, keine Änderung an Benachrichtigungen.
