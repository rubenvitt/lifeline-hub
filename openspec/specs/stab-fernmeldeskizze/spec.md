# stab-fernmeldeskizze Specification

## Purpose
Zeigt die Fernmeldeskizze des Sachgebiets S6 als taktische Kommunikationsskizze (FwDV 100, BBK
„Taktische Zeichen im Bevölkerungsschutz“ Anhang J.5): Sprechgruppen als Sammelschienen mit
Bedingungszeichen, Stellen als Führungsstellen-Kästen und Einheiten als taktische Zeichen, dazu
externe Stellen, Punkt-zu-Punkt-Verbindungen, Komponenten, rückwärtiger Bereich und Schriftfeld.
Zuordnungen und Rufnamen stehen in den Datensätzen der Stellen; nur was es dort nicht gibt
(Lage, Verbindungen, Komponenten, Bereiche, Schriftfeld) speichert die Skizze selbst. Das
Bearbeiten regelt `stab-fernmeldeskizze-bearbeitung`.

## Requirements

### Requirement: Zweite Darstellung des Funkplans

Die Fernmeldeskizze SHALL als zweite Darstellung der Funkplan-Seite erreichbar sein. Ein Umschalter
„Tabelle | Skizze | Sprechgruppen“ steht auf der Seite. Die Sichtvorgabe `?ansicht=skizze` öffnet die Skizze, danach
wird der Parameter aus der Adresse entfernt, ein unbrauchbarer Wert ebenso. Die Skizze MUST NOT als
eigenes Modul erscheinen. Sie MUST die Stab-Freigabe der Funkplan-Seite erben.

#### Scenario: Umschalten

- **WHEN** eine Person mit Leserecht auf den Stab den Funkplan öffnet und „Skizze“ wählt
- **THEN** zeigt die Seite die Fernmeldeskizze statt der Tabelle, und das Lücken-Paneel bleibt
  stehen

#### Scenario: Sichtvorgabe aus einem Link

- **WHEN** eine Person `/einsaetze/:id/stab/funkplan?ansicht=skizze` öffnet
- **THEN** steht die Darstellung auf „Skizze“, und `ansicht` ist aus der Adresse entfernt

#### Scenario: Unbrauchbarer Wert

- **WHEN** eine Person `?ansicht=quatsch` öffnet
- **THEN** bleibt die Darstellung „Tabelle“, und der Parameter ist aus der Adresse entfernt

#### Scenario: Stab gesperrt

- **WHEN** das Stab-Modul für die Person gesperrt ist und sie `?ansicht=skizze` öffnet
- **THEN** sieht sie weder Tabelle noch Skizze, sondern dieselbe Sperranzeige wie beim Funkplan

### Requirement: Knoteninhalt ohne erfundene Angaben

Jeder Abschnitt und jede Einheit SHALL in der Skizze Bezeichnung und Rufname zeigen, mit denselben
Werten wie die Tabelle; ihre Sprechgruppen zeigt die Skizze über die Schienen, an denen sie hängen.
Fehlt jede Sprechgruppe, MUST „keine Sprechgruppe“ als Wort am Element stehen, nicht nur als
Farbe. Leitung, Stärke und Erreichbarkeit MUST NOT in der Skizze erscheinen. Das
Kommunikationsmittel SHALL im Eigenschaftspaneel des gewählten Elements stehen.

#### Scenario: Gleiche Werte wie die Tabelle

- **WHEN** der Einheit „1. Zug“ die Sprechgruppen „TMO 311“ und „DMO 505“ zugeordnet sind
- **THEN** hängt „1. Zug“ an den Schienen „TMO 311“ und „DMO 505“, so wie ihre Zeile in der Tabelle
  beide nennt

#### Scenario: Einheit ohne Sprechgruppe

- **WHEN** einer Einheit keine Sprechgruppe zugeordnet ist
- **THEN** trägt ihr Element „keine Sprechgruppe“ als Wort und hängt an keiner Schiene

#### Scenario: Erreichbarkeit bleibt in der Tabelle

- **WHEN** einer Einheit eine Erreichbarkeit erfasst ist
- **THEN** erscheint sie in der Skizze weder am Bildschirm noch im Druck

### Requirement: Fehlender gemeinsamer Kanal als benannte Lücke

