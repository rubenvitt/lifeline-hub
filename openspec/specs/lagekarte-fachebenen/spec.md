# lagekarte-fachebenen Specification

## Purpose

Externe Lagedaten-Ebenen der Lagekarte: amtliche und offene Fremdquellen, die das
Backend abruft, vereinheitlicht und der Karte als zuschaltbare Ebenen bereitstellt —
bisher das Strahlungs-/ODL-Messnetz des Bundesamts für Strahlenschutz und die
KRITIS-Objekte aus einem OpenStreetMap-Extrakt für Deutschland.

## Requirements

### Requirement: ODL-Sonden sind als Fachebene abrufbar
Das System SHALL unter `GET /api/karte/fachebenen/odl` die ortsfesten Sonden des
ODL-Messnetzes des Bundesamts für Strahlenschutz als GeoJSON-`FeatureCollection` von
Punkten im einheitlichen Fachebenen-Umschlag (`quelle`, `status`, `attribution`, `stand`,
`features`) liefern. Jedes Feature MUST mindestens Kennung, Standortname, Messwert in
µSv/h (oder dessen Fehlen), Messende, Betriebsstatus der Sonde und die Bewertungsstufe
tragen. Die Route MUST keinen `bbox`-Parameter verlangen.

#### Scenario: Sonden mit Messwert werden ausgeliefert
- **WHEN** ein angemeldeter Benutzer `GET /api/karte/fachebenen/odl` aufruft und die Quelle erreichbar ist
- **THEN** antwortet das System mit HTTP 200, `quelle: "odl"`, `status: "ok"` und je Sonde einem Punkt-Feature mit Messwert, Einheit µSv/h, Messende und Bewertungsstufe

#### Scenario: Sonde ohne Messwert bleibt enthalten
- **WHEN** die Quelle eine Sonde als defekt oder im Testbetrieb und ohne Messwert meldet
- **THEN** ist die Sonde als Feature enthalten, ihr Messwert fehlt, ihr Betriebsstatus ist benannt und ihre Stufe ist `keine_messung`

### Requirement: Bewertungsstufe nach festen Bändern
Das System SHALL jeder Sonde, für die **kein** Standort-Grundpegel vorliegt, genau eine
Stufe aus diesen Bändern zuweisen: `keine_messung` (kein Messwert), `normal` (Messwert
≤ 0,2 µSv/h), `erhoeht` (0,2 < Messwert ≤ 0,6 µSv/h), `stark_erhoeht` (Messwert
> 0,6 µSv/h). Die Stufenwörter sind Teil der Schnittstelle und MUST unverändert bleiben —
gleich, ob die Stufe aus diesen Bändern oder aus dem Standort-Grundpegel stammt.

#### Scenario: Grenzwerte werden der unteren Stufe zugeschlagen
- **WHEN** eine Sonde ohne Grundpegel genau 0,2 µSv/h bzw. genau 0,6 µSv/h meldet
- **THEN** trägt sie die Stufe `normal` bzw. `erhoeht`

#### Scenario: Werte oberhalb der Bänder
- **WHEN** eine Sonde ohne Grundpegel 0,21 µSv/h bzw. 0,61 µSv/h meldet
- **THEN** trägt sie die Stufe `erhoeht` bzw. `stark_erhoeht`

#### Scenario: Kaltstart ohne Grundpegel
- **WHEN** für noch keine Sonde ein Grundpegel berechnet wurde (erster Start, Zeitreihe nicht erreichbar)
- **THEN** tragen alle Sonden ihre Stufe nach diesen Bändern und die Grundlage `absolut`

### Requirement: Die Einteilung gibt sich als Projekt-Einteilung zu erkennen
Das System MUST überall dort, wo es eine Sonde als „erhöht" bezeichnet, erkennbar machen,
dass die Einteilung eine Einteilung des Lifeline Hub ist und kein amtlicher Schwellenwert
des BfS, und MUST dabei die für diese Sonde **geltende** Grundlage nennen: bei
standortbezogener Bewertung die Faktor-Schwellen zum Grundpegel der Sonde, bei absoluter
Bewertung die Bänder auf Grundlage des vom BfS genannten natürlichen Bereichs
(0,05–0,2 µSv/h). Die Beschriftung der Stufen MUST für beide Grundlagen zutreffen und
darf deshalb keinen der beiden Maßstäbe nennen. Die Quellendokumentation MUST dasselbe
festhalten.

#### Scenario: Hinweis im Inspector
- **WHEN** ein Benutzer auf der Lagekarte eine ODL-Sonde mit Grundpegel anwählt
- **THEN** zeigt der Inspector Messwert, Messende, Stufe als Wort, Grundpegel in µSv/h samt Stand, Faktor und einen sichtbaren Hinweis, dass die Faktor-Schwellen eine Einteilung des Lifeline Hub und keine BfS-Schwelle sind

#### Scenario: Hinweis im Inspector bei absoluter Bewertung
- **WHEN** ein Benutzer eine ODL-Sonde ohne Grundpegel anwählt
- **THEN** zeigt der Inspector Messwert, Messende, Stufe als Wort, den Hinweis, dass für diese Sonde noch kein Grundpegel vorliegt, und den Hinweis, dass die Bänder am natürlichen Bereich keine BfS-Schwelle sind

### Requirement: Stufe ist nicht allein über die Farbe erkennbar
Die Lagekarte SHALL die Stufe einer Sonde über die Farbrolle des Statusfarb-Vertrags
(`keine_messung` neutral, `normal` normal, `erhoeht` achtung, `stark_erhoeht` alarm)
UND über einen je Stufe verschiedenen Punktdurchmesser darstellen, der mit der Stufe
wächst.

