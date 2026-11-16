## MODIFIED Requirements

### Requirement: Inhalt des Großbilds im Lagebild

Das Großbild des Lagebilds SHALL zeigen: die Uhrzeit des Lagebilds und den Datenstand, die sechs
Kennzahlen der Reihe des Einsatzes, die Gefahrenmatrix verdichtet je Gefahrentyp (in der Reihe
„Sanitätsdienst“ statt dessen den Verlauf), die Sichtungsverteilung und den Stand (Lagebericht,
UHS aktiv). Aufträge und Meldungen MUST NOT im Großbild des Lagebilds stehen; ihre Heimat ist der
Überblick (`lage-alarmzeile`, Seitenrollen). Die jüngsten ETB-Einträge MUST NOT im Großbild
stehen. Töne der Kennzahlen (Alarm, Achtung) MUST dieselben sein wie auf der Seite.

#### Scenario: Vermisste Person

- **WHEN** eine Person als vermisst geführt wird
- **THEN** steht „Vermisste“ im Großbild in Alarmrolle wie auf der Seite

#### Scenario: Überfälliger Auftrag

- **WHEN** ein Auftrag überfällig ist
- **THEN** steht weder „Aufträge offen“ noch „Meldungen offen“ im Großbild des Lagebilds
