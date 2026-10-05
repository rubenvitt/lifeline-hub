# Spec Delta

## Purpose

Eine Unfallhilfsstelle kann einen Plan oder Grundriss als Hintergrundbild unter ihrem
Platz-Layout tragen, damit Helfende die Plätze im Gebäude verorten. Die Anzeige des Plans
schreibt kein Lese-Audit, damit das Protokoll der UHS-Dateien aussagekräftig bleibt.

## ADDED Requirements

### Requirement: Höchstens ein Plan je UHS

Eine UHS SHALL höchstens einen Plan tragen. Ein neu hinterlegter Plan MUST den bisherigen
ersetzen. Der Plan MUST kein Anhang der UHS sein: Er erscheint nicht in der Liste der Dateien,
und Entfernen oder Ersetzen des Plans ändert keinen Anhang.

#### Scenario: Plan ersetzen
- **WHEN** an „BHP 50“ schon ein Plan liegt und eine Person mit Schreibrecht ein neues Bild als Plan hinterlegt
- **THEN** zeigt der Grundriss nur noch das neue Bild, und die Liste der Dateien von „BHP 50“ ist unverändert

#### Scenario: Plan ist keine Datei
- **WHEN** an „BHP 50“ ein Plan hochgeladen wurde
- **THEN** enthält der Reiter „Dateien“ von „BHP 50“ keinen neuen Eintrag

### Requirement: Plan hochladen

Das System SHALL einer Person mit Schreibrecht auf das Modul Unfallhilfsstellen und der
Erlaubnis, Plätze zu bearbeiten, erlauben, ein Bild als Plan hochzuladen. Erlaubt sind PNG,
JPEG und WebP, bestimmt aus dem Inhalt der Datei, mit höchstens 25 MiB. Eine leere oder zu
große Datei oder ein anderes Format MUST mit 400 abgelehnt werden. Der Virenscan MUST vor dem
Speichern laufen, mit denselben Antworten wie beim Ablegen einer UHS-Datei.

#### Scenario: Hallenplan als PNG
- **WHEN** eine Person mit Schreibrecht an „BHP 50“ die Datei `halle.png` als Plan hochlädt
- **THEN** antwortet das System mit dem Plan samt Bildmaßen, und der Grundriss von „BHP 50“ zeigt das Bild

#### Scenario: PDF als Plan
- **WHEN** eine Person `grundriss.pdf` als Plan hochlädt
- **THEN** antwortet das System mit 400, die Meldung nennt die erlaubten Bildformate, und es wird nichts gespeichert

#### Scenario: Scanner nicht erreichbar
- **WHEN** der Virenscanner konfiguriert, aber nicht erreichbar ist und kein Fail-open gesetzt ist
- **THEN** antwortet das System mit 503 und speichert weder Plan noch ETB-Eintrag

### Requirement: Plan ohne Metadaten

Das System MUST einen Plan ohne eingebettete Metadaten wie Aufnahmeort, Kamera oder Zeitpunkt
speichern. Lassen sich die Metadaten eines Bildes nicht sicher entfernen, MUST das System den
Plan mit 422 ablehnen und nichts speichern.

#### Scenario: Handyfoto mit GPS-Daten
- **WHEN** ein JPEG mit GPS-Koordinaten in den EXIF-Daten als Plan hochgeladen und danach abgerufen wird
- **THEN** enthalten die ausgelieferten Bytes weder die GPS-Koordinaten noch Kamera- oder Zeitangaben

### Requirement: Plan aus den Dateien der UHS übernehmen

Das System SHALL einer Person mit denselben Rechten wie beim Hochladen erlauben, einen
nicht entfernten Bild-Anhang derselben UHS als Plan zu übernehmen. Die Übernahme MUST das Bild
als Kopie ohne Metadaten speichern, sodass späteres Entfernen des Anhangs den Plan nicht
berührt. Ein Anhang einer anderen UHS MUST mit 404 abgewiesen werden, ein Anhang in einem
anderen Format als PNG, JPEG oder WebP mit 422.

