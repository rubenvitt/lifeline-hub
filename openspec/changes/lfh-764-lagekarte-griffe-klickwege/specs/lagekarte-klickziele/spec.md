# Spec Delta

## Purpose

Legt fest, wem ein Tipp oder Klick auf der Lagekarte gehört, wenn Markerzeichen, deren unsichtbare
Trefferzonen, Fachebenen-Objekte und Flächen am selben Punkt übereinanderliegen: genau einem Ziel.

## ADDED Requirements

### Requirement: Ein Tipp gehört genau einem Ziel
Ein Tipp auf die Lagekarte SHALL höchstens eine Wirkung auslösen: eine Auswahl für den Inspector,
ein Auffächern oder eine Kamerafahrt in ein Bündel. Er MUST nie zwei Auswahlen setzen und nie zwei
Kamerafahrten gleichzeitig anstoßen.

#### Scenario: KRITIS-Bündel im Ring eines Markers
- **WHEN** die KRITIS-Ebene sichtbar ist und ein Bündelpunkt innerhalb der Trefferzone, aber außerhalb des gezeichneten Zeichens eines Markers liegt und der Mensch auf den Bündelpunkt tippt
- **THEN** zoomt die Karte in das Bündel hinein, und es öffnet sich kein Marker-Inspector

#### Scenario: Markerzeichen über einer Zone
- **WHEN** ein Markerzeichen in einer Zone liegt und der Mensch auf das Zeichen tippt
- **THEN** zeigt der Inspector den Marker und nicht die Zone

### Requirement: Rangfolge der Klickziele
Die Karte SHALL das Ziel eines Tipps in dieser Reihenfolge bestimmen:
1. das oberste **gezeichnete Punktziel** am Tipppunkt: Markerzeichen samt Namensplakette, aufgefächertes
   Zeichen, Personen-Cluster, Fachebenen-Punkt oder Fachebenen-Bündel;
2. sonst eine **Trefferzone**; bei mehreren gewinnt der Marker, dessen Punkt dem Tipp am nächsten liegt;
3. sonst die oberste **eigene Fläche**: Zone oder Abschnitt;
4. sonst die oberste **Fachebenen-Fläche** (etwa eine NINA- oder DWD-Warnung).

Eine Trefferzone MUST gegen jedes gezeichnete Punktziel zurückstehen und MUST jede Fläche schlagen.
Eine eigene Fläche MUST einer Fachebenen-Fläche vorgehen, auch wenn diese darüber gezeichnet ist.

#### Scenario: Trefferzone schlägt eine Fläche
- **WHEN** der Mensch in einem Abschnitt neben ein Markerzeichen tippt, innerhalb dessen Trefferzone
- **THEN** zeigt der Inspector den Marker und nicht den Abschnitt

#### Scenario: Fläche ohne Marker
- **WHEN** der Mensch in eine Zone tippt, ohne dass ein Punktziel oder eine Trefferzone am Tipppunkt liegt
- **THEN** zeigt der Inspector die Zone

#### Scenario: Zwei Flächen übereinander
- **WHEN** eine Zone über einem Abschnitt liegt und der Mensch in die Überschneidung tippt
- **THEN** wählt die Karte nur die obere der beiden Flächen aus

#### Scenario: Warnfläche über einer Zone
- **WHEN** eine DWD-Warnfläche über einer Zone liegt und der Mensch in die Zone tippt
- **THEN** zeigt der Inspector die Zone und nicht die Warnung

#### Scenario: Warnfläche ohne eigene Fläche
- **WHEN** der Mensch in eine DWD-Warnfläche tippt, unter der keine Zone und kein Abschnitt liegt
- **THEN** öffnet sich die Detailansicht der Warnung

#### Scenario: Pegelpunkt im Ring eines Markers
- **WHEN** ein Fachebenen-Punkt innerhalb der Trefferzone eines Markers liegt und der Mensch auf den Punkt tippt
- **THEN** öffnet sich die Detailansicht des Fachebenen-Objekts und nicht der Marker-Inspector

### Requirement: Personen-Cluster bleiben wie festgelegt
Der Vorrang eines sichtbaren Personen-Clusters vor Trefferzonen (LFH-711) SHALL erhalten bleiben: ein
Tipp auf einen Personen-Cluster fächert ihn auf und wählt keinen Marker aus.

#### Scenario: Cluster neben einem Fahrzeug
- **WHEN** ein Personen-Cluster in der Trefferzone eines Fahrzeugs liegt und der Mensch auf den Cluster tippt
- **THEN** fächert der Cluster auf, und kein Marker-Inspector öffnet sich