#### Scenario: Erhöhte Sonde sticht heraus
- **WHEN** die Ebene sichtbar ist und eine Sonde die Stufe `stark_erhoeht` trägt
- **THEN** ist ihr Punkt in der Alarm-Rollenfarbe und größer als der Punkt jeder Sonde mit niedrigerer Stufe

### Requirement: Ausfall der Quelle bricht die Karte nicht
Ist die BfS-Quelle nicht erreichbar oder liefert sie Unbrauchbares, SHALL das System mit
HTTP 200 und `status: "offline"` bei leerer Collection antworten, sofern kein
zwischengespeicherter Stand vorliegt; liegt einer vor, SHALL es diesen ausliefern. Das
System MUST dabei keinen 5xx-Fehler liefern.

#### Scenario: Quelle weg, kein Cache
- **WHEN** der BfS-Dienst nicht antwortet und noch kein Stand zwischengespeichert ist
- **THEN** antwortet die Route mit HTTP 200, `status: "offline"` und leerer Collection, und das Panel zeigt die Ebene als offline

#### Scenario: Quelle weg, alter Stand vorhanden
- **WHEN** der BfS-Dienst nicht antwortet, aber ein früher gespeicherter Stand vorliegt
- **THEN** liefert die Route diesen Stand aus

### Requirement: Quellennennung
Solange die ODL-Ebene sichtbar und nicht offline ist, SHALL die Kartenattribution
„Bundesamt für Strahlenschutz (BfS)" samt Lizenzkennung der Datenlizenz Deutschland –
Namensnennung 2.0 nennen.

#### Scenario: Attribution bei sichtbarer Ebene
- **WHEN** ein Benutzer die ODL-Ebene zuschaltet und Daten geladen sind
- **THEN** erscheint die BfS-Quellennennung in der Kartenattribution

### Requirement: Sichtbarkeit der Ebene wird gespeichert
Das Panel SHALL die ODL-Ebene als zuschaltbare Fachebene mit sichtbarem Geltungshinweis
anbieten (nur ortsfeste BfS-Sonden, Stundenwerte). Ihre Sichtbarkeit SHALL wie bei den
übrigen Fachebenen gespeichert werden; ein vor dieser Änderung gespeicherter Stand ohne
Angabe zur ODL-Ebene MUST als „aus" gelesen werden.

#### Scenario: Alter gespeicherter Stand
- **WHEN** eine Kartenansicht geladen wird, deren gespeicherte Fachebenen-Sichtbarkeit den Schlüssel `odl` nicht kennt
- **THEN** ist die ODL-Ebene ausgeschaltet und die übrigen Ebenen behalten ihren gespeicherten Zustand

#### Scenario: Zuschalten überlebt Neuladen
- **WHEN** ein Benutzer die ODL-Ebene zuschaltet und die Ansicht speichert
- **THEN** ist die Ebene nach dem Neuladen wieder zugeschaltet

### Requirement: KRITIS-Objekte sind bundesweit aus einem eigenen Bestand abrufbar
Das System SHALL unter `GET /api/karte/fachebenen/kritis?bbox=west,sued,ost,nord` die
KRITIS-Objekte im Ausschnitt als GeoJSON-`FeatureCollection` von Punkten im einheitlichen
Fachebenen-Umschlag (`quelle`, `status`, `attribution`, `stand`, `features`) liefern. Die
Antwort MUST aus einem im System gehaltenen Bestand stammen, der aus einem
OpenStreetMap-Extrakt für Deutschland gewonnen wurde; eine Anfrage an die Route MUST
keinen Abruf bei einem externen Dienst auslösen. Jede gültige bbox MUST angenommen
werden, auch eine, die ganz Deutschland umfasst. Einzelobjekte MUST die Properties
`titel`, `kategorie` und — soweit in OSM vorhanden — `adresse`, `betreiber`, `telefon`,
`website` und `notaufnahme` tragen; `kategorie` MUST eines der Wörter `krankenhaus`,
`pflege`, `schule`, `wasser`, `strom`, `feuerwehr`, `polizei` oder `kritis` sein.

#### Scenario: Ausschnitt einer Stadt
- **WHEN** ein angemeldeter Benutzer die Route mit der bbox einer Stadt aufruft und ein Bestand vorliegt
- **THEN** antwortet das System mit HTTP 200, `quelle: "kritis"`, `status: "ok"` und je KRITIS-Objekt im Ausschnitt einem Punkt-Feature mit Kategorie und Titel

#### Scenario: Ganz Deutschland im Ausschnitt
- **WHEN** die Route mit einer bbox aufgerufen wird, die ganz Deutschland umfasst
- **THEN** antwortet das System mit HTTP 200 und einem Ergebnis, statt die bbox als zu groß abzulehnen

#### Scenario: Ausschnitt ohne Objekte
- **WHEN** die bbox ausschließlich außerhalb Deutschlands liegt
- **THEN** antwortet das System mit HTTP 200, `status: "leer"` und leerer Collection

#### Scenario: Ungültige bbox
- **WHEN** die bbox fehlt, nicht aus vier Zahlen besteht, vertauschte Grenzen hat oder außerhalb des Koordinatenbereichs liegt
- **THEN** antwortet das System mit HTTP 400

