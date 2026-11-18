## MODIFIED Requirements

### Requirement: Inhalt des Großbilds im Lagebild

Das Großbild des Lagebilds SHALL zeigen: die Uhr in der Form der Uhr im Kopf und den Datenstand mit Alter (Spec
`zeitdarstellung`), die sechs
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

#### Scenario: Uhr und Stand im Großbild

- **WHEN** das Großbild des Lagebilds um 17:33 in taktischer Darstellung läuft und der letzte Stand von 17:31 stammt
- **THEN** steht dort die Uhr „1733“ und „Stand 1731 · vor 2 min“

