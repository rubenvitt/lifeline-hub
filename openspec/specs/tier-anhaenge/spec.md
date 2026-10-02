# tier-anhaenge Specification

## Purpose
Fotos und PDF-Dateien lassen sich an einem erfassten Tier ablegen, auflisten, herunterladen
und entfernen. Sichtbar sind sie nur über das Modul Tiere. Im Einsatztagebuch hinterlassen
sie eine pseudonyme Spur ohne Dateinamen, und die DSGVO-Schwärzung des Einsatzes löscht sie.

## Requirements

### Requirement: Datei an einem Tier ablegen

Das System SHALL einer Person mit Schreibrecht im Einsatz und Zugriff auf das Modul Tiere
erlauben, an einem Tier dieses Einsatzes eine Datei abzulegen. Eine Ablage MUST genau eine
Datei in einer Anfrage übertragen und MUST vor dem Speichern auf Schadsoftware geprüft
werden. Datei, Verknüpfung mit dem Tier und Nachweis im Einsatztagebuch MUST gemeinsam
gelingen oder gemeinsam unterbleiben. Die Antwort MUST den Anhang mit Dateiname, Typ,
Größe, ablegender Person und Zeitpunkt liefern.

#### Scenario: Foto eines Fundtieres ablegen
- **WHEN** eine Person mit Schreibrecht an Tier T-007 die Datei `hund.jpg` (2 MiB) ablegt
- **THEN** antwortet das System mit 201 und dem Anhang, und die Liste der Anhänge von T-007 enthält `hund.jpg`

#### Scenario: Anfrage ohne oder mit zwei Dateien
- **WHEN** eine Ablage-Anfrage kein Dateifeld oder zwei Dateifelder enthält
- **THEN** antwortet das System mit 400 und speichert nichts

#### Scenario: Scanner nicht erreichbar
- **WHEN** der Virenscanner konfiguriert, aber nicht erreichbar ist und kein Fail-open gesetzt ist
- **THEN** antwortet das System mit 503 und legt weder Datei noch Verknüpfung noch ETB-Eintrag an

#### Scenario: Schadsoftware gefunden
- **WHEN** der Scanner in der Datei einen Fund meldet
- **THEN** antwortet das System mit 422 und legt weder Datei noch Verknüpfung noch ETB-Eintrag an

### Requirement: Erlaubte Dateitypen und Größe am Tier

Das System SHALL an einem Tier nur Bilder in den Formaten JPEG, PNG, WebP, HEIC und HEIF
sowie PDF annehmen. Der Dateityp MUST aus der Dateiendung bestimmt werden, nicht aus der
Typangabe des Clients. Eine leere Datei und eine Datei über 25 MiB MUST abgelehnt werden.
Jede Ablehnung nach dieser Anforderung MUST mit 400 antworten und nichts speichern.

#### Scenario: HEIC vom Mobiltelefon
- **WHEN** eine Person die Datei `IMG_0412.HEIC` an einem Tier ablegt
- **THEN** nimmt das System sie an und führt sie mit dem Typ `image/heic`

#### Scenario: Office-Datei
- **WHEN** eine Person die Datei `liste.xlsx` an einem Tier ablegt
- **THEN** antwortet das System mit 400, und die Meldung nennt den nicht erlaubten Dateityp

#### Scenario: Zu große oder leere Datei
- **WHEN** eine Person eine Datei mit 25 MiB plus ein Byte oder mit 0 Byte ablegt
- **THEN** antwortet das System mit 400 und speichert nichts

### Requirement: Anhänge eines Tieres auflisten und herunterladen

Das System SHALL jeder Person mit Lesezugriff im Einsatz und Zugriff auf das Modul Tiere die
nicht entfernten Anhänge eines Tieres auflisten, neueste zuerst, und deren Download
erlauben, auch Beobachtern und an einem stornierten Tier. Der Download MUST die Datei als
Anlage mit ihrem Dateinamen und einem ETag ausliefern; ein passendes `If-None-Match` MUST
mit 304 ohne Inhalt beantwortet werden. Ein Abruf MUST NOT protokolliert werden.

#### Scenario: Beobachter lädt herunter
- **WHEN** ein Beobachter des Einsatzes einen Anhang von T-007 herunterlädt
- **THEN** erhält er die Datei mit `Content-Disposition: attachment` und einem ETag

#### Scenario: Erneuter Abruf mit ETag
- **WHEN** der Client denselben Anhang mit dem zuvor erhaltenen ETag in `If-None-Match` abruft
- **THEN** antwortet das System mit 304 ohne Inhalt

#### Scenario: Storniertes Tier bleibt lesbar
- **WHEN** eine Person die Anhänge eines stornierten Tieres abruft
- **THEN** erhält sie die Liste und kann jede Datei herunterladen

### Requirement: Zugehörigkeit zum Einsatz und zum Tier

