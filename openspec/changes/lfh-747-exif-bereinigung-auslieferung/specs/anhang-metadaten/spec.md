# Spec Delta

## Purpose

Datei-Anhänge eines Einsatzes werden so ausgeliefert, dass Fotos keine personenbezogenen
Metadaten (Standort, Gerät, Aufnahmezeit) weitergeben. Das unveränderte Original bleibt als
Beweismittel gespeichert. Abrufen dürfen es nur Einsatzleitung und System-Admin, und jeder Abruf
wird vermerkt.

## ADDED Requirements

### Requirement: Bild-Anhänge werden bereinigt ausgeliefert

Ein Download eines Bild-Anhangs SHALL ohne Angabe einer Fassung eine bereinigte Fassung liefern.
Das gilt über jeden Weg, also Chat, Dokumentenablage, ETB und Schaden. Die gespeicherte Datei MUST
dabei unverändert bleiben. Auch die angezeigte Größe und der Dateiname MUST unverändert bleiben.
Bild-Anhänge sind JPEG, PNG, WebP, GIF, HEIC/HEIF und TIFF. Maßgeblich ist der Inhalt der Datei,
nicht ihre Endung.

#### Scenario: Handyfoto mit Standort im Schadenmodul
- **WHEN** eine Person mit Zugriff auf das Modul Schäden `dach.jpg` herunterlädt, das GPS-Koordinaten, Kamerahersteller, Modell, Seriennummer und Aufnahmezeit trägt
- **THEN** enthält die gelieferte Datei keine dieser Angaben, und die gespeicherte Datei trägt sie weiterhin

#### Scenario: Dieselbe Regel auf jedem Weg
- **WHEN** dasselbe Foto über den Chat, die Dokumentenablage oder einen ETB-Eintrag heruntergeladen wird
- **THEN** liefert jeder dieser Wege die bereinigte Fassung

#### Scenario: Falsche Endung
- **WHEN** eine Datei `foto.png` in Wahrheit ein JPEG mit GPS-Angaben ist
- **THEN** wird sie als JPEG erkannt und bereinigt ausgeliefert

### Requirement: Was die Bereinigung entfernt und was sie erhält

Die bereinigte Fassung MUST alle EXIF-Angaben entfernen, ebenso XMP, IPTC/Photoshop-Blöcke,
Textkommentare und die Vorschaubilder in EXIF und JFIF. Zu den EXIF-Angaben gehören GPS, Gerät,
Seriennummer und Zeiten. Die Ausrichtung MUST erhalten bleiben. Bilddaten und Farbprofil MUST
bytegleich übernommen werden, ohne Neukodierung. Vorschauen als eigene Bilder des Containers
(HEIF, TIFF) gelten als Bildinhalt.

#### Scenario: Ausrichtung bleibt
- **WHEN** ein hochkant aufgenommenes JPEG mit EXIF-Ausrichtung 6 bereinigt ausgeliefert wird
- **THEN** trägt die gelieferte Datei die Ausrichtung 6 und sonst keine EXIF-Angabe

#### Scenario: Bildinhalt unverändert
- **WHEN** ein JPEG bereinigt ausgeliefert wird
- **THEN** sind die komprimierten Bilddaten und ein vorhandenes Farbprofil bytegleich mit dem Original

#### Scenario: XMP mit Standort
- **WHEN** ein PNG oder WebP seinen Standort nur im XMP-Block trägt
- **THEN** enthält die gelieferte Datei keinen XMP-Block

#### Scenario: iPhone-Foto im HEIC-Format
- **WHEN** ein HEIC-Foto mit EXIF- und XMP-Angaben bereinigt ausgeliefert wird
- **THEN** enthält die gelieferte Datei keine lesbare EXIF- oder XMP-Angabe und lässt sich weiterhin als Bild öffnen

### Requirement: Nicht bereinigbare Bilder werden nicht im Original ausgeliefert

Lässt sich ein Bild-Anhang nicht sicher bereinigen, MUST der Download ohne Angabe einer Fassung
mit 422 antworten. Gründe sind eine beschädigte oder unbekannte Struktur oder ein unerwarteter
Metadatenort. Die Meldung MUST darauf hinweisen, dass die Einsatzleitung das Original abrufen
kann. Das Original MUST NOT ersatzweise ausgeliefert werden.

#### Scenario: Beschädigtes JPEG
- **WHEN** ein gespeichertes JPEG mitten in einem Metadaten-Segment abbricht
- **THEN** antwortet der normale Download mit 422, und es werden keine Dateibytes ausgeliefert

### Requirement: Andere Dateitypen bleiben unverändert

Anhänge, die kein Bild sind, SHALL beim Download unverändert ausgeliefert werden. Dazu gehören
PDF, Text, CSV und Office-Dokumente.

