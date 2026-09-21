# Spec Delta

## Purpose

Die Fachebene „Energieanlagen“ zeigt auf der Lagekarte die großen Anlagen der
Stromerzeugung und -speicherung im Kartenausschnitt. Die Daten stammen aus OpenStreetMap
und dem Marktstammdatenregister der Bundesnetzagentur. Kleinanlagen erscheinen nicht, und
jede Quelle wird korrekt genannt.

## ADDED Requirements

### Requirement: Abruf nach Kartenausschnitt

Das System SHALL die Fachebene unter `GET /api/karte/fachebenen/energie` ausliefern. Der
Parameter `bbox` (`west,sued,ost,nord`) MUST gesetzt sein. Die Antwort SHALL denselben
Umschlag haben wie jede andere Fachebene (`quelle`, `status`, `attribution`, `stand`,
`features` als GeoJSON-FeatureCollection aus Punkten). Sie SHALL nur Anlagen enthalten,
deren Punkt innerhalb der bbox liegt. Die eine Ausnahme ist eine zusammengeführte Anlage
(`osm+mastr`), deren MaStR-Einheit in der bbox liegt: ihr Punkt steht am OSM-Standort und
darf bis zum Zuordnungsradius außerhalb liegen. Benachbarte Ausschnitte SHALL für dieselbe
Anlage denselben Punkt liefern.

#### Scenario: Ohne bbox

- **WHEN** die Ebene ohne `bbox`-Parameter angefragt wird
- **THEN** antwortet das System mit 400 und einem `{error}`-Rumpf

#### Scenario: Kaputte bbox

- **WHEN** `bbox` keine vier Zahlen trägt oder `west ≥ ost` bzw. `sued ≥ nord` gilt
- **THEN** antwortet das System mit 400

#### Scenario: Nur Anlagen im Ausschnitt

- **WHEN** der Cache eine Anlage innerhalb und eine außerhalb der angefragten bbox enthält
- **THEN** enthält die Antwort nur die Anlage innerhalb der bbox

#### Scenario: Anlage an der Kante des Ausschnitts

- **WHEN** eine MaStR-Einheit knapp innerhalb der bbox liegt und ihre OSM-Anlage derselben
  Anlagenart weniger als 2 km entfernt knapp außerhalb
- **THEN** zeigt die Ebene in diesem und im Nachbarausschnitt denselben einen Punkt mit
  Herkunft `osm+mastr` am OSM-Standort

### Requirement: Kein Kleinanlagen-Rauschen

Das System SHALL nur große Energieinfrastruktur zeigen:

- Aus dem Marktstammdatenregister SHALL es nur Stromerzeugungseinheiten mit einer
  Nettonennleistung über 10 MW übernehmen, die Koordinaten tragen und im Betriebsstatus
  „In Betrieb“ oder „Vorübergehend stillgelegt“ stehen.
- Aus OpenStreetMap SHALL es nur Objekte mit `power=plant` übernehmen. Konventionelle
  Anlagen (Kohle, Braunkohle, Gas, Öl, Kernenergie, Abfall) SHALL es unabhängig von der
  Leistungsangabe zeigen. Alle anderen Anlagen SHALL es nur zeigen, wenn eine
  Leistungsangabe von mindestens 10 MW getaggt ist.
- Objekte mit `power=generator` oder `power=substation` MUST NOT Teil dieser Ebene sein.

#### Scenario: Kleine Solaranlage aus OSM

- **WHEN** OSM eine `power=plant`-Anlage mit `plant:source=solar` und
  `plant:output:electricity=2 MW` liefert
- **THEN** erscheint sie nicht in der Ebene

#### Scenario: Gaskraftwerk ohne Leistungsangabe

- **WHEN** OSM eine `power=plant`-Anlage mit `plant:source=gas` ohne Leistungsangabe liefert
- **THEN** erscheint sie in der Ebene, und ihre Leistung wird als unbekannt geführt

#### Scenario: Anlage ohne Quelle und ohne Leistung

- **WHEN** OSM eine `power=plant`-Anlage ohne `plant:source` und ohne Leistungsangabe liefert
- **THEN** erscheint sie nicht in der Ebene

#### Scenario: Umspannwerk

- **WHEN** im Ausschnitt ein `power=substation` liegt
- **THEN** erscheint es nicht in dieser Ebene (es gehört zur KRITIS-Ebene)

### Requirement: Einheitliche Anlagenangaben

Jeder Punkt SHALL flache Angaben tragen: einen Titel, eine Anlagenart aus einer
festen Menge (Kohle, Gas, Öl, Kernenergie, Abfall, Wasser, Wind, Solar, Biomasse,
Speicher, Sonstige), die elektrische Leistung in MW oder den Vermerk „unbekannt“, den
Betreiber, falls bekannt, sowie die Herkunft (`osm`, `mastr` oder `osm+mastr`). Stammt
eine Angabe aus dem Marktstammdatenregister, SHALL der Punkt die MaStR-Nummer der Einheit
tragen, und dazu `mastr_nummern` mit den Nummern aller zugeordneten Einheiten, sortiert
und durch Kommas ohne Leerzeichen getrennt. `mastr_nummern` ist `null`, wenn keine zugeordnete
Einheit eine Nummer trägt, insbesondere ohne MaStR-Anteil.

#### Scenario: Leistungsangabe in OSM als Text

- **WHEN** OSM `plant:output:electricity=690 MW` liefert
- **THEN** trägt der Punkt die Leistung 690 MW

