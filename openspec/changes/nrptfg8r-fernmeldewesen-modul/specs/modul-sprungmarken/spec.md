## RENAMED Requirements

- FROM: `### Requirement: Die Arbeitsseiten des Stabs stehen als Sprungmarken unter „Stab“`
- TO: `### Requirement: Die Arbeitsseiten von Stab und Fernmeldewesen stehen als Sprungmarken unter ihrem Modul`

## MODIFIED Requirements

### Requirement: Eine Sprungmarke erbt Sichtbarkeit und Sperre ihres Zielmoduls
Eine Sprungmarke SHALL nur erscheinen, solange ihr Zielmodul fertig und für den Einsatz
sichtbar ist. Ist das Zielmodul gesperrt, MUST die Marke wie das Modul gesperrt erscheinen und
darf nicht springen. Eine Marke MUST nie als aktuelle Seite (`aria-current`) markiert sein und
MUST ihr Ziel im zugänglichen Namen tragen („Kommunikationsplan, springt zu Fernmeldewesen ·
Kommunikationsplan“).

#### Scenario: Stab ausgeblendet
- **WHEN** der Stab im Einsatz ausgeblendet ist
- **THEN** zeigt das Modulmenü weder „Stab“ noch die Marken Pressearbeit und Informationstelefon,
  aber „Fernmeldewesen“ mit seinen Marken

#### Scenario: Fernmeldewesen ausgeblendet
- **WHEN** das Fernmeldewesen im Einsatz ausgeblendet ist
- **THEN** zeigt das Modulmenü weder „Fernmeldewesen“ noch die Marken Fernmeldeskizze und
  Kommunikationsplan, und „Stab“ mit Pressearbeit und Informationstelefon bleibt

#### Scenario: Stab gesperrt
- **WHEN** die Rolle der Person den Stab nicht öffnen darf, er aber sichtbar ist
- **THEN** stehen die Stab-Marken gesperrt mit Schloss im Menü und ein Klick springt nicht

#### Scenario: Zugänglicher Name
- **WHEN** ein Screenreader die Marke „Informationstelefon“ vorliest
- **THEN** nennt er sie als „Informationstelefon, springt zu Stab · Informationstelefon“

### Requirement: Die Arbeitsseiten von Stab und Fernmeldewesen stehen als Sprungmarken unter ihrem Modul
Das Modulmenü SHALL direkt hinter „Stab“ die Marken Pressearbeit und Informationstelefon führen, in
dieser Reihenfolge, und direkt hinter „Fernmeldewesen“ die Marken Fernmeldeskizze und
Kommunikationsplan, in dieser Reihenfolge. Eine Marke „Funkplan“ MUST NOT es geben, denn das Modul
Fernmeldewesen öffnet den Funkplan selbst. Jede Marke MUST auf dieselbe Seite springen wie der
entsprechende Einstieg auf der Stab-Seite bzw. der Reiter des Moduls; „Fernmeldeskizze“ MUST den
Funkplan in der Darstellung „Fernmeldeskizze“ öffnen. Das gilt im Modulpanel am Fükw und am Tablet
und im Navigations-Drawer.

#### Scenario: Reihenfolge im Panel
- **WHEN** jemand mit Stab-Freigabe die Kategorie „Führung“ öffnet
- **THEN** folgen auf „Stab“ unmittelbar Pressearbeit und Informationstelefon

#### Scenario: Fernmeldewesen in der Kategorie Kommunikation
- **WHEN** jemand mit Freigabe des Fernmeldewesens die Kategorie „Kommunikation“ öffnet
- **THEN** folgen auf „Fernmeldewesen“ unmittelbar Fernmeldeskizze und Kommunikationsplan

#### Scenario: Sprung in die Fernmeldeskizze
- **WHEN** die Marke „Fernmeldeskizze“ geklickt wird
- **THEN** zeigt die App das Modul Fernmeldewesen mit dem Reiter „Fernmeldeskizze“

#### Scenario: Navigations-Drawer
- **WHEN** das Menü unter der Panel-Breite als Drawer geöffnet wird
- **THEN** stehen dieselben Marken in derselben Reihenfolge hinter ihrem Modul, mit derselben
  Mindest-Trefffläche wie die Modulzeilen
