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
Das System SHALL jeder Sonde genau eine Stufe aus diesen Bändern zuweisen:
`keine_messung` (kein Messwert), `normal` (Messwert ≤ 0,2 µSv/h), `erhoeht`
(0,2 < Messwert ≤ 0,6 µSv/h), `stark_erhoeht` (Messwert > 0,6 µSv/h). Die Stufenwörter
sind Teil der Schnittstelle und MUST unverändert bleiben.

#### Scenario: Grenzwerte werden der unteren Stufe zugeschlagen
- **WHEN** eine Sonde genau 0,2 µSv/h bzw. genau 0,6 µSv/h meldet
- **THEN** trägt sie die Stufe `normal` bzw. `erhoeht`

#### Scenario: Werte oberhalb der Bänder
- **WHEN** eine Sonde 0,21 µSv/h bzw. 0,61 µSv/h meldet
- **THEN** trägt sie die Stufe `erhoeht` bzw. `stark_erhoeht`

### Requirement: Die Einteilung gibt sich als Projekt-Einteilung zu erkennen
Das System MUST überall dort, wo es eine Sonde als „erhöht" bezeichnet, erkennbar machen,
dass die Bänder eine Einteilung des Lifeline Hub auf Grundlage des vom BfS genannten
natürlichen Bereichs (0,05–0,2 µSv/h) sind und kein amtlicher Schwellenwert des BfS. Die
Quellendokumentation MUST dasselbe festhalten.

#### Scenario: Hinweis im Inspector
- **WHEN** ein Benutzer auf der Lagekarte eine ODL-Sonde anwählt
- **THEN** zeigt der Inspector Messwert, Messende, Stufe als Wort und einen sichtbaren Hinweis, dass die Einteilung keine BfS-Schwelle ist

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
