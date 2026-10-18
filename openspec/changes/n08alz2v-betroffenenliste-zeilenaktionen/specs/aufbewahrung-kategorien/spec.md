## MODIFIED Requirements

### Requirement: Personenstamm folgt den Zwecken der Person

Name, Vorname, Geschlecht, Geburtsdatum, geschätztes Alter, Fundort samt Koordinate,
Personennotiz und Verbleib (Ziel, Transportmittel, Notiz; die Art bleibt als Statuskategorie)
einer Person SHALL das System
erst schwärzen, wenn alle Zwecke dieser Person geschwärzt sind. Eine Person mit
Behandlungsbezug MUST die Zwecke `behandlung` und `personenauskunft` tragen, jede andere nur
`personenauskunft`. Behandlungsbezug MUST bestehen, sobald eine Sichtung, eine Verlaufsnotiz,
eine UHS-Belegung oder ein Zustand vorliegt, auch storniert.

#### Scenario: Nur registriert
- **WHEN** die Kategorie `personenauskunft` eines Einsatzes geschwärzt wird und eine Person keinen Behandlungsbezug hat
- **THEN** sind Name, Geburtsdatum, Adresse, Kontakt und Verbleib dieser Person geschwärzt

#### Scenario: Behandelt, Auskunft abgelaufen
- **WHEN** die Kategorie `personenauskunft` geschwärzt wird und eine gesichtete Person in `behandlung` noch nicht geschwärzt ist
- **THEN** sind Herkunftsadresse und Melderkontakt dieser Person geschwärzt
- **AND** tragen Name, Geburtsdatum, Verbleib, Zustand und Sichtungsnotiz weiter ihren Wert

#### Scenario: Beide Zwecke abgelaufen
- **WHEN** danach auch `behandlung` geschwärzt wird
- **THEN** ist auch der Personenstamm der gesichteten Person geschwärzt
