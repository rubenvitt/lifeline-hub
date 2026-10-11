# Spec Delta

## MODIFIED Requirements

### Requirement: Definierter Rückfall statt Ausfall
Lässt sich ein Zeichen mit allen Merkmalen nicht darstellen, SHALL das System es mit weniger
Merkmalen zeichnen. Zuerst entfällt die Fachaufgabe, dann die Einheitsgröße, dann die
Organisation, bis zum Körper allein. Ein unbekannter oder nicht darstellbarer gespeicherter
Wert MUST NOT dazu führen, dass eine Seite, eine Tabellenzeile oder die Karte abstürzt oder ein
Fachobjekt ohne Zeichen bleibt, sofern sein Körper darstellbar ist.

Für freie Zeichen gilt dieselbe Kaskade; vor der Fachaufgabe entfällt das Symbol, nach der
Organisation die Farbe. Lässt sich bei einem freien Zeichen nicht einmal ein Körper oder ein
Piktogramm darstellen, MUST die Karte einen neutralen Platzhalter zeigen, damit das Zeichen
auswählbar und löschbar bleibt.

#### Scenario: Unbekannte Fachaufgabe
- **WHEN** eine Einheit `tz_fachaufgabe = 'gibt-es-nicht'` trägt
- **THEN** zeigen Meldebild und Karte die Formation ohne Fachaufgabe, und die Seite bleibt bedienbar

#### Scenario: Nicht darstellbare Kombination
- **WHEN** ein Fahrzeug eine Fachaufgabe trägt, die die Bibliothek am Kraftfahrzeug nicht darstellt
- **THEN** zeigt die Karte das Kraftfahrzeug in der Farbe seiner Organisation ohne diese Fachaufgabe

#### Scenario: Altzeichen mit gesperrter Kombination
- **WHEN** ein freies Altzeichen ein Kraftfahrzeug mit der Einheitsgröße „Zug“ trägt
- **THEN** zeigt die Karte das Kraftfahrzeug ohne Einheitsgröße

#### Scenario: Altzeichen ohne Nachfolger
- **WHEN** ein freies Altzeichen nur das Symbol „Fernschreiben“ ohne Grundzeichen trägt
- **THEN** zeigt die Karte an seiner Stelle einen neutralen Platzhalter, den die Person auswählen und löschen kann

### Requirement: Kartenzeichen in Bildschirmschärfe
Die Lagekarte SHALL jedes Fachobjekt-Zeichen und jedes freie Zeichen einheitlich 34 CSS-Pixel
groß zeichnen, in der Pixeldichte des Bildschirms, aufgerundet auf eine ganze Zahl. Gleiche
Zeichen MUST nur einmal als Kartenbild angelegt werden, auch wenn ein Fachobjekt und ein freies
Zeichen dasselbe Zeichen tragen. Nach einem Wechsel der Grundkarte MUST jedes Zeichen wieder
erscheinen.

#### Scenario: Wechsel der Grundkarte
- **WHEN** die Person die Grundkarte wechselt
- **THEN** tragen alle Fachobjekt-Marker und alle freien Zeichen danach wieder ihr Zeichen

#### Scenario: Hochauflösender Bildschirm
- **WHEN** die Lagekarte auf einem Bildschirm mit Pixeldichte 2 geöffnet ist
- **THEN** ist jedes Fachobjekt-Zeichen und jedes freie Zeichen mit 68 × 68 Gerätepixeln gerastert

#### Scenario: Freies Zeichen sofort sichtbar
- **WHEN** die Person ein freies Zeichen platziert
- **THEN** trägt der Marker sein Zeichen sofort, ohne auf ein weiteres Neu-Layout der Karte zu warten

### Requirement: Symbolkachel eines farblosen freien Zeichens bleibt lesbar

Die Symbolkachel im Inspector der Lagekarte SHALL das freie Zeichen so zeigen, wie die
Bibliothek es zeichnet. Trägt das Zeichen eine Füllung aus der Palette, MUST der Rahmen der
Kachel diese Farbe tragen. Ohne Füllung MUST der Rahmen eine Textrolle des aktiven Modus tragen,
nicht die Zeichentinte der Karte. Auf der Karte trägt ein freies Zeichen ohne Füllung dieselbe
Tinte wie ein Fachobjekt-Zeichen.

#### Scenario: Farbloses Zeichen im Nachtmodus
- **WHEN** im Nachtmodus ein freies Zeichen ohne Füllung gewählt wird
- **THEN** zeigt die Symbolkachel das Zeichen, und ihr Rahmen trägt die Textrolle des Nachtmodus

#### Scenario: Zeichen mit eigener Farbe
- **WHEN** ein freies Zeichen „Gefahr“ mit roter Füllung gewählt wird
- **THEN** zeigt die Symbolkachel das Zeichen, und ihr Rahmen trägt das Rot der Palette

#### Scenario: Karte unverändert
- **WHEN** ein freies Zeichen ohne Füllung auf der Karte gezeichnet wird
- **THEN** trägt es dieselbe Tinte wie ein Fachobjekt-Zeichen
