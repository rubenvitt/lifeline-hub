# fuehrungsorganisation Specification

## Purpose
Zeigt die Führungsorganisation eines Einsatzes nach FwDV 100 als Organigramm, das allein aus der
gepflegten Einsatzgliederung abgeleitet wird. Man kann es lesen, drucken und in den Lagebericht
übernehmen, und eine eigene Datenhaltung entsteht dabei nicht.

## Requirements

### Requirement: Ansicht der Abschnittsseite statt eigenem Modul

Das Organigramm SHALL als zweite Ansicht der Seite Einsatzabschnitte erreichbar sein. Ein
Umschalter „Gliederung | Organigramm“ steht im Seitenkopf und ist auch ohne Schreibrecht sichtbar.
Die Sichtvorgabe `?ansicht=organigramm` öffnet die Ansicht. Danach wird der Parameter aus der
Adresse entfernt, ein unbrauchbarer Wert ebenso. Das Organigramm MUST NOT als eigenes Modul in der
Navigation erscheinen.

#### Scenario: Umschalten ohne Schreibrecht

- **WHEN** eine Person mit Leserecht die Seite Einsatzabschnitte öffnet und „Organigramm“ wählt
- **THEN** zeigt die Seite das Organigramm statt Gliederungsbaum und Detail

#### Scenario: Sichtvorgabe aus einem Link

- **WHEN** eine Person `/einsaetze/:id/einsatzabschnitte?ansicht=organigramm` öffnet
- **THEN** steht die Ansicht auf „Organigramm“, und `ansicht` ist aus der Adresse entfernt

#### Scenario: Unbrauchbarer Wert

- **WHEN** eine Person `?ansicht=quatsch` öffnet
- **THEN** bleibt die Ansicht „Gliederung“, und der Parameter ist aus der Adresse entfernt

### Requirement: Abgeleitet und live

Das Organigramm SHALL allein aus den Abschnitten und Einheiten des Einsatzes entstehen, ohne eigene
Speicherung. Eine Änderung an der Gliederung MUST ohne Neuladen der Seite im Organigramm
erscheinen: ein Abschnitt wird angelegt, umgehängt oder aufgelöst, eine Einheit wird zugeordnet
oder umgehängt.

#### Scenario: Abschnitt wird umgehängt

- **WHEN** an einem anderen Arbeitsplatz ein Unterabschnitt unter einen anderen Abschnitt gehängt
  wird, während das Organigramm offen ist
- **THEN** steht er danach ohne Neuladen unter dem neuen Abschnitt, und die Stärken beider
  Abschnitte sind angepasst

#### Scenario: Einheit wird zugeordnet

- **WHEN** einer Einheit ein Abschnitt zugeordnet wird
- **THEN** wandert sie im Organigramm aus „Ohne Abschnitt“ unter diesen Abschnitt

### Requirement: Knotenaufbau

Das Organigramm SHALL diesen Baum zeigen:

- Wurzel „Einsatzleitung“
- darunter die obersten Abschnitte
- unter einem Abschnitt seine Unterabschnitte und dann seine obersten Einheiten
- unter einer Einheit ihre unterstellten Einheiten

Ein Abschnitt, dessen übergeordneter Abschnitt fehlt, MUST als oberster Abschnitt erscheinen. Für
eine Einheit ohne bekannte übergeordnete Einheit gilt dasselbe. Einheiten ohne Abschnitt stehen
unter dem Sammelknoten „Ohne Abschnitt“, der nur erscheint, wenn es solche Einheiten gibt.

#### Scenario: Unterstellte Einheit

- **WHEN** Einheit B der Einheit A unterstellt ist und A dem Abschnitt „EA Nord“ zugeordnet ist
- **THEN** steht B unter A, und A steht unter „EA Nord“

#### Scenario: Keine Einheit ohne Abschnitt

- **WHEN** alle Einheiten einem Abschnitt zugeordnet sind
- **THEN** gibt es keinen Knoten „Ohne Abschnitt“

### Requirement: Knoteninhalt ohne erfundene Angaben

Jeder Abschnitts- und Einheitsknoten SHALL seine Bezeichnung, seinen Rufnamen, seine Leitung und
seine Stärke in der Schreibweise `F/UF/M//Σ` zeigen. Rufname ist beim Abschnitt die
Kurzbezeichnung und bei der Einheit der Funkrufname. Leitung ist beim Abschnitt der
Abschnittsleiter und bei der Einheit der Führer. Eine fehlende Angabe MUST als benannte Abwesenheit
erscheinen, also „kein Rufname“, „Leitung nicht besetzt“ oder „—“ bei der Stärke, und MUST NOT
geraten werden.