Tragen eine Stelle und ihre übergeordnete Stelle in der Führungsorganisation je mindestens eine
Sprechgruppe, aber keine gemeinsame, SHALL die untere Stelle „keine gemeinsame Sprechgruppe“ als
Wort mit einem Zeichen tragen, nicht nur als Farbe. Übergeordnete Stelle eines obersten Abschnitts
ist die eigene Führungsstelle. Fehlt einer Seite jede Sprechgruppe, MUST dieses Urteil fehlen, denn
die Lücke steht schon an der Stelle. Die Zahl MUST dieselbe sein wie im Lücken-Paneel.

#### Scenario: Kein gemeinsamer Kanal

- **WHEN** „EA Nord“ nur „TMO 311“ trägt und die ihm zugeordnete Einheit „1. Zug“ nur „DMO 505“
- **THEN** trägt „1. Zug“ „keine gemeinsame Sprechgruppe“, und das Lücken-Paneel zählt diese
  Verbindung

#### Scenario: Unterabschnitt ohne Sprechgruppe

- **WHEN** ein Unterabschnitt keine Sprechgruppe trägt
- **THEN** trägt er „keine Sprechgruppe“ und nicht zusätzlich „keine gemeinsame Sprechgruppe“

### Requirement: Einsatzleitung ohne erfundene Gegenstelle

Ist die eigene Führungsstelle erfasst, SHALL die Skizze sie als obersten Kasten „Einsatzleitung“
mit ihrem Rufnamen zeigen, an den Schienen ihrer Sprechgruppen, nie mit ihrer Erreichbarkeit. Ist
sie nicht erfasst, SHALL an ihrer Stelle die benannte Lücke „Einsatzleitung: Gegenstelle nicht
erfasst“ stehen, ohne Stichleitung, und die obersten Abschnitte tragen kein Urteil gegen sie. Die
Skizze MUST NOT einen Rufnamen oder eine Sprechgruppe der Einsatzleitung aus anderen Daten
ableiten. Eine Stabsstelle MUST NOT in der Skizze erscheinen.

#### Scenario: Wurzel

- **WHEN** die Skizze eines Einsatzes ohne erfasste Führungsstelle geöffnet wird
- **THEN** steht oben „Einsatzleitung: Gegenstelle nicht erfasst“ ohne Rufname und ohne
  Stichleitung, und kein oberster Abschnitt trägt „keine gemeinsame Sprechgruppe“

#### Scenario: Wurzel mit erfasster Führungsstelle

- **WHEN** die Führungsstelle mit Rufname „Florian Musterstadt 10/1“, „TMO 311“ und einer
  Erreichbarkeit erfasst ist
- **THEN** zeigt der Kasten „Einsatzleitung“ den Rufnamen und hängt an der Schiene „TMO 311“, und
  die Erreichbarkeit fehlt

### Requirement: Fehlende Quellen werden benannt

Sind die Abschnitte gesperrt oder nicht geladen, SHALL die Skizze statt der Fläche den Grund nennen
und MUST NOT Einheiten ohne Abschnitt zeigen. Fehlen nur die Einheiten, die externen Stellen oder
die Daten der Skizze, SHALL die Skizze das Übrige zeigen und je fehlender Quelle den Grund nennen.
Eine fehlende Quelle MUST NOT als leerer Bestand erscheinen.

#### Scenario: Abschnitte gesperrt

- **WHEN** die Abschnittsliste mit 403 abgelehnt wird
- **THEN** zeigt die Skizze „Abschnitte: nicht freigegeben“ und keine Fläche

#### Scenario: Einheiten nicht geladen

- **WHEN** der Abruf der Einheiten scheitert
- **THEN** zeigt die Skizze die Abschnitte an ihren Schienen und den Hinweis „Einheiten: nicht
  geladen“

#### Scenario: Externe Stellen nicht geladen

- **WHEN** der Abruf des Kommunikationsplans scheitert
- **THEN** zeigt die Skizze Führungsstelle, Abschnitte und Einheiten und den Hinweis „Externe
  Stellen: nicht geladen“

### Requirement: Lesbar ohne waagerechtes Scrollen

Die Seite SHALL bei 1366 × 768 mit offenem Modulpanel (Fükw), bei 1024 und 768 px (Tablet) und bei
390 px (mobil) ohne waagerechtes Scrollen der Seite stehen. Die Fläche MUST beim Öffnen die ganze
Skizze eingepasst zeigen; Zoomen und Verschieben der Ansicht geschehen innerhalb der Fläche, über
Knöpfe, Mausrad mit Strg und zwei Finger. Bezeichnungen, Rufnamen und Bedingungszeichen MUST
umbrechen bzw. mitwachsen und MUST NOT gekürzt werden.

