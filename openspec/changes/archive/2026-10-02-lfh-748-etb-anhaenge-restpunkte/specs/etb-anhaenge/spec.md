# Spec Delta

## MODIFIED Requirements

### Requirement: Eintrag und Anhänge entstehen atomar
Das Erfassen eines ETB-Eintrags SHALL eine optionale Liste `anhang_ids` annehmen. Der
Eintrag und alle Verknüpfungen SHALL in einer Transaktion entstehen. Scheitert eine
Verknüpfung, SHALL weder der Eintrag noch eine Verknüpfung bestehen bleiben. Doppelte IDs
in der Liste SHALL als eine gelten. Die Liste SHALL höchstens 10 verschiedene Anhänge
tragen. Der Inhalt SHALL auch mit Anhängen Pflicht bleiben, einen Eintrag nur aus Dateien
gibt es nicht. Eine Berichtigung SHALL Anhänge tragen dürfen wie jeder andere erfassbare
Typ.

Die Statuscodes folgen der Projektkonvention:
- Eine unbekannte ID, eine ID eines fremden Einsatzes oder die ID eines Anhangs, den eine
  andere Person hochgeladen hat, SHALL 400 mit demselben Wortlaut ergeben, gleich ob dieser
  Anhang gebunden ist.
- Mehr als 10 Anhänge SHALL 400 ergeben.
- Ein selbst hochgeladener Anhang, der schon an einen ETB-Eintrag, eine Chat-Nachricht oder
  ein Dokument gebunden ist, SHALL 422 ergeben.

#### Scenario: Eintrag mit zwei Fotos
- **WHEN** ein Schreibberechtigter zwei zuvor über den ETB-Upload hochgeladene Dateien mit `anhang_ids` beim Erfassen nennt
- **THEN** antwortet das System mit 201, und der Eintrag trägt beide Anhänge in `anhaenge`

#### Scenario: Fremder Anhang rollt alles zurück
- **WHEN** `anhang_ids` eine Datei eines anderen Einsatzes enthält
- **THEN** antwortet das System mit 400
- **AND** es entsteht kein Eintrag, keine laufende Nummer wird verbraucht, und die übrigen genannten Dateien bleiben ungebunden

#### Scenario: Schon gebundene Datei
- **WHEN** `anhang_ids` eine selbst hochgeladene Datei enthält, die bereits an einem anderen ETB-Eintrag hängt
- **THEN** antwortet das System mit 422, und es entsteht kein Eintrag

#### Scenario: Chat-Datei ist nicht übernehmbar
- **WHEN** `anhang_ids` eine selbst hochgeladene Datei enthält, die an einer Chat-Nachricht hängt
- **THEN** antwortet das System mit 422

#### Scenario: Gebundene Datei einer anderen Person
- **WHEN** `anhang_ids` eine Datei enthält, die eine andere Person hochgeladen hat und die schon an einem ETB-Eintrag, einer Chat-Nachricht oder einem Dokument hängt
- **THEN** antwortet das System mit 400 und demselben Wortlaut wie für eine unbekannte ID, und es entsteht kein Eintrag

#### Scenario: Nur Datei, kein Text
- **WHEN** ein Eintrag mit leerem Inhalt und einem Anhang erfasst wird
- **THEN** antwortet das System mit 400

#### Scenario: Berichtigung mit Anhang
- **WHEN** eine Berichtigung zu Eintrag Nr. 7 mit einem Anhang erfasst wird
- **THEN** trägt die Berichtigung den Anhang, und Eintrag Nr. 7 bleibt unverändert ohne ihn

### Requirement: Eine Datei hat genau einen Lebenszyklus
Ein Anhang SHALL höchstens einem ETB-Eintrag gehören. Ein an einen ETB-Eintrag gebundener
Anhang SHALL sich an keine Chat-Nachricht binden lassen. Die generische Löschroute SHALL ihn
mit 422 abweisen, und die Datenbankzeile SHALL auch ohne diese Routenprüfung nicht über den
generischen Löschweg entfernbar sein. Der Aufräumlauf für verwaiste Dateien SHALL einen
gebundenen Anhang nie löschen, gleich wie alt er ist. Ein hochgeladener, noch
ungebundener Anhang SHALL wie bisher nach der Karenz von 24 Stunden als verwaist gelten.
Die generischen Routen zum Laden und Löschen SHALL einen ungebundenen Anhang nur für die
Person bedienen, die ihn hochgeladen hat, und allen anderen mit 404 antworten. Das
Erfassen SHALL jeden Anhang einer anderen Person, frei oder gebunden, wie eine unbekannte
ID abweisen.

#### Scenario: Chat will eine ETB-Datei verknüpfen
- **WHEN** eine Chat-Nachricht mit der ID eines ETB-gebundenen Anhangs gesendet wird
- **THEN** antwortet das System mit 400, und es entsteht keine Nachricht

#### Scenario: Generisches Löschen
- **WHEN** jemand mit Schreibrecht einen ETB-gebundenen Anhang über die generische Route löscht
- **THEN** antwortet das System mit 422, und Datei und Verknüpfung bleiben

