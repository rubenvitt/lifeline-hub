# Proposal

## Why

Das Heraufstufen einer Chat-Nachricht prüft nur das Schreibrecht im Chat. Wer schreibend in den
Chat darf, für den das ETB oder die Aufträge aber gesperrt sind (Modulfreigabe, LFH-132), legt
darüber trotzdem ETB-Einträge (seit LFH-700 auch mit Dateien) oder Aufträge an. Die Sperre eines
Moduls gilt damit nur für dessen eigene Routen, nicht für den Umweg über den Chat. Das ist der
offene Punkt aus dem Review von LFH-700 (design.md, „Risks / Trade-offs“ → „Schreibrecht“).

## What Changes

- **Entscheidung:** Das Heraufstufen verlangt zusätzlich die Freigabe des Zielmoduls. Chat-
  Schreibrecht allein reicht nicht mehr, um ins Tagebuch oder in die Auftragsliste zu schreiben.
- `POST …/chat/nachrichten/{mid}/heraufstufen-etb` antwortet ohne Freigabe des Moduls `etb` mit
  **403**, ohne Eintrag, ohne Dateikopie und ohne Rückverweis an der Nachricht.
- `POST …/chat/nachrichten/{mid}/heraufstufen-auftrag` antwortet ohne Freigabe des Moduls
  `auftraege` mit **403**, ohne Auftrag und ohne ETB-Anordnung. Das ETB verlangt dieser Weg nicht,
  genau wie `POST …/auftraege`, dessen Anordnung ebenfalls ein Nebeneffekt ist.
- Im Chat stehen die Menüeinträge „Zu ETB“ bzw. „Zu Auftrag“ ohne Freigabe des Zielmoduls
  gesperrt im Menü, mit „Keine Berechtigung“ im Etikett (M16). Solange die Freigaben unbekannt
  sind, erscheinen sie wie bisher.
- **BREAKING (Verhalten):** Eine Rolle mit Chat-Schreibrecht, aber ohne ETB- oder Auftrags-
  Freigabe, kann nicht mehr heraufstufen. Das ist der Zweck der Änderung.

## Capabilities

### New Capabilities

_keine_

### Modified Capabilities

- `modul-freigabe`: Neue Anforderung, dass das Heraufstufen aus dem Chat die Freigabe des
  Zielmoduls verlangt, serverseitig und im Menü des Chats.

## Impact

- Backend: `src/routes/chat.rs` (`heraufstufen`, `heraufstufen_auftrag`), Tests in
  `tests/chat.rs`.
- Frontend: `frontend/src/chat/NachrichtenStrom.tsx` (Menüeinträge), `frontend/src/pages/ChatPage.tsx`
  (Freigaben durchreichen), Tests in `NachrichtenStrom.test.tsx`.
- Keine Migration, keine DTO- oder Enum-Änderung, kein neuer Endpunkt.