### Requirement: Viele Objekte werden serverseitig verdichtet
Eine KRITIS-Antwort MUST höchstens 5 000 Features enthalten. Liegen im Ausschnitt mehr
Objekte, SHALL das System Sammelpunkte liefern: je Zelle eines festen, vom Ausschnitt
unabhängig verankerten Rasters ein Punkt mit den Properties `sammelpunkt: true` und
`anzahl` (Zahl der zusammengefassten Objekte). Eine Zelle wird immer ganz gezählt, auch
wenn sie nur teilweise im Ausschnitt liegt; die Summe aller `anzahl`-Werte MUST der Zahl
der Objekte in diesen Zellen entsprechen. Zwei Ausschnitte, die sich überlappen und
dieselbe Rasterweite ergeben, MUST für dieselbe Rasterzelle denselben Sammelpunkt liefern.

#### Scenario: Deutschland-Ansicht
- **WHEN** die bbox ganz Deutschland umfasst und der Bestand mehr als 5 000 Objekte hat
- **THEN** besteht die Antwort aus höchstens 5 000 Sammelpunkten, deren `anzahl` sich zur Zahl der Objekte in den berührten Rasterzellen summiert

#### Scenario: Wenige Objekte
- **WHEN** der Ausschnitt höchstens 5 000 Objekte enthält
- **THEN** besteht die Antwort ausschließlich aus Einzelobjekten ohne `sammelpunkt`

### Requirement: Der Bestand wird periodisch aus dem OSM-Extrakt erneuert
Das System SHALL den KRITIS-Bestand in einem konfigurierbaren Abstand (Vorgabe: 7 Tage)
aus dem Deutschland-Extrakt erneuern und beim Start erneuern, wenn noch kein Bestand
vorliegt oder der vorhandene älter als dieser Abstand ist. Die Erneuerung MUST im
Hintergrund laufen und darf weder den Serverstart noch Anfragen blockieren. Die Quelle
(Extrakt-URL) MUST konfigurierbar sein. Solange ein Lauf nicht vollständig gelungen ist,
MUST der vorherige Bestand unverändert ausgeliefert werden; ein Lauf, dessen Extrakt
seit dem letzten Import unverändert ist, MUST den Extrakt nicht erneut herunterladen.

#### Scenario: Abgebrochener Lauf
- **WHEN** ein Erneuerungslauf beim Herunterladen oder Einlesen scheitert
- **THEN** liefert die Route weiterhin den vorherigen Bestand mit dessen `stand`, und der nächste Lauf versucht es erneut

#### Scenario: Unveränderter Extrakt
- **WHEN** der Lauf fällig ist, der Extrakt aber seit dem letzten Import nicht neu erschienen ist
- **THEN** wird kein Extrakt heruntergeladen und der Bestand bleibt unverändert

### Requirement: Der Import ist Default-an und abschaltbar
Der periodische Import SHALL in jeder Instanz ohne ausdrückliche Konfiguration aktiv sein,
auch im Entwicklungsbetrieb. Er MUST per Konfigurationsschalter (Kommandozeile und
Umgebungsvariable) abschaltbar sein; abgeschaltet MUST das System keinen Extrakt
herunterladen. Die automatisierte Browser-Testsuite MUST das Backend mit abgeschaltetem
Import starten. Der Zustand des Schalters MUST beim Start protokolliert werden.

#### Scenario: Abgeschalteter Import
- **WHEN** das Backend mit abgeschaltetem Import startet
- **THEN** findet kein Download statt, und die KRITIS-Route antwortet ohne vorhandenen Bestand mit `status: "offline"`

### Requirement: Stand und Offline-Verhalten der KRITIS-Ebene
Liegt ein Bestand vor, MUST `stand` den Datenstand des zugrunde liegenden Extrakts
nennen, nicht den Zeitpunkt der Anfrage. Liegt kein Bestand vor (Import läuft noch zum
ersten Mal, ist gescheitert oder abgeschaltet), SHALL die Route mit HTTP 200,
`status: "offline"` und leerer Collection antworten und MUST keinen 5xx-Fehler liefern.

#### Scenario: Erster Start
- **WHEN** die Instanz zum ersten Mal läuft und der erste Import noch nicht abgeschlossen ist
- **THEN** zeigt das Panel die KRITIS-Ebene als offline, und sobald der Import fertig ist, erscheinen die Objekte ohne Neuladen der Seite

### Requirement: KRITIS-Punkte werden auf der Karte gebündelt
Die Lagekarte SHALL nahe beieinanderliegende KRITIS-Punkte und vom Server gelieferte
Sammelpunkte zu Bündeln zusammenfassen, die ihre Gesamtzahl als Text tragen; die Zahl
eines Bündels MUST die `anzahl` enthaltener Sammelpunkte mitzählen. Die Ebene MUST in
jeder Zoomstufe angefragt werden, auch auf Deutschland-Ebene. Ein Klick auf ein Bündel
oder einen Sammelpunkt MUST in dessen Gebiet hineinzoomen; ein Klick auf ein Einzelobjekt
MUST wie bisher dessen Detailansicht mit Kategorie, Titel und vorhandenen Kontaktangaben
öffnen.

#### Scenario: Rauszoomen auf Deutschland
- **WHEN** die KRITIS-Ebene sichtbar ist und der Benutzer auf ganz Deutschland herauszoomt
- **THEN** zeigt die Karte Bündel mit Zahlen statt eines Hinweises „näher heranzoomen", und die Karte bleibt bedienbar

#### Scenario: Klick auf ein Bündel
- **WHEN** der Benutzer ein Bündel anklickt
- **THEN** zoomt die Karte in das Gebiet des Bündels hinein, ohne eine Detailansicht zu öffnen

#### Scenario: Klick auf ein Einzelobjekt
- **WHEN** der Benutzer ein einzelnes Krankenhaus anklickt
- **THEN** öffnet sich die Detailansicht mit Titel, Kategorie „Krankenhaus" und vorhandener Adresse

