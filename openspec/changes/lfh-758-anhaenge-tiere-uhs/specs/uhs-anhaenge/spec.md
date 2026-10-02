# Spec Delta

## Purpose

Fotos, PDF-Dateien und Pläne lassen sich an einer Unfallhilfsstelle ablegen, auflisten,
herunterladen und entfernen. Sichtbar sind sie nur über das Modul Unfallhilfsstellen. Weil
sie Patienten zeigen können, wird jeder Abruf protokolliert, und die Einsatzleitung kann das
Protokoll einsehen.

## ADDED Requirements

### Requirement: Datei an einer UHS ablegen

Das System SHALL einer Person mit Schreibrecht im Einsatz und Zugriff auf das Modul
Unfallhilfsstellen erlauben, an einer UHS dieses Einsatzes eine Datei abzulegen. Eine Ablage
MUST genau eine Datei in einer Anfrage übertragen und MUST vor dem Speichern auf
Schadsoftware geprüft werden. Datei, Verknüpfung mit der UHS und Nachweis im
Einsatztagebuch MUST gemeinsam gelingen oder gemeinsam unterbleiben. Die Antwort MUST den
Anhang mit Dateiname, Typ, Größe, ablegender Person und Zeitpunkt liefern.

#### Scenario: Plan der Behandlungsstelle ablegen
- **WHEN** eine Person mit Schreibrecht an der UHS „BHP 50“ die Datei `grundriss_halle.pdf` ablegt
- **THEN** antwortet das System mit 201 und dem Anhang, und die Liste der Anhänge von „BHP 50“ enthält `grundriss_halle.pdf`

#### Scenario: Anfrage ohne oder mit zwei Dateien
- **WHEN** eine Ablage-Anfrage kein Dateifeld oder zwei Dateifelder enthält
- **THEN** antwortet das System mit 400 und speichert nichts

#### Scenario: Scanner nicht erreichbar
- **WHEN** der Virenscanner konfiguriert, aber nicht erreichbar ist und kein Fail-open gesetzt ist
- **THEN** antwortet das System mit 503 und legt weder Datei noch Verknüpfung noch ETB-Eintrag an

#### Scenario: Schadsoftware gefunden
- **WHEN** der Scanner in der Datei einen Fund meldet
- **THEN** antwortet das System mit 422 und legt weder Datei noch Verknüpfung noch ETB-Eintrag an

### Requirement: Erlaubte Dateitypen und Größe an der UHS

Das System SHALL an einer UHS nur Bilder in den Formaten JPEG, PNG, WebP, HEIC und HEIF sowie
PDF annehmen. Der Dateityp MUST aus der Dateiendung bestimmt werden, nicht aus der
Typangabe des Clients. Eine leere Datei und eine Datei über 25 MiB MUST abgelehnt werden.
Jede Ablehnung nach dieser Anforderung MUST mit 400 antworten und nichts speichern.

#### Scenario: Foto vom Mobiltelefon
- **WHEN** eine Person die Datei `IMG_0412.HEIC` an einer UHS ablegt
- **THEN** nimmt das System sie an und führt sie mit dem Typ `image/heic`

#### Scenario: Office-Datei
- **WHEN** eine Person die Datei `patientenliste.xlsx` an einer UHS ablegt
- **THEN** antwortet das System mit 400, und die Meldung nennt den nicht erlaubten Dateityp

#### Scenario: Zu große oder leere Datei
- **WHEN** eine Person eine Datei mit 25 MiB plus ein Byte oder mit 0 Byte ablegt
- **THEN** antwortet das System mit 400 und speichert nichts

### Requirement: Anhänge einer UHS auflisten und herunterladen

Das System SHALL jeder Person mit Lesezugriff im Einsatz und Zugriff auf das Modul
Unfallhilfsstellen die nicht entfernten Anhänge einer UHS auflisten, neueste zuerst, und
deren Download erlauben, auch Beobachtern und an einer stornierten UHS. Der Download MUST
die Datei als Anlage mit ihrem Dateinamen und einem ETag ausliefern; ein passendes
`If-None-Match` MUST mit 304 ohne Inhalt beantwortet werden.

#### Scenario: Beobachter lädt herunter
- **WHEN** ein Beobachter des Einsatzes einen Anhang von „BHP 50“ herunterlädt
- **THEN** erhält er die Datei mit `Content-Disposition: attachment` und einem ETag

#### Scenario: Erneuter Abruf mit ETag
- **WHEN** der Client denselben Anhang mit dem zuvor erhaltenen ETag in `If-None-Match` abruft
- **THEN** antwortet das System mit 304 ohne Inhalt

