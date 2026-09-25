# Spec Delta

## Purpose

Gerenderte Layout-Zusicherungen der Bedien-Leitlinie für die dichtesten Einsatzflächen:
Treffflächen folgen der Dichtestufe, angepinnte und schwebende Leisten lassen genug Fläche
übrig, und kein Fokusziel verschwindet beim Tabben vollständig hinter einem Aufbau.

Bezugsgrößen dieser Spec: **Fükw** 1366 × 768, **Führungs-Tablet** 1024 × 768,
**Handschirm** 390 × 844. Dichtestufen `kompakt`, `komfortabel`, `handschuh` mit den
Steuerhöhen 30 / 48 / 72 px (`controlHeightSM` 24 / 48 / 72 px).

## ADDED Requirements

### Requirement: Trefffläche folgt der Dichtestufe

Die folgenden Bedienziele SHALL in jeder Dichtestufe mindestens die Steuerhöhe der Stufe
erreichen (30 / 48 / 72 px). Menüeinträge in einem aufgeklappten Menü MUST mindestens
`controlHeightSM` erreichen (24 / 48 / 72 px). Ziele ohne Beschriftung (nur Symbol oder ein
Kürzel) MUST diesen Boden auf **beiden** Achsen erreichen. Kartenknöpfe haben den Boden
32 / 48 / 72 px.

- ETB: Zeilen des Slash-Menüs, Auslöser „Aktionen zu Eintrag N“ und die Einträge seines
  Menüs.
- Lagekarte: Einträge der Leistenkarte „Verortet“, die fünf Kartenknöpfe
  (Hineinzoomen, Herauszoomen, Nach Norden ausrichten, Messen, Zeichenwerkzeuge) und die
  Knöpfe der ausgeklappten Zeitachse, einschließlich „Abspielen“.
- Gefahrenmatrix: alle 58 Zell-Auslöser und die Gebietszeilen.

#### Scenario: Handschuh-Betrieb
- **WHEN** die Dichtestufe `handschuh` gewählt ist und die Seite neu geladen wurde
- **THEN** misst jedes genannte Ziel mindestens 72 px in der Höhe und jedes unbeschriftete Ziel zusätzlich mindestens 72 px in der Breite

#### Scenario: Die Stufe schlägt tatsächlich durch
- **WHEN** dieselben Ziele in `kompakt` gemessen werden
- **THEN** ist ihre Höhe kleiner als in `handschuh`, und keine Matrixzelle ist in `kompakt` 48 px oder breiter

#### Scenario: Abspielknopf der Zeitachse
- **WHEN** die Zeitachse der Lagekarte auf dem Handschirm ausgeklappt ist
- **THEN** ist der Knopf „Abspielen“ in jeder Stufe mindestens so breit wie hoch

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

#### Scenario: Tabben durch die Zeitachse des ETB
- **WHEN** der Fokus vom ersten Zeilenauslöser aus mit Tab durch 15 Einträge läuft, bei 390 × 600 und 1366 × 520
- **THEN** liegt kein Zeilenauslöser vollständig hinter der Erfassungsleiste, und zwischen seiner Unterkante und der Oberkante der Leiste bleibt ein Streifen frei

#### Scenario: Zeilenwechsel in der Gefahrenmatrix
- **WHEN** der Fokus mit Tab von der letzten Zelle einer Zeile zur ersten Zelle der nächsten wechselt und die Tabelle waagerecht überläuft
- **THEN** liegt die neue Zelle nicht vollständig hinter der Spalte „Gefahr“, und alle 58 Zellen werden im Durchlauf besucht

#### Scenario: Kartenknöpfe über dem Fuß
- **WHEN** auf der Lagekarte bei 390 × 844 und 1024 × 768 in `handschuh` die Zeitachse ausgeklappt ist
- **THEN** überschneiden sich Knopfblock und Fußbänder nicht, und jeder Kartenknopf lässt sich anklicken

### Requirement: Die Erfassungsleiste des ETB lässt die Zeitachse sichtbar

Die angepinnte Erfassungsleiste des ETB MUST im Ruhezustand (leerer Entwurf, keine Felder
gesetzt, Menüs geschlossen) höchstens die Hälfte der Fensterhöhe belegen. Das gilt auf
Handschirm, Führungs-Tablet und Fükw in allen drei Dichtestufen. Das Textfeld MUST auf dem
Handschirm die volle Breite der Leiste nutzen. Die Leiste MUST dabei weder waagerecht
überlaufen noch das Dokument waagerecht verbreitern.

#### Scenario: Handschirm im Handschuh-Betrieb
- **WHEN** das ETB bei 390 × 844 in `handschuh` geöffnet ist
- **THEN** ist die Erfassungsleiste höchstens 422 px hoch, das Textfeld ist so breit wie die Leiste abzüglich ihrer Polsterung, und das Dokument ist nicht breiter als 390 px

#### Scenario: Gesetzte Felder brechen um statt zu verschieben
- **WHEN** auf dem Handschirm drei Felder gesetzt werden und die Chip-Zeile dadurch umbricht
- **THEN** bleiben die Einträge der Zeitachse an ihrer Stelle, und das Textfeld bleibt im sichtbaren Bereich

### Requirement: Das Zeitachsenband der Lagekarte lässt die Karte sichtbar

Die ausgeklappte Zeitachse der Lagekarte MUST höchstens die Hälfte der Kartenhöhe belegen.
Das gilt im Fükw und am Führungs-Tablet sowie auf dem Handschirm mit ausgeblendeter Leiste
(der Vorgabe unter `md`), jeweils in allen drei Dichtestufen. Kein Kind des Bandes MUST über
das Band hinausragen, und das Band MUST in der Kartenspalte bleiben.

#### Scenario: Handschirm im Handschuh-Betrieb
- **WHEN** die Lagekarte bei 390 × 844 in `handschuh` mit ausgeklappter Zeitachse und zwei gesicherten Ständen offen ist
- **THEN** ist das Band höchstens halb so hoch wie die Karte, und kein Knopf des Bandes ragt über dessen Rand

#### Scenario: Leiste eingeblendet
- **WHEN** auf dem Handschirm zusätzlich die Leiste eingeblendet ist
- **THEN** bleibt das Band in der Kartenspalte, und Knopfblock und Band überschneiden sich nicht

### Requirement: Laden ohne Sprung

Das Laden des ETB, der Lagekarte und der Gefahrenmatrix auf dem Handschirm MUST ohne
Layoutverschiebung ablaufen, die nicht auf eine Eingabe folgt: Die Summe der
Verschiebungen (CLS) nach dem Erscheinen des Inhalts MUST höchstens 0,1 betragen.
Eine Fremdänderung einer Matrixzelle, die live eintrifft, MUST die Tabelle nicht
verschieben.

#### Scenario: Gefahrenmatrix lädt auf dem Handschirm
- **WHEN** die Gefahrenmatrix bei 390 × 844 frisch geladen wird, bis alle 58 Zellen und die Überschrift des Gebiets stehen
- **THEN** beträgt die Summe der Verschiebungen ohne vorherige Eingabe höchstens 0,1

#### Scenario: Fremdänderung einer Zelle
- **WHEN** eine andere Sitzung eine Zelle auf „akut“ setzt und die Zelle diese Stufe live übernimmt
- **THEN** bleibt die Lage der Tabelle unverändert, und die Summe der Verschiebungen seit dem Ruhezustand ist höchstens 0,1