### Requirement: Quellennennung der KRITIS-Ebene
Solange die KRITIS-Ebene sichtbar und nicht offline ist, SHALL die Kartenattribution
„© OpenStreetMap-Beitragende (ODbL)" nennen. Die Quellendokumentation MUST Herkunft des
Extrakts, Erneuerungsabstand, Abschaltbarkeit und Lizenz nennen.

#### Scenario: Attribution bei sichtbarer Ebene
- **WHEN** ein Benutzer die KRITIS-Ebene zuschaltet und Daten geladen sind
- **THEN** erscheint „© OpenStreetMap-Beitragende (ODbL)" in der Kartenattribution

### Requirement: Bewertungsstufe nach Standort-Grundpegel
Liegt für eine Sonde mit Messwert in µSv/h ein Standort-Grundpegel vor, SHALL das System
ihre Stufe aus dem Faktor Messwert ÷ Grundpegel bilden: `normal` (Faktor ≤ 1,5),
`erhoeht` (1,5 < Faktor ≤ 3), `stark_erhoeht` (Faktor > 3). Eine Sonde ohne Messwert
MUST weiterhin `keine_messung` tragen. Der Grundpegel einer Sonde SHALL aus ihren
Stundenwerten der letzten sieben Tage laut BfS-Zeitreihe gebildet werden (unteres
Quartil) und MUST nur gebildet werden, wenn mindestens 20 solcher Werte vorliegen.

#### Scenario: Verdreifachung an einer Sonde mit niedrigem Grundpegel
- **WHEN** eine Sonde mit Grundpegel 0,06 µSv/h 0,19 µSv/h meldet
- **THEN** trägt sie die Stufe `stark_erhoeht`, obwohl der Messwert im natürlichen Bereich liegt

#### Scenario: Regen an einer Sonde mit hohem Grundpegel
- **WHEN** eine Sonde mit Grundpegel 0,2 µSv/h 0,28 µSv/h meldet
- **THEN** trägt sie die Stufe `normal`, obwohl der Messwert über 0,2 µSv/h liegt

#### Scenario: Faktor-Grenzen werden der unteren Stufe zugeschlagen
- **WHEN** eine Sonde mit Grundpegel 0,1 µSv/h genau 0,15 µSv/h bzw. genau 0,3 µSv/h meldet
- **THEN** trägt sie die Stufe `normal` bzw. `erhoeht`

#### Scenario: Zu wenig Historie
- **WHEN** die Zeitreihe für eine Sonde weniger als 20 Stundenwerte enthält
- **THEN** erhält die Sonde keinen Grundpegel und wird nach den festen Bändern bewertet

### Requirement: Features nennen die Grundlage ihrer Stufe
Jedes ODL-Feature SHALL die Grundlage seiner Stufe als Wire-Wort tragen: `standort`, wenn
die Stufe aus dem Grundpegel stammt, sonst `absolut`. Bei `standort` MUST das Feature
zusätzlich den Grundpegel in µSv/h, den Faktor und den Zeitpunkt der Grundpegel-Berechnung
tragen; bei `absolut` MUST diese Angaben fehlen statt als `null` zu erscheinen. Die
Grundlagen-Wörter sind Teil der Schnittstelle und MUST beidseitig gepinnt sein.

#### Scenario: Sonde mit Grundpegel
- **WHEN** die Route `GET /api/karte/fachebenen/odl` eine Sonde mit Grundpegel und Messwert ausliefert
- **THEN** trägt das Feature `bewertung: "standort"`, den Grundpegel, den Faktor und den Stand des Grundpegels

#### Scenario: Sonde ohne Grundpegel
- **WHEN** die Route eine Sonde ohne Grundpegel ausliefert
- **THEN** trägt das Feature `bewertung: "absolut"` und weder Grundpegel noch Faktor noch Stand

### Requirement: Der Grundpegel wandert nicht in eine Lage hinein mit
Das System SHALL den Grundpegel einer Sonde höchstens einmal täglich neu berechnen. Würde
eine Neuberechnung den bisher gespeicherten Grundpegel einer Sonde auf das 1,5-Fache oder
mehr anheben, MUST das System die Neuberechnung für diese Sonde verwerfen und den bisherigen
Grundpegel samt seinem Stand beibehalten — höchstens 14 Tage über diesen Stand hinaus; danach
SHALL die Neuberechnung übernommen werden.

#### Scenario: Mehrtägige Erhöhung
- **WHEN** eine Sonde mit gespeichertem Grundpegel 0,1 µSv/h über mehrere Tage erhöht misst und die Neuberechnung 0,16 µSv/h ergäbe
- **THEN** bleibt ihr Grundpegel 0,1 µSv/h mit dem bisherigen Stand, und der Faktor wird weiter gegen 0,1 µSv/h gebildet

#### Scenario: Gehaltener Grundpegel nach 14 Tagen
- **WHEN** ein Grundpegel seit 14 Tagen gegen höhere Neuberechnungen gehalten wird
- **THEN** übernimmt das System die nächste Neuberechnung mit neuem Stand

#### Scenario: Leichte Verschiebung des Grundpegels
- **WHEN** die Neuberechnung für eine Sonde mit gespeichertem Grundpegel 0,1 µSv/h 0,12 µSv/h ergibt
- **THEN** übernimmt das System 0,12 µSv/h mit neuem Stand

