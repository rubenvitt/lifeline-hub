## ADDED Requirements

### Requirement: Das Sammelbanner einer Werkzeugzeile bleibt auf dem Handschirm bedienbar

Steht das Sammelbanner der Ablösung oder der Verpflegung, MUST es auf dem Handschirm in allen
drei Dichtestufen ungekürzt zeigen, wie viele Einträge warten (oder dass nur die Reihenfolge
wartet). Seine Freigabe MUST vollständig im Fenster liegen, und das Dokument MUST nicht breiter
als das Fenster werden. Die vollständige Mitteilung MUST Hilfstechnik erreichen. Das Banner
MUST weder die Höhe der Werkzeugzeile noch die Lage der obersten Karte ändern.

#### Scenario: Verpflegung im Handschuh-Betrieb
- **WHEN** die Verpflegung bei 390 × 844 in `handschuh` offen ist und eine andere Sitzung ein Zeitfenster anlegt
- **THEN** zeigt das Banner „1 neu“ ungekürzt, der Knopf mit „anzeigen“ im Namen liegt mit seiner rechten Kante innerhalb von 390 px, und das Dokument ist nicht breiter als 390 px

#### Scenario: Ablösung in jeder Dichtestufe
- **WHEN** die Ablösung bei 390 × 844 nacheinander in `kompakt`, `komfortabel` und `handschuh` offen ist und eine andere Sitzung eine Schicht beginnt
- **THEN** zeigt das Banner jeweils „1 neu“ ungekürzt, und ein Klick auf den Knopf „anzeigen“ gibt die wartende Schicht frei

#### Scenario: Nur die Reihenfolge wartet
- **WHEN** auf dem Handschirm keine neue Schicht wartet, aber eine fremde Änderung die Reihenfolge umgestellt hat
- **THEN** zeigt das Banner „umgeordnet“ ungekürzt statt einer Zahl

#### Scenario: Kein Sprung beim Eintreffen
- **WHEN** das Banner auf dem Handschirm erscheint
- **THEN** ändern sich die Höhe der Werkzeugzeile und die Oberkante der obersten Karte um höchstens 0,5 px

#### Scenario: Mitteilung für Hilfstechnik
- **WHEN** das Banner auf dem Handschirm in der Kurzform steht
- **THEN** trägt sein Statusbereich die vollständige Mitteilung, etwa „1 neues Zeitfenster, davon 1 mit Unterdeckung“, und der Name des Knopfes enthält „1 neu“ und „anzeigen“

#### Scenario: Breite Schirme unverändert
- **WHEN** dieselbe Seite bei 1366 × 768 oder 1024 × 768 offen ist
- **THEN** steht der volle Satz wie bisher in der Werkzeugzeile neben der Segmentleiste, rechts die Aktion „anzeigen“
