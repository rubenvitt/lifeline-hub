## MODIFIED Requirements

### Requirement: Ankünfte zeichnen nicht auf

Das System MUST NOT ein Modul in „Zuletzt besucht" aufnehmen, wenn es angesteuert wurde, ohne
dass jemand genau dieses Modul gewählt hat. Das betrifft den Rail-Sprung in ein Modul einer
Kategorie (das zuletzt besuchte oder das erste), den Einsatz-Switcher mit der Weiterleitung auf
das Standardmodul, das Öffnen einer Adresse von außen (Lesezeichen, eingefügter Link, neuer Tab)
und Querverweise innerhalb von Modulinhalten.

#### Scenario: Rail-Sprung

- **WHEN** eine Person in der Rail eine andere Kategorie anklickt und dadurch in ein Modul
  dieser Kategorie geleitet wird
- **THEN** bleibt „Zuletzt besucht" unverändert, obwohl sich die Seite gewechselt hat

#### Scenario: Einsatzwechsel

- **WHEN** eine Person über den Einsatz-Switcher einen Einsatz öffnet und auf dessen
  Standardmodul weitergeleitet wird
- **THEN** enthält „Zuletzt besucht" dieses Standardmodul nicht

#### Scenario: Adresse von außen

- **WHEN** eine Modulseite direkt über ihre Adresse geladen wird
- **THEN** bleibt „Zuletzt besucht" unverändert
