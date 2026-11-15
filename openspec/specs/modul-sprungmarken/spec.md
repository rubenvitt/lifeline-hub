# modul-sprungmarken Specification

## Purpose
Sprungmarken im Modulmenü eines Einsatzes: Zeilen, die in eine gefilterte Sicht oder eine
Unterseite eines vorhandenen Moduls springen, ohne selbst ein Modul zu sein. Die Spec legt fest,
welche Marken es gibt, wo sie stehen und was sie von ihrem Zielmodul erben.

## Requirements

### Requirement: Die Ansichten des Fernmeldewesens stehen als Sprungmarken unter ihrem Modul
Das Modulmenü SHALL direkt hinter „Fernmeldewesen“ die Marken Fernmeldeskizze und
Kommunikationsplan in dieser Reihenfolge führen; eine Marke „Funkplan“ MUST NOT es geben. Jede
Marke MUST dorthin springen, wohin der Reiter des Moduls führt. Das Informationstelefon MUST als
Modul erscheinen, nicht als Marke. Das gilt im Modulpanel am Fükw und am Tablet und im
Navigations-Drawer.

#### Scenario: Fernmeldewesen in der Kategorie Kommunikation
- **WHEN** jemand mit Freigabe des Fernmeldewesens die Kategorie „Kommunikation“ öffnet
- **THEN** folgen auf „Fernmeldewesen“ unmittelbar Fernmeldeskizze und Kommunikationsplan

#### Scenario: Informationstelefon als Modulzeile
- **WHEN** jemand mit Freigabe des Informationstelefons die Kategorie „Kommunikation“ öffnet
- **THEN** steht „Informationstelefon“ dort als Modulzeile und nicht als Sprungmarke, und in der
  Kategorie „Führung“ steht keine Marke Pressearbeit oder Informationstelefon

#### Scenario: Sprung in die Fernmeldeskizze
- **WHEN** die Marke „Fernmeldeskizze“ geklickt wird
- **THEN** zeigt die App das Modul Fernmeldewesen mit dem Reiter „Fernmeldeskizze“

#### Scenario: Navigations-Drawer
- **WHEN** das Menü unter der Panel-Breite als Drawer geöffnet wird
- **THEN** stehen dieselben Marken in derselben Reihenfolge hinter ihrem Modul, mit derselben
  Mindest-Trefffläche wie die Modulzeilen

### Requirement: Eine Sprungmarke erbt Sichtbarkeit, Sperre und zugänglichen Namen von ihrem Zielmodul

Eine Sprungmarke SHALL nur erscheinen, solange ihr Zielmodul fertig und für den Einsatz
sichtbar ist. Ist das Zielmodul gesperrt, MUST die Marke wie das Modul gesperrt erscheinen und
darf nicht springen. Eine Marke MUST nie als aktuelle Seite (`aria-current`) markiert sein und
MUST ihr Ziel im zugänglichen Namen tragen („Kommunikationsplan, springt zu Fernmeldewesen ·
Kommunikationsplan“).

#### Scenario: Betroffene ausgeblendet
- **WHEN** das Modul Betroffene (`personen`) im Einsatz ausgeblendet ist
- **THEN** zeigt das Modulmenü weder „Betroffene“ noch die Marken Patienten und Vermisste,
  aber „Fernmeldewesen“ mit seinen Marken

#### Scenario: Fernmeldewesen ausgeblendet
- **WHEN** das Fernmeldewesen im Einsatz ausgeblendet ist
- **THEN** zeigt das Modulmenü weder „Fernmeldewesen“ noch die Marken Fernmeldeskizze und
  Kommunikationsplan, und „Betroffene“ mit Patienten und Vermisste bleibt

#### Scenario: Fernmeldewesen gesperrt
- **WHEN** die Rolle der Person das Fernmeldewesen nicht öffnen darf, es aber sichtbar ist
- **THEN** stehen die Marken Fernmeldeskizze und Kommunikationsplan gesperrt mit Schloss im Menü
  und ein Klick springt nicht

#### Scenario: Zugänglicher Name
- **WHEN** ein Screenreader die Marke „Fernmeldeskizze“ vorliest
- **THEN** nennt er sie als „Fernmeldeskizze, springt zu Fernmeldewesen · Skizze“

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