#### Scenario: Abschnitt ohne Leitung

- **WHEN** ein Abschnitt keinen Abschnittsleiter hat
- **THEN** zeigt sein Knoten „Leitung nicht besetzt“, und zwar als Wort, nicht nur als Farbe

#### Scenario: Einheit ohne Funkrufname

- **WHEN** eine Einheit keinen Funkrufnamen trägt
- **THEN** zeigt ihr Knoten „kein Rufname“, und kein Wert wird aus dem Namen abgeleitet

### Requirement: Stärke aus derselben Rechnung wie die Abschnittsseite

Die Stärke eines Abschnittsknotens SHALL die Stärke einschließlich aller Unterabschnitte sein. Sie
MUST mit dem Wert übereinstimmen, den der Gliederungsbaum derselben Seite für diesen Abschnitt
zeigt. Die Stärke eines Einheitsknotens SHALL ihre kumulierte Ist-Stärke sein. Die Wurzel
„Einsatzleitung“ MUST NOT eine eigene Gesamtstärke zeigen, denn die Kräftezahl des Einsatzes hat
ihre Heimat im Meldebild.

#### Scenario: Gleiche Zahl in beiden Ansichten

- **WHEN** ein Abschnitt mit zwei Unterabschnitten und je einer Einheit in der Gliederung
  „1/2/9//12“ zeigt
- **THEN** zeigt derselbe Abschnitt im Organigramm „1/2/9//12“

#### Scenario: Abschnitt ohne Einheiten

- **WHEN** einem Abschnitt und seinen Unterabschnitten keine Einheit zugeordnet ist
- **THEN** zeigt sein Knoten „—“ und nicht „0/0/0//0“

### Requirement: Taktische Zeichen als Zierde

Abschnitts- und Einheitsknoten SHALL ihr taktisches Zeichen aus der bestehenden Zeichenbibliothek
tragen. Es wird gleich abgeleitet wie auf der Lagekarte. Das Zeichen MUST für Hilfstechnik
verborgen sein, denn die Bezeichnung trägt die Bedeutung. Ist kein Zeichen darstellbar, entfällt
es ohne Platzhalter.

#### Scenario: Einheit mit Typ „Zug“

- **WHEN** eine Einheit vom Typ „Zug“ angezeigt wird
- **THEN** trägt ihr Knoten das Zeichen einer taktischen Formation in Zuggröße, und der zugängliche
  Name des Knotens nennt die Einheit, nicht das Zeichen

### Requirement: Einsatzleitung und Stab

Die Wurzel „Einsatzleitung“ SHALL „Leitung nicht erfasst“ zeigen, solange der Einsatz keine eigene
Führungsstelle als Datum kennt. Ist das Modul Stab für die betrachtende Person freigegeben, SHALL
neben der Wurzel eine Stabsstelle „Stab“ mit den besetzten Sachgebieten und ihrer Besetzung stehen.
Ist der Stab nicht freigegeben oder seine Freigabe noch nicht ermittelt, MUST die Stabsstelle
fehlen, und es MUST kein Name aus dem Stab erscheinen.

#### Scenario: Stab freigegeben

- **WHEN** der Stab freigegeben ist und S2 mit einer Person besetzt ist
- **THEN** zeigt die Stabsstelle „S2“ mit dem Namen dieser Person

#### Scenario: Stab gesperrt

- **WHEN** das Modul Stab für die Person nicht freigegeben ist
- **THEN** zeigt das Organigramm keine Stabsstelle, und es wird kein Abruf der Stabsbesetzung
  ausgelöst

### Requirement: Lesbar ohne waagerechtes Scrollen

Das Organigramm SHALL bei 1366 × 768 mit offenem Modulpanel (Fükw), bei 1024 und 768 px (Tablet)
und bei 390 px (mobil) ohne waagerechtes Scrollen der Seite und ohne waagerechten Überhang des
Organigramms lesbar sein. Die erste Ebene unter der Einsatzleitung MUST dafür in Spalten
umbrechen, die tieferen Ebenen MUST senkrecht darunter hängen.

#### Scenario: Viele oberste Abschnitte am Fükw

- **WHEN** ein Einsatz acht oberste Abschnitte mit je drei Einheiten hat und das Organigramm bei
  1366 × 768 mit offenem Modulpanel gezeigt wird
