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
- **Führungskraft**: Person in der Farbe ihrer Organisation mit ihrer Fachaufgabe, soweit die
  Bibliothek sie an der Person darstellt, auch wenn diese Darstellung nur abgeleitet und nicht
  vermessen ist. Die Fachaufgabe kommt aus dem gespeicherten Wert oder aus der Funktion: Notarzt
  oder Arzt ergibt Arzt, Rettungsdienst oder Sanitäter ergibt Sanität, Funk oder Fernmelde ergibt
  IuK. Ist die Person Einheitsführer oder Abschnittsleiter, MUST sie den Führungskraft-Indikator
  tragen (Raute mit schwarzer Kappe, ohne Kürzel), auch wenn die Bibliothek ihn nur abgeleitet
  zeichnet; die Fachaufgabe steht dann im Indikator. Andere Personen MUST NOT einen
  Funktionsindikator tragen. Lässt sich der Indikator nicht zeichnen, MUST die Person ohne ihn
  erscheinen.
- **Einsatzabschnitt**: taktische Formation in der Farbe „Führung und Leitung“, ohne Kürzel.
- **Einsatzort**: Zeichen „Ereignis“.
- **Schaden**: Zeichen „Gefahr“. Die Füllung folgt dem Ausmaß: gering grün, mittel gelb, groß
  orange, katastrophal rot, unbekannt grau.
- **Unfallhilfsstelle und Betreuungsstelle**: Stelle mit Arzt (Behandlungsplatz), Sanität
  (sonstige) oder Betreuung (Betreuungsstelle). Die Stelle trägt die Organisation des Betreibers,
  also die Organisations-Vorgabe des Hubs. Ist keine hinterlegt, MUST sie ohne Organisation
  stehen und MUST NOT fest als Hilfsorganisation erscheinen.

#### Scenario: Rettungswagen
- **WHEN** ein Fahrzeug des Typs „RTW“ einer Hilfsorganisation auf der Karte steht
- **THEN** zeigt sein Zeichen ein Landfahrzeug in der Farbe der Hilfsorganisation mit dem Sanitätszeichen

#### Scenario: Führungskraft mit Funktion Notarzt
- **WHEN** eine Führungskraft mit der Funktion „Notarzt“ auf der Karte steht
- **THEN** zeigt ihr Zeichen eine Person in der Farbe ihrer Organisation mit dem Arztzeichen

#### Scenario: Einheitsführer mit Funktion Notarzt
- **WHEN** ein Einheitsführer mit der Funktion „Notarzt“ auf der Karte steht
- **THEN** zeigt sein Zeichen eine Person in der Farbe seiner Organisation mit dem Führungskraft-Indikator und dem Arztzeichen

#### Scenario: Person ohne Führungsfunktion
- **WHEN** eine Person, die weder Einheitsführer noch Abschnittsleiter ist, auf der Karte steht
- **THEN** trägt ihr Zeichen keinen Funktionsindikator

#### Scenario: Unfallhilfsstelle eines Feuerwehr-Hubs
- **WHEN** die Organisations-Vorgabe des Hubs „Feuerwehr“ ist und eine UHS „sonstige“ auf der Karte steht
- **THEN** zeigt ihr Zeichen die Stelle in der Farbe der Feuerwehr mit dem Sanitätszeichen

#### Scenario: Betreuungsstelle ohne Organisations-Vorgabe
- **WHEN** der Hub keine Organisations-Vorgabe hat und eine Betreuungsstelle auf der Karte steht
- **THEN** zeigt ihr Zeichen die Stelle ohne Organisation mit dem Betreuungszeichen

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
der Fachaufgabe im Inspector, in der Verwaltung und in der Ansicht einer Einheit MUST dieselben
Werte speichern wie bisher; alle drei Orte MUST ihre Auswahl aus einer gemeinsamen Liste nehmen.

#### Scenario: Bestandseinheit mit altem Wert
- **WHEN** eine Einheit mit `tz_organisation = 'zivil'` aus einem bestehenden Einsatz geladen wird
- **THEN** zeigt ihr Zeichen die Farbe der zivilen Einheiten, und der gespeicherte Wert bleibt `zivil`

#### Scenario: Rückblick auf einen Lage-Snapshot
- **WHEN** eine Person einen Lage-Snapshot öffnet, der vor der Umstellung eingefroren wurde
- **THEN** tragen die Fachobjekte darin ihr Zeichen nach der neuen Darstellung

#### Scenario: Zeichen in der Einheit-Ansicht gesetzt
- **WHEN** in der Ansicht einer Einheit die Fachaufgabe „Betreuung“ gespeichert wird
- **THEN** ist `tz_fachaufgabe = 'betreuung'` gespeichert, und der Inspector der Lagekarte zeigt
  für diese Einheit dieselbe Fachaufgabe gewählt

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

### Requirement: Führungsstelle auf der Lagekarte
Trägt die eigene Führungsstelle eine Koordinate, SHALL die Lagekarte sie als Marker mit dem
DV-102-Zeichen „Befehlsstelle“ zeigen, beschriftet mit ihrer Bezeichnung, ohne Bezeichnung mit
„Führungsstelle“. Der Marker MUST nur lesend sein (nicht verschiebbar, nicht platzierbar) und auf
ihr Paneel in den Einsatzdaten verweisen. Ohne Koordinate MUST er fehlen.

#### Scenario: Führungsstelle mit Koordinate
- **WHEN** die Führungsstelle „ELW 2 Musterstadt“ mit Koordinate erfasst ist
- **THEN** zeigt die Lagekarte dort das Zeichen „Befehlsstelle“ mit der Beschriftung „ELW 2 Musterstadt“

#### Scenario: Ohne Koordinate
- **WHEN** die Führungsstelle nur eine Adresse trägt
- **THEN** zeigt die Lagekarte keinen Marker der Führungsstelle

#### Scenario: Marker lässt sich nicht verschieben
- **WHEN** eine Person mit Schreibrecht den Marker der Führungsstelle ziehen will
- **THEN** bleibt er an seiner Koordinate, und der Inspector verweist auf die Einsatzdaten
