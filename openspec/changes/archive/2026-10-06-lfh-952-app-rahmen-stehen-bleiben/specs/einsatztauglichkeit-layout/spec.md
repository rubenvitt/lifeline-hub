## ADDED Requirements

### Requirement: Der Rahmen bleibt beim Rollen erreichbar

Ab `md` MUST die Kopfleiste beim Rollen am oberen Fensterrand stehen bleiben, ab `lg` auch die
Kategorie-Symbole der Rail. Unter `md` MUST die Kopfleiste mitrollen und die Betriebszeile oben
stehen bleiben, solange sie eine Verbindungsstörung meldet. Jedes oben klebende Element MUST
unter dem klebenden Rahmen stehen, nicht hinter ihm.

#### Scenario: Langes Rollen im ETB ab Tablet
- **WHEN** das ETB bei 820, 1180 und 1440 px Breite auf 1500 px gerollt ist
- **THEN** steht die Kopfleiste mit `position: sticky` bei `top ≥ 0` im Fenster, und ab 1180 px stehen die Kategorie-Symbole der Rail im Fenster

#### Scenario: Offline auf dem Handy
- **WHEN** das ETB bei 390 × 844 auf 1500 px gerollt ist und das Gerät das Netz verliert
- **THEN** steht die Betriebszeile mit dem Offline-Hinweis am oberen Fensterrand

#### Scenario: Tabellenkopf unter dem Rahmen
- **WHEN** eine Seite mit stehendem Tabellenkopf ab `md` so weit gerollt ist, dass der Tabellenkopf klebt
- **THEN** liegt seine Oberkante an der Unterkante der Kopfleiste, nicht darüber

### Requirement: Das Modulpanel lässt am Tablet quer Platz

Ohne eigene Wahl MUST das Modulpanel zwischen `lg` und `xl` zugeklappt und ab `xl` offen sein;
eine gemerkte Wahl MUST auf jeder Breite gelten. Das Panel MUST einen sichtbaren Griff mit
`aria-expanded` haben.

#### Scenario: Tablet quer ohne Wahl
- **WHEN** ein Einsatz bei 1180 px ohne gemerkte Wahl geöffnet wird
- **THEN** ist das Modulpanel zugeklappt, und der Griff „Menü“ steht mit `aria-expanded="false"` in der Rail

#### Scenario: Abschnittszeile bei offenem Panel
- **WHEN** der Überblick bei 1180 px mit offenem Modulpanel steht
- **THEN** beginnt der Stärkeblock jeder Abschnittszeile auf der Höhe des Abschnittsnamens

### Requirement: Benutzermenü: Abmelden ohne Rollen

Im Benutzermenü MUST „Profil“ und „Abmelden“ direkt nach dem Kopf stehen, vor den
Umschaltgruppen, und auf 390 × 844 und 1180 × 820 in jeder Dichtestufe ohne Rollen sichtbar und
anklickbar sein. Der Menükopf MUST die eigene Einsatzfunktion nennen, wenn es eine gibt, auf
jeder Breite.

#### Scenario: Schichtwechsel am Handy im Handschuh-Betrieb
- **WHEN** das Benutzermenü bei 390 × 844 in `handschuh` geöffnet wird
- **THEN** liegt „Abmelden“ ohne Rollen im Fenster, und ein Klick darauf meldet ab

#### Scenario: Funktion auf dem Tablet
- **WHEN** das Benutzermenü im Einsatz unter `xl` geöffnet wird und die Person eine Funktion hat
- **THEN** nennt der Menükopf die Funktion

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
- Rahmen: die klebende Kopfleiste gegenüber den Zielen von Seitenkopf und Inhalt; ein Fokus in
  der Kopfleiste selbst MUST die Seite nicht rollen.

#### Scenario: Tabben durch die Zeitachse des ETB
- **WHEN** der Fokus vom ersten Zeilenauslöser aus mit Tab durch 15 Einträge läuft, bei 390 × 600 und 1366 × 520
- **THEN** liegt kein Zeilenauslöser vollständig hinter der Erfassungsleiste, und zwischen seiner Unterkante und der Oberkante der Leiste bleibt ein Streifen frei

#### Scenario: Zeilenwechsel in der Gefahrenmatrix
- **WHEN** der Fokus mit Tab von der letzten Zelle einer Zeile zur ersten Zelle der nächsten wechselt und die Tabelle waagerecht überläuft
- **THEN** liegt die neue Zelle nicht vollständig hinter der Spalte „Gefahr“, und alle 58 Zellen werden im Durchlauf besucht

#### Scenario: Kartenknöpfe über dem Fuß
- **WHEN** auf der Lagekarte bei 390 × 844 und 1024 × 768 in `handschuh` die Zeitachse ausgeklappt ist
- **THEN** überschneiden sich Knopfblock und Fußbänder nicht, und jeder Kartenknopf lässt sich anklicken

#### Scenario: Rückwärts unter dem klebenden Kopf
- **WHEN** der Fokus auf einer gerollten Seite bei 1366 × 520 mit Shift+Tab von unten durch die Ziele des Inhalts läuft
- **THEN** liegt kein Ziel vollständig hinter der Kopfleiste

#### Scenario: Tab durch die Kopfleiste
- **WHEN** die Seite gerollt ist und der Fokus mit Tab durch die Ziele der Kopfleiste läuft
- **THEN** bleibt die Bildlaufposition unverändert
