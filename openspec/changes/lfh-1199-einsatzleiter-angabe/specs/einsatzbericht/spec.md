# Spec Delta

## MODIFIED Requirements

### Requirement: Inhalt der Blöcke

Stammdaten SHALL Bezeichnung, Einsatznummer, Leitstellennummer, Einsatzart, Stichwort,
Einsatzort, meldende Stelle und Sachverhalt nennen, Zeiten SHALL Beginn, Ende und Dauer nennen.
Führung SHALL die Einsatzleitung, die Stabsbesetzung S1–S6 und die abgehaltenen
Lagebesprechungen mit Zeitpunkt und Entschluss nennen. Als Einsatzleitung SHALL der an der eigenen
Führungsstelle erfasste Einsatzleiter mit seinem „seit“ stehen, in derselben Darstellung wie die
Kopfleiste der Einsatzdaten, sonst „nicht erfasst“. Die Konten mit der App-Rolle Einsatzleitung
MUST NOT als Einsatzleitung erscheinen. Lage SHALL ein Verzeichnis aller
freigegebenen Lageberichte und den letzten im Volltext zeigen. Der ETB-Auszug SHALL die Zahl der
Einträge je Typ und alle Entscheidungen zeigen.

#### Scenario: Einsatzleiter im Block Führung

- **WHEN** der Einsatzleiter „Anna Schulz“ seit 11.10. 14:30 erfasst ist und zwei Konten die
  App-Rolle Einsatzleitung tragen
- **THEN** nennt der Block Führung unter „Einsatzleitung“ „Anna Schulz“ mit „seit 11.10. 14:30“
- **AND** die beiden Konten stehen dort nicht

#### Scenario: Kein Einsatzleiter erfasst

- **WHEN** an der Führungsstelle kein Einsatzleiter erfasst ist
- **THEN** steht unter „Einsatzleitung“ „nicht erfasst“

#### Scenario: Lage mit drei Berichten

- **WHEN** ein Einsatz drei freigegebene Lageberichte und einen Entwurf hat
- **THEN** nennt das Verzeichnis die drei freigegebenen mit Zeitstand, Titel, Version und
  freigebender Person
- **AND** der zuletzt freigegebene steht im Volltext
- **AND** der Entwurf erscheint nicht

#### Scenario: Fortgeschriebener Lagebericht

- **WHEN** ein Lagebericht in Version 2 fortgeschrieben und freigegeben wurde
- **THEN** nennt das Verzeichnis die Kette einmal, mit ihrer neuesten freigegebenen Version

#### Scenario: Entscheidungen im ETB-Auszug

- **WHEN** das ETB neun Entscheidungen enthält
- **THEN** stehen alle neun mit laufender Nummer, Zeitpunkt und Inhalt im Auszug, geordnet
  nach laufender Nummer
- **AND** eine berichtigte Entscheidung ist als berichtigt gekennzeichnet

#### Scenario: Ohne Stichwort und Leitstellennummer

- **WHEN** ein Einsatz kein Stichwort und keine Leitstellennummer hat
- **THEN** stehen die Felder mit „—“ und nicht leer im Bericht