#### Scenario: Viele Abschnitte am Fükw

- **WHEN** ein Einsatz acht oberste Abschnitte mit je drei Einheiten mit je zwei Sprechgruppen hat
  und die Skizze bei 1366 × 768 mit offenem Modulpanel geöffnet wird
- **THEN** ist die ganze Skizze in der Fläche zu sehen, und die Seite läuft nicht waagerecht über

#### Scenario: Zoomen ohne Ziehen

- **WHEN** die Person am Fükw den Knopf „+“ zweimal und dann „Einpassen“ wählt
- **THEN** wird die Ansicht zweimal vergrößert und danach wieder ganz eingepasst

### Requirement: Druck als eigenes Druckstück

Die Skizze SHALL über „Drucken / als PDF“ als eigenes Druckstück mit der Dokumentart
„Fernmeldeskizze“ druckbar sein, auf A3 quer (Vorgabe) oder A4 quer, mit dem gemeinsamen
Druckkopf, dem Schriftfeld und dem Lücken-Paneel. Die Skizze MUST ganz auf die erste Seite skaliert
sein, ohne Bedienelemente, Hervorhebung und Filter. Die Funkplan-Tabelle MUST ab einer neuen Seite
als Anlage folgen. Jede Unterscheidung MUST in Graustufen über Linienart, Muster oder Wort lesbar
sein. Die Anforderungen der Capability `druck-dokumente` gelten unverändert.

#### Scenario: Druck aus der Skizze

- **WHEN** die Person in der Skizze mit gesetztem Filter „nur Lücken“ „Drucken / als PDF“ wählt
- **THEN** nennt der Druckkopf „Fernmeldeskizze“, die erste Seite zeigt die ganze Skizze quer mit
  Schriftfeld und ohne Filter, und die Funkplan-Tabelle folgt auf einer neuen Seite

#### Scenario: Graustufen

- **WHEN** die Skizze mit einer geplanten und einer bestehenden Verbindung in Graustufen gedruckt
  wird
- **THEN** ist die geplante gestrichelt mit dem Wort „geplant“ und die bestehende durchgezogen

#### Scenario: Druck aus der Tabelle

- **WHEN** die Person in der Tabelle „Drucken / als PDF“ wählt
- **THEN** nennt der Druckkopf „Funkplan“, und der Ausdruck enthält die Tabelle, nicht die Skizze

### Requirement: Übernahme in den Lagebericht über den Funkplan

Die Skizze SHALL keine eigene Übernahme anbieten. In allen Darstellungen SHALL dieselbe Aktion „In
Lagebericht übernehmen“ des Funkplans stehen, mit denselben Bedingungen. Der übernommene Text MUST
die Lücke „Verbindungen ohne gemeinsame Sprechgruppe“ mit Anzahl und betroffenen Stellen und den
Abschnitt „Kommunikationsskizze“ enthalten.

#### Scenario: Übernahme aus der Skizze

- **WHEN** eine berechtigte Person in der Skizze „In Lagebericht übernehmen“ wählt
- **THEN** entsteht genau ein Lagebericht „Funkplan <DTG>“ mit derselben Gliederung wie aus der
  Tabelle, der Zeile zu den Verbindungen ohne gemeinsame Sprechgruppe und dem Abschnitt
  „Kommunikationsskizze“

### Requirement: Eine Sammelschiene je Sprechgruppe
Die Skizze SHALL jede Sprechgruppe des Einsatzes genau einmal als waagerechte Sammelschiene zeigen,
mit einem Bedingungszeichen (Langsechseck mit Betriebsart und Bezeichnung) und, wenn vorhanden,
dem Hinweis der Sprechgruppe darunter. Jede Stelle, der die Sprechgruppe zugeordnet ist, MUST mit
genau einer Stichleitung daran hängen. Eine Stelle mit mehreren Sprechgruppen MUST an jeder ihrer
Schienen hängen. Kanten zwischen zwei Stellen MUST NOT für Sprechgruppen gezeichnet werden.

#### Scenario: Vier Stellen auf einem Kanal
- **WHEN** Führungsstelle, „EA 1“, „EA 2“ und „EA 3“ die Sprechgruppe „TMO BN_BOS“ tragen
- **THEN** zeigt die Skizze genau eine Schiene mit dem Bedingungszeichen „TMO BN_BOS“, an der alle
  vier Stellen mit je einer Stichleitung hängen, und keine Kante zwischen zwei dieser Stellen

