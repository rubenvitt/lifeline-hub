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
Farbe. Namen der Leitung, Stärke und Erreichbarkeit MUST NOT in der Skizze erscheinen; dass eine
Leitung besetzt ist, zeigt allein das Funktionszeichen im Kasten. Das Kommunikationsmittel SHALL im
Eigenschaftspaneel des gewählten Elements stehen.

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

#### Scenario: Name der Abschnittsleitung bleibt in der Tabelle

- **WHEN** der Abschnitt „EA 1 Gesundheit“ die Leitung „Erika Muster“ trägt
- **THEN** zeigt sein Kasten das Zeichen „EAL“, und „Erika Muster“ erscheint weder am Bildschirm
  noch im Druck

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
ableiten. Eine Stabsstelle MUST NOT als eigenes Element in der Skizze erscheinen; besetzte
Sachgebiete stehen nur als Funktionszeichen im Kasten „Einsatzleitung“.

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
und MUST NOT Einheiten ohne Abschnitt zeigen. Fehlen nur die Einheiten, die Fahrzeuge, die
Stab-Besetzung, die externen Stellen oder die Daten der Skizze, SHALL die Skizze das Übrige zeigen
und je fehlender Quelle den Grund nennen. Eine fehlende Quelle MUST NOT als leerer Bestand
erscheinen.

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

#### Scenario: Fahrzeuge gesperrt

- **WHEN** das Modul Fahrzeuge für die Person gesperrt ist
- **THEN** zeigt die Skizze alle Kästen ohne Führungsmittel und den Hinweis „Fahrzeuge: nicht
  freigegeben“

### Requirement: Lesbar ohne waagerechtes Scrollen

Die Seite SHALL bei 1366 × 768 mit offenem Modulpanel (Fükw), bei 1024 und 768 px (Tablet) und bei
390 px (mobil) ohne waagerechtes Scrollen der Seite stehen. Die Fläche MUST beim Öffnen die ganze
Skizze eingepasst zeigen; Zoomen und Verschieben der Ansicht geschehen innerhalb der Fläche, über
Knöpfe, Mausrad mit Strg und zwei Finger. Bezeichnungen, Rufnamen und Bedingungszeichen MUST
umbrechen bzw. mitwachsen und MUST NOT gekürzt werden.

Liegt der Maßstab unter dem Mindestmaßstab der Dichte-Stufe (kleinster Maßstab, bei dem jedes
Element den Boden der Stufe hält: kompakt und komfortabel 24 px, Handschuh 72 px in der kurzen
Achse, in der Stufe Handschuh mit mindestens 16 px Abstand zwischen zwei Zielen), MUST die Fläche
Übersicht sein: kein Element ist dann Zeigerziel, und ein Tippen oder Klick ohne Bewegung zoomt um
den Punkt auf den Mindestmaßstab. Tastatur, Paneel und Lücken-Wahl MUST unverändert wählen.

#### Scenario: Viele Abschnitte am Fükw

- **WHEN** ein Einsatz acht oberste Abschnitte mit je drei Einheiten mit je zwei Sprechgruppen hat
  und die Skizze bei 1366 × 768 mit offenem Modulpanel geöffnet wird
- **THEN** ist die ganze Skizze in der Fläche zu sehen, und die Seite läuft nicht waagerecht über

#### Scenario: Zoomen ohne Ziehen

- **WHEN** die Person am Fükw den Knopf „+“ zweimal und dann „Einpassen“ wählt
- **THEN** wird die Ansicht zweimal vergrößert und danach wieder ganz eingepasst

#### Scenario: Handschuh am Tablet

- **WHEN** die große Skizze bei 1024 px in der Stufe Handschuh eingepasst geöffnet ist und die
  Person auf „Einheit 3.2“ tippt
- **THEN** wird nichts gewählt, die Ansicht zoomt um den getippten Punkt, jedes Element ist danach
  mindestens 72 px in der kurzen Achse mit mindestens 16 px Abstand, und ein zweites Tippen wählt
  „Einheit 3.2“