#### Scenario: Stornierte UHS bleibt lesbar
- **WHEN** eine Person die Anhänge einer stornierten UHS abruft
- **THEN** erhält sie die Liste und kann jede Datei herunterladen

### Requirement: Zugehörigkeit zum Einsatz und zur UHS

Das System MUST jede Anfrage auf Anhänge einer UHS mit 404 abweisen, wenn die UHS nicht zu
dem Einsatz der Adresse gehört oder der Anhang nicht zu der UHS der Adresse gehört. Ein
Anhang MUST immer demselben Einsatz angehören wie seine UHS.

#### Scenario: UHS eines fremden Einsatzes
- **WHEN** eine Person die Anhänge von UHS 17 über die Adresse ihres Einsatzes 4 abruft, UHS 17 aber zu Einsatz 9 gehört
- **THEN** antwortet das System mit 404

#### Scenario: Anhang einer anderen UHS
- **WHEN** eine Person einen Anhang von „BHP 50“ über die Adresse von „PA 1“ im selben Einsatz herunterlädt oder entfernt
- **THEN** antwortet das System mit 404, ändert nichts und protokolliert keinen Abruf

### Requirement: Rechte über das Modul Unfallhilfsstellen

Das System MUST Lesen und Schreiben der Anhänge an dieselben Rechte binden wie die UHS
selbst: Mitgliedschaft in der Organisation, Lesezugriff im Einsatz, Zugriff auf das Modul
Unfallhilfsstellen, für das Schreiben zusätzlich Schreibrecht und einen aktiven Einsatz.
Fehlende Mitgliedschaft, fehlendes Schreibrecht und ein gesperrtes Modul MUST mit 403
antworten, ein abgeschlossener Einsatz beim Schreiben mit 409.

#### Scenario: Beobachter will ablegen
- **WHEN** ein Beobachter eine Datei an einer UHS ablegen will
- **THEN** antwortet das System mit 403 und speichert nichts

#### Scenario: Modul Unfallhilfsstellen für die Rolle gesperrt
- **WHEN** das Modul Unfallhilfsstellen im Einsatz für die Rolle der Person gesperrt ist und sie einen Anhang einer UHS herunterladen will
- **THEN** antwortet das System mit 403 und protokolliert keinen Abruf

#### Scenario: Abgeschlossener Einsatz
- **WHEN** eine Person mit Schreibrecht in einem abgeschlossenen Einsatz eine Datei an einer UHS ablegen oder entfernen will
- **THEN** antwortet das System mit 409, und Liste und Download bleiben innerhalb der Nachlauffrist möglich

#### Scenario: Fremde Organisation
- **WHEN** eine Führungskraft einer anderen Organisation die Anhänge einer UHS abruft
- **THEN** antwortet das System mit 403

### Requirement: Lebenszyklus der UHS

Das System MUST Ablegen und Entfernen an einer stornierten UHS mit 409 abweisen. An einer
geplanten, aktiven oder aufgelösten UHS MUST beides möglich bleiben.

#### Scenario: Ablegen an stornierter UHS
- **WHEN** eine Person eine Datei an einer stornierten UHS ablegen will
- **THEN** antwortet das System mit 409 und speichert weder Datei noch Verknüpfung noch ETB-Eintrag

#### Scenario: Entfernen an stornierter UHS
- **WHEN** eine Person einen Anhang einer stornierten UHS entfernen will
- **THEN** antwortet das System mit 409, und der Anhang bleibt in der Liste

#### Scenario: Nachweis nach Auflösung
- **WHEN** eine Person an einer aufgelösten UHS ein Foto des geräumten Raums ablegt
- **THEN** nimmt das System es an

### Requirement: Anhang einer UHS entfernen

Das System SHALL einer Person mit Schreibrecht erlauben, einen Anhang einer UHS zu
entfernen. Ein entfernter Anhang MUST aus der Liste verschwinden und darf über keinen Weg
mehr heruntergeladen werden; die Datei MUST bis zur Schwärzung des Einsatzes gespeichert
bleiben. Ein bereits entfernter Anhang MUST beim erneuten Entfernen mit 404 antworten.

#### Scenario: Anhang entfernen
- **WHEN** eine Person mit Schreibrecht den Anhang `grundriss_halle.pdf` von „BHP 50“ entfernt
- **THEN** antwortet das System mit 204, die Liste enthält ihn nicht mehr, und sein Download antwortet mit 404

#### Scenario: Doppelt entfernen
- **WHEN** eine Person denselben Anhang ein zweites Mal entfernt
- **THEN** antwortet das System mit 404 und schreibt keinen weiteren ETB-Eintrag

