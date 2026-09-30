# lagekarte-bildgriffe Specification

## Purpose

Legt fest, welche Ziehgriffe eines Kartenbildes auf der Lagekarte scharf sind, damit ein Tipp immer
den Griff trifft, den der Mensch meint, und nie die DOM-Reihenfolge darüber entscheidet.

## Requirements

### Requirement: Scharfe Griffe überlappen sich nicht
Im Modus „Größe" SHALL die Karte alle vier Eckgriffe scharf schalten. Ein Kantengriff MUST nur dann
scharf sein, wenn seine anfassbare Fläche weder die eines Eckgriffs noch die eines anderen
Kantengriffs überlappt. In den Modi „Verschieben" und „Drehen" ist je genau ein Griff scharf. Die
anfassbare Fläche eines Griffs ist die Griffkante der aktiven Dichtestufe, mindestens 44 px.

#### Scenario: Kleines Bild in der Handschuh-Stufe
- **WHEN** ein Bild im Platziermodus am Schirm rund 120 × 120 px groß ist, die Dichtestufe „Handschuh" (Griffkante 72 px) aktiv ist und der Modus „Größe" gewählt ist
- **THEN** sind genau die vier Eckgriffe scharf, und keine zwei scharfen Griffe überlappen sich

#### Scenario: Dasselbe Bild in der kompakten Stufe
- **WHEN** dasselbe Bild in der Dichtestufe „kompakt" (Griffkante 44 px) im Modus „Größe" steht
- **THEN** sind Ecken und Kanten scharf, und keine zwei scharfen Griffe überlappen sich

#### Scenario: Gedrehtes Bild
- **WHEN** ein Bild von rund 120 × 120 px um 45° gedreht ist und der Modus „Größe" gewählt ist
- **THEN** überlappen sich in keiner Dichtestufe zwei scharfe Griffe

### Requirement: Die Griffwahl folgt der Darstellung, nicht der Ziehgeste
Die Wahl der scharfen Kantengriffe SHALL nach jeder Kartenbewegung (Zoom, Drehung, Verschiebung) und
nach dem Loslassen eines Griffs neu getroffen werden. Während eine Ziehgeste läuft, MUST die Wahl
unverändert bleiben; der gezogene Griff MUST bis zum Loslassen scharf bleiben.

#### Scenario: Heranzoomen macht Kanten scharf
- **WHEN** Kanten wegen Platzmangel ausgeblendet sind und die Karte so weit herangezoomt wird, dass zwischen den Griffen Platz ist
- **THEN** werden die Kantengriffe ohne weiteres Zutun scharf

#### Scenario: Verkleinern über einen Eckgriff
- **WHEN** ein Eckgriff gezogen wird, bis das Bild so klein ist, dass die Kanten keinen Platz mehr hätten
- **THEN** bleiben die Griffe während des Ziehens unverändert, und erst nach dem Loslassen werden die Kantengriffe abgezogen

### Requirement: Der Hinweis nennt nur scharfe Griffe
Der Hinweis unter dem Griff-Umschalter SHALL nur die Griffe beschreiben, die gerade scharf sind. Sind
im Modus „Größe" Kantengriffe wegen Platzmangel ausgeblendet, MUST der Hinweis das sagen und
Heranzoomen als Ausweg nennen. Sind nur einige ausgeblendet, MUST er die übrigen Kanten weiter als
bedienbar nennen.

#### Scenario: Kanten ausgeblendet
- **WHEN** im Modus „Größe" die Kantengriffe ausgeblendet sind
- **THEN** beschreibt der Hinweis die Ecken und sagt, dass die Kanten erst nach dem Heranzoomen erscheinen

#### Scenario: Einige Kanten ausgeblendet
- **WHEN** auf einem langen, schmalen Bild im Modus „Größe" nur die Griffe der langen Kanten scharf sind
- **THEN** nennt der Hinweis Ecken und Kanten als bedienbar und sagt, dass weitere Kanten nach dem Heranzoomen erscheinen

#### Scenario: Kanten scharf
- **WHEN** im Modus „Größe" alle Kantengriffe scharf sind
- **THEN** beschreibt der Hinweis Ecken und Kanten wie bisher

### Requirement: Rest unterhalb einer Griffkante
Ist ein Bild am Schirm schmaler oder niedriger als eine Griffkante, SHALL die Karte die Eckgriffe
trotzdem scharf lassen, auch wenn sie sich dann überlappen; das Bild bleibt so bearbeitbar. Der
Hinweis MUST in diesem Fall Heranzoomen nennen.

#### Scenario: Winziges Bild
- **WHEN** ein Bild am Schirm 30 × 30 px groß ist und der Modus „Größe" gewählt ist
- **THEN** sind die vier Eckgriffe scharf, die Kanten nicht, und der Hinweis nennt Heranzoomen