#### Scenario: Übergang zwischen zwei Kanälen
- **WHEN** „EA 1“ die Sprechgruppen „TMO BN_BOS“ und „DMO 314_F*“ trägt
- **THEN** hängt „EA 1“ an beiden Schienen

#### Scenario: Sprechgruppe mit Hinweis
- **WHEN** die Sprechgruppe „DMO 314_F*“ den Hinweis „Gesundheit“ trägt
- **THEN** steht „Gesundheit“ unter ihrem Bedingungszeichen

### Requirement: Stellen als Führungsstellen-Kästen und Einheiten als Zeichen
Die Skizze SHALL die eigene Führungsstelle und jeden Abschnitt als Kasten mit taktischem Zeichen,
Bezeichnung in großer Schrift und Rufname darunter zeigen. Einheiten SHALL als taktisches Zeichen
ohne Kasten mit Name und Funkrufname darunter erscheinen. Fehlt der Rufname, MUST „kein Rufname“
stehen. Fahrzeuge MUST NOT als Element erscheinen.

#### Scenario: Abschnitt mit Rufname
- **WHEN** der Abschnitt „EA 1 Gesundheit“ die Kurzbezeichnung „EA 1“ trägt
- **THEN** zeigt sein Kasten ein taktisches Zeichen, „EA 1 Gesundheit“ und „EA 1“

#### Scenario: Einheit ohne Funkrufname
- **WHEN** die Einheit „1. Zug“ keinen Funkrufnamen trägt
- **THEN** steht unter ihrem Zeichen „1. Zug“ und „kein Rufname“

### Requirement: Externe Stellen und Komponenten
Die Skizze SHALL die externen Stellen des Kommunikationsplans (Leitstelle, Behörde,
Verbindungsperson, sonstige) und die Komponenten der Skizze (Repeater, Gateway, Basisstation,
mobile Basisstation, Antenne, Vermittlung) als eigene Elemente mit Zeichen und Bezeichnung zeigen,
an den Schienen ihrer Sprechgruppen. Führungsfunktionen des Kommunikationsplans MUST NOT als
eigenes Element erscheinen. Erreichbarkeit und Rufnummern MUST NOT erscheinen.

#### Scenario: Leitstelle am Kanal
- **WHEN** die Stelle „ILS Musterhausen“ der Art Leitstelle die Sprechgruppe „TMO SL AS“ trägt
- **THEN** zeigt die Skizze die Leitstelle mit Zeichen und Bezeichnung an der Schiene „TMO SL AS“,
  und ihre Rufnummer aus dem Kommunikationsplan erscheint nicht

#### Scenario: Funktion S2 im Kommunikationsplan
- **WHEN** der Kommunikationsplan eine Stelle S2 mit Verbindungen führt
- **THEN** erscheint S2 nicht als Element der Skizze

### Requirement: Verbindungen mit Art, Medium und Status
Die Skizze SHALL jede Punkt-zu-Punkt-Verbindung als Linie zwischen ihren beiden Stellen mit dem
Zeichen ihrer Art zeigen. Eine Funkverbindung MUST eine Zickzack-Marke tragen, eine
leitergebundene MUST glatt sein. Eine geplante Verbindung und ein geplanter Kanal einer externen
Stelle MUST gestrichelt sein **und** das Wort „geplant“ tragen; eine bestehende ist durchgezogen.

#### Scenario: Geplante Datenverbindung
- **WHEN** zwischen Führungsstelle und Leitstelle eine leitergebundene Datenverbindung mit Status
  „geplant“ besteht
- **THEN** ist die Linie glatt, gestrichelt, trägt das Zeichen für Daten und das Wort „geplant“

#### Scenario: Polizei geplant am Kanal
- **WHEN** die Stelle „Polizei“ die Sprechgruppe „TMO SL AS“ mit Status „geplant“ trägt
- **THEN** ist ihre Stichleitung gestrichelt und trägt das Wort „geplant“

### Requirement: Rückwärtiger Bereich
Die Skizze SHALL Bereiche als Rechteck mit Strich-Punkt-Grenze und Bezeichnung zeigen. Ein
Element gehört zum Bereich, wenn es darin steht. Ein Bereich MUST NOT Zuordnungen oder Daten
anderer Elemente ändern.

#### Scenario: Leitstelle im rückwärtigen Bereich
- **WHEN** die Leitstelle innerhalb des Bereichs „Rückwärtiger Bereich“ steht
- **THEN** zeigt die Skizze sie innerhalb der Strich-Punkt-Grenze

