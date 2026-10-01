## Purpose

Zeigt die Fernmeldeskizze des Sachgebiets S6 nach FwDV 100: die Führungsorganisation des Einsatzes
als Grafik mit Rufnamen, Sprechgruppen und den Verbindungen zwischen den Stellen. Sie wird allein
aus den gepflegten Abschnitten und Einheiten abgeleitet und hat keine eigene Datenhaltung.

## ADDED Requirements

### Requirement: Zweite Darstellung des Funkplans

Die Fernmeldeskizze SHALL als zweite Darstellung der Funkplan-Seite erreichbar sein. Ein Umschalter
„Tabelle | Skizze“ steht auf der Seite. Die Sichtvorgabe `?ansicht=skizze` öffnet die Skizze, danach
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

### Requirement: Abgeleitet und live

Die Skizze SHALL allein aus den Abschnitten und Einheiten des Einsatzes und ihren
Sprechgruppen-Zuordnungen entstehen, ohne eigene Speicherung. Eine Änderung an Gliederung,
Rufname oder Sprechgruppen-Zuordnung MUST ohne Neuladen der Seite in der Skizze erscheinen.

#### Scenario: Sprechgruppe wird zugeordnet

- **WHEN** an einem anderen Arbeitsplatz einer Einheit die Sprechgruppe ihres Abschnitts
  zugeordnet wird, während die Skizze offen ist
- **THEN** trägt die Kante zwischen Abschnitt und Einheit diese Sprechgruppe ohne Neuladen, und die
  Lücke an der Kante ist verschwunden

### Requirement: Knotenaufbau wie das Organigramm

Die Skizze SHALL denselben Baum zeigen wie das Organigramm der Führungsorganisation: Wurzel
„Einsatzleitung“, darunter die obersten Abschnitte, unter einem Abschnitt seine Unterabschnitte und
dann seine obersten Einheiten, unter einer Einheit ihre unterstellten Einheiten und einen
Sammelknoten „Ohne Abschnitt“ nur bei Einheiten ohne Abschnitt. Fahrzeuge MUST NOT als Knoten
erscheinen.

#### Scenario: Gleiche Platzierung

- **WHEN** Einheit B der Einheit A unterstellt ist und A dem Abschnitt „EA Nord“ zugeordnet ist
- **THEN** steht B in der Skizze unter A und A unter „EA Nord“, so wie im Organigramm

#### Scenario: Fahrzeuge bleiben in der Tabelle

- **WHEN** der Einheit „1. Zug“ ein Fahrzeug angehört
- **THEN** zeigt die Skizze keinen Knoten für das Fahrzeug, die Tabelle zeigt seine Zeile weiter

### Requirement: Knoteninhalt ohne erfundene Angaben

Jeder Abschnitts- und Einheitsknoten SHALL Bezeichnung, Rufname, TMO- und DMO-Sprechgruppen und
Kommunikationsmittel zeigen, mit denselben Werten wie die Tabelle. Fehlt der Rufname, MUST
„kein Rufname“ stehen. Fehlt jede Sprechgruppe, MUST „keine Sprechgruppe“ als Wort stehen, nicht
nur als Farbe. Leitung, Stärke und Erreichbarkeit MUST NOT in der Skizze erscheinen.

#### Scenario: Gleiche Werte wie die Tabelle

- **WHEN** der Einheit „1. Zug“ die Sprechgruppen „TMO 311“ und „DMO 505“ zugeordnet sind
- **THEN** zeigt ihr Knoten „TMO 311“ und „DMO 505“, so wie ihre Zeile in der Tabelle

#### Scenario: Einheit ohne Sprechgruppe

- **WHEN** einer Einheit keine Sprechgruppe zugeordnet ist
- **THEN** zeigt ihr Knoten „keine Sprechgruppe“ als Wort

#### Scenario: Erreichbarkeit bleibt in der Tabelle

- **WHEN** einer Einheit eine Erreichbarkeit erfasst ist
- **THEN** erscheint sie in der Skizze weder am Bildschirm noch im Druck

### Requirement: Kante mit gemeinsamer Sprechgruppe

