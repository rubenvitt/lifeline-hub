# lagekarte-kartenleiste Specification

## Purpose

Gliedert die Kartenleiste der Lagekarte in die Ansichten „Ebenen“, „Objekte“ und — solange etwas
ausgewählt ist — „Auswahl“, führt alles, was die Karte zeigt, in einem gruppierten Ebenenbaum, alle
Objekte in einer Objektliste und gibt jedem Leistenmodus eine feste Stelle für seine Bedienung. Hält die Lagekarte auf schmalen Breiten (Handschirm, Tablet hochkant) in jedem
Kartenmodus mit Tipp auf die Karte bedienbar: Die Kartenleiste weicht dem Modus und kommt danach im
vorherigen Zustand zurück.

## Requirements

### Requirement: Kartenmodus gibt unter lg die Karte frei
Unterhalb der Breite `lg` SHALL die Kartenleiste geschlossen sein, solange ein Kartenmodus läuft.
Kartenmodi sind: Zone zeichnen, Abschnittsfläche zeichnen, Objekt oder Einsatzort platzieren,
Taktisches Zeichen setzen, Bild einpassen und Messen. Das MUST für jeden Startweg gelten, auch für
den Verortungsauftrag per Adresse (`?platzieren=`) und für Messen über den Kartenknopf. Eine offene
Auswahl (Inspector) MUST die Leiste weiterhin öffnen, auch während eines Modus. Ab `lg` bleibt das
bisherige Verhalten unverändert.

#### Scenario: Platzieren aus der Objektliste bei 390 px
- **WHEN** bei 390 px die Leiste offen ist und in der Objektliste bei einer nicht verorteten Einheit „Platzieren“ getippt wird
- **THEN** schließt die Leiste, der Kopf bietet „Leiste einblenden“, und ein Tipp auf die freie Karte verortet die Einheit an dieser Stelle

#### Scenario: Verortungsauftrag per Adresse
- **WHEN** die Lagekarte bei 390 px mit `?platzieren=schaden:<id>` geöffnet wird
- **THEN** ist die Leiste geschlossen, und die Bedienung des Platzierens steht über der Karte

#### Scenario: Messen gibt die Karte frei
- **WHEN** bei 768 px die Leiste offen ist und der Kartenknopf „Messen“ getippt wird
- **THEN** schließt die Leiste, und zwei Tipps auf die Karte ergeben eine Strecke im Messwert

#### Scenario: Ab lg unverändert
- **WHEN** bei 1024 px ein Taktisches Zeichen platziert wird
- **THEN** bleibt die Leiste offen, und „Abbrechen“ steht im Modus-Band der Leiste

### Requirement: Leiste bekommt nach dem Modus ihren vorherigen Zustand zurück
Endet ein Kartenmodus unter `lg` (abgeschlossen, abgebrochen oder durch einen erfolgreichen Tipp
beendet), SHALL die Leiste den Zustand annehmen, den sie unmittelbar vor dem Modus hatte. Die
gewählte Ansicht, Suchbegriffe, die Filter „Ebene suchen“ und „Nicht verortet“ sowie aufgeklappte
Paneele und Gruppen der Leiste MUST dabei erhalten bleiben. Wechselt ein Modus direkt in einen
anderen, gilt das als ein durchgehender Modus.

#### Scenario: Vorgabe „offen“ bei 768 px kehrt zurück
- **WHEN** bei 768 px in der Objekte-Ansicht ein Suchbegriff steht, an einem Treffer „Platzieren“ getippt und dann die Karte angetippt wird
- **THEN** ist die Leiste nach dem Verorten wieder offen, die Objekte-Ansicht ist gewählt, und der Suchbegriff steht noch im Feld

#### Scenario: Ansicht und Filter überstehen den Modus
- **WHEN** bei 390 px in der Ansicht „Ebenen“ „Lage“ im Filter steht, über das Werkzeugmenü ein Taktisches Zeichen platziert und der Modus beendet wird
- **THEN** zeigt die eingeblendete Leiste die Ansicht „Ebenen“ mit dem Filter „Lage“ unverändert

