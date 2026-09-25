# Spec Delta

## Purpose

Ein Eintrag im Einsatztagebuch trägt die Dateien, die er dokumentiert: Fotos, Scans,
Faxe. Sie werden mit dem Eintrag erfasst, sind nur über das ETB-Modul ladbar, an genau
diesen Eintrag gebunden und bis zur Schwärzung des Einsatzes unveränderlich.

## ADDED Requirements

### Requirement: ETB-Anhänge werden über einen ETB-gegateten Upload hochgeladen
Das System SHALL einen Upload für ETB-Anhänge unter dem ETB-Präfix des Einsatzes anbieten.
Er SHALL dieselben Voraussetzungen verlangen wie das Erfassen eines Eintrags:
Schreibrecht im Einsatz, freigegebenes Modul ETB und aktiven Einsatz. Er SHALL die
Dokument-Allowlist anwenden, also die Chat-Allowlist plus HEIC, HEIF und TIFF. Er SHALL
dieselbe Größengrenze (25 MiB je Datei), dieselbe Leer-Datei-Prüfung und denselben
Virenscan anwenden wie jeder andere Datei-Upload. Die Antwort SHALL die Metadaten der
angelegten Dateien liefern (id, Dateiname, MIME, Größe). Eine hochgeladene Datei SHALL
bis zum Erfassen an keinen Eintrag gebunden sein.

#### Scenario: iPhone-Foto wird angenommen
- **WHEN** ein Schreibberechtigter `IMG_0412.HEIC` über den ETB-Upload hochlädt
- **THEN** antwortet das System mit 201 und MIME `image/heic`

#### Scenario: Unzulässiger Dateityp
- **WHEN** eine Datei `setup.exe` über den ETB-Upload hochgeladen wird
- **THEN** antwortet das System mit 400 und legt keine Datei an

#### Scenario: Beobachter darf nicht hochladen
- **WHEN** ein Beobachter des Einsatzes den ETB-Upload aufruft
- **THEN** antwortet das System mit 403

#### Scenario: Modul ETB gesperrt
- **WHEN** ein Schreibberechtigter, für den das Modul ETB gesperrt ist, den ETB-Upload aufruft
- **THEN** antwortet das System mit 403

### Requirement: Eintrag und Anhänge entstehen atomar
Das Erfassen eines ETB-Eintrags SHALL eine optionale Liste `anhang_ids` annehmen. Der
Eintrag und alle Verknüpfungen SHALL in einer Transaktion entstehen. Scheitert eine
Verknüpfung, SHALL weder der Eintrag noch eine Verknüpfung bestehen bleiben. Doppelte IDs
in der Liste SHALL als eine gelten. Die Liste SHALL höchstens 10 verschiedene Anhänge
tragen. Der Inhalt SHALL auch mit Anhängen Pflicht bleiben, einen Eintrag nur aus Dateien
gibt es nicht. Eine Berichtigung SHALL Anhänge tragen dürfen wie jeder andere erfassbare
Typ.

Die Statuscodes folgen der Projektkonvention:
- Eine unbekannte ID oder eine ID eines fremden Einsatzes SHALL 400 ergeben.
- Mehr als 10 Anhänge SHALL 400 ergeben.
- Ein Anhang, der schon an einen ETB-Eintrag, eine Chat-Nachricht oder ein Dokument
  gebunden ist, SHALL 422 ergeben.

#### Scenario: Eintrag mit zwei Fotos
- **WHEN** ein Schreibberechtigter zwei zuvor über den ETB-Upload hochgeladene Dateien mit `anhang_ids` beim Erfassen nennt
- **THEN** antwortet das System mit 201, und der Eintrag trägt beide Anhänge in `anhaenge`

#### Scenario: Fremder Anhang rollt alles zurück
- **WHEN** `anhang_ids` eine Datei eines anderen Einsatzes enthält
- **THEN** antwortet das System mit 400
- **AND** es entsteht kein Eintrag, keine laufende Nummer wird verbraucht, und die übrigen genannten Dateien bleiben ungebunden

