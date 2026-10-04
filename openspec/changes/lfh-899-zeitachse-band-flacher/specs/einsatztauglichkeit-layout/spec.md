## MODIFIED Requirements

### Requirement: Das Zeitachsenband der Lagekarte lässt die Karte sichtbar

Die ausgeklappte Zeitachse der Lagekarte MUST höchstens die Hälfte der Kartenhöhe belegen.
Das gilt im Fükw und am Führungs-Tablet sowie auf dem Handschirm mit ausgeblendeter Leiste
(der Vorgabe unter `md`), jeweils in allen drei Dichtestufen. Kein Kind des Bandes MUST über
das Band hinausragen, und das Band MUST in der Kartenspalte bleiben. Die Abstände des Bandes
(Lücken und Polsterung) MUST mit der Dichtestufe wachsen; im Handschuh-Betrieb MUST zwischen je
zwei Bedienzielen des Bandes ein Abstand von mindestens 16 px liegen. Das gilt auch ohne
Schreibrecht.

#### Scenario: Handschirm im Handschuh-Betrieb
- **WHEN** die Lagekarte bei 390 × 844 in `handschuh` mit ausgeklappter Zeitachse und zwei gesicherten Ständen offen ist
- **THEN** ist das Band höchstens halb so hoch wie die Karte, und kein Knopf des Bandes ragt über dessen Rand

#### Scenario: Leiste eingeblendet
- **WHEN** auf dem Handschirm zusätzlich die Leiste eingeblendet ist
- **THEN** bleibt das Band in der Kartenspalte, und Knopfblock und Band überschneiden sich nicht

#### Scenario: Zielabstand im Handschuh-Betrieb
- **WHEN** die Zeitachse in `handschuh` auf Handschirm, Führungs-Tablet oder Fükw ausgeklappt ist, mit und ohne Schreibrecht
- **THEN** liegen zwischen je zwei Bedienzielen des Bandes mindestens 16 px

#### Scenario: Abstände wachsen mit der Stufe
- **WHEN** dieselbe Zeitachse nacheinander in `kompakt` und `handschuh` gemessen wird
- **THEN** ist die Polsterung des Bandes in `handschuh` größer als in `kompakt`
