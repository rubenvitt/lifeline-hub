# Spec Delta

## Purpose

Sichert das ganze Einsatzgeschehen eines Einsatzes in einem Zug: als ein Druckstück
„Einsatzakte“ für Papier und PDF und als ZIP mit allen Anhängen und Tabellen. Sie dient der
Übergabe an die Einsatzleitung und der Nachbereitung.

## ADDED Requirements

### Requirement: Einstieg und eigene Adresse

Die Seite Einsatzdaten SHALL neben „Einsatzbericht drucken“ eine Aktion „Einsatzakte“ anbieten,
die eine eigene Druckansicht der Akte öffnet. Die Druckansicht SHALL eine eigene, teilbare
Adresse je Einsatz haben und SHALL über die Sprungpalette erreichbar sein. Gedruckt und als PDF
gespeichert wird über den Druckdialog des Browsers; der Server MUST NOT ein PDF erzeugen.

#### Scenario: Aus den Einsatzdaten öffnen

- **WHEN** eine Person auf der Seite Einsatzdaten „Einsatzakte“ wählt
- **THEN** öffnet sich die Druckansicht der Einsatzakte dieses Einsatzes
- **AND** ein Neuladen der Adresse zeigt wieder die Akte desselben Einsatzes

#### Scenario: Über die Sprungpalette

- **WHEN** eine Person in einem Einsatz die Sprungpalette öffnet und „Einsatzakte“ sucht
- **THEN** führt der Eintrag zur Druckansicht der Einsatzakte

### Requirement: Kapitel in fester Reihenfolge

Die Einsatzakte SHALL diese Kapitel in dieser Reihenfolge drucken: Einsatzbericht (alle Blöcke
samt der Anlagen Einheiten mit Einsatzzeiten, Personal je Kopf und Materialverbrauch),
Einsatztagebuch (alle Einträge), Betroffene, Aufträge, Einsatzbefehle, Lageberichte. Jedes
Kapitel SHALL auf einer neuen Seite beginnen und SHALL einen eigenen Druckkopf mit dem Namen
des Kapitels tragen. Ein Kapitel ohne Daten MUST mit einem Vermerk „keine Einträge“ stehen
bleiben. Der Inhalt eines Kapitels SHALL dem des jeweiligen Einzeldrucks entsprechen
(Einsatzbericht, ETB-Druck, Betroffenenliste, Druck eines Befehls oder Lageberichts).

#### Scenario: Vollständige Akte

- **WHEN** eine Person mit Zugriff auf alle Module die Akte eines Einsatzes mit Daten in allen
  Modulen öffnet
- **THEN** stehen die sechs Kapitel in der genannten Reihenfolge, jedes ab neuer Seite mit
  eigenem Druckkopf

#### Scenario: Kapitel ohne Daten

- **WHEN** ein Einsatz keine Lageberichte hat
- **THEN** steht das Kapitel Lageberichte mit dem Vermerk „keine Einträge“

### Requirement: Auftragsliste

Das Kapitel Aufträge SHALL alle Aufträge des Einsatzes als Tabelle führen, aufsteigend nach
Auftragsnummer, mit Nummer, Auftrag, Empfänger, Status, erteilt und erledigt (bzw. aufgehoben).
Aufgehobene Aufträge SHALL als aufgehoben in der Liste stehen bleiben.

#### Scenario: Aufgehobener Auftrag

- **WHEN** ein Einsatz einen erledigten und einen aufgehobenen Auftrag hat
- **THEN** stehen beide in der Auftragsliste, der zweite mit Status „aufgehoben“

### Requirement: Nur freigegebene Dokumente

Die Kapitel Einsatzbefehle und Lageberichte SHALL nur freigegebene Dokumente enthalten, jedes mit
seinem aktuellen Stand und seinen Bildanlagen. Entwürfe MUST NOT in der Akte stehen.

#### Scenario: Entwurf bleibt draußen

- **WHEN** ein Einsatz einen freigegebenen und einen nur entworfenen Befehl hat
- **THEN** enthält das Kapitel Einsatzbefehle nur den freigegebenen Befehl

### Requirement: Vollständig oder gar nicht

Die Einsatzakte und ihr ZIP SHALL nur abrufbar sein, wenn die Person jedes Modul lesen darf, aus
dem die Akte schöpft. Fehlt der Zugriff auf eines dieser Module, MUST die Druckansicht statt der
Akte einen Hinweis mit den gesperrten Modulen zeigen und MUST der Server den ZIP-Abruf mit 403
ablehnen; eine Akte mit stillschweigend fehlenden Teilen MUST NOT entstehen. Ein im Einsatz
ausgeblendetes Modul sperrt nicht: sein Kapitel bzw. sein Teil steht als „nicht genutzt“ da.
Solange nicht alle Kapitel geladen sind oder ein Abruf scheitert, MUST das Drucken gesperrt
sein.

#### Scenario: Modul gesperrt

- **WHEN** eine Person das Modul Betroffene nicht lesen darf und die Akte öffnet
- **THEN** zeigt die Seite „Einsatzakte nicht verfügbar“ mit dem Modul Betroffene
- **AND** der ZIP-Abruf derselben Person wird mit 403 abgelehnt

#### Scenario: Modul im Einsatz ausgeblendet

