## ADDED Requirements

### Requirement: Das Sammelbanner einer Werkzeugzeile bleibt auf dem Handschirm bedienbar

Steht das Sammelbanner der Ablösung oder der Verpflegung, MUST es auf dem Handschirm in
allen drei Dichtestufen die Zahl der wartenden Einträge lesbar zeigen, und seine Aktion
„anzeigen“ MUST vollständig im Fenster liegen. Das Dokument MUST dabei nicht breiter als
das Fenster werden. Die vollständige Mitteilung MUST Hilfstechnik erreichen. Das Erscheinen
des Banners MUST weder die Höhe der Werkzeugzeile noch die Lage der obersten Karte ändern.

#### Scenario: Verpflegung im Handschuh-Betrieb
- **WHEN** die Verpflegung bei 390 × 844 in `handschuh` offen ist und eine andere Sitzung ein Zeitfenster anlegt
- **THEN** zeigt das Banner die Zahl 1 ungekürzt, die Aktion „anzeigen“ liegt mit ihrer rechten Kante innerhalb von 390 px, und das Dokument ist nicht breiter als 390 px

#### Scenario: Ablösung in jeder Dichtestufe
- **WHEN** die Ablösung bei 390 × 844 nacheinander in `kompakt`, `komfortabel` und `handschuh` offen ist und eine andere Sitzung eine Schicht beginnt
- **THEN** zeigt das Banner jeweils die Zahl ungekürzt, und die Aktion „anzeigen“ ist anklickbar und gibt die wartende Schicht frei

#### Scenario: Kein Sprung beim Eintreffen
- **WHEN** das Banner auf dem Handschirm erscheint
- **THEN** ändern sich die Höhe der Werkzeugzeile und die Oberkante der obersten Karte um höchstens 0,5 px

#### Scenario: Mitteilung für Hilfstechnik
- **WHEN** das Banner auf dem Handschirm nur verkürzt zu sehen ist
- **THEN** trägt sein Statusbereich trotzdem die vollständige Mitteilung, etwa „1 neues Zeitfenster, davon 1 mit Unterdeckung“

#### Scenario: Breite Schirme unverändert
- **WHEN** dieselbe Seite bei 1366 × 768 oder 1024 × 768 offen ist
- **THEN** steht der Bannertext wie bisher vollständig in der Werkzeugzeile neben der Segmentleiste
