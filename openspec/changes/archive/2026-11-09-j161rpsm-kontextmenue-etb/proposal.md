## Why

Seit LLH-1596 öffnet ein Rechtsklick auf eine Zeile der `Datensicht` ihr Kontextmenü. Im
Einsatztagebuch, dem meistbedienten Modul am Fükw, öffnet er weiter das Browsermenü, obwohl jeder
Eintrag ein ⋮-Menü trägt (Berichtigen, Wiedervorlage, Auftrag erteilen) und jeder Chip der
Erfassung auch. Diese Change bindet beide an den Baustein an, als Stufe 2 von LLH-1590.

Zunder: https://zunder.rubeen.dev/#/aufgabe/j161rpsmme0drnd4mpelm2l7 (LLH-1597, Eltern LLH-1590)

## What Changes

- **ETB-Eintrag:** Rechtsklick und die Tasten Kontextmenü bzw. Umschalt+F10 öffnen ein Menü mit
  den Einträgen seines ⋮-Menüs. Ein Eintrag hat keine Primäraktion, deshalb gibt es oben keinen
  Zusatz. ⋮ und Kontextmenü bekommen ihre Einträge aus einer Quelle.
- **Abgelehnter Eintrag:** Das Kontextmenü zeigt „Erneut senden“, „Nur protokollieren“ (wenn
  angeboten) und rot hinter einem Trenner „Verwerfen“, aus derselben Quelle wie die Knöpfe der
  Zeile. Wie am Knopf fragt „Verwerfen“ nicht nach (abgestimmt mit Ruben am 09.11.2026).
- **Kein eigenes Menü** an vorgemerkten Einträgen, an Bündelzeilen der Systemeinträge und an
  Einträgen ohne Aktion (fehlende Rechte). Dort bleibt das Browsermenü, ebenso auf Link und
  markiertem Text.
- **Im ETB öffnet ein langer Druck kein Menü** (abgestimmt mit Ruben am 09.11.2026): Am Tablet
  bleibt Text in einem Eintrag markierbar, und das ⋮ bleibt der Weg am Touchgerät. Der Baustein
  bekommt dafür einen Schalter.
- **Offenes Menü hält die Zeitachse an:** Solange es offen ist, verschiebt kein neuer Eintrag die
  Zeile darunter (wie bei Fokus in der Achse).
- **Chip der Erfassung (Von, An, Zeit, Meldeweg):** Rechtsklick und Tasten öffnen das Menü mit den
  Einträgen seines ⋮ („Bearbeiten“, rot „Entfernen“ bzw. die Einträge eines Standard-Rufnamens).
  Während des Sendens stehen sie gesperrt da. Ein Chip im Bearbeiten-Zustand ist ein Eingabefeld
  und behält das Browsermenü.

## Capabilities

### New Capabilities

(keine)

### Modified Capabilities

- `datensatz-aktionsmenue`: Der lange Druck gilt nicht im Einsatztagebuch; neue Anforderungen für
  das Kontextmenü an ETB-Einträgen (gesendet und abgelehnt) und an den Chips der Erfassung.

## Impact

- Frontend: `components/useKontextMenue.ts` (Schalter für den langen Druck),
  `etb/EtbZeitachse.tsx` (Hook je Zeitachse, eine Quelle für ⋮, Knöpfe und Kontextmenü,
  Einfrieren), `etb/MetaChip.tsx`.
- Doku: `docs/anwender/kapitel/einsatz-oberflaeche.md` („Wo das Kontextmenü gilt“),
  `docs/anwender/kapitel/einsatztagebuch.md`, `frontend/src/etb/AGENTS.md`.
- Kein Backend, keine Daten, keine Wire-Änderung.
