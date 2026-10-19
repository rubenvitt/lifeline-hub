## MODIFIED Requirements

### Requirement: Datenkategorien mit eigener Frist

Das System SHALL genau drei Datenkategorien mit eigener Frist führen:
- `behandlung`: Zustand einer Person, Notizen zu Sichtung, Verlauf und UHS-Belegung, Lage und
  Notiz einer Verletzung, die benötigte Fachrichtung und die PAT-Nummer
- `personenauskunft`: Herkunftsadresse und Melderkontakt
- `anhaenge`: Datei-Anhänge samt ihrer Ablage als Dokument, an Schaden, Chat und ETB, und die
  Bild-Hintergründe der Lagekarte

Der Personenstamm folgt den Zwecken seiner Person. Alle übrigen Scrub-Daten MUST der Frist des
Einsatzes folgen. ETB, Registriernummer und Triage- und Statuskategorien MUST keiner Kategorie
angehören. Dazu zählen auch Region und Art einer Verletzung, die Maßnahme, Transportpriorität,
Transportart und Kontamination.

#### Scenario: Zuordnung ist vollständig
- **WHEN** die Testsuite die Klassifikation prüft
- **THEN** gehört jede Scrub-Spalte genau einer Kategorie, dem Personenstamm oder der Einsatz-Frist an
- **AND** gehört keine Retain-Spalte einer Kategorie an

#### Scenario: Neue Spalte ohne Zuordnung
- **WHEN** eine neue Scrub-Spalte keiner Zuordnung angehört
- **THEN** scheitern Build oder Testsuite und nennen Tabelle und Spalte

#### Scenario: Beschreibung nennt die Bilder der Lagekarte
- **WHEN** der Admin in den Org-Einstellungen den Bereich Aufbewahrung öffnet
- **THEN** nennt die Beschreibung der Kategorie Anhänge auch die Bilder der Lagekarte

#### Scenario: Schwärzung der Behandlung leert die PAT-Kern-Freitexte
- **WHEN** die Kategorie `behandlung` eines Einsatzes geschwärzt wird
- **THEN** sind PAT-Nummer, Fachrichtung sowie Lage und Notiz jeder Verletzung leer
- **AND** Region und Art der Verletzungen, die Maßnahmen, Priorität, Art des Transports und
  Kontamination bleiben erhalten

### Requirement: Personenstamm folgt den Zwecken der Person

Name, Vorname, Geschlecht, Geburtsdatum, geschätztes Alter, Fundort samt Koordinate,
Personennotiz und Verbleib (Ziel, Transportmittel, Notiz; die Art bleibt als Statuskategorie)
einer Person SHALL das System
erst schwärzen, wenn alle Zwecke dieser Person geschwärzt sind. Eine Person mit
Behandlungsbezug MUST die Zwecke `behandlung` und `personenauskunft` tragen, jede andere nur
`personenauskunft`. Behandlungsbezug MUST bestehen, sobald eine Sichtung, eine Verlaufsnotiz,
eine UHS-Belegung, ein Zustand, eine Verletzung, eine Maßnahme, ein Transportstand, eine
PAT-Nummer oder Kontamination „ja“ vorliegt, auch storniert oder aufgehoben. „Nicht kontaminiert“
MUST NOT als Behandlungsbezug zählen.

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

#### Scenario: Nur eine PAT-Nummer
- **WHEN** eine ungesichtete Person nur eine PAT-Nummer trägt und `personenauskunft` geschwärzt wird
- **THEN** behält sie ihren Namen, bis auch `behandlung` geschwärzt ist
