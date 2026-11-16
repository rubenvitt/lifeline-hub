# Spec Delta

## ADDED Requirements

### Requirement: Die Hauptaktion einer Tabellenzeile bleibt im Bild

Die Aktion einer Tabellenzeile (Primäraktion, ⋮ oder beides) SHALL ohne waagerechtes Rollen der
Tabelle erreichbar sein, in jeder Dichtestufe. Ab `md` MUST die Aktionsspalte rechts fixiert
stehen, mit fester Breite je Stufe. Unter `md` MUST eine Tabelle, die nicht in Karten wechselt,
Primäraktion und ⋮ in der fixierten Kennungsspalte tragen, ohne eigene Aktionsspalte. Betroffen
sind Evakuierung, Betreuung, Material, Betroffene und Fahrzeuge.

#### Scenario: Evakuierung am Fükw
- **WHEN** die Evakuierungsbezirke bei 1440 × 900 in `kompakt` mit geöffnetem Modulpanel stehen und die Tabelle breiter ist als ihr Rahmen
- **THEN** liegen „Stand melden“ und das ⋮ jeder Zeile ganz innerhalb des Tabellenrahmens, ohne dass die Tabelle gerollt wurde

#### Scenario: Waagerecht gerollt
- **WHEN** die Materialliste bei 1024 × 768 in `handschuh` waagerecht bis zum Anfang gerollt ist
- **THEN** steht das ⋮ jeder Zeile weiter am rechten Rand des Rahmens, und Spalten, die darunter rollen, bleiben in ihrer Breite unverändert

#### Scenario: Handschirm ohne Karten
- **WHEN** die Evakuierungsbezirke bei 390 × 844 in `komfortabel` stehen
- **THEN** stehen „Stand melden“ und das ⋮ jeder Zeile in der fixierten Kennungsspalte, und die Seite selbst rollt nicht waagerecht

#### Scenario: Zeile nur mit Menü
- **WHEN** die Fahrzeugliste ab `md` als Tabelle steht und ihre Zeilen nur ein ⋮ tragen
- **THEN** steht das ⋮ in einer rechts fixierten Spalte von der Breite einer Steuerhöhe der Stufe zuzüglich Zellpolster

### Requirement: Bearbeiten in einer Tabellenzelle verschiebt die Tabelle nicht

Öffnet jemand in einer Tabellenzelle eine Einzelangabe zur Bearbeitung, SHALL die Eingabe samt
„Speichern“ und „Abbrechen“ an der Zelle schweben, nicht in ihr. Breite und Höhe jeder Spalte und
Zeile MUST unverändert bleiben. Fokusrückgabe, Escape-Reihenfolge, Prüfung und Ablehnung MUST wie
bei der Bearbeitung im Fluss gelten, und die Tabelle MUST ihre Zeilenfolge halten. Karten,
Ansichten und die mehrzeilige Bemerkung bearbeiten weiter im Fluss.

#### Scenario: Stift der Einheit in der Fahrzeugliste
- **WHEN** in der Fahrzeugliste bei 1440 × 900 in `kompakt` der Stift der Einheit eines Fahrzeugs gewählt wird
- **THEN** ändert sich keine Spaltenbreite um mehr als 1 px, die Zeile behält ihre Höhe, und „Details“ bleibt neben dem Funkrufnamen

#### Scenario: Handschuh am Tablet
- **WHEN** dasselbe bei 1024 × 768 in `handschuh` geschieht
- **THEN** ändert sich ebenso keine Spaltenbreite und keine Zeilenhöhe, und Eingabe und Knöpfe stehen vollständig im Fenster

#### Scenario: Escape schließt zuerst das Auswahlfeld
- **WHEN** in der schwebenden Bearbeitung die Auswahlliste der Einheit offen ist und Escape gedrückt wird
- **THEN** schließt nur die Auswahlliste; ein weiteres Escape verwirft die Bearbeitung, und der Fokus steht wieder auf dem Wert der Zelle

