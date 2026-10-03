# personen-anhaenge Specification

## Purpose
Fotos und PDF-Dateien lassen sich an einer betroffenen Person ablegen, auflisten,
herunterladen und entfernen. Sichtbar sind sie nur über das Modul Personen, jeder Download
steht im Zugriffsprotokoll der Person, das Einsatztagebuch erhält eine pseudonyme Spur ohne
Dateinamen, und die DSGVO-Schwärzung des Einsatzes löscht die Dateien.

## Requirements

### Requirement: Datei an einer Person ablegen

Das System SHALL einer Person mit Schreibrecht im Einsatz und Zugriff auf das Modul Personen
erlauben, an einer Person dieses Einsatzes eine Datei abzulegen. Eine Ablage MUST genau eine
Datei in einer Anfrage übertragen. Die Datei MUST vor dem Speichern auf Schadsoftware geprüft
werden. Datei, Verknüpfung und ETB-Nachweis MUST gemeinsam gelingen oder gemeinsam
unterbleiben. Die Antwort MUST den Anhang mit Dateiname, Typ, Größe, ablegender Person und
Zeitpunkt liefern.

#### Scenario: Foto ablegen
- **WHEN** eine Person mit Schreibrecht an Person R-007 die Datei `verletzung.jpg` (2 MiB) ablegt
- **THEN** antwortet das System mit 201 und dem Anhang, und die Liste der Anhänge von R-007 enthält `verletzung.jpg`

#### Scenario: Anfrage ohne Datei
- **WHEN** eine Ablage-Anfrage kein Dateifeld enthält
- **THEN** antwortet das System mit 400 und speichert nichts

#### Scenario: Zwei Dateien in einer Anfrage
- **WHEN** eine Ablage-Anfrage zwei Dateifelder enthält
- **THEN** antwortet das System mit 400 und speichert keine der beiden Dateien

#### Scenario: Scanner nicht erreichbar
- **WHEN** der Virenscanner konfiguriert, aber nicht erreichbar ist und kein Fail-open gesetzt ist
- **THEN** antwortet das System mit 503 und legt weder Datei noch Verknüpfung noch ETB-Eintrag an

#### Scenario: Schadsoftware gefunden
- **WHEN** der Scanner in der Datei einen Fund meldet
- **THEN** antwortet das System mit 422 und legt weder Datei noch Verknüpfung noch ETB-Eintrag an

### Requirement: Erlaubte Dateitypen und Größe an Personen

Das System SHALL an einer Person nur Bilder in den Formaten JPEG, PNG, WebP, HEIC und HEIF
sowie PDF annehmen. Der Dateityp MUST aus der Dateiendung bestimmt werden, nicht aus der
Typangabe des Clients. Eine leere Datei und eine Datei über 25 MiB MUST abgelehnt werden. Jede
Ablehnung nach dieser Anforderung MUST mit 400 antworten und nichts speichern.

#### Scenario: HEIC vom Mobiltelefon
- **WHEN** eine Person die Datei `IMG_0412.HEIC` ablegt
- **THEN** nimmt das System sie an und führt sie mit dem Typ `image/heic`

#### Scenario: Office-Datei
- **WHEN** eine Person die Datei `liste.xlsx` ablegt
- **THEN** antwortet das System mit 400, und die Meldung nennt den nicht erlaubten Dateityp

#### Scenario: Zu große Datei
- **WHEN** eine Person eine Datei mit 25 MiB plus ein Byte ablegt
- **THEN** antwortet das System mit 400 und speichert nichts

#### Scenario: Leere Datei
- **WHEN** eine Person eine Datei mit 0 Byte ablegt
- **THEN** antwortet das System mit 400 und speichert nichts

### Requirement: Anhänge einer Person auflisten und herunterladen