#### Scenario: Plan aus „Dateien“
- **WHEN** an „BHP 50“ der Anhang `grundriss_halle.png` liegt und eine Person mit Schreibrecht ihn als Plan übernimmt
- **THEN** zeigt der Grundriss das Bild, und der Anhang bleibt unverändert in „Dateien“

#### Scenario: Anhang danach entfernt
- **WHEN** der übernommene Anhang anschließend aus „Dateien“ entfernt wird
- **THEN** bleibt der Plan im Grundriss stehen

#### Scenario: PDF-Anhang
- **WHEN** eine Person den Anhang `grundriss_halle.pdf` als Plan übernehmen will
- **THEN** antwortet das System mit 422, und die Meldung sagt, dass nur Bilder als Plan dienen

#### Scenario: Anhang einer anderen UHS
- **WHEN** eine Person an „BHP 50“ einen Anhang von „PA 1“ als Plan übernehmen will
- **THEN** antwortet das System mit 404 und speichert nichts

### Requirement: Übernahme ist genau ein protokollierter Abruf

Die Übernahme eines Anhangs als Plan MUST genau eine Zeile ins Lese-Audit der UHS-Dateien
schreiben, bevor der Plan gespeichert wird. Scheitert diese Zeile, MUST die Übernahme
scheitern. Das Anzeigen des Plans MUST danach keine Zeile mehr schreiben.

#### Scenario: Einsatzleitung sieht die Übernahme
- **WHEN** eine Person `grundriss_halle.png` als Plan übernommen hat und die Einsatzleitung die Zugriffe von „BHP 50“ aufklappt
- **THEN** steht dort genau ein Abruf dieser Datei durch diese Person

### Requirement: Anzeige ohne Protokoll

Das System SHALL jeder Person mit Lesezugriff auf das Modul Unfallhilfsstellen das Bild des
Plans ausliefern, auch Beobachtern und an einer stornierten UHS. Die Auslieferung MUST weder
eine Zeile ins Lese-Audit noch einen ETB-Eintrag schreiben. Sie MUST ein ETag tragen, und ein
passendes `If-None-Match` MUST mit 304 ohne Inhalt beantwortet werden.

#### Scenario: Grundriss zehnmal geöffnet
- **WHEN** drei Personen den Grundriss von „BHP 50“ mit Plan zusammen zehnmal öffnen
- **THEN** wächst weder das Lese-Audit von „BHP 50“ noch das ETB

#### Scenario: Erneuter Abruf
- **WHEN** der Client das Bild mit dem zuvor erhaltenen ETag in `If-None-Match` abruft
- **THEN** antwortet das System mit 304 ohne Inhalt

### Requirement: Nachweis im Einsatztagebuch

Hinterlegen und Entfernen eines Plans SHALL je einen System-Eintrag im ETB schreiben, der die
UHS über ihre Bezeichnung nennt, etwa „UHS BHP 50: Plan hinterlegt“ und „UHS BHP 50: Plan
entfernt“. Der Eintrag MUST NOT den Dateinamen nennen. Plan und Eintrag MUST gemeinsam
gelingen oder gemeinsam unterbleiben. Eine Änderung von Lage oder Darstellung MUST keinen
Eintrag schreiben.

#### Scenario: Hochladen
- **WHEN** an „BHP 50“ ein Plan hochgeladen wird
- **THEN** steht im ETB „UHS BHP 50: Plan hinterlegt“, ohne Dateinamen

#### Scenario: Verschieben
- **WHEN** der Plan um 40 px verschoben wird
- **THEN** entsteht kein ETB-Eintrag

### Requirement: Lage des Plans zur Platzfläche

Ein Plan SHALL einen Versatz und eine Breite in den Koordinaten der Platzfläche tragen, die
Höhe MUST aus dem Seitenverhältnis des Bildes folgen. Versatz und Breite MUST auf Vielfache von
10 px gerundet gespeichert werden. Die Breite MUST zwischen 100 und 5000 px liegen, sonst 400.
Ein neuer Plan MUST so liegen, dass er alle vorhandenen Plätze überdeckt. Die Platzfläche MUST
groß genug sein, um Plan und Plätze ganz zu zeigen.

