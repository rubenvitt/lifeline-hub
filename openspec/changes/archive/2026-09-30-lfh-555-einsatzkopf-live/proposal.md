# Proposal

## Why

Der Einsatzkopf (`GET /api/einsaetze/{id}`, Query-Key `einsatz`) ist heute nicht live. Er steht
bewusst in `NICHT_LIVE_KEYS`, und das Backend kennt kein Ereignis für ihn. Die Folge: Setzt der Stab
beim Abschluss einer Lagebesprechung den nächsten Termin, sieht ein zweiter Schirm diesen Termin auf
der Einsatzdaten-Seite und im Führungsüberblick erst beim nächsten Abruf. Umgekehrt bleibt der
Stab-Kopfblock stehen, wenn jemand den Termin auf der Einsatzdaten-Seite pflegt. Die Stab-Spec LFH-46
hat das als „dokumentierten Nachlauf" hingenommen (Entscheidung 11, Abschnitt 13 Punkt 8) und dieses
Ticket als Folge angelegt. Dasselbe gilt für den Abschluss des Einsatzes: Andere Schirme bleiben
schreibbar, bis sie den Kopf neu laden, und laufen dann erst beim Speichern in einen 409.

## What Changes

- Neues SSE-Ereignis **`einsatz`** (`LiveEvent::Einsatz`, `ALLE` 31 → 32), Nutzlast nur
  `{"einsatz_id": …}`.
- **Gate-Menge leer**: Der Einsatzkopf gehört keinem Modul. Er ist hinter derselben Tür lesbar wie
  der Strom selbst (`EinsatzLesezugriff` ohne Modul). Die leere Menge bedeutet damit künftig „erreicht
  jeden, der den Strom öffnen darf". Bisher war sie nur für das Kontrollereignis `lagged` vorgesehen.
  Die Regel und ihr Guard werden fortgeschrieben.
- **Wer feuert**, jeweils nach dem Commit:
  - `PATCH /api/einsaetze/{id}` (Kopfdaten, auch der Termin von der Einsatzdaten-Seite),
  - `POST /api/einsaetze/{id}/abschliessen`,
  - `PUT /api/einsaetze/{id}/aufbewahrungsfrist`,
  - `POST …/stab/lagebesprechungen`, **nur wenn sich der Termin tatsächlich ändert**. Ein
    Abschluss ohne neuen Termin oder mit demselben Termin verrät einem Leser ohne Stab-Recht nicht,
    dass eine Besprechung stattgefunden hat. Das war die Sorge hinter Entscheidung 11.
- **Frontend**: `EINSATZ_STREAM_EVENTS.einsatz = [einsatz, stab]`, `einsatz` fällt aus
  `NICHT_LIVE_KEYS`. Der Stab-GET liefert den Termin aus derselben Spalte mit und wird deshalb vom
  selben Ereignis aufgefrischt. Es entsteht keine zweite Terminwahrheit.
- Wire-Kontrakt (`tests/enum_wire_kontrakt.rs`, `liveEvent.contract.test.ts`), Gate-Pins in
  `src/live/mod.rs`, `queryKeys.guard.test.ts`/`queryKeys.test.ts`, OpenAPI-Codegen und
  Kommentare (Stab-Variante, Kopf von `NICHT_LIVE_KEYS`) werden nachgezogen.

## Capabilities

### New Capabilities

- `einsatzkopf-live`: Wann der Einsatzkopf auf anderen Schirmen frisch wird, wer davon erfährt und
  was bewusst nicht live ist.

### Modified Capabilities

_keine_

## Impact

- Backend: `src/live/mod.rs` (Variante, Gate-Menge, Tests), `src/routes/einsatz.rs` (drei Emitter),
  `src/stab/repo.rs` + `src/routes/stab.rs` (Termin-Änderung als Rückgabe, Emitter),
  `tests/enum_wire_kontrakt.rs`, neue Integrationstests (`tests/einsatz_live.rs`).
- Codegen: `frontend/src/api/openapi.json`, `frontend/src/api/types.generated.ts`.
- Frontend: `api/queryKeys.ts`, `api/liveEvent.contract.test.ts`, `api/queryKeys*.test.ts`.
  Die Seiten selbst ändern sich nicht. Sie lesen den Kopf schon heute aus dem Cache.
- Keine Datenmodell-, Migrations- oder Rechteänderung. Die Tür des Stroms bleibt unverändert.
- Bewusst **nicht** live bleiben: `meine_rolle`/`meine_fuehrungsstelle`/`meine_sachgebiete`
  (benutzerbezogen, Quelle Mitglieder bzw. Stab-Besetzung) und `lagekennzahlen` (Quelle Pegel bzw.
  Evakuierung). Sie gehen in Folge-Tickets, siehe `design.md` D5.