### Requirement: Ausfall der Zeitreihe bricht die Ebene nicht
Die Berechnung des Grundpegels SHALL die Auslieferung der ODL-Ebene weder verzögern noch
verhindern: die Route MUST ihre Antwort nicht auf den Abruf der Zeitreihe warten lassen.
Ist die Zeitreihe nicht erreichbar oder unbrauchbar — dazu zählt eine Antwort, die keinen
einzigen Grundpegel oder weniger als halb so viele Sonden wie der gespeicherte Stand trägt —,
SHALL das System einen früher berechneten Grundpegel unbefristet weiterverwenden, sonst nach
den festen Bändern bewerten, und MUST dabei keinen 5xx-Fehler liefern.

#### Scenario: Zeitreihe weg beim ersten Start
- **WHEN** die ODL-Ebene zum ersten Mal abgerufen wird und die BfS-Zeitreihe nicht antwortet
- **THEN** antwortet die Route ohne auf die Zeitreihe zu warten mit den Sonden nach festen Bändern und `bewertung: "absolut"`

#### Scenario: Zeitreihe weg, alter Grundpegel vorhanden
- **WHEN** die tägliche Neuberechnung scheitert, aber ein früher berechneter Grundpegel gespeichert ist
- **THEN** werden die Sonden weiter gegen diesen Grundpegel bewertet, auch wenn die Störung länger als zwei Tage dauert

#### Scenario: Teilantwort der Zeitreihe
- **WHEN** die Zeitreihe Werte für weniger als die Hälfte der Sonden liefert, für die ein Grundpegel gespeichert ist
- **THEN** bleibt der gespeicherte Grundpegel unverändert

### Requirement: Der Umschlag nennt den Abrufzeitpunkt
Jede Antwort von `GET /api/karte/fachebenen/{quelle}` mit `status: "ok"` oder `status: "leer"`
SHALL das Feld `abgerufen` tragen: den Zeitpunkt als RFC 3339 in UTC, zu dem das System den
ausgelieferten Stand bei der Quelle geholt hat. Bei KRITIS MUST das der Zeitpunkt des letzten
gelungenen Abgleichs mit dem Extrakt sein (auch eines Laufs, der den Extrakt unverändert
vorfand). Bei einer aus mehreren Quellen zusammengesetzten Ebene MUST es der Abrufzeitpunkt
des ältesten Teils sein, für den ein Stand vorliegt. Wird ein Stand aus dem Zwischenspeicher
ausgeliefert, frisch oder veraltet, MUST `abgerufen` den Zeitpunkt des damaligen Abrufs
nennen, nicht den der Anfrage. Bei `status: "offline"` MUST das Feld fehlen, statt als `null`
zu erscheinen. Das Feld `stand` MUST davon unberührt bleiben und weiter den Datenstand der
Quelle nennen, wo eine Quelle einen liefert.

#### Scenario: Frischer Abruf
- **WHEN** ein Benutzer eine Fachebene abruft, deren Zwischenspeicher leer ist, und die Quelle antwortet
- **THEN** antwortet die Route mit HTTP 200 und einem `abgerufen`, das höchstens wenige Sekunden vor der Antwort liegt

#### Scenario: Veralteter Stand aus dem Zwischenspeicher
- **WHEN** der gespeicherte Stand einer Ebene ohne Obergrenze (etwa Hochwasser) vor 30 Stunden abgerufen wurde und die Quelle nicht erreichbar ist
- **THEN** antwortet die Route mit HTTP 200, `status: "ok"`, den gespeicherten Features und einem `abgerufen`, das 30 Stunden zurückliegt

#### Scenario: Quelle weg, nichts gespeichert
- **WHEN** die Quelle nicht erreichbar ist und kein Stand gespeichert ist
- **THEN** antwortet die Route mit HTTP 200, `status: "offline"` und ohne das Feld `abgerufen`

#### Scenario: KRITIS mit unverändertem Extrakt
- **WHEN** der letzte KRITIS-Lauf den Extrakt unverändert vorfand und deshalb nichts neu einlas
- **THEN** nennt `abgerufen` den Zeitpunkt dieses Laufs, und `stand` nennt weiter den Datenstand des Extrakts

#### Scenario: Energie mit einem älteren Teil
- **WHEN** der OSM-Teil der Energie-Ebene vor zwei Stunden und der MaStR-Teil vor 20 Stunden abgerufen wurde
- **THEN** nennt `abgerufen` den Zeitpunkt vor 20 Stunden

### Requirement: Jede sichtbare Fachebene zeigt ihr Alter ohne Detailansicht
Das Fachebenen-Panel der Lagekarte SHALL in der Zeile jeder zugeschalteten Fachebene mit
`abgerufen` den Abrufzeitpunkt als taktische Zeitangabe in Monospace mit Tabellenziffern
zeigen: nur die Uhrzeit, wenn der Abruf am selben Tag liegt, sonst Tag und Uhrzeit. Die
Angabe MUST ohne Klick, Hovern oder Aufklappen lesbar sein. Die Einstufung MUST mit der Zeit
fortschreiten, auch wenn kein neuer Abruf stattfindet. Die Zeitangabe MUST stehen, solange
die Karte Objekte aus diesem Stand zeigt — auch wenn der eigene Server zwischenzeitlich nicht
erreichbar ist und die Zeile deshalb „offline“ meldet. Eine ausgeschaltete Ebene und eine
Ebene, die der Server als `offline` ohne Stand meldet, MUST keine Zeitangabe zeigen.

#### Scenario: Stand von heute
- **WHEN** die Hochwasser-Ebene zugeschaltet ist und ihr Stand heute um 14:30 abgerufen wurde
- **THEN** zeigt ihre Zeile im Panel „Stand 1430“

