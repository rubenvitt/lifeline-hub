# Spec Delta

## ADDED Requirements

### Requirement: Adresse auf der Lagekarte suchen
Im Einsatz SHALL die Palette ohne Präfix zu einer Eingabe aus mindestens drei Zeichen mit einem
Buchstaben, die keine Koordinate ist, eine Zeile „Adresse auf Lagekarte suchen · „<Eingabe>““ am
Ende der Treffer anbieten, sofern das Modul Lagekarte für die Person frei ist. Die Zeile MUST auf
die Lagekarte springen und dort die Adresssuche mit der Eingabe auslösen; die Palette selbst MUST
den Geocoder nicht fragen. Die Zeile MUST ein Navigationsziel tragen, keine Vorschau und nicht ins
Befehlsgedächtnis gehen. Sie MUST nie vorausgewählt sein, auch nicht als einzige Zeile.

#### Scenario: Adresse tippen
- **WHEN** die Person im Einsatz „Hauptstraße 12“ tippt
- **THEN** steht am Ende der Treffer die Zeile „Adresse auf Lagekarte suchen · „Hauptstraße 12““

#### Scenario: Zeile ausführen
- **WHEN** die Person diese Zeile mit ↵ wählt
- **THEN** öffnet die Lagekarte mit „Hauptstraße 12“ im Suchfeld und startet die Adresssuche

#### Scenario: Nie vorausgewählt
- **WHEN** die Person „R-001“ tippt und ↵ drückt, bevor ein Datensatztreffer erschienen ist
- **THEN** führt ↵ nichts aus; erst ↓ markiert die Adresszeile

#### Scenario: Tippen fragt keinen Geocoder
- **WHEN** die Person in der Palette eine Adresse tippt, ohne die Zeile zu wählen
- **THEN** geht keine Anfrage an die Adresssuche

#### Scenario: Ohne Lagekarte-Recht
- **WHEN** das Modul Lagekarte für die Person gesperrt ist
- **THEN** erscheint die Zeile nicht

#### Scenario: Koordinate statt Adresse
- **WHEN** die Person „51.16040, 10.45140“ tippt
- **THEN** steht der Koordinatensprung da und keine Adresszeile

#### Scenario: Im neuen Tab
- **WHEN** die Adresszeile markiert ist und Strg+↵ gedrückt wird
- **THEN** öffnet sich die Lagekarte mit der Adresssuche in einem neuen Tab
