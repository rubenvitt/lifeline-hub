# Spec Delta

## Purpose

Einzelne Kategorien personenbezogener Daten eines Einsatzes bekommen eine eigene
Aufbewahrungsfrist, die die Organisation mit Rechtsgrundlage festlegt. So verschwinden etwa
die Daten der Personenauskunft früher als die Behandlungsdokumentation, ohne den übrigen
Einsatz zu sperren.

## ADDED Requirements

### Requirement: Datenkategorien mit eigener Frist

Das System SHALL genau drei Datenkategorien mit eigener Frist führen:
- `behandlung`: Zustand einer Person, Notizen zu Sichtung, Verlauf und UHS-Belegung
- `personenauskunft`: Herkunftsadresse und Melderkontakt
- `anhaenge`: Datei-Anhänge samt ihrer Ablage als Dokument, an Schaden, Chat und ETB

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

### Requirement: Personenstamm folgt den Zwecken der Person

Name, Vorname, Geschlecht, Geburtsdatum, geschätztes Alter, Antreffort samt Koordinate,
Personennotiz und Verbleib (Art, Ziel, Transportmittel, Notiz) einer Person SHALL das System
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

### Requirement: Dauer und Rechtsgrundlage je Organisation

Der System-Admin SHALL je Kategorie für seine Organisation eine Dauer in Tagen und eine
Rechtsgrundlage festlegen und wieder entfernen können. Die Dauer MUST zwischen 0 und 3650
liegen, sonst 400. Eine Dauer ohne nicht-leere Rechtsgrundlage MUST mit 422 abgewiesen werden.
Andere Personen MUST 403 erhalten. Ohne Dauer MUST die Kategorie der Einsatz-Frist folgen.
Vorgabewerte MUST es nicht geben.

#### Scenario: Dauer mit Rechtsgrundlage
- **WHEN** der Admin für `personenauskunft` 0 Tage mit Rechtsgrundlage „§ 46 Abs. 5 BHKG NRW“ speichert
- **THEN** liefern die Org-Einstellungen beide Werte zurück

#### Scenario: Dauer ohne Rechtsgrundlage
- **WHEN** der Admin eine Dauer ohne Rechtsgrundlage speichert
- **THEN** antwortet das System mit 422 und ändert nichts

#### Scenario: Neue Organisation
- **WHEN** eine Organisation ihre Einstellungen noch nie gespeichert hat
- **THEN** hat keine Kategorie eine Dauer

#### Scenario: Führungskraft
- **WHEN** eine org-weite Führungskraft eine Kategorie-Dauer speichert
- **THEN** antwortet das System mit 403

### Requirement: Kategorie-Frist beim Abschluss

Beim Abschluss eines Einsatzes SHALL das System für jede Kategorie mit Dauer eine Frist als
Abschlusszeitpunkt plus Dauer festhalten, im selben atomaren Vorgang wie der Abschluss, mit je
einem System-Eintrag im ETB, der Kategorie, Frist und Rechtsgrundlage nennt. Eine spätere
Änderung der Org-Vorgabe MUST bestehende Kategorie-Fristen unverändert lassen.

#### Scenario: Abschluss mit Kategorie-Dauer
- **WHEN** ein Einsatz abgeschlossen wird und die Organisation für `personenauskunft` 0 Tage vorgibt
- **THEN** trägt `personenauskunft` am Einsatz den Abschlusszeitpunkt als Frist
- **AND** nennt ein System-Eintrag im ETB Kategorie, Frist und Rechtsgrundlage

#### Scenario: Org-Vorgabe ändert sich danach
- **WHEN** der Admin nach dem Abschluss die Dauer von `personenauskunft` ändert
- **THEN** bleibt die Kategorie-Frist des abgeschlossenen Einsatzes unverändert

#### Scenario: Ohne Kategorie-Dauer
- **WHEN** ein Einsatz abgeschlossen wird und die Organisation keine Kategorie-Dauer vorgibt
- **THEN** trägt keine Kategorie eine eigene Frist, und es entsteht kein Kategorie-Eintrag im ETB

