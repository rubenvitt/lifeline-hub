# modul-sprungmarken Specification

## Purpose
Sprungmarken im Modulmenü eines Einsatzes: Zeilen, die in eine gefilterte Sicht oder eine
Unterseite eines vorhandenen Moduls springen, ohne selbst ein Modul zu sein. Die Spec legt fest,
welche Marken es gibt, wo sie stehen und was sie von ihrem Zielmodul erben.

## Requirements

### Requirement: Eine Sprungmarke erbt Sichtbarkeit und Sperre ihres Zielmoduls
Eine Sprungmarke SHALL nur erscheinen, solange ihr Zielmodul fertig und für den Einsatz
sichtbar ist. Ist das Zielmodul gesperrt, MUST die Marke wie das Modul gesperrt erscheinen und
darf nicht springen. Eine Marke MUST nie als aktuelle Seite (`aria-current`) markiert sein und
MUST ihr Ziel im zugänglichen Namen tragen („Funkplan, springt zu Stab · Funkplan“).

#### Scenario: Stab ausgeblendet
- **WHEN** der Stab im Einsatz ausgeblendet ist
- **THEN** zeigt das Modulmenü weder „Stab“ noch eine der Marken Pressearbeit, Informationstelefon, Funkplan, Fernmeldeskizze, Kommunikationsplan

#### Scenario: Stab gesperrt
- **WHEN** die Rolle der Person den Stab nicht öffnen darf, er aber sichtbar ist
- **THEN** stehen die Stab-Marken gesperrt mit Schloss im Menü und ein Klick springt nicht

#### Scenario: Zugänglicher Name
- **WHEN** ein Screenreader die Marke „Informationstelefon“ vorliest
- **THEN** nennt er sie als „Informationstelefon, springt zu Stab · Informationstelefon“

### Requirement: Die Arbeitsseiten des Stabs stehen als Sprungmarken unter „Stab“
Das Modulmenü SHALL direkt hinter „Stab“ die Marken Pressearbeit, Informationstelefon,
Funkplan, Fernmeldeskizze und Kommunikationsplan führen, in dieser Reihenfolge (nach
Sachgebiet S5, S6). Jede Marke MUST auf dieselbe Seite springen wie der Einstieg auf der
Stab-Seite; „Fernmeldeskizze“ MUST den Funkplan in der Skizzenansicht öffnen. Das gilt im
Modulpanel am Fükw und am Tablet und im Navigations-Drawer.

#### Scenario: Reihenfolge im Panel
- **WHEN** jemand mit Stab-Freigabe die Kategorie „Führung“ öffnet
- **THEN** folgen auf „Stab“ unmittelbar Pressearbeit, Informationstelefon, Funkplan, Fernmeldeskizze und Kommunikationsplan

#### Scenario: Sprung in die Fernmeldeskizze
- **WHEN** die Marke „Fernmeldeskizze“ geklickt wird
- **THEN** zeigt die App den Funkplan in der Ansicht „Skizze“

#### Scenario: Navigations-Drawer
- **WHEN** das Menü unter der Panel-Breite als Drawer geöffnet wird
- **THEN** stehen dieselben Marken in derselben Reihenfolge hinter „Stab“, mit derselben Mindest-Trefffläche wie die Modulzeilen