#### Scenario: Geschlossene Leiste bleibt geschlossen
- **WHEN** bei 390 px die Leiste geschlossen ist und Messen gestartet und wieder beendet wird
- **THEN** ist die Leiste danach geschlossen

### Requirement: Leiste während eines Modus vorläufig zurückholen
Unter `lg` SHALL der Kopfknopf „Leiste einblenden“ während eines Kartenmodus bedienbar bleiben,
damit Angaben aus der Leiste erreichbar sind (Koordinate eingeben, Mittelpunkt numerisch). Dieses
Umschalten MUST nur für den laufenden Modus gelten: Es wird nicht gespeichert, und nach dem Modus
gilt der vorherige Zustand. Nur eine offene Auswahl sperrt den Knopf.

#### Scenario: Koordinate eingeben während des Platzierens
- **WHEN** bei 390 px ein Platzieren läuft, „Leiste einblenden“ getippt und dort eine Koordinate übernommen wird
- **THEN** ist das Objekt verortet, und die Leiste ist danach wieder so wie vor dem Platzieren

#### Scenario: Kein gespeicherter Nebeneffekt
- **WHEN** bei 390 px während eines Modus die Leiste eingeblendet und die Seite nach Ende des Modus neu geladen wird
- **THEN** ist die Leiste geschlossen wie vor dem Modus

### Requirement: Modusbedienung steht unter lg über der Karte
Unter `lg` SHALL jeder Kartenmodus seine Bedienung in einem Band des Kartenfußes tragen, nicht in
der Leiste. Für Platzieren sind das Titel mit Objekt und „Abbrechen“. Für das Taktische Zeichen
kommen der Schalter „Weitere platzieren“, der Zähler und „Fertig“ bzw. „Abbrechen“ hinzu. Für Bild
einpassen sind es die Griffwahl (Verschieben, Größe, Drehen) und „Fertig“. Jedes Bedienelement
MUST je Breite an genau einer Stelle stehen. Ist die Leiste während des Modus eingeblendet, trägt
ihr Modus-Band nur den Titel und die Zusatzangaben (Koordinate, Mittelpunkt), keinen Knopf aus dem
Fuß-Band. Das Band MUST mit ausgeklappter Zeitachse bei 390 px vollständig über der Karte liegen
und per Tipp bedienbar sein.

#### Scenario: Taktisches Zeichen per Tipp bei 390 px
- **WHEN** bei 390 px mit ausgeklappter Zeitachse ein Taktisches Zeichen gewählt, die Karte angetippt und im Band „Fertig“ bzw. „Abbrechen“ getippt wird
- **THEN** ist das Zeichen gespeichert, der Modus beendet und die Leiste im vorherigen Zustand

#### Scenario: Bild einpassen bei 390 px
- **WHEN** bei 390 px ein Bild eingepasst wird
- **THEN** stehen Griffwahl und „Fertig“ im Band, der Griff „Verschieben“ liegt nicht unter dem Fuß, und ein Ziehen am Griff ändert die gespeicherte Lage des Bildes

#### Scenario: Keine doppelte Bedienung
- **WHEN** bei 390 px während eines Platzierens die Leiste eingeblendet wird
- **THEN** gibt es genau einen Knopf „Abbrechen“ für diesen Modus, und zwar im Band

### Requirement: Die Kartenleiste hat die Ansichten „Ebenen“, „Objekte“ und „Auswahl“
Die erste Zeile der Kartenleiste SHALL eine Segmentleiste mit den Segmenten „Ebenen“ und „Objekte“
sein, solange etwas ausgewählt ist dazu „Auswahl“ (Tabliste, jedes Segment steuert seine Fläche).
Jedes Segment MUST ein festes Drittel der Leistenbreite einnehmen; ohne Auswahl bleibt das dritte
Drittel frei. Die Segmentleiste und das Modus-Band MUST beim Rollen der Leiste stehen bleiben.
„Ebenen“ zeigt den Ebenenbaum, „Objekte“ die Objektliste, „Auswahl“ die Inspectors. Die gewählte
Ansicht „Ebenen“ oder „Objekte“ SHALL je Gerät gemerkt werden, Vorgabe „Ebenen“. Die gerade nicht
gezeigten Ansichten MUST ihren Zustand (Suchbegriffe, Filter, Klappzustand, Entwürfe) und ihre
Rollposition behalten. Ein Sprung zu einem Ort (`?ort=`) MUST auf „Objekte“ wechseln; eine offene
Auswahl bleibt dabei bestehen. Der Kartenknopf „Zeichenwerkzeuge“ MUST weder die Ansicht noch die
Sichtbarkeit der Leiste ändern.

