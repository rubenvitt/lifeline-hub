## MODIFIED Requirements

### Requirement: Neue Person der Sichtungskategorie I

Wird eine Person neu mit Sichtungskategorie I erfasst oder auf sie hochgestuft, SHALL jeder mit dem
Modul Personen einen Hinweis erhalten. Eine nachgereichte ältere Sichtung, die nicht zur aktuellen
wird, und die zweite Übertragung eines schon gespeicherten Eintrags MUST keinen Hinweis auslösen.

#### Scenario: Hochstufung
- **WHEN** eine Person von Sichtungskategorie II auf I hochgestuft wird
- **THEN** erhalten alle mit dem Modul Personen einen Hinweis „Sichtung I“

#### Scenario: Ältere Sichtung I kommt nach
- **WHEN** eine offline vorgemerkte SK I ankommt, die älter ist als die aktuelle SK II der Person
- **THEN** entsteht kein Hinweis „Sichtung I“
