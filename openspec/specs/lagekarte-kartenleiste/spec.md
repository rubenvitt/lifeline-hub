# lagekarte-kartenleiste Specification

## Purpose

Hält die Lagekarte auf schmalen Breiten (Handschirm, Tablet hochkant) in jedem Kartenmodus mit Tipp
auf die Karte bedienbar: Die Kartenleiste weicht dem Modus und kommt danach im vorherigen Zustand
zurück.

## Requirements

### Requirement: Kartenmodus gibt unter lg die Karte frei
Unterhalb der Breite `lg` SHALL die Kartenleiste geschlossen sein, solange ein Kartenmodus läuft.
Kartenmodi sind: Zone zeichnen, Abschnittsfläche zeichnen, Objekt oder Einsatzort platzieren,
Taktisches Zeichen setzen, Bild einpassen und Messen. Das MUST für jeden Startweg gelten, auch für
den Verortungsauftrag per Adresse (`?platzieren=`) und für Messen über den Kartenknopf. Eine offene
Auswahl (Inspector) MUST die Leiste weiterhin öffnen, auch während eines Modus. Ab `lg` bleibt das
bisherige Verhalten unverändert.

#### Scenario: Platzieren aus „Nicht verortet“ bei 390 px
- **WHEN** bei 390 px die Leiste offen ist und in „Nicht verortet“ bei einer Einheit „Platzieren“ getippt wird
- **THEN** schließt die Leiste, der Kopf bietet „Leiste einblenden“, und ein Tipp auf die freie Karte verortet die Einheit an dieser Stelle

#### Scenario: Verortungsauftrag per Adresse
- **WHEN** die Lagekarte bei 390 px mit `?platzieren=schaden:<id>` geöffnet wird
- **THEN** ist die Leiste geschlossen, und die Bedienung des Platzierens steht über der Karte

#### Scenario: Messen gibt die Karte frei
- **WHEN** bei 768 px die Leiste offen ist und der Kartenknopf „Messen“ getippt wird
- **THEN** schließt die Leiste, und zwei Tipps auf die Karte ergeben eine Strecke im Messwert

#### Scenario: Ab lg unverändert
- **WHEN** bei 1024 px ein Taktisches Zeichen platziert wird
- **THEN** bleibt die Leiste offen, und „Abbrechen“ steht in der Leiste

### Requirement: Leiste bekommt nach dem Modus ihren vorherigen Zustand zurück
Endet ein Kartenmodus unter `lg` (abgeschlossen, abgebrochen oder durch einen erfolgreichen Tipp
beendet), SHALL die Leiste den Zustand annehmen, den sie unmittelbar vor dem Modus hatte. Suche
und aufgeklappte Paneele der Leiste MUST dabei erhalten bleiben. Wechselt ein Modus direkt in einen
anderen, gilt das als ein durchgehender Modus.

#### Scenario: Vorgabe „offen“ bei 768 px kehrt zurück
- **WHEN** bei 768 px in „Nicht verortet“ ein Suchbegriff steht, dort „Platzieren“ getippt und dann die Karte angetippt wird
- **THEN** ist die Leiste nach dem Verorten wieder offen, und der Suchbegriff steht noch im Feld

#### Scenario: Geschlossene Leiste bleibt geschlossen
- **WHEN** bei 390 px die Leiste geschlossen ist und Messen gestartet und wieder beendet wird
- **THEN** ist die Leiste danach geschlossen

### Requirement: Leiste während eines Modus vorläufig zurückholen
Unter `lg` SHALL der Kopfknopf „Leiste einblenden“ während eines Kartenmodus bedienbar bleiben,
damit Angaben aus der Leiste erreichbar sind (Koordinate eingeben, Mittelpunkt numerisch). Dieses
Umschalten MUST nur für den laufenden Modus gelten: Es wird nicht gespeichert, und nach dem Modus
gilt der vorherige Zustand. Nur eine offene Auswahl sperrt den Knopf.

#### Scenario: Koordinate eingeben während des Platzierens
- **WHEN** bei 390 px ein Platzieren läuft, „Leiste einblenden“ getippt und dort eine Koordinate übernommen wird
- **THEN** ist das Objekt verortet, und die Leiste ist danach wieder so wie vor dem Platzieren

#### Scenario: Kein gespeicherter Nebeneffekt
- **WHEN** bei 390 px während eines Modus die Leiste eingeblendet und die Seite nach Ende des Modus neu geladen wird
- **THEN** ist die Leiste geschlossen wie vor dem Modus

### Requirement: Modusbedienung steht unter lg über der Karte
Unter `lg` SHALL jeder Kartenmodus seine Bedienung in einem Band des Kartenfußes tragen, nicht in
der Leiste. Für Platzieren sind das Titel mit Objekt und „Abbrechen“. Für das Taktische Zeichen
kommen der Schalter „Weitere platzieren“, der Zähler und „Fertig“ bzw. „Abbrechen“ hinzu. Für Bild
einpassen sind es die Griffwahl (Verschieben, Größe, Drehen) und „Fertig“. Jedes Bedienelement
MUST je Breite an genau einer Stelle stehen. Ist die Leiste während des Modus eingeblendet, zeigt
sie an seiner Stelle einen Hinweis auf die Bedienung über der Karte. Das Band MUST mit
ausgeklappter Zeitachse bei 390 px vollständig über der Karte liegen und per Tipp bedienbar sein.

#### Scenario: Taktisches Zeichen per Tipp bei 390 px
- **WHEN** bei 390 px mit ausgeklappter Zeitachse ein Taktisches Zeichen gewählt, die Karte angetippt und im Band „Fertig“ bzw. „Abbrechen“ getippt wird
- **THEN** ist das Zeichen gespeichert, der Modus beendet und die Leiste im vorherigen Zustand

#### Scenario: Bild einpassen bei 390 px
- **WHEN** bei 390 px ein Bild eingepasst wird
- **THEN** stehen Griffwahl und „Fertig“ im Band, der Griff „Verschieben“ liegt nicht unter dem Fuß, und ein Ziehen am Griff ändert die gespeicherte Lage des Bildes

#### Scenario: Keine doppelte Bedienung
- **WHEN** bei 390 px während eines Platzierens die Leiste eingeblendet wird
- **THEN** gibt es genau einen Knopf „Abbrechen“ für diesen Modus, und zwar im Band