#### Scenario: Wahl übersteht das Neuladen
- **WHEN** die Ansicht „Objekte“ gewählt und die Seite neu geladen wird
- **THEN** zeigt die Leiste die Ansicht „Objekte“

#### Scenario: Suchbegriff übersteht den Ansichtswechsel
- **WHEN** in „Objekte“ ein Suchbegriff steht und auf „Ebenen“ und zurück auf „Objekte“ gewechselt wird
- **THEN** steht der Suchbegriff noch im Feld

#### Scenario: Segmente im Handschuh
- **WHEN** bei 1280 px die Dichtestufe `handschuh` gewählt und ein Objekt ausgewählt ist
- **THEN** stehen alle drei Segmente in einer Zeile der 300 px breiten Leiste und sind mindestens 72 px hoch und breit

#### Scenario: Zeichenwerkzeuge lassen die Leiste stehen
- **WHEN** bei 1440 px die Ansicht „Ebenen“ vorn steht und „Zeichenwerkzeuge“ getippt wird
- **THEN** steht das Werkzeugmenü an der Karte, und die Leiste zeigt weiter „Ebenen“

### Requirement: Ebenen stehen in einem gruppierten, einklappbaren Ebenenbaum
Die Ansicht „Ebenen“ SHALL jede Ebene der Karte in einer festen Gruppe führen: Kräfte (Einheiten,
Fahrzeuge, Personal, Abschnitte, Bereitstellungsräume), Lage (Einsatzort, Führungsstelle, Zonen,
Schäden, Lagemeldungen, Taktische Zeichen), Betroffene & Versorgung (Betroffene, UHS,
Betreuungsstellen, Tiere), Fachebenen mit den Untergruppen Warnungen, Wasser, Umwelt sowie
Verkehr & Infrastruktur, und Hintergrund mit den Untergruppen Kartengrundlage und Bild-Hintergründe. Jede
Ebene MUST in genau einer Gruppe stehen. Der Gruppenkopf MUST den Namen und die Zahl
eingeschalteter zu allen Ebenen der Gruppe zeigen und klappt die Gruppe. Der Klappzustand SHALL je
Gerät gemerkt werden; Vorgabe: Kräfte und Lage offen, die übrigen Gruppen zu, die Untergruppen
Warnungen, Kartengrundlage und Bild-Hintergründe offen. Eine Gruppe, die einen Fehler meldet,
MUST offen stehen. Bei 1440 × 900 MUST die Leiste ohne Rollen bedienbar sein, wenn alle Gruppen
bis auf eine zu sind.

#### Scenario: Vorgabe beim ersten Öffnen
- **WHEN** die Lagekarte auf einem Gerät ohne gemerkten Klappzustand geöffnet wird
- **THEN** sind „Kräfte“ und „Lage“ offen und „Betroffene & Versorgung“, „Fachebenen“ und „Hintergrund“ zu

#### Scenario: Eine Gruppe offen bei 1440 × 900
- **WHEN** bei 1440 × 900 genau eine der fünf Gruppen offen ist
- **THEN** rollt die Leiste nicht

