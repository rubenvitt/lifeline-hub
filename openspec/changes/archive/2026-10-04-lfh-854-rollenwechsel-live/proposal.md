# Proposal

## Why

Setzt die Einsatzleitung ein Mitglied vom Beobachter auf Führungspersonal (oder zurück), sieht die
betroffene Person ihr neues Schreibrecht erst nach dem Neuladen. Umgekehrt läuft ein entzogenes
Schreibrecht erst beim Speichern in einen 403. LFH-555 hat das bewusst offengelassen
(`openspec/changes/archive/2026-09-30-lfh-555-einsatzkopf-live/design.md`, D5) und dafür dieses
Folge-Ticket angelegt.

## What Changes

- Nach dem erfolgreichen Setzen, Ändern oder Entfernen einer Mitgliedschaft
  (`PUT`/`DELETE /api/einsaetze/{id}/mitglieder/{benutzer_id}`) wird das bestehende Ereignis
  `einsatz` verteilt, erst nach dem Commit, mit unveränderter Nutzlast (nur die Einsatzkennung).
- Abgelehnte Mitgliedschaftsänderungen (403, 404, 409, 400) verteilen kein `einsatz`.
- Die Regel „Bewusst nicht live" wird enger: `meine_rolle`, `meine_fuehrungsstelle` und
  `meine_funktion` werden bei einer Mitgliedschaftsänderung frisch. `meine_sachgebiete` (Stab-Besetzung)
  und `lagekennzahlen` bleiben unberührt.
- Kein neues Ereignis, keine neue Gate-Menge, keine Frontend-Logik: Das Frontend ruft beim
  Ereignis `einsatz` den Kopf schon heute neu ab, und das Schreibrecht hängt an `meine_rolle` aus
  dem Kopf (`frontend/src/einsatz/schreibrecht.ts`).

## Capabilities

### New Capabilities

_keine_

### Modified Capabilities

- `einsatzkopf-live`: Die Mitgliedschaftsänderung kommt als Auslöser des Ereignisses `einsatz` hinzu.
  Die Regel „Bewusst nicht live" nimmt die mitgliedschaftsbezogenen Kopffelder aus.

## Impact

- Backend: `src/routes/einsatz.rs` (`mitglied_setzen`, `mitglied_entfernen`, `kopf_geaendert`).
- Tests: `tests/einsatz_live.rs` (Auslöser und Ausbleiben), e2e `frontend/e2e/einsatzkopf-live.spec.ts`
  (Schirm der betroffenen Person ohne Neuladen).
- Keine Migration, kein DTO, kein Codegen, keine neue Wire-Variante.
- Mehr Abrufe: Jede Mitgliedschaftsänderung ruft den Kopf auf allen offenen Schirmen des Einsatzes neu
  ab. Mitgliedschaftsänderungen sind selten, der Abruf ist eine Einzelabfrage.
