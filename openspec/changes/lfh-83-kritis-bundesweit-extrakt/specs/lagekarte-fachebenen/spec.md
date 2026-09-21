# Spec Delta

## ADDED Requirements

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
