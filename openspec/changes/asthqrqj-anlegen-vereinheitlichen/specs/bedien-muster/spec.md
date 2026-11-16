# Spec Delta

## ADDED Requirements

### Requirement: Einen Datensatz anlegen

Ein neuer Datensatz MUST in einem Erfassungsdialog angelegt werden. Eine eigene Seite MUST es nur
für einen Ablauf oder mehr als etwa fünf Pflichtfelder geben, ein eingeklapptes Formular über der
Liste nur, wo dort in Serie erfasst wird („Speichern und nächste“). Eine Seitenleiste (Drawer)
MUST NOT zum Anlegen dienen. Jeder Einstieg desselben Datensatzes MUST dieselbe Form öffnen.

#### Scenario: Unfallhilfsstelle anlegen
- **WHEN** jemand mit Schreibrecht in der Liste der Unfallhilfsstellen „Neu“ wählt
- **THEN** öffnet sich der Dialog „Unfallhilfsstelle anlegen“ mit Bezeichnung, Typ und Standort, die Notiz unter „Weitere Angaben“, und keine Seitenleiste

#### Scenario: Nach dem Anlegen in der neuen Ansicht
- **WHEN** jemand im Dialog „Unfallhilfsstelle anlegen“ eine Bezeichnung einträgt und „Anlegen“ wählt
- **THEN** schließt der Dialog, und die Seite zeigt die neue Unfallhilfsstelle

#### Scenario: Bereitstellungsraum aus der Sprungpalette
- **WHEN** jemand mit Schreibrecht in der Sprungpalette „Bereitstellungsraum anlegen“ wählt
- **THEN** öffnet sich der Dialog „Bereitstellungsraum anlegen“, derselbe wie über „Neu“ in der Liste und „+ Neuer BR“ im Switcher

#### Scenario: Lagemeldung erfassen
- **WHEN** jemand mit Schreibrecht auf der Seite Lagemeldungen „Lagemeldung erfassen“ wählt
- **THEN** öffnet sich ein Dialog mit dem Meldungsformular, die Art „Lagemeldung“ vorbelegt, und nach dem Erfassen schließt er, die neue Lagemeldung steht oben in der Zeitachse

#### Scenario: Meldungen in Serie
- **WHEN** jemand mit Schreibrecht auf der Seite Meldungen „Meldung erfassen“ wählt
- **THEN** klappt das Formular über der Liste auf, und „Speichern und nächste“ hält es nach dem Erfassen offen