#### Scenario: PDF-Gutachten
- **WHEN** jemand ein PDF-Gutachten an einem Schaden herunterlädt
- **THEN** sind die gelieferten Bytes identisch mit den gespeicherten

### Requirement: Cache-Kennung der bereinigten Fassung

Der Download der bereinigten Fassung SHALL einen ETag tragen, der sich vom ETag des Originals
unterscheidet. Ändert sich die Bereinigung, MUST sich auch der ETag ändern. Die Antwort MUST vor
jeder Wiederverwendung revalidiert werden (kein `immutable`). Ein passendes `If-None-Match` MUST
weiterhin mit 304 beantwortet werden, ohne die Datei zu lesen.

#### Scenario: Bedingter Abruf
- **WHEN** ein Browser die bereinigte Fassung mit dem zuvor gelieferten ETag erneut anfragt
- **THEN** antwortet das System mit 304

#### Scenario: Neue Version der Bereinigung
- **WHEN** die Bereinigung geändert wird und ein Browser mit dem ETag der alten Version anfragt
- **THEN** antwortet das System mit 200 und der neu bereinigten Fassung

### Requirement: Original nur für Einsatzleitung und System-Admin

Ein Download mit der Angabe `fassung=original` SHALL die gespeicherte Datei unverändert liefern,
aber nur an die Einsatzleitung des Einsatzes oder einen System-Admin. Für alle anderen MUST er
mit 403 antworten. Alle übrigen Prüfungen der Route MUST zusätzlich gelten: Lesezugriff,
Modulzugriff, Bindung an Eintrag, Schaden oder Dokument. Ein unbekannter Wert für `fassung` MUST
mit 400 abgewiesen werden.

#### Scenario: Einsatzleitung lädt das Original
- **WHEN** die Einsatzleitung `dach.jpg` an Schaden S-003 mit `fassung=original` abruft
- **THEN** erhält sie die gespeicherte Datei bytegleich, samt GPS-Angaben

#### Scenario: Führungspersonal fragt das Original an
- **WHEN** eine Person mit der Rolle Führungspersonal denselben Abruf mit `fassung=original` stellt
- **THEN** antwortet das System mit 403 und vermerkt nichts

#### Scenario: Unbekannte Fassung
- **WHEN** ein Download mit `fassung=roh` angefragt wird
- **THEN** antwortet das System mit 400

#### Scenario: Doppelte Fassung
- **WHEN** ein Download mit `fassung=original&fassung=bereinigt` angefragt wird
- **THEN** antwortet das System mit 400 und vermerkt nichts

### Requirement: Jeder Original-Abruf wird im ETB vermerkt

Vor der Auslieferung eines Originals MUST das System einen System-Eintrag im Einsatztagebuch
anlegen. Er nennt die abrufende Person über den Erfasser, die Art der Ablage und die
Anhang-Kennung, aber nie den Dateinamen. Scheitert der Vermerk, MUST das Original nicht
ausgeliefert werden. Der Original-Abruf MUST ohne ETag und mit `Cache-Control: no-store`
antworten, damit jeder Abruf neu vermerkt wird. Der Vermerk MUST auch in einem abgeschlossenen
Einsatz entstehen.

#### Scenario: Vermerk ohne Dateinamen
- **WHEN** die Einsatzleitung das Original eines ETB-Anhangs abruft
- **THEN** steht im ETB ein System-Eintrag, der den Abruf des Originals mit Metadaten zu diesem Anhang nennt, aber nicht dessen Dateinamen

#### Scenario: Zweiter Abruf
- **WHEN** dieselbe Person das Original ein zweites Mal abruft
- **THEN** liefert das System die Datei erneut, ohne 304, und legt einen zweiten Vermerk an

### Requirement: Original-Aktion in der Oberfläche

An jedem Bild-Anhang im Chat, in der Dokumentenablage, im ETB und an Schäden SHALL die Oberfläche
der Einsatzleitung und System-Admins eine zweite Aktion anbieten, die das Original lädt. Ihr
Name MUST erkennen lassen, dass die Datei Standort und Gerätedaten enthalten kann. Allen anderen
Rollen MUST die Aktion verborgen bleiben. Der normale Download-Verweis MUST die bereinigte
Fassung laden.

#### Scenario: Einsatzleitung sieht die Original-Aktion
- **WHEN** die Einsatzleitung die Anhänge von Schaden S-003 ansieht
- **THEN** steht neben `dach.jpg` eine Aktion „Original (mit Standort)“

#### Scenario: Beobachter sieht sie nicht
- **WHEN** eine Person mit der Rolle Beobachter dieselbe Liste ansieht
- **THEN** sieht sie nur den normalen Download-Verweis

#### Scenario: Kein Original-Verweis an einem PDF
- **WHEN** die Einsatzleitung ein PDF in der Dokumentenablage ansieht
- **THEN** steht dort keine Original-Aktion, weil der normale Download schon die gespeicherte Datei liefert
