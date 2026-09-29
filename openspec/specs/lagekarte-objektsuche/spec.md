# lagekarte-objektsuche Specification

## Purpose
Macht jedes wählbare verortete Objekt der Lagekarte über die Kartenleiste auffindbar und
anspringbar, ohne Namen aus Modulen preiszugeben, für die die Person kein Recht hat.

## Requirements

### Requirement: Suche über alle wählbaren verorteten Objekte
Die Kartenleiste SHALL im Paneel „Verortet“ ein Suchfeld anbieten, das die Beschriftungen aller
wählbaren verorteten Kartenobjekte und ihre Objektart ohne Rücksicht auf Groß- und
Kleinschreibung durchsucht.
Wählbar sind Einsatzort, UHS, Schäden, Einheiten, Fahrzeuge, Führung, Einsatzabschnitte,
Lagemeldungen, freie taktische Zeichen, Betreuungsstellen und Betroffene, jeweils nur unter
den Bedingungen der Anforderung „Modulsperren“. Die Treffer MUST nach Objektart gruppiert
stehen, jede Gruppe mit Objektart und Trefferzahl in der Kopfzeile. Gruppen ohne Treffer MUST
entfallen. Die Gruppen MUST nach Trefferzahl absteigend und bei Gleichstand in einer festen
Reihenfolge der Objektarten stehen, unabhängig von der Ladereihenfolge der Daten.

#### Scenario: Suchbegriff grenzt über alle Objektarten ein
- **WHEN** verortet sind eine Einheit „Florian Nord 1“, ein Schaden „Keller Nordstraße“ und eine UHS „UHS Süd“, und die Person tippt „nord“
- **THEN** stehen die Gruppen „Einheit (1)“ und „Schaden (1)“ da, die UHS nicht

#### Scenario: Suche über die Objektart
- **WHEN** ein freies Zeichen ohne Bezeichnung verortet ist und die Person „takt“ tippt
- **THEN** steht es in der Gruppe „Taktisches Zeichen“

#### Scenario: Leere Suche zeigt alles
- **WHEN** das Suchfeld leer ist
- **THEN** stehen alle wählbaren verorteten Objekte gruppiert da

### Requirement: Treffer springt an und wählt aus
Ein Klick auf einen Treffer SHALL die Karte auf das Objekt fliegen lassen und das Objekt
auswählen, wie ein Klick auf seinen Marker. Jeder Treffer MUST ein Bedienziel mit dem
Trefflächenboden der aktiven Dichtestufe sein.

#### Scenario: Klick auf einen Treffer
- **WHEN** die Person auf den Treffer „Florian Nord 1“ klickt
- **THEN** fliegt die Karte zur Einheit und ihr Inspector steht unter „Ausgewählt“

### Requirement: Ein Leerzustand und keine falsche Leere
Findet die Suche nichts, SHALL genau ein Leerzustand für die ganze Fläche erscheinen, mit dem
Suchbegriff, wenn einer eingegeben ist. Ist eine Quelle der Suche ausgefallen (eine Lagebild-Quelle, bei eingeschalteter Ebene
„Betroffene“ auch die Personenliste), MUST die Fläche
statt „Nichts verortet“ bzw. „kein Kartenobjekt“ sagen, dass die Liste unvollständig ist, und
die Trefferzahlen MUST einen Gedankenstrich statt einer Zahl tragen.

#### Scenario: Suche ohne Treffer
- **WHEN** die Person „xyz“ sucht und kein Objekt passt
- **THEN** steht genau ein Leerzustand „Kein Kartenobjekt zu „xyz““ da

#### Scenario: Quelle ausgefallen
- **WHEN** eine Lagebild-Quelle nicht geladen werden konnte
- **THEN** behauptet die Fläche keine Leere, und Gruppenköpfe zeigen „—“ statt einer Zahl

### Requirement: Modulsperren
Die Suche MUST Betreuungsstellen nur enthalten, wenn das Modul Betreuung für die Person frei
ist, und Betroffene nur, wenn das Modul Personen frei ist und die Ebene „Betroffene“ auf der
Karte eingeschaltet ist. Ist ein Modul ausgeblendet, gesperrt oder vom Server mit 403
abgelehnt, MUST kein Name aus diesem Modul in der Suche erscheinen, auch nicht als Treffer
eines passenden Suchbegriffs.

#### Scenario: Mit Betreuungsrecht
- **WHEN** das Modul Betreuung frei ist und eine Betreuungsstelle „Turnhalle Mitte“ verortet ist
- **THEN** findet die Suche nach „turnhalle“ sie in der Gruppe „Betreuungsstelle“

#### Scenario: Ohne Betreuungsrecht
- **WHEN** das Modul Betreuung gesperrt ist und dieselbe Stelle in den Daten stünde
- **THEN** findet die Suche nach „turnhalle“ nichts, und keine Gruppe „Betreuungsstelle“ erscheint

#### Scenario: Betroffene nur mit Recht und Ebene
- **WHEN** das Modul Personen gesperrt ist oder die Ebene „Betroffene“ aus ist
- **THEN** erscheint kein Name einer betroffenen Person in der Suche
