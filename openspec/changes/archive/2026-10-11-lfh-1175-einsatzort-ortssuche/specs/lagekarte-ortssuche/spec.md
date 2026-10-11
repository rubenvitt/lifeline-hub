## MODIFIED Requirements

### Requirement: Adresssuche über den Server mit Grenzen
Die Adressauflösung SHALL über den Server laufen, an den Geocoder der Organisation (ohne Einstellung
der öffentliche Nominatim). Der Einstieg der Lagekarte MUST das Recht auf das Modul Lagekarte
verlangen; die Einstiege des Ortsfelds regelt die Fähigkeit `ortsfeld`. Der Server MUST für alle
Geocoder-Anfragen zusammen, über alle Einstiege, höchstens eine je Sekunde stellen, jede nach
spätestens 1,5 Sekunden aufgeben und Geocoder-Fehler als Zustand der Antwort melden, nie als
Fehlerstatus. Ein Suchtext unter drei oder über 200 Zeichen MUST an jedem Einstieg mit 400
abgelehnt werden.

#### Scenario: Ohne Lagekarte-Recht
- **WHEN** eine Person ohne Zugriff auf das Modul Lagekarte die Adresssuche der Lagekarte aufruft
- **THEN** antwortet der Server mit 403 und fragt den Geocoder nicht

#### Scenario: Geocoder fällt aus
- **WHEN** der Geocoder nicht antwortet
- **THEN** antwortet der Server mit 200 und dem Zustand „nicht erreichbar“ ohne Treffer

#### Scenario: Leerer Suchtext
- **WHEN** die Adresssuche mit einem Suchtext aus zwei Zeichen aufgerufen wird
- **THEN** antwortet der Server mit 400

#### Scenario: Ein Takt für alle Einstiege
- **WHEN** die Lagekarte und das Ortsfeld in derselben Sekunde je eine Adresse suchen
- **THEN** stellt der Server höchstens eine Anfrage an den Geocoder, und die andere Suche antwortet mit dem Zustand „ausgelastet“ oder nach dem nächsten Takt