#### Scenario: Handy

- **WHEN** die große Skizze bei 390 px eingepasst geöffnet ist
- **THEN** steht die ganze Skizze in der Fläche, kein Element ist Zeigerziel, und nach einem Tippen
  ist jedes Element mindestens 24 × 24 px

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
mit einem Bedingungszeichen (Langsechseck mit Betriebsart und Bezeichnung) und darunter, soweit
vorhanden, Netz, Sicherheit und Hinweis der Sprechgruppe in dieser Reihenfolge, getrennt durch
„ · “; diese Zeile MUST NOT das Zeichen verbreitern. Jede Stelle, der die Sprechgruppe zugeordnet ist, MUST mit
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

#### Scenario: Sprechgruppe mit Netz, Sicherheit und Hinweis
- **WHEN** „DMO 314_F*“ Netz „Gateway“, Sicherheit „E2E“ und Hinweis „Gesundheit“ trägt
- **THEN** steht „Gateway · E2E · Gesundheit“ unter ihrem Bedingungszeichen, und das Langsechseck
  ist so breit wie ohne diese Angaben

### Requirement: Stellen als Führungsstellen-Kästen und Einheiten als Zeichen

Die Skizze SHALL die eigene Führungsstelle und jeden Abschnitt als Kasten mit taktischem Zeichen,
Bezeichnung in großer Schrift und Rufname darunter zeigen. Einheiten SHALL als taktisches Zeichen
ohne Kasten mit Name und Funkrufname darunter erscheinen. Fehlt der Rufname, MUST „kein Rufname“
stehen. Fahrzeuge MUST NOT als eigenes Element erscheinen; ein Führungsfahrzeug erscheint nur als
Führungsmittel im Kasten (Requirement „Führungsmittel und Funktionen im Kasten“).

#### Scenario: Abschnitt mit Rufname

- **WHEN** der Abschnitt „EA 1 Gesundheit“ die Kurzbezeichnung „EA 1“ trägt
- **THEN** zeigt sein Kasten ein taktisches Zeichen, „EA 1 Gesundheit“ und „EA 1“

#### Scenario: Einheit ohne Funkrufname

- **WHEN** die Einheit „1. Zug“ keinen Funkrufnamen trägt
- **THEN** steht unter ihrem Zeichen „1. Zug“ und „kein Rufname“

#### Scenario: Löschfahrzeug ohne Element

- **WHEN** der Einheit „1. Zug“ das Fahrzeug „HLF 20“ disponiert ist
- **THEN** erscheint „HLF 20“ weder als Element noch im Kasten ihres Abschnitts

### Requirement: Führungsmittel und Funktionen im Kasten

Jeder Führungsstellen-Kasten SHALL die dort eingesetzten Führungsmittel und Funktionen als kleine
taktische Zeichen zeigen, je mit einem Wort darunter, zuerst die Funktionen, dann die
Führungsmittel.

- Führungsmittel eines Abschnitts SHALL jedes disponierte Fahrzeug mit der Fachaufgabe Führung
  sein (dieselbe Regel wie die Lagekarte, ein manuell gesetztes Zeichen gewinnt), dessen Einheit in
  der Führungsorganisation unter diesem Abschnitt hängt und unter keinem tieferen. Das Wort ist der
  Fahrzeugtyp, sonst der Funkrufname. Jedes Fahrzeug MUST höchstens einmal im Bild stehen.
- Führungsmittel des Kastens „Einsatzleitung“ SHALL jedes der eigenen Führungsstelle zugeordnete
  Fahrzeug sein, unabhängig von seiner Fachaufgabe, mit Zeichen, Wort und Titel nach denselben
  Regeln wie im Abschnittskasten (LFH-1106). Ein solches Fahrzeug MUST NOT zugleich in einem
  Abschnittskasten stehen. Ohne Zuordnung MUST der Kasten „Einsatzleitung“ bleiben wie ohne diese
  Angabe.
