## MODIFIED Requirements

### Requirement: Eine Filterleiste über der Zeitachse
Ab Breite `md` SHALL die ETB-Seite alle Filter in einer Leiste direkt über der Zeitachse zeigen, in
dieser Ordnung: Typ-Segmente, Umschaltknopf Systemeinträge, Zeitraum, Einheit, Volltext. Jedes
Typ-Segment SHALL die Zahl seiner Einträge aus der Serverzählung tragen; fehlt die Zählung, steht
keine Zahl. Der Seitenkopf MUST ab `md` keinen Filter tragen. Reicht die Breite nicht, MUST die
Leiste nur zwischen zwei Gruppen umbrechen — Typ und System, dann Zeitraum, Einheit und Volltext —
und höchstens zwei Zeilen belegen. Filterleiste und Spaltenkopf der Zeitachse MUST beim Rollen unter
dem Seitenkopf stehen bleiben. Unter `md` bleibt der Typ im Kopf, der Rest hinter „Filter (n)“.

#### Scenario: Fükw
- **WHEN** die ETB-Seite in kompakter Dichte bei 1440 × 900 steht
- **THEN** stehen Typ, System, Zeitraum, Einheit und Volltext in höchstens zwei Zeilen über der Zeitachse, Typ und System in derselben Zeile, jedes Typ-Segment mit seiner Zahl, und der Kopf trägt nur Titel, Zahlen, Sendestatus und „Drucken / als PDF“

#### Scenario: An der Arbeitsposition
- **WHEN** die ETB-Seite am Ende der Zeitachse geöffnet ist, wie beim Laden
- **THEN** stehen Filterleiste und Spaltenkopf im Bild, und eine Volltextsuche ist ohne Rollen erreichbar

#### Scenario: Handschirm
- **WHEN** die Seite bei 390 × 844 steht
- **THEN** rollt der Typ einzeilig im Kopf, „Filter (n)“ zählt die übrigen gesetzten Merkmale samt System, und zwei Einträge stehen ganz im Bild
