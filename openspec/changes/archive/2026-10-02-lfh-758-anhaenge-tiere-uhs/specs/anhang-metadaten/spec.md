# Spec Delta

## MODIFIED Requirements

### Requirement: Bild-Anhänge werden bereinigt ausgeliefert

Ein Download eines Bild-Anhangs SHALL ohne Angabe einer Fassung eine bereinigte Fassung liefern.
Das gilt über jeden Weg, also Chat, Dokumentenablage, ETB, Schaden, Tier und UHS. Die gespeicherte
Datei MUST dabei unverändert bleiben. Auch die angezeigte Größe und der Dateiname MUST unverändert
bleiben. Bild-Anhänge sind JPEG, PNG, WebP, GIF, HEIC/HEIF und TIFF. Maßgeblich ist der Inhalt der
Datei, nicht ihre Endung.

#### Scenario: Handyfoto mit Standort im Schadenmodul
- **WHEN** eine Person mit Zugriff auf das Modul Schäden `dach.jpg` herunterlädt, das GPS-Koordinaten, Kamerahersteller, Modell, Seriennummer und Aufnahmezeit trägt
- **THEN** enthält die gelieferte Datei keine dieser Angaben, und die gespeicherte Datei trägt sie weiterhin

#### Scenario: Dieselbe Regel auf jedem Weg
- **WHEN** dasselbe Foto über den Chat, die Dokumentenablage, einen ETB-Eintrag, ein Tier oder eine UHS heruntergeladen wird
- **THEN** liefert jeder dieser Wege die bereinigte Fassung

#### Scenario: Falsche Endung
- **WHEN** eine Datei `foto.png` in Wahrheit ein JPEG mit GPS-Angaben ist
- **THEN** wird sie als JPEG erkannt und bereinigt ausgeliefert

### Requirement: Original nur für Einsatzleitung und System-Admin

Ein Download mit der Angabe `fassung=original` SHALL die gespeicherte Datei unverändert liefern,
aber nur an die Einsatzleitung des Einsatzes oder einen System-Admin. Für alle anderen MUST er
mit 403 antworten. Alle übrigen Prüfungen der Route MUST zusätzlich gelten: Lesezugriff,
Modulzugriff, Bindung an Eintrag, Schaden, Tier, UHS oder Dokument. Ein unbekannter Wert für
`fassung` MUST mit 400 abgewiesen werden.

#### Scenario: Einsatzleitung lädt das Original
- **WHEN** die Einsatzleitung `dach.jpg` an Schaden S-003 mit `fassung=original` abruft
- **THEN** erhält sie die gespeicherte Datei bytegleich, samt GPS-Angaben

#### Scenario: Original eines Tierfotos
- **WHEN** die Einsatzleitung `hund.jpg` an Tier T-007 mit `fassung=original` abruft
- **THEN** erhält sie die gespeicherte Datei bytegleich, und im ETB steht der Vermerk des Original-Abrufs

#### Scenario: Führungspersonal fragt das Original an
- **WHEN** eine Person mit der Rolle Führungspersonal denselben Abruf mit `fassung=original` stellt
- **THEN** antwortet das System mit 403 und vermerkt nichts

#### Scenario: Unbekannte Fassung
- **WHEN** ein Download mit `fassung=roh` angefragt wird
- **THEN** antwortet das System mit 400

#### Scenario: Doppelte Fassung
- **WHEN** ein Download mit `fassung=original&fassung=bereinigt` angefragt wird
- **THEN** antwortet das System mit 400 und vermerkt nichts

### Requirement: Original-Aktion in der Oberfläche

An jedem Bild-Anhang im Chat, in der Dokumentenablage, im ETB, an Schäden, an Tieren und an UHS
SHALL die Oberfläche der Einsatzleitung und System-Admins eine zweite Aktion anbieten, die das
Original lädt. Ihr Name MUST erkennen lassen, dass die Datei Standort und Gerätedaten enthalten
kann. Allen anderen Rollen MUST die Aktion verborgen bleiben. Der normale Download-Verweis MUST
die bereinigte Fassung laden.

#### Scenario: Einsatzleitung sieht die Original-Aktion
- **WHEN** die Einsatzleitung die Anhänge von Schaden S-003 ansieht
- **THEN** steht neben `dach.jpg` eine Aktion „Original (mit Standort)“

#### Scenario: Original-Aktion an Tier und UHS
- **WHEN** die Einsatzleitung die Anhänge von Tier T-007 oder den Reiter „Dateien“ der UHS „BHP 50“ ansieht
- **THEN** steht neben jedem Bild eine Aktion „Original (mit Standort)“

#### Scenario: Beobachter sieht sie nicht
- **WHEN** eine Person mit der Rolle Beobachter dieselbe Liste ansieht
- **THEN** sieht sie nur den normalen Download-Verweis

#### Scenario: Kein Original-Verweis an einem PDF
- **WHEN** die Einsatzleitung ein PDF in der Dokumentenablage ansieht
- **THEN** steht dort keine Original-Aktion, weil der normale Download schon die gespeicherte Datei liefert