#### Scenario: Erster Plan bei zehn Plätzen
- **WHEN** an einer UHS mit zehn Plätzen im Raster ein Plan hochgeladen wird
- **THEN** überdeckt der Plan alle zehn Plätze, und die Fläche lässt sich bis zum Rand des Plans scrollen

#### Scenario: Einrasten
- **WHEN** der Versatz auf x = 37 gesetzt wird
- **THEN** speichert das System x = 40

#### Scenario: An Plätze einpassen
- **WHEN** nach dem Verschieben von Plätzen „An Plätze einpassen“ gewählt wird
- **THEN** liegt der Plan wieder über allen Plätzen

### Requirement: Darstellung für den Nachtbetrieb

Ein Plan SHALL eine Helligkeit von 20 bis 100 % und einen Kontrast von 50 bis 150 % tragen,
Vorgabe je 100 %. Werte außerhalb MUST mit 400 abgelehnt werden. Im dunklen Thema MUST der
Plan umgekehrt dargestellt werden, sodass helle Flächen dunkel erscheinen, außer die Umkehr ist
für diesen Plan abgeschaltet.

#### Scenario: Weißer Plan nachts
- **WHEN** ein Plan mit weißem Grund im dunklen Thema mit Vorgabewerten angezeigt wird
- **THEN** erscheint sein Grund dunkel

#### Scenario: Luftbild ohne Umkehr
- **WHEN** für einen Plan die Umkehr im dunklen Thema abgeschaltet ist
- **THEN** erscheint das Bild im dunklen Thema mit seinen eigenen Farben, gedimmt nach seiner Helligkeit

### Requirement: Plätze bleiben auf dem Plan bedienbar

Der Plan MUST unter allen Platzkarten liegen und MUST NOT Klicks, Tipps oder Züge annehmen.
Jede Platzkarte MUST auf dem Plan ihren deckenden Grund, ihre Größe und die Bedienform ihrer
Dichtestufe behalten, wie ohne Plan. Ein Tipp auf eine Stelle des Plans ohne Platzkarte MUST
nichts auslösen.

#### Scenario: Handschuh auf dem Plan
- **WHEN** ein Grundriss mit Plan in der Stufe „Handschuh“ geöffnet und auf einen unbelegten Platz getippt wird
- **THEN** öffnet sich das Aktionsmenü dieses Platzes, wie ohne Plan

#### Scenario: Platz verschieben über dem Plan
- **WHEN** im Bearbeiten-Modus ein Platz über den Plan gezogen und abgelegt wird
- **THEN** erhält der Platz die neue Position, und der Plan bleibt unverändert

### Requirement: Rechte am Plan

Hinterlegen, Ändern und Entfernen eines Plans MUST Schreibrecht im Einsatz, Zugriff auf das
Modul Unfallhilfsstellen und die Erlaubnis, Plätze dieser UHS zu bearbeiten, verlangen. Ein
Gerät, das Plätze nicht bearbeiten darf, MUST den Plan sehen, aber nicht ändern dürfen. Eine
stornierte UHS MUST Hinterlegen, Ändern und Entfernen mit 409 ablehnen.

#### Scenario: Beobachter
- **WHEN** ein Beobachter des Einsatzes einen Plan hochladen will
- **THEN** antwortet das System mit 403

#### Scenario: UHS-Tablet
- **WHEN** ein als UHS-Tablet gekoppeltes Gerät den Grundriss seiner UHS öffnet
- **THEN** sieht es den Plan, und ein Versuch, den Plan zu ändern, wird abgelehnt

#### Scenario: Stornierte UHS
- **WHEN** an einer stornierten UHS der Plan entfernt werden soll
- **THEN** antwortet das System mit 409, und der Plan bleibt sichtbar

### Requirement: Schwärzung entfernt den Plan

Die Schwärzung eines Einsatzes MUST jeden Plan seiner UHS samt Bytes löschen. Das
Platz-Layout und die Bezeichnung der UHS MUST dabei erhalten bleiben.

#### Scenario: Geschwärzter Einsatz
- **WHEN** ein Einsatz mit einem Plan an „BHP 50“ geschwärzt wird
- **THEN** ist kein Plan mehr gespeichert, und die Plätze von „BHP 50“ stehen an ihren Positionen
