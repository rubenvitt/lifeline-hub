## MODIFIED Requirements

### Requirement: Einstieg in den ETB-Druck

Das Einsatztagebuch SHALL eine Aktion „Druckansicht“ im Seitenkopf anbieten, die eine eigene
Druckansicht öffnet. Die Druckansicht SHALL eine eigene, teilbare Adresse haben, die den
Filter des Tagebuchs trägt. Die Aktion SHALL den gerade aktiven Filter (Suchbegriff, Typ,
Zeitraum, betroffene Einheit) unverändert mitnehmen.

#### Scenario: Aus dem gefilterten ETB drucken

- **WHEN** eine Person im ETB nach Typ „Meldung“ und einem Zeitraum filtert und
  „Druckansicht“ wählt
- **THEN** öffnet sich die Druckansicht mit genau diesem Filter
- **AND** ein Neuladen der Druckansicht behält den Filter

#### Scenario: Unbrauchbarer Filter in der Adresse

- **WHEN** die Adresse der Druckansicht einen unbekannten Typ trägt
- **THEN** wird dieser Filterwert verworfen und nicht als Auswahl im Kopf genannt

### Requirement: Ausschluss der Systemeinträge reist mit

Blendet die Zeitachse die Systemeinträge aus (ihre Vorgabe), SHALL „Druckansicht“ den
Ausschluss ausdrücklich an die Druckansicht übergeben, und die Druckansicht SHALL dann ohne
Systemeinträge drucken und im Kopf „ohne Systemeinträge“ nennen. Ohne dieses Merkmal MUST die
Druckansicht das vollständige Tagebuch samt Systemeinträgen drucken: der Ausschluss der Seite gilt
nicht stillschweigend für eine Druckadresse.

#### Scenario: Druck aus der Vorgabe der Seite

- **WHEN** die Zeitachse die Systemeinträge ausblendet und die Person „Druckansicht“ wählt
- **THEN** fehlen die Systemeinträge im Druck, und der Kopf nennt „ohne Systemeinträge“

#### Scenario: Druck mit eingeblendeten Systemeinträgen

- **WHEN** die Zeitachse die Systemeinträge zeigt und die Person „Druckansicht“ wählt
- **THEN** druckt die Druckansicht die Systemeinträge mit

#### Scenario: Druckadresse ohne Auswahl

- **WHEN** die Druckansicht ohne Auswahl geöffnet wird, etwa über einen gespeicherten Link
- **THEN** druckt sie das vollständige Tagebuch samt Systemeinträgen und nennt „vollständiges
  Tagebuch“