Das System MUST jede Anfrage auf Anhänge eines Tieres mit 404 abweisen, wenn das Tier nicht
zu dem Einsatz der Adresse gehört oder der Anhang nicht zu dem Tier der Adresse gehört. Ein
Anhang MUST immer demselben Einsatz angehören wie sein Tier.

#### Scenario: Tier eines fremden Einsatzes
- **WHEN** eine Person die Anhänge von Tier 17 über die Adresse ihres Einsatzes 4 abruft, Tier 17 aber zu Einsatz 9 gehört
- **THEN** antwortet das System mit 404

#### Scenario: Anhang eines anderen Tieres
- **WHEN** eine Person einen Anhang von T-001 über die Adresse von T-002 im selben Einsatz herunterlädt oder entfernt
- **THEN** antwortet das System mit 404 und ändert nichts

### Requirement: Rechte über das Modul Tiere

Das System MUST Lesen und Schreiben der Anhänge an dieselben Rechte binden wie das Tier
selbst: Mitgliedschaft in der Organisation, Lesezugriff im Einsatz, Zugriff auf das Modul
Tiere, für das Schreiben zusätzlich Schreibrecht und einen aktiven Einsatz. Fehlende
Mitgliedschaft, fehlendes Schreibrecht und ein gesperrtes Modul MUST mit 403 antworten, ein
abgeschlossener Einsatz beim Schreiben mit 409.

#### Scenario: Beobachter will ablegen
- **WHEN** ein Beobachter eine Datei an einem Tier ablegen will
- **THEN** antwortet das System mit 403 und speichert nichts

#### Scenario: Modul Tiere für die Rolle gesperrt
- **WHEN** das Modul Tiere im Einsatz für die Rolle der Person gesperrt ist und sie die Anhänge eines Tieres abruft
- **THEN** antwortet das System mit 403

#### Scenario: Abgeschlossener Einsatz
- **WHEN** eine Person mit Schreibrecht in einem abgeschlossenen Einsatz eine Datei an einem Tier ablegen oder entfernen will
- **THEN** antwortet das System mit 409, und Liste und Download bleiben innerhalb der Nachlauffrist möglich

#### Scenario: Fremde Organisation
- **WHEN** eine Führungskraft einer anderen Organisation die Anhänge eines Tieres abruft
- **THEN** antwortet das System mit 403

### Requirement: Lebenszyklus des Tieres

Das System MUST Ablegen und Entfernen an einem stornierten Tier mit 409 abweisen. An einem
aktiven, vermissten oder abgeschlossenen Tier MUST beides möglich bleiben.

#### Scenario: Ablegen an storniertem Tier
- **WHEN** eine Person eine Datei an einem stornierten Tier ablegen will
- **THEN** antwortet das System mit 409 und speichert weder Datei noch Verknüpfung noch ETB-Eintrag

#### Scenario: Entfernen an storniertem Tier
- **WHEN** eine Person einen Anhang eines stornierten Tieres entfernen will
- **THEN** antwortet das System mit 409, und der Anhang bleibt in der Liste

#### Scenario: Foto nach Übergabe ans Tierheim
- **WHEN** eine Person an einem abgeschlossenen Tier ein Foto ablegt
- **THEN** nimmt das System es an

### Requirement: Anhang eines Tieres entfernen

Das System SHALL einer Person mit Schreibrecht erlauben, einen Anhang eines Tieres zu
entfernen. Ein entfernter Anhang MUST aus der Liste verschwinden und darf über keinen Weg
mehr heruntergeladen werden; die Datei MUST bis zur Schwärzung des Einsatzes gespeichert
bleiben. Ein bereits entfernter Anhang MUST beim erneuten Entfernen mit 404 antworten.

#### Scenario: Anhang entfernen
- **WHEN** eine Person mit Schreibrecht den Anhang `hund.jpg` von T-007 entfernt
- **THEN** antwortet das System mit 204, die Liste enthält ihn nicht mehr, und sein Download antwortet mit 404

#### Scenario: Doppelt entfernen
- **WHEN** eine Person denselben Anhang ein zweites Mal entfernt
- **THEN** antwortet das System mit 404 und schreibt keinen weiteren ETB-Eintrag

### Requirement: Pseudonyme Spur der Tier-Anhänge im Einsatztagebuch

Das System MUST beim Ablegen und beim Entfernen je einen System-Eintrag im Einsatztagebuch
schreiben, im Wortlaut „Tier T-007: Foto abgelegt“ bzw. „Tier T-007: PDF entfernt“. Der
Eintrag MUST das Tier über seine Registriernummer benennen und MUST NOT den Dateinamen, die
Kennzeichnung, den Halter, den Antreffort oder einen anderen Freitext enthalten. Eine
abgewiesene Ablage MUST keinen Eintrag erzeugen.

#### Scenario: Wortlaut beim Ablegen
- **WHEN** eine Person an T-007 die Datei `Müller_Bello.jpg` ablegt
- **THEN** enthält das Einsatztagebuch genau einen neuen System-Eintrag „Tier T-007: Foto abgelegt“, und kein Eintrag des Einsatzes enthält „Müller“ oder „Bello“

