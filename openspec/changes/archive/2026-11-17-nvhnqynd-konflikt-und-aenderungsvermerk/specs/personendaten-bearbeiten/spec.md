# Spec Delta

## MODIFIED Requirements

### Requirement: Konflikt je Feld fragt nach

Beim Speichern eines Feldes SHALL die Oberfläche den Wert mitsenden, den das Feld beim Öffnen
hatte. Hat jemand anderes genau dieses Feld inzwischen geändert, MUST der Server mit 409
antworten und nichts schreiben. Die Oberfläche MUST dann „Zwischenzeitlich geändert“ fragen,
den aktuellen Wert nennen und „Meine Änderung übernehmen“ sowie „Verwerfen und neu laden“
anbieten (einheitlicher Dialog, Spec `formularseiten`). Eine Änderung an einem anderen Feld, eine
Sichtung, ein Statuswechsel oder eine Änderung von PAT-Nummer oder Kontamination MUST NOT einen
Konflikt auslösen. Ein PATCH ohne mitgesendeten Altwert MUST wie bisher ohne Feldvergleich
schreiben.

#### Scenario: Zwei ändern denselben Namen
- **WHEN** A das Feld Name öffnet, B inzwischen „Meier“ speichert und A „Müller“ speichert
- **THEN** antwortet der Server mit 409, der Name bleibt „Meier“, und A sieht die Rückfrage mit „Meier“ sowie den Knöpfen „Meine Änderung übernehmen“ und „Verwerfen und neu laden“

#### Scenario: Sichtung dazwischen
- **WHEN** A das Feld Name öffnet, die UHS inzwischen nachsichtet und A speichert
- **THEN** wird der Name gespeichert, ohne Rückfrage
