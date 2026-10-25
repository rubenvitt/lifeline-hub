## ADDED Requirements

### Requirement: Aufgelöste Einheit nur lesend
Eine aufgelöste Einheit SHALL unter derselben Adresse wie eine aktive öffnen und nur lesend
erscheinen: Kopf mit „aufgelöst“ und Zeitpunkt der Auflösung, Kopfdaten als Werte, letzte
Besatzung nach Fahrzeugen gegliedert mit Führer-Kennzeichen, Fahrzeuge, Material mit Menge und
die Zeitachse. Sie MUST, auch mit Schreibrecht, weder Bearbeiten- oder Eintragen-Aufforderung
noch Menü, Lösen-Knopf, Zuordnen-Auswahl, Nachtrag noch den Abschnitt „Einheit auflösen“ tragen;
Links bleiben.

#### Scenario: Aufgelöste Einheit öffnen
- **WHEN** eine Person mit Schreibrecht die Ansicht der um 15:00 aufgelösten Einheit „Florian 1“
  öffnet
- **THEN** zeigt der Kopf „aufgelöst“ mit 15:00, die letzte Besatzung, Fahrzeuge, Material und
  Zeitachse stehen da, und die Seite trägt kein Bedienelement außer Links

#### Scenario: Letzte Besatzung nicht festgehalten
- **WHEN** eine Einheit geöffnet wird, die aufgelöst wurde, bevor das System die letzte Besetzung
  festhielt
- **THEN** sagt die Ansicht an Stelle von Besatzung, Fahrzeugen und Material, dass die letzte
  Besetzung nicht festgehalten wurde

#### Scenario: Unbekannte Einheit
- **WHEN** eine Adresse mit einer Einheit geöffnet wird, die weder aktiv noch aufgelöst ist
- **THEN** zeigt die App „Diese Einheit gibt es nicht (mehr)“ mit dem Weg zur Gliederung