### Requirement: Eigene und Fachebenen haben dieselbe Zeilenform
Jede eigene Ebene und jede Fachebene SHALL eine Zeile sein, die selbst der Schalter ist (Rolle
`switch`, zugänglicher Name = Ebenenname, Zustand über `aria-checked`), ohne zweiten Schalter
daneben. Die Zeile MUST Farbfeld, Namen und rechts die Zahl bzw. ein Zustandswort zeigen; eine
ausgefallene Quelle zeigt „—“ statt einer Zahl. Fachebenen MUST unter dem Namen ihren
Geltungshinweis und eingeschaltet ihren Stand tragen, beides als Teil der Zeile vorlesbar; ihre
Zustandswörter sind „lädt“, „offline“, „keine Daten“ und „näher heranzoomen“. Eine Ebene mit
Klassenfarben MUST eingeschaltet ihre Legende unter der Zeile zeigen. Gesperrte Ebenen MUST aus
bleiben und ihren Grund nennen. Im Handschuh MUST der Name umbrechen statt gekürzt zu werden.

#### Scenario: Fachebene schalten
- **WHEN** in der Untergruppe „Warnungen“ die Zeile „Wetterwarnungen (DWD)“ angetippt wird
- **THEN** wechselt ihr `aria-checked` auf `true`, und nach dem Laden steht ihr Stand unter dem Namen

#### Scenario: Quelle ausgefallen
- **WHEN** die Marker der Lagekarte nicht geladen werden konnten
- **THEN** zeigt die Zeile „Einheiten“ „—“ und keine 0

### Requirement: Gruppenschalter schaltet alle frei zugänglichen Ebenen einer Gruppe
Die Gruppen Kräfte, Lage und Betroffene & Versorgung sowie jede Untergruppe der Fachebenen SHALL
neben dem Klappkopf einen eigenen Gruppenschalter tragen (Rolle `checkbox`, Name „<Gruppe>: alle
Ebenen“, `aria-checked` `true`, `false` oder `mixed`). Ein Tipp bei aus oder teilweise MUST alle
frei zugänglichen Ebenen der Gruppe einschalten, bei an alle ausschalten. Gesperrte Ebenen MUST
dabei aus bleiben und zählen für den Zustand nicht mit. Eine Gruppe ohne frei zugängliche Ebene
MUST keinen Gruppenschalter tragen. „Fachebenen“ als Ganzes und „Hintergrund“ MUST keinen
Gruppenschalter tragen.

#### Scenario: Teilweise an
- **WHEN** in „Lage“ nur „Zonen“ aus ist und der Gruppenschalter getippt wird
- **THEN** sind alle Ebenen der Gruppe an, und der Gruppenschalter steht auf `true`

#### Scenario: Gesperrte Ebene bleibt aus
- **WHEN** „Betroffene“ wegen der Modulfreigabe gesperrt ist und der Gruppenschalter von „Betroffene & Versorgung“ getippt wird
- **THEN** sind die übrigen frei zugänglichen Ebenen der Gruppe an, und „Betroffene“ bleibt aus und nennt den Grund

### Requirement: Ebene suchen
Über dem Baum SHALL ein Feld „Ebene suchen“ stehen. Ein Begriff MUST die Ebenen zeigen, deren Name
oder deren Gruppenname ihn enthält, ohne Rücksicht auf Groß- und Kleinschreibung. Gruppen mit
Treffern MUST offen stehen, ohne den gemerkten Klappzustand zu ändern. Ohne Treffer MUST genau ein
Leerzustand mit dem Begriff stehen.

#### Scenario: Treffer in einer zugeklappten Gruppe
- **WHEN** „Betroffene & Versorgung“ zu ist und „uhs“ gesucht wird
- **THEN** steht die Gruppe offen und zeigt nur „UHS“, und nach Leeren des Felds ist sie wieder zu

#### Scenario: Kein Treffer
- **WHEN** „xyz“ gesucht wird
- **THEN** steht „Keine Ebene zu „xyz““ und keine Gruppe

### Requirement: Kartenansicht steht im Kopf der Ebenen
Die Wahl der Kartenansicht (gespeicherte Ansichten, „In dieser Ansicht speichern“ und die Gründe
eines abgelehnten Speicherversuchs) SHALL im Kopf der Ansicht „Ebenen“ über dem Feld „Ebene
suchen“ stehen, nicht als Paneel zwischen den Ebenen. Steht „Objekte“ vorn oder ist die Leiste
ausgeblendet, MUST ein abgelehnter Speicherversuch seine Gründe als Kartenhinweis zeigen.

