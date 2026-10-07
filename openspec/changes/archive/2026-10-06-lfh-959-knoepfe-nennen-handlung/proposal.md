## Why

Auf Tablet und Handy gibt es keinen Hover. Heute trägt in den Erinnerungen nur ein Tooltip den
Unterschied zwischen „Quittieren“ (die Erinnerung erübrigt sich) und „Erledigt“ (durchgeführt);
wer am Tablet „Quittieren“ tippt, um „gesehen“ zu sagen, schließt die Erinnerung als erübrigt und
verfälscht die Dokumentation. In Meldungen und Aufträgen heißt „quittiert“ dagegen wie im
BOS-Gebrauch „Empfang bestätigt“. Daneben tragen Fortschaltknöpfe Statuswörter („In Bearbeitung“
neben dem Etikett „Offen“, „→ Zugesagt“, „Außer Dienst“), und die Kennzahl „Alarmiert“ meint eine
überfällige Bestätigung, nicht eine Alarmierung über die Leitstelle.

Entschieden am 06.10.2026 (Klärungsrunde Welle 4, Fragen 1 und 10, jeweils Option A).

## What Changes

- **Neue Regel** in `frontend/AGENTS.md`, Bedien-Leitlinie „Aktionen“: Knöpfe tragen Handlungen,
  Zustände stehen nur auf Etiketten; kein Knopftext gleicht einem Statuswort desselben Moduls.
  Der Bestätigungsknopf einer Rückfrage nennt die Handlung, nie nur „Ja“ oder „OK“. Ein Tooltip
  ist nie die einzige fachliche Erklärung. „Quittieren“ steht nur für die Empfangsbestätigung.
- **Erinnerungen:** Knöpfe „Erübrigt (zur Kenntnis)“ und „Erledigt (durchgeführt)“ statt
  „Quittieren“/„Erledigt“ mit Tooltip; Statuswort „Erübrigt“ statt „Quittiert“; an einer
  erübrigten Erinnerung steht „Erübrigt: ‹Zeit›“ statt des `QuittungIndikator`; Rückgängig-Toast
  „Erinnerung erübrigt“. Backend-Enum (`quittiert`), DTOs und Routen bleiben.
- **Fortschaltknöpfe als Handlung**, je Modul an einer Stelle neben dem Statusdeskriptor:
  Meldungen und Aufträge „Bearbeitung beginnen“, „Als erledigt melden“ (Meldung; „Sichten“
  bleibt); Nachforderungen „Zusage erfassen“, „Abfahrt melden“, „Eintreffen melden“ statt
  „→ ‹Status›“; Dienststatus „Außer Dienst nehmen“, „Wieder in Dienst nehmen“. Der Aufträge-Knopf
  „quittieren“ wird „Quittieren“.
- **Meldungen:** Kennzahl „Bestätigung überfällig“ statt „Alarmiert“ (Notiz bleibt); das Wort
  „Alarm“ auf der Karte entfällt, die Uhr wandert an den Chip „Bestätigung überfällig“.
- **Guard** je Modul: kein Handlungstext gleicht einem Statuswort desselben Moduls, und kein
  `<Button>` rendert ein Statuswort aus dem Deskriptor.

## Capabilities

### New Capabilities

- `bedien-wortlaut`: Knöpfe nennen ihre Handlung, Zustände stehen auf Etiketten, Rückfragen
  nennen die Handlung, „Quittieren“ nur für die Empfangsbestätigung, kein Tooltip als einzige
  Erklärung.

### Modified Capabilities

(keine; `lage-verdichtung` verlangt „Bestätigung überfällig“ schon, die Meldungsseite holt nur auf)

## Impact

- Frontend: `kommunikation/phase.ts`, `kommunikation/QuittungIndikator.tsx`,
  `erinnerung/ErinnerungKarte.tsx`, `pages/ErinnerungenPage.tsx`, `meldungen/MeldungKarte.tsx`,
  `meldungen/meldungKennzahlen.ts`, `pages/MeldungenPage.tsx`, `auftraege/AuftragKarte.tsx`,
  `nachforderungen/NachforderungKarte.tsx`, `stammdaten/dienststatus.tsx` und deren Tests,
  `e2e/palette-oeffnung.spec.ts`.
- Regeln: `frontend/AGENTS.md` (Bedien-Leitlinie, „Aktionen“).
- Kein Backend, keine Migration, kein Typ-Codegen.
