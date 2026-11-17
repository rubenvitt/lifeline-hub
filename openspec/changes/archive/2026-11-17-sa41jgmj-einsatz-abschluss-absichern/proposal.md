# Proposal

## Why

Der Einsatzabschluss ist der einzige Schritt, der die Dokumentation eines Einsatzes beendet, und
er hängt heute an einer kleinen Rückfrage am Knopf (zwei Klicks, `Popconfirm` „Einsatz endgültig
abschließen“). Er warnt nicht vor gebundenen Kräften, offenen Aufträgen oder Betroffenen mit
offenem Verbleib, und es gibt keinen Rückweg: Ein Fehlklick im falschen Einsatz (der Name ist im
Kopf oft abgeschnitten, LLH-1726) beendet die Dokumentation endgültig. Thema 11 der
UI/UX-Analyse vom 12.11.2026 (LLH-1811, LLH-1814) stuft das als kritisch ein.

## What Changes

- Der Abschluss öffnet einen **Dialog** statt einer Rückfrage am Knopf. Er zeigt Bezeichnung
  und Nummer in voller Länge und darunter die **offenen Punkte**: nicht entlassene Kräfte und
  Fahrzeuge mit ihrem Status, offene Aufträge, offene Meldungen, laufende Nachforderungen,
  Betroffene mit offenem Verbleib oder vermisst. Jede Gruppe nennt eine Zahl und springt ins
  Modul. Die Punkte **warnen**, sie sperren den Abschluss nicht.
- **Bewusste Bestätigung:** Der rote Knopf wird erst aktiv, wenn die interne Einsatznummer oder
  die Bezeichnung eingetippt ist. Das hebt die Entscheidung vom 06.10.2026 (LFH-960, Frage 5,
  Option A, „kein Eintippen“) ausdrücklich auf (Entscheidung des Menschen am 17.11.2026).
- Der Dialog sagt, was mit gebundenen Kräften geschieht: Sie bleiben mit ihrem letzten Status im
  Einsatz stehen und sind für andere Einsätze frei. Das Verhalten selbst ändert sich nicht.
- Der Abschluss schreibt einen **ETB-Eintrag** „Einsatz abgeschlossen“.
- Neu: **Wiederöffnen** eines abgeschlossenen Einsatzes innerhalb von 24 Stunden durch die
  Einsatzleitung oder den System-Admin der Einsatz-Organisation, mit Pflicht-Grund und
  ETB-Eintrag. Es nimmt die beim Abschluss automatisch gesetzten Fristen zurück
  (Aufbewahrungsfrist, Kategorie-Fristen, Nachbereitungsfrist); beendete Gerätekopplungen und
  die entzogene Freigabe der öffentlichen API bleiben beendet.
- Neuer Lese-Endpunkt für die offenen Punkte und neuer Schreibweg zum Wiederöffnen; die
  Schnittstelle von `POST …/abschliessen` bleibt unverändert.
- Regel in `frontend/AGENTS.md` („Destruktiv ist nicht gleich destruktiv“) und Anwenderkapitel
  „Einsatzabschluss“ ziehen mit: der Abschluss ist nicht mehr „endgültig“.

## Capabilities

### New Capabilities

- `einsatz-abschluss`: Abschluss und Wiederöffnen eines Einsatzes — Prüfung offener Punkte,
  bewusste Bestätigung, ETB-Spur, Frist und Berechtigung des Wiederöffnens, Rücknahme der
  Abschluss-Folgen, Umgang mit gebundenen Kräften.

### Modified Capabilities

- `bedien-wortlaut`: Requirement „Unumkehrbares für den ganzen Einsatz steht nicht auf einer
  Arbeitsseite“ — der Abschluss bestätigt im Dialog mit Eintippen, der Knopf heißt nicht mehr
  „Einsatz endgültig abschließen“.
- `aufbewahrung`: Requirements „Auslöser der Aufbewahrung“ und „Lückenloser Audit im ETB“ — das
  Wiederöffnen ist ein weiterer Auslöser, der beim Abschluss automatisch gesetzte Fristen
  zurücknimmt, mit ETB-Eintrag.

## Impact

- Backend: `src/routes/einsatz.rs`, `src/einsatz/repo.rs` (Abschluss, Wiederöffnen, Prüfung),
  `src/einsatz/kontext.rs` (neues Gate, `SANKTIONIERTE_GATES`/ADR-0005),
  `src/einsatz/aufbewahrung_kategorie.rs`, `src/einsatz/nachbereitung.rs`, `src/app.rs`,
  `src/api_doc.rs`; Typ-Codegen (`frontend/src/api/openapi.json`, `types.generated.ts`). Keine
  Migration.
- Frontend: `pages/EinsatzdatenPage.tsx` (Paneel „Einsatzabschluss“), neuer Dialog unter
  `pages/einsatzdaten/`, `api/einsaetze.ts`, `einsatz/schreibrecht.ts`.
- Tests: Rust-Integrationstests (Prüfung, Abschluss-ETB, Wiederöffnen samt Fristen, Gate,
  Spiegel), Vitest am Dialog, e2e `einsatzabschluss.spec.ts`, Bildlauf
  `einsatzabschluss.bilder.ts`.
- Doku: `docs/anwender/kapitel/einsatzabschluss.md` (Mitänderungsregel), Regel in
  `frontend/AGENTS.md`.
- Gekoppelte Instanzen: der Rückweg nach `aktiv` läuft über den vorhandenen Spiegel-Log der
  Tabelle `einsatz`; ein Spiegel selbst kann nicht wieder geöffnet werden.
