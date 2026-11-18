## MODIFIED Requirements

### Requirement: Einstieg und eigene Adresse

Die Seite Einsatzdaten SHALL eine Aktion „Einsatzbericht – Druckansicht“ anbieten, die eine eigene
Druckansicht des Berichts öffnet. Die Druckansicht SHALL eine eigene, teilbare Adresse je
Einsatz haben und SHALL auch über die Sprungpalette erreichbar sein, dort unter demselben Namen.
Gedruckt wird über den Druckdialog des Browsers wie bei jedem Druckstück.

#### Scenario: Aus den Einsatzdaten öffnen

- **WHEN** eine Person auf der Seite Einsatzdaten „Einsatzbericht – Druckansicht“ wählt
- **THEN** öffnet sich die Druckansicht des Einsatzberichts dieses Einsatzes
- **AND** ein Neuladen der Adresse zeigt wieder den Bericht desselben Einsatzes

#### Scenario: Über die Sprungpalette

- **WHEN** eine Person in einem Einsatz die Sprungpalette öffnet und „Einsatzbericht“ sucht
- **THEN** führt der Eintrag „Einsatzbericht – Druckansicht“ zur Druckansicht des Einsatzberichts