#### Scenario: Schon gebundene Datei
- **WHEN** `anhang_ids` eine Datei enthält, die bereits an einem anderen ETB-Eintrag hängt
- **THEN** antwortet das System mit 422, und es entsteht kein Eintrag

#### Scenario: Chat-Datei ist nicht übernehmbar
- **WHEN** `anhang_ids` eine Datei enthält, die an einer Chat-Nachricht hängt
- **THEN** antwortet das System mit 422

#### Scenario: Nur Datei, kein Text
- **WHEN** ein Eintrag mit leerem Inhalt und einem Anhang erfasst wird
- **THEN** antwortet das System mit 400

#### Scenario: Berichtigung mit Anhang
- **WHEN** eine Berichtigung zu Eintrag Nr. 7 mit einem Anhang erfasst wird
- **THEN** trägt die Berichtigung den Anhang, und Eintrag Nr. 7 bleibt unverändert ohne ihn

### Requirement: Ein Replay liefert den Bestand samt Anhängen
Trägt das Erfassen eine `client_id`, zu der im Einsatz schon ein Eintrag besteht, SHALL das
System diesen Eintrag samt seinen Anhängen mit 201 zurückgeben. Es SHALL `anhang_ids` dabei
nicht erneut prüfen und kein zweites Live-Ereignis auslösen. Zwei gleichzeitige Anfragen mit
derselben `client_id` SHALL genau einen Eintrag erzeugen.

#### Scenario: Antwort ging verloren
- **WHEN** derselbe Eintrag mit derselben `client_id` und denselben `anhang_ids` ein zweites Mal gesendet wird, nachdem der erste Versuch committet hat
- **THEN** antwortet das System mit 201 und dem ersten Eintrag samt seinen Anhängen
- **AND** es entsteht kein zweiter Eintrag und kein zweites `etb`-Live-Ereignis

### Requirement: Der ETB-Eintrag führt seine Anhänge auf dem Wire
Jede Antwort, die einen ETB-Eintrag ausliefert (Liste, Einzelladen, Erfassen-Antwort), SHALL
das Feld `anhaenge` tragen. Es enthält je Anhang id, Dateiname, MIME und Größe in Bytes,
aufsteigend nach id. Ohne Anhang SHALL das Feld leer sein, nicht fehlend. Die Bytes SHALL
nie Teil dieser Antwort sein.

#### Scenario: Eintrag ohne Anhang
- **WHEN** ein Eintrag ohne Anhang abgefragt wird
- **THEN** trägt er den Schlüssel `anhaenge` mit `[]`

#### Scenario: Seitenweise Abfrage
- **WHEN** die ETB-Liste mit Cursor und Limit abgefragt wird
- **THEN** trägt jeder Eintrag der Seite seine vollständigen Anhänge

### Requirement: ETB-Anhänge sind nur über das ETB-Modul ladbar
Das System SHALL eine Download-Route für einen Anhang eines bestimmten Eintrags unter dem
ETB-Präfix anbieten. Sie SHALL Lesezugriff im Einsatz und das freigegebene Modul ETB
verlangen. Beobachter dürfen laden. Gehört der Eintrag nicht zum Einsatz oder der Anhang
nicht zum Eintrag, SHALL sie 404 liefern. Ein unbekannter Einsatz SHALL ebenfalls 404
ergeben. Die Antwort SHALL dieselben Cache-Header tragen wie jeder andere Datei-Download
(ETag, 304 bei passendem `If-None-Match`). Die generische, modul-lose Download-Route für
Anhänge SHALL einen ETB-Anhang mit 404 abweisen.

#### Scenario: Beobachter lädt ein Foto
- **WHEN** ein Beobachter mit freigegebenem Modul ETB den Anhang eines Eintrags lädt
- **THEN** erhält er die Datei mit ihrem Dateinamen und MIME-Typ