#### Scenario: Nicht auswertbare Leistungsangabe

- **WHEN** OSM `plant:output:electricity=yes` liefert
- **THEN** trägt der Punkt die Leistung „unbekannt“, statt eine Zahl zu erfinden

### Requirement: Zusammenführung von OSM und MaStR

Liegt eine MaStR-Einheit höchstens 2 km von einer OSM-Anlage derselben Anlagenart
entfernt, SHALL das System beide zu **einem** Punkt am OSM-Standort zusammenführen.
Leistung, Betreiber, Betriebsstatus und MaStR-Nummer SHALL es dabei aus dem
Marktstammdatenregister nehmen, die Herkunft ist `osm+mastr`. Jede übrige MaStR-Einheit
SHALL als eigener Punkt mit Herkunft `mastr` erscheinen.

#### Scenario: Wasserkraftwerk in beiden Quellen

- **WHEN** OSM ein Wasserkraftwerk führt und 500 m daneben eine MaStR-Einheit mit
  Energieträger Wasser liegt
- **THEN** zeigt die Ebene genau einen Punkt, mit Herkunft `osm+mastr` und der MaStR-Leistung

#### Scenario: Unterschiedliche Anlagenart

- **WHEN** neben einem OSM-Gaskraftwerk eine MaStR-Batteriespeichereinheit liegt
- **THEN** zeigt die Ebene zwei Punkte

### Requirement: Korrekte Quellennennung

Das Feld `attribution` SHALL jede Quelle nennen, die zu den ausgelieferten Punkten
beiträgt, und MUST NOT eine Quelle nennen, die nichts beiträgt. Für OSM lautet die Nennung
„© OpenStreetMap-Beitragende (ODbL)“. Für das Marktstammdatenregister SHALL sie die
Bundesnetzagentur als Bereitsteller, das Marktstammdatenregister und die Lizenz
„Datenlizenz Deutschland – Namensnennung – Version 2.0 (dl-de/by-2-0)“ nennen.

#### Scenario: Beide Quellen tragen bei

- **WHEN** OSM und MaStR für den Ausschnitt geantwortet haben
- **THEN** nennt `attribution` beide Quellen

#### Scenario: MaStR nicht erreichbar

- **WHEN** der MaStR-Abruf gescheitert ist und kein Cache-Stand vorliegt
- **THEN** nennt `attribution` nur OpenStreetMap

### Requirement: Teilausfall und Totalausfall

Die Ebene SHALL auch dann ausgeliefert werden, wenn nur eine der beiden Quellen erreichbar
ist; sie zeigt dann deren Anlagen. `status` SHALL genau dann `offline` sein, wenn keine der
beiden Quellen Daten liefert (weder frisch noch aus dem Cache). Auch dann bleibt die
HTTP-Antwort 200. Nach einem gescheiterten MaStR-Abruf SHALL das System den Abruf
frühestens nach 5 Minuten erneut versuchen, statt jede Kartenanfrage auf den Upstream
warten zu lassen.

#### Scenario: Beide Quellen nicht erreichbar

- **WHEN** weder Overpass noch MaStR antworten und kein Cache-Stand vorliegt
- **THEN** antwortet das System mit 200, `status: "offline"` und einer leeren
  FeatureCollection

#### Scenario: Nur OSM erreichbar

- **WHEN** Overpass antwortet, MaStR aber nicht
- **THEN** enthält die Antwort die OSM-Anlagen, und `status` ist nicht `offline`

#### Scenario: MaStR antwortet langsam

- **WHEN** der Cache leer ist, Overpass sofort antwortet und der MaStR-Abruf länger als
  10 Sekunden braucht
- **THEN** antwortet das System nach höchstens 10 Sekunden mit den OSM-Anlagen, der
  MaStR-Abruf läuft im Hintergrund weiter und legt seinen Stand in den Cache, und die
  gerissene Frist setzt keine Sperre

### Requirement: Bedienung in der Lagekarte

Die Ebenenauswahl der Lagekarte SHALL einen Eintrag „Energieanlagen“ zeigen, der beim
ersten Mal ausgeschaltet ist und je Einsatz gespeichert wird wie die übrigen Fachebenen.
Die Ebene SHALL ihren Kartenausschnitt unabhängig davon bekommen, ob die KRITIS-Ebene
eingeschaltet ist. Unterhalb des Mindest-Zooms bbox-abhängiger Ebenen SHALL der Eintrag
denselben „näher heranzoomen“-Hinweis zeigen wie KRITIS. Ein Klick auf einen Punkt SHALL
Titel, Anlagenart, Leistung, Betreiber, Betriebsstatus und Herkunft zeigen, bei
MaStR-Herkunft auch die MaStR-Nummer.

#### Scenario: KRITIS aus, Energie an

- **WHEN** die Bedienperson nur „Energieanlagen“ einschaltet und auf Zoom 12 steht
- **THEN** fragt die Karte die Ebene mit dem aktuellen Ausschnitt ab und zeichnet die Punkte

#### Scenario: Gespeicherte Ansicht ohne Energie-Schlüssel

- **WHEN** eine vor dieser Änderung gespeicherte Kartenansicht geladen wird
- **THEN** ist „Energieanlagen“ ausgeschaltet

#### Scenario: Inspector zeigt Energie-Inhalt

- **WHEN** die Bedienperson auf einen Punkt der Ebene klickt
- **THEN** zeigt der Inspector die Energie-Angaben und nicht den KRITIS-Inhalt
