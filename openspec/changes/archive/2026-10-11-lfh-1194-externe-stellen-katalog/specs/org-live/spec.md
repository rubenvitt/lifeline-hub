# Spec Delta

## MODIFIED Requirements

### Requirement: Ereignis für die Stammdaten
Das System SHALL ein SSE-Ereignis mit dem Wire-Namen `stammdaten` verteilen, sobald eine
erfolgreiche Schreibanfrage einen Stammdaten-Katalog der Organisation ändert. Das Ereignis MUST
nach dem Commit verteilt werden, seine Nutzlast MUST leer sein (`{}`), und es MUST jeden
angemeldeten Abonnenten der Organisation erreichen und keinen anderer Organisationen.

Stammdaten-Kataloge im Sinne dieser Anforderung sind Fahrzeuge, Fahrzeug-Status, Personal,
Personal-Status, Material, Material-Kategorien, Qualifikationen, Einheit-Typen, Sprechgruppen der
Organisation, ETB-Bausteine, Stichwort-Vorschläge, Führungsfunktionen, externe Stellen und die Organisation selbst
(Name, Logo). Import, Neu-Import und Entfernen der Demo-Daten MUST `stammdaten` ebenfalls auslösen.

#### Scenario: Fahrzeug außer Dienst
- **WHEN** der System-Admin auf Schirm A ein Fahrzeug außer Dienst stellt und Schirm B derselben Organisation eine Fahrzeugauswahl offen hat
- **THEN** zeigt Schirm B den neuen Stand ohne Neuladen

#### Scenario: Andere Organisation
- **WHEN** Organisation A ihren Material-Katalog ändert
- **THEN** erhält kein Abonnent von Organisation B das Ereignis `stammdaten`

#### Scenario: Abgelehnte Änderung
- **WHEN** eine Katalog-Schreibanfrage mit 400, 403, 409 oder 422 abgelehnt wird
- **THEN** wird kein Ereignis `stammdaten` verteilt

#### Scenario: Externe Stelle angelegt
- **WHEN** der Admin auf Schirm A eine externe Stelle anlegt und Schirm B derselben Organisation die Einsatzdaten offen hat
- **THEN** schlägt Schirm B die neue Stelle bei der meldenden Stelle vor, ohne neu zu laden
