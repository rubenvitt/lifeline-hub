# Spec Delta

## Purpose

Fotos und PDF-Dateien lassen sich an einem erfassten Schaden ablegen, auflisten,
herunterladen und entfernen. Sichtbar sind sie nur über das Modul Schäden, und im
Einsatztagebuch hinterlassen sie eine pseudonyme Spur ohne Dateinamen. Die DSGVO-Schwärzung
des Einsatzes löscht die Dateien.

## ADDED Requirements

### Requirement: Datei an einem Schaden ablegen

Das System SHALL einer Person mit Schreibrecht im Einsatz und Zugriff auf das Modul
Schäden erlauben, an einem Schaden dieses Einsatzes eine Datei abzulegen. Eine Ablage MUST
genau eine Datei in einer einzigen Anfrage übertragen. Die Datei MUST vor dem Speichern
auf Schadsoftware geprüft werden, und erst nach bestandener Prüfung darf etwas gespeichert
werden. Datei, Verknüpfung mit dem Schaden und Nachweis im Einsatztagebuch MUST gemeinsam
gelingen oder gemeinsam unterbleiben; eine abgelegte Datei MUST zu keinem Zeitpunkt ohne
Verknüpfung gespeichert sein. Die Antwort MUST den angelegten Anhang mit Dateiname,
Dateityp, Größe, ablegender Person und Zeitpunkt liefern.

#### Scenario: Foto ablegen
- **WHEN** eine Person mit Schreibrecht an Schaden S-003 die Datei `dach.jpg` (2 MiB) ablegt
- **THEN** antwortet das System mit 201 und dem Anhang, und die Liste der Anhänge von S-003 enthält `dach.jpg`

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

### Requirement: Erlaubte Dateitypen und Größe

Das System SHALL an einem Schaden nur Bilder in den Formaten JPEG, PNG, WebP, HEIC und HEIF
sowie PDF annehmen. Der Dateityp MUST aus der Dateiendung bestimmt werden, nicht aus der
Typangabe des Clients. Eine leere Datei und eine Datei über 25 MiB MUST abgelehnt werden.
Jede Ablehnung nach dieser Anforderung MUST mit 400 antworten und nichts speichern.

#### Scenario: HEIC vom Mobiltelefon
- **WHEN** eine Person die Datei `IMG_0412.HEIC` ablegt
- **THEN** nimmt das System sie an und führt sie mit dem Typ `image/heic`

#### Scenario: PDF-Gutachten
- **WHEN** eine Person die Datei `kostenvoranschlag.pdf` ablegt
- **THEN** nimmt das System sie an

#### Scenario: Office-Datei
- **WHEN** eine Person die Datei `liste.xlsx` ablegt
- **THEN** antwortet das System mit 400, und die Meldung nennt den nicht erlaubten Dateityp

#### Scenario: Zu große Datei
- **WHEN** eine Person eine Datei mit 25 MiB plus ein Byte ablegt
- **THEN** antwortet das System mit 400 und speichert nichts

#### Scenario: Leere Datei
- **WHEN** eine Person eine Datei mit 0 Byte ablegt
- **THEN** antwortet das System mit 400 und speichert nichts

### Requirement: Anhänge eines Schadens auflisten und herunterladen

Das System SHALL jeder Person mit Lesezugriff im Einsatz und Zugriff auf das Modul Schäden
die nicht entfernten Anhänge eines Schadens auflisten, neueste zuerst, und den Download
jedes dieser Anhänge erlauben. Das gilt auch für Beobachter und für einen stornierten
Schaden. Der Download MUST die Datei als Anlage mit ihrem Dateinamen ausliefern und ein
Validierungsmerkmal (ETag) tragen. Eine Anfrage mit passendem `If-None-Match` MUST mit 304
ohne Inhalt beantwortet werden.

#### Scenario: Beobachter lädt herunter
- **WHEN** ein Beobachter des Einsatzes einen Anhang von S-003 herunterlädt
- **THEN** erhält er die Datei mit `Content-Disposition: attachment` und einem ETag