#### Scenario: Ablehnung
- **WHEN** der Server das Speichern ablehnt
- **THEN** bleibt die Bearbeitung mit dem Entwurf offen, und der Grund steht in ihr

#### Scenario: Karte am Handschirm
- **WHEN** die Fahrzeugliste bei 390 px als Karte steht und die Einheit bearbeitet wird
- **THEN** öffnet die Eingabe in der Karte selbst, wie bisher

### Requirement: Die Einheitenliste steht am Handschirm als Karten

Unter `md` SHALL die Einheitenliste ihre Gliederung als Karten zeigen, ab `md` als Tabelle. Jede
Karte MUST den Namen der Einheit mit Zeichen und Marken ungebrochen tragen (Umbruch nur zwischen
Wörtern oder an Silbengrenzen), dazu Ist und Soll mit dem Urteil der Stärke und den
Einheitsführer. Untereinheiten MUST unter ihrer Übereinheit eingerückt und in der Vorgabe
aufgeklappt stehen. Folge und kumulierte Stärken MUST denen der Tabelle gleichen.

#### Scenario: Fünf Einheiten am Handy
- **WHEN** die Einheitenliste mit fünf Einheiten bei 390 × 844 in `komfortabel` geöffnet wird
- **THEN** steht jede Einheit als Karte, kein Name ist innerhalb eines Worts gebrochen, und die Seite rollt nicht waagerecht

#### Scenario: Untereinheit
- **WHEN** die Gruppe „Staffel A“ dem Zug „Zug 1“ unterstellt ist
- **THEN** steht ihre Karte eingerückt unter der Karte von Zug 1, ohne dass etwas aufgeklappt werden musste

#### Scenario: Ab md Tabelle
- **WHEN** dieselbe Liste bei 1024 × 768 geöffnet wird
- **THEN** steht sie als Tabelle mit stehender Kopfzeile

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
- Tabellen mit rechts fixierter Aktionsspalte: vorwärts und rückwärts durch eine Zeile getabbt,
  MUST kein Ziel einer rollenden Spalte ganz hinter der Aktionsspalte liegen.
- Rahmen: die klebende Kopfleiste samt Übungsband und Alarmzone gegenüber den Zielen von
  Seitenkopf und Inhalt; ein Fokus in der Kopfleiste selbst MUST die Seite nicht rollen.

#### Scenario: Tabben durch die Zeitachse des ETB
- **WHEN** der Fokus vom ersten Zeilenauslöser aus mit Tab durch 15 Einträge läuft, bei 390 × 600 und 1366 × 520
- **THEN** liegt kein Zeilenauslöser vollständig hinter der Erfassungsleiste, und zwischen seiner Unterkante und der Oberkante der Leiste bleibt ein Streifen frei

#### Scenario: Zeilenwechsel in der Gefahrenmatrix
- **WHEN** der Fokus mit Tab von der letzten Zelle einer Zeile zur ersten Zelle der nächsten wechselt und die Tabelle waagerecht überläuft
- **THEN** liegt die neue Zelle nicht vollständig hinter der Spalte „Gefahr“, und alle 58 Zellen werden im Durchlauf besucht

#### Scenario: Erste Zeile rückwärts unter der stehenden Kopfzeile
- **WHEN** der Fokus in Benutzerliste, Personenliste (ab `md`) oder Einheitenliste (ab `md`) bei 1024 × 600 in `handschuh`, die Benutzerliste zusätzlich bei 390 × 400, mit Shift+Tab von der letzten Zeile in die erste läuft und die erste Zeile dabei unter der Kopfzeile liegt
- **THEN** steht jedes Ziel der ersten Zeile ganz unter der Kopfzeile, auch eines außerhalb der fixierten Spalte

#### Scenario: Durch eine Zeile neben der fixierten Aktionsspalte
- **WHEN** der Fokus in der Materialliste bei 1024 × 768 in `handschuh` mit Tab durch die Ziele einer Zeile läuft und die Tabelle waagerecht überläuft
- **THEN** liegt kein Ziel einer rollenden Spalte vollständig hinter der rechts fixierten Aktionsspalte

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
