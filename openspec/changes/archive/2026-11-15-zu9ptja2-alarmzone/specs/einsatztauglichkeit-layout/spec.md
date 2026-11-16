# Spec Delta

## MODIFIED Requirements

### Requirement: Kein Fokusziel vollständig verdeckt

Beim Durchlauf mit der Tabulatortaste MUST kein fokussiertes Ziel vollständig von einem
angepinnten, fixierten oder schwebenden Aufbau der Seite verdeckt sein (WCAG 2.4.11).
„Vollständig verdeckt“ heißt: Das Rechteck des Ziels liegt ganz innerhalb des Aufbaus, und
am Mittelpunkt des Ziels liegt nicht das Ziel selbst. Das gilt auf dem Handschirm und im
Fükw in `kompakt` und `handschuh`, auch bei geringer Fensterhöhe, solange die Seite einen
Bildlauf hat.

- ETB: die angepinnte Erfassungsleiste gegenüber den Zielen der Zeitachse.
- Gefahrenmatrix: die stehende Kopfzeile und die fixierte Spalte „Gefahr“ gegenüber den
  Zell-Auslösern, sobald die Tabelle waagerecht überläuft.
- Lagekarte und Personenkarte: Knopfblock, Überlagerung links und die Bänder des
  Kartenfußes gegenüber allen Zielen der Kartenspalte.
- Personenliste: die stehende Kopfzeile der Tabelle.
- Tabellen mit stehender Kopfzeile und waagerechtem Scrollen (Katalogtabelle, Tabellenzweig der
  Datensicht, Gefahrenmatrix): rückwärts in die erste Zeile getabbt, MUST das Ziel ganz unter
  der Kopfzeile stehen, auch wo der Browser den Fokusabstand am Scrollcontainer beschneidet.
- Rahmen: die klebende Kopfleiste samt Übungsband und Alarmzone gegenüber den Zielen von
  Seitenkopf und Inhalt; ein Fokus in der Kopfleiste selbst MUST die Seite nicht rollen.

#### Scenario: Tabben durch die Zeitachse des ETB
- **WHEN** der Fokus vom ersten Zeilenauslöser aus mit Tab durch 15 Einträge läuft, bei 390 × 600 und 1366 × 520
- **THEN** liegt kein Zeilenauslöser vollständig hinter der Erfassungsleiste, und zwischen seiner Unterkante und der Oberkante der Leiste bleibt ein Streifen frei

#### Scenario: Zeilenwechsel in der Gefahrenmatrix
- **WHEN** der Fokus mit Tab von der letzten Zelle einer Zeile zur ersten Zelle der nächsten wechselt und die Tabelle waagerecht überläuft
- **THEN** liegt die neue Zelle nicht vollständig hinter der Spalte „Gefahr“, und alle 58 Zellen werden im Durchlauf besucht

#### Scenario: Erste Zeile rückwärts unter der stehenden Kopfzeile
- **WHEN** der Fokus in Benutzerliste, Personenliste (ab `md`) oder Einheitenliste bei 390 × 400 und 1024 × 600 in `handschuh` mit Shift+Tab von der letzten Zeile in die erste läuft und die erste Zeile dabei unter der Kopfzeile liegt
- **THEN** steht jedes Ziel der ersten Zeile ganz unter der Kopfzeile, auch eines außerhalb der fixierten Spalte

#### Scenario: Kartenknöpfe über dem Fuß
- **WHEN** auf der Lagekarte bei 390 × 844 und 1024 × 768 in `handschuh` die Zeitachse ausgeklappt ist
- **THEN** überschneiden sich Knopfblock und Fußbänder nicht, und jeder Kartenknopf lässt sich anklicken

#### Scenario: Rückwärts unter dem klebenden Kopf
- **WHEN** der Fokus auf einer gerollten Seite bei 1366 × 520 mit Shift+Tab von unten durch die Ziele des Inhalts läuft
- **THEN** liegt kein Ziel vollständig hinter der Kopfleiste

