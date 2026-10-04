# lagekarte-taktische-zeichen Specification

## Purpose

Legt fest, wie der Hub die taktischen Zeichen seiner Fachobjekte darstellt: auf der Lagekarte,
in der Symbolkachel des Inspectors und im Meldebild. Die gespeicherten Werte bleiben dabei
lesbar, und es gibt einen definierten Rückfall statt eines leeren oder abstürzenden Zeichens.

## Requirements

### Requirement: Fachliche Abbildung je Objekttyp
Das System SHALL die Zeichen der Fachobjekte nach der Systematik der Bibliothek `@einsatzzeichen`
(BABZ) zeichnen und dabei diese Abbildung einhalten:
- **Einheit**: taktische Formation in der Farbe ihrer Organisation. Die Einheitsgröße Trupp,
  Staffel, Gruppe oder Zug kommt aus dem Einheitstyp, ein Zugtrupp ist ein Trupp mit
  Formationskappe. Dazu kommt die Fachaufgabe, soweit die Bibliothek sie an der Formation
  darstellt.
- **Fahrzeug**: Kraftfahrzeug der Kategorie 1, ein Wasserfahrzeug, ein Luftfahrzeug oder ein
  Anhänger, je nach Fahrzeugtyp. Ein Krad oder Motorrad MUST als Landfahrzeug erscheinen.
  Rettungsdienstfahrzeuge (RTW, KTW, NEF, NAW, RTH) MUST das Sanitätszeichen tragen.
- **Führungskraft**: Person in der Farbe ihrer Organisation und MUST ohne Fachaufgabe
  gezeichnet werden.
- **Einsatzabschnitt**: taktische Formation in der Farbe „Führung und Leitung“, ohne Kürzel.
- **Einsatzort**: Zeichen „Ereignis“.
- **Schaden**: Zeichen „Gefahr“. Die Füllung folgt dem Ausmaß: gering grün, mittel gelb, groß
  orange, katastrophal rot, unbekannt grau.
- **Unfallhilfsstelle und Betreuungsstelle**: Stelle der Hilfsorganisation mit Arzt
  (Behandlungsplatz), Sanität (sonstige) oder Betreuung (Betreuungsstelle).

#### Scenario: Rettungswagen
- **WHEN** ein Fahrzeug des Typs „RTW“ einer Hilfsorganisation auf der Karte steht
- **THEN** zeigt sein Zeichen ein Landfahrzeug in der Farbe der Hilfsorganisation mit dem Sanitätszeichen

#### Scenario: Führungskraft mit Funktion Notarzt
- **WHEN** eine Führungskraft mit der Funktion „Notarzt“ auf der Karte steht
- **THEN** zeigt ihr Zeichen eine Person in der Farbe ihrer Organisation ohne Fachaufgabe

#### Scenario: Schaden mit großem Ausmaß
- **WHEN** ein Schaden mit Ausmaß „groß“ verortet ist
- **THEN** zeigt die Karte das Gefahrenzeichen orange gefüllt

### Requirement: Gespeicherte Werte bleiben ohne Migration lesbar
Das System SHALL die gespeicherten Zeichenwerte weiter lesen und MUST sie nicht umschreiben.
Das gilt für `tz_fachaufgabe` und `tz_organisation` an Einheit, Fahrzeug, Führungskraft und
Abschnitt sowie für den Organisations-Vorgabewert. Werte aus Lage-Snapshots und aus dem
Offline-Speicher des Geräts MUST auf demselben Weg dargestellt werden. Die alten
Organisationskennungen `fuehrung`, `gefahrenabwehr` und `zivil` MUST als „Führung und Leitung“,
„Sonstige Gefahrenabwehr“ und „Zivile Einheiten“ erscheinen. Die Auswahl der Organisation und
der Fachaufgabe im Inspector und in der Verwaltung MUST weiter dieselben Werte speichern wie
bisher.

