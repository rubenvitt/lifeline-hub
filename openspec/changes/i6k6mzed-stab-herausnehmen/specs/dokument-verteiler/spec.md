# Spec Delta

## MODIFIED Requirements

### Requirement: Befehl und Lagebericht tragen einen optionalen Verteiler
Befehl und Lagebericht SHALL einen geordneten, anfangs leeren Verteiler tragen. Ein Eintrag ist
ein Einsatzabschnitt, eine Einheit, eine Führungsfunktion (Katalogcode mit Bezeichnung, wo
Pflicht, oder Freitext) oder eine externe Stelle (Kategorie `leitstelle`, `nachbar_ea`,
`uebergeordnet` oder `andere_bos` und Bezeichnung).

#### Scenario: Neuer Befehl
- **WHEN** jemand einen Befehl anlegt
- **THEN** liefert die Anzeige des Befehls einen leeren Verteiler

#### Scenario: Verschiedene Empfängerarten
- **WHEN** jemand den Verteiler eines Lageberichts auf „EA Süd“, „S3 Einsatz“ und die Leitstelle „ILS Musterstadt“ setzt
- **THEN** liefert die Anzeige diese drei Einträge in dieser Reihenfolge, jeden mit Art, Ziel und Anzeigenamen
