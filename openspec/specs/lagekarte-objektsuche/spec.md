# lagekarte-objektsuche Specification

## Purpose
Führt alle Objekte der Lagekarte, verortet und nicht verortet, in einer durchsuchbaren Objektliste
der Kartenleiste: anspringbar, verortbar und auswählbar, ohne Namen aus Modulen preiszugeben, für
die die Person kein Recht hat.

## Requirements

### Requirement: Eine Objektliste für verortete und nicht verortete Objekte
Die Ansicht „Objekte“ der Kartenleiste SHALL ein Suchfeld, die Marke „Nicht verortet“ und darunter
eine Liste aller Objekte der Lagekarte tragen, verortet und nicht verortet. Das Suchfeld MUST
Beschriftung, Objektart und Gruppennamen ohne Rücksicht auf Groß- und Kleinschreibung durchsuchen.
Verortet aufgeführt werden Einsatzort, Führungsstelle, UHS, Schäden, Einheiten, Fahrzeuge,
Personal, Einsatzabschnitte, Lagemeldungen, freie taktische Zeichen, Betreuungsstellen,
Bereitstellungsräume, Tiere und Betroffene; nicht verortet die Objekte ohne Koordinate (bei
Abschnitten ohne Fläche) und der Einsatzort ohne Koordinate; jeweils nur unter den Bedingungen der
Anforderung „Modulsperren“. Der Einsatzort MUST als erste Zeile stehen, kein Gruppenkopf. Die
übrigen Objekte MUST nach Art gruppiert stehen, jede Gruppe einklappbar mit ihrem Namen und
„verortet/gesamt“ im Kopf; Arten, die die Liste nur verortet führt (Führungsstelle,
Lagemeldungen, Taktische Zeichen, Betroffene), tragen nur ihre Zahl. Ohne Suchbegriff und Filter
MUST jede Gruppe in einer festen Reihenfolge stehen und per Vorgabe zugeklappt sein; der
Klappzustand wird je Gerät gemerkt. Mit Suchbegriff oder Filter MUST Gruppen ohne Treffer
entfallen, Gruppen mit Treffern aufgeklappt sein, ohne den gemerkten Zustand zu ändern, und mit
Suchbegriff nach Trefferzahl absteigend und bei Gleichstand in der festen Reihenfolge stehen,
unabhängig von der Ladereihenfolge der Daten.

#### Scenario: Suchbegriff grenzt über alle Objektarten ein
- **WHEN** verortet sind eine Einheit „Florian Nord 1“, ein Schaden „Keller Nordstraße“ und eine UHS „UHS Süd“, und die Person tippt „nord“
- **THEN** stehen die Gruppen „Einheiten“ und „Schäden“ aufgeklappt mit je einem Treffer da, die UHS nicht

#### Scenario: Nicht verortetes Fahrzeug finden
- **WHEN** das Fahrzeug „Musterstadt 83-1“ keine Koordinate hat und die Person „83“ tippt
- **THEN** steht es in der Gruppe „Fahrzeuge“ mit dem Knopf „Platzieren“

#### Scenario: Suche über die Objektart
- **WHEN** ein freies Zeichen ohne Bezeichnung verortet ist und die Person „takt“ tippt
- **THEN** steht es in der Gruppe „Taktische Zeichen“

#### Scenario: Leere Suche zeigt alles
- **WHEN** das Suchfeld leer und kein Filter gesetzt ist
- **THEN** steht der Einsatzort als erste Zeile, darunter alle Gruppen zugeklappt mit „verortet/gesamt“ im Kopf

### Requirement: Treffer springt an und wählt aus
Ein Tipp auf eine verortete Zeile SHALL die Karte auf das Objekt fliegen lassen und das Objekt
auswählen, wie ein Tipp auf seinen Marker; die Leiste zeigt dann die Ansicht „Auswahl“. Eine nicht
verortete Zeile SHALL rechts „Platzieren“ (Abschnitt: „Fläche zeichnen“, Einsatzort: „Platzieren“,
verortet „Verschieben“) tragen, ohne Schreibrecht das Wort „nicht verortet“, und MUST selbst kein
Ziel sein. Ausgenommen ist der Abschnitt ohne Fläche: seine Zeile MUST ihn auswählen, ohne
Anflug; sein Inspector zeigt keine Koordinate und bietet „Abschnitt fokussieren“. Jede Zeile und
jeder Zeilenknopf MUST ein Bedienziel mit dem Trefflächenboden der aktiven Dichtestufe sein. Das
laufende Platzierungsziel MUST bei jedem Suchbegriff und Filter in der Liste stehen bleiben, seine
Gruppe offen, und nur „wird platziert“ zeigen; „Abbrechen“ steht im Modus-Band.

#### Scenario: Klick auf einen Treffer
- **WHEN** die Person auf den Treffer „Florian Nord 1“ tippt
- **THEN** fliegt die Karte zur Einheit, und die Leiste zeigt ihren Inspector in der Ansicht „Auswahl“