### Requirement: Kategorie-Frist am Einsatz ändern

Einsatzleitung und System-Admin SHALL die Frist einer Kategorie an einem abgeschlossenen
Einsatz setzen, verlängern und aufheben können. Andere MUST 403 erhalten. Eine Verkürzung,
auch das erstmalige Setzen, MUST bestätigt werden, sonst 409. Eine unveränderte Frist MUST
ohne Schreibvorgang bleiben. Jede wirksame Änderung MUST alten und neuen Wert ins ETB
schreiben. Bei aktivem oder geschwärztem Einsatz MUST 409 folgen, bei vorgemerktem 422.

#### Scenario: Verlängern wegen Ermittlungsverfahren
- **WHEN** die Einsatzleitung die Frist von `anhaenge` auf einen späteren Zeitpunkt setzt
- **THEN** gilt die neue Frist, und das ETB nennt Kategorie, alten und neuen Wert

#### Scenario: Verkürzen ohne Bestätigung
- **WHEN** die Frist einer Kategorie ohne Bestätigung auf einen früheren Zeitpunkt gesetzt wird
- **THEN** antwortet das System mit 409 und ändert nichts

#### Scenario: Beobachter
- **WHEN** ein Mitglied ohne Leitungsrolle eine Kategorie-Frist ändert
- **THEN** antwortet das System mit 403

#### Scenario: Erste Frist ohne Rechtsgrundlage
- **WHEN** an einer Kategorie ohne bisherige Frist eine Frist ohne Rechtsgrundlage gesetzt werden soll
- **THEN** antwortet das System mit 422, denn jede Kategorie-Frist MUST eine Rechtsgrundlage tragen

#### Scenario: Aktiver Einsatz
- **WHEN** an einem aktiven Einsatz eine Kategorie-Frist gesetzt werden soll
- **THEN** antwortet das System mit 409, weil die Kategorie-Frist erst beim Abschluss entsteht

### Requirement: Kategorie-Vormerkung und Wiederherstellen

Das System SHALL eine Kategorie eines abgeschlossenen Einsatzes vormerken, sobald ihre Frist
abgelaufen ist, idempotent und mit System-Eintrag im ETB. Ein aktiver Einsatz MUST nie
betroffen sein. Während der 30-tägigen Karenz MUST eine neue, künftige Frist die Vormerkung
aufheben. Nach der Karenz oder nach der Schwärzung der Kategorie MUST eine Friständerung 409
liefern. Die Daten der Kategorie MUST während der Karenz lesbar bleiben.

#### Scenario: Fällig
- **WHEN** der Purge-Lauf nach Ablauf der Frist von `personenauskunft` läuft
- **THEN** ist die Kategorie vorgemerkt, das ETB nennt die Vormerkung, und der Einsatz bleibt lesbar

#### Scenario: Wiederherstellen in der Karenz
- **WHEN** die Einsatzleitung 5 Tage nach der Vormerkung eine Frist in 60 Tagen setzt
- **THEN** ist die Kategorie nicht mehr vorgemerkt und trägt die neue Frist

#### Scenario: Karenz abgelaufen
- **WHEN** die Frist einer Kategorie 31 Tage nach ihrer Vormerkung geändert werden soll und sie noch nicht geschwärzt ist
- **THEN** antwortet das System mit 409 und ändert nichts

### Requirement: Kategorie-Schwärzung

Das System SHALL eine vorgemerkte Kategorie frühestens 30 Tage nach ihrer Vormerkung schwärzen:
ihre Daten, den Personenstamm, soweit alle Zwecke der Person erledigt sind, Zeitstempel und
einen System-Eintrag im ETB in einem atomaren Vorgang. Der Eintrag MUST Kategorie und
Rechtsgrundlage nennen. Andere Daten MUST unverändert bleiben. Die Schwärzung MUST idempotent
und unumkehrbar sein und die physische Entfernung nach `aufbewahrung` einhalten.

