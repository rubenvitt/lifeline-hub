# Spec Delta

## MODIFIED Requirements

### Requirement: Paneel „Vorbereitung“ auf der Seite Lagebesprechung
Die Seite Lagebesprechung SHALL unter dem Termin der nächsten Besprechung ein Paneel „Vorbereitung“
zeigen. Es enthält den Lagestand für die nächste Besprechung:
- Betroffene mit Zahl der Vermissten;
- Sichtungsverteilung;
- Kräfte (Stärke in BOS-Schreibweise);
- höchste Warnstufe mit Zahl der Gebiete;
- Aufträge offen mit überfälligen;
- Meldungen offen mit neuen und mit überfälliger Bestätigung;
- Nachforderungen offen mit der Zahl je Stufe (angefordert, zugesagt, unterwegs), aus dem
  Modulzähler wie Modulmenü und Führungsüberblick;
- der jüngste Lagebericht mit Stand und Status;
- die letzte Lagebesprechung mit Nummer und Zeit, und der nächste Termin.

Jede Zahl MUST denselben Wert haben, den das Lage-Dashboard für diesen Einsatz zur selben Zeit
zeigt. Das Paneel MUST keine Zahl selbst rechnen, die das Dashboard schon zeigt. Der Lagestand
MUST den Zeitpunkt nennen, auf dem er beruht („Stand HH:MM“, den ältesten Stand seiner Quellen).
Er MUST sich live aktualisieren wie das Dashboard.

#### Scenario: Gleiche Zahlen wie das Dashboard
- **WHEN** das Lage-Dashboard 248 Betroffene, davon 3 vermisst, und 5 offene Aufträge, davon 1
  überfällig, zeigt
- **THEN** zeigt die Vorbereitung dieselben Werte

#### Scenario: Offene Nachforderungen
- **WHEN** eine Nachforderung angefordert, zwei zugesagt und zwei unterwegs sind
- **THEN** zeigt die Zeile „Nachforderungen offen“ „5“ mit „1 angefordert · 2 zugesagt · 2
  unterwegs“ und der Quelle „Nachforderungen“; ohne Freigabe der Nachforderungen „—“ mit „nicht
  freigegeben“

#### Scenario: Neue Meldung während der Vorbereitung
- **WHEN** eine andere Person eine Meldung erfasst, während die Seite Lagebesprechung offen ist
- **THEN** steigt „Meldungen offen“ in der Vorbereitung ohne Neuladen

### Requirement: Rechteweiche je Quelle in der Vorbereitung
Die Vorbereitung SHALL jede Quelle einzeln laden. Wird eine Quelle abgelehnt oder scheitert ihr
Abruf, MUST die Zeile „—“ mit dem Grund zeigen, „nicht freigegeben“ bzw. „nicht geladen“. Die
übrigen Zeilen MUST sie weiter zeigen. Eine fehlende Quelle MUST NOT als 0 erscheinen. Die Seite
Lagebesprechung prüft ihre eigene Freigabe; die Vorbereitung ist keine Freigabe für die
Quellmodule.

#### Scenario: Betroffene gesperrt
- **WHEN** die Person das Modul Betroffene nicht sehen darf
- **THEN** zeigen die Zeilen Betroffene und Sichtung „—“ mit „nicht freigegeben“, und die übrigen
  Zeilen zeigen ihre Werte

#### Scenario: Stab gesperrt
- **WHEN** die Person die Lagebesprechung sehen darf
- **THEN** zeigen die Zeilen „Letzte Lagebesprechung“ und „Nächster Termin“ ihre Werte

### Requirement: Ein Ton für den überfälligen Besprechungstermin

Ist der Termin der nächsten Lagebesprechung erreicht oder verstrichen, SHALL die Seite
Lagebesprechung und die Fristenliste des Führungsüberblicks ihn mit demselben Ton und demselben
Wort zeigen. Der Ton MUST `achtung` sein und MUST NOT `alarm` sein, denn eine Besprechung ist kein
Gefahrenereignis. Das Wort MUST in der ersten Minute ab dem Termin „jetzt fällig“ lauten und danach
„seit <Dauer> überfällig“, die Dauer auf ganze Minuten abgerundet. Die Farbe MUST NOT der einzige
Kanal sein; das Wort trägt den Zustand auch ohne sie.

Überfällige Aufträge und Erinnerungen in derselben Fristenliste MUST von dieser Anforderung
unberührt bleiben.

#### Scenario: Termin seit fünf Minuten verstrichen
- **WHEN** der Termin der nächsten Lagebesprechung 5 Minuten und 30 Sekunden zurückliegt
- **THEN** zeigt die Seite Lagebesprechung „seit 5 min überfällig“ im Ton `achtung`
- **AND** zeigt die Marke „Lagebesprechung“ im Führungsüberblick dasselbe Wort im selben Ton

#### Scenario: Termin gerade erreicht
- **WHEN** der Termin vor weniger als einer Minute erreicht wurde
- **THEN** zeigen Seite Lagebesprechung und Überblick „jetzt fällig“ im Ton `achtung`

#### Scenario: Überfälliger Auftrag daneben
- **WHEN** in der Fristenliste ein überfälliger Auftrag neben der überfälligen Lagebesprechung steht
- **THEN** trägt der Auftrag weiter den Ton `alarm` und die Lagebesprechung `achtung`
