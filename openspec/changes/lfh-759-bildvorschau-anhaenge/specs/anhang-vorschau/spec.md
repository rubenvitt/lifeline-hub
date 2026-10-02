# Spec Delta

## Purpose

Bild-Anhänge eines Einsatzes lassen sich in der App ansehen, ohne sie herunterzuladen: als
kleines Vorschaubild in jeder Ablage und als Großansicht. Dabei gibt die Vorschau keine
Metadaten weiter, und kein Anhang wird je als ausführbarer Inhalt im Browser geöffnet.

## ADDED Requirements

### Requirement: Vorschaubild in zwei Größen

Jede der vier Anhang-Download-Routen (Chat, Dokumentenablage, ETB, Schaden) SHALL mit
`fassung=vorschau` ein JPEG liefern, dessen längste Kante höchstens 256 px misst, und mit
`fassung=grossansicht` eines mit höchstens 1600 px. Kleinere Bilder MUST NOT vergrößert werden.
Es gelten dieselben Zugriffsprüfungen wie beim Download der Route. Ein Abruf MUST NOT im ETB
vermerkt werden. Bildformate mit Vorschau vom Server sind JPEG, PNG, WebP, GIF und TIFF,
maßgeblich ist der Inhalt der Datei.

#### Scenario: Beobachter sieht ein Schadenfoto
- **WHEN** ein Beobachter des Einsatzes `dach.jpg` (4032 × 3024 px) an Schaden S-003 mit `fassung=vorschau` abruft
- **THEN** erhält er ein JPEG mit 256 × 192 px, und im ETB entsteht kein Eintrag

#### Scenario: Großansicht
- **WHEN** dasselbe Foto mit `fassung=grossansicht` abgerufen wird
- **THEN** ist das gelieferte JPEG 1600 × 1200 px groß

#### Scenario: Kleines Bild bleibt klein
- **WHEN** ein PNG mit 120 × 80 px mit `fassung=grossansicht` abgerufen wird
- **THEN** ist das gelieferte JPEG 120 × 80 px groß

#### Scenario: Fremder Einsatz
- **WHEN** eine Person ohne Lesezugriff auf den Einsatz die Vorschau eines seiner Anhänge abruft
- **THEN** antwortet das System wie beim Download dieser Route mit 404

#### Scenario: Erstes Bild einer Folge
- **WHEN** ein animiertes GIF oder ein mehrseitiges TIFF mit `fassung=vorschau` abgerufen wird
- **THEN** zeigt das Vorschaubild das erste Bild bzw. die erste Seite

### Requirement: Vorschaubild ohne Metadaten und richtig ausgerichtet

Ein Vorschaubild MUST aus den Bildpunkten neu kodiert sein und MUST weder EXIF noch XMP,
IPTC/Photoshop-Blöcke oder Textkommentare tragen. Eine Ausrichtung des Originals MUST auf die
Bildpunkte angewendet sein. Das gilt auch, wenn sich die Datei selbst nicht bereinigen lässt,
denn das Vorschaubild übernimmt keine Bytes außer Bildpunkten.

#### Scenario: Hochkant-Foto mit Standort
- **WHEN** ein JPEG mit 4032 × 3024 px, EXIF-Ausrichtung 6 und GPS-Angaben mit `fassung=vorschau` abgerufen wird
- **THEN** ist das gelieferte JPEG 192 × 256 px groß und trägt weder Ausrichtung noch GPS-Angaben noch einen anderen EXIF-Block

#### Scenario: Nicht bereinigbares Foto
- **WHEN** der normale Download eines Fotos mit 422 antwortet, weil ein Metadaten-Segment beschädigt ist, die Bilddaten aber lesbar sind
- **THEN** liefert `fassung=vorschau` ein Vorschaubild ohne Metadaten

### Requirement: Kein Vorschaubild ohne lesbares Bild

Lässt sich für einen Anhang kein Vorschaubild erzeugen, MUST die Route mit 422 antworten und
MUST NOT Dateibytes ausliefern. Das gilt für Dateien, die kein Bild sind, für HEIC/HEIF, für
nicht dekodierbare Bilddaten und für Bilder über den Grenzen der Dekodierung.

