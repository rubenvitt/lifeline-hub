# Spec Delta

## REMOVED Requirements

### Requirement: Eintragstitel als Überschrift nur bei eigenständigen Gegenständen
**Reason**: Das Modul Stab samt Presse und Medienarbeit (S5) entfällt (LLH-722, Entscheidung 08.11.2026; design.md D1). Die Szenarien „Stab und Presse“ und „Kacheln der Stab-Seite“ nennen Presse- und Stab-Seite; OpenSpec erlaubt nicht, sie in einem MODIFIED-Block wegzulassen oder umzubenennen.
**Migration**: Die Regel gilt unverändert unter „Nur eigenständige Gegenstände tragen ihren Eintragstitel als Überschrift“; der Verlauf der Lagebesprechungen bleibt als Beispiel.

## ADDED Requirements

### Requirement: Nur eigenständige Gegenstände tragen ihren Eintragstitel als Überschrift

Ein Eintragstitel SHALL nur dann eine Überschrift sein, wenn der Eintrag ein eigener Gegenstand
mit Inhalt darunter ist, zwischen dem jemand springen will. Bei Auswahl-, Einstellungs- und
Stromlisten MUST der Titel keine Überschrift sein. Dort trägt der Listenpunkt die Navigation.
Ein Titel, der ein Bedienelement enthält (etwa ein Eingabefeld), MUST NOT eine Überschrift sein.

#### Scenario: Verlauf der Lagebesprechungen
- **WHEN** die Seite Lagebesprechung den Verlauf der abgeschlossenen Lagebesprechungen in einem Paneel mit Überschrift `h2` zeigt
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
