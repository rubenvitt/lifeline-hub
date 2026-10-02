# Spec Delta

## Purpose

Personenbezogene Daten eines abgeschlossenen Einsatzes laufen je Zweck mit eigener Frist ab:
Behandlung, Personenauskunft und Bildaufnahmen. Jede Kategorie wird erst gesperrt und nach
einer Karenz geschwärzt, während der Einsatz selbst lesbar bleibt.

## ADDED Requirements

### Requirement: Drei Fristkategorien mit festem Zuschnitt

Das System SHALL drei Fristkategorien führen: Behandlung, Personenauskunft und Bildaufnahmen.
Jeder personenbezogene Wert MUST genau einer Kategorie oder der Einsatz-Frist folgen. Alles,
was keiner Kategorie zugeordnet ist, MUST weiter allein der Einsatz-Frist folgen. Das gilt auch
für Daten von Einsatzkräften, ETB, Registriernummer, Status und Sichtungskategorie.

#### Scenario: Zuschnitt Behandlung
- **WHEN** die Kategorie Behandlung gesperrt ist
- **THEN** sind Zustand der Person, Notiz der Sichtung, Verlaufsnotizen und Notiz der UHS-Belegung betroffen
- **AND** bleiben Sichtungskategorie, Registriernummer und Status lesbar

#### Scenario: Zuschnitt Personenauskunft
- **WHEN** die Kategorie Personenauskunft gesperrt ist
- **THEN** sind Herkunftsadresse, Antreffort samt Koordinate, Melderkontakt, Notiz der Person, aktueller Verbleib und Verbleib-Ziel sowie Transportmittel, Ziel und Notiz der Verbleib-Einträge betroffen

#### Scenario: Zuschnitt Bildaufnahmen
- **WHEN** die Kategorie Bildaufnahmen gesperrt ist
- **THEN** sind alle Datei-Anhänge des Einsatzes mit einem Bild-Medientyp betroffen, gleich ob sie an ETB, Schaden, Chat oder Dokumentablage hängen
- **AND** bleiben Anhänge anderer Medientypen und das Hintergrundbild der Lagekarte lesbar

#### Scenario: ETB bleibt
- **WHEN** alle drei Kategorien geschwärzt sind
- **THEN** ist jeder ETB-Eintrag im Wortlaut erhalten

### Requirement: Identität folgt dem längsten Zweck

Name, Vorname, Geschlecht, Geburtsdatum und geschätztes Alter einer Person SHALL der
Personenauskunft folgen. Wurde die Person gesichtet oder in einer UHS belegt, MUST ihre
Identität erst gesperrt sein, wenn Personenauskunft und Behandlung beide gesperrt sind, und
erst geschwärzt werden, wenn beide geschwärzt sind. Stornierte Sichtungen und Belegungen MUST
dabei mitzählen.

#### Scenario: Nur registriert
- **WHEN** eine nie gesichtete Person in einem Einsatz steht, dessen Personenauskunft gesperrt und dessen Behandlung nicht gesperrt ist
- **THEN** liest sich ihr Name als leer

#### Scenario: Gesichtet
- **WHEN** eine gesichtete Person in demselben Einsatz steht
- **THEN** bleibt ihr Name lesbar, ihre Herkunftsadresse liest sich als leer

#### Scenario: Behandlung ohne eigene Frist
- **WHEN** die Organisation für Behandlung keine Dauer eingestellt hat und die Personenauskunft eines Einsatzes geschwärzt wird
- **THEN** behalten gesichtete Personen Name und Geburtsdatum bis zur Schwärzung des Einsatzes

### Requirement: Kategorie-Fristen je Organisation

Der System-Admin SHALL je Kategorie für seine Organisation eine Dauer in Tagen und eine
Rechtsgrundlage als Freitext festlegen können. Die Dauer MUST zwischen 1 und 3660 Tagen liegen
oder fehlen. Ist eine Dauer gesetzt, MUST die Rechtsgrundlage ausgefüllt sein, sonst antwortet
das System mit 422. Fehlt die Dauer, MUST die Kategorie der Einsatz-Frist folgen. Andere
Personen MUST 403 erhalten.

#### Scenario: Frist mit Rechtsgrundlage
- **WHEN** der Admin für Personenauskunft 30 Tage mit der Rechtsgrundlage „§ 46 Abs. 6 BHKG“ speichert
- **THEN** gilt diese Einstellung für die nächsten Abschlüsse seiner Organisation

#### Scenario: Ohne Rechtsgrundlage
- **WHEN** der Admin eine Dauer ohne Rechtsgrundlage speichert
- **THEN** antwortet das System mit 422 und ändert nichts

#### Scenario: Kein Default
- **WHEN** eine Organisation nie Kategorie-Fristen eingestellt hat
- **THEN** wird bei ihren Abschlüssen keine Kategorie-Frist gesetzt

