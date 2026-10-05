# lagekarte-ressourcen Specification

## Purpose

Die Lagekarte bleibt über Stunden bis Tage offen und wird ständig mit anderen Modulen
gewechselt. Diese Fähigkeit sichert, dass sie dabei weder abstürzt noch Ressourcen liegen
lässt oder ohne Änderung Kartenarbeit verrichtet.

## Requirements

### Requirement: Modulwechsel mit laufendem Werkzeug zeigt das Zielmodul
Verlässt eine Person die Lagekarte, während Messen (Strecke oder Fläche), Zonenzeichnen oder
Abschnittszeichnen läuft, MUST das Zielmodul ohne Fehlerseite und ohne Seitenfehler in der
Konsole erscheinen. Das gilt für jeden Weg aus der Karte (Rail, Sprungpalette, Deeplink) und
für jede Rolle, die das Werkzeug starten darf, auch für eine Rolle ohne Schreibrecht beim
Messen.

#### Scenario: Wechsel ins ETB während einer Messung
- **WHEN** eine Messung läuft, ein Punkt gesetzt ist und die Person ohne „Beenden“ über die Rail ins ETB wechselt
- **THEN** zeigt die Anwendung das ETB, keine Fehlerseite „Unexpected Application Error“, und es tritt kein Seitenfehler auf

#### Scenario: Wechsel ins ETB während des Zonen- oder Abschnittszeichnens
- **WHEN** das Zeichnen einer Zone oder eines Abschnitts läuft, ein Punkt gesetzt ist und die Person ohne „Beenden“ ins ETB wechselt
- **THEN** zeigt die Anwendung das ETB ohne Fehlerseite und ohne Seitenfehler

### Requirement: Vertagte Kartendaten stauen sich nicht
Kann eine Datenänderung einer Kartenebene nicht sofort angewandt werden, MUST die Karte je
Ebene höchstens eine ausstehende Anwendung halten, und nach dem Warten MUST nur der neueste
Stand dieser Ebene angewandt werden. Ausstehende Anwendungen verschiedener Ebenen MUST in der
Reihenfolge ihrer letzten Änderung laufen. Eine Änderung MUST NOT darauf warten, dass Kacheln
der Grundkarte fertig geladen sind; sie wartet nur, bis der Kartenstil selbst angewandt ist.

#### Scenario: Viele Eigenpositions-Fixes während eines Stilwechsels
- **WHEN** der Kartenstil gerade wechselt und in dieser Zeit 50 Änderungen derselben Ebene eintreffen
- **THEN** wartet genau eine Anwendung dieser Ebene, und nach dem Wechsel wird nur der letzte Stand angewandt

#### Scenario: Kacheln laden über eine schwache Leitung
- **WHEN** der Kartenstil angewandt ist, aber Kacheln im Sichtfeld noch laden, und die Eigenposition sich ändert
- **THEN** erscheint die neue Eigenposition, ohne auf die Kacheln zu warten

### Requirement: Bilddaten der Hintergrundbilder werden immer freigegeben
Jede für ein Hintergrundbild erzeugte Bild-URL MUST wieder freigegeben werden: wenn das Bild
die Karte verlässt, wenn ein Ladevorgang nach dem Verlassen der Karte oder einem
Einsatzwechsel noch ankommt, und beim Aushängen der Karte. Ein Bild, dessen Download noch
läuft, MUST NOT ein zweites Mal geladen werden. Beim Verlassen der Karte und beim
Einsatzwechsel MUST ein laufender Download abgebrochen werden.

#### Scenario: Karte verlassen, während ein Orthofoto lädt
- **WHEN** ein Hintergrundbild noch lädt und die Person die Lagekarte verlässt
- **THEN** wird der Download abgebrochen, und eine dennoch erzeugte Bild-URL wird sofort freigegeben

#### Scenario: Bilderliste ändert sich während eines Downloads
- **WHEN** ein Hintergrundbild noch lädt und sich die Bilderliste ändert (Opazität, Sichtbarkeit, neuer Stand)
- **THEN** wird dasselbe Bild nicht ein zweites Mal geladen, und die URL des laufenden Downloads wird übernommen, solange das Bild noch angezeigt werden soll

### Requirement: Unveränderte Abschnittsflächen erzeugen keine Kartenarbeit
Ein erneutes Zeichnen der Lagekarte ohne inhaltliche Änderung an den Abschnittsflächen
(Eigenpositions-Fix, Live-Aktualisierung anderer Daten, Minutentakt) MUST NOT die
Abschnittsflächen neu in die Karte geben. Eine neu gezeichnete oder geänderte Fläche MUST
sofort erscheinen, auch nach einem Wechsel der Kartengrundlage.

#### Scenario: Eigenpositions-Fix ohne Flächenänderung
- **WHEN** die Eigenposition einen neuen Fix meldet und sich an den Abschnittsflächen nichts geändert hat
- **THEN** werden die Abschnittsflächen nicht neu in die Karte gegeben

#### Scenario: Geänderte Fläche
- **WHEN** eine Abschnittsfläche hinzukommt oder sich ändert
- **THEN** wird sie genau einmal neu in die Karte gegeben und erscheint sofort

### Requirement: Ausschnittsabfragen der Fachebenen liegen nicht stundenlang im Speicher
Antworten der KRITIS- und der Energie-Ebene für einen Kartenausschnitt, der nicht mehr
angezeigt wird, MUST nach höchstens 5 Minuten aus dem Client-Cache entfernt sein. Beim
Verschieben der Karte MUST der vorige Ausschnitt sichtbar bleiben, bis der neue geladen ist,
und eine Rückkehr in einen Ausschnitt innerhalb dieser 5 Minuten MUST NOT KRITIS erneut
abrufen.

#### Scenario: Viele Ausschnitte besucht
- **WHEN** die Person mit eingeschalteter KRITIS- oder Energie-Ebene durch mehrere Ausschnitte schiebt und 5 Minuten vergehen
- **THEN** liegt höchstens der Eintrag des aktuellen Ausschnitts dieser Ebene im Cache

#### Scenario: Rückkehr in einen Ausschnitt
- **WHEN** die Person innerhalb von 5 Minuten in einen schon geladenen KRITIS-Ausschnitt zurückkehrt
- **THEN** zeigt die Karte ihn ohne neuen Abruf