Das System SHALL jeder Person mit Lesezugriff im Einsatz und Zugriff auf das Modul Personen die
nicht entfernten Anhänge einer Person auflisten, neueste zuerst, und den Download jedes dieser
Anhänge erlauben. Das gilt auch für Beobachter und für eine stornierte Person. Der Download
MUST die Datei als Anlage mit ihrem Dateinamen ausliefern und ein ETag tragen. Eine Anfrage mit
passendem `If-None-Match` MUST mit 304 ohne Inhalt beantwortet werden.

#### Scenario: Beobachter lädt herunter
- **WHEN** ein Beobachter des Einsatzes einen Anhang von R-007 herunterlädt
- **THEN** erhält er die Datei mit `Content-Disposition: attachment` und einem ETag

#### Scenario: Erneuter Abruf mit ETag
- **WHEN** der Client denselben Anhang mit dem zuvor erhaltenen ETag in `If-None-Match` abruft
- **THEN** antwortet das System mit 304 ohne Inhalt

#### Scenario: Stornierte Person bleibt lesbar
- **WHEN** eine Person die Anhänge einer stornierten Person abruft
- **THEN** erhält sie die Liste und kann jede Datei herunterladen

### Requirement: Lese-Audit je Download

Das System MUST bei jedem Abruf der Datei eines Personen-Anhangs vor der Auslieferung einen
Eintrag im Zugriffsprotokoll dieser Person anlegen, mit abrufender Person, Zeitpunkt und der
Art „Anhang“. Das MUST auch für eine Antwort 304 und für den Abruf des Originals gelten. Kann
der Eintrag nicht geschrieben werden, MUST das System nichts ausliefern. Der Eintrag MUST NOT
den Dateinamen oder die Kennung der Datei enthalten.

#### Scenario: Download wird protokolliert
- **WHEN** ein Beobachter einen Anhang von R-007 herunterlädt
- **THEN** enthält das Zugriffsprotokoll von R-007 genau einen neuen Eintrag der Art „Anhang“ mit dem Beobachter als abrufender Person

#### Scenario: Abruf aus dem Browser-Cache
- **WHEN** der Client einen Anhang von R-007 mit passendem `If-None-Match` abruft und 304 erhält
- **THEN** enthält das Zugriffsprotokoll von R-007 auch für diesen Abruf einen Eintrag der Art „Anhang“

#### Scenario: Original-Abruf
- **WHEN** die Einsatzleitung das Original eines Fotos von R-007 abruft
- **THEN** enthält das Zugriffsprotokoll von R-007 einen Eintrag der Art „Anhang“, und das ETB enthält den Original-Vermerk

#### Scenario: Abgewiesener Abruf
- **WHEN** ein Download mit 400, 403 oder 404 abgewiesen wird
- **THEN** entsteht kein Eintrag im Zugriffsprotokoll

#### Scenario: Protokoll nicht schreibbar
- **WHEN** der Eintrag im Zugriffsprotokoll nicht geschrieben werden kann
- **THEN** antwortet das System mit einem Fehler und liefert keine Datei aus

### Requirement: Liste ohne Protokolleintrag

Das Auflisten der Anhänge einer Person MUST NOT einen Eintrag im Zugriffsprotokoll anlegen;
protokolliert wird das Öffnen der Person und jeder Download.

#### Scenario: Liste laden
- **WHEN** eine Person die Anhangliste von R-007 abruft
- **THEN** bleibt die Zahl der Einträge im Zugriffsprotokoll von R-007 unverändert

### Requirement: Audit-Einsicht nennt die Art lesbar

Die Audit-Einsicht einer Person SHALL der Einsatzleitung jede Art des Zugriffs als Klartext
zeigen, auch den Download eines Anhangs.

#### Scenario: Download in der Einsicht
- **WHEN** die Einsatzleitung das Zugriffsprotokoll von R-007 aufklappt, nachdem ein Anhang heruntergeladen wurde
- **THEN** zeigt die Zeile die Art als lesbaren Text für einen Datei-Download

### Requirement: Zugehörigkeit zum Einsatz und zur Person

