# app-marke Specification

## Purpose

Das Zeichen der App: eine Bildmarke, an der man Lifeline Hub in der Oberfläche, im Browser, als
installierte PWA und als Desktop-App wiedererkennt, auch in kleiner Darstellung.

## Requirements

### Requirement: Eine Bildmarke für die ganze App

Die App SHALL genau eine Bildmarke führen, die „Lebenslinie“. Sie besteht aus einer Pulslinie
und einem Quadrat in der Farbe `marke`, in dem die Linie endet. Kopfleiste, Anmeldeseite,
Browser-Tab, installierte PWA und Desktop-App MUST dieselbe Geometrie zeigen. Das Quadrat in
`marke` MUST der einzige rote Anteil der Bildmarke sein. Die Linie trägt die Textfarbe ihres
Grundes.

#### Scenario: Kopfleiste zeigt die Bildmarke

- **WHEN** eine angemeldete Person eine Seite mit Kopfleiste öffnet
- **THEN** zeigt die Markenzelle links oben die Bildmarke statt eines einfarbigen Quadrats
- **AND** daneben steht weiterhin die Wortmarke `lifeline-hub`

#### Scenario: Anmeldeseite zeigt die Bildmarke im Tag- und Nachtbetrieb

- **WHEN** die Anmeldeseite im Tag- oder im Nachtbetrieb erscheint
- **THEN** steht die Bildmarke vor der Wortmarke
- **AND** die Linie hat die Textfarbe der jeweiligen Betriebsart, das Quadrat die Farbe `marke`

#### Scenario: Symbole folgen derselben Geometrie

- **WHEN** Favicon, PWA-Symbole und Desktop-Symbole aus ihren Quellen erzeugt werden
- **THEN** verwenden alle Quellen dieselbe Linien- und Quadratgeometrie wie die Bildmarke der
  Oberfläche

### Requirement: Die Bildmarke ist Dekoration

Die Bildmarke SHALL für assistive Technik verborgen sein. Den zugänglichen Namen der App MUST
weiterhin die Wortmarke tragen. Die Bildmarke MUST NOT bedienbar sein.

#### Scenario: Bildschirmleser liest nur die Wortmarke

- **WHEN** ein Bildschirmleser die Kopfleiste oder die Anmeldeseite vorliest
- **THEN** wird die Bildmarke übergangen und die Wortmarke `lifeline-hub` gelesen

### Requirement: Symbole in Nenngröße für Browser und PWA

Die App SHALL ein Favicon als Vektorgrafik ausliefern. Das Manifest der PWA SHALL Symbole in
192 × 192 und 512 × 512 Pixel mit Zweck „any“ führen und ein eigenes Symbol mit Zweck
„maskable“. Für den Startbildschirm von iPad und iPhone SHALL ein Symbol in 180 × 180 Pixel
eingebunden sein. Jede Rastergrafik MUST genau die Pixelmaße haben, die ihr Eintrag angibt.
Beim maskierbaren Symbol MUST die ganze Bildmarke innerhalb des sicheren Kreises liegen
(Radius 40 % der Kantenlänge, mittig).

#### Scenario: PWA installieren

- **WHEN** jemand die App aus dem Browser als PWA installiert
- **THEN** zeigen Installationsdialog und Startbildschirm die Bildmarke auf Kopf-Schwarz

#### Scenario: Maske des Systems schneidet nichts ab

- **WHEN** ein System das maskierbare Symbol als Kreis oder abgerundetes Quadrat beschneidet
- **THEN** bleiben Pulslinie und Quadrat vollständig sichtbar

#### Scenario: Zum Home-Bildschirm auf dem iPad

- **WHEN** jemand die App in Safari auf dem iPad „Zum Home-Bildschirm“ hinzufügt
- **THEN** erscheint die Bildmarke, kein Bildschirmfoto der Seite

### Requirement: Titelleiste und Startbildschirm der PWA in Kopf-Schwarz

Das Manifest SHALL als Themen- und Hintergrundfarbe das Kopf-Schwarz `#0c0e11` angeben, im Tag-
wie im Nachtbetrieb. Rot MUST NOT als Flächenfarbe von Titelleiste oder Startbildschirm dienen.

#### Scenario: Installierte PWA starten

- **WHEN** die installierte PWA startet
- **THEN** sind Startbildschirm und Titelleiste Kopf-Schwarz, nicht rot und nicht weiß

### Requirement: Desktop-Symbol erkennbar bis 32 Pixel

Die Desktop-Hülle SHALL ihre Symbole für macOS und Windows aus der Bildmarke beziehen. Das
macOS-Symbol MUST dem Raster der Plattform folgen (abgerundete Grundform mit Rand), damit es im
Dock so groß wirkt wie andere Apps. Pulslinie und Quadrat MUST bei 32 Pixel Kantenlänge
voneinander unterscheidbar bleiben.

#### Scenario: App im Dock und in der Taskleiste

- **WHEN** die Desktop-App unter macOS oder Windows läuft
- **THEN** zeigen Dock bzw. Taskleiste die Bildmarke auf Kopf-Schwarz

#### Scenario: Kleinste Darstellung

- **WHEN** das Symbol in 32 × 32 Pixel dargestellt wird
- **THEN** sind Zacke der Pulslinie und rotes Quadrat als getrennte Formen erkennbar