- **WHEN** im Einsatz das Modul Aufträge ausgeblendet ist
- **THEN** steht das Kapitel Aufträge mit dem Vermerk „nicht genutzt“ und die übrigen Kapitel
  sind druckbar

#### Scenario: Aufbewahrungsfrist abgelaufen

- **WHEN** die Aufbewahrungsfrist des Einsatzes abgelaufen ist
- **THEN** sind weder Akte noch ZIP abrufbar

### Requirement: Laufender Einsatz und Stand

Die Akte SHALL ein Schnappschuss zum Zeitpunkt des Öffnens sein und SHALL nicht live
nachladen; „Neu laden“ holt einen neuen Stand. Der Druckkopf jedes Kapitels SHALL den Stand
nennen. Bei einem nicht abgeschlossenen Einsatz SHALL der Kopf „Vorläufig – Einsatz läuft“
tragen.

#### Scenario: Laufender Einsatz

- **WHEN** die Akte eines laufenden Einsatzes geöffnet wird
- **THEN** trägt der Druckkopf den Vermerk „Vorläufig – Einsatz läuft“

### Requirement: Betroffene mit Namen werden protokolliert

Das Kapitel Betroffene SHALL die Betroffenenliste mit Namen enthalten. Jeder Abruf dieser Daten
für die Akte MUST einen Eintrag im Zugriffsprotokoll der Personen erzeugen, bevor Daten den
Server verlassen; ohne Eintrag MUST der Abruf scheitern. Die Daten MUST NOT aus einem früheren
Abruf oder dem Zwischenspeicher der Liste stammen.

#### Scenario: Akte öffnen protokolliert

- **WHEN** eine Person die Akte öffnet
- **THEN** steht danach im Zugriffsprotokoll ein Druck-Eintrag dieser Person für den Einsatz

### Requirement: ZIP mit Anhängen und Tabellen

Die Druckansicht SHALL einen Download „Anhänge und Tabellen (ZIP)“ anbieten. Das ZIP SHALL
enthalten:

- jeden nicht gelöschten Anhang des Einsatzes aus Einsatztagebuch, Betroffenen, Schäden, Tieren,
  Unfallhilfsstellen, Dokumentenablage sowie den Anlagen freigegebener Einsatzbefehle und
  Lageberichte, in der Fassung, die auch der Einzel-Download liefert (bereinigt), mit dem
  ursprünglichen Dateinamen, je Modul und Datensatz in einem eigenen Ordner;
- die Tabellen der Betroffenen, Tiere und Schäden als CSV, in derselben Form wie ihre
  Einzel-Exporte;
- ein Inhaltsverzeichnis als CSV mit Pfad, Modul, Datensatz, Dateiname, Größe und Prüfsumme je
  Datei.

Anhänge eines im Einsatz ausgeblendeten Moduls MUST NOT enthalten sein. Ein Anhang, der sich nicht
bereinigen lässt, MUST NOT enthalten sein und SHALL im Inhaltsverzeichnis als „nicht enthalten“
mit Grund stehen. Der Dateiname des ZIP SHALL Einsatznummer und Datum tragen. Chat-Anhänge
MUST NOT enthalten sein.

#### Scenario: Anhang im ZIP

- **WHEN** ein ETB-Eintrag ein Foto `lage.jpg` trägt und die Person das ZIP lädt
- **THEN** enthält das ZIP die Datei unter dem Ordner des ETB-Eintrags mit dem Namen `lage.jpg`
- **AND** das Inhaltsverzeichnis nennt Größe und Prüfsumme dieser Datei

#### Scenario: Gelöschter Anhang

- **WHEN** ein Anhang eines Schadens gelöscht wurde
- **THEN** fehlt er im ZIP und im Inhaltsverzeichnis

#### Scenario: Doppelte Dateinamen

- **WHEN** ein Datensatz zwei Anhänge mit demselben Dateinamen trägt
- **THEN** stehen beide im ZIP unter unterscheidbaren Namen

### Requirement: ZIP-Abruf wird protokolliert

Der ZIP-Abruf MUST, bevor Daten den Server verlassen, für die Betroffenentabelle einen
Export-Eintrag und für jeden enthaltenen Anhang einer Person einen Anhang-Eintrag im
Zugriffsprotokoll der Personen schreiben, und für jeden enthaltenen Anhang einer
Unfallhilfsstelle einen Eintrag im Zugriffsprotokoll der Anhänge. Scheitert ein solcher Eintrag,
MUST der Abruf ohne Daten scheitern.

#### Scenario: Personen-Anhang im ZIP

- **WHEN** eine Person das ZIP eines Einsatzes lädt, in dem eine Betroffene einen Anhang trägt
- **THEN** stehen im Zugriffsprotokoll ein Export-Eintrag für den Einsatz und ein Anhang-Eintrag
  für diese Betroffene

### Requirement: Ein ZIP-Bau je Einsatz zugleich

Läuft für einen Einsatz bereits ein ZIP-Bau, SHALL ein weiterer Abruf mit 409 und dem Hinweis
„ZIP wird bereits erstellt“ abgelehnt werden, ohne Protokolleintrag.

#### Scenario: Doppelklick

- **WHEN** eine Person den ZIP-Download zweimal kurz hintereinander auslöst
- **THEN** liefert der erste Abruf das ZIP und der zweite 409
