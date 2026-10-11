# einsatz-zugriff Specification

## Purpose
Regelt, wer den Zugriff eines Einsatzes verwaltet und wen die Einsatzleitung in ihren Einsatz
aufnehmen kann, samt der Personenauswahl, die ihr dafür angeboten wird.

## Requirements

### Requirement: Einsatzleitung nimmt ohne Systemrolle auf
Die Einsatzleitung eines laufenden Einsatzes SHALL Personen der Organisation des Einsatzes in den
Einsatz aufnehmen können, ohne System-Admin zu sein. Die Auswahl im Abschnitt „Zugriff“ MUST sich
für sie füllen; ein Hinweis, die Liste stehe nur Admins zur Verfügung, MUST NOT erscheinen.

#### Scenario: Einsatzleitung ohne Systemrolle nimmt eine Person auf
- **WHEN** eine Einsatzleitung ohne Systemrolle unter „Zugriff“ eine angebotene Person und eine Rolle wählt und „Hinzufügen“ wählt
- **THEN** steht die Person mit dieser Rolle in der Mitgliederliste des Einsatzes

#### Scenario: Kein Admin-Hinweis an der Auswahl
- **WHEN** eine Einsatzleitung ohne Systemrolle die Auswahl „Benutzer …“ öffnet
- **THEN** zeigt sie die aufnehmbaren Personen und nicht „Benutzerliste nur für Admins“

### Requirement: Auswahl bietet nur aufnehmbare Personen an
Die Personenauswahl eines Einsatzes SHALL genau die Personen anbieten, die sich aufnehmen lassen:
aktive Personenkonten der Organisation des Einsatzes, die noch nicht Mitglied sind. Gerätekonten
und deaktivierte Konten MUST NOT erscheinen.

#### Scenario: Mitglieder, Gerätekonten und deaktivierte Konten fehlen
- **WHEN** die Organisation des Einsatzes ein Mitglied, ein Gerätekonto, ein deaktiviertes Konto und eine aktive Person ohne Mitgliedschaft hat
- **THEN** bietet die Auswahl nur die aktive Person ohne Mitgliedschaft an

#### Scenario: Alle schon Mitglied
- **WHEN** jede aktive Person der Organisation schon Mitglied des Einsatzes ist
- **THEN** ist die Auswahl leer und sagt, dass keine weitere Person aufgenommen werden kann

### Requirement: Keine Personen fremder Organisationen
Die Personenauswahl MUST NOT Personen einer anderen Organisation als der des Einsatzes enthalten,
auch nicht für einen System-Admin.

#### Scenario: Person einer fremden Organisation
- **WHEN** eine andere Organisation eine aktive Person hat
- **THEN** fehlt diese Person in der Auswahl des Einsatzes, für die Einsatzleitung wie für einen System-Admin mit Einsatzleitung

### Requirement: Auswahl trägt nur Kennung und Anzeigename
Die Personenauswahl SHALL je Person nur ihre Kennung und ihren Anzeigenamen liefern. Benutzername,
System- und Org-Rolle, Aktivstatus, MFA-Status und Anlagezeitpunkt MUST NOT enthalten sein.

#### Scenario: Felder der Auswahl
- **WHEN** die Einsatzleitung die Auswahl abruft
- **THEN** enthält jeder Eintrag genau Kennung und Anzeigename

### Requirement: Auswahl nur für die Einsatzleitung eines laufenden Einsatzes
Die Personenauswahl SHALL nur der Einsatzleitung eines laufenden Einsatzes zustehen. Führungspersonal,
Beobachter, Personen ohne Rolle (auch System-Admins und Führungskräfte der Organisation) und
gekoppelte Geräte MUST sie nicht erhalten; an einem abgeschlossenen Einsatz MUST sie verweigert werden.

#### Scenario: Führungspersonal fragt die Auswahl ab
- **WHEN** Führungspersonal des Einsatzes die Auswahl abruft
- **THEN** wird der Abruf mit „keine Berechtigung“ abgewiesen

#### Scenario: System-Admin ohne Rolle im Einsatz
- **WHEN** ein System-Admin ohne Rolle im Einsatz die Auswahl abruft
- **THEN** wird der Abruf mit „keine Berechtigung“ abgewiesen

#### Scenario: Abgeschlossener Einsatz
- **WHEN** die Einsatzleitung die Auswahl eines abgeschlossenen Einsatzes abruft
- **THEN** wird der Abruf abgewiesen, wie jeder Schreibweg am abgeschlossenen Einsatz
