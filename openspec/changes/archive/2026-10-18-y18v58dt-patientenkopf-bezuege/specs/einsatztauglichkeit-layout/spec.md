## RENAMED Requirements

- FROM: `### Requirement: Das Personen-Detail stellt die medizinische Spalte vor die Stammdaten`
- TO: `### Requirement: Das Personen-Detail beginnt mit dem Patientenkopf`

## MODIFIED Requirements

### Requirement: Das Personen-Detail beginnt mit dem Patientenkopf

Das Personen-Detail MUST in jeder Breite mit dem Patientenkopf beginnen (Sichtung, Zustand /
Verdacht, Aufenthalt bzw. Verbleib, letzte Notiz). Darunter folgen der Verlauf und die
Personendaten. Die zwei gleichrangigen Spalten aus medizinischen Angaben und Stammdaten entfallen.
Die Personendaten MUST jedes Etikett über seinem Wert zeigen, und leere Angaben MUST in einer
Zeile „Ohne Angabe: …“ zusammengefasst stehen statt als eigene Zeilen mit Strich.

#### Scenario: Handschirm und Tablet hoch
- **WHEN** das Detail einer Person bei 390 × 844 und bei 820 × 1180 geöffnet wird, als Admin und als Beobachter
- **THEN** liegt die Oberkante des Patientenkopfs über der Oberkante der Personendaten

#### Scenario: Leere Angaben
- **WHEN** eine Person ohne Geburtsdatum, Herkunft und Melder angezeigt wird
- **THEN** stehen diese Etiketten in einer Zeile „Ohne Angabe: …“, und für sie gibt es kein eigenes Feld mit „—“
