# Spec Delta

## ADDED Requirements

### Requirement: Wert neben der Bezeichnung

Jede Zeile der Vorbereitung SHALL ihren Wert direkt neben der Bezeichnung zeigen, linksbündig in
einer Spalte, die unabhängig von der Breite der Seite an derselben Stelle beginnt. Der Wert MUST
NOT an den anderen Rand der Paneelbreite rücken. Notiz und Quellenangabe MUST unter Wert bzw.
Bezeichnung stehen. Auf schmalen Schirmen MUST die Zeile umbrechen statt über den Rand zu laufen.

#### Scenario: Full HD

- **WHEN** die Seite Lagebesprechung bei 1920 × 1080 die Zeile „Betroffene“ zeigt
- **THEN** beginnt der Wert höchstens 400 px rechts vom Anfang der Bezeichnung

#### Scenario: Handy

- **WHEN** die Seite auf einem Schirm von 390 px Breite die Zeile „Sichtung“ zeigt
- **THEN** bricht der Wert um, und nichts ragt über den Rand des Paneels
