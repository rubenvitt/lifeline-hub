# Spec Delta

## MODIFIED Requirements

### Requirement: Karenz von 30 Tagen vor der Schwärzung

Das System SHALL einen vorgemerkten Einsatz frühestens 30 Tage nach dem Zeitpunkt seiner
Vormerkung schwärzen. Die Karenz ist systemweit fest und nicht je Einsatz einstellbar.
Maßgeblich MUST allein der Zeitpunkt der Vormerkung sein, nicht die Frist: Eine spätere
Änderung von `retention_bis` verschiebt die Schwärzung nicht. Ausgenommen ist der Vollzug eines
Schwärzungsantrags; für ihn gilt die Karenz von 24 Stunden der Capability
`aufbewahrung-loeschersuchen`.

#### Scenario: Innerhalb der Karenz
- **WHEN** der Purge-Lauf 29 Tage nach der Vormerkung läuft
- **THEN** ist der Einsatz nicht geschwärzt

#### Scenario: Karenz abgelaufen
- **WHEN** der Purge-Lauf genau 30 Tage nach der Vormerkung läuft
- **THEN** ist der Einsatz geschwärzt

#### Scenario: Frist ändert die Karenz nicht
- **WHEN** an einem vorgemerkten Einsatz `retention_bis` in der Datenbank auf einen späteren Zeitpunkt steht und die Karenz abgelaufen ist
- **THEN** schwärzt der Purge-Lauf den Einsatz trotzdem

#### Scenario: Antrag während der Karenz
- **WHEN** ein seit 3 Tagen vorgemerkter Einsatz einen vor 24 Stunden gestellten Einsatz-Antrag trägt
- **THEN** schwärzt der Purge-Lauf den Einsatz, obwohl seine Karenz noch läuft

### Requirement: Unwiderrufliche Schwärzung

Nach Ablauf der Karenz oder beim Vollzug eines Einsatz-Antrags SHALL das System die
personenbezogenen Daten eines Einsatzes nach der Klassifikation schwärzen, und zwar in einem
einzigen atomaren Vorgang zusammen mit dem Zeitstempel `geschwaerzt_at` und einem
System-Eintrag im ETB. Stornierte Zeilen MUST eingeschlossen sein. Scheitert ein Teil, MUST
nichts geschwärzt sein. Die Schwärzung MUST idempotent sein. Erhalten bleiben MUST das
operative Skelett: Einsatzkopf ohne Meldebild und Ort, ETB im Wortlaut mit intakten Verweisen,
Registriernummern, Triage- und Statuskategorien. Eine Rücknahme MUST es nicht geben.

#### Scenario: Skelett nach der Schwärzung
- **WHEN** ein Einsatz mit Personen, Tieren und Schäden geschwärzt ist
- **THEN** tragen die Personen keine Namen, Kontakte, Adressen oder Notizen mehr
- **AND** tragen sie weiter Registriernummer, Status und Sichtungskategorie
- **AND** sind alle ETB-Einträge mit laufender Nummer und Berichtigungsverweis erhalten
- **AND** meldet die Fremdschlüsselprüfung der Datenbank keinen Verstoß

#### Scenario: Zweiter Lauf
- **WHEN** der Purge-Lauf einen bereits geschwärzten Einsatz erneut antrifft
- **THEN** ändert er nichts und schreibt keinen Eintrag

#### Scenario: Vollzug eines Einsatz-Antrags
- **WHEN** ein Einsatz-Antrag für einen nicht vorgemerkten Einsatz vollzogen wird
- **THEN** trägt der Einsatz dasselbe Skelett wie nach einer Schwärzung nach Ablauf der Karenz
- **AND** sind Vormerkung und `geschwaerzt_at` gesetzt

### Requirement: Auslöser der Aufbewahrung

Das System SHALL die Aufbewahrung ausschließlich über diese Auslöser bewegen: den Abschluss
(Frist aus der Dauer), die manuelle Frist, einen periodischen Purge-Lauf höchstens alle
10 Minuten (Vormerkung, Schwärzung und Vollzug fälliger Schwärzungsanträge), das
Wiederherstellen durch den Org-Admin und den Schwärzungsantrag des Org-Admins samt Rücknahme
(Capability `aufbewahrung-loeschersuchen`). Einen Auslöser, der ohne 24 Stunden Rücknahmefrist
schwärzt, MUST es nicht geben.

#### Scenario: Fristablauf ohne Eingriff
- **WHEN** die Frist eines abgeschlossenen Einsatzes abläuft und niemand eingreift
- **THEN** ist der Einsatz spätestens nach dem nächsten Purge-Lauf vorgemerkt

#### Scenario: Antrag schwärzt nicht sofort
- **WHEN** der Org-Admin einen Einsatz-Antrag stellt
- **THEN** ist der Einsatz unmittelbar danach nicht geschwärzt

### Requirement: Lückenloser Audit im ETB

Jede Mutation der Aufbewahrung (Frist aus Dauer, manuelle Frist, Vormerkung, Schwärzung,
Wiederherstellen, Schwärzungsantrag, Rücknahme und Vollzug eines Antrags) SHALL im selben
atomaren Vorgang einen System-Eintrag im ETB des Einsatzes schreiben. Bei einer handelnden
Person MUST sie als Erfasser stehen. Beim Purge-Lauf MUST der Erfasser in dieser Reihenfolge
bestimmt werden: beim Vollzug eines Antrags zuerst die Person, die ihn gestellt hat; sonst die
Person, die den Einsatz abgeschlossen hat, dann eine Einsatzleitung des Einsatzes, dann ein
System-Admin der Organisation des Einsatzes. Ist keiner auffindbar, MUST die Mutation
unterbleiben, als Fehler protokolliert und im nächsten Lauf erneut versucht werden. Eine
Aufbewahrungs-Mutation ohne ETB-Eintrag MUST es nicht geben.

#### Scenario: Ersatzakteur
- **WHEN** ein fälliger Einsatz keine abschließende Person und keine Einsatzleitung hat, seine Organisation aber einen System-Admin
- **THEN** wird er vorgemerkt, und der System-Eintrag trägt den System-Admin als Erfasser

#### Scenario: Kein Akteur auffindbar
- **WHEN** ein fälliger Einsatz weder abschließende Person noch Einsatzleitung hat und seine Organisation keinen System-Admin
- **THEN** bleibt der Einsatz unvorgemerkt, und kein ETB-Eintrag entsteht
- **AND** wird der Einsatz im nächsten Lauf vorgemerkt, sobald ein Akteur auffindbar ist

#### Scenario: Vollzug eines Antrags
- **WHEN** der Purge-Lauf einen Antrag vollzieht
- **THEN** trägt der System-Eintrag die Person als Erfasser, die den Antrag gestellt hat
