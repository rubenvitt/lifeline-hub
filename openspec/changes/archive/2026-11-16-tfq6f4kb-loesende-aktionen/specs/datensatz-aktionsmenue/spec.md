# Spec Delta

## MODIFIED Requirements

### Requirement: Unumkehrbares steht rot hinter einem Trenner

Das Menü SHALL zuerst die umkehrbaren Aktionen in Lieferreihenfolge zeigen. Unumkehrbare Aktionen
MUST rot und, wenn davor umkehrbare stehen, hinter genau einem Trenner folgen. Eine entfernende
Aktion mit Rückgängig-Hinweis (Lösen, Entlassen, Austragen) MUST neutral unter den umkehrbaren
stehen. Eine Aktion, die gerade nicht möglich ist, SHALL im Menü deaktiviert stehen, wenn ihr
Fehlen die Bedienung verwirren würde.

#### Scenario: Pegel mit Prognose
- **WHEN** das Menü eines Pegels mit Prognose geöffnet wird
- **THEN** stehen „Nach oben“, „Nach unten“, „Prognose ändern …“, dann ein Trenner, dann rot „Prognose löschen“ und „Entfernen“

#### Scenario: Erster Pegel
- **WHEN** das Menü des obersten Pegels geöffnet wird
- **THEN** steht „Nach oben“ deaktiviert im Menü

#### Scenario: Person in der Einheit
- **WHEN** das Menü einer Person der Einheit geöffnet wird, die auf einem Fahrzeug sitzt
- **THEN** stehen „Vom Fahrzeug lösen“ und „Aus Einheit lösen“ neutral, ohne Trenner davor