#### Scenario: Anhang über einen fremden Einsatz
- **WHEN** jemand mit Zugriff auf Einsatz B den Download-Pfad von Einsatz B mit der Eintrag- und Anhang-ID aus Einsatz A aufruft
- **THEN** antwortet das System mit 404

#### Scenario: Anhang an falschem Eintrag
- **WHEN** der Download-Pfad einen Eintrag desselben Einsatzes nennt, an dem der Anhang nicht hängt
- **THEN** antwortet das System mit 404

#### Scenario: Modul ETB gesperrt
- **WHEN** ein Nutzer, für den das Modul ETB gesperrt ist, einen ETB-Anhang lädt
- **THEN** antwortet das System mit 403

#### Scenario: Generischer Download ist gesperrt
- **WHEN** ein ETB-Anhang über die generische Anhang-Route geladen wird
- **THEN** antwortet das System mit 404

### Requirement: Eine Datei hat genau einen Lebenszyklus
Ein Anhang SHALL höchstens einem ETB-Eintrag gehören. Ein an einen ETB-Eintrag gebundener
Anhang SHALL sich an keine Chat-Nachricht binden lassen. Die generische Löschroute SHALL ihn
mit 422 abweisen, und die Datenbankzeile SHALL auch ohne diese Routenprüfung nicht über den
generischen Löschweg entfernbar sein. Der Aufräumlauf für verwaiste Dateien SHALL einen
gebundenen Anhang nie löschen, gleich wie alt er ist. Ein hochgeladener, noch
ungebundener Anhang SHALL wie bisher nach der Karenz von 24 Stunden als verwaist gelten.
Die generischen Routen zum Laden und Löschen SHALL einen ungebundenen Anhang nur für die
Person bedienen, die ihn hochgeladen hat, und allen anderen mit 404 antworten.

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

#### Scenario: Aufräumlauf nach Tagen
- **WHEN** der Aufräumlauf für verwaiste Dateien drei Tage nach dem Erfassen läuft
- **THEN** bleibt der ETB-gebundene Anhang erhalten
- **AND** ein gleich alter, nie gebundener Anhang wird gelöscht

### Requirement: Ein ETB-Anhang ist unveränderlich
Das System SHALL keinen Weg anbieten, einen Anhang eines ETB-Eintrags nach dem Erfassen zu
entfernen, zu ersetzen oder einem anderen Eintrag zuzuordnen. Eine Korrektur SHALL als
Berichtigung mit eigenen Anhängen erfolgen. Die einzige Ausnahme ist die Schwärzung des
Einsatzes.

#### Scenario: Kein Bearbeiten
- **WHEN** die API eines Einsatzes nach einer Route zum Ändern oder Entfernen eines ETB-Anhangs gefragt wird
- **THEN** gibt es keine solche Route; der generische Löschweg antwortet mit 422

### Requirement: Die Schwärzung löscht die Datei und behält den Eintrag
Die DSGVO-Schwärzung eines Einsatzes SHALL jeden ETB-Anhang samt Bytes und Verknüpfung
löschen. Der ETB-Eintrag SHALL mit Inhalt, Nummer und Metadaten bestehen bleiben. Danach
SHALL er `anhaenge: []` tragen, und der frühere Download-Pfad SHALL 404 liefern.

#### Scenario: Schwärzung eines Einsatzes mit Foto am Eintrag
- **WHEN** ein Einsatz geschwärzt wird, dessen Eintrag Nr. 3 ein Foto trägt
- **THEN** existieren Foto und Verknüpfung nicht mehr
- **AND** Eintrag Nr. 3 steht mit unverändertem Inhalt in der ETB-Liste und trägt `anhaenge: []`

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
sichtbar zurückmelden, dass sie hochlädt.

Gewählte Dateien SHALL einen Wechsel zwischen den Entwurfs-Tabs überleben. Nach einem
Neuladen der Seite SHALL der Entwurfstext erhalten sein, die Dateiliste aber nicht. Der
Entwurfsspeicher SHALL keine Dateien aufnehmen.

