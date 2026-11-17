## MODIFIED Requirements

### Requirement: Kein Layoutsprung durch die Startliste

Das Paneel MUST erst gezeichnet werden, wenn alle seine Quellen geladen sind, und MUST in derselben
Ladephase erscheinen wie die übrigen Paneele des Überblicks, damit nichts nachträglich verrutscht.

#### Scenario: Langsame ETB-Abfrage

- **WHEN** die Abfrage der Lagefeststellungen später antwortet als die übrigen Quellen
- **THEN** erscheinen Startliste und Paneelreihen zusammen, und keine Reihe verschiebt sich danach

#### Scenario: Quelle startet mitten in der Sitzung

- **WHEN** eine Person auf dem Überblick live Schreibrecht bekommt und die Lagefeststellungen zum
  ersten Mal geladen werden
- **THEN** bleiben die Paneelreihen dabei stehen, und die Startliste erscheint erst mit ihren
  Quellen