Das System MUST jede Anfrage auf Anhänge einer Person mit 404 abweisen, wenn die Person nicht zu
dem Einsatz der Adresse gehört oder der Anhang nicht zu der Person der Adresse gehört. Ein
Anhang MUST immer demselben Einsatz angehören wie seine Person.

#### Scenario: Person eines fremden Einsatzes
- **WHEN** eine Person die Anhänge von Person 17 über die Adresse ihres Einsatzes 4 abruft, Person 17 aber zu Einsatz 9 gehört
- **THEN** antwortet das System mit 404

#### Scenario: Anhang einer anderen Person
- **WHEN** eine Person einen Anhang von R-001 über die Adresse von R-002 im selben Einsatz herunterlädt
- **THEN** antwortet das System mit 404 und protokolliert keinen Zugriff

#### Scenario: Entfernen über fremde Adresse
- **WHEN** eine Person einen Anhang über die Adresse einer Person entfernen will, zu der er nicht gehört
- **THEN** antwortet das System mit 404 und ändert nichts

### Requirement: Rechte über das Modul Personen

Das System MUST Lesen und Schreiben der Anhänge an dieselben Rechte binden wie die Person selbst:
Mitgliedschaft in der Organisation, Lesezugriff im Einsatz einschließlich Nachlauf- und
Aufbewahrungsregeln, Zugriff auf das Modul Personen, für das Schreiben zusätzlich Schreibrecht
und einen aktiven Einsatz. Fehlende Mitgliedschaft, fehlendes Schreibrecht und ein gesperrtes
Modul MUST mit 403 antworten, ein abgeschlossener Einsatz beim Schreiben mit 409.

#### Scenario: Beobachter will ablegen
- **WHEN** ein Beobachter eine Datei an einer Person ablegen will
- **THEN** antwortet das System mit 403 und speichert nichts

#### Scenario: Modul Personen für die Rolle gesperrt
- **WHEN** das Modul Personen im Einsatz für die Rolle der Person gesperrt ist und sie die Anhänge einer Person abruft oder eine Datei herunterlädt
- **THEN** antwortet das System mit 403 und protokolliert keinen Zugriff

#### Scenario: Abgeschlossener Einsatz
- **WHEN** eine Person mit Schreibrecht in einem abgeschlossenen Einsatz eine Datei ablegen oder einen Anhang entfernen will
- **THEN** antwortet das System mit 409, und Liste und Download bleiben innerhalb der Nachlauffrist möglich

#### Scenario: Fremde Organisation
- **WHEN** eine Führungskraft einer anderen Organisation die Anhänge einer Person abruft
- **THEN** antwortet das System mit 403

### Requirement: Lebenszyklus der Person

Das System MUST Ablegen und Entfernen an einer stornierten Person mit 409 abweisen. An einer
nicht stornierten Person MUST beides in jedem Status möglich bleiben, auch bei vermisst,
abgemeldet und verstorben.

#### Scenario: Ablegen an stornierter Person
- **WHEN** eine Person eine Datei an einer stornierten Person ablegen will
- **THEN** antwortet das System mit 409 und speichert weder Datei noch Verknüpfung noch ETB-Eintrag

#### Scenario: Entfernen an stornierter Person
- **WHEN** eine Person einen Anhang einer stornierten Person entfernen will
- **THEN** antwortet das System mit 409, und der Anhang bleibt in der Liste

#### Scenario: Vermisste Person
- **WHEN** eine Person an einer als vermisst geführten Person ein Foto zur Identifikation ablegt
- **THEN** nimmt das System es an

### Requirement: Anhang einer Person entfernen

Das System SHALL einer Person mit Schreibrecht erlauben, einen Anhang einer Person zu entfernen.
Ein entfernter Anhang MUST aus der Liste verschwinden und darf über keinen Weg mehr
heruntergeladen werden. Die Datei MUST bis zur Schwärzung des Einsatzes gespeichert bleiben.
Ein bereits entfernter Anhang MUST beim erneuten Entfernen mit 404 antworten.

