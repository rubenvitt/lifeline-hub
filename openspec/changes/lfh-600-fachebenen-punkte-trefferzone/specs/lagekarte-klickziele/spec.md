# Spec Delta

## MODIFIED Requirements

### Requirement: Rangfolge der Klickziele
Die Karte SHALL das Ziel eines Tipps in dieser Reihenfolge bestimmen:
1. das oberste **gezeichnete Punktziel** am Tipppunkt: Markerzeichen samt Namensplakette, aufgefächertes
   Zeichen, Personen-Cluster, Fachebenen-Punkt oder Fachebenen-Bündel;
2. sonst eine **Trefferzone** eines Markers oder eines Fachebenen-Punkts oder -Bündels; bei mehreren
   gewinnt das Ziel, dessen Punkt dem Tipp am nächsten liegt, gleich welcher Art;
3. sonst die **Flächen** am Tipppunkt (Zone, Abschnitt, Fachebenen-Fläche): liegt genau eine dort, ist
   sie das Ziel; liegen zwei oder mehr verschiedene dort, entscheidet der Mensch über ein Auswahlmenü.

Eine Trefferzone MUST gegen jedes gezeichnete Punktziel zurückstehen und MUST jede Fläche schlagen.
Eine eigene Fläche (Zone, Abschnitt) MUST im Auswahlmenü vor jeder Fachebenen-Fläche stehen, auch
wenn diese darüber gezeichnet ist. Dieselbe Fläche MUST als eine zählen, auch wenn die Karte sie mehrfach meldet (Füllung und Umriss,
Kachelgrenzen).

#### Scenario: Trefferzone schlägt eine Fläche
- **WHEN** der Mensch in einem Abschnitt neben ein Markerzeichen tippt, innerhalb dessen Trefferzone
- **THEN** zeigt der Inspector den Marker und nicht den Abschnitt

#### Scenario: Trefferzone schlägt auch mehrere Flächen
- **WHEN** der Mensch in die Überschneidung einer Zone und eines Abschnitts tippt, innerhalb der Trefferzone eines Markers
- **THEN** zeigt der Inspector den Marker, und es öffnet sich kein Auswahlmenü

#### Scenario: Fläche ohne Marker
- **WHEN** der Mensch in eine Zone tippt, ohne dass ein Punktziel, eine Trefferzone oder eine weitere Fläche am Tipppunkt liegt
- **THEN** zeigt der Inspector die Zone, ohne Auswahlmenü

#### Scenario: Zone mit Füllung und Umriss
- **WHEN** der Mensch auf den Rand einer Zone tippt, an dem Füllung und Umriss derselben Zone liegen, und keine andere Fläche dort liegt
- **THEN** zeigt der Inspector die Zone, ohne Auswahlmenü

#### Scenario: Zwei Flächen übereinander
- **WHEN** eine Zone über einem Abschnitt liegt und der Mensch in die Überschneidung tippt
- **THEN** öffnet sich ein Auswahlmenü mit der Zone und dem Abschnitt, und keine der beiden ist ausgewählt

#### Scenario: Warnfläche über einer Zone
- **WHEN** eine DWD-Warnfläche über einer Zone liegt und der Mensch in die Zone tippt
- **THEN** öffnet sich ein Auswahlmenü mit der Zone zuerst und der Warnung danach, und keine der beiden ist ausgewählt

#### Scenario: Warnfläche ohne eigene Fläche
- **WHEN** der Mensch in eine DWD-Warnfläche tippt, unter der keine Zone und kein Abschnitt liegt
- **THEN** öffnet sich die Detailansicht der Warnung, ohne Auswahlmenü

#### Scenario: Pegelpunkt im Ring eines Markers
- **WHEN** ein Fachebenen-Punkt innerhalb der Trefferzone eines Markers liegt und der Mensch auf den Punkt tippt
- **THEN** öffnet sich die Detailansicht des Fachebenen-Objekts und nicht der Marker-Inspector

#### Scenario: Trefferzone eines Fachebenen-Punkts schlägt eine Warnfläche
- **WHEN** die Pegel-Ebene und die DWD-Ebene sichtbar sind und der Mensch in der Warnfläche neben einen Pegelpunkt tippt, außerhalb des gezeichneten Kreises, aber innerhalb seiner Trefferzone
- **THEN** öffnet sich die Detailansicht des Pegels, ohne Auswahlmenü

#### Scenario: Marker und Fachebenen-Punkt nebeneinander
- **WHEN** sich die Trefferzonen eines Markers und eines Fachebenen-Punkts überlappen und der Mensch in die Überlappung tippt, näher am Fachebenen-Punkt und auf keinem gezeichneten Ziel
- **THEN** öffnet sich die Detailansicht des Fachebenen-Objekts, und es öffnet sich kein Marker-Inspector

#### Scenario: Gezeichnetes Markerzeichen schlägt die Trefferzone eines Fachebenen-Punkts
- **WHEN** ein Markerzeichen innerhalb der Trefferzone eines Fachebenen-Punkts gezeichnet ist und der Mensch auf das Markerzeichen tippt
- **THEN** zeigt der Inspector den Marker, und es öffnet sich keine Fachebenen-Detailansicht
