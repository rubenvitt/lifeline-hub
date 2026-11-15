## MODIFIED Requirements

### Requirement: Das Übungsband bleibt beim Rollen stehen

Das Band MUST in jeder Breite beim Rollen direkt unter der klebenden Kopfleiste stehen bleiben.
Es MUST unter anderen klebenden Teilen des Rahmens stehen, nicht hinter ihnen, und MUST klebende
Tabellenköpfe und Leisten nicht verdecken.

#### Scenario: Übung im ETB am Handy, gerollt

- **WHEN** das ETB einer Übung bei 390 × 844 auf 1500 px gerollt ist
- **THEN** steht das Band „ÜBUNG“ direkt unter der Kopfleiste im Bild

#### Scenario: Übung ab Tablet, gerollt

- **WHEN** eine Modulseite einer Übung bei 820, 1180 und 1440 px Breite auf 1500 px gerollt ist
- **THEN** steht das Band „ÜBUNG“ direkt unter der Kopfleiste im Bild

#### Scenario: Offline am Handy in der Übung

- **WHEN** das Gerät am Handy in einer Übung das Netz verliert und die Betriebszeile oben klebt
- **THEN** stehen Betriebszeile, Kopfleiste und Band in dieser Reihenfolge übereinander, keines verdeckt ein anderes

#### Scenario: Stehender Tabellenkopf

- **WHEN** eine Seite einer Übung mit stehendem Tabellenkopf so weit gerollt ist, dass der
  Tabellenkopf klebt
- **THEN** liegt seine Oberkante an der Unterkante des Bands