#### Scenario: Führungskraft
- **WHEN** eine org-weite Führungskraft die Kategorie-Fristen ändern will
- **THEN** antwortet das System mit 403

### Requirement: Vorschlagswerte mit Quelle

Die Einstellung der Kategorie-Fristen SHALL je Kategorie einen Vorschlagswert mit Quelle
anzeigen. Ein Vorschlag MUST erst durch eine Handlung des Admins zur Einstellung werden und
nie still gelten.

#### Scenario: Vorschlag übernehmen
- **WHEN** der Admin bei Personenauskunft den Vorschlag übernimmt und speichert
- **THEN** stehen 30 Tage und die Quelle als Rechtsgrundlage in der Einstellung

#### Scenario: Vorschlag ignoriert
- **WHEN** der Admin die Seite öffnet und ohne Änderung verlässt
- **THEN** bleibt jede Kategorie ohne Dauer

### Requirement: Kategorie-Frist beim Abschluss einfrieren

Beim Abschluss eines Einsatzes SHALL das System für jede Kategorie mit eingestellter Dauer die
Frist als Abschlusszeitpunkt plus Dauer setzen. Dauer und Rechtsgrundlage MUST im Stand des
Abschlusses am Einsatz stehen. Im selben Vorgang MUST ein System-Eintrag im ETB entstehen, der
jede Kategorie mit Frist, Dauer und Rechtsgrundlage nennt. Spätere Änderungen der Einstellung
MUST abgeschlossene Einsätze unverändert lassen.

#### Scenario: Abschluss mit zwei Kategorien
- **WHEN** ein Einsatz einer Organisation mit Fristen für Personenauskunft und Behandlung abgeschlossen wird
- **THEN** trägt er beide Kategorie-Fristen
- **AND** nennt ein System-Eintrag im ETB beide mit Frist, Dauer und Rechtsgrundlage

#### Scenario: Einstellung später geändert
- **WHEN** die Organisation nach dem Abschluss die Dauer der Personenauskunft ändert
- **THEN** behält der abgeschlossene Einsatz seine Frist

#### Scenario: Vor der Einführung abgeschlossen
- **WHEN** ein Einsatz vor Einführung der Kategorie-Fristen abgeschlossen wurde
- **THEN** trägt er keine Kategorie-Frist und folgt allein der Einsatz-Frist

### Requirement: Sperre nach Ablauf der Kategorie-Frist

Ist die Frist einer Kategorie abgelaufen, SHALL das System ihre Werte auf jedem Leseweg so
ausliefern, wie sie nach der Schwärzung stünden. Das gilt für Listen, Detail, Export, Druck,
Wiederholungsantworten und Datei-Abrufe. Gesperrte Bildaufnahmen MUST in Anhanglisten fehlen,
ihr Abruf MUST 404 liefern. Der Einsatz MUST für seine Berechtigten lesbar bleiben.

#### Scenario: Gepflanzte Werte nach der Sperre
- **WHEN** ein Einsatz mit eindeutigen Werten in allen Feldern der Personenauskunft nach Ablauf ihrer Frist über Personenliste, Personendetail, CSV-Export und Druck abgerufen wird
- **THEN** kommt keiner dieser Werte in einer Antwort vor
- **AND** antwortet jede Route mit 200

#### Scenario: Bild gesperrt
- **WHEN** die Bildaufnahmen eines Einsatzes gesperrt sind und ein ETB-Eintrag ein Foto und ein PDF trägt
- **THEN** führt der Eintrag nur noch das PDF
- **AND** liefert der Abruf des Fotos 404

#### Scenario: Purge-Lauf noch nicht gelaufen
- **WHEN** die Frist einer Kategorie abgelaufen ist und der Purge-Lauf sie noch nicht als gesperrt vermerkt hat
- **THEN** liest sie sich trotzdem wie geschwärzt

### Requirement: Sperrvermerk und Karenz je Kategorie

Der Purge-Lauf SHALL eine Kategorie mit abgelaufener Frist als gesperrt vermerken. Der Vermerk
beginnt eine Karenz von 30 Tagen. Er MUST idempotent sein und im selben Vorgang einen
System-Eintrag im ETB schreiben, der die Kategorie nennt.

#### Scenario: Fällig
- **WHEN** der Purge-Lauf nach Ablauf der Frist der Personenauskunft läuft
- **THEN** ist sie als gesperrt vermerkt, und das ETB enthält einen System-Eintrag dazu

#### Scenario: Zweiter Lauf
- **WHEN** der Purge-Lauf erneut läuft
- **THEN** bleibt der Zeitpunkt des Vermerks, und es entsteht kein weiterer Eintrag

### Requirement: Schwärzung je Kategorie nach der Karenz

