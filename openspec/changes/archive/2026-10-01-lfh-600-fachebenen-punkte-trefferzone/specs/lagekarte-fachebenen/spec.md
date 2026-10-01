# Spec Delta

## ADDED Requirements

### Requirement: Die Trefffläche eines Fachebenen-Punkts folgt der Bediendichte
Jeder Punkt und jedes Bündel einer Punkt-Fachebene SHALL über eine Trefffläche anwählbar sein, deren
Durchmesser der eingestellten Dichtestufe folgt: mindestens 30 px in `kompakt`, 48 px in
`komfortabel` und 72 px in `handschuh`. Die Trefffläche MUST vom gezeichneten Kreis unabhängig sein
und MUST NOT sichtbar sein.

#### Scenario: Tipp neben einen Pegel im Handschuh-Modus
- **WHEN** die Dichtestufe `handschuh` eingestellt und die Pegel-Ebene sichtbar ist und der Mensch 30 px neben die Mitte eines Pegelpunkts tippt, wo nichts anderes gezeichnet ist
- **THEN** öffnet sich die Detailansicht dieses Pegels

#### Scenario: Jede Punkt-Fachebene ist betroffen
- **WHEN** eine beliebige Punkt-Fachebene sichtbar ist (Pegel, Hochwasser, Luftqualität, ODL, Autobahn, KRITIS, Energie)
- **THEN** ist jeder ihrer Einzelpunkte in jeder Dichtestufe über eine Trefffläche mindestens der Stufe anwählbar

#### Scenario: Tipp neben ein KRITIS-Bündel
- **WHEN** die Dichtestufe `handschuh` eingestellt ist und der Mensch innerhalb von 36 px um die Mitte eines KRITIS-Bündels, aber außerhalb des gezeichneten Kreises tippt
- **THEN** zoomt die Karte in das Bündel hinein

#### Scenario: Gegenprobe kompakt
- **WHEN** die Dichtestufe `kompakt` eingestellt ist und der Mensch 23 px neben die Mitte eines Pegelpunkts tippt, wo nichts anderes liegt
- **THEN** öffnet sich keine Detailansicht

### Requirement: Der Radius als Stufe bleibt von der Trefffläche unberührt
Trägt eine Punkt-Fachebene ihre Stufe im Punktdurchmesser (Hochwasser, Luftqualität, ODL), SHALL der
gezeichnete Durchmesser je Stufe unabhängig von der Dichtestufe gleich bleiben. Punkte verschiedener
Stufen MUST in jeder Dichtestufe verschieden groß gezeichnet sein.

#### Scenario: Zwei Hochwasser-Stufen im Handschuh-Modus
- **WHEN** die Dichtestufe `handschuh` eingestellt ist und zwei Hochwasser-Pegel mit verschiedener Stufe sichtbar sind
- **THEN** ist der Kreis der höheren Stufe größer gezeichnet als der der niedrigeren, und beide Kreise sind so groß wie in `kompakt`

### Requirement: Die Kontur eines Fachebenen-Punkts hebt sich von jedem Kartengrund ab
Jeder Punkt und jedes Bündel einer Punkt-Fachebene SHALL eine Kontur tragen, die gegen jeden
Kartengrund mindestens 3 : 1 Kontrast hält (WCAG 1.4.11), in heller und dunkler Kartendarstellung und
mit Online-, Offline- und Blindgrundlage. Die Kontur MUST unabhängig von der Farbe des Punkts sein.

#### Scenario: Gelber Punkt auf heller Karte
- **WHEN** ein Hochwasser-Pegel der Stufe Achtung auf heller Kartengrundlage gezeichnet ist
- **THEN** steht seine Kontur gegen den Kartengrund bei mindestens 3 : 1

#### Scenario: Punkt auf dunkler Karte
- **WHEN** ein Pegelpunkt auf dunkler Kartengrundlage gezeichnet ist
- **THEN** steht seine Kontur gegen den Kartengrund bei mindestens 3 : 1
