# Spec Delta

## ADDED Requirements

### Requirement: Freitexte einer Einheit sind begrenzt
Die Bemerkung einer Einheit MUST höchstens 2 000 Zeichen, ihr Funkrufname und ihre Erreichbarkeit
MUST höchstens 200 Zeichen lang sein, jeweils nach dem Trimmen, beim Bilden und beim Ändern. Ein
längerer Wert MUST mit 400 abgelehnt werden, bevor etwas geschrieben wird. Die Einheit-Ansicht
MUST für jedes dieser Felder dieselbe Grenze kennen und einen längeren Wert nicht senden.

#### Scenario: Zu lange Bemerkung beim Bilden
- **WHEN** eine Einheit mit einer Bemerkung aus 2 001 Zeichen gebildet werden soll
- **THEN** antwortet der Server mit 400, und weder Einheit noch ETB-Eintrag entstehen

#### Scenario: Zu langer Funkrufname beim Ändern
- **WHEN** der Funkrufname einer Einheit auf 201 Zeichen geändert werden soll
- **THEN** antwortet der Server mit 400, und der Funkrufname bleibt

#### Scenario: Zu lange Erreichbarkeit beim Ändern
- **WHEN** die Erreichbarkeit einer Einheit auf 201 Zeichen geändert werden soll
- **THEN** antwortet der Server mit 400, und die Erreichbarkeit bleibt

#### Scenario: Genau an der Grenze
- **WHEN** Funkrufname und Erreichbarkeit je 200 Zeichen und die Bemerkung 2 000 Zeichen lang sind
- **THEN** speichert der Server alle drei Werte

#### Scenario: Maske hält die Grenze
- **WHEN** jemand in der Einheit-Ansicht eine Bemerkung über 2 000 Zeichen eingibt
- **THEN** nennt das Feld die Überlänge, kürzt nicht und sendet nichts
