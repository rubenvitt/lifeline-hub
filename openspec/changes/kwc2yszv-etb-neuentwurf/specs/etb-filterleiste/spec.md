## MODIFIED Requirements

### Requirement: Eine Filterleiste über der Zeitachse
Ab Breite `md` SHALL die ETB-Seite alle Filter in einer Leiste direkt über der Zeitachse zeigen, in
dieser Ordnung: Typ-Segmente, Umschaltknopf Systemeinträge, Zeitraum, Einheit, Volltext. Jedes
Typ-Segment SHALL die Zahl seiner Einträge aus der Serverzählung tragen; fehlt die Zählung, steht
keine Zahl. Der Seitenkopf MUST ab `md` keinen Filter tragen. Reicht die Breite nicht, MUST die
Leiste nur zwischen zwei Gruppen umbrechen — Typ und System, dann Zeitraum, Einheit und Volltext —
und höchstens zwei Zeilen belegen. Filterleiste und Spaltenkopf der Zeitachse MUST beim Rollen unter
dem Seitenkopf stehen bleiben, solange Seitenkopf, Filterleiste und Spaltenkopf zusammen höchstens
ein Drittel der Fensterhöhe belegen; sonst rollen sie mit, damit zwischen ihnen und der Erfassung
Platz für den Fokus bleibt. Unter `md` bleibt der Typ im Kopf, der Rest hinter „Filter (n)“.

#### Scenario: Fükw
- **WHEN** die ETB-Seite in kompakter Dichte bei 1440 × 900 steht
- **THEN** stehen Typ, System, Zeitraum, Einheit und Volltext in höchstens zwei Zeilen über der Zeitachse, Typ und System in derselben Zeile, jedes Typ-Segment mit seiner Zahl, und der Kopf trägt nur Titel, Zahlen, Sendestatus und „Drucken / als PDF“

#### Scenario: An der Arbeitsposition
- **WHEN** die ETB-Seite am Ende der Zeitachse geöffnet ist, wie beim Laden
- **THEN** stehen Filterleiste und Spaltenkopf im Bild, und eine Volltextsuche ist ohne Rollen erreichbar

#### Scenario: Handschirm
- **WHEN** die Seite bei 390 × 844 steht
- **THEN** rollt der Typ einzeilig im Kopf, „Filter (n)“ zählt die übrigen gesetzten Merkmale samt System, und zwei Einträge stehen ganz im Bild

### Requirement: Filterband über der Erfassung
Ist ein Filtermerkmal gesetzt (Typ, Zeitraum, Einheit, Volltext), SHALL direkt über der Erfassung auf
jeder Breite ein Band in der Achtungsfläche stehen: das Wort „Gefiltert“, „n von m Einträgen
sichtbar“, die Merkmale kurz und „Filter zurücksetzen“. Ausgeblendete Systemeinträge sind die
Vorgabe und MUST NOT als Merkmal zählen. n und m MUST aus der Serverzählung stammen; fehlt eine,
steht keine Zahl. Ohne Filter MUST das Band fehlen und keinen Platz belegen.

#### Scenario: Zeitraum gesetzt
- **WHEN** „Letzte Stunde“ gilt und 7 von 134 Einträgen dazu passen
- **THEN** steht über der Erfassung „Gefiltert · 7 von 134 Einträgen sichtbar · seit 1345“ mit „Filter zurücksetzen“

#### Scenario: Zurücksetzen
- **WHEN** „Filter zurücksetzen“ gewählt wird
- **THEN** sind alle Filtermerkmale aus der Adresse entfernt, die Felder geleert, und das Band ist fort

#### Scenario: Zählung fehlt
- **WHEN** die Zählung noch lädt
- **THEN** steht „Gefiltert“ mit den Merkmalen, aber keine Zahl, auch keine aus dem geladenen Fenster

#### Scenario: Nur die Vorgabe
- **WHEN** die ETB-Seite ohne Filter in der Adresse geöffnet wird und Systemeinträge ausgeblendet sind
- **THEN** steht kein Filterband über der Erfassung