#### Scenario: Laufendes Ziel bleibt stehen
- **WHEN** ein Fahrzeug platziert wird und die Person einen Begriff tippt, der es nicht trifft
- **THEN** steht seine Zeile mit „wird platziert“ weiter in der Liste

#### Scenario: Abschnitt ohne Fläche fokussieren
- **WHEN** der Abschnitt „EA Süd“ keine Fläche hat und die Person seine Zeile tippt
- **THEN** zeigt die Leiste seinen Inspector ohne Koordinate mit „Abschnitt fokussieren“, und die Zeile trägt daneben „Fläche zeichnen“, keinen Fokus-Knopf

### Requirement: Ein Leerzustand und keine falsche Leere
Findet die Liste nichts, SHALL genau ein Leerzustand für die ganze Fläche erscheinen: mit
Suchbegriff „Kein Kartenobjekt zu „<Begriff>““, mit Filter „Alles verortet“, sonst „Keine
Kartenobjekte“. Ist eine Lagebild-Quelle ausgefallen, MUST über der Liste der Fehler mit „Erneut
abrufen“ stehen, die Fläche MUST keine Leere behaupten, und Gruppenköpfe und Marke MUST „—“ statt
einer Zahl tragen. Fällt bei eingeschalteter Ebene „Betroffene“ die Personenliste aus, MUST die
Liste als unvollständig gelten: Gruppenköpfe tragen „—“, eine leere Fläche sagt, dass Objekte
nicht vollständig geladen werden konnten. Steht über den Objektgruppen ein Koordinatentreffer oder
die Gruppe „Adresse“ (Ortssuche, Spec `lagekarte-ortssuche`), MUST statt des Leerzustands der
Fläche nur ein knapper Hinweis „Kein Kartenobjekt zu „<Begriff>““ unter diesen Gruppen stehen.

#### Scenario: Suche ohne Treffer
- **WHEN** die Person „xyz“ sucht und kein Objekt passt
- **THEN** steht genau ein Leerzustand „Kein Kartenobjekt zu „xyz““ da

#### Scenario: Quelle ausgefallen
- **WHEN** eine Lagebild-Quelle nicht geladen werden konnte
- **THEN** behauptet die Fläche keine Leere, und Gruppenköpfe und Marke zeigen „—“ statt einer Zahl

#### Scenario: Koordinate ohne Objekttreffer
- **WHEN** die Person eine Koordinate tippt und kein Kartenobjekt passt
- **THEN** steht die Gruppe „Koordinate“ da und darunter nur der Hinweis „Kein Kartenobjekt zu …“, kein Leerzustand der ganzen Fläche

### Requirement: Modulsperren
Die Objektliste MUST Betreuungsstellen nur enthalten, wenn das Modul Betreuung für die Person frei
ist, Bereitstellungsräume nur, wenn das Modul Bereitstellungsräume frei ist, Tiere nur, wenn das
Modul Tiere frei ist, und Betroffene nur, wenn das Modul Personen frei ist und die Ebene
„Betroffene“ auf der Karte eingeschaltet ist — verortet wie nicht verortet. Ist ein Modul
ausgeblendet, gesperrt oder vom Server mit 403 abgelehnt, MUST kein Name aus diesem Modul in der
Liste erscheinen, auch nicht als Treffer eines passenden Suchbegriffs.

#### Scenario: Mit Betreuungsrecht
- **WHEN** das Modul Betreuung frei ist und eine Betreuungsstelle „Turnhalle Mitte“ verortet ist
- **THEN** findet die Suche nach „turnhalle“ sie in der Gruppe „Betreuungsstellen“

#### Scenario: Ohne Betreuungsrecht
- **WHEN** das Modul Betreuung gesperrt ist und dieselbe Stelle in den Daten stünde
- **THEN** findet die Suche nach „turnhalle“ nichts, und keine Gruppe „Betreuungsstellen“ erscheint

#### Scenario: Ohne Recht auf Bereitstellungsräume
- **WHEN** das Modul Bereitstellungsräume gesperrt ist und der Raum „BR Sportplatz“ in den Daten stünde
- **THEN** findet die Suche nach „sportplatz“ nichts, und keine Gruppe „Bereitstellungsräume“ erscheint

#### Scenario: Ohne Recht auf Tiere
- **WHEN** das Modul Tiere gesperrt ist und das Tier „T-005 (Hund)“ in den Daten stünde, verortet oder nicht
- **THEN** findet die Suche nach „t-005“ nichts, und keine Gruppe „Tiere“ erscheint

#### Scenario: Betroffene nur mit Recht und Ebene
- **WHEN** das Modul Personen gesperrt ist oder die Ebene „Betroffene“ aus ist
- **THEN** erscheint kein Name einer betroffenen Person in der Liste
