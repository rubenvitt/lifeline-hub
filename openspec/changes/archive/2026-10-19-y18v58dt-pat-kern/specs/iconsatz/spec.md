## MODIFIED Requirements

### Requirement: Ein Iconsatz für die ganze Oberfläche

Jedes Icon, die die App selbst setzt, SHALL aus dem Stil „iOS 27 Outlined“ von Icons8 stammen
oder, für einen aktiven Zustand, aus dessen Zwilling „iOS 27 Filled“. Ein Icon aus einem
anderen Katalog MUST NOT erscheinen. Ausgenommen sind die Icons, die die UI-Bibliothek innerhalb
ihrer eigenen Bauteile zeichnet (Auswahlpfeil, Schließkreuz eines Dialogs, Sortierpfeile,
Ladeanzeige eines Knopfes), die taktischen Zeichen der Lagekarte, die Bildmarke der App und die
Figur des Körperschemas samt ihren Sternchen. Die Figur ist eine eigene Zeichnung und kein Icon.

#### Scenario: Seiten zeigen nur Icons des Satzes

- **WHEN** eine Seite mit Kopfleiste, Rail, Seitenkopf-Aktionen und Tabellenzeilen erscheint
- **THEN** stammt jedes Icon, die die App dort setzt, aus iOS 27 Outlined oder iOS 27 Filled

#### Scenario: Taktische Zeichen bleiben eigene Achse

- **WHEN** die Lagekarte ein taktisches Zeichen zeigt oder die Zeichenwahl öffnet
- **THEN** erscheint das Zeichen nach DV 102 unverändert und wird nicht durch ein Icon des
  Satzes ersetzt

#### Scenario: Körperschema ist eine Zeichnung

- **WHEN** das Körperschema einer Person erscheint
- **THEN** ist die Figur eine eigene Zeichnung, und Knöpfe neben ihr tragen Icons des Satzes