#### Scenario: Erneuter Abruf mit ETag
- **WHEN** der Client denselben Anhang mit dem zuvor erhaltenen ETag in `If-None-Match` abruft
- **THEN** antwortet das System mit 304 ohne Inhalt

#### Scenario: Stornierter Schaden bleibt lesbar
- **WHEN** eine Person die Anhänge eines stornierten Schadens abruft
- **THEN** erhält sie die Liste und kann jede Datei herunterladen

### Requirement: Zugehörigkeit zum Einsatz und zum Schaden

Das System MUST jede Anfrage auf Anhänge eines Schadens abweisen, wenn der Schaden nicht zu
dem Einsatz der Adresse gehört oder der Anhang nicht zu dem Schaden der Adresse gehört. In
beiden Fällen MUST die Antwort 404 lauten, damit sich aus der Antwort nicht auf fremde
Datensätze schließen lässt. Ein Anhang MUST immer demselben Einsatz angehören wie sein
Schaden.

#### Scenario: Schaden eines fremden Einsatzes
- **WHEN** eine Person die Anhänge von Schaden 17 über die Adresse ihres Einsatzes 4 abruft, Schaden 17 aber zu Einsatz 9 gehört
- **THEN** antwortet das System mit 404

#### Scenario: Anhang eines anderen Schadens
- **WHEN** eine Person einen Anhang von S-001 über die Adresse von S-002 im selben Einsatz herunterlädt
- **THEN** antwortet das System mit 404

#### Scenario: Entfernen über fremde Adresse
- **WHEN** eine Person einen Anhang über die Adresse eines Schadens entfernen will, zu dem er nicht gehört
- **THEN** antwortet das System mit 404 und ändert nichts

### Requirement: Rechte über das Modul Schäden

Das System MUST Lesen und Schreiben der Anhänge an dieselben Rechte binden wie den Schaden
selbst: Mitgliedschaft in der Organisation, Lesezugriff im Einsatz einschließlich der
Nachlauf- und Aufbewahrungsregeln, Zugriff auf das Modul Schäden, für das Schreiben
zusätzlich Schreibrecht und einen aktiven Einsatz. Eine fehlende Mitgliedschaft in der
Organisation, ein fehlendes Schreibrecht und ein gesperrtes Modul Schäden MUST mit 403
antworten, ein abgeschlossener Einsatz beim Schreiben mit 409.

#### Scenario: Beobachter will ablegen
- **WHEN** ein Beobachter eine Datei an einem Schaden ablegen will
- **THEN** antwortet das System mit 403 und speichert nichts

#### Scenario: Modul Schäden für die Rolle gesperrt
- **WHEN** das Modul Schäden im Einsatz für die Rolle der Person gesperrt ist und sie die Anhänge eines Schadens abruft
- **THEN** antwortet das System mit 403

#### Scenario: Abgeschlossener Einsatz
- **WHEN** eine Person mit Schreibrecht in einem abgeschlossenen Einsatz eine Datei ablegen oder einen Anhang entfernen will
- **THEN** antwortet das System mit 409, und Liste und Download bleiben innerhalb der Nachlauffrist möglich

#### Scenario: Fremde Organisation
- **WHEN** eine Führungskraft einer anderen Organisation die Anhänge eines Schadens abruft
- **THEN** antwortet das System mit 403

### Requirement: Lebenszyklus des Schadens

Das System MUST Ablegen und Entfernen an einem stornierten Schaden mit 409 abweisen. An
einem offenen, übergebenen oder abgeschlossenen Schaden MUST beides möglich bleiben.

#### Scenario: Ablegen an storniertem Schaden
- **WHEN** eine Person eine Datei an einem stornierten Schaden ablegen will
- **THEN** antwortet das System mit 409 und speichert weder Datei noch Verknüpfung noch ETB-Eintrag

#### Scenario: Entfernen an storniertem Schaden
- **WHEN** eine Person einen Anhang eines stornierten Schadens entfernen will
- **THEN** antwortet das System mit 409, und der Anhang bleibt in der Liste