### Requirement: Pseudonyme Spur der UHS-Anhänge im Einsatztagebuch

Das System MUST beim Ablegen und beim Entfernen je einen System-Eintrag im Einsatztagebuch
schreiben, im Wortlaut „UHS BHP 50: Foto abgelegt“ bzw. „UHS BHP 50: PDF entfernt“. Der
Eintrag MUST die UHS über ihre Bezeichnung benennen und MUST NOT den Dateinamen, den
Standort, die Notiz, eine Person oder einen anderen Freitext enthalten. Eine abgewiesene
Ablage MUST keinen Eintrag erzeugen.

#### Scenario: Wortlaut beim Ablegen
- **WHEN** eine Person an „BHP 50“ die Datei `Patient_Mueller_Liege3.jpg` ablegt
- **THEN** enthält das Einsatztagebuch genau einen neuen System-Eintrag „UHS BHP 50: Foto abgelegt“, und kein Eintrag des Einsatzes enthält „Mueller“ oder „Liege3“

#### Scenario: Wortlaut für PDF
- **WHEN** eine Person an „BHP 50“ eine PDF-Datei ablegt und sie danach entfernt
- **THEN** enthält das Einsatztagebuch „UHS BHP 50: PDF abgelegt“ und „UHS BHP 50: PDF entfernt“

#### Scenario: Abgewiesene Ablage
- **WHEN** eine Ablage mit 400, 403, 404, 409, 422 oder 503 abgewiesen wird
- **THEN** entsteht kein ETB-Eintrag

### Requirement: Jeder Abruf einer UHS-Datei wird protokolliert

Vor der Antwort auf jede zugelassene Download-Anfrage eines UHS-Anhangs MUST das System einen
Protokolleintrag mit abrufender Person, Anhang, Fassung (bereinigt oder Original) und
Zeitpunkt anlegen. Das gilt auch für eine Antwort mit 304. Scheitert der Eintrag, MUST
nichts ausgeliefert werden. Eine abgewiesene Anfrage, das Auflisten und das Ablegen MUST NOT
protokolliert werden. Das Protokoll MUST append-only sein.

#### Scenario: Download wird protokolliert
- **WHEN** eine Person mit der Rolle Führungspersonal `grundriss_halle.pdf` an „BHP 50“ herunterlädt
- **THEN** steht danach ein Protokolleintrag mit dieser Person, diesem Anhang, der Fassung „bereinigt“ und dem Zeitpunkt

#### Scenario: Original-Abruf
- **WHEN** die Einsatzleitung ein Foto an „BHP 50“ mit `fassung=original` abruft
- **THEN** stehen ein Protokolleintrag mit der Fassung „Original“ und der ETB-Vermerk des Original-Abrufs

#### Scenario: Protokoll nicht schreibbar
- **WHEN** der Protokolleintrag beim Download nicht geschrieben werden kann
- **THEN** antwortet das System mit einem Fehler und liefert keine Bytes aus

#### Scenario: Liste ohne Protokoll
- **WHEN** eine Person die Anhangliste einer UHS abruft, ohne eine Datei zu laden
- **THEN** entsteht kein Protokolleintrag

### Requirement: Einsicht in das Zugriffsprotokoll

Das System SHALL der Einsatzleitung das Zugriffsprotokoll der Anhänge einer UHS liefern,
neueste zuerst, mit Dateiname, abrufender Person, Fassung und Zeitpunkt, auch für entfernte
Anhänge. Allen anderen Rollen MUST die Einsicht mit 403 verweigert werden. Die Einsicht
selbst MUST NOT protokolliert werden. Die Oberfläche MUST das Protokoll nur der
Einsatzleitung zeigen und es erst beim Aufklappen laden.

#### Scenario: Einsatzleitung sieht die Zugriffe
- **WHEN** die Einsatzleitung im Reiter „Dateien“ von „BHP 50“ „Zugriffe“ aufklappt
- **THEN** sieht sie jeden Abruf mit Dateiname, Person, Fassung und Zeitpunkt, neueste zuerst

#### Scenario: Führungspersonal fragt das Protokoll an
- **WHEN** eine Person mit der Rolle Führungspersonal das Zugriffsprotokoll einer UHS abruft
- **THEN** antwortet das System mit 403, und die Oberfläche zeigt ihr den Bereich „Zugriffe“ nicht

#### Scenario: Entfernter Anhang bleibt im Protokoll
- **WHEN** ein abgerufener Anhang danach entfernt wird
- **THEN** stehen seine Abrufe weiter im Protokoll

### Requirement: Hinweis auf die Protokollierung beim Ablegen

