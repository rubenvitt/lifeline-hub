## ADDED Requirements

### Requirement: Druckeinstiege heißen nach ihrer Wirkung

Ein Einstieg, der sofort den Druckdialog des Browsers öffnet, MUST „Drucken / als PDF“ heißen. Ein
Einstieg, der eine eigene Druckseite öffnet, MUST „Druckansicht“ heißen; druckt diese ein anderes
Dokument als die Seite, auf der er steht, MUST das Dokument davor stehen („Einsatzbericht –
Druckansicht“). Kein Druckeinstieg MUST anders heißen.

#### Scenario: Seite druckt sich selbst

- **WHEN** eine Person im Funkplan den Druckeinstieg sucht
- **THEN** heißt er „Drucken / als PDF“, und seine Wahl öffnet den Druckdialog ohne Seitenwechsel

#### Scenario: Seite mit eigener Druckseite

- **WHEN** eine Person in der Liste der Betroffenen den Druckeinstieg wählt
- **THEN** heißt er „Druckansicht“, und es öffnet sich die Druckseite der Liste mit „Drucken / als PDF“

#### Scenario: Anderes Dokument

- **WHEN** eine Person auf der Seite Einsatzdaten den Druckeinstieg sucht
- **THEN** heißt er „Einsatzbericht – Druckansicht“

### Requirement: Druckeinstiege stehen im Kopf

Druckt ein Einstieg die ganze Seite, MUST er als Nebenweg im Seitenkopf stehen: ab `md` als
sekundärer Knopf, darunter im Menü „Weitere“. Druckt er ein einzelnes Objekt in der Seite, MUST er
im Kopf dieses Objekts stehen. Ein Druckeinstieg MUST nicht in einer Werkzeugzeile im Inhalt oder am
Ende eines Paneels stehen. Auf der Druckseite selbst steht „Drucken / als PDF“ als ihre Aktion.

#### Scenario: Meldebild am Arbeitsplatz

- **WHEN** das Meldebild bei 1280 px Breite geöffnet ist
- **THEN** steht „Drucken / als PDF“ im Seitenkopf und nicht in der Werkzeugzeile über dem Raster

#### Scenario: Funkplan am Handschirm

- **WHEN** der Funkplan bei 390 × 844 geöffnet und der Auslöser „Weitere“ gewählt wird
- **THEN** enthält das Menü „Drucken / als PDF“

#### Scenario: Objekt in der Seite

- **WHEN** eine Person in „Aufträge/Befehle“ einen Auftrag im Detail öffnet
- **THEN** steht „Druckansicht“ im Kopf des Detailpaneels und nicht an seinem Ende

### Requirement: Module ohne eigenen Druck

Einheiten, Fahrzeuge, Meldungen und die Liste der Lageberichte MUST keinen eigenen Druckeinstieg
tragen: Einheiten und Fahrzeuge stehen samt Besatzung im Druck des Meldebilds, Meldungen im ETB,
jeder Lagebericht druckt sich auf seiner Seite. Die Hilfe MUST diese Wege nennen.

#### Scenario: Fahrzeuge auf Papier

- **WHEN** eine Person in der Hilfe „Drucken und Export“ nach den Fahrzeugen sucht
- **THEN** nennt die Hilfe den Druck des Meldebilds als Weg, und die Seite Fahrzeuge trägt keinen Druckeinstieg