#### Scenario: Bestandseinheit mit altem Wert
- **WHEN** eine Einheit mit `tz_organisation = 'zivil'` aus einem bestehenden Einsatz geladen wird
- **THEN** zeigt ihr Zeichen die Farbe der zivilen Einheiten, und der gespeicherte Wert bleibt `zivil`

#### Scenario: Rückblick auf einen Lage-Snapshot
- **WHEN** eine Person einen Lage-Snapshot öffnet, der vor der Umstellung eingefroren wurde
- **THEN** tragen die Fachobjekte darin ihr Zeichen nach der neuen Darstellung

### Requirement: Definierter Rückfall statt Ausfall
Lässt sich ein Zeichen mit allen Merkmalen nicht darstellen, SHALL das System es mit weniger
Merkmalen zeichnen. Zuerst entfällt die Fachaufgabe, dann die Einheitsgröße, dann die
Organisation, bis zum Körper allein. Ein unbekannter oder nicht darstellbarer gespeicherter
Wert MUST NOT dazu führen, dass eine Seite, eine Tabellenzeile oder die Karte abstürzt oder ein
Fachobjekt ohne Zeichen bleibt, sofern sein Körper darstellbar ist.

#### Scenario: Unbekannte Fachaufgabe
- **WHEN** eine Einheit `tz_fachaufgabe = 'gibt-es-nicht'` trägt
- **THEN** zeigen Meldebild und Karte die Formation ohne Fachaufgabe, und die Seite bleibt bedienbar

#### Scenario: Nicht darstellbare Kombination
- **WHEN** ein Fahrzeug eine Fachaufgabe trägt, die die Bibliothek am Kraftfahrzeug nicht darstellt
- **THEN** zeigt die Karte das Kraftfahrzeug in der Farbe seiner Organisation ohne diese Fachaufgabe

### Requirement: Kartenzeichen in Bildschirmschärfe
Die Lagekarte SHALL jedes Fachobjekt-Zeichen einheitlich 34 CSS-Pixel groß zeichnen, in der
Pixeldichte des Bildschirms, aufgerundet auf eine ganze Zahl. Gleiche Zeichen MUST nur einmal
als Kartenbild angelegt werden. Nach einem Wechsel der Grundkarte MUST jedes Zeichen wieder
erscheinen.

#### Scenario: Wechsel der Grundkarte
- **WHEN** die Person die Grundkarte wechselt
- **THEN** tragen alle Fachobjekt-Marker danach wieder ihr Zeichen

#### Scenario: Hochauflösender Bildschirm
- **WHEN** die Lagekarte auf einem Bildschirm mit Pixeldichte 2 geöffnet ist
- **THEN** ist jedes Fachobjekt-Zeichen mit 68 × 68 Gerätepixeln gerastert

### Requirement: Symbolkachel eines farblosen freien Zeichens bleibt lesbar

Trägt ein freies taktisches Zeichen keine eigene Farbe, MUST die Symbolkachel im Inspector der
Lagekarte Rahmen und Kürzel in einer Textrolle des aktiven Modus zeigen, nicht in der
DV-102-Tinte der Karte. Mit eigener Farbe zeigt die Kachel diese Farbe. Auf der Karte bleibt ein
farbloses freies Zeichen in der DV-102-Tinte.

#### Scenario: Farbloses Zeichen im Nachtmodus
- **WHEN** im Nachtmodus ein freies Zeichen ohne eigene Farbe gewählt wird
- **THEN** zeigt die Symbolkachel Rahmen und Kürzel in der Textrolle des Nachtmodus, nicht in `#333333`

#### Scenario: Zeichen mit eigener Farbe
- **WHEN** ein freies Zeichen mit der Farbe `#cc0000` gewählt wird
- **THEN** zeigt die Symbolkachel Rahmen und Kürzel in `#cc0000`

#### Scenario: Karte unverändert
- **WHEN** ein freies Zeichen ohne eigene Farbe auf der Karte gezeichnet wird
- **THEN** trägt es die DV-102-Tinte wie bisher, und das Farbfeld im Inspector schlägt dieselbe Tinte vor
