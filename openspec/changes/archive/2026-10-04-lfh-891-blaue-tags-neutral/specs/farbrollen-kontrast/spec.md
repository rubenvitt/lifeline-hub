# Spec Delta

## ADDED Requirements

### Requirement: Beschriftung einer Marke hält den Textboden

Die Beschriftung einer Marke, die auf einer eigenen deckenden Fläche steht (etwa „ad-hoc“ an
einer Kraft), SHALL gegen diese Fläche im Tagmodus mindestens 7 : 1 und im Nachtmodus
mindestens 5 : 1 halten. Kein Kontrastnachweis MUST eine solche Beschriftung unter einer
Ausnahme mit niedrigerer Schranke führen.

#### Scenario: Marke „ad-hoc“ am Tag
- **WHEN** im Tagmodus die Personalliste eines Einsatzes eine Ad-hoc-Kraft mit der Marke
  „ad-hoc“ zeigt
- **THEN** misst die Beschriftung der Marke gegen deren Fläche mindestens 7 : 1

#### Scenario: Marke „ad-hoc“ in der Nacht
- **WHEN** im Nachtmodus die Fahrzeugliste eines Einsatzes ein Ad-hoc-Fahrzeug mit der Marke
  „ad-hoc“ zeigt
- **THEN** misst die Beschriftung der Marke gegen deren Fläche mindestens 5 : 1

### Requirement: Eine Marke trägt nicht die Bedienfarbe

Eine Marke, die nichts bedient, MUST NOT in der Bedienfarbe Blau getönt sein. Eine Kennzeichnung
ohne Statusbedeutung (Herkunft, Rolle, Kennung) SHALL neutral erscheinen; ihr Wort trägt die
Bedeutung. Status-Marken bleiben davon unberührt und folgen den Statusrollen.

#### Scenario: Kennzeichnung einer Ad-hoc-Kraft
- **WHEN** eine Liste der Kräfte eine Ad-hoc-Kraft, ein Ad-hoc-Fahrzeug oder ein Ad-hoc-Material
  kennzeichnet
- **THEN** erscheint die Marke „ad-hoc“ neutral und nicht blau

#### Scenario: Rolle im Benutzermenü
- **WHEN** eine Führungskraft das Benutzermenü öffnet
- **THEN** erscheint die Marke „Führungskraft“ neutral und nicht blau

#### Scenario: Neue blaue Marke im Code
- **WHEN** eine Änderung eine Marke mit der Preset-Farbe Blau einführt
- **THEN** schlägt die Qualitätsprüfung fehl und nennt die Stelle
