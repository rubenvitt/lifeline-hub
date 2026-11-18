# Spec Delta

## MODIFIED Requirements

### Requirement: Alle Abstandstoken der Komponentenbibliothek folgen dem Raster

Jedes Innen- und Außenabstandstoken der Komponentenbibliothek (`padding` und `margin` von XXS bis XL) und das seitliche Polster der Steuerelemente (normal auf Stufe `md`, klein auf `sm`) SHALL seinen Wert aus dem Raster der aktiven Dichtestufe beziehen; keines MUST auf einer festen Vorgabe der Bibliothek stehen bleiben. Die Inhaltspolster (Knopf, Dialog, Hinweis, Liste) sind ausgenommen: im Handschuh sprengten sie schmale Geräte.

#### Scenario: Mittlere und große Abstandsstufe in Handschuh
- **WHEN** die Dichtestufe `handschuh` aktiv ist
- **THEN** sind die Abstandstoken der Größen MD und XL größer als in `kompakt`

#### Scenario: Seitliches Polster der Steuerelemente in Handschuh
- **WHEN** die Dichtestufe `handschuh` aktiv ist
- **THEN** misst das seitliche Polster einer Option in einer Auswahlliste und eines Eintrags im Dropdown-Menü 24 px, und das kleine Steuerelementpolster 16 px

#### Scenario: Kompakt bleibt unverändert
- **WHEN** die Dichtestufe `kompakt` aktiv ist
- **THEN** misst das seitliche Polster der Steuerelemente 12 px und das kleine 8 px, wie vor dieser Änderung

#### Scenario: Inhaltspolster bleiben fest
- **WHEN** von `kompakt` auf `handschuh` umgeschaltet wird
- **THEN** behalten das seitliche Knopfpolster, der Inhaltsrand von Dialog und Benachrichtigung sowie die Polster von Hinweis und Liste ihre Werte aus `kompakt`
