## MODIFIED Requirements

### Requirement: Datenkategorien mit eigener Frist

Das System SHALL genau drei Datenkategorien mit eigener Frist führen:
- `behandlung`: Zustand einer Person, Notizen zu Sichtung, Verlauf und UHS-Belegung
- `personenauskunft`: Herkunftsadresse und Melderkontakt
- `anhaenge`: Datei-Anhänge samt ihrer Ablage als Dokument, an Schaden, Chat und ETB, und die
  Bild-Hintergründe der Lagekarte

Der Personenstamm folgt den Zwecken seiner Person. Alle übrigen Scrub-Daten MUST der Frist des
Einsatzes folgen. ETB, Registriernummer und Triage- und Statuskategorien MUST keiner
Kategorie angehören.

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

### Requirement: Kategorie-Schwärzung

Das System SHALL eine vorgemerkte Kategorie frühestens 30 Tage nach ihrer Vormerkung schwärzen:
ihre Daten, den Personenstamm, soweit alle Zwecke der Person erledigt sind, Zeitstempel und
einen System-Eintrag im ETB in einem atomaren Vorgang. Der Eintrag MUST Kategorie und
Rechtsgrundlage nennen. Andere Daten MUST unverändert bleiben. Die Schwärzung MUST idempotent
und unumkehrbar sein und die physische Entfernung nach `aufbewahrung` einhalten.

#### Scenario: Anhänge nach Ablauf
- **WHEN** die Karenz von `anhaenge` abläuft und der Purge-Lauf läuft
- **THEN** sind alle Datei-Anhänge des Einsatzes samt Dokumentablage und alle Bilder seiner Lagekarte entfernt
- **AND** tragen Personen, Schäden, Meldungen und die übrigen Objekte der Lagekarte ihre Angaben unverändert
- **AND** nennt das ETB die Schwärzung der Anhänge mit Rechtsgrundlage

#### Scenario: Zweiter Lauf
- **WHEN** der Purge-Lauf eine bereits geschwärzte Kategorie erneut antrifft
- **THEN** ändert er nichts und schreibt keinen Eintrag

#### Scenario: Klartext ist physisch weg
- **WHEN** eine Kategorie mit einem eindeutigen Klartext in einer ihrer Spalten geschwärzt ist
- **THEN** kommt der Klartext weder in der Datenbankdatei noch im Write-Ahead-Log vor
