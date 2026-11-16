# Spec Delta

## Purpose

Legt die Größe der Schrift in der Oberfläche fest: welche Größenstufen es gibt, welcher Boden gilt,
wie die Schrift mit der Bediendichte wächst und dass sich die Ansicht im Browser vergrößern lässt.

## ADDED Requirements

### Requirement: Sechs Größenstufen

Text in der Oberfläche SHALL in genau einer von sechs Größenstufen stehen, in `kompakt` 11, 12,
14, 16, 22 und 32 px. Keine andere Größe MUST am Schirm gerendert werden. Ausgenommen sind die
Druckansichten (Papierskala in pt), die Fernsicht-Skala des Lagemonitors, die Großbild-Skala
(`grossMass`, wächst mit dem Fenster) und Zeichnungen mit eigenem Maßstab (Lagekarte,
Fernmeldeskizze, taktische Zeichen).

#### Scenario: Gerenderte Größen am Fükw
- **WHEN** in `kompakt` der Überblick, die Einsatzdaten, das ETB, die Betroffenen und die Lagekarte am Fükw-Schirm stehen
- **THEN** misst jeder sichtbare Textknoten 11, 12, 14, 16, 22 oder 32 px

#### Scenario: Zeichnung mit eigenem Maßstab
- **WHEN** die Fernmeldeskizze in einem Einsatz steht
- **THEN** stehen ihre Wörter in mindestens 11 Zeichnungseinheiten, die mit dem Zoom der Skizze skalieren

#### Scenario: Druck bleibt ausgenommen
- **WHEN** eine Druckansicht im Druckmedium steht
- **THEN** gilt für ihren Text die Papierskala, nicht die sechs Stufen

### Requirement: Kein Text unter 11 px

Kein Text am Schirm MUST kleiner als 11 px sein, in keiner Dichtestufe, auch nicht Augenbraue,
Rail-Etikett, Tabellenkopf oder Beschriftungen in Diagrammen. In Zeichnungen mit eigenem Maßstab
gilt der Boden in Zeichnungseinheiten; nur Glyphen eines Zeichens sind kleiner.

#### Scenario: Kleinste Schrift
- **WHEN** in `kompakt` eine Seite mit Rail, Augenbrauen, Tabellenköpfen und Metazeilen steht
- **THEN** ist kein sichtbarer Textknoten kleiner als 11 px

#### Scenario: Diagramm in schmaler Spalte
- **WHEN** die Pegel-Verlaufslinie mit Prognose in einer Spalte schmaler als ihre Zeichenbreite steht
- **THEN** misst die Beschriftung der Prognose weiterhin mindestens 11 px

### Requirement: Der Seitentitel überragt den Lauftext

Der Titel im Seitenkopf SHALL in der Stufe 16 px mit Gewicht 600 stehen, also größer als der
Lauftext (14 px). Die Uhr im Kopf ist Daueranzeige und steht in der Stufe des Lauftexts (14 px
in `kompakt`). Der Seitenkopf MUST in `kompakt` am
Fükw-Schirm 44 px hoch bleiben.

#### Scenario: Titel und Lauftext
- **WHEN** eine Einsatzseite in `kompakt` am Fükw-Schirm steht
- **THEN** misst der Seitentitel 16 px, der Lauftext darunter 14 px, und der Seitenkopf ist 44 px hoch

### Requirement: Warnhinweise in mindestens 14 px

Das Wort eines Warnhinweises (Warnstufe, Sammelbanner, Filterhinweis, Wetterwarnung im Kopf und
der Titel des Eingangsbands als Alarmhinweis) SHALL in mindestens 14 px mit Gewicht 600 stehen.

#### Scenario: Warnstufe hoch
- **WHEN** eine Gefahr mit der Warnstufe „hoch“ in `kompakt` angezeigt wird
- **THEN** misst das Wort der Warnstufe mindestens 14 px

### Requirement: Die Schrift wächst mit der Dichte

Die Stufen bis 16 px SHALL mit der Bediendichte wachsen, um den Faktor 1 in `kompakt`, 1,15 in
`komfortabel` und 1,25 in `handschuh`, auch die Grundschrift der Bedienelemente. Die Datenwerte
(22 und 32 px) MUST in jeder Stufe gleich bleiben. Der Anteil des Texts unter 12 px MUST mit der
Stufe sinken, nicht steigen. Schon das erste Bild nach dem Laden MUST in der Stufe stehen.

#### Scenario: Status-Chip neben dem Knopf
- **WHEN** die Dichtestufe `handschuh` gewählt ist und eine Liste mit Status-Chips und Knöpfen steht
- **THEN** misst die Schrift des Chips das 1,25-Fache ihrer Größe in `kompakt`, ebenso die Beschriftung des Knopfs

#### Scenario: Erstes Bild in der gespeicherten Stufe
- **WHEN** auf einem Gerät `handschuh` gespeichert ist und die Anwendung neu lädt
- **THEN** steht schon das erste Bild in den Größen von `handschuh`, und kein Text springt nach dem Laden

#### Scenario: Datenwert bleibt
- **WHEN** dieselbe Kennzahl in `kompakt` und in `handschuh` steht
- **THEN** ist ihr Datenwert in beiden Stufen gleich groß

#### Scenario: Anteil kleiner Schrift
- **WHEN** dieselben Seiten in `kompakt`, `komfortabel` und `handschuh` gemessen werden
- **THEN** ist der Anteil der Zeichen unter 12 px in `komfortabel` und `handschuh` nicht größer als in `kompakt`

### Requirement: Die Ansicht lässt sich vergrößern

Die Anwendung MUST das Vergrößern der Ansicht im Browser und auf Touchgeräten per Geste
zulassen. Ein Doppeltipp MUST weiterhin nicht zoomen.

#### Scenario: Pinch-Zoom auf dem Handschirm
- **WHEN** die Anwendung auf einem Mobilgerät geöffnet wird
- **THEN** erlaubt der Viewport das Vergrößern per Geste, und er nennt keine Höchstvergrößerung

#### Scenario: Eingabefelder auf Touchgeräten
- **WHEN** auf einem Touchgerät in `komfortabel` ein Textfeld den Fokus bekommt
- **THEN** misst seine Schrift mindestens 16 px

### Requirement: Größen nur aus der Skala

Eine Schriftgröße SHALL im Frontend nur aus der Schriftskala des Themes kommen. Ein Größenwert
als Zahl oder Pixelangabe außerhalb des Themes MUST die Prüfung rot machen, auch in einer benannten
Konstante, ohne Ausnahmeliste für Bestand; ausgenommen sind Druck-CSS, die Fernsicht-Skala des
Lagemonitors, die Großbild-Skala (`grossMass`) und Zeichnungen mit eigenem Maßstab.

#### Scenario: Neues Literal
- **WHEN** eine Komponente eine Schriftgröße als Zahl oder `px`-Wert setzt, auch über eine Konstante wie `BAND_SCHRIFT = 13`
- **THEN** schlägt die Frontend-Prüfung fehl und nennt Datei und Stelle

#### Scenario: Stufe aus der Skala
- **WHEN** eine Komponente ihre Schriftgröße über eine Stufe der Skala setzt
- **THEN** besteht die Prüfung