#### Scenario: Ungebundener Upload über die generische Route
- **WHEN** eine andere Person als die hochladende einen hochgeladenen, noch nicht erfassten ETB-Anhang über die generische Route lädt oder löscht
- **THEN** antwortet das System mit 404
- **AND** die hochladende Person kann ihn über dieselbe Route laden und verwerfen

#### Scenario: Fremder Upload beim Erfassen
- **WHEN** jemand einen ETB-Eintrag mit der ID eines freien oder gebundenen Anhangs erfasst, den eine andere Person hochgeladen hat
- **THEN** antwortet das System mit 400 und demselben Wortlaut wie für eine unbekannte ID, und es entsteht kein Eintrag

#### Scenario: Aufräumlauf nach Tagen
- **WHEN** der Aufräumlauf für verwaiste Dateien drei Tage nach dem Erfassen läuft
- **THEN** bleibt der ETB-gebundene Anhang erhalten
- **AND** ein gleich alter, nie gebundener Anhang wird gelöscht

### Requirement: Die Schnellerfassung nimmt Anhänge nur online an
Die ETB-Schnellerfassung SHALL einen Bedienweg „Anhang“ zum Wählen von Dateien anbieten,
auch im Berichtigungsmodus. Die gewählten Dateien SHALL vor dem Absenden mit Name und Größe
sichtbar sein und einzeln entfernbar. Der Name jedes Entfernen-Bedienziels SHALL den
Dateinamen tragen. Eine Datei über 25 MiB SHALL schon beim Wählen mit Begründung
abgewiesen werden.

Ohne Netzverbindung SHALL „Anhang“ gesperrt sein, und ein sichtbarer Hinweis SHALL sagen,
dass Anhänge eine Verbindung brauchen und der Text trotzdem erfasst werden kann. Liegen
Dateien in der Liste, während die Verbindung wegfällt, SHALL das Absenden abgewiesen werden,
mit Hinweis und ohne Verlust von Wortlaut und Dateien.

Beim Absenden SHALL das System erst die Dateien hochladen und dann den Eintrag erfassen.
Scheitert der Upload oder lehnt der Server den Eintrag ab, SHALL der Wortlaut samt
Dateiliste stehen bleiben. Nach erfolgreichem Erfassen SHALL die Dateiliste geleert
werden, auch wenn „Werte behalten“ an ist. Während des Uploads SHALL die Erfassung
sichtbar zurückmelden, dass sie hochlädt. Während des Sendens SHALL keine Eingabe der
Erfassung bedienbar sein, auch kein Feld-Editor, der beim Absenden schon offen war.

Gewählte Dateien und der Hinweis eines gescheiterten Uploads SHALL einen Wechsel zwischen
den Entwurfs-Tabs und eine gestartete oder abgebrochene Berichtigung überleben. Das gilt
auch für einen Entwurf, dessen Text nach dem Wählen getippt und wieder ganz gelöscht wurde.
Nach einem Neuladen der Seite SHALL der Entwurfstext erhalten sein, die Dateiliste aber
nicht. Der Entwurfsspeicher SHALL keine Dateien aufnehmen.

#### Scenario: Tab-Wechsel
- **WHEN** im Entwurf A eine Datei gewählt, zu Entwurf B und zurück zu A gewechselt wird
- **THEN** steht die Datei wieder in der Liste von Entwurf A und nicht in der von Entwurf B

#### Scenario: Entwurf nur mit Dateien und geleertem Text
- **WHEN** in einem Entwurf eine Datei gewählt, Text getippt und wieder ganz gelöscht und danach eine Berichtigung gestartet und abgebrochen wird
- **THEN** steht der Entwurf weiter als Reiter da, und die Datei steht in seiner Liste

#### Scenario: Upload-Hinweis über eine Berichtigung
- **WHEN** der Upload beim Absenden scheitert und danach eine Berichtigung gestartet und abgebrochen wird
- **THEN** steht am Entwurf wieder der Hinweis mit dem Grund, und Wortlaut und Dateiliste stehen unverändert

#### Scenario: Offener Feld-Editor beim Absenden
- **WHEN** ein Feld-Editor (etwa „Von“) offen ist und „Erfassen“ einen Eintrag mit Anhang sendet
- **THEN** ist der Editor gesperrt, solange der Versand läuft

#### Scenario: Offline
- **WHEN** die Schnellerfassung ohne Netzverbindung angezeigt wird
- **THEN** ist „Anhang“ gesperrt, ein Hinweis nennt den Grund, und ein Text-Eintrag lässt sich weiter erfassen und landet in der Offline-Queue

#### Scenario: Upload scheitert
- **WHEN** beim Absenden der Upload einer gewählten Datei mit einem Fehler endet
- **THEN** entsteht kein Eintrag, eine Meldung nennt den Grund, und Wortlaut und Dateiliste stehen unverändert

#### Scenario: Werte behalten
- **WHEN** „Werte behalten“ an ist und ein Eintrag mit Anhang erfolgreich erfasst wurde
- **THEN** bleiben Von, An und Meldeweg stehen, und die Dateiliste ist leer