#### Scenario: Tab-Wechsel
- **WHEN** im Entwurf A eine Datei gewählt, zu Entwurf B und zurück zu A gewechselt wird
- **THEN** steht die Datei wieder in der Liste von Entwurf A und nicht in der von Entwurf B

#### Scenario: Offline
- **WHEN** die Schnellerfassung ohne Netzverbindung angezeigt wird
- **THEN** ist „Anhang“ gesperrt, ein Hinweis nennt den Grund, und ein Text-Eintrag lässt sich weiter erfassen und landet in der Offline-Queue

#### Scenario: Upload scheitert
- **WHEN** beim Absenden der Upload einer gewählten Datei mit einem Fehler endet
- **THEN** entsteht kein Eintrag, eine Meldung nennt den Grund, und Wortlaut und Dateiliste stehen unverändert

#### Scenario: Werte behalten
- **WHEN** „Werte behalten“ an ist und ein Eintrag mit Anhang erfolgreich erfasst wurde
- **THEN** bleiben Von, An und Meldeweg stehen, und die Dateiliste ist leer

### Requirement: Ein Eintrag mit hochgeladenen Anhängen geht bei Netzausfall in die Queue
Scheitert das Erfassen nach erfolgreichem Upload vorübergehend (Netz, Zeitüberschreitung,
Serverfehler), SHALL der Eintrag mit seiner `client_id` und seinen `anhang_ids` in die
Offline-Queue gehen wie jeder Text-Eintrag. Lehnt der Server ihn beim späteren Nachsenden
ab, weil ein Anhang inzwischen nicht mehr existiert, SHALL die Ablehnung einen Grund nennen,
der den Anhang als Ursache erkennbar macht. Der Wortlaut SHALL in der Liste der
abgelehnten Einträge erhalten bleiben.

#### Scenario: Verbindung reißt zwischen Upload und Erfassen
- **WHEN** der Upload gelingt und das Erfassen danach mit einem Netzfehler scheitert
- **THEN** steht der Eintrag als ausstehend in der Zeitachse und wird beim nächsten Nachsenden mit denselben `anhang_ids` und derselben `client_id` erfasst

#### Scenario: Anhang nach der Karenz weggeräumt
- **WHEN** ein ausstehender Eintrag erst nach Ablauf der Karenz nachgesendet wird und sein Anhang inzwischen als verwaist gelöscht ist
- **THEN** lehnt der Server mit 400 ab, der Eintrag steht unter den abgelehnten, und der Grund nennt den fehlenden Anhang

### Requirement: Zeitachse und Vorschau zeigen die Anhänge
Die ETB-Zeitachse SHALL in der Hinweiszeile eines Eintrags je Anhang einen
Download-Verweis mit Dateiname und Größe zeigen. Dasselbe gilt für die Vorschau eines
ETB-Eintrags in der Sprungpalette. Der zugängliche Name jedes Verweises SHALL die laufende
Nummer des Eintrags tragen, damit gleichnamige Dateien verschiedener Einträge
unterscheidbar sind. Der Verweis SHALL auf die ETB-Download-Route zeigen, nie auf die
generische. Er SHALL die Mindesthöhe der aktiven Dichtestufe erreichen. Ohne Anhang SHALL
kein Verweis erscheinen.

#### Scenario: Zwei Einträge mit gleichem Dateinamen
- **WHEN** Eintrag Nr. 4 und Nr. 9 je einen Anhang `IMG_0001.jpg` tragen
- **THEN** haben die beiden Verweise verschiedene zugängliche Namen, die „Nr. 4“ bzw. „Nr. 9“ enthalten

#### Scenario: Handschuhstufe
- **WHEN** die Dichte auf „Handschuh“ steht
- **THEN** ist jeder Anhang-Verweis mindestens 72 px hoch
