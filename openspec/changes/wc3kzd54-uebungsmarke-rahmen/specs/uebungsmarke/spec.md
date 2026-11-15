# Spec Delta

## Purpose

Eine Übung muss auf jeder Fläche, die einen Einsatz zeigt, ohne Lesen des Namens von einem
Realeinsatz zu unterscheiden sein. Diese Fähigkeit legt fest, woran man sie erkennt und wo.

## ADDED Requirements

### Requirement: Die Übung leitet sich allein aus der Einsatzart ab

Das System SHALL einen Einsatz genau dann als Übung kennzeichnen, wenn seine Einsatzart „Übung“
ist. Name, Stichwort oder Vorlage SHALL dabei keine Rolle spielen. Jede Kennzeichnung SHALL das
Wort „ÜBUNG“ tragen, die Farbe allein MUST NOT die Übung anzeigen. Die Farbe der Kennzeichnung
MUST keiner anderen Bedeutung zugeordnet sein.

#### Scenario: Übung mit neutralem Namen

- **WHEN** ein Einsatz „Starkregen Nord“ die Einsatzart „Übung“ hat
- **THEN** trägt er überall die Kennzeichnung „ÜBUNG“

#### Scenario: Realeinsatz mit „Übung“ im Namen

- **WHEN** ein Einsatz „Übungsgelände Brand“ die Einsatzart „Realeinsatz“ hat
- **THEN** trägt er nirgends die Kennzeichnung „ÜBUNG“

#### Scenario: Sanitätsdienst und Bereitstellung

- **WHEN** ein Einsatz die Einsatzart „Sanitätsdienst“ oder „Bereitstellung“ hat
- **THEN** trägt er keine Kennzeichnung „ÜBUNG“

### Requirement: Band im Einsatzrahmen

Bei einer Übung SHALL der Einsatzrahmen in jedem Modul, jeder Dichte und jeder Breite direkt unter
der Kopfleiste ein Band über die volle Breite mit dem Wort „ÜBUNG“ zeigen. Bei einem Realeinsatz
SHALL kein Band und kein Platzhalter dafür stehen.

#### Scenario: Realeinsatz

- **WHEN** ein Realeinsatz geöffnet ist
- **THEN** steht kein Band „ÜBUNG“ im Rahmen

### Requirement: Das Übungsband bleibt beim Rollen stehen

Das Band MUST beim Rollen am oberen Fensterrand stehen bleiben, unter `md` auch dann, wenn die
Kopfleiste mitrollt. Es MUST unter anderen klebenden Teilen des Rahmens stehen, nicht hinter
ihnen, und MUST klebende Tabellenköpfe und Leisten nicht verdecken.

#### Scenario: Übung im ETB am Handy, gerollt

- **WHEN** das ETB einer Übung bei 390 × 844 auf 1500 px gerollt ist
- **THEN** steht das Band „ÜBUNG“ am oberen Fensterrand im Bild

#### Scenario: Übung ab Tablet, gerollt

- **WHEN** eine Modulseite einer Übung bei 820, 1180 und 1440 px Breite auf 1500 px gerollt ist
- **THEN** steht das Band „ÜBUNG“ direkt unter der Kopfleiste im Bild

#### Scenario: Offline am Handy in der Übung

- **WHEN** das Gerät am Handy in einer Übung das Netz verliert und die Betriebszeile oben klebt
- **THEN** stehen Betriebszeile und Band übereinander, keines verdeckt das andere

#### Scenario: Stehender Tabellenkopf

- **WHEN** eine Seite einer Übung mit stehendem Tabellenkopf so weit gerollt ist, dass der
  Tabellenkopf klebt
- **THEN** liegt seine Oberkante an der Unterkante des Bands

### Requirement: Marke vor dem Einsatznamen im Kopf

Ab `md` SHALL die Kopfleiste einer Übung vor dem Einsatznamen eine Marke „ÜBUNG“ zeigen. Solange
der Einsatz lädt, SHALL keine Marke stehen.

#### Scenario: Kopf ab Tablet

- **WHEN** eine Übung bei 1180 px Breite geöffnet ist
- **THEN** steht im Kopf vor dem Einsatznamen die Marke „ÜBUNG“

### Requirement: Einsatzliste und Einsatzwechsler heben Übungen ab

Die Einsatzliste SHALL an der Kachel einer Übung die Marke „ÜBUNG“ statt des neutralen
Einsatzart-Tags zeigen. Andere Einsatzarten SHALL weiter den neutralen Tag tragen. Der
Einsatzwechsler SHALL jede Übung in seiner Liste mit der Marke „ÜBUNG“ zeigen.

#### Scenario: Liste mit Übung und Realeinsatz

- **WHEN** die Einsatzliste eine Übung und einen Realeinsatz zeigt
- **THEN** trägt nur die Kachel der Übung die Marke „ÜBUNG“
- **AND** die Kachel des Realeinsatzes trägt den neutralen Tag „Realeinsatz“

#### Scenario: Wechsler

- **WHEN** eine Person den Einsatzwechsler öffnet und darin eine Übung steht
- **THEN** trägt deren Eintrag die Marke „ÜBUNG“

### Requirement: Gekoppeltes Gerät und Lagemonitor

Ein gekoppeltes Gerät, das einer Übung zugeordnet ist, SHALL in jeder Funktionsansicht direkt unter
dem Gerätekopf das Band „ÜBUNG“ zeigen. Der Lagemonitor SHALL die Marke „ÜBUNG“ in seiner
Statusleiste zeigen, in mindestens 28 px Schrift, ohne die Kachelung zu verkleinern und ohne
Bildlauf bei 1920 × 1080. Die Kennzeichnung MUST still sein: kein Ton, kein Blinken.

#### Scenario: Gerät einer Übung

- **WHEN** ein gekoppeltes Gerät einer Übung seine Funktionsansicht zeigt
- **THEN** steht unter dem Gerätekopf das Band „ÜBUNG“

#### Scenario: Lagemonitor einer Übung

- **WHEN** der Lagemonitor einer Übung bei 1920 × 1080 läuft
- **THEN** steht in der Statusleiste „ÜBUNG“ in mindestens 28 px
- **AND** die Seite hat keinen Bildlauf
