# Spec Delta

## ADDED Requirements

### Requirement: Angabe der Einheit mit Altwert speichern
Das Speichern einer Angabe der Einheit über `PATCH /api/einsaetze/{id}/einheiten/{eid}` SHALL
neben dem neuen Wert ihren Wert beim Öffnen als `erwartet` senden, mit denselben Feldnamen: Name,
Typ, Abschnitt, Über-Einheit, Einheitsführer, Soll-Stärke (drei Felder gemeinsam),
Qualifikationssoll, Funkrufname, Bemerkung und Verbindungen (Liste als Ganzes). Sprechgruppen und
taktisches Zeichen gehen nicht über diesen Weg.

#### Scenario: Bemerkung mit veraltetem Stand
- **WHEN** die Ansicht die Bemerkung „Tor 3“ öffnet, ein anderer Arbeitsplatz sie auf „Tor 5“ ändert und hier „Halle 2“ mit `erwartet: { bemerkung: "Tor 3" }` gesendet wird
- **THEN** antwortet der Server mit 409, und die Bemerkung bleibt „Tor 5“

#### Scenario: Verbindungen als Ganzes
- **WHEN** die Ansicht die Verbindungen öffnet, ein anderer Arbeitsplatz eine Telefonnummer ergänzt und hier eine Funkverbindung hinzugefügt und gespeichert wird
- **THEN** antwortet der Server mit 409, und die Liste mit der ergänzten Telefonnummer bleibt

#### Scenario: Status dazwischen
- **WHEN** die Ansicht den Funkrufnamen öffnet, die Einheit inzwischen ihren Status wechselt und hier gespeichert wird
- **THEN** wird der Funkrufname gespeichert, ohne Rückfrage

### Requirement: Altwerte einer Einheit-Anfrage gemeinsam geprüft
Der Server SHALL alle Altwerte einer Anfrage an die Einheit zusammen mit dem Schreiben prüfen.
Weicht einer ab, MUST er mit 409 antworten und keine Angabe der Anfrage schreiben, auch keinen
ETB-Eintrag. Ein Altwert für ein Feld, das die Anfrage nicht ändert, MUST mit 400 abgelehnt werden.

#### Scenario: Einheitsführer mit Altwert
- **WHEN** zwei Arbeitsplätze denselben Einheitsführer sehen und nacheinander je eine andere Person als Führer setzen
- **THEN** wird der zweite Wechsel mit 409 abgelehnt, und das ETB enthält nur den Eintrag zum ersten Wechsel

#### Scenario: Ein Feld veraltet, zwei gesendet
- **WHEN** eine Anfrage Name und Bemerkung mit Altwerten sendet und nur der Altwert des Namens veraltet ist
- **THEN** antwortet der Server mit 409, und weder Name noch Bemerkung ändern sich

#### Scenario: Altwert ohne Änderung
- **WHEN** eine Anfrage `erwartet: { name: "Trupp 1" }` sendet, aber `name` nicht ändert
- **THEN** antwortet der Server mit 400