#### Scenario: Anhang entfernen
- **WHEN** eine Person mit Schreibrecht den Anhang `verletzung.jpg` von R-007 entfernt
- **THEN** antwortet das System mit 204, die Liste enthält ihn nicht mehr, und sein Download antwortet mit 404

#### Scenario: Doppelt entfernen
- **WHEN** eine Person denselben Anhang ein zweites Mal entfernt
- **THEN** antwortet das System mit 404 und schreibt keinen weiteren ETB-Eintrag

### Requirement: Pseudonyme Spur im Einsatztagebuch

Das System MUST beim Ablegen und beim Entfernen je einen System-Eintrag im Einsatztagebuch
schreiben, im Wortlaut „Person R-007: Foto abgelegt“ bzw. „Person R-007: Foto entfernt“, für
PDF „PDF“ statt „Foto“. Der Eintrag MUST NOT Dateinamen, Namen, Vornamen, Orte oder andere
Freitexte der Person oder der Datei enthalten.

#### Scenario: Wortlaut ohne Personenbezug
- **WHEN** eine Person an R-007 (Name „Müller“, Vorname „Erika“) die Datei `Erika_Mueller_Ausweis.jpg` ablegt
- **THEN** enthält das Einsatztagebuch genau einen neuen System-Eintrag „Person R-007: Foto abgelegt“, und kein Eintrag des Einsatzes enthält „Müller“, „Mueller“, „Erika“ oder „Ausweis“

#### Scenario: Wortlaut für PDF
- **WHEN** eine Person an R-007 eine PDF-Datei ablegt und sie danach entfernt
- **THEN** enthält das Einsatztagebuch „Person R-007: PDF abgelegt“ und „Person R-007: PDF entfernt“

#### Scenario: Abgewiesene Ablage
- **WHEN** eine Ablage mit 400, 403, 404, 409, 422 oder 503 abgewiesen wird
- **THEN** entsteht kein ETB-Eintrag

### Requirement: Live-Verteilung der Personen-Anhänge

Das System MUST nach erfolgreichem Ablegen und Entfernen das Ereignis `person` und das
ETB-Ereignis an die Abonnenten des Einsatzes verteilen, beide nur mit Kennungen. Das Ereignis
`person` MUST nur Personen mit Zugriff auf das Modul Personen erreichen. Andere Sitzungen MUST
die Anhangliste daraufhin neu laden, ohne dass dabei ein Eintrag im Zugriffsprotokoll entsteht.

#### Scenario: Zweite Sitzung sieht die neue Datei
- **WHEN** Person A an R-007 eine Datei ablegt, während Person B die Anhänge von R-007 aufgeklappt hat
- **THEN** erscheint die Datei bei B ohne Neuladen, und das Zugriffsprotokoll von R-007 erhält dadurch keinen Eintrag

#### Scenario: Nutzlast ohne Inhalt
- **WHEN** das System nach einer Ablage die Ereignisse verteilt
- **THEN** enthalten sie nur Kennungen (Einsatz, Person, ETB-Eintrag) und keinen Dateinamen

### Requirement: Sichtbarkeit nur im Modul Personen

Anhänge einer Person MUST ausschließlich über die Anhang-Adressen der Person erreichbar sein.
Sie MUST NOT in der Dokumentenablage erscheinen. Der generische Anhang-Download des Einsatzes
MUST für sie mit 404 antworten, der generische Löschpfad mit 422, ausdrücklich auch für die
ablegende Person. Eine Chat-Nachricht MUST sie nicht verknüpfen können (400), ein ETB-Eintrag
ebenso wenig (422).

#### Scenario: Nicht in der Dokumentenablage
- **WHEN** an R-007 ein Foto abgelegt ist und eine Person die Dokumentenablage des Einsatzes abruft
- **THEN** enthält die Liste das Foto nicht

