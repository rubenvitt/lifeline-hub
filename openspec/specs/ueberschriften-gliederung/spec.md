# ueberschriften-gliederung Specification

## Purpose
Die Überschriften der Oberfläche bilden eine lückenlose Gliederung, die ihrem Einbauort folgt.
So springt ein Vorleser über die Überschriftenliste zuverlässig zwischen den Gegenständen einer
Seite, ohne übersprungene Ebenen und ohne Überschriften, die über ihrem eigenen Abschnitt stehen.

## Requirements

### Requirement: Eintragstitel einer Liste folgt dem Listenkopf

Trägt eine Liste einen Kopf der Ebene `hN` und ist ihr Eintragstitel eine Überschrift, SHALL
dieser Titel die Ebene `hN+1` haben. Die Ebene MUST bei `h6` enden. Ein Eintragstitel MUST NOT
über seinem eigenen Listenkopf stehen.

#### Scenario: Kopf h3
- **WHEN** eine Liste mit Kopf `h3` einen Eintrag mit Titel „S4 · Versorgung“ zeigt
- **THEN** ist der Titel eine Überschrift der Ebene 4

#### Scenario: Kopf h6
- **WHEN** eine Liste mit Kopf `h6` einen Eintrag mit Titel zeigt
- **THEN** ist der Titel eine Überschrift der Ebene 6, nicht höher

### Requirement: Eintragstitel ohne Listenkopf folgt dem Einbauort

Hat eine Liste keinen Kopf, SHALL ein Eintragstitel nur dann eine Überschrift sein, wenn der
Einbauort die Ebene der nächsten Überschrift darüber nennt. Bei Ebene `N` MUST der Titel `hN+1`
sein, gedeckelt bei `h6`. Nennt der Einbauort keine Ebene, MUST der Titel als hervorgehobener
Text ohne Überschriftenrolle erscheinen. Seine Optik MUST dabei dieselbe bleiben.

#### Scenario: Unter einem Paneel
- **WHEN** eine Liste ohne Kopf direkt unter einer Paneel-Überschrift `h2` steht und ihr Einbauort Ebene 2 nennt
- **THEN** sind ihre Eintragstitel Überschriften der Ebene 3

#### Scenario: Ohne Angabe
- **WHEN** eine Liste ohne Kopf keine Ebene nennt und einen Eintrag mit Titel zeigt
- **THEN** führt die Überschriftenliste des Vorlesers diesen Titel nicht
- **AND** steht der Titel in derselben Schriftgröße und -stärke da wie ein Überschriften-Titel

### Requirement: Eintragstitel als Überschrift nur bei eigenständigen Gegenständen

Ein Eintragstitel SHALL nur dann eine Überschrift sein, wenn der Eintrag ein eigener Gegenstand
mit Inhalt darunter ist, zwischen dem jemand springen will. Bei Auswahl-, Einstellungs- und
Stromlisten MUST der Titel keine Überschrift sein. Dort trägt der Listenpunkt die Navigation.
Ein Titel, der ein Bedienelement enthält (etwa ein Eingabefeld), MUST NOT eine Überschrift sein.

#### Scenario: Stab und Presse
- **WHEN** die Stab-Seite die Besetzung S1–S6 und die abgeschlossenen Lagebesprechungen zeigt und die Presse-Seite die Pressemitteilungen, jeweils in einem Paneel mit Überschrift `h2`
- **THEN** ist jeder Eintragstitel dort eine Überschrift der Ebene 3

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
