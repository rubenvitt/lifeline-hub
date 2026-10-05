# Proposal

## Why

Das Zugriffsprotokoll der Personen (`person_zugriff_audit`) hält neben dem Öffnen einer Person
auch den CSV-Export und den Abruf der Druckansicht der Personenliste fest. Diese listenweiten
Zeilen tragen keine Person, und keine Einsicht zeigt sie: Wer die Personenliste exportiert oder
gedruckt hat, lässt sich heute nur per Datenbank nachvollziehen. Für eine DSGVO-Auskunft („wer
hat meine Daten gesehen?“) und für die Aufsicht der Einsatzleitung reicht das nicht (ClickUp
LFH-916, Folge aus dem Druck der Modul-Listen).

## What Changes

- Neue Einsicht der Einsatzleitung in die **listenweiten Zugriffe** eines Einsatzes (Export und
  Druck der Personenliste): Zeitpunkt, Benutzer und Art, die neuesten zuerst. Das Öffnen der
  Einsicht wird selbst nicht protokolliert. Andere Rollen erhalten 403.
- Die Personenliste bekommt für die Einsatzleitung einen Kopf-Knopf **„Listenzugriffe“**, der
  die Einsicht als schreibgeschützte Schnellansicht öffnet. Andere Rollen sehen ihn nicht.
- Die bestehende **Einsicht je Person** zeigt zusätzlich die listenweiten Zugriffe, die diese
  Person erfasst haben, also die nach ihrer Erfassung und vor ihrer Stornierung. Damit
  beantwortet das Protokoll einer Person die DSGVO-Auskunft vollständig.
- Keine Schemaänderung: Die Zeilen werden schon geschrieben; neu ist nur ihre Einsicht.

## Capabilities

### New Capabilities

- `personen-zugriffsprotokoll`: Einsicht der Einsatzleitung in das Zugriffsprotokoll der
  Personen eines Einsatzes, je Person und listenweit, mit Rechten und der Regel, dass die
  Einsicht selbst unprotokolliert bleibt.

### Modified Capabilities

(keine — das Schreiben der Protokollzeilen in `modul-listen-druck` und `personen-anhaenge`
bleibt unverändert)

## Impact

- Backend: `src/person/audit_repo.rs` (neue Abfrage der listenweiten Zeilen, Abfrage je Person
  um die listenweiten Zeilen im Erfassungsfenster erweitert), `src/routes/einsatz_person.rs`
  (neuer Handler), `src/app.rs` (Route `GET /api/einsaetze/{id}/personen/listenzugriffe`),
  `tests/einsatz_person.rs`.
- Frontend: `api/einsatzPerson.ts`, `api/queryKeys.ts` (neuer, nicht-live Key),
  `pages/PersonenPage.tsx`, neue Schnellansicht unter `personen/`, Hinweistext am
  Zugriffs-Audit der `PersonenDetailPage`, `frontend/src/personen/AGENTS.md`.
- Keine DTO- oder Enum-Änderung (das Antwort-DTO `ZugriffAnzeige` bleibt), keine Migration.
