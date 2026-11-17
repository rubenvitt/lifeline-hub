# Spec Delta

## ADDED Requirements

### Requirement: Angabe der Führungsstelle mit Altwert speichern
Das Speichern einer Angabe der eigenen Führungsstelle auf der Seite Einsatzdaten SHALL neben dem
neuen Wert den Wert beim Öffnen als `erwartet` an `PATCH /api/einsaetze/{id}/fuehrungsstelle`
senden: Art, Bezeichnung, Standort (Koordinate als Paar), Rufname, Verbindungen und
Führungsfahrzeuge (Listen als Ganzes) sowie Einsatzleiter. Sprechgruppen gehen nicht über diesen
Weg.

#### Scenario: Rufname mit veraltetem Stand
- **WHEN** B den Rufnamen „Florian 1“ öffnet, A ihn inzwischen auf „Florian 2“ ändert und B „Florian 3“ speichert
- **THEN** antwortet der Server mit 409, und der Rufname bleibt „Florian 2“

#### Scenario: Ohne Altwert wie bisher
- **WHEN** ein Aufruf den Rufnamen ohne `erwartet` sendet
- **THEN** wird er ohne Vergleich gespeichert

### Requirement: Altwerte der Führungsstelle gemeinsam geprüft
Der Server SHALL alle Altwerte einer Anfrage an die Führungsstelle zusammen mit dem Schreiben
prüfen. Weicht einer ab, MUST er mit 409 antworten und nichts schreiben, auch keinen
Übergabe-Eintrag ins ETB.

#### Scenario: Einsatzleiter gleichzeitig übergeben
- **WHEN** A und B denselben Einsatzleiter sehen und nacheinander je eine andere Person als Einsatzleiter setzen
- **THEN** wird die zweite Übergabe mit 409 abgelehnt, und das ETB enthält nur den Übergabe-Eintrag der ersten
