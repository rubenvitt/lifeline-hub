# Spec Delta

## MODIFIED Requirements

### Requirement: Eintragstitel als Überschrift nur bei eigenständigen Gegenständen

Ein Eintragstitel SHALL nur dann eine Überschrift sein, wenn der Eintrag ein eigener Gegenstand
mit Inhalt darunter ist, zwischen dem jemand springen will. Bei Auswahl-, Einstellungs- und
Stromlisten MUST der Titel keine Überschrift sein. Dort trägt der Listenpunkt die Navigation.
Ein Titel, der ein Bedienelement enthält (etwa ein Eingabefeld), MUST NOT eine Überschrift sein.

#### Scenario: Stab und Presse
- **WHEN** die Seite Lagebesprechung den Verlauf der abgeschlossenen Lagebesprechungen und die Presse-Seite die Pressemitteilungen zeigt, jeweils in einem Paneel mit Überschrift `h2`
- **THEN** ist jeder Eintragstitel dort eine Überschrift der Ebene 3

#### Scenario: Kacheln der Stab-Seite
- **WHEN** die Stab-Seite die Sachgebiete S1–S6 als Kacheln zeigt
- **THEN** ist jede Kachel ein Paneel mit einer Überschrift der Ebene 2, und die Arbeitsaufnahme folgt als eigenes Paneel der Ebene 2

#### Scenario: Chat
- **WHEN** ein Kanal im Chat 50 Nachrichten zeigt
- **THEN** führt die Überschriftenliste des Vorlesers keine Nachricht als Überschrift
- **AND** ist jede Nachricht weiterhin ein eigener Listenpunkt

#### Scenario: Einstellungs- und Auswahllisten
- **WHEN** jemand die Führungsfunktionen in den Stammdaten, die maßgeblichen Pegel in den Einsatzeinstellungen oder einen der Kartendialoge „Region aufs Gerät bringen“, „Gebaute Region übernehmen“ und „Aus Katalog hinzufügen“ öffnet
- **THEN** ist kein Eintragstitel dieser Listen eine Überschrift

#### Scenario: Gruppenüberschrift im Kartendialog
- **WHEN** der Dialog „Region aufs Gerät bringen“ Regionen unter einer Gruppenüberschrift `h5` zeigt
- **THEN** steht keine Überschrift einer Region über dieser Gruppenüberschrift
