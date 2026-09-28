# Spec Delta

## Purpose

Macht ein freies taktisches Zeichen auf der Lagekarte über sein Bild und seinen Namen
auffindbar, beschleunigt wiederkehrende Zeichen und hält das Ändern eines bestehenden Zeichens
frei von Schreibstürmen und stillem Überschreiben.

## ADDED Requirements

### Requirement: Bildraster mit Textsuche
Der Zeichen-Picker SHALL Grundzeichen und, wo das Grundzeichen ein Symbol trägt, Symbole als
Raster aus Kacheln anbieten. Jede Kachel MUST das gezeichnete Zeichen und seinen Namen tragen.
Jedes Raster MUST ein eigenes Suchfeld haben, das auf Name und Kennung filtert und „Kein
Treffer“ meldet, wenn nichts passt. Das Symbolraster MUST eine Kachel „Kein Symbol“ tragen,
die jeder Filter stehen lässt. Die gewählte Kachel MUST maschinenlesbar markiert sein, nicht
nur farblich. Ein Raster MUST mit den Pfeiltasten bedienbar sein und EIN Tabstopp sein.
Organisation, Fachaufgabe, Einheit, Funktion, Farbe und Bezeichnung MUST eingeklappt unter
„Details“ stehen. Ein Grundzeichenwechsel MUST Overlays verwerfen, die das neue Grundzeichen
nicht darstellt.

#### Scenario: Zeichen über den Alltagsbegriff finden
- **WHEN** die Person im Grundzeichen-Suchfeld einen Teil des Namens tippt
- **THEN** stehen nur die passenden Kacheln da, jede mit Bild und Namen

#### Scenario: Pfeiltasten im Raster
- **WHEN** eine Kachel den Fokus hat und die Person ↓ oder → drückt
- **THEN** wandern Fokus und Auswahl zur nächsten Kachel

### Requirement: Enter platziert
In der Kartenleiste SHALL Enter im Picker das Platzieren starten wie der Knopf „Platzieren“,
mit der gerade sichtbaren Spec. Das gilt auf einer Kachel, in einem Suchfeld und in der
Bezeichnung. Enter in einem Suchfeld mit Treffern MUST vorher den ersten Treffer wählen, sofern
die Auswahl nicht schon unter den Treffern steht. Die Bezeichnung MUST dabei mit dem gerade
getippten Wortlaut übernommen werden. Das bloße Verlassen eines Feldes MUST NOT platzieren.

#### Scenario: Enter auf einer Kachel
- **WHEN** die Kachel „Person“ den Fokus hat und die Person Enter drückt
- **THEN** geht die Karte in den Platzier-Modus mit dem Grundzeichen „Person“

#### Scenario: Enter mit frisch getippter Bezeichnung
- **WHEN** die Person in „Bezeichnung“ „EA Nord“ tippt und Enter drückt
- **THEN** wird mit der Bezeichnung „EA Nord“ platziert

### Requirement: Zuletzt verwendete Zeichen
Der Picker SHALL eine Leiste „Zuletzt verwendet“ mit höchstens sechs Zeichen zeigen, das
zuletzt platzierte vorn. Ein Zeichen MUST erst nach erfolgreichem Platzieren eingetragen
werden, nicht beim Wählen im Picker. Ein erneut platziertes Zeichen MUST nach vorn wandern statt
doppelt zu erscheinen. Bezeichnung, Ansicht und Koordinate gehören nicht zum Zeichen; die Farbe
gehört dazu. Ein Griff in die Leiste MUST das Zeichen übernehmen und die Bezeichnung des
Entwurfs stehen lassen. Die Leiste ist eine persönliche Vorliebe auf dem Gerät; fehlender oder
kaputter Speicher MUST zu einer leeren Leiste führen, nicht zu einem Fehler.

#### Scenario: Deckel und Reihenfolge
- **WHEN** die Person nacheinander sieben verschiedene Zeichen platziert
- **THEN** zeigt die Leiste die letzten sechs, das siebte vorn, das erste nicht mehr

#### Scenario: Wiederverwendung
- **WHEN** die Person ein Zeichen platziert, das schon weiter hinten in der Leiste steht
- **THEN** steht es danach einmal und vorn

### Requirement: Entprelltes Schreiben im Inspector
Im Inspector eines bestehenden Zeichens MUST NOT jede Auswahl im Picker sofort geschrieben
werden. Änderungen SHALL nach einer kurzen Frist ohne weitere Änderung als ein Schreibvorgang
gesendet werden. Das bloße Öffnen und das Schließen ohne Änderung MUST NOT schreiben. Eine noch
in der Frist stehende Änderung MUST beim Schließen nachgeholt werden. Solange die Person
nichts geändert hat, MUST der Inspector eine fremde Änderung am Zeichen übernehmen und MUST NOT
den alten Stand zurückschreiben.

#### Scenario: Durch das Raster steppen
- **WHEN** die Person im Inspector mit den Pfeiltasten über fünf Grundzeichen läuft
- **THEN** geht nach der Frist genau ein Schreibvorgang mit dem letzten Zeichen raus

#### Scenario: Fremde Änderung ohne eigene
- **WHEN** der Inspector offen ist, die Person nichts geändert hat und jemand anderes das Zeichen ändert
- **THEN** zeigt der Inspector den neuen Stand und schreibt nichts
