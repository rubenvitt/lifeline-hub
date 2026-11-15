# Spec Delta

## MODIFIED Requirements

### Requirement: Eine Bildmarke für die ganze App

Die App SHALL genau eine Bildmarke führen, die „Lebenslinie“. Sie besteht aus einer Pulslinie
und einem Quadrat in der Farbe `marke`, in dem die Linie endet. Kopfleiste, Anmeldeseite,
Browser-Tab, installierte PWA und Desktop-App MUST dieselbe Geometrie zeigen. Das Quadrat in
`marke` MUST der einzige rote Anteil der Bildmarke sein. Die Linie trägt die Textfarbe ihres
Grundes. In der Kopfleiste MUST neben der Bildmarke die Wortmarke `lifeline-hub` stehen, im
Einsatz-Kopf erst ab 1600 px Fensterbreite: darunter gehört der Platz dem Einsatznamen
(Fähigkeit `kopfleiste`).

#### Scenario: Kopfleiste zeigt die Bildmarke

- **WHEN** eine angemeldete Person eine Seite mit Kopfleiste außerhalb eines Einsatzes öffnet
- **THEN** zeigt die Markenzelle links oben die Bildmarke statt eines einfarbigen Quadrats
- **AND** daneben steht weiterhin die Wortmarke `lifeline-hub`

#### Scenario: Einsatz-Kopf am Arbeitsplatz

- **WHEN** eine angemeldete Person einen Einsatz bei 1440 × 900 öffnet
- **THEN** zeigt die Markenzelle die Bildmarke, und daneben steht keine Wortmarke

#### Scenario: Einsatz-Kopf am großen Monitor

- **WHEN** eine angemeldete Person einen Einsatz bei 1920 × 1080 öffnet
- **THEN** steht neben der Bildmarke die Wortmarke `lifeline-hub`

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
die Wortmarke tragen, wo sie steht; im Einsatz-Kopf unter 1600 px trägt ihn der Tab-Titel
(„… · lifeline-hub“). Die Bildmarke MUST NOT bedienbar sein.

#### Scenario: Bildschirmleser liest nur die Wortmarke

- **WHEN** ein Bildschirmleser die Kopfleiste außerhalb eines Einsatzes oder die Anmeldeseite vorliest
- **THEN** wird die Bildmarke übergangen und die Wortmarke `lifeline-hub` gelesen

#### Scenario: Einsatz-Kopf ohne Wortmarke

- **WHEN** ein Bildschirmleser die Kopfleiste eines Einsatzes bei 1440 × 900 vorliest
- **THEN** wird die Bildmarke übergangen, und der Tab-Titel endet auf „lifeline-hub“