Der Dialog zum Ablegen einer Datei an einer UHS MUST darauf hinweisen, dass jeder Abruf der
Datei protokolliert wird.

#### Scenario: Hinweis im Dialog
- **WHEN** eine Person mit Schreibrecht an „BHP 50“ den Dialog „Datei ablegen“ öffnet
- **THEN** nennt der Dialog, dass Abrufe der Datei protokolliert werden

### Requirement: Live-Verteilung der UHS-Anhänge

Das System MUST nach erfolgreichem Ablegen und Entfernen das Ereignis `uhs` und das
ETB-Ereignis an die Abonnenten des Einsatzes verteilen, beide nur mit Kennungen. Das
Ereignis `uhs` MUST nur Personen mit Zugriff auf das Modul Unfallhilfsstellen erreichen.
Andere Sitzungen MUST die Anhangliste der UHS daraufhin ohne Neuladen der Seite
aktualisieren.

#### Scenario: Zweite Sitzung sieht die neue Datei
- **WHEN** Person A an „BHP 50“ eine Datei ablegt, während Person B den Reiter „Dateien“ von „BHP 50“ geöffnet hat
- **THEN** erscheint die Datei bei B ohne Neuladen, und das Tagebuch zeigt den neuen Eintrag

#### Scenario: Nutzlast ohne Inhalt
- **WHEN** das System nach einer Ablage die Ereignisse verteilt
- **THEN** enthalten sie nur Kennungen (Einsatz, UHS, ETB-Eintrag) und keinen Dateinamen

### Requirement: Sichtbarkeit nur im Modul Unfallhilfsstellen

Anhänge einer UHS MUST ausschließlich über die Anhang-Adressen der UHS erreichbar sein und
MUST NOT in der Dokumentenablage erscheinen. Für jede Person, auch die ablegende, MUST der
generische Anhang-Download mit 404 und der generische Löschpfad mit 422 antworten. Eine
Chat-Nachricht (400) und ein ETB-Eintrag (422) MUST NOT sie verknüpfen können, und der
Versuch MUST nichts ändern.

#### Scenario: Nicht in der Dokumentenablage
- **WHEN** an „BHP 50“ ein Plan abgelegt ist und eine Person die Dokumentenablage des Einsatzes abruft
- **THEN** enthält die Liste den Plan nicht

#### Scenario: Ablegende Person über den generischen Download
- **WHEN** die ablegende Person die Datei über den generischen Anhang-Download des Einsatzes abruft
- **THEN** antwortet das System mit 404 und protokolliert keinen Abruf

#### Scenario: Generisches Löschen
- **WHEN** die ablegende Person die Datei mit Schreibrecht über den generischen Löschpfad löschen will
- **THEN** antwortet das System mit 422, und Datei, Verknüpfung und Liste bleiben unverändert

#### Scenario: Chat und ETB verknüpfen die Datei nicht
- **WHEN** die ablegende Person eine Chat-Nachricht oder einen ETB-Eintrag mit der Kennung der Datei eines UHS-Anhangs anlegt
- **THEN** antwortet das System für den Chat mit 400 und für das ETB mit 422, legt nichts an und verknüpft nichts

### Requirement: Orphan-Sweep hält UHS-Dateien

Der Sweep verwaister Anhänge MUST Dateien, die an einer UHS hängen, unabhängig von ihrem
Alter behalten, auch wenn der Anhang entfernt wurde.

#### Scenario: Alte entfernte UHS-Datei
- **WHEN** der Sweep läuft und eine entfernte UHS-Datei älter als die Karenz von 24 Stunden ist
- **THEN** bleibt sie gespeichert, bis der Einsatz geschwärzt wird

### Requirement: Schwärzung löscht die UHS-Dateien und hält das Protokoll

Die DSGVO-Schwärzung eines Einsatzes MUST alle Dateien an seinen UHS samt Verknüpfung
löschen, einschließlich der entfernten. Die pseudonymen Einträge im Einsatztagebuch und die
Einträge des Zugriffsprotokolls (Person, Fassung, Zeitpunkt) MUST erhalten bleiben.

#### Scenario: Schwärzung nach Ablage, Abruf und Entfernen
- **WHEN** an „BHP 50“ zwei Dateien abgelegt, eine heruntergeladen, eine entfernt und danach der Einsatz geschwärzt wird
- **THEN** gibt es für den Einsatz keine gespeicherte UHS-Datei und keine Verknüpfung mehr, die drei Einträge „UHS BHP 50: … abgelegt/entfernt“ stehen weiter im Einsatztagebuch, und der Protokolleintrag des Abrufs bleibt erhalten
