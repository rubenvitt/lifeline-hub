## MODIFIED Requirements

### Requirement: Zeit in Texten in der Anzeigezone
Uhrzeiten, die die Oberfläche in Texte setzt (Titelvorschlag eines Lageberichts, Stand-Zeit eines
Vorschlags, Uhrzeit eines Alarm-Hinweises, Ereigniszeit im Feld Zeit der ETB-Erfassung), SHALL in
der Anzeigezone stehen.

#### Scenario: Titelvorschlag
- **WHEN** Browser UTC, Anzeigezone Europe/Berlin, es ist 10:00 UTC, und ein neuer Lagebericht wird angelegt
- **THEN** nennt der Titelvorschlag 1200

#### Scenario: Wiederhergestellter Entwurf
- **WHEN** ein ETB-Entwurf mit der Ereigniszeit 2026-07-14 10:00 UTC wiederhergestellt wird und die Anzeigezone Europe/Berlin ist
- **THEN** zeigt das Feld Zeit der Erfassung 1200, nicht 1000