Die Kante zwischen einer Stelle und ihrer übergeordneten Stelle (Abschnitt oder Einheit) SHALL die
Sprechgruppen tragen, die beiden zugeordnet sind, getrennt nach TMO und DMO. Verglichen wird die
Sprechgruppe selbst, nicht ihre Bezeichnung. Kanten unter der Wurzel und unter dem Sammelknoten
MUST NOT eine Sprechgruppe oder ein Urteil tragen.

#### Scenario: Gemeinsamer Kanal

- **WHEN** „EA Nord“ die Sprechgruppen „TMO 311“ und „DMO 505“ trägt und die ihm zugeordnete
  Einheit „1. Zug“ „DMO 505“
- **THEN** trägt die Kante zwischen beiden „DMO 505“ und nicht „TMO 311“

#### Scenario: Einheit ohne Abschnitt

- **WHEN** eine Einheit keinem Abschnitt zugeordnet ist
- **THEN** steht sie unter „Ohne Abschnitt“, und ihre Kante trägt weder Sprechgruppe noch Lücke

### Requirement: Fehlender gemeinsamer Kanal als benannte Lücke

Tragen eine Stelle und ihre übergeordnete Stelle je mindestens eine Sprechgruppe, aber keine
gemeinsame, SHALL die Kante „keine gemeinsame Sprechgruppe“ als Wort mit einem Zeichen zeigen,
nicht nur als Farbe. Fehlt einer Seite jede Sprechgruppe, MUST die Kante ohne Urteil bleiben, denn
die Lücke steht schon am Knoten. Die Zahl der Lücken MUST dieselbe sein wie im Lücken-Paneel.

#### Scenario: Kein gemeinsamer Kanal

- **WHEN** „EA Nord“ nur „TMO 311“ trägt und die ihm zugeordnete Einheit „1. Zug“ nur „DMO 505“
- **THEN** zeigt die Kante „keine gemeinsame Sprechgruppe“, und das Lücken-Paneel zählt diese
  Verbindung

#### Scenario: Unterabschnitt ohne Sprechgruppe

- **WHEN** ein Unterabschnitt keine Sprechgruppe trägt
- **THEN** zeigt sein Knoten „keine Sprechgruppe“, und seine Kante bleibt ohne Urteil

### Requirement: Einsatzleitung ohne erfundene Gegenstelle

Solange der Einsatz die eigene Führungsstelle nicht als Datum kennt, SHALL die Wurzel
„Einsatzleitung“ „Gegenstelle nicht erfasst“ zeigen. Die Skizze MUST NOT einen Rufnamen oder eine
Sprechgruppe für die Einsatzleitung aus anderen Daten ableiten. Eine Stabsstelle MUST NOT in der
Skizze erscheinen.

#### Scenario: Wurzel

- **WHEN** die Skizze geöffnet wird
- **THEN** trägt die Wurzel „Einsatzleitung“ den Hinweis „Gegenstelle nicht erfasst“ und keine
  Sprechgruppe, und die Kanten der ersten Ebene tragen kein Urteil

### Requirement: Fehlende Quellen werden benannt

Sind die Abschnitte gesperrt oder nicht geladen, SHALL die Skizze statt des Baums den Grund nennen
und MUST NOT Einheiten als „Ohne Abschnitt“ zeigen. Fehlen nur die Einheiten, SHALL die Skizze die
Abschnitte zeigen und den Grund nennen. Eine fehlende Quelle MUST NOT als leerer Bestand
erscheinen.

#### Scenario: Abschnitte gesperrt

- **WHEN** die Abschnittsliste mit 403 abgelehnt wird
- **THEN** zeigt die Skizze „Abschnitte: nicht freigegeben“ und keinen Sammelknoten

#### Scenario: Einheiten nicht geladen

- **WHEN** der Abruf der Einheiten scheitert
- **THEN** zeigt die Skizze die Abschnitte mit ihren Sprechgruppen und den Hinweis „Einheiten:
  nicht geladen“

### Requirement: Lesbar ohne waagerechtes Scrollen