- **THEN** stehen die Abschnitte in mehreren Zeilen von Spalten, und weder Seite noch Organigramm
  laufen waagerecht über

### Requirement: Ein- und Ausklappen

Jeder Knoten mit Kindern SHALL über ein eigenes Bedienziel ein- und ausklappbar sein. Das
Bedienziel trägt seinen Zustand für Hilfstechnik. Dazu kommen „Alle aufklappen“ und „Alle
zuklappen“. Das Organigramm MUST aufgeklappt starten. Ein live hinzukommender Knoten MUST
aufgeklappt erscheinen. Bedienziele MUST die Dichte-Staffel halten.

#### Scenario: Abschnitt zuklappen

- **WHEN** eine Person einen Abschnitt zuklappt
- **THEN** sind seine Unterabschnitte und Einheiten verborgen, sein Knoten mit Stärke bleibt
  stehen, und das Bedienziel meldet „zugeklappt“

### Requirement: Druck als eigenes Druckstück

Das Organigramm SHALL über „Drucken / als PDF“ druckbar sein, mit dem gemeinsamen Druckkopf
(Dokumentart „Führungsorganisation“, Einsatz, Stand). Vor dem Druck MUST alles aufgeklappt werden.
Im Ausdruck MUST das Organigramm auf A4 hochkant ohne waagerechten Überhang stehen, dunkel auf
hell. Bedienelemente MUST fehlen.

#### Scenario: Zugeklappter Abschnitt wird gedruckt

- **WHEN** ein Abschnitt zugeklappt ist und die Person „Drucken / als PDF“ wählt
- **THEN** enthält der Ausdruck auch die Einheiten dieses Abschnitts, und kein Knoten ragt über die
  Seitenbreite

### Requirement: In Lagebericht übernehmen

Das Organigramm SHALL „In Lagebericht übernehmen“ anbieten, wenn die Person im Einsatz schreiben
darf und das Modul Lageberichte freigegeben ist. Die Übernahme MUST in genau einem Aufruf einen
Freitext-Lagebericht „Führungsorganisation <DTG>“ anlegen. Er enthält die Gliederung als
verschachtelte Liste mit Rufname, Leitung und Stärke, und Namen erscheinen als Text, nie als
Markup. Solange eine Quelle lädt, MUST die Aktion gesperrt sein. Ein Fehler MUST an der Seite
stehen.

#### Scenario: Erfolgreiche Übernahme

- **WHEN** eine berechtigte Person „In Lagebericht übernehmen“ wählt
- **THEN** wird genau ein `POST …/lageberichte` mit Startinhalt gesendet und kein PATCH, und die
  Person landet im neuen Bericht

#### Scenario: Name mit Markdown-Zeichen

- **WHEN** ein Abschnitt „*Nord* [alt]“ heißt
- **THEN** steht der Name im Bericht wörtlich, ohne Hervorhebung und ohne Link

#### Scenario: Ohne Schreibrecht

- **WHEN** der Einsatz abgeschlossen ist oder die Person nur lesen darf
- **THEN** fehlt die Aktion

### Requirement: Deeplinks aus den Knoten

Der Name eines Abschnittsknotens SHALL zur Abschnittsseite in der Ansicht „Gliederung“ mit diesem
Abschnitt ausgewählt führen. Der Name eines Einheitsknotens SHALL zur Detailseite der Einheit
führen. Bearbeitet wird im Organigramm nichts.

#### Scenario: Abschnitt öffnen

- **WHEN** eine Person im Organigramm auf den Namen „EA Nord“ tippt
- **THEN** zeigt die Seite die Gliederung mit „EA Nord“ ausgewählt und dessen Detail

### Requirement: Quellenzustand ehrlich zeigen

Können die Abschnitte nicht geladen werden und liegt kein früherer Stand vor, SHALL das
Organigramm einen Fehler mit Wiederholen zeigen statt eines leeren Baums. Fehlen die Einheiten,
während die Abschnitte vorliegen, SHALL das Organigramm die Abschnitte zeigen. Ihre Stärke steht
dann als „—“, und ein Hinweis nennt den Grund. Eine fehlende Quelle MUST NOT als „0“ erscheinen.

#### Scenario: Einheiten gesperrt

- **WHEN** die Abschnitte geladen sind, die Einheiten aber nicht abgerufen werden können
- **THEN** zeigt das Organigramm die Abschnitte mit Stärke „—“ und einen Hinweis „Einheiten: nicht
  geladen“
