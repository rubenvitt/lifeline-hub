# Spec Delta

## MODIFIED Requirements

### Requirement: Auslöser der Aufbewahrung

Das System SHALL die Aufbewahrung ausschließlich über diese Auslöser bewegen: den Abschluss
(Frist aus der Dauer, Kategorie-Fristen aus der Org-Vorgabe), das Wiederöffnen binnen 24 Stunden
nach dem Abschluss (Rücknahme der beim Abschluss automatisch gesetzten Fristen, Capability
`einsatz-abschluss`), die manuelle Frist, die manuelle Kategorie-Frist, einen periodischen
Purge-Lauf höchstens alle 10 Minuten (Vormerkung und Schwärzung von Einsatz und Kategorien,
Vollzug fälliger Schwärzungsanträge, endgültige Löschung des Einsatzes), das Wiederherstellen
durch den Org-Admin und den Schwärzungsantrag des Org-Admins samt Rücknahme (Capability
`aufbewahrung-loeschersuchen`). Einen Auslöser, der ohne 24 Stunden Rücknahmefrist schwärzt, und
einen manuellen Sofort-Auslöser für die endgültige Löschung MUST es nicht geben.

#### Scenario: Fristablauf ohne Eingriff
- **WHEN** die Frist eines abgeschlossenen Einsatzes abläuft und niemand eingreift
- **THEN** ist der Einsatz spätestens nach dem nächsten Purge-Lauf vorgemerkt

#### Scenario: Antrag schwärzt nicht sofort
- **WHEN** der Org-Admin einen Einsatz-Antrag stellt
- **THEN** ist der Einsatz unmittelbar danach nicht geschwärzt

#### Scenario: Kategorie-Frist läuft ohne Eingriff ab
- **WHEN** die Frist einer Kategorie eines abgeschlossenen Einsatzes abläuft und niemand eingreift
- **THEN** ist die Kategorie spätestens nach dem nächsten Purge-Lauf vorgemerkt

#### Scenario: Skelett-Frist ohne Eingriff
- **WHEN** die Skelett-Frist eines geschwärzten Einsatzes abläuft und niemand eingreift
- **THEN** ist der Einsatz spätestens nach dem nächsten Purge-Lauf endgültig gelöscht

#### Scenario: Wiederöffnen nimmt die Abschluss-Fristen zurück
- **WHEN** ein Einsatz mit Kategorie-Vorgabe abgeschlossen und binnen 24 Stunden wieder geöffnet wird
- **THEN** trägt er weder die beim Abschluss gesetzte Frist noch die Kategorie-Fristen aus der Org-Vorgabe

### Requirement: Lückenloser Audit im ETB

Jede Mutation der Aufbewahrung (Frist aus Dauer, manuelle Frist, Vormerkung, Schwärzung,
Wiederherstellen, ebenso Kategorie-Frist aus der Org-Vorgabe, manuelle Kategorie-Frist,
Kategorie-Vormerkung und Kategorie-Schwärzung, Schwärzungsantrag, Rücknahme und Vollzug eines
Antrags, Rücknahme der Fristen beim Wiederöffnen) SHALL im selben atomaren Vorgang einen
System-Eintrag im ETB des Einsatzes schreiben. Bei einer handelnden Person MUST sie als Erfasser
stehen. Beim Purge-Lauf MUST der Erfasser in dieser Reihenfolge bestimmt werden: beim Vollzug
eines Antrags zuerst die Person, die ihn gestellt hat; sonst die
Person, die den Einsatz abgeschlossen hat, dann eine Einsatzleitung des Einsatzes, dann ein
System-Admin der Organisation des Einsatzes. Ist keiner auffindbar, MUST die Mutation
unterbleiben, als Fehler protokolliert und im nächsten Lauf erneut versucht werden. Eine
Aufbewahrungs-Mutation ohne ETB-Eintrag MUST es nicht geben. Einzige Ausnahme ist die
endgültige Löschung: Sie entfernt das ETB mit und schreibt ihren Audit stattdessen ins
Löschprotokoll der Organisation.

#### Scenario: Ersatzakteur
- **WHEN** ein fälliger Einsatz keine abschließende Person und keine Einsatzleitung hat, seine Organisation aber einen System-Admin
- **THEN** wird er vorgemerkt, und der System-Eintrag trägt den System-Admin als Erfasser

#### Scenario: Kein Akteur auffindbar
- **WHEN** ein fälliger Einsatz weder abschließende Person noch Einsatzleitung hat und seine Organisation keinen System-Admin
- **THEN** bleibt der Einsatz unvorgemerkt, und kein ETB-Eintrag entsteht
- **AND** wird der Einsatz im nächsten Lauf vorgemerkt, sobald ein Akteur auffindbar ist

#### Scenario: Vollzug eines Antrags
- **WHEN** der Purge-Lauf einen Antrag vollzieht
- **THEN** trägt der System-Eintrag die Person als Erfasser, die den Antrag gestellt hat

#### Scenario: Kategorie ohne Akteur
- **WHEN** eine fällige Kategorie an einem Einsatz ohne auffindbaren Akteur hängt
- **THEN** bleibt die Kategorie unvorgemerkt, und kein ETB-Eintrag entsteht

#### Scenario: Endgültige Löschung
- **WHEN** ein geschwärzter Einsatz endgültig gelöscht wird
- **THEN** entsteht kein ETB-Eintrag, aber eine Zeile im Löschprotokoll der Organisation

#### Scenario: Rücknahme beim Wiederöffnen
- **WHEN** das Wiederöffnen die beim Abschluss gesetzte Aufbewahrungsfrist zurücknimmt
- **THEN** nennt ein System-Eintrag im ETB die Rücknahme, mit der wieder öffnenden Person als Erfasser
