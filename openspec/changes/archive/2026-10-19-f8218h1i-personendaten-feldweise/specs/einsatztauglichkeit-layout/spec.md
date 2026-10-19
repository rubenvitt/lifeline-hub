## MODIFIED Requirements

### Requirement: Das Personen-Detail beginnt mit dem Patientenkopf

Das Personen-Detail MUST in jeder Breite mit dem Patientenkopf beginnen (Sichtung, Zustand /
Verdacht, Aufenthalt bzw. Verbleib, letzte Notiz). Darunter folgen der Verlauf und die
Personendaten. Die zwei gleichrangigen Spalten aus medizinischen Angaben und Stammdaten entfallen.
Die Personendaten MUST jedes Etikett über seinem Wert zeigen, und leere Angaben MUST in einer
Zeile „Ohne Angabe“ zusammengefasst stehen statt als eigene Zeilen mit Strich. Mit Schreibrecht
MUST diese Zeile jede leere Angabe als Knopf „+ Etikett“ tragen, ohne Schreibrecht als Satz
„Ohne Angabe: …“.

#### Scenario: Handschirm und Tablet hoch
- **WHEN** das Detail einer Person bei 390 × 844 und bei 820 × 1180 geöffnet wird, als Admin und als Beobachter
- **THEN** liegt die Oberkante des Patientenkopfs über der Oberkante der Personendaten

#### Scenario: Leere Angaben
- **WHEN** eine Person ohne Geburtsdatum, Herkunft und Melder einem Beobachter angezeigt wird
- **THEN** stehen diese Etiketten in einer Zeile „Ohne Angabe: …“, und für sie gibt es kein eigenes Feld mit „—“

#### Scenario: Leere Angaben mit Schreibrecht
- **WHEN** dieselbe Person einem Admin angezeigt wird
- **THEN** stehen in derselben Zeile die Knöpfe „+ Geburtsdatum“, „+ Herkunft / Adresse“ und „+ Melder / Kontakt“, jeder mindestens so hoch wie die Steuerhöhe der Dichtestufe
