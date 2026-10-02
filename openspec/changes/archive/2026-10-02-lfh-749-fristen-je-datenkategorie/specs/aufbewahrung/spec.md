# Spec Delta

## MODIFIED Requirements

### Requirement: Datenkategorien über eine zentrale Klassifikation

Das System SHALL für jede Spalte jeder Tabelle, die an einem Einsatz hängt, genau eine
Klassifikation führen: **Scrub** (personenbezogen, wird geschwärzt, mit einer Strategie:
leeren, Platzhalter, Platzhalter nur wenn gesetzt, Platzhalter mit Zeilenkennung, Zeile
löschen) oder **Retain** (bleibt erhalten, mit Begründung). Jede Scrub-Spalte MUST zusätzlich
genau einer Zuordnung angehören: einer Datenkategorie der Capability
`aufbewahrung-kategorien`, dem Personenstamm oder der Einsatz-Frist. Diese Klassifikation MUST
die einzige Quelle sein, aus der die Schwärzung des Einsatzes und jeder Kategorie ihre
Anweisungen bildet. Eine einsatzbezogene Spalte oder Tabelle ohne Klassifikation MUST die
Testsuite scheitern lassen. Ein Klassifikationseintrag ohne zugehörige Spalte MUST die
Testsuite ebenfalls scheitern lassen.

#### Scenario: Neue Spalte ohne Klassifikation
- **WHEN** eine Migration einer einsatzbezogenen Tabelle eine Spalte hinzufügt und die Klassifikation sie nicht führt
- **THEN** scheitert die Testsuite und nennt Tabelle und Spalte

#### Scenario: Schwärzung folgt der Klassifikation
- **WHEN** ein Einsatz geschwärzt wird
- **THEN** ist jede als Scrub geführte Spalte nach ihrer Strategie behandelt, gleich welcher Zuordnung sie angehört
- **AND** trägt jede als Retain geführte Spalte ihren vorherigen Wert

#### Scenario: Kategorie-Schwärzung folgt derselben Klassifikation
- **WHEN** eine Datenkategorie eines Einsatzes geschwärzt wird
- **THEN** ist genau jede Scrub-Spalte dieser Kategorie nach ihrer Strategie behandelt

### Requirement: Auslöser der Aufbewahrung

Das System SHALL die Aufbewahrung ausschließlich über diese Auslöser bewegen: den Abschluss
(Frist aus der Dauer, Kategorie-Fristen aus der Org-Vorgabe), die manuelle Frist, die
manuelle Kategorie-Frist, einen periodischen Purge-Lauf höchstens alle 10 Minuten
(Vormerkung und Schwärzung von Einsatz und Kategorien) und das Wiederherstellen durch den
Org-Admin. Einen manuellen Sofort-Auslöser für die Schwärzung MUST es in dieser Fassung nicht
geben.

#### Scenario: Fristablauf ohne Eingriff
- **WHEN** die Frist eines abgeschlossenen Einsatzes abläuft und niemand eingreift
- **THEN** ist der Einsatz spätestens nach dem nächsten Purge-Lauf vorgemerkt

#### Scenario: Kategorie-Frist läuft ohne Eingriff ab
- **WHEN** die Frist einer Kategorie eines abgeschlossenen Einsatzes abläuft und niemand eingreift
- **THEN** ist die Kategorie spätestens nach dem nächsten Purge-Lauf vorgemerkt

### Requirement: Lückenloser Audit im ETB

Jede Mutation der Aufbewahrung (Frist aus Dauer, manuelle Frist, Vormerkung, Schwärzung,
Wiederherstellen, ebenso Kategorie-Frist aus der Org-Vorgabe, manuelle Kategorie-Frist,
Kategorie-Vormerkung und Kategorie-Schwärzung) SHALL im selben atomaren Vorgang einen
System-Eintrag im ETB des Einsatzes schreiben. Bei einer handelnden Person MUST sie als
Erfasser stehen. Beim Purge-Lauf MUST der Erfasser in dieser Reihenfolge bestimmt werden: die
Person, die den Einsatz abgeschlossen hat, dann eine Einsatzleitung des Einsatzes, dann ein
System-Admin der Organisation des Einsatzes. Ist keiner auffindbar, MUST die Mutation
unterbleiben, als Fehler protokolliert und im nächsten Lauf erneut versucht werden. Eine
Aufbewahrungs-Mutation ohne ETB-Eintrag MUST es nicht geben.

#### Scenario: Ersatzakteur
- **WHEN** ein fälliger Einsatz keine abschließende Person und keine Einsatzleitung hat, seine Organisation aber einen System-Admin
- **THEN** wird er vorgemerkt, und der System-Eintrag trägt den System-Admin als Erfasser

#### Scenario: Kein Akteur auffindbar
- **WHEN** ein fälliger Einsatz weder abschließende Person noch Einsatzleitung hat und seine Organisation keinen System-Admin
- **THEN** bleibt der Einsatz unvorgemerkt, und kein ETB-Eintrag entsteht
- **AND** wird der Einsatz im nächsten Lauf vorgemerkt, sobald ein Akteur auffindbar ist

#### Scenario: Kategorie ohne Akteur
- **WHEN** eine fällige Kategorie an einem Einsatz ohne auffindbaren Akteur hängt
- **THEN** bleibt die Kategorie unvorgemerkt, und kein ETB-Eintrag entsteht