#### Scenario: PDF
- **WHEN** ein PDF-Gutachten mit `fassung=vorschau` abgerufen wird
- **THEN** antwortet das System mit 422 ohne Dateibytes

#### Scenario: HEIC
- **WHEN** ein HEIC-Foto mit `fassung=vorschau` abgerufen wird
- **THEN** antwortet das System mit 422 ohne Dateibytes

#### Scenario: Kaputte Bilddaten
- **WHEN** ein gespeichertes PNG mitten in den Bilddaten abbricht
- **THEN** antwortet `fassung=vorschau` mit 422

### Requirement: Grenzen der Dekodierung

Ein Bild mit mehr als 50 Millionen Bildpunkten oder einer Kante über 16 384 px MUST ohne
Dekodieren der Bilddaten mit 422 abgewiesen werden. Die Größe liest das System aus dem Kopf
der Datei. Der Speicherbedarf einer einzelnen Dekodierung MUST begrenzt sein.

#### Scenario: Riesiges PNG
- **WHEN** ein PNG von wenigen Kilobyte, das 20 000 × 20 000 px angibt, mit `fassung=vorschau` abgerufen wird
- **THEN** antwortet das System mit 422, ohne die Bilddaten zu dekodieren

### Requirement: Cache-Kennung des Vorschaubilds

Ein Vorschaubild SHALL einen ETag tragen, der sich von dem der bereinigten Fassung, dem der
anderen Größe und dem jeder früheren Version der Vorschau-Erzeugung unterscheidet. Die Antwort
MUST vor jeder Wiederverwendung revalidiert werden (kein `immutable`). Ein passendes
`If-None-Match` MUST mit 304 beantwortet werden, ohne die Datei zu lesen oder zu dekodieren.

#### Scenario: Bedingter Abruf
- **WHEN** ein Browser das Vorschaubild mit dem zuvor gelieferten ETag erneut anfragt
- **THEN** antwortet das System mit 304

#### Scenario: Zwei Größen, zwei Kennungen
- **WHEN** dasselbe Foto mit `fassung=vorschau` und mit `fassung=grossansicht` abgerufen wird
- **THEN** tragen die beiden Antworten verschiedene ETags

### Requirement: Inline nur für Vorschaubilder

Nur die Fassungen `vorschau` und `grossansicht` SHALL mit `Content-Disposition: inline` und
`Content-Type: image/jpeg` ausgeliefert werden. Die bereinigte Fassung und das Original MUST
weiter als Anlage (`attachment`) ausgeliefert werden.

#### Scenario: Vorschau inline, Download als Anlage
- **WHEN** dasselbe Foto einmal mit `fassung=vorschau` und einmal ohne Fassung abgerufen wird
- **THEN** trägt die erste Antwort `Content-Disposition: inline` und die zweite `Content-Disposition: attachment`

### Requirement: Schutz-Header jeder Anhang-Antwort

Jede Antwort einer Anhang-Download-Route mit Dateibytes MUST `X-Content-Type-Options: nosniff`
und `Content-Security-Policy: default-src 'none'; sandbox` tragen, gleich welche Fassung. Damit
führt der Browser keinen Inhalt eines Anhangs aus, auch nicht beim direkten Öffnen der Adresse.

#### Scenario: HTML-Datei mit Bild-Endung
- **WHEN** eine Datei `foto.gif`, die in Wahrheit HTML mit Skript enthält, ohne Fassung abgerufen wird
- **THEN** trägt die Antwort `X-Content-Type-Options: nosniff` und die CSP `default-src 'none'; sandbox`

#### Scenario: Original
- **WHEN** die Einsatzleitung ein Original abruft
- **THEN** trägt auch diese Antwort beide Header

### Requirement: Vorschaubild an jedem Bild-Anhang in der Oberfläche

