# Proposal

## Why

`PUT /api/einsaetze/{id}/aufbewahrungsfrist` lässt jeden System-Admin durch, auch den einer
fremden Organisation. Der Handler prüft nur `ist_admin()`, und der Org-Floor des
`EinsatzKontext`-Extractors lässt den Admin serverweit passieren. Der Archivbereich
`/api/aufbewahrung` schneidet dagegen streng nach Organisation (`fordere_archivzugriff`: fremd
403, unbekannt 404). Die Change LFH-23 hat das als „benannte Inkonsistenz, bewusst nicht
angeglichen“ stehen lassen (`openspec/changes/archive/2026-09-29-lfh-23-retention-rest/design.md`,
D1). Der Admin einer fremden Org kann damit die Frist eines Einsatzes verkürzen und so die
Löschung fremder Daten auslösen. LFH-753 schließt die Lücke.

Der zweite Befund aus LFH-23 ist fachlich entschieden (Ruben, 02.10.2026): Die Einsatzleitung
bekommt nach Fristablauf keinen eigenen Weg zum Verlängern. Der Purge-Lauf merkt einen
fälligen Einsatz spätestens zehn Minuten nach Fristablauf vor (`TICK_SEKUNDEN = 600`). Danach
führt nur das Wiederherstellen weiter, und das liegt beim Org-Admin. Ein UI-Weg für ein
Zehn-Minuten-Fenster lohnt nicht.

## What Changes

- Der Frist-PUT lässt nur noch die Einsatzleitung (Mitgliedschaft) und den System-Admin
  **der Einsatz-Org** durch. Der Admin einer fremden Org bekommt 403, und es ändert sich
  nichts: keine Frist, kein ETB-Eintrag. Ein unbekannter Einsatz bleibt 404.
- Der Client spiegelt die Regel: `darfFristSetzen` gibt dem Admin einer fremden Org kein
  Recht mehr, die Aktion steht dort gesperrt mit Hinweis. Dafür trägt `BenutzerAnzeige` die
  `org_id` des Benutzers (Response-DTO, Typ-Codegen).
- Die Entscheidung „kein Weg für die Einsatzleitung nach Fristablauf“ steht in `design.md`
  und in der Spec. Das Verhalten im Backend bleibt dabei unverändert: Im kurzen Fenster vor der
  Vormerkung darf die Einsatzleitung über den PUT weiter verlängern.
- `src/AGENTS.md` (Abschnitt „Backend — Aufbewahrung“) ersetzt den Satz über die bekannte
  Inkonsistenz durch die Regel.

## Capabilities

### New Capabilities

Keine.

### Modified Capabilities

- `aufbewahrung`: Requirement „Manuelle Frist“ — der System-Admin nur für Einsätze seiner
  Organisation, fremde Org 403 ohne Änderung, und die Festlegung zum Verlängern nach Fristablauf.
- `aufbewahrung-archiv`: Requirement „Frist am Einsatz anzeigen und ändern“ — die Aktion steht
  nur dem Admin der Einsatz-Org offen, für den einer fremden Org gesperrt mit Hinweis.

## Impact

- Backend: `src/routes/einsatz.rs` (`aufbewahrungsfrist_setzen`), `src/auth/mod.rs`
  (`BenutzerAnzeige`, `Benutzer::anzeige`), `src/routes/benutzer.rs` (SELECTs auf
  `BenutzerAnzeige`), Tests in `tests/aufbewahrung.rs`.
- Typ-Codegen: `scripts/check-typ-codegen.sh`, beide generierten Dateien.
- Frontend: `frontend/src/aufbewahrung/fristModell.ts` (+ Test), Typ
  `BenutzerSchreibkontext` in `frontend/src/einsatz/schreibrecht.ts`, Rechte-Hinweistext im
  `FristPaneel`.
- Regeln: `src/AGENTS.md`.
- API: Der Frist-PUT antwortet dem Admin einer fremden Org jetzt mit 403 statt 200. Die
  Antwort von `GET /api/auth/me` und der Benutzerverwaltung bekommt ein zusätzliches Feld
  `org_id` (additiv).
