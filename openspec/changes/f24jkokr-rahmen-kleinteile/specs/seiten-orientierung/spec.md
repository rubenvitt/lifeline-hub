## ADDED Requirements

### Requirement: Die Rail führt zurück ins zuletzt besuchte Modul der Kategorie

Ein Klick auf eine andere Kategorie der Rail SHALL in das Modul dieser Kategorie führen, in dem
die Person im selben Einsatz zuletzt war, jede Ankunft gezählt. Gemerkt wird je Person und Einsatz
für zwölf Stunden. Ohne gültigen Eintrag oder wenn das gemerkte Modul gesperrt oder ausgeblendet
ist, MUST der Klick ins erste freigegebene Modul der Kategorie führen.

#### Scenario: Zurück in die Kräfte

- **WHEN** eine Person in Kräfte das Modul Ablösung öffnet, dann in Erfassung wechselt und wieder
  auf Kräfte klickt
- **THEN** steht sie in Ablösung, nicht im ersten Modul der Kategorie

#### Scenario: Ankunft über die Sprungpalette

- **WHEN** eine Person über die Sprungpalette Ablösung öffnet, in Erfassung wechselt und dann auf
  Kräfte klickt
- **THEN** steht sie in Ablösung

#### Scenario: Erster Besuch der Kategorie

- **WHEN** eine Person in diesem Einsatz noch in keinem Modul der Kategorie Kräfte war und auf
  Kräfte klickt
- **THEN** steht sie im ersten freigegebenen Modul der Kategorie

#### Scenario: Gemerktes Modul inzwischen gesperrt

- **WHEN** das zuletzt besuchte Modul einer Kategorie für die Person gesperrt worden ist und sie
  auf die Kategorie klickt
- **THEN** steht sie im ersten freigegebenen Modul der Kategorie

#### Scenario: Anderer Einsatz, andere Person

- **WHEN** eine Person in Einsatz A in Ablösung war und in Einsatz B auf Kräfte klickt, oder eine
  andere Person am selben Gerät in Einsatz A auf Kräfte klickt
- **THEN** führt der Klick ins erste freigegebene Modul der Kategorie

#### Scenario: Eintrag älter als zwölf Stunden

- **WHEN** der letzte Besuch in Ablösung mehr als zwölf Stunden zurückliegt und die Person auf
  Kräfte klickt
- **THEN** steht sie im ersten freigegebenen Modul der Kategorie