Frühestens 30 Tage nach dem Sperrvermerk SHALL der Purge-Lauf die Kategorie nach der
Klassifikation schwärzen, gelöschte Bildaufnahmen eingeschlossen. Schwärzung, Zeitstempel und
ein System-Eintrag im ETB MUST einen atomaren Vorgang bilden. Die Schwärzung MUST idempotent und
unwiderruflich sein. Geschwärzte Werte MUST danach physisch entfernt sein, wie bei der
Schwärzung des Einsatzes.

#### Scenario: Innerhalb der Karenz
- **WHEN** der Purge-Lauf 29 Tage nach dem Sperrvermerk läuft
- **THEN** stehen die Werte der Kategorie noch in der Datenbank

#### Scenario: Karenz abgelaufen
- **WHEN** der Purge-Lauf 30 Tage nach dem Sperrvermerk der Personenauskunft läuft
- **THEN** sind ihre Werte geschwärzt, die Werte der Behandlung aber nicht
- **AND** kommt kein geschwärzter Wert mehr in Datenbankdatei oder Write-Ahead-Log vor

#### Scenario: Bildaufnahmen geschwärzt
- **WHEN** die Bildaufnahmen geschwärzt werden
- **THEN** sind die Bild-Anhänge gelöscht, die zugehörigen ETB-Einträge bleiben

### Requirement: Einsatz-Frist bleibt äußere Grenze

Sperre und Schwärzung des ganzen Einsatzes SHALL unabhängig von den Kategorien gelten. Eine
Kategorie-Frist, die nach der Einsatz-Frist endet, MUST den Einsatz nicht länger lesbar oder
ungeschwärzt halten. Für einen aktiven Einsatz MUST keine Kategorie gesperrt sein.

#### Scenario: Kategorie länger als Einsatz
- **WHEN** die Behandlung eine Frist in zehn Jahren trägt und die Einsatz-Frist in einem Jahr abläuft
- **THEN** wird der Einsatz nach einem Jahr gesperrt und nach der Karenz vollständig geschwärzt

#### Scenario: Geschwärzter Einsatz
- **WHEN** ein Einsatz geschwärzt ist
- **THEN** sperrt oder schwärzt der Purge-Lauf an ihm keine Kategorie mehr und schreibt keinen Eintrag

### Requirement: Kategorie in der Karenz wiederherstellen

Der Org-Admin SHALL eine gesperrte, noch nicht geschwärzte Kategorie innerhalb der Karenz
wiederherstellen können. Dabei MUST er eine neue Frist in der Zukunft angeben oder ausdrücklich
`null`, dann folgt die Kategorie der Einsatz-Frist. Ein System-Eintrag im ETB nennt Kategorie
und neue Frist. Die Fehlerfälle MUST denen des Wiederherstellens eines Einsatzes entsprechen.

#### Scenario: Wiederherstellen
- **WHEN** der Admin die seit 5 Tagen gesperrte Personenauskunft mit einer Frist in 60 Tagen wiederherstellt
- **THEN** liest sich die Personenauskunft wieder mit ihren Werten
- **AND** enthält das ETB einen System-Eintrag des Admins dazu

#### Scenario: Frist fehlt
- **WHEN** die Anfrage kein Feld `frist_bis` enthält
- **THEN** antwortet das System mit 400

#### Scenario: Frist in der Vergangenheit
- **WHEN** die neue Frist in der Vergangenheit liegt
- **THEN** antwortet das System mit 422 und ändert nichts

#### Scenario: Nicht gesperrt
- **WHEN** die Kategorie keinen Sperrvermerk trägt
- **THEN** antwortet das System mit 422

#### Scenario: Karenz abgelaufen oder geschwärzt
- **WHEN** die Karenz der Kategorie abgelaufen oder die Kategorie geschwärzt ist
- **THEN** antwortet das System mit 409 und ändert nichts

#### Scenario: Führungskraft oder fremde Organisation
- **WHEN** eine org-weite Führungskraft oder der Admin einer fremden Organisation wiederherstellen will
- **THEN** antwortet das System mit 403

### Requirement: Kategorie-Stand anzeigen

Die Aufbewahrung in den Einstellungen eines abgeschlossenen Einsatzes SHALL je Kategorie Frist,
Dauer, Rechtsgrundlage und Zustand zeigen. Die Personenansicht MUST bei gesperrter
Personenauskunft oder Behandlung einen Hinweis tragen, der die Sperre als Grund für leere
Felder nennt. Der Kategorie-Stand MUST keinen personenbezogenen Wert enthalten.

#### Scenario: Einstellungen
- **WHEN** die Einsatzleitung die Aufbewahrung eines abgeschlossenen Einsatzes mit gesperrter Personenauskunft öffnet
- **THEN** sieht sie die Personenauskunft als gesperrt mit Frist und Rechtsgrundlage

#### Scenario: Hinweis in der Personenansicht
- **WHEN** jemand die Person eines Einsatzes mit gesperrter Personenauskunft öffnet
- **THEN** nennt ein Hinweis die Sperre der Personenauskunft und ihre Frist
