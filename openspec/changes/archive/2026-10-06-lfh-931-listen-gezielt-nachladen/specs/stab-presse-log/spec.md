# Spec Delta

## ADDED Requirements

### Requirement: Medienkontakt einzeln abrufen

Das System SHALL einen einzelnen Medienkontakt eines Einsatzes abrufbar machen, mit denselben
Angaben wie in der Liste und hinter denselben Rechten wie die Liste. Ein Medienkontakt eines
anderen Einsatzes MUST mit 404 beantwortet werden.

#### Scenario: Einzelabruf
- **WHEN** eine Person mit Leserecht auf den Stab den Medienkontakt 12 ihres Einsatzes abruft
- **THEN** erhält sie ihn mit Art, Medium, Thema, Status und Antwort

#### Scenario: Fremder Einsatz
- **WHEN** der Medienkontakt 12 eines anderen Einsatzes über diesen Einsatz abgerufen wird
- **THEN** antwortet das System mit 404

## MODIFIED Requirements

### Requirement: Live-Aktualisierung
Änderungen am Presse-Log SHALL andere geöffnete Sitzungen desselben Einsatzes live erreichen.
Neue Einträge MUST dabei ohne Sprung unter dem Cursor eingereiht werden. Eine andere Sitzung
SHALL dafür nur den geänderten Medienkontakt abrufen, nicht das ganze Presse-Log.

#### Scenario: Zweiter Arbeitsplatz
- **WHEN** an einem Arbeitsplatz eine Anfrage erfasst wird, während ein zweiter die Presseseite offen hat
- **THEN** erscheint die Anfrage am zweiten Arbeitsplatz ohne Neuladen

#### Scenario: Nur die Zeile
- **WHEN** an einem Arbeitsplatz eine Anfrage beantwortet wird, während ein zweiter die Presseseite offen hat
- **THEN** ruft der zweite Arbeitsplatz nur diesen Medienkontakt ab und zeigt ihn als beantwortet