#### Scenario: Nachweis nach Abschluss
- **WHEN** eine Person an einem abgeschlossenen Schaden ein Foto der Instandsetzung ablegt
- **THEN** nimmt das System es an

### Requirement: Anhang entfernen

Das System SHALL einer Person mit Schreibrecht erlauben, einen Anhang eines Schadens zu
entfernen. Ein entfernter Anhang MUST aus der Liste verschwinden und darf über keinen Weg
mehr heruntergeladen werden. Die Datei MUST dabei bis zur Schwärzung des Einsatzes
gespeichert bleiben. Ein bereits entfernter Anhang MUST beim erneuten Entfernen mit 404
antworten.

#### Scenario: Anhang entfernen
- **WHEN** eine Person mit Schreibrecht den Anhang `dach.jpg` von S-003 entfernt
- **THEN** antwortet das System mit 204, die Liste enthält ihn nicht mehr, und sein Download antwortet mit 404

#### Scenario: Doppelt entfernen
- **WHEN** eine Person denselben Anhang ein zweites Mal entfernt
- **THEN** antwortet das System mit 404 und schreibt keinen weiteren ETB-Eintrag

#### Scenario: Datei bleibt als Beweis erhalten
- **WHEN** ein Anhang entfernt wurde und später der Orphan-Sweep läuft
- **THEN** bleibt die Datei gespeichert

### Requirement: Pseudonyme Spur im Einsatztagebuch

Das System MUST beim Ablegen und beim Entfernen je einen System-Eintrag im Einsatztagebuch
schreiben. Der Eintrag MUST den Schaden über seine Registriernummer benennen und die Art
der Datei als „Foto“ (Bild) oder „PDF“ angeben, im Wortlaut „Schaden S-003: Foto abgelegt“
bzw. „Schaden S-003: Foto entfernt“. Er MUST NOT den Dateinamen, die Beschreibung, den
Ort, den Geschädigten oder einen anderen Freitext enthalten.

#### Scenario: Wortlaut beim Ablegen
- **WHEN** eine Person an S-003 die Datei `Müller_Hauswand.jpg` ablegt
- **THEN** enthält das Einsatztagebuch genau einen neuen System-Eintrag „Schaden S-003: Foto abgelegt“, und kein Eintrag des Einsatzes enthält „Müller“ oder „Hauswand“

#### Scenario: Wortlaut für PDF
- **WHEN** eine Person an S-003 eine PDF-Datei ablegt und sie danach entfernt
- **THEN** enthält das Einsatztagebuch „Schaden S-003: PDF abgelegt“ und „Schaden S-003: PDF entfernt“

#### Scenario: Abgewiesene Ablage
- **WHEN** eine Ablage mit 400, 403, 404, 409, 422 oder 503 abgewiesen wird
- **THEN** entsteht kein ETB-Eintrag

### Requirement: Live-Verteilung

Das System MUST nach erfolgreichem Ablegen und Entfernen das Ereignis `schaden` und das
ETB-Ereignis an die Abonnenten des Einsatzes verteilen, beide ohne Dateinamen oder andere
Inhalte. Das Ereignis `schaden` MUST nur Personen mit Zugriff auf das Modul Schäden
erreichen. Andere Sitzungen MUST die Anhangliste des Schadens daraufhin neu laden, ohne
dass die Person die Seite neu lädt.

#### Scenario: Zweite Sitzung sieht die neue Datei
- **WHEN** Person A an S-003 eine Datei ablegt, während Person B die Detailseite von S-003 geöffnet hat
- **THEN** erscheint die Datei bei B ohne Neuladen, und das Tagebuch zeigt den neuen Eintrag

#### Scenario: Nutzlast ohne Inhalt
- **WHEN** das System nach einer Ablage die Ereignisse verteilt
- **THEN** enthalten sie nur Kennungen (Einsatz, Schaden, ETB-Eintrag) und keinen Dateinamen

