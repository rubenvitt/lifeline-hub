## MODIFIED Requirements

### Requirement: Zweite Darstellung des Funkplans

Die Fernmeldeskizze SHALL als zweite Darstellung der Funkplan-Seite erreichbar sein. Ein Umschalter
„Tabelle | Skizze | Sprechgruppen“ steht auf der Seite. Die Sichtvorgabe `?ansicht=skizze` öffnet die Skizze, danach
wird der Parameter aus der Adresse entfernt, ein unbrauchbarer Wert ebenso. Die Skizze MUST NOT als
eigenes Modul erscheinen. Sie MUST die Stab-Freigabe der Funkplan-Seite erben.

#### Scenario: Umschalten

- **WHEN** eine Person mit Leserecht auf den Stab den Funkplan öffnet und „Skizze“ wählt
- **THEN** zeigt die Seite die Fernmeldeskizze statt der Tabelle, und das Lücken-Paneel bleibt
  stehen

#### Scenario: Sichtvorgabe aus einem Link

- **WHEN** eine Person `/einsaetze/:id/stab/funkplan?ansicht=skizze` öffnet
- **THEN** steht die Darstellung auf „Skizze“, und `ansicht` ist aus der Adresse entfernt

#### Scenario: Unbrauchbarer Wert

- **WHEN** eine Person `?ansicht=quatsch` öffnet
- **THEN** bleibt die Darstellung „Tabelle“, und der Parameter ist aus der Adresse entfernt

#### Scenario: Stab gesperrt

- **WHEN** das Stab-Modul für die Person gesperrt ist und sie `?ansicht=skizze` öffnet
- **THEN** sieht sie weder Tabelle noch Skizze, sondern dieselbe Sperranzeige wie beim Funkplan
