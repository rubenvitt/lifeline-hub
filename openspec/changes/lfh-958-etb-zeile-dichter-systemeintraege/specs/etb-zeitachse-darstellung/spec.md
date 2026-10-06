# Spec Delta

## Purpose

Wie eine Zeile der Zeitachse je Dichtestufe aufgebaut ist und wie die ETB-Oberfläche
Systemeinträge aus- und einblendet, damit der Führungsassistent im Fükw möglichst viele Handeinträge
im Zusammenhang liest.

## ADDED Requirements

### Requirement: Kompakte Zeile ohne senkrechte Metaspalte
In der kompakten Dichte SHALL eine Zeitachsenzeile Verfasser und Meldeweg in der Metazeile neben
Typwort und Von→An zeigen und ein Zeilenmenü am Ende dieser Zeile. Der Verfasser MUST einzeilig
bleiben, bei Überlänge gekürzt, mit dem Volltext als Titel. Ein bedienbarer Verfasser (ein Verweis
mit eigener Trefffläche) MUST mit dem Meldeweg rechts bleiben; das Zeilenmenü steht trotzdem in
der Kopfzeile, und der Text MUST ihm die Breite freihalten.

#### Scenario: Einzeiliger Eintrag im Fükw
- **WHEN** ein einzeiliger ETB-Eintrag mit Verfasser „Administrator · EL“ und Meldeweg „Funk“ in kompakter Dichte bei 1440×900 steht
- **THEN** ist die Zeile höchstens 56 px hoch, und zwischen Filter- und Erfassungsleiste stehen mindestens 9 Einträge

#### Scenario: Bedienbarer Verfasser
- **WHEN** eine Zeile in kompakter Dichte einen Verweis als Verfasser trägt
- **THEN** steht er mit dem Meldeweg rechts in der Spalte, und die Kopfzeile wird nicht höher als ohne ihn

#### Scenario: Langer Verfasser
- **WHEN** der Verfasser länger ist als der verfügbare Platz
- **THEN** bricht er nicht um, sondern endet mit Auslassung und trägt den vollen Namen als Titel

### Requirement: Komfortabel und Handschuh behalten die Spalte
In den Dichten komfortabel und Handschuh SHALL die Zeile Verfasser, Meldeweg und Aktionen rechts
untereinander zeigen, mit der Trefffläche der Stufe (48 bzw. 72 px).

#### Scenario: Tablet quer
- **WHEN** die Dichte komfortabel ist
- **THEN** steht das Zeilenmenü rechts unter dem Verfasser und ist mindestens 48 px hoch

### Requirement: Systemeinträge zeigen
Die ETB-Seite SHALL einen Schalter „Systemeinträge zeigen“ haben, Vorgabe an. Aus blendet er alle
Einträge vom Typ `system` aus, die Zeitordnung der übrigen bleibt. Der Zustand MUST in der URL
stehen und Neuladen, Teilen und Druck überstehen; der Schalter nennt die Zahl der Systemeinträge.

#### Scenario: Ausblenden
- **WHEN** der Schalter ausgeschaltet wird
- **THEN** enthält die Zeitachse keinen Systemeintrag, und Kopf und Bilanz zeigen „n Treffer“ bzw. „Bilanz im Filter“ über dieselbe Menge

#### Scenario: Neuladen
- **WHEN** die Seite mit ausgeblendeten Systemeinträgen neu geladen wird
- **THEN** bleiben sie ausgeblendet

#### Scenario: Sprung auf einen ausgeblendeten Eintrag
- **WHEN** `?eintrag=` auf einen Systemeintrag zeigt, während Systemeinträge ausgeblendet sind
- **THEN** blendet die Seite sie wieder ein, hebt den Eintrag hervor und sagt, dass sie eingeblendet hat

#### Scenario: Sprung unter einem Typfilter
- **WHEN** `?eintrag=` unter einem Typfilter und ausgeblendeten Systemeinträgen ins Leere zeigt
- **THEN** bleibt der Ausschluss bestehen, und die Seite räumt den Sprungparameter ohne Hinweis
