# lagekarte-klickziele Specification

## Purpose

Legt fest, wem ein Tipp oder Klick auf der Lagekarte gehört, wenn Markerzeichen, deren unsichtbare
Trefferzonen, Fachebenen-Objekte und Flächen am selben Punkt übereinanderliegen: genau einem Ziel.

## Requirements

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

### Requirement: Personen-Cluster bleiben wie festgelegt
Der Vorrang eines sichtbaren Personen-Clusters vor Trefferzonen (LFH-711) SHALL erhalten bleiben: ein
Tipp auf einen Personen-Cluster fächert ihn auf und wählt keinen Marker aus.

#### Scenario: Cluster neben einem Fahrzeug
- **WHEN** ein Personen-Cluster in der Trefferzone eines Fahrzeugs liegt und der Mensch auf den Cluster tippt
- **THEN** fächert der Cluster auf, und kein Marker-Inspector öffnet sich

### Requirement: Auswahlmenü für übereinanderliegende Flächen
Das Auswahlmenü SHALL am Tipppunkt erscheinen und jede Fläche am Punkt genau einmal anbieten: eigene
Flächen (Zone, Abschnitt) zuerst, danach Fachebenen-Flächen, innerhalb jeder Gruppe die oben
gezeichnete zuerst. Jeder Eintrag MUST eine menschenlesbare Kennung tragen: die Art der Fläche und
ihre Bezeichnung, ohne Bezeichnung ihren Typ; bei Fachebenen den Namen der Ebene und, wenn die
Meldung einen Titel hat, diesen. Eine technische Kennung (Datenbank-ID) MUST NOT die Kennung sein.

Die Wahl eines Eintrags SHALL dieselbe Wirkung haben wie ein Tipp auf diese Fläche allein. Das Menü
MUST per Tastatur bedienbar sein (Pfeiltasten, Enter wählt, Esc schließt), jeder Eintrag MUST die
Trefferhöhe der eingestellten Dichtestufe haben, und beim Schließen MUST der Fokus an die Karte
zurückgehen. Esc bei offenem Menü MUST nur das Menü schließen und keine laufende Zeichnung verwerfen.
Das Menü MUST bei jeder Kartenbewegung schließen. In einem exklusiven Kartenmodus (Zeichnen, Messen,
Platzieren) MUST sich kein Auswahlmenü öffnen.

#### Scenario: Zone und Abschnitt
- **WHEN** der Mensch in die Überschneidung einer Zone und eines Abschnitts tippt und im Menü den Abschnitt wählt
- **THEN** schließt das Menü, und der Inspector zeigt den Abschnitt

#### Scenario: Zone unter einer DWD-Warnfläche
- **WHEN** die DWD-Ebene sichtbar ist und der Mensch in eine Zone tippt, die unter einer Wetterwarnung liegt
- **THEN** bietet das Menü zuerst die Zone und danach die Wetterwarnung mit dem Namen der Ebene an, und die Wahl der Warnung öffnet deren Detailansicht

#### Scenario: Bedienung mit der Tastatur
- **WHEN** das Auswahlmenü offen ist und der Mensch mit der Pfeiltaste zum zweiten Eintrag geht und Enter drückt
- **THEN** ist die Fläche des zweiten Eintrags gewählt, und der Fokus liegt wieder auf der Karte

#### Scenario: Esc schließt nur das Menü
- **WHEN** das Auswahlmenü offen ist und der Mensch Esc drückt
- **THEN** schließt das Menü, keine Fläche ist gewählt, und der Fokus liegt auf der Karte

#### Scenario: Kartenbewegung schließt das Menü
- **WHEN** das Auswahlmenü offen ist und die Karte verschoben oder gezoomt wird
- **THEN** schließt das Menü, ohne eine Fläche zu wählen

#### Scenario: Kein Menü im exklusiven Modus
- **WHEN** ein Zeichen-, Mess- oder Platziermodus aktiv ist und der Mensch in eine Überschneidung zweier Flächen tippt
- **THEN** öffnet sich kein Auswahlmenü
