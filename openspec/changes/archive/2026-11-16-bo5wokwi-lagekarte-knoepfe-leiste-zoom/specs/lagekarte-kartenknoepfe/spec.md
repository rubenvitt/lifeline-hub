# Spec Delta

## Purpose

Legt den Knopfblock der Kartensteuerung oben rechts auf Lagekarte, Betroffenenkarte und
Abschnittskarte des Geräts fest: welche Knöpfe ein sichtbares Wort tragen, damit ihr Zweck auch auf
Touch ohne Überfahren lesbar ist.

## ADDED Requirements

### Requirement: Kartenknöpfe tragen ein Wort unter dem Symbol

Jeder Kartenknopf außer Hinein- und Herauszoomen SHALL in jeder Dichtestufe ein sichtbares Wort
unter seinem Symbol tragen: „Norden“, „Position“, „Messen“, „Zeichnen“, „Leiste“. Der zugängliche
Name MUST unverändert bleiben (etwa „Nach Norden ausrichten“, „Leiste einblenden“). Der Name eines
Knopfs MUST NOT allein über einen Tooltip erklärt werden. Die Zoomknöpfe tragen nur „+“ und „−“.

#### Scenario: Wort am Touch-Gerät
- **WHEN** die Lagekarte in `handschuh` auf einem Gerät mit grobem Zeiger geöffnet ist
- **THEN** steht unter dem Kompass „Norden“, unter dem Lineal „Messen“ und unter dem Stift „Zeichnen“, ohne dass ein Knopf berührt wurde

#### Scenario: Zoom bleibt Symbol
- **WHEN** der Knopfblock in `kompakt` gezeigt wird
- **THEN** tragen „Hineinzoomen“ und „Herauszoomen“ nur ihr Symbol, und alle Knöpfe des Blocks sind gleich breit

#### Scenario: Zugänglicher Name bleibt
- **WHEN** ein Screenreader den Knopf mit dem Wort „Leiste“ bei offener Leiste vorliest
- **THEN** lautet sein Name „Leiste ausblenden“

### Requirement: Wort lässt die Karte bedienbar

Mit Wort MUST jeder Kartenknopf das Trefferziel der aktiven Dichtestufe behalten. Der Knopfblock MUST
mit den Bändern des Kartenfußes und der linken Überlagerung nicht überlappen. Das gilt auch, wenn er
durch das Wort breiter wird. Bei 390 px MUST neben dem Knopfblock freie Karte bleiben.

#### Scenario: Handschuh bei 390 px
- **WHEN** die Lagekarte bei 390 × 844 in `handschuh` mit ausgeklappter Zeitachse gezeigt wird
- **THEN** überschneiden sich Knopfblock, Fußbänder und linke Überlagerung nicht, und jeder Kartenknopf lässt sich antippen