- Ein Abschnitt mit eingetragener Leitung SHALL das Zeichen „EAL“ tragen, ein Unterabschnitt
  „UEAL“.
- Der Kasten „Einsatzleitung“ SHALL je Sachgebiet S1 bis S6 ein Zeichen mit dem Kürzel tragen,
  wenn es bei der Einsatzleitung, durch disponiertes Personal oder extern besetzt ist; ein
  rückwärtig wahrgenommenes Sachgebiet MUST NOT im Kasten stehen.
- Personennamen MUST NOT erscheinen. Die Zeichen sind keine Elemente: sie tragen keine
  Stichleitung, keine Lücke und keinen eigenen Fokus.
- Der Kasten SHALL um die Zeilen dieser Zeichen wachsen, auf dem Bildschirm, im Auto-Layout und im
  Druck gleich; ein langes Wort MUST umbrechen und MUST NOT gekürzt werden. Ohne Führungsmittel und
  Funktionen MUST der Kasten so hoch bleiben wie ohne diese Anforderung.

#### Scenario: Abschnitt mit ELW 1 und Leitung

- **WHEN** der Abschnitt „EA 1“ mit eingetragener Leitung die Einheit „FüGr EA 1“ führt, der das
  Fahrzeug „Florian Musterstadt 11/1“ vom Typ „ELW 1“ disponiert ist
- **THEN** zeigt der Kasten „EA 1“ das Zeichen „EAL“ und ein Fahrzeugzeichen mit „ELW 1“, und
  „FüGr EA 1“ steht wie bisher als Einheit darunter

#### Scenario: Fahrzeug im Unterabschnitt

- **WHEN** ein Kommandowagen einer Einheit des Unterabschnitts „EA 1.1“ disponiert ist
- **THEN** steht er im Kasten „EA 1.1“ und nicht im Kasten „EA 1“

#### Scenario: Fahrzeug ohne Abschnitt

- **WHEN** ein ELW 2 keiner Einheit oder einer Einheit ohne Abschnitt disponiert ist und der
  eigenen Führungsstelle nicht zugeordnet ist
- **THEN** erscheint er in keinem Kasten

#### Scenario: ELW 2 der Einsatzleitung

- **WHEN** der ELW 2 „Florian Musterstadt 10/1“ der eigenen Führungsstelle zugeordnet ist und der
  Einheit „FüGr EL“ im Abschnitt „EA 1“ angehört
- **THEN** zeigt der Kasten „Einsatzleitung“ nach den Sachgebieten ein Fahrzeugzeichen mit „ELW 2“,
  und der Kasten „EA 1“ zeigt ihn nicht

#### Scenario: ELW 2 ohne Einheit an der Führungsstelle

- **WHEN** ein der Führungsstelle zugeordneter ELW 2 keiner Einheit angehört
- **THEN** steht er im Kasten „Einsatzleitung“

#### Scenario: Fahrzeuge nicht freigegeben

- **WHEN** der Führungsstelle ein Fahrzeug zugeordnet ist, die Fahrzeuge aber nicht freigegeben sind
- **THEN** steht im Kasten „Einsatzleitung“ kein Fahrzeugzeichen

#### Scenario: Stab der Einsatzleitung

- **WHEN** S2 durch disponiertes Personal, S3 bei der Einsatzleitung und S6 rückwärtig besetzt ist
- **THEN** zeigt der Kasten „Einsatzleitung“ die Zeichen „S2“ und „S3“ in dieser Folge, kein „S6“
  und keinen Namen

#### Scenario: Druck in Graustufen

- **WHEN** die Skizze mit einem Abschnitt mit „EAL“ und „ELW 1“ auf A4 quer gedruckt wird
- **THEN** stehen beide Zeichen mit ihrem Wort im Kasten, und der Kasten ist im Druck so hoch wie
  am Bildschirm

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
