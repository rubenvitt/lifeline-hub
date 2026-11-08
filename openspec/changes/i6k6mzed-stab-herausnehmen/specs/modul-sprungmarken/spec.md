# Spec Delta

## MODIFIED Requirements

### Requirement: Eine Sprungmarke erbt Sichtbarkeit und Sperre ihres Zielmoduls
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

## REMOVED Requirements

### Requirement: Die Arbeitsseiten von Stab und Fernmeldewesen stehen als Sprungmarken unter ihrem Modul
**Reason**: Das Modul Stab samt Presse und Medienarbeit (S5) entfällt (LLH-722, Entscheidung 08.11.2026; design.md D1). Die Marke Pressearbeit entfällt, das Informationstelefon ist ein eigenes Modul (design.md D3).
**Migration**: Die Marken des Fernmeldewesens regelt das neue Requirement „Die Ansichten des Fernmeldewesens stehen als Sprungmarken unter ihrem Modul“; das Informationstelefon steht als Modul in der Kategorie Kommunikation (Spec `stab-infotelefon`).

## ADDED Requirements

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
