# Spec Delta

## ADDED Requirements

### Requirement: Helfer des Plans bedienen
Der Schichtplan eines Einsatzes SHALL die Helfer des Plans in einer Liste zeigen, in der sie
sich anlegen, ändern und löschen lassen (Name, Telefon, Organisation, Qualifikationen), mit denselben
Regeln und Texten wie die Helferliste einer Planung (Spec `vorplanung`). Kennung und Herkunft eines
eingelesenen oder aus einer Planung übernommenen Helfers MUST sichtbar und nicht änderbar sein. Ohne
Freigabe des Moduls Personal MUST die Liste keine Namen zeigen und keine Änderung anbieten; ohne
Schreibrecht am Einsatz MUST sie nur lesen lassen. Eine Änderung MUST im Raster und in den
Personenlisten der Blöcke ohne Neuladen der Seite ankommen.

#### Scenario: Helfer im Einsatz anlegen
- **WHEN** jemand im Schichtplan eines Einsatzes den Helfer „Mia Beispiel, DRK OV Nord, Sanitäter“ anlegt
- **THEN** steht sie in der Helferliste und lässt sich sofort in einen Block einteilen

#### Scenario: Eingelesener Helfer
- **WHEN** ein Helfer aus einer Schichtplan-Datei mit Kennung und Herkunft übernommen wurde
- **THEN** zeigt die Liste Kennung und Herkunft und bietet für beide kein Eingabefeld

#### Scenario: Ohne Personal
- **WHEN** jemand ohne Freigabe des Moduls Personal den Schichtplan öffnet
- **THEN** zeigt die Helferliste keine Namen und keinen Knopf zum Anlegen
