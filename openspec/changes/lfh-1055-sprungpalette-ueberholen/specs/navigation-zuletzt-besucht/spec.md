## MODIFIED Requirements

### Requirement: Aufzeichnung nur an bewusst gewählten Zugängen

Das System SHALL ein Modul nur dann in „Zuletzt besucht" aufnehmen, wenn eine Person es über
einen der folgenden Zugänge gewählt hat: Modul-Panel, Modul-Akkordeon im Navigations-Drawer,
Sprungpalette (Gruppen „Module", „Zuletzt besucht" und Schnellaktionen), ein Ziel auf
Führung · Überblick oder ein Ziel im Lage-Dashboard. Ein Zugang zeichnet nur auf, wenn sein
Ziel in einem Modul des Einsatzes liegt. Die Aufnahme geschieht beim Klick bzw. bei der
Ausführung, nicht beim Anzeigen eines Ziels.

#### Scenario: Kennzahl auf dem Überblick

- **WHEN** eine Person auf Führung · Überblick die Kennzahl „Betroffene" anklickt
- **THEN** steht „Personen" danach als jüngster Eintrag in „Zuletzt besucht"

#### Scenario: Knopf auf dem Überblick

- **WHEN** eine Person auf Führung · Überblick den Kopfknopf „Eintrag" wählt
- **THEN** steht „ETB" danach als jüngster Eintrag in „Zuletzt besucht"

#### Scenario: Paneel-Link im Lage-Dashboard

- **WHEN** eine Person im Lage-Dashboard den Paneel-Link „Gefahren" wählt
- **THEN** steht das Gefahren-Modul danach als jüngster Eintrag in „Zuletzt besucht"

#### Scenario: Schnellaktion der Palette

- **WHEN** eine Person in der Sprungpalette die Schnellaktion „ETB-Eintrag schreiben" ausführt
- **THEN** steht „ETB" danach als jüngster Eintrag in „Zuletzt besucht"

#### Scenario: Ziel ohne Modul

- **WHEN** eine Person auf dem Überblick einem Verweis folgt, der nicht in ein Modul des
  Einsatzes führt (z. B. die Brotkrume „Einsätze")
- **THEN** bleibt „Zuletzt besucht" unverändert

#### Scenario: Anzeigen allein zeichnet nicht auf

- **WHEN** Führung · Überblick oder das Lage-Dashboard geladen wird, ohne dass etwas angeklickt
  wird
- **THEN** bleibt „Zuletzt besucht" unverändert
