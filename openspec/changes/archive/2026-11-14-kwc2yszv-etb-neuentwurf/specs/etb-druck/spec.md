## ADDED Requirements

### Requirement: Ausschluss der Systemeinträge reist mit

Blendet die Zeitachse die Systemeinträge aus (ihre Vorgabe), SHALL „Drucken / als PDF“ den
Ausschluss ausdrücklich an die Druckansicht übergeben, und die Druckansicht SHALL dann ohne
Systemeinträge drucken und im Kopf „ohne Systemeinträge“ nennen. Ohne dieses Merkmal MUST die
Druckansicht das vollständige Tagebuch samt Systemeinträgen drucken: der Ausschluss der Seite gilt
nicht stillschweigend für eine Druckadresse.

#### Scenario: Druck aus der Vorgabe der Seite

- **WHEN** die Zeitachse die Systemeinträge ausblendet und die Person „Drucken / als PDF“ wählt
- **THEN** fehlen die Systemeinträge im Druck, und der Kopf nennt „ohne Systemeinträge“

#### Scenario: Druck mit eingeblendeten Systemeinträgen

- **WHEN** die Zeitachse die Systemeinträge zeigt und die Person „Drucken / als PDF“ wählt
- **THEN** druckt die Druckansicht die Systemeinträge mit

#### Scenario: Druckadresse ohne Auswahl

- **WHEN** die Druckansicht ohne Auswahl geöffnet wird, etwa über einen gespeicherten Link
- **THEN** druckt sie das vollständige Tagebuch samt Systemeinträgen und nennt „vollständiges
  Tagebuch“