#### Scenario: Anhänge nach Ablauf
- **WHEN** die Karenz von `anhaenge` abläuft und der Purge-Lauf läuft
- **THEN** sind alle Datei-Anhänge des Einsatzes samt Dokumentablage entfernt
- **AND** tragen Personen, Schäden und Meldungen ihre Angaben unverändert
- **AND** nennt das ETB die Schwärzung der Anhänge mit Rechtsgrundlage

#### Scenario: Zweiter Lauf
- **WHEN** der Purge-Lauf eine bereits geschwärzte Kategorie erneut antrifft
- **THEN** ändert er nichts und schreibt keinen Eintrag

#### Scenario: Klartext ist physisch weg
- **WHEN** eine Kategorie mit einem eindeutigen Klartext in einer ihrer Spalten geschwärzt ist
- **THEN** kommt der Klartext weder in der Datenbankdatei noch im Write-Ahead-Log vor

### Requirement: Zusammenspiel mit der Einsatz-Frist

Die Kategorie-Frist SHALL nur früher wirken als die Einsatz-Frist. Läuft die Einsatz-Frist
zuerst ab, MUST der Einsatz wie bisher gesperrt, vorgemerkt und geschwärzt werden,
einschließlich aller Kategorien. Ein Kategorie-Ablauf MUST auch an einem gesperrten Einsatz
weiterlaufen. Das Wiederherstellen des Einsatzes MUST eine geschwärzte Kategorie nicht
zurückbringen.

#### Scenario: Einsatz-Frist kürzer als Kategorie-Frist
- **WHEN** die Einsatz-Frist vor der Frist von `behandlung` abläuft und der Einsatz geschwärzt wird
- **THEN** sind auch die Daten von `behandlung` geschwärzt, und die Kategorie zeigt `geschwaerzt`

#### Scenario: Gesperrter Einsatz
- **WHEN** ein vorgemerkter Einsatz eine Kategorie mit abgelaufener Karenz hat
- **THEN** schwärzt der Purge-Lauf diese Kategorie, ohne die Vormerkung des Einsatzes zu ändern

### Requirement: Zustand je Kategorie

Das System SHALL für jeden abgeschlossenen Einsatz je Kategorie Frist, Vormerkung, Karenz-Ende,
Schwärzung, Rechtsgrundlage und Zustand liefern. Der Zustand MUST einer der Werte des
Einsatz-Zustands sein (`ohne_frist`, `frist_laeuft`, `faellig`, `vorgemerkt`,
`schwaerzung_ausstehend`, `geschwaerzt`), nach derselben Rangfolge. Ist der Einsatz geschwärzt,
MUST jede Kategorie `geschwaerzt` zeigen.

#### Scenario: Gemischte Zustände
- **WHEN** an einem abgeschlossenen Einsatz `personenauskunft` seit 3 Tagen vorgemerkt ist, `anhaenge` eine künftige Frist trägt und `behandlung` keine
- **THEN** zeigen die Kategorien `vorgemerkt`, `frist_laeuft` und `ohne_frist`

### Requirement: Kategorie-Dauer in den Org-Einstellungen

Die Org-Einstellungen SHALL im Bereich Aufbewahrung je Kategorie Dauer und Rechtsgrundlage
zum Bearbeiten anbieten, mit kurzer Beschreibung der erfassten Daten und belegten
Vorschlägen samt Quelle, ohne sie vorzubelegen. Übersteigt eine Kategorie-Dauer die
Aufbewahrungsdauer der Organisation, MUST ein Hinweis sagen, dass dann die Einsatz-Frist
greift.

#### Scenario: Vorschlag wird nicht eingesetzt
- **WHEN** der Admin den Bereich Aufbewahrung öffnet und keine Kategorie-Dauer gesetzt ist
- **THEN** sind alle Dauerfelder leer, und je Kategorie steht ein Vorschlag mit Quelle

#### Scenario: Dauer länger als Einsatz-Dauer
- **WHEN** der Admin für `behandlung` 3650 Tage bei einer Aufbewahrungsdauer der Organisation von 365 Tagen einträgt
- **THEN** erscheint der Hinweis, dass die Einsatz-Frist zuerst greift
