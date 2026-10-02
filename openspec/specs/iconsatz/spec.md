# iconsatz Specification

## Purpose
Der eine Iconsatz der Oberfläche: Jede Bedien- und Zustandsicon stammt aus demselben Stil,
damit Strichstärke, Raster und Formensprache auf jeder Seite gleich sind. Lücken werden nach
einer festen Regel geschlossen, nie mit einem zweiten Katalog.

## Requirements

### Requirement: Ein Iconsatz für die ganze Oberfläche

Jedes Icon, die die App selbst setzt, SHALL aus dem Stil „iOS 27 Outlined“ von Icons8 stammen
oder, für einen aktiven Zustand, aus dessen Zwilling „iOS 27 Filled“. Ein Icon aus einem
anderen Katalog MUST NOT erscheinen. Ausgenommen sind die Icons, die die UI-Bibliothek innerhalb
ihrer eigenen Bauteile zeichnet (Auswahlpfeil, Schließkreuz eines Dialogs, Sortierpfeile,
Ladeanzeige eines Knopfes), die taktischen Zeichen der Lagekarte und die Bildmarke der App.

#### Scenario: Seiten zeigen nur Icons des Satzes

- **WHEN** eine Seite mit Kopfleiste, Rail, Seitenkopf-Aktionen und Tabellenzeilen erscheint
- **THEN** stammt jedes Icon, die die App dort setzt, aus iOS 27 Outlined oder iOS 27 Filled

#### Scenario: Taktische Zeichen bleiben eigene Achse

- **WHEN** die Lagekarte ein taktisches Zeichen zeigt oder die Zeichenwahl öffnet
- **THEN** erscheint das Zeichen nach DV 102 unverändert und wird nicht durch ein Icon des
  Satzes ersetzt

### Requirement: Lücken werden im Satz geschlossen

Fehlt für einen Begriff ein Icon im Satz, SHALL zuerst ein sinnverwandter Ersatz aus demselben
Stil genommen werden. Trägt kein Ersatz den Begriff, MUST eine eigene Zeichnung im Raster und in
der Strichstärke des Stils entstehen. Eine eigene Zeichnung MUST als solche gekennzeichnet sein.
Ein Icon aus einem zweiten Katalog MUST NOT die Lücke schließen.

#### Scenario: Ersatz aus demselben Stil

- **WHEN** der Satz für „Bagger“ kein eigenes Icon hat, wohl aber „Planierraupe“
- **THEN** zeigt die Oberfläche die Planierraupe aus iOS 27 Outlined

#### Scenario: Eigene Zeichnung bei fehlendem Ersatz

- **WHEN** der Satz für „Sandsack“ weder ein Icon noch einen tragfähigen Ersatz hat
- **THEN** zeigt die Oberfläche eine eigene Zeichnung im Raster von iOS 27 Outlined
- **AND** die Zeichnung ist in ihrer Quelle als eigene Zeichnung gekennzeichnet

### Requirement: Ein Icon trägt nie allein Bedeutung

Ein Icon SHALL für assistive Technik verborgen sein, wenn neben ihm ein sichtbares Wort steht.
Ein Bedienelement, das nur ein Icon zeigt, MUST einen zugänglichen Namen tragen, der die
Handlung nennt. Ein Icon MUST die Farbe des Textes übernehmen, neben dem oder in dem es steht.

#### Scenario: Icon neben einem Wort

- **WHEN** ein Icon in der Rail über dem Etikett „Lage“ steht
- **THEN** ist das Icon für einen Screenreader verborgen und der Name kommt aus dem Wort

#### Scenario: Knopf nur mit Icon

- **WHEN** eine Zeile das Aktionsmenü als Knopf ohne Text zeigt
- **THEN** trägt der Knopf einen zugänglichen Namen mit der Zeilenkennung

#### Scenario: Farbe folgt dem Text

- **WHEN** die Betriebsart zwischen Tag und Nacht wechselt
- **THEN** zeigt jedes Icon die Textfarbe seines Grundes in der neuen Betriebsart

### Requirement: Aktiver Zustand über das gefüllte Icon

Wo die Oberfläche zwischen aktiv und inaktiv unterscheidet und ein Icon zeigt (Rail-Kategorie,
Favoritenstern), SHALL der aktive Zustand das Icon aus iOS 27 Filled zeigen und der inaktive die
aus iOS 27 Outlined. Die bestehende Kennzeichnung über Farbe und Fläche MUST erhalten bleiben,
die Füllung ist ein zusätzlicher Kanal.

#### Scenario: Aktive Rail-Kategorie

- **WHEN** eine Person die Kategorie „Lage“ in der Rail wählt
- **THEN** zeigt „Lage“ das gefüllte Icon und die aktive Fläche
- **AND** alle anderen Kategorien zeigen das umrandete Icon

### Requirement: Icons bleiben in jeder Dichte lesbar

Ein Icon SHALL in den Dichtestufen kompakt, komfortabel und Handschuh sowie im Tag- und im
Nachtbetrieb ohne Verlust ihrer Form erkennbar sein. Ein Icon neben Text MUST mit der Schrift
dieses Textes wachsen.

#### Scenario: Icon in einem Knopf wächst mit der Dichte

- **WHEN** die Dichte von kompakt auf Handschuh wechselt
- **THEN** wächst das Icon in einem Knopf mit der Schrift des Knopfes

### Requirement: Ein Emoji ist kein Icon

Die Oberfläche SHALL kein Emoji als Icon zeigen. Wo bisher ein Emoji einen Begriff darstellte,
MUST ein Icon des Satzes stehen, in Text- und Druckausgaben ein Kurzwort. Zulässig bleiben die
Textzeichen ⧖ und ↗ als für assistive Technik verborgene Zeichen neben einem Wort sowie ✓ als
Teil eines Wortlauts („✓ Quittiert“, „+3 ✓“).

#### Scenario: Warnmeldung in der Fachebene

- **WHEN** der Fachebenen-Inspektor eine NINA-Warnung zeigt
- **THEN** steht vor dem Titel eine Warnicon des Satzes und kein ⚠️

#### Scenario: Wetter in der Fachebene

- **WHEN** der Fachebenen-Inspektor eine Wetterlage zeigt
- **THEN** steht dort ein Icon des Satzes neben dem Wort und kein Emoji
