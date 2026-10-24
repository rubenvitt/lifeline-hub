## MODIFIED Requirements

### Requirement: Eine Sprungmarke erbt Sichtbarkeit und Sperre ihres Zielmoduls
Eine Sprungmarke SHALL nur erscheinen, solange ihr Zielmodul fertig und für den Einsatz
sichtbar ist. Ist das Zielmodul gesperrt, MUST die Marke wie das Modul gesperrt erscheinen und
darf nicht springen. Eine Marke MUST nie als aktuelle Seite (`aria-current`) markiert sein und
MUST ihr Ziel im zugänglichen Namen tragen („Kommunikationsplan, springt zu Fernmeldewesen ·
Kommunikationsplan“).

#### Scenario: Presse ausgeblendet
- **WHEN** die Presse im Einsatz ausgeblendet ist
- **THEN** zeigt das Modulmenü weder „Presse“ noch die Marke Informationstelefon, aber
  „Fernmeldewesen“ mit seinen Marken

#### Scenario: Stab ausgeblendet
- **WHEN** der Stab im Einsatz ausgeblendet ist
- **THEN** zeigt das Modulmenü „Presse“ mit Informationstelefon und „Fernmeldewesen“ mit seinen
  Marken nach deren eigener Freigabe

#### Scenario: Fernmeldewesen ausgeblendet
- **WHEN** das Fernmeldewesen im Einsatz ausgeblendet ist
- **THEN** zeigt das Modulmenü weder „Fernmeldewesen“ noch die Marken Fernmeldeskizze und
  Kommunikationsplan, und „Presse“ mit Informationstelefon bleibt

#### Scenario: Presse gesperrt
- **WHEN** die Rolle der Person die Presse nicht öffnen darf, sie aber sichtbar ist
- **THEN** steht die Marke Informationstelefon gesperrt mit Schloss im Menü, und ein Klick springt
  nicht

#### Scenario: Stab gesperrt
- **WHEN** die Rolle der Person den Stab nicht öffnen darf und die Presse frei ist
- **THEN** steht die Marke Informationstelefon frei im Menü und springt

#### Scenario: Zugänglicher Name
- **WHEN** ein Screenreader die Marke „Informationstelefon“ vorliest
- **THEN** nennt er sie als „Informationstelefon, springt zu Presse · Informationstelefon“

## ADDED Requirements

### Requirement: Die Arbeitsseiten von Presse und Fernmeldewesen stehen als Sprungmarken unter ihrem Modul
Das Modulmenü SHALL führen:
- direkt hinter „Presse“ die Marke Informationstelefon
- direkt hinter „Fernmeldewesen“ die Marken Fernmeldeskizze und Kommunikationsplan, in dieser
  Reihenfolge

Marken „Pressearbeit“ und „Funkplan“ MUST NOT es geben, denn ihr Modul öffnet die Seite selbst.
Jede Marke MUST dorthin springen, wohin der Reiter ihres Moduls führt. Das gilt im Modulpanel am
Fükw und am Tablet und im Navigations-Drawer. Der Stab führt keine Marken (Fähigkeit
`modul-freigabe`, „Ein Modul ohne Navigationsziel“).

#### Scenario: Presse in der Kategorie Kommunikation
- **WHEN** jemand mit Freigabe der Presse die Kategorie „Kommunikation“ öffnet
- **THEN** folgt auf „Presse“ unmittelbar Informationstelefon

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

## REMOVED Requirements

### Requirement: Die Arbeitsseiten von Stab und Fernmeldewesen stehen als Sprungmarken unter ihrem Modul
**Reason**: Der Stab hat kein Navigationsziel mehr, und die Presse ist ein eigenes Modul (LLH-1450).
**Migration**: „Die Arbeitsseiten von Presse und Fernmeldewesen stehen als Sprungmarken unter ihrem
Modul“ in dieser Fähigkeit.
