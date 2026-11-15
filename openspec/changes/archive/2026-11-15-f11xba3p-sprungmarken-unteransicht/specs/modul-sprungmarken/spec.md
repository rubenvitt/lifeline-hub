# Spec Delta

## ADDED Requirements

### Requirement: Eine Sprungmarke steht unter ihrem Zielmodul
Eine Sprungmarke SHALL in der Kategorie ihres Zielmoduls stehen, direkt hinter dem Zielmodul oder
hinter einer anderen Marke desselben Ziels. Nach dem Sprung MUST die hervorgehobene Zeile, das
Zielmodul, damit in derselben Kategorie stehen wie die geklickte Marke. Das gilt im Modulpanel am
Fükw und am Tablet und im Navigations-Drawer.

#### Scenario: Entscheidungen unter ETB
- **WHEN** jemand mit Freigabe des ETB die Kategorie „Erfassung“ öffnet
- **THEN** folgt auf „ETB“ unmittelbar die Marke „Entscheidungen“, und die Kategorie „Führung“
  führt keine Marke „Entscheidungen“

#### Scenario: Hervorhebung bleibt in der Kategorie
- **WHEN** die Marke „Entscheidungen“ geklickt wird
- **THEN** zeigt die App das ETB mit dem Filter Entscheidung, die Kategorie „Erfassung“ bleibt
  offen, und „ETB“ ist dort als aktuelle Seite hervorgehoben

#### Scenario: Marken desselben Ziels
- **WHEN** jemand mit Freigabe der Betroffenen die Kategorie „Erfassung“ öffnet
- **THEN** folgen auf „Betroffene“ unmittelbar „Patienten“ und „Vermisste“

### Requirement: Eine Sprungmarke erscheint als eingerückte Unteransicht
Eine Sprungmarke SHALL gegenüber den Modulzeilen eingerückt stehen und durch eine senkrechte Linie
an die Zeile darüber gebunden sein. Sie MUST NOT ein Symbol tragen, das nach externem Link oder
neuem Fenster aussieht. Ist sie gesperrt, MUST sie wie eine gesperrte Modulzeile das Schloss
zeigen.

#### Scenario: Freie Marke
- **WHEN** jemand mit Freigabe der Fahrzeuge die Kategorie „Kräfte“ öffnet
- **THEN** steht „FMS-Tableau“ eingerückt unter „Fahrzeuge“, mit Linie und ohne Pfeil-Symbol

#### Scenario: Gesperrte Marke
- **WHEN** die Rolle der Person das ETB nicht öffnen darf, es aber sichtbar ist
- **THEN** steht „Entscheidungen“ eingerückt unter „ETB“, gesperrt mit Schloss und ohne
  Pfeil-Symbol