#### Scenario: Stand von einem Vortag
- **WHEN** der Stand einer zugeschalteten Ebene am 29. um 14:30 abgerufen wurde und heute der 30. ist
- **THEN** zeigt ihre Zeile „Stand 291430“

#### Scenario: Quelle offline ohne Stand
- **WHEN** der Server für eine zugeschaltete Ebene `status: "offline"` ohne `abgerufen` meldet
- **THEN** zeigt ihre Zeile „offline“ und keine Zeitangabe

#### Scenario: Eigener Server nicht erreichbar
- **WHEN** eine zugeschaltete Ebene zuletzt einen Stand von 14:30 geladen hat, danach jeder Abruf am eigenen Server scheitert und die Karte die Objekte weiter zeigt
- **THEN** zeigt ihre Zeile „offline“ und „Stand 1430“, und jenseits der Schwelle zusätzlich „veraltet“

### Requirement: Ein Stand jenseits der Schwelle ist als veraltet erkennbar
Jede Fachebene SHALL eine feste Veraltungsschwelle haben, die aus dem Erneuerungstakt ihrer
Quelle abgeleitet und in der Quellendokumentation je Ebene genannt ist. Liegt `abgerufen`
einer zugeschalteten Ebene länger als diese Schwelle zurück, MUST ihre Zeile im Panel
zusätzlich das Wort „veraltet“ zeigen. Die Kennzeichnung MUST einen zweiten Kanal neben der
Farbe haben (das Wort) und MUST für Vorleser als Teil der Zeile lesbar sein. Die Ebene MUST
dabei weiter angezeigt werden und ihren Status `ok` bzw. `leer` behalten; die Kennzeichnung
ist kein neuer Fachebenen-Status. Ein Stand genau auf der Schwelle gilt noch nicht als
veraltet.

#### Scenario: Hochwasser seit zwei Tagen nicht erneuert
- **WHEN** die Hochwasser-Ebene zugeschaltet ist und ihr Stand vor 40 Stunden abgerufen wurde
- **THEN** zeigt ihre Zeile den Abrufzeitpunkt und das Wort „veraltet“, und die Pegel bleiben auf der Karte

#### Scenario: Stand innerhalb der Schwelle
- **WHEN** der Stand einer zugeschalteten Ebene jünger als ihre Schwelle ist
- **THEN** zeigt ihre Zeile nur den Abrufzeitpunkt, ohne „veraltet“

#### Scenario: Schwelle wird während der Betrachtung überschritten
- **WHEN** die Lagekarte offen ist, kein neuer Abruf gelingt und der Stand einer Ebene dabei über ihre Schwelle altert
- **THEN** erscheint „veraltet“ in ihrer Zeile spätestens eine Minute nach dem Überschreiten, ohne Neuladen der Seite

### Requirement: Der Inspector nennt den Abrufzeitpunkt der Ebene
Wählt ein Benutzer ein Objekt einer Fachebene an, SHALL der Inspector den Abrufzeitpunkt der
Ebene als volle taktische Datum-Zeit-Gruppe nennen und, jenseits der Schwelle, als veraltet
kennzeichnen. Zeitangaben der Quelle am Objekt selbst (etwa Messende oder Gültigkeit einer
Warnung) MUST daneben unverändert erhalten bleiben.

#### Scenario: Pegel mit altem Stand anwählen
- **WHEN** ein Benutzer einen Hochwasser-Pegel anwählt, dessen Ebene vor 40 Stunden abgerufen wurde
- **THEN** zeigt der Inspector die Meldeklasse, den Abrufzeitpunkt als volle DTG und den Hinweis „veraltet“

### Requirement: Die Trefffläche eines Fachebenen-Punkts folgt der Bediendichte
Jeder Punkt und jedes Bündel einer Punkt-Fachebene SHALL über eine Trefffläche anwählbar sein, deren
Durchmesser der eingestellten Dichtestufe folgt: mindestens 30 px in `kompakt`, 48 px in
`komfortabel` und 72 px in `handschuh`. Die Trefffläche MUST vom gezeichneten Kreis unabhängig sein
und MUST NOT sichtbar sein.

#### Scenario: Tipp neben einen Pegel im Handschuh-Modus
- **WHEN** die Dichtestufe `handschuh` eingestellt und die Pegel-Ebene sichtbar ist und der Mensch 30 px neben die Mitte eines Pegelpunkts tippt, wo nichts anderes gezeichnet ist
- **THEN** öffnet sich die Detailansicht dieses Pegels

#### Scenario: Jede Punkt-Fachebene ist betroffen
- **WHEN** eine beliebige Punkt-Fachebene sichtbar ist (Pegel, Hochwasser, Luftqualität, ODL, Autobahn, KRITIS, Energie)
- **THEN** ist jeder ihrer Einzelpunkte in jeder Dichtestufe über eine Trefffläche mindestens der Stufe anwählbar

#### Scenario: Tipp neben ein KRITIS-Bündel
- **WHEN** die Dichtestufe `handschuh` eingestellt ist und der Mensch innerhalb von 36 px um die Mitte eines KRITIS-Bündels, aber außerhalb des gezeichneten Kreises tippt
- **THEN** zoomt die Karte in das Bündel hinein

#### Scenario: Gegenprobe kompakt
- **WHEN** die Dichtestufe `kompakt` eingestellt ist und der Mensch 23 px neben die Mitte eines Pegelpunkts tippt, wo nichts anderes liegt
- **THEN** öffnet sich keine Detailansicht