#### Scenario: Wortlaut für PDF
- **WHEN** eine Person an T-007 eine PDF-Datei ablegt und sie danach entfernt
- **THEN** enthält das Einsatztagebuch „Tier T-007: PDF abgelegt“ und „Tier T-007: PDF entfernt“

#### Scenario: Abgewiesene Ablage
- **WHEN** eine Ablage mit 400, 403, 404, 409, 422 oder 503 abgewiesen wird
- **THEN** entsteht kein ETB-Eintrag

### Requirement: Live-Verteilung der Tier-Anhänge

Das System MUST nach erfolgreichem Ablegen und Entfernen das Ereignis `tier` und das
ETB-Ereignis an die Abonnenten des Einsatzes verteilen, beide nur mit Kennungen. Das
Ereignis `tier` MUST nur Personen mit Zugriff auf das Modul Tiere erreichen. Andere
Sitzungen MUST die neue Datei ohne Neuladen anbieten, ohne gezeigte Zeilen zu verschieben.

#### Scenario: Zweite Sitzung erfährt von der neuen Datei
- **WHEN** Person A an T-007 eine Datei ablegt, während Person B die Detailseite von T-007 mit mindestens einer Datei geöffnet hat
- **THEN** zeigt B ohne Neuladen den Hinweis „1 neue Datei“, die gezeigten Zeilen bleiben stehen, nach „anzeigen“ steht die Datei oben in der Liste, und das Tagebuch zeigt den neuen Eintrag

#### Scenario: Leere Liste nimmt die Datei direkt auf
- **WHEN** Person A an T-007 eine Datei ablegt, während die Liste bei Person B noch leer ist
- **THEN** erscheint die Datei bei B ohne Neuladen und ohne Hinweis

#### Scenario: Nutzlast ohne Inhalt
- **WHEN** das System nach einer Ablage die Ereignisse verteilt
- **THEN** enthalten sie nur Kennungen (Einsatz, Tier, ETB-Eintrag) und keinen Dateinamen

### Requirement: Sichtbarkeit nur im Modul Tiere

Anhänge eines Tieres MUST ausschließlich über die Anhang-Adressen des Tieres erreichbar sein
und MUST NOT in der Dokumentenablage erscheinen. Für jede Person, auch die ablegende, MUST
der generische Anhang-Download mit 404 und der generische Löschpfad mit 422 antworten. Eine
Chat-Nachricht (400) und ein ETB-Eintrag (422) MUST NOT sie verknüpfen können, und der
Versuch MUST nichts ändern.

#### Scenario: Nicht in der Dokumentenablage
- **WHEN** an T-007 ein Foto abgelegt ist und eine Person die Dokumentenablage des Einsatzes abruft
- **THEN** enthält die Liste das Foto nicht

#### Scenario: Ablegende Person über den generischen Download
- **WHEN** die Person, die `hund.jpg` an T-007 abgelegt hat, die Datei über den generischen Anhang-Download des Einsatzes abruft
- **THEN** antwortet das System mit 404

#### Scenario: Generisches Löschen
- **WHEN** die ablegende Person die Datei mit Schreibrecht über den generischen Löschpfad löschen will
- **THEN** antwortet das System mit 422, und Datei, Verknüpfung und Liste bleiben unverändert

#### Scenario: Chat und ETB verknüpfen die Datei nicht
- **WHEN** die ablegende Person eine Chat-Nachricht oder einen ETB-Eintrag mit der Kennung der Datei eines Tier-Anhangs anlegt
- **THEN** antwortet das System für den Chat mit 400 und für das ETB mit 422, legt nichts an und verknüpft nichts

### Requirement: Orphan-Sweep hält Tier-Dateien

Der Sweep verwaister Anhänge MUST Dateien, die an einem Tier hängen, unabhängig von ihrem
Alter behalten, auch wenn der Anhang entfernt wurde.

#### Scenario: Alte entfernte Tier-Datei
- **WHEN** der Sweep läuft und eine entfernte Tier-Datei älter als die Karenz von 24 Stunden ist
- **THEN** bleibt sie gespeichert, bis der Einsatz geschwärzt wird

### Requirement: Schwärzung löscht die Tier-Dateien

Die DSGVO-Schwärzung eines Einsatzes MUST alle Dateien an seinen Tieren samt Verknüpfung
löschen, einschließlich der entfernten. Die pseudonymen Einträge im Einsatztagebuch MUST
dabei erhalten bleiben.

#### Scenario: Schwärzung nach Ablage und Entfernen
- **WHEN** an T-007 zwei Dateien abgelegt, eine davon entfernt und danach der Einsatz geschwärzt wird
- **THEN** gibt es für den Einsatz keine gespeicherte Tier-Datei und keine Verknüpfung mehr, und die drei Einträge „Tier T-007: … abgelegt/entfernt“ stehen weiter im Einsatztagebuch