### Requirement: Schriftfeld
Die Skizze SHALL ein Schriftfeld tragen: Herausgeber (Vorgabe: Bezeichnung des Einsatzes), Titel
„Taktische Fernmeldeskizze für den Einsatz ‚<Einsatzbezeichnung>‘“, VS-Vermerk (keiner oder „VS –
Nur für den Dienstgebrauch“), „Gültig ab“ als DTG, „gez.“ mit Name und DTG sowie „Stand“ als DTG
der letzten Änderung an der Skizze. Leere Angaben MUST als „—“ erscheinen, nie erfunden.

#### Scenario: Schriftfeld ohne Angaben
- **WHEN** für einen Einsatz „Großbrand Musterhausen“ noch nichts im Schriftfeld erfasst ist
- **THEN** zeigt es den Titel „Taktische Fernmeldeskizze für den Einsatz ‚Großbrand
  Musterhausen‘“, keinen VS-Vermerk und „—“ bei „Gültig ab“ und „gez.“

### Requirement: Lücken am Bild
Die Skizze SHALL jede Lücke des Lücken-Paneels am betroffenen Element als Wort mit Zeichen zeigen,
nicht nur als Farbe: Stelle ohne Sprechgruppe, Stelle ohne gemeinsame Sprechgruppe mit ihrer
übergeordneten Stelle, Sprechgruppe mit nur einem Teilnehmer, Leitstelle ohne Verbindung. Die
Zahl der Lücken im Bild MUST dieselbe sein wie im Paneel. Ein Klick auf eine Lücke im Paneel MUST
das betroffene Element in der Skizze wählen.

#### Scenario: Einheit ohne gemeinsamen Kanal
- **WHEN** „EA Nord“ nur „TMO 311“ trägt und die ihm zugeordnete Einheit „1. Zug“ nur „DMO 505“
- **THEN** trägt „1. Zug“ in der Skizze „keine gemeinsame Sprechgruppe“ mit Zeichen, und das Paneel
  zählt dieselbe Verbindung

#### Scenario: Klick im Paneel
- **WHEN** die Person in der Skizze im Lücken-Paneel auf „1. Zug“ tippt
- **THEN** ist „1. Zug“ in der Skizze gewählt und im sichtbaren Ausschnitt

### Requirement: Erkunden durch Hervorheben und Filtern
Ein Klick, ein Fokus oder ein Zeiger auf einer Schiene SHALL alle ihre Teilnehmer hervorheben, ein
Klick auf eine Stelle alle ihre Schienen und Gegenstellen. Die Hervorhebung MUST über Form oder
Strichstärke und nicht nur über Farbe erkennbar sein. Ein Ebenenfilter SHALL zwischen Sprechfunk,
leitergebunden, Daten und „nur Lücken“ umschalten. Hervorheben und Filtern MUST auch ohne
Schreibrecht und mobil gehen.

#### Scenario: Wer hört mit?
- **WHEN** die Person auf die Schiene „TMO BN_BOS“ tippt
- **THEN** sind die Schiene und alle Stellen daran hervorgehoben, und die übrigen Elemente treten
  zurück

#### Scenario: Nur Lücken
- **WHEN** die Person den Filter „nur Lücken“ wählt
- **THEN** zeigt die Skizze vollständig nur Elemente mit Lücke und ihre Schienen, die übrigen
  zurückgenommen

### Requirement: Live ohne Neuladen
Eine Änderung an Gliederung, Rufname, Sprechgruppen-Zuordnung, Führungsstelle, externen Stellen
oder an den Daten der Skizze SHALL ohne Neuladen in der Skizze erscheinen. Ein Element mit
gespeicherter Lage MUST live an seine neue Lage springen. Solange Zeiger oder Fokus in der Fläche
liegen, MUST ein Element ohne gespeicherte Lage stehen bleiben; neu hinzukommende Elemente MUST
als „neu“ markiert erscheinen, ohne andere zu verschieben.

#### Scenario: Zuordnung an anderem Arbeitsplatz
- **WHEN** an einem anderen Arbeitsplatz der Einheit „1. Zug“ die Sprechgruppe „DMO 314_F*“
  zugeordnet wird, während die Skizze offen ist
- **THEN** hängt „1. Zug“ ohne Neuladen an der Schiene „DMO 314_F*“

#### Scenario: Neue Einheit unter dem Zeiger
- **WHEN** der Zeiger über der Fläche liegt und live eine Einheit angelegt wird
- **THEN** erscheint sie als „neu“ markiert, und kein anderes Element ändert seinen Ort