### Requirement: Sichtbarkeit nur im Modul Schäden

Anhänge eines Schadens MUST ausschließlich über die Anhang-Adressen des Schadens erreichbar
sein. Sie MUST NOT in der Dokumentenablage erscheinen. Der generische Anhang-Download des
Einsatzes MUST für sie mit 404 antworten, der generische Löschpfad mit 422 — für jede
Person, ausdrücklich auch für die Person, die die Datei abgelegt hat. Eine Chat-Nachricht
und ein ETB-Eintrag MUST NOT sie als eigenen Anhang verknüpfen können, und der Versuch MUST
nichts ändern: die Chat-Nachricht wird mit 400 abgewiesen, der ETB-Eintrag mit 422, weil
die Datei bereits gebunden ist.

#### Scenario: Nicht in der Dokumentenablage
- **WHEN** an S-003 ein Foto abgelegt ist und eine Person die Dokumentenablage des Einsatzes abruft
- **THEN** enthält die Liste das Foto nicht

#### Scenario: Recht auf Dokumente genügt nicht
- **WHEN** eine Person Zugriff auf das Modul Dokumente hat, aber nicht auf das Modul Schäden, und den Anhang von S-003 herunterladen will
- **THEN** antwortet das System mit 403 über die Schadens-Adresse und mit 404 über den generischen Anhang-Download

#### Scenario: Ablegende Person über den generischen Download
- **WHEN** die Person, die `dach.jpg` an S-003 abgelegt hat, die Datei über den generischen Anhang-Download des Einsatzes abruft
- **THEN** antwortet das System mit 404

#### Scenario: Generisches Löschen
- **WHEN** die Person, die die Datei abgelegt hat, sie mit Schreibrecht über den generischen Löschpfad löschen will
- **THEN** antwortet das System mit 422, und Datei, Verknüpfung und Liste bleiben unverändert

#### Scenario: Chat-Nachricht verknüpft Schaden-Datei
- **WHEN** die ablegende Person eine Chat-Nachricht mit der Kennung der Datei eines Schaden-Anhangs sendet
- **THEN** antwortet das System mit 400, legt keine Nachricht an und verknüpft nichts

#### Scenario: ETB-Eintrag verknüpft Schaden-Datei
- **WHEN** die ablegende Person einen ETB-Eintrag mit der Kennung der Datei eines Schaden-Anhangs erfasst
- **THEN** antwortet das System mit 422, legt keinen Eintrag an und verknüpft nichts

### Requirement: Orphan-Sweep hält gebundene Dateien

Der Sweep verwaister Anhänge MUST Dateien, die an einem Schaden hängen, unabhängig von
ihrem Alter behalten, auch wenn der Anhang entfernt wurde.

#### Scenario: Alte Schaden-Datei
- **WHEN** der Sweep läuft und eine Schaden-Datei älter als die Karenz von 24 Stunden ist
- **THEN** bleibt sie gespeichert und über die Schadens-Adresse ladbar

#### Scenario: Alte entfernte Schaden-Datei
- **WHEN** der Sweep läuft und eine entfernte Schaden-Datei älter als die Karenz von 24 Stunden ist
- **THEN** bleibt sie gespeichert, bis der Einsatz geschwärzt wird

### Requirement: Schwärzung löscht die Dateien

Die DSGVO-Schwärzung eines Einsatzes MUST alle Dateien an seinen Schäden samt Verknüpfung
löschen, einschließlich der entfernten. Die pseudonymen Einträge im Einsatztagebuch MUST
dabei erhalten bleiben.

#### Scenario: Schwärzung nach Ablage und Entfernen
- **WHEN** an S-003 zwei Dateien abgelegt, eine davon entfernt und danach der Einsatz geschwärzt wird
- **THEN** gibt es für den Einsatz keine gespeicherte Datei und keine Verknüpfung mehr, und die drei Einträge „Schaden S-003: … abgelegt/entfernt“ stehen weiter im Einsatztagebuch
