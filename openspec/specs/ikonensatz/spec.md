# ikonensatz Specification

## Purpose
Der eine Ikonensatz der Oberfläche: Jede Bedien- und Zustandsikone stammt aus demselben Stil,
damit Strichstärke, Raster und Formensprache auf jeder Seite gleich sind. Lücken werden nach
einer festen Regel geschlossen, nie mit einem zweiten Katalog.

## Requirements

### Requirement: Ein Ikonensatz für die ganze Oberfläche

Jede Ikone, die die App selbst setzt, SHALL aus dem Stil „iOS 27 Outlined“ von Icons8 stammen
oder, für einen aktiven Zustand, aus dessen Zwilling „iOS 27 Filled“. Eine Ikone aus einem
anderen Katalog MUST NOT erscheinen. Ausgenommen sind die Ikonen, die die UI-Bibliothek innerhalb
ihrer eigenen Bauteile zeichnet (Auswahlpfeil, Schließkreuz eines Dialogs, Sortierpfeile,
Ladeanzeige eines Knopfes), die taktischen Zeichen der Lagekarte und die Bildmarke der App.

#### Scenario: Seiten zeigen nur Ikonen des Satzes

- **WHEN** eine Seite mit Kopfleiste, Rail, Seitenkopf-Aktionen und Tabellenzeilen erscheint
- **THEN** stammt jede Ikone, die die App dort setzt, aus iOS 27 Outlined oder iOS 27 Filled

#### Scenario: Taktische Zeichen bleiben eigene Achse

- **WHEN** die Lagekarte ein taktisches Zeichen zeigt oder die Zeichenwahl öffnet
- **THEN** erscheint das Zeichen nach DV 102 unverändert und wird nicht durch eine Ikone des
  Satzes ersetzt

### Requirement: Lücken werden im Satz geschlossen

Fehlt für einen Begriff eine Ikone im Satz, SHALL zuerst ein sinnverwandter Ersatz aus demselben
Stil genommen werden. Trägt kein Ersatz den Begriff, MUST eine eigene Zeichnung im Raster und in
der Strichstärke des Stils entstehen. Eine eigene Zeichnung MUST als solche gekennzeichnet sein.
Eine Ikone aus einem zweiten Katalog MUST NOT die Lücke schließen.

#### Scenario: Ersatz aus demselben Stil

- **WHEN** der Satz für „Bagger“ keine eigene Ikone hat, wohl aber „Planierraupe“
- **THEN** zeigt die Oberfläche die Planierraupe aus iOS 27 Outlined

#### Scenario: Eigene Zeichnung bei fehlendem Ersatz

- **WHEN** der Satz für „Sandsack“ weder eine Ikone noch einen tragfähigen Ersatz hat
- **THEN** zeigt die Oberfläche eine eigene Zeichnung im Raster von iOS 27 Outlined
- **AND** die Zeichnung ist in ihrer Quelle als eigene Zeichnung gekennzeichnet

### Requirement: Eine Ikone trägt nie allein Bedeutung

Eine Ikone SHALL für assistive Technik verborgen sein, wenn neben ihr ein sichtbares Wort steht.
Ein Bedienelement, das nur eine Ikone zeigt, MUST einen zugänglichen Namen tragen, der die
Handlung nennt. Eine Ikone MUST die Farbe des Textes übernehmen, neben dem oder in dem sie steht.

#### Scenario: Ikone neben einem Wort

- **WHEN** eine Ikone in der Rail über dem Etikett „Lage“ steht
- **THEN** ist die Ikone für einen Screenreader verborgen und der Name kommt aus dem Wort

#### Scenario: Knopf nur mit Ikone

- **WHEN** eine Zeile das Aktionsmenü als Knopf ohne Text zeigt
- **THEN** trägt der Knopf einen zugänglichen Namen mit der Zeilenkennung

#### Scenario: Farbe folgt dem Text

- **WHEN** die Betriebsart zwischen Tag und Nacht wechselt
- **THEN** zeigt jede Ikone die Textfarbe ihres Grundes in der neuen Betriebsart

### Requirement: Aktiver Zustand über die gefüllte Ikone

Wo die Oberfläche zwischen aktiv und inaktiv unterscheidet und eine Ikone zeigt (Rail-Kategorie,
Favoritenstern), SHALL der aktive Zustand die Ikone aus iOS 27 Filled zeigen und der inaktive die
aus iOS 27 Outlined. Die bestehende Kennzeichnung über Farbe und Fläche MUST erhalten bleiben,
die Füllung ist ein zusätzlicher Kanal.

#### Scenario: Aktive Rail-Kategorie

- **WHEN** eine Person die Kategorie „Lage“ in der Rail wählt
- **THEN** zeigt „Lage“ die gefüllte Ikone und die aktive Fläche
- **AND** alle anderen Kategorien zeigen die umrandete Ikone

### Requirement: Ikonen bleiben in jeder Dichte lesbar

Eine Ikone SHALL in den Dichtestufen kompakt, komfortabel und Handschuh sowie im Tag- und im
Nachtbetrieb ohne Verlust ihrer Form erkennbar sein. Eine Ikone neben Text MUST mit der Schrift
dieses Textes wachsen.

#### Scenario: Ikone in einem Knopf wächst mit der Dichte

- **WHEN** die Dichte von kompakt auf Handschuh wechselt
- **THEN** wächst die Ikone in einem Knopf mit der Schrift des Knopfes

### Requirement: Ein Emoji ist keine Ikone

Die Oberfläche SHALL kein Emoji als Ikone zeigen. Wo bisher ein Emoji einen Begriff darstellte,
MUST eine Ikone des Satzes stehen, in Text- und Druckausgaben ein Kurzwort. Zulässig bleiben die
Textzeichen ⧖ und ↗ als für assistive Technik verborgene Zeichen neben einem Wort sowie ✓ als
Teil eines Wortlauts („✓ Quittiert“, „+3 ✓“).

#### Scenario: Warnmeldung in der Fachebene

- **WHEN** der Fachebenen-Inspektor eine NINA-Warnung zeigt
- **THEN** steht vor dem Titel eine Warnikone des Satzes und kein ⚠️

#### Scenario: Wetter in der Fachebene

- **WHEN** der Fachebenen-Inspektor eine Wetterlage zeigt
- **THEN** steht dort eine Ikone des Satzes neben dem Wort und kein Emoji