#### Scenario: Ablehnung bei verdeckter Ebenen-Ansicht
- **WHEN** „Objekte“ vorn steht und das Speichern einer Ansicht abgelehnt wird
- **THEN** stehen die Gründe im Kartenhinweis, und nach dem Wechsel auf „Ebenen“ stehen sie im Kopf der Ebenen

### Requirement: Modus-Band trägt ab lg die Bedienung der Leistenmodi
Ab `lg` SHALL ein Modus-Band direkt unter der Segmentleiste die ganze Bedienung des laufenden
Leistenmodus tragen: Platzieren (Titel, Koordinate, „Übernehmen“, „Abbrechen“), Taktisches Zeichen
(„Weitere platzieren“, Zähler, „Fertig“ bzw. „Abbrechen“), Bild einpassen (Griffwahl, Mittelpunkt,
„Fertig“) und die Rückmeldung nach dem Verorten. Das Band MUST in allen Ansichten gleich stehen.
Die Zeile des Ziels in den Ansichten MUST nur den Zustand zeigen („wird platziert“, „wird
eingepasst“). Je Breite MUST es genau einen Knopf je Handlung geben.

#### Scenario: Abbrechen aus der anderen Ansicht
- **WHEN** bei 1440 px aus der Objektliste ein Platzieren gestartet und auf „Ebenen“ gewechselt wird
- **THEN** steht genau ein „Abbrechen“ im Modus-Band, und ein Tipp darauf beendet das Platzieren

#### Scenario: Bild einpassen ab lg
- **WHEN** bei 1440 px ein Bild eingepasst wird
- **THEN** stehen Griffwahl, Mittelpunkt und „Fertig“ im Modus-Band, und die Bildzeile zeigt „wird eingepasst“

### Requirement: Auswahl als eigene Ansicht
Solange auf der Karte etwas ausgewählt ist, SHALL die Segmentleiste ein drittes Segment „Auswahl“
im freien Drittel tragen; ohne Auswahl MUST es fehlen, ohne dass „Ebenen“ und „Objekte“ ihre Lage
ändern. Eine neue Auswahl (Marker, Listenzeile, Zone, Fachebenen-Objekt) SHALL die Leiste auf
„Auswahl“ schalten und die Inspectors von oben zeigen; unter `lg` MUST sie die Leiste öffnen, auch
im Kartenmodus. Wählt die Person bei bestehender Auswahl „Ebenen“ oder „Objekte“, MUST die Auswahl
bestehen bleiben; das Segment „Auswahl“ führt zu ihr zurück. Die Ansicht „Auswahl“ MUST nie
gemerkt werden: nach dem Neuladen gibt es keine Auswahl und kein Segment.

#### Scenario: Marker gewählt
- **WHEN** bei 1440 px die Ansicht „Ebenen“ offen ist und die Person einen Einheiten-Marker antippt
- **THEN** zeigt die Leiste die Ansicht „Auswahl“ mit dem Inspector der Einheit und oben „← Ebenen“

#### Scenario: Ebene neben der Auswahl schalten
- **WHEN** eine Einheit ausgewählt ist und die Person „Ebenen“ wählt und dort „Zonen“ ausschaltet
- **THEN** bleibt die Einheit ausgewählt, und das Segment „Auswahl“ führt zu ihrem Inspector zurück

#### Scenario: Auswahl am Handschirm
- **WHEN** bei 390 px die Leiste geschlossen ist und die Person einen Marker antippt
- **THEN** ist die Leiste offen, und der Inspector steht ohne Rollen sichtbar oben in der Leiste

