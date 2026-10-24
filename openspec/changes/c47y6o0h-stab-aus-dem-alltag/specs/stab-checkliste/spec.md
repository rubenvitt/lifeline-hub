## ADDED Requirements

### Requirement: Fläche im Paneel „Stab“ der Einsatzdaten
Die Checkliste SHALL als Abschnitt „Arbeitsaufnahme“ im Paneel „Stab“ der Einsatzdaten stehen, unter
der Besetzung, mit dem Zähler der erledigten Punkte, sobald Daten vorliegen. Ohne Freigabe des Stabs
fehlt sie mit dem Paneel.

Zum Auf- und Zuklappen gilt:
- Sind beim ersten Laden alle Punkte erledigt, SHALL der Abschnitt eingeklappt stehen: nur der Kopf
  mit „7/7 erledigt“ und ein Knopf zum Aufklappen, dessen Zustand Vorlesern bekannt ist.
- Danach klappt nur die Person den Abschnitt auf und zu.
- Ein Haken, der die Liste vollständig macht, MUST den Abschnitt NOT unter der Hand einklappen.
- Wird ein Punkt zurückgenommen, während der Abschnitt eingeklappt ist, MUST er aufklappen.

Zu jeder Zeile gilt:
- Sie SHALL den Haken samt Punkttext als eine Trefffläche anbieten, die auf jeder Dichtestufe
  mindestens die Steuerhöhe erreicht.
- Ein erledigter Punkt SHALL die Uhrzeit des Hakens zeigen.
- Die Bemerkung SHALL inline bearbeitbar sein und im leeren Zustand sagen, dass man sie schreiben
  kann.

Scheitert das Speichern, MUST der Fehler an der Zeile stehen, nicht als Toast, und der Haken MUST
den Serverstand zeigen. Scheitert das Laden, MUST ein Fehler mit Wiederholen statt offener Punkte
stehen. Der Verweis des ersten Punkts auf die eigene Führungsstelle MUST innerhalb der Seite zu
deren Paneel führen.

#### Scenario: Tipp auf den Text
- **WHEN** eine Person mit Schreibrecht auf den Text einer Zeile tippt
- **THEN** wechselt der Haken der Zeile

#### Scenario: Speichern scheitert
- **WHEN** der Server einen Haken ablehnt
- **THEN** steht der Fehler an dieser Zeile, der Haken zeigt den vorigen Stand, und es erscheint
  kein Toast

#### Scenario: Laden scheitert
- **WHEN** die Checkliste nicht geladen werden kann
- **THEN** zeigt der Abschnitt einen Fehler mit Wiederholen und keine offenen Punkte

#### Scenario: Live auf zweitem Schirm
- **WHEN** Schirm A einen Punkt abhakt
- **THEN** zeigt Schirm B den Punkt ohne Neuladen als erledigt

#### Scenario: Alles erledigt beim Öffnen
- **WHEN** eine Person die Einsatzdaten öffnet und alle sieben Punkte erledigt sind
- **THEN** steht die Arbeitsaufnahme eingeklappt mit „7/7 erledigt“, und ein Tipp auf „Aufklappen“
  zeigt die Punkte

#### Scenario: Letzter Haken
- **WHEN** eine Person den siebten Punkt abhakt
- **THEN** bleibt der Abschnitt offen und zeigt „7/7 erledigt“

#### Scenario: Rücknahme im eingeklappten Zustand
- **WHEN** der Abschnitt eingeklappt ist und auf einem anderen Schirm ein Punkt zurückgenommen wird
- **THEN** klappt der Abschnitt auf und zeigt „6/7 erledigt“

## REMOVED Requirements

### Requirement: Fläche auf der Stabseite
**Reason**: Die Stabseite entfällt (LLH-1452).
**Migration**: „Fläche im Paneel „Stab“ der Einsatzdaten“ in dieser Fähigkeit, mit gleichem
Verhalten. Die Termin-Zeile der Lagebesprechung entfällt dort. Den Termin zeigen der Stabsmonitor
und die Startseite des Fachzugangs.
