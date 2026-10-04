# Proposal

## Why

Die Lagekennzahlen am Einsatzkopf (`EinsatzAnzeige.lagekennzahlen`, LFH-640) belegen die Lageplätze
des Kennzahlenbands im Lage-Dashboard. Ihre Auslöser sind ein festgelegter maßgeblicher Pegel und
ein aktiver Evakuierungsbezirk. Beides löst heute kein Ereignis `einsatz` aus (LFH-555,
`design.md` D5). Legt Schirm A den ersten Pegel fest oder ordnet die erste Evakuierung an, bietet
Schirm B den neuen Zuschnitt erst beim nächsten Abruf des Kopfs an, also nach Neuladen oder
Fensterwechsel. Nur die eigenen Mutationen (`EinsatzPegel.tsx`, `FachebenenInspector.tsx`,
`BetreuungPage.tsx`) frischen den Kopf heute auf. LFH-555 hat das bewusst offen gelassen und dieses
Ticket mit der Technik aus D3 angelegt: feuern nur beim tatsächlichen Umschalten.

## What Changes

- Die Schreibwege der Auslöser lesen die Lagekennzahlen **vor und nach** ihrer Änderung in
  derselben Transaktion. Nur wenn sich die Menge unterscheidet, verteilt die Route nach dem Commit
  `einsatz` (samt `einsatzliste`, wie jeder Kopf-Emitter über `kopf_geaendert`).
- Betroffene Wege:
  - `PUT /api/einsaetze/{id}/pegel` (Liste ersetzen, auch leeren),
  - `POST /api/einsaetze/{id}/pegel` (anfügen),
  - `POST …/betreuung/bezirke` (Bezirk anlegen = Evakuierung anordnen),
  - `PATCH …/betreuung/bezirke/{bid}` (Räumung `aufgehoben` bzw. zurück),
  - `POST …/betreuung/bezirke/{bid}/stornieren`.
- Eine Änderung, die keine Kennzahl umschaltet (zweiter Pegel, Umordnen, zweiter Bezirk,
  Prognose, Standmeldung), verteilt **kein** `einsatz`.
- Die Spec `einsatzkopf-live` nimmt `lagekennzahlen` aus „Bewusst nicht live“ und führt das
  Umschalten als Auslöser.
- Frontend-Code ändert sich nicht: `einsatz` frischt den Kopf schon heute auf allen Schirmen auf,
  und das Lage-Dashboard hält seinen Zuschnitt und bietet den neuen per Sammelbanner an (LFH-640).
  Veraltete Kommentare (`queryKeys.ts`, `BetreuungPage.tsx`, `routes/pegel.rs`) werden nachgezogen.

## Capabilities

### New Capabilities

_keine_

### Modified Capabilities

- `einsatzkopf-live`: Das Umschalten einer Lagekennzahl wird Auslöser von `einsatz`; die
  Ausnahme „`lagekennzahlen` bewusst nicht live“ entfällt.

## Impact

- Backend: `src/einsatz/lagekennzahl.rs` (Lesen der Auslöser in einer Transaktion),
  `src/pegel/repo.rs` + `src/routes/pegel.rs`, `src/routes/betreuung.rs`; Integrationstests in
  `tests/einsatz_live.rs`.
- Frontend: nur Kommentare; ein e2e-Fall für den Zuschnitt auf einem zweiten Schirm.
- Kein neues Ereignis, keine Wire-, Codegen-, Migrations- oder Rechteänderung. Die Gate-Menge von
  `einsatz` bleibt leer.