#### Scenario: Rückwärts unter der Alarmzone
- **WHEN** ein Alarm in der Alarmzone steht und der Fokus auf einer gerollten Seite bei 1366 × 520 mit Shift+Tab von unten durch die Ziele des Inhalts läuft
- **THEN** liegt kein Ziel vollständig hinter Kopfleiste oder Alarmzone

#### Scenario: Tab durch die Kopfleiste
- **WHEN** die Seite gerollt ist und der Fokus mit Tab durch die Ziele der Kopfleiste läuft
- **THEN** bleibt die Bildlaufposition unverändert

### Requirement: Laden ohne Sprung

Das Laden des ETB, der Lagekarte und der Gefahrenmatrix auf dem Handschirm MUST ohne
Layoutverschiebung ablaufen, die nicht auf eine Eingabe folgt: Die Summe der
Verschiebungen (CLS) nach dem Erscheinen des Inhalts MUST höchstens 0,1 betragen.
Eine Fremdänderung einer Matrixzelle, die live eintrifft, MUST die Tabelle nicht
verschieben. Ausgenommen ist das Erscheinen und Gehen der Alarmzone (Spec
`benachrichtigungen`, „Alarmzone verdeckt nichts“): ein Alarm darf den Inhalt um seine Zeile
verschieben; gemessen wird ohne anstehenden Alarm.

#### Scenario: Gefahrenmatrix lädt auf dem Handschirm
- **WHEN** die Gefahrenmatrix bei 390 × 844 frisch geladen wird, bis alle 58 Zellen und die Überschrift des Gebiets stehen
- **THEN** beträgt die Summe der Verschiebungen ohne vorherige Eingabe höchstens 0,1

#### Scenario: Fremdänderung einer Zelle
- **WHEN** eine andere Sitzung eine Zelle auf „akut“ setzt und die Zelle diese Stufe live übernimmt
- **THEN** bleibt die Lage der Tabelle unverändert, und die Summe der Verschiebungen seit dem Ruhezustand ist höchstens 0,1

### Requirement: Der App-Rahmen springt beim Laden nicht

Beim Laden einer Einsatzseite MUST die Kopfleiste im ersten Bild so viele Zeilen haben wie im
fertig geladenen Zustand, in jeder Stufe der Dichte-Staffel und an jeder Breite ab `xl`. Ein
Inhalt der Kopfleiste, der erst nach einem Abruf feststeht, MUST NOT ihre Breite ändern. Die
Summe der Verschiebungen ohne vorherige Eingabe MUST bei 1280 × 800 in `kompakt` und
`komfortabel` unter 0,1 liegen, an der Umbruchkante der Kopfleiste höchstens 0,01. Gemessen wird
ohne anstehenden Alarm; die Alarmzone verschiebt den Inhalt mit Absicht (Spec
`benachrichtigungen`, „Alarmzone verdeckt nichts“).

#### Scenario: Arbeitsplatzmaß
- **WHEN** Überblick, Meldebild und ETB eines Einsatzes bei 1280 × 800 in `kompakt` und in `komfortabel` geladen werden
- **THEN** liegt die Summe der Verschiebungen ohne vorherige Eingabe je Seite unter 0,1

#### Scenario: An der Umbruchkante
- **WHEN** der Überblick in `komfortabel` oder `handschuh` als Admin oder Beobachter an der größten zweizeiligen und an der kleinsten einzeiligen Breite der fertig geladenen Kopfleiste geladen wird
- **THEN** hat die Kopfleiste nach dem Laden so viele Zeilen wie bei der Suche der Kante, und die Summe der Verschiebungen ist höchstens 0,01

#### Scenario: Funktion kommt nach dem Namen
- **WHEN** der Einsatz nach dem ersten Bild lädt und das Benutzermenü statt des Anzeigenamens die Funktion zeigt
- **THEN** behält das Etikett des Benutzermenüs seine Breite