#### Scenario: Ablegende Person über den generischen Download
- **WHEN** die Person, die `verletzung.jpg` an R-007 abgelegt hat, die Datei über den generischen Anhang-Download des Einsatzes abruft
- **THEN** antwortet das System mit 404

#### Scenario: Generisches Löschen
- **WHEN** die ablegende Person die Datei mit Schreibrecht über den generischen Löschpfad löschen will
- **THEN** antwortet das System mit 422, und Datei, Verknüpfung und Liste bleiben unverändert

#### Scenario: Chat-Nachricht verknüpft Personen-Datei
- **WHEN** die ablegende Person eine Chat-Nachricht mit der Kennung der Datei eines Personen-Anhangs sendet
- **THEN** antwortet das System mit 400, legt keine Nachricht an und verknüpft nichts

#### Scenario: ETB-Eintrag verknüpft Personen-Datei
- **WHEN** die ablegende Person einen ETB-Eintrag mit der Kennung der Datei eines Personen-Anhangs erfasst
- **THEN** antwortet das System mit 422, legt keinen Eintrag an und verknüpft nichts

#### Scenario: Recht auf Dokumente genügt nicht
- **WHEN** eine Person Zugriff auf das Modul Dokumente hat, aber nicht auf das Modul Personen, und einen Anhang von R-007 herunterladen will
- **THEN** antwortet das System über die Personen-Adresse mit 403

### Requirement: Orphan-Sweep hält Personen-Dateien

Der Sweep verwaister Anhänge MUST Dateien, die an einer Person hängen, unabhängig von ihrem Alter
behalten, auch wenn der Anhang entfernt wurde.

#### Scenario: Alte entfernte Personen-Datei
- **WHEN** der Sweep läuft und eine entfernte Personen-Datei älter als die Karenz von 24 Stunden ist
- **THEN** bleibt sie gespeichert, bis der Einsatz geschwärzt wird

### Requirement: Schwärzung löscht die Personen-Dateien

Die DSGVO-Schwärzung eines Einsatzes MUST alle Dateien an seinen Personen samt Verknüpfung
löschen, einschließlich der entfernten. Die pseudonymen Einträge im Einsatztagebuch und das
Zugriffsprotokoll MUST erhalten bleiben.

#### Scenario: Schwärzung nach Ablage, Download und Entfernen
- **WHEN** an R-001 zwei Dateien abgelegt, eine heruntergeladen, eine entfernt und danach der Einsatz geschwärzt wird
- **THEN** gibt es für den Einsatz keine gespeicherte Datei und keine Verknüpfung mehr, die drei Einträge „Person R-001: … abgelegt/entfernt“ stehen weiter im Einsatztagebuch, und der Eintrag der Art „Anhang“ steht weiter im Zugriffsprotokoll

### Requirement: Löschersuchen löscht die Dateien der Person

Der Vollzug eines Löschersuchens nach Art. 17 für eine betroffene Person MUST alle an ihr
abgelegten Dateien samt Verknüpfung löschen, auch bereits entfernte. Dateien anderer Personen und
anderer Einsätze MUST unverändert bleiben. Die pseudonymen Einträge im Einsatztagebuch und das
Zugriffsprotokoll MUST erhalten bleiben. Die Rückfrage vor dem Antrag MUST nennen, dass Fotos und
Dateien der Person mitgehen.

#### Scenario: Antrag für R-001
- **WHEN** an R-001 eine Datei abgelegt und eine entfernt ist, an R-002 eine abgelegt ist, und das Löschersuchen für R-001 vollzogen wird
- **THEN** gibt es für R-001 keine gespeicherte Datei und keine Verknüpfung mehr, die Datei von R-002 liegt weiter vor, und die Einträge „Person R-001: … abgelegt/entfernt“ stehen weiter im Einsatztagebuch

#### Scenario: Rückfrage nennt die Dateien
- **WHEN** der Admin das Löschersuchen für eine betroffene Person öffnet
- **THEN** nennt die Rückfrage „ihre Fotos und Dateien“ unter dem, was entfernt wird