### Requirement: Rückweg aus der Auswahl
Der Kopf der Ansicht „Auswahl“ SHALL einen Rückweg tragen, der die gemerkte Ansicht benennt
(„← Ebenen“ bzw. „← Objekte“); er MUST die Auswahl aufheben und diese Ansicht mit Suchbegriff,
Filter, Klappzustand und Rollposition zeigen. Esc MUST genauso wirken, außer ein Kartenmodus mit
eigener Esc-Stufe läuft (Zone oder Fläche zeichnen, Kreis, Messen), ein Menü oder Dialog ist offen
oder der Fokus steht in einem Eingabefeld; dann trägt der Rückweg auch keine Tastenkappe. Ist ein
Bündel der Karte aufgefächert, MUST Esc zuerst das Bündel einklappen, erst die nächste Taste die
Auswahl aufheben. Eine Taste MUST genau eine Stufe wirken.

#### Scenario: Rückweg mit Suchbegriff
- **WHEN** in „Objekte“ der Begriff „83“ steht, die Person einen Treffer wählt und dann „← Objekte“ tippt
- **THEN** ist nichts mehr ausgewählt, und die Objekte-Ansicht zeigt den Begriff „83“ mit seinen Treffern

#### Scenario: Esc beim Zeichnen
- **WHEN** eine Zone gezeichnet wird, ein Marker ausgewählt ist und Esc gedrückt wird
- **THEN** greift die erste Esc-Stufe des Zeichnens, und die Auswahl bleibt

#### Scenario: Esc mit offenem Bündel
- **WHEN** eine Einheit ausgewählt und ein Bündel aufgefächert ist und Esc zweimal gedrückt wird
- **THEN** klappt die erste Taste das Bündel ein, die zweite hebt die Auswahl auf

### Requirement: „Nicht verortet“ ist ein Filter der Objektliste
Die Liste „Nicht verortet“ SHALL die Objektliste der Ansicht „Objekte“ mit gesetztem Filter
„nur nicht verortet“ sein; eine eigene Liste daneben MUST es nicht geben. Die Marke „Nicht
verortet“ unter dem Suchfeld SHALL die Zahl der nicht verorteten Objekte nennen (der Einsatzort
ohne Koordinate eingeschlossen) und den Filter setzen und aufheben; bei 0 MUST „Alles verortet“
stehen, bei ausgefallener Lagebild-Quelle „—“ statt einer Zahl.

#### Scenario: Marke setzt den Filter
- **WHEN** im Demo-Einsatz 26 Objekte nicht verortet sind und die Person die Marke „Nicht verortet 26“ tippt
- **THEN** zeigt die Liste nur die 26 nicht verorteten Objekte, und die Marke ist als gedrückt ausgewiesen

#### Scenario: Quelle ausgefallen
- **WHEN** eine Lagebild-Quelle nicht geladen werden konnte
- **THEN** zeigt die Marke „—“ statt einer Zahl, und nirgends steht „Alles verortet“

### Requirement: Die Leiste trägt keinen Zeichenweg
Die Kartenleiste MUST keinen Start für Zonen, Linien, freie Skizzen oder Taktische Zeichen
tragen; gezeichnet wird über das Werkzeugmenü an der Karte (Spec `lagekarte-zeichnen`). Ausnahme
ist „Fläche zeichnen“ an einem nicht verorteten Abschnitt der Objektliste: das verortet ein
Objekt, es zeichnet keine neue Figur. Die Modusbedienung eines laufenden Taktischen Zeichens
bleibt ab `lg` im Modus-Band der Leiste.

#### Scenario: Keine Zeichenknöpfe in der Leiste
- **WHEN** eine Person mit Schreibrecht die Leiste in jeder Ansicht durchsieht
- **THEN** findet sie keinen Knopf „Gefahrengebiet“ oder „Gefahrengebiet zeichnen“, keinen Knopf „Taktisches Zeichen platzieren“ und kein Paneel „Zeichnen“

#### Scenario: Taktisches Zeichen ab lg
- **WHEN** bei 1440 px über das Werkzeugmenü ein Taktisches Zeichen gewählt wird
- **THEN** steht seine Bedienung („Weitere platzieren“, Zähler, „Fertig“ bzw. „Abbrechen“) im Modus-Band der Leiste und nirgends sonst
