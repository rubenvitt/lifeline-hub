# schaden-gefahr Specification

## Purpose
Ein Schaden kann eine Gefahr und einen Schadensgrad nach DV 102 tragen. Beide Angaben sind
freiwillig. Sie stehen überall in Worten, wo der Schaden gelesen wird, und bestimmen sein Zeichen
auf der Lagekarte (Capability `lagekarte-taktische-zeichen`).

## Requirements

### Requirement: Gefahr und Schadensgrad am Schaden

Das System SHALL an einem Schaden eine Gefahr und einen Schadensgrad speichern können. Die Gefahr
MUST aus denselben Werten stammen wie die Gefahr eines Gefahrengebiets und dieselben Wörter tragen.
Der Schadensgrad MUST einer der drei Grade nach DV 102 sein: „angeschlagen“, „teilzerstört“ oder
„total zerstört“. Beide Angaben SHALL leer bleiben dürfen. Ein unbekannter Wert MUST mit 400
abgelehnt werden, ohne dass etwas gespeichert wird. Beim Bearbeiten MUST eine fehlende Angabe den
gespeicherten Wert lassen und eine leere Angabe ihn leeren. Die Datenbank MUST keine
Zeichenkennungen speichern.

#### Scenario: Schaden mit Gefahr anlegen
- **WHEN** ein Schaden mit Gefahr „Elektrizität“ und Schadensgrad „total zerstört“ angelegt wird
- **THEN** liefert der Schaden beide Werte, und das Einsatztagebuch nennt sie in Worten

#### Scenario: Unbekannte Gefahr
- **WHEN** ein Schaden mit einer Gefahr angelegt wird, die es nicht gibt
- **THEN** antwortet das System mit 400, und es entsteht weder Schaden noch Tagebucheintrag

#### Scenario: Gefahr leeren
- **WHEN** an einem Schaden mit Gefahr „Brand“ die Gefahr geleert wird
- **THEN** trägt der Schaden keine Gefahr mehr, und sein Schadensgrad bleibt

### Requirement: Erfassen und Bearbeiten

Der Erfassungsdialog SHALL die Gefahr unter den sichtbaren Feldern anbieten, neben jeder Gefahr
das Kartenzeichen, das der Schaden damit bekommt. Beschreibung und Schadensgrad SHALL unter
„Weitere Angaben“ liegen. Die Detailseite SHALL Gefahr und Schadensgrad in Worten zeigen und im
Bearbeiten-Modus an Ort und Stelle ändern lassen.

#### Scenario: Zeichen in der Auswahl
- **WHEN** im Erfassungsdialog mit Ausmaß „groß“ die Gefahrenauswahl geöffnet wird
- **THEN** steht neben „Elektrizität“ das orange Gefahrenzeichen mit dem Hinweis auf elektrische Energie

### Requirement: Lesen in Worten

Schadensliste, Druck, CSV-Export und der Inspector der Lagekarte SHALL Gefahr und Schadensgrad in
Worten nennen; ohne Angabe steht ein Strich oder ein leeres Feld. Die Schadensliste SHALL nach der
Gefahr filtern, und der Filter MUST über den ganzen Bestand am Server wirken. Der CSV-Export SHALL
alle nicht stornierten Schäden des Einsatzes aufsteigend nach Registriernummer enthalten, unter
demselben Recht wie die Schadensliste. Ein Lage-Snapshot MUST Gefahr und Schadensgrad mit
einfrieren.

#### Scenario: Liste nach Gefahr filtern
- **WHEN** in der Schadensliste der Filter „Gefahr“ auf „Atemgifte“ steht
- **THEN** zeigt die Liste nur Schäden mit dieser Gefahr, auch solche, die noch nicht geladen waren

#### Scenario: CSV-Export
- **WHEN** die Schadensliste als CSV exportiert wird
- **THEN** nennt jede Zeile Gefahr und Schadensgrad in Worten, etwa „Elektrizität“ und „total zerstört“

### Requirement: Gefahrenhinweis je Gefahr

Das Kartenzeichen eines Schadens SHALL einen Gefahrenhinweis nur tragen, wenn DV 102 Kap. 5.8.1
für seine Gefahr einen Hinweis festlegt. Das System MUST NOT eigene Hinweise oder Kennbuchstaben
erfinden, die wie ein Hinweis nach DV 102 aussehen. Eine Gefahr ohne Hinweis MUST das leere
Gefahrenzeichen in der Farbe des Ausmaßes zeigen; die Gefahr steht dann in Worten (Inspector,
Liste, Druck). Die Abbildung MUST dieser Tabelle folgen:

| Gefahr | Hinweis | Begründung |
| --- | --- | --- |
| Atomare Strahlung | 5.8.1.8 „Gefahr durch Radioaktivität“ | genau |
| Chemische Stoffe | 5.8.1.7 „Gefährliche Stoffe“ | genau |
| Explosion | 5.8.1.11 „Gefahr durch Explosion“ | genau |
| Elektrizität | 5.8.1.9 „Gefahr durch elektrische Energie“ | genau |
| Ertrinken | 5.8.1.6 „Gefahr durch Wassereinbruch“ | Näherung: beide meinen Gefahr durch Wasser |
| Atemgifte | keiner | DV 102 kennt keinen Hinweis; „Gefährliche Stoffe“ meint Gefahrstoffe und deckt Brandrauch und Sauerstoffmangel nicht |
| Angstreaktion | keiner | DV 102 kennt keinen Hinweis für eine Reaktion von Menschen |
| Ausbreitung | keiner | DV 102 kennt keinen Hinweis; Ausbreitung ist keine Gefahrenquelle, sondern ihr Verlauf |
| Erkrankung/Verletzung | keiner | DV 102 kennt dafür nur Zustände an Personen und Tieren (5.8.6, 5.8.8), keinen Gefahrenhinweis |
| Einsturz | keiner | DV 102 kennt keinen Hinweis; der Schadensgrad (5.8.4) beschreibt das Bauwerk |
| Absturz | keiner | DV 102 kennt keinen Hinweis |
| Brand | keiner | DV 102 kennt nur Brandphasen (5.8.5); sie bezeichnen die Phase eines Brandes, keine Gefahr |
| Durchbruch | keiner | DV 102 kennt keinen Hinweis |

Die Hinweise „Überschwemmtes Gebiet“ (5.8.1.5), „Gefahr durch Mineralöl“ (5.8.1.10) und „Gefahr
durch explosionsfähige Kampfmittel“ (5.8.1.12) SHALL ungenutzt bleiben. Die Gefahren eines
Schadens sind die Gefahren der Gefahrenmatrix; Mineralöl gehört dort zu „Chemische Stoffe“,
Kampfmittel zu „Explosion“, Überschwemmung zu „Ertrinken“. Eine eigene Gefahr dafür hätte im
Gefahrengebiet keine Zeile.

#### Scenario: Gefahr mit Hinweis
- **WHEN** ein Schaden mit Ausmaß „mittel“ und Gefahr „Explosion“ verortet ist
- **THEN** zeigt die Karte das gelbe Gefahrenzeichen mit dem Hinweis „Gefahr durch Explosion“

#### Scenario: Gefahr ohne Hinweis
- **WHEN** ein Schaden mit Ausmaß „gering“ und Gefahr „Atemgifte“ verortet ist
- **THEN** zeigt die Karte das grüne Gefahrenzeichen ohne Hinweis, und der Inspector nennt „Atemgifte“
