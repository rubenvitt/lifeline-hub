# Spec Delta

## REMOVED Requirements

### Requirement: Befehl und Lagebericht tragen einen optionalen Verteiler
**Reason**: Das Modul Stab samt Presse und Medienarbeit (S5) entfällt (LLH-722, Entscheidung 08.11.2026; design.md D1). Die Pressemitteilung ist keine Dokumentart mehr; die Regel „keinen Verteiler“ und das Szenario „Pressemitteilung ohne Verteiler“ haben keinen Gegenstand, und OpenSpec erlaubt nicht, das Szenario in einem MODIFIED-Block wegzulassen.
**Migration**: Der Verteiler von Befehl und Lagebericht gilt unverändert unter „Befehl und Lagebericht tragen einen geordneten Verteiler aus vier Empfängerarten“.

## ADDED Requirements

### Requirement: Befehl und Lagebericht tragen einen geordneten Verteiler aus vier Empfängerarten

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