Die Skizze SHALL bei 1366 × 768 mit offenem Modulpanel (Fükw), bei 1024 und 768 px (Tablet) und
bei 390 px (mobil) ohne waagerechtes Scrollen der Seite und ohne waagerechten Überhang der Skizze
lesbar sein. Die erste Ebene MUST in Spalten umbrechen, die tieferen Ebenen MUST senkrecht darunter
hängen. Lange Rufnamen und Sprechgruppen MUST umbrechen und MUST NOT gekürzt werden.

#### Scenario: Viele Abschnitte am Fükw

- **WHEN** ein Einsatz acht oberste Abschnitte mit je drei Einheiten mit je zwei Sprechgruppen hat
  und die Skizze bei 1366 × 768 mit offenem Modulpanel gezeigt wird
- **THEN** stehen die Abschnitte in mehreren Zeilen von Spalten, und weder Seite noch Skizze laufen
  waagerecht über

### Requirement: Ein- und Ausklappen

Jeder Knoten mit Kindern SHALL über ein eigenes Bedienziel ein- und ausklappbar sein, das seinen
Zustand für Hilfstechnik trägt. Dazu kommen „Alle aufklappen“ und „Alle zuklappen“. Die Skizze MUST
aufgeklappt starten, und ein live hinzukommender Knoten MUST aufgeklappt erscheinen. Bedienziele
MUST die Dichte-Staffel halten.

#### Scenario: Abschnitt zuklappen

- **WHEN** eine Person einen Abschnitt in der Skizze zuklappt
- **THEN** sind seine Unterabschnitte und Einheiten verborgen, sein Knoten mit Sprechgruppen bleibt
  stehen, und das Bedienziel meldet „zugeklappt“

### Requirement: Druck als eigenes Druckstück

Die Skizze SHALL über „Drucken / als PDF“ als eigenes Druckstück mit der Dokumentart
„Fernmeldeskizze“ druckbar sein, mit dem gemeinsamen Druckkopf und dem Lücken-Paneel. Vor dem Druck
MUST alles aufgeklappt werden. Im Ausdruck MUST die Skizze auf A4 hochkant ohne waagerechten
Überhang stehen, und Bedienelemente MUST fehlen. Die Anforderungen der Capability
`druck-dokumente` gelten unverändert.

#### Scenario: Druck aus der Skizze

- **WHEN** ein Abschnitt zugeklappt ist und die Person in der Skizze „Drucken / als PDF“ wählt
- **THEN** nennt der Druckkopf „Fernmeldeskizze“, der Ausdruck enthält auch die Einheiten dieses
  Abschnitts, und kein Knoten ragt über die Seitenbreite

#### Scenario: Druck aus der Tabelle

- **WHEN** die Person in der Tabelle „Drucken / als PDF“ wählt
- **THEN** nennt der Druckkopf „Funkplan“, und der Ausdruck enthält die Tabelle, nicht die Skizze

### Requirement: Deeplinks statt Bearbeitung

Der Name eines Abschnittsknotens SHALL zum ausgewählten Abschnitt der Abschnittsseite führen, der
Name eines Einheitsknotens zur Detailseite der Einheit. Dort werden Rufname und Sprechgruppen
gepflegt. Die Skizze MUST keine Bearbeitungsmöglichkeit bieten.

#### Scenario: Lücke beheben

- **WHEN** die Person an einer Kante mit „keine gemeinsame Sprechgruppe“ auf den Namen der Einheit
  tippt
- **THEN** öffnet sich die Detailseite dieser Einheit

### Requirement: Übernahme in den Lagebericht über den Funkplan

Die Skizze SHALL keine eigene Übernahme anbieten. In beiden Darstellungen SHALL dieselbe Aktion
„In Lagebericht übernehmen“ des Funkplans stehen, mit denselben Bedingungen. Der übernommene Text
MUST die Lücke „Verbindungen ohne gemeinsame Sprechgruppe“ mit Anzahl und betroffenen Stellen
enthalten.

#### Scenario: Übernahme aus der Skizze

- **WHEN** eine berechtigte Person in der Skizze „In Lagebericht übernehmen“ wählt
- **THEN** entsteht genau ein Lagebericht „Funkplan <DTG>“ mit derselben Gliederung wie aus der
  Tabelle und der Zeile zu den Verbindungen ohne gemeinsame Sprechgruppe