### Requirement: Der Radius als Stufe bleibt von der Trefffläche unberührt
Trägt eine Punkt-Fachebene ihre Stufe im Punktdurchmesser (Hochwasser, Luftqualität, ODL), SHALL der
gezeichnete Durchmesser je Stufe unabhängig von der Dichtestufe gleich bleiben. Punkte verschiedener
Stufen MUST in jeder Dichtestufe verschieden groß gezeichnet sein.

#### Scenario: Zwei Hochwasser-Stufen im Handschuh-Modus
- **WHEN** die Dichtestufe `handschuh` eingestellt ist und zwei Hochwasser-Pegel mit verschiedener Stufe sichtbar sind
- **THEN** ist der Kreis der höheren Stufe größer gezeichnet als der der niedrigeren, und beide Kreise sind so groß wie in `kompakt`

### Requirement: Die Kontur eines Fachebenen-Punkts hebt sich von jedem Kartengrund ab
Jeder Punkt und jedes Bündel einer Punkt-Fachebene SHALL eine Kontur tragen, die gegen jeden
Kartengrund mindestens 3 : 1 Kontrast hält (WCAG 1.4.11), in heller und dunkler Kartendarstellung und
mit Online-, Offline- und Blindgrundlage. Die Kontur MUST unabhängig von der Farbe des Punkts sein.

#### Scenario: Gelber Punkt auf heller Karte
- **WHEN** ein Hochwasser-Pegel der Stufe Achtung auf heller Kartengrundlage gezeichnet ist
- **THEN** steht seine Kontur gegen den Kartengrund bei mindestens 3 : 1

#### Scenario: Punkt auf dunkler Karte
- **WHEN** ein Pegelpunkt auf dunkler Kartengrundlage gezeichnet ist
- **THEN** steht seine Kontur gegen den Kartengrund bei mindestens 3 : 1

### Requirement: Warnebenen liefern keinen Stand jenseits der Obergrenze
Für die Warnebenen DWD und NINA SHALL das System einen zwischengespeicherten Stand, dessen
Abruf mehr als 6 Stunden zurückliegt, nicht mehr ausliefern. Es MUST ihn wie einen fehlenden
Stand behandeln: die Quelle abrufen und, wenn das scheitert, mit HTTP 200, `status: "offline"`
und leerer Collection antworten. Jüngere Stände MUST es weiter nach dem bisherigen
Stale-Serving ausliefern. Die übrigen Fachebenen bleiben davon unberührt.

#### Scenario: Alter Warnstand, Quelle weg
- **WHEN** der gespeicherte DWD-Stand vor 7 Stunden abgerufen wurde und der DWD nicht antwortet
- **THEN** antwortet die Route mit HTTP 200, `status: "offline"`, leerer Collection und ohne `abgerufen`, und das Panel zeigt die Ebene als offline

#### Scenario: Alter Warnstand, Quelle wieder da
- **WHEN** der gespeicherte NINA-Stand vor 7 Stunden abgerufen wurde und die Quelle antwortet
- **THEN** antwortet die Route mit dem frisch abgerufenen Stand und einem `abgerufen` von jetzt

#### Scenario: Warnstand unter der Obergrenze
- **WHEN** der gespeicherte DWD-Stand vor 2 Stunden abgerufen wurde und der DWD nicht antwortet
- **THEN** liefert die Route diesen Stand mit `status: "ok"` aus, und das Panel kennzeichnet ihn als veraltet

#### Scenario: Grenze genau getroffen
- **WHEN** der gespeicherte DWD-Stand genau vor 6 Stunden abgerufen wurde
- **THEN** gilt er noch als auslieferbar

### Requirement: Abgelaufene DWD-Warnungen werden nicht ausgeliefert
Das System SHALL aus jeder Antwort der DWD-Ebene die Warnungen entfernen, deren Ende
(`EXPIRES`) zum Zeitpunkt der Antwort erreicht oder überschritten ist. Das MUST auch für einen
Stand aus dem Zwischenspeicher gelten. Eine Warnung ohne lesbares Ende MUST erhalten bleiben.
Bleibt keine Warnung übrig, MUST die Antwort `status: "leer"` tragen und ihr `abgerufen`
behalten.

#### Scenario: Abgelaufene Warnung im Zwischenspeicher
- **WHEN** der gespeicherte DWD-Stand eine Warnung mit Ende 14:00 und eine mit Ende 18:00 enthält und um 15:00 abgefragt wird
- **THEN** enthält die Antwort nur die Warnung mit Ende 18:00

#### Scenario: Ende genau jetzt
- **WHEN** eine Warnung als Ende genau den Zeitpunkt der Antwort trägt
- **THEN** ist sie nicht in der Antwort enthalten

#### Scenario: Warnung ohne Ende
- **WHEN** eine Warnung kein oder ein unlesbares `EXPIRES` trägt
- **THEN** ist sie in der Antwort enthalten

#### Scenario: Alle Warnungen abgelaufen
- **WHEN** alle Warnungen des gespeicherten Stands abgelaufen sind
- **THEN** antwortet die Route mit `status: "leer"`, leerer Collection und dem `abgerufen` des gespeicherten Stands

### Requirement: Die Lagekarte zeichnet keine abgelaufene DWD-Warnung
Die Lagekarte SHALL eine DWD-Warnung nicht mehr zeichnen, sobald ihr Ende (`EXPIRES`)
erreicht ist, auch wenn kein neuer Abruf stattgefunden hat oder der eigene Server nicht
erreichbar ist. Die Einstufung MUST spätestens eine Minute nach dem Ende greifen, ohne
Neuladen der Seite.

#### Scenario: Warnung läuft während der Betrachtung ab
- **WHEN** die DWD-Ebene sichtbar ist, eine Warnung um 14:00 endet und bis dahin kein neuer Abruf stattfindet
- **THEN** ist ihre Fläche spätestens um 14:01 nicht mehr auf der Karte

