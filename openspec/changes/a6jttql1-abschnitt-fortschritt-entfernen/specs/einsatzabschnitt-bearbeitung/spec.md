# Spec Delta

## ADDED Requirements

### Requirement: Ein Abschnitt trägt keinen Fortschritt
Ein Einsatzabschnitt MUST keinen Fortschritt tragen. Die Oberfläche MUST keinen Fortschritt
zeigen oder erfragen, weder beim Anlegen noch im Detail, in der Abschnittsvorschau der
Sprungpalette, in der Funktionsansicht Einsatzabschnitt oder im Führungsüberblick. Der Server
MUST keinen Fortschritt speichern oder ausliefern. Schickt ein Client noch ein Feld
`fortschritt`, MUST der Server den Wert verwerfen, ohne die übrigen Angaben abzulehnen.

#### Scenario: Abschnitt ohne Fortschritt
- **WHEN** ein Abschnitt geladen wird
- **THEN** enthält die Antwort kein Feld `fortschritt`
- **AND** zeigen weder Detail noch Führungsüberblick eine Prozentzahl oder einen
  Fortschrittsbalken

#### Scenario: Bearbeiten sendet keinen Fortschritt
- **WHEN** an einem Abschnitt die Bemerkung gespeichert wird
- **THEN** enthält die gesendete Änderung kein Feld `fortschritt`

#### Scenario: Veralteter Client schickt noch einen Fortschritt
- **WHEN** ein Client einen Abschnitt mit Name „Nord“ und `fortschritt` 72 anlegt
- **THEN** legt der Server den Abschnitt „Nord“ an
- **AND** enthält die Antwort kein Feld `fortschritt`

## REMOVED Requirements

### Requirement: Fortschritt erscheint nicht
**Reason**: Der Fortschritt hatte seit LFH-1208 nur noch gespeicherte Altwerte und keine
Oberfläche. Mit LLH-1170 fällt die Spalte samt Altwerten; das Erhalten eines Altwerts, das dieses
Requirement verlangte, entfällt damit.
**Migration**: Ersetzt durch „Ein Abschnitt trägt keinen Fortschritt“. Gespeicherte Werte gehen
mit der Migration verloren; eine Sicherung gibt es nicht (`design.md`, D2).
