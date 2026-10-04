# Spec Delta

## ADDED Requirements

### Requirement: Ein Ton für den überfälligen Besprechungstermin

Ist der Termin der nächsten Lagebesprechung erreicht oder verstrichen, SHALL die Stab-Seite und
die Fristenliste des Führungsüberblicks ihn mit demselben Ton und demselben Wort zeigen. Der Ton
MUST `achtung` sein und MUST NOT `alarm` sein, denn eine Besprechung ist kein Gefahrenereignis.
Das Wort MUST in der ersten Minute ab dem Termin „jetzt fällig“ lauten und danach „seit <Dauer>
überfällig“, die Dauer auf ganze Minuten abgerundet. Die Farbe MUST NOT der einzige Kanal sein;
das Wort trägt den Zustand auch ohne sie.

Überfällige Aufträge und Erinnerungen in derselben Fristenliste MUST von dieser Anforderung
unberührt bleiben.

#### Scenario: Termin seit fünf Minuten verstrichen
- **WHEN** der Termin der nächsten Lagebesprechung 5 Minuten und 30 Sekunden zurückliegt
- **THEN** zeigt die Stab-Seite „seit 5 min überfällig“ im Ton `achtung`
- **AND** zeigt die Marke „Lagebesprechung“ im Führungsüberblick dasselbe Wort im selben Ton

#### Scenario: Termin gerade erreicht
- **WHEN** der Termin vor weniger als einer Minute erreicht wurde
- **THEN** zeigen beide Oberflächen „jetzt fällig“ im Ton `achtung`

#### Scenario: Überfälliger Auftrag daneben
- **WHEN** in der Fristenliste ein überfälliger Auftrag neben der überfälligen Lagebesprechung steht
- **THEN** trägt der Auftrag weiter den Ton `alarm` und die Lagebesprechung `achtung`
