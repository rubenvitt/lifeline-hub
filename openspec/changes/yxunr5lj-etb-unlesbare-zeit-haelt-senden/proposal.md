# Proposal

Zunder: https://zunder.rubeen.dev/#/aufgabe/yxunr5ljwl6dhhkwnq7d9uaj (LLH-1866)

## Why

Wer im Feld Zeit der ETB-Erfassung „14:3x“ tippt und direkt „Erfassen“ klickt, schickt den Eintrag
mit der Zeit „jetzt“ ab: Das Verlassen des Felds verwirft die unlesbare Eingabe (Spec
`zeiteingabe`, „Verlassen mit unlesbarer Eingabe“), und derselbe Klick sendet. Im ETB heißt
„unverändert“ aber „keine Ereigniszeit“, und ein Eintrag lässt sich danach nur noch berichtigen.
Für eine Zeit in der Zukunft und für das geleerte Feld hält die Erfassung schon an (LLH-1088,
LLH-1842), nur dieser Fall nicht. Ruben hat am 15.11.2026 entschieden, das Senden auch hier
anzuhalten.

## What Changes

- **Unlesbare Zeit hält das Senden an:** Solange das Feld Zeit eine unlesbare Eingabe meldet,
  sendet die ETB-Erfassung nicht, weder über „Erfassen“ noch über Enter im Inhalt. Der Grund steht
  am Feld und in der Fußzeile, der Fokus geht ins Feld Zeit, Text, Felder und Anhänge bleiben.
- **Auch ein unlesbares `/zeit` im Text hält an** (Szenario „Unlesbar“ der Kurzeingabe): Heute
  geht der Eintrag dann mit „jetzt“ und dem Befehl im Inhalt hinaus. Dieselbe Regel, ein Weg.
- **Weiter geht es** durch eine lesbare Zeit, ein geleertes Feld (dann gilt „jetzt“) oder eine Wahl
  im Kalender; bei `/zeit` durch eine lesbare Angabe oder das Entfernen des
  Befehls.
- Andere Formulare mit Zeitfeld bleiben beim Vertrag der Spec `zeiteingabe` (gesendet wird der
  unveränderte Wert). Server und Wire bleiben unverändert.

## Capabilities

### New Capabilities

Keine.

### Modified Capabilities

- `etb-schnellerfassung-tastatur`: neue Anforderung „Unlesbare Zeit hält das Senden an“;
  „Kurzeingabe der Ereigniszeit“ ergänzt im Szenario „Unlesbar“, dass nicht gesendet wird.

## Impact

- Frontend: `etb/Schnellerfassung.tsx` (Sendeweg, Fußzeile), `etb/EtbFeldzeile.tsx` (Feld Zeit),
  `anzeige/ZeitpunktEingabe.tsx` (meldet eine verworfene Eingabe nach außen, ohne eigenes
  Verhalten zu ändern).
- Doku: Kapitel `docs/anwender/kapitel/einsatztagebuch.md`, Abschnitt „Felder, Bausteine und Werte
  setzen“.
- Kein Backend, keine Migration, keine Typänderung.