Überall, wo ein Bild-Anhang einen Download-Verweis hat (Chat, Dokumentenablage, ETB, Schäden),
SHALL die Oberfläche daneben ein Vorschaubild zeigen. Sein Platz MUST vor dem Laden reserviert
sein, damit nichts springt. Sein zugänglicher Name MUST mit „Vorschau“ beginnen und den
Dateinamen nennen. Anhänge, die kein Bild sind, SHALL kein Vorschaubild bekommen. Der
Download-Verweis und die Original-Aktion MUST unverändert bleiben.

#### Scenario: Schaden mit Foto und PDF
- **WHEN** eine Person die Anhänge eines Schadens mit `dach.jpg` und `gutachten.pdf` ansieht
- **THEN** steht neben `dach.jpg` ein Vorschaubild und neben `gutachten.pdf` keines, und beide Download-Verweise sind unverändert da

#### Scenario: ETB-Eintrag mit Foto
- **WHEN** ein ETB-Eintrag ein Foto trägt
- **THEN** zeigt die Zeitachse in seiner Hinweiszeile ein Vorschaubild neben dem Download-Verweis

### Requirement: Großansicht in der App

Ein Klick oder Enter auf ein Vorschaubild SHALL die Großansicht des Bildes in einer Überlagerung
der App öffnen, nie in einem neuen Fenster oder Tab. Escape SHALL sie schließen, und der Fokus
MUST danach auf dem Vorschaubild stehen. Trägt dieselbe Nachricht, derselbe Eintrag oder
derselbe Schaden mehrere Bilder, SHALL die Großansicht zwischen ihnen blättern lassen.

#### Scenario: Großansicht in der Desktop-Hülle
- **WHEN** jemand in der Desktop-Hülle auf das Vorschaubild eines Chat-Fotos klickt
- **THEN** öffnet sich die Großansicht in der App, und es entsteht kein Download

#### Scenario: Blättern
- **WHEN** ein Schaden drei Fotos trägt und die Großansicht des ersten offen ist
- **THEN** lässt sich ohne Schließen zum zweiten und dritten Foto wechseln

### Requirement: HEIC-Vorschau auf dem Gerät

Für HEIC/HEIF-Anhänge SHALL die Oberfläche die bereinigte Fassung laden, auf dem Gerät
dekodieren und daraus Vorschaubild und Großansicht zeigen. Sie MUST NOT dafür das Original
anfordern. Der Decoder MUST erst geladen werden, wenn ein HEIC/HEIF-Anhang angezeigt wird, und
MUST außerhalb des Hauptthreads laufen.

#### Scenario: iPhone-Foto im ETB
- **WHEN** ein ETB-Eintrag ein HEIC-Foto trägt und die Zeitachse es anzeigt
- **THEN** zeigt sie ein Vorschaubild dieses Fotos, und die Netzwerkanfragen enthalten keine mit `fassung=original`

#### Scenario: Liste ohne HEIC
- **WHEN** eine Liste nur JPEG- und PDF-Anhänge zeigt
- **THEN** lädt die App keinen HEIC-Decoder

### Requirement: Platzhalter, wenn keine Vorschau möglich ist

Lässt sich ein Vorschaubild nicht laden oder dekodieren, etwa ohne Netz, bei 422 oder bei einem
Fehler des Decoders, SHALL an seinem Platz ein Platzhalter mit dem Dateityp stehen. Er MUST
dieselbe Größe haben und MUST NOT eine Fehlermeldung über der Seite auslösen. Der
Download-Verweis MUST erhalten bleiben.

#### Scenario: Ohne Netz
- **WHEN** die ETB-Zeitachse ohne Verbindung aus dem Lagebild offline gezeigt wird und ein Eintrag ein Foto trägt
- **THEN** steht an der Stelle des Vorschaubilds ein Platzhalter gleicher Größe, und die Seite zeigt keine Fehlermeldung

#### Scenario: Vorschau abgewiesen
- **WHEN** der Server für ein Bild-Anhang mit 422 antwortet
- **THEN** zeigt die Oberfläche den Platzhalter, und der Download-Verweis bleibt bedienbar