### Requirement: Angekündigte DWD-Warnungen sind auf der Karte unterscheidbar
Die Lagekarte SHALL eine DWD-Warnung, deren Beginn (`ONSET`) in der Zukunft liegt, als
angekündigt zeichnen: mit gestrichelter Kontur und einer schwächeren Fläche als eine geltende
Warnung. Die Kontur MUST der zweite Kanal neben der Deckkraft sein. Beginnt die Warnung
während der Betrachtung, MUST sie spätestens eine Minute danach wie eine geltende Warnung
gezeichnet werden. Eine Warnung ohne lesbaren Beginn MUST als geltend gelten.

#### Scenario: Warnung für heute Abend
- **WHEN** die DWD-Ebene sichtbar ist und eine Warnung um 18:00 beginnt, während es 15:00 ist
- **THEN** zeigt die Karte ihre Fläche mit gestrichelter Kontur und schwächerer Füllung

#### Scenario: Angekündigte Warnung beginnt
- **WHEN** die Karte offen bleibt und die Uhr den Beginn einer angekündigten Warnung erreicht
- **THEN** zeigt die Karte sie spätestens eine Minute danach mit durchgezogener Kontur und voller Füllung

#### Scenario: Warnung ohne Beginn
- **WHEN** eine DWD-Warnung kein lesbares `ONSET` trägt
- **THEN** zeichnet die Karte sie wie eine geltende Warnung

### Requirement: Der Inspector kennzeichnet eine angekündigte Warnung
Wählt ein Benutzer eine angekündigte DWD-Warnung an, SHALL der Inspector das Wort
„angekündigt“ und ihren Beginn als volle taktische Datum-Zeit-Gruppe zeigen. Die
Kennzeichnung MUST als Text lesbar sein und nicht allein über Farbe erkennbar.

#### Scenario: Angekündigte Warnung anwählen
- **WHEN** ein Benutzer um 15:00 eine DWD-Warnung anwählt, die um 18:00 beginnt
- **THEN** zeigt der Inspector „angekündigt“ und den Beginn als volle DTG

#### Scenario: Geltende Warnung anwählen
- **WHEN** ein Benutzer eine DWD-Warnung anwählt, deren Beginn verstrichen ist
- **THEN** zeigt der Inspector kein „angekündigt“

### Requirement: Die Schwere einer Warnung folgt dem Statusfarb-Vertrag
Der Inspector SHALL die Schwere einer DWD-Warnung mit der amtlichen DWD-Bezeichnung und der
Rolle aus dem Statusfarb-Vertrag zeigen und die Schwere einer NINA-Warnung mit den Wörtern
„Extrem“, „Schwer“, „Mäßig“ oder „Gering“ und ihrer Rolle aus dem Vertrag. „Extrem“ und
„Schwer“ MUST die Rolle `alarm` tragen, „Mäßig“ und „Gering“ die Rolle `achtung`. Keine Schwere
MUST in der Bedienfarbe (Blau) erscheinen.

#### Scenario: Geringe DWD-Warnung
- **WHEN** ein Benutzer eine DWD-Warnung mit `SEVERITY: "Minor"` anwählt
- **THEN** zeigt der Inspector „Wetterwarnung“ in der Achtung-Rolle und nichts davon in Blau

#### Scenario: Schwere NINA-Warnung
- **WHEN** ein Benutzer eine NINA-Warnung mit Schwere `Severe` anwählt
- **THEN** zeigt der Inspector „Schwer“ in der Alarm-Rolle

#### Scenario: Unbekannte Schwere
- **WHEN** eine Warnung eine Schwere trägt, die keiner der vier Stufen entspricht
- **THEN** zeigt der Inspector den Rohwert ohne Rollenfarbe, statt eine Stufe zu erfinden

### Requirement: Der Zustand eines Pegels folgt dem Statusfarb-Vertrag
Wählt ein Benutzer einen PEGELONLINE-Pegel an, SHALL der Inspector dessen Zustand gegenüber
mittlerem Niedrig- und Hochwasser mit einem Wort und einer Rolle aus dem Statusfarb-Vertrag
zeigen: „Hoch“ und „Niedrig“ in der Rolle `achtung`, „Normal“ in der Rolle `normal`. Kein
Zustand MUST in der Alarm- oder der Bedienfarbe erscheinen. Ein anderer oder fehlender Zustand
MUST ohne Kennzeichnung bleiben, statt einen Rohwert oder eine erfundene Stufe zu zeigen.

#### Scenario: Pegel über dem mittleren Hochwasser
- **WHEN** ein Benutzer einen Pegel mit Zustand `high` anwählt
- **THEN** zeigt der Inspector neben dem Wasserstand „Hoch“ in der Achtung-Rolle und nichts davon in Rot oder Blau

#### Scenario: Pegel im Normalbereich
- **WHEN** ein Benutzer einen Pegel mit Zustand `normal` anwählt
- **THEN** zeigt der Inspector „Normal“ in der Normal-Rolle

#### Scenario: Pegel unter dem mittleren Niedrigwasser
- **WHEN** ein Benutzer einen Pegel mit Zustand `low` anwählt
- **THEN** zeigt der Inspector „Niedrig“ in der Achtung-Rolle

#### Scenario: Zustand ohne Aussage
- **WHEN** ein Benutzer einen Pegel mit Zustand `unknown`, `commented`, `out-dated` oder ohne Zustand anwählt
- **THEN** zeigt der Inspector den Wasserstand ohne Zustandskennzeichnung und nicht den Rohwert
