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
unter dem Sammelknoten „Ohne Abschnitt“, der nur erscheint, wenn es solche Einheiten gibt. Eine
unterstellte Einheit, die selbst in einem anderen Abschnitt steht als ihre übergeordnete Einheit,
MUST wie im Meldebild unter ihrem eigenen Abschnitt stehen und „aus <Name der übergeordneten
Einheit>“ tragen. Die Fernmeldeskizze, die diesen Baum als Vorlage liest, MUST den Verband behalten
wie der Funkplan.

#### Scenario: Unterstellte Einheit

- **WHEN** Einheit B der Einheit A unterstellt ist und A dem Abschnitt „EA Nord“ zugeordnet ist
- **THEN** steht B unter A, und A steht unter „EA Nord“

#### Scenario: Unterstellte Einheit in einem anderen Abschnitt

- **WHEN** die „Sanitätsgruppe UHS“ dem „Sanitätszug“ im Abschnitt „EA 1“ unterstellt ist und selbst
  im Unterabschnitt „UHS Turnhalle“ steht
- **THEN** steht sie im Organigramm unter „UHS Turnhalle“ mit „aus Sanitätszug“, nicht unter dem
  Sanitätszug
- **AND** hängt sie in der Fernmeldeskizze weiter am Sanitätszug, wie im Funkplan

#### Scenario: Keine Einheit ohne Abschnitt

- **WHEN** alle Einheiten einem Abschnitt zugeordnet sind
- **THEN** gibt es keinen Knoten „Ohne Abschnitt“

### Requirement: Knoteninhalt ohne erfundene Angaben

Jeder Abschnitts- und Einheitsknoten SHALL seine Bezeichnung, seinen Rufnamen, seine Leitung und
seine Stärke in der Schreibweise `F/UF/M//Σ` zeigen. Rufname ist beim Abschnitt die
Kurzbezeichnung und bei der Einheit der Funkrufname. Leitung ist beim Abschnitt der
Abschnittsleiter und bei der Einheit der Führer. Eine fehlende Angabe MUST als benannte Abwesenheit
erscheinen, also „kein Rufname“, „Leitung nicht besetzt“ oder „—“ bei der Stärke, und MUST NOT
geraten werden. „Leitung nicht besetzt“ MUST am Knoten gedämpft stehen und MUST NOT in einer
Warn- oder Alarmrolle erscheinen; die Warnung trägt die Sammelzeile der fehlenden Leitung.

#### Scenario: Abschnitt ohne Leitung

- **WHEN** ein Abschnitt keinen Abschnittsleiter hat
- **THEN** zeigt sein Knoten „Leitung nicht besetzt“, und zwar als Wort, nicht nur als Farbe

#### Scenario: Leitung nicht besetzt ist am Knoten leise

- **WHEN** eine Einheit keinen Führer hat
- **THEN** steht an ihrem Knoten „Leitung nicht besetzt“ in derselben gedämpften Farbe wie der
  Rufname und nicht in Achtungrolle

#### Scenario: Einheit ohne Funkrufname

- **WHEN** eine Einheit keinen Funkrufnamen trägt
- **THEN** zeigt ihr Knoten „kein Rufname“, und kein Wert wird aus dem Namen abgeleitet

### Requirement: Stärke aus derselben Rechnung wie die Abschnittsseite

Die Stärke eines Abschnittsknotens SHALL die Stärke einschließlich aller Unterabschnitte sein. Sie
MUST mit dem Wert übereinstimmen, den der Gliederungsbaum derselben Seite für diesen Abschnitt
zeigt. Die Stärke eines Einheitsknotens SHALL ihre eigene Ist-Stärke samt der unterstellten
Einheiten sein, die unter ihr stehen; eine unterstellte Einheit unter einem anderen Abschnitt zählt
dort. Die Wurzel „Einsatzleitung“ MUST NOT eine eigene Gesamtstärke zeigen, denn die Kräftezahl des
Einsatzes hat ihre Heimat im Meldebild.

#### Scenario: Gleiche Zahl in beiden Ansichten

- **WHEN** ein Abschnitt mit zwei Unterabschnitten und je einer Einheit in der Gliederung
  „1/2/9//12“ zeigt
- **THEN** zeigt derselbe Abschnitt im Organigramm „1/2/9//12“

#### Scenario: Abschnitt ohne Einheiten

- **WHEN** einem Abschnitt und seinen Unterabschnitten keine Einheit zugeordnet ist
- **THEN** zeigt sein Knoten „—“ und nicht „0/0/0//0“

#### Scenario: Einheitsknoten ohne abgestellte Gruppe

- **WHEN** der Sanitätszug selbst 1/0/2 hat und seine Gruppe (0/1/1) im Unterabschnitt „UHS
  Turnhalle“ steht
- **THEN** zeigt der Zugknoten 1/0/2//3 und der Gruppenknoten unter „UHS Turnhalle“ 0/1/1//2

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

Die Wurzel „Einsatzleitung“ SHALL den an der eigenen Führungsstelle erfassten Einsatzleiter mit
seinem „seit“ zeigen, in derselben Darstellung wie die Kopfleiste der Einsatzdaten. Ist kein
Einsatzleiter erfasst, SHALL sie „Leitung nicht erfasst“ zeigen. Kann die Führungsstelle nicht
geladen werden, SHALL sie den Grund nennen. Die Wurzel MUST NOT eine Leitung aus der App-Rolle
Einsatzleitung, aus den Führungsfunktionen der Mitglieder oder aus anderen Daten ableiten.

Die Übernahme in den Lagebericht SHALL unter „Einsatzleitung“ dieselbe Angabe tragen. Solange die
Führungsstelle lädt, MUST die Übernahme gesperrt sein. Das gilt für beide Wege: „In Lagebericht
übernehmen“ am Organigramm und „Aus Kräfteübersicht und Führungsorganisation übernehmen“.

Führt mindestens ein Mitglied des Einsatzes in seiner Mitgliedschaft ein Sachgebiet S1–S6, SHALL
neben der Wurzel eine Stabsstelle „Stab“ stehen, mit jedem so geführten Sachgebiet und den Namen
seiner Mitglieder (Spec `fuehrungsfunktionen`, „Mehrere Mitglieder mit derselben Führungsfunktion“).
Ein Sachgebiet ohne Mitglied MUST fehlen; einen Zustand „nicht besetzt“ gibt es dort nicht. Führt
kein Mitglied ein Sachgebiet oder sind die Mitglieder noch nicht oder nicht geladen, MUST die
Stabsstelle fehlen. Eine Modulfreigabe MUST dafür nicht nötig sein.

#### Scenario: Einsatzleiter erfasst

- **WHEN** an der Führungsstelle „Anna Schulz“ seit 111430 als Einsatzleiter erfasst ist
- **THEN** zeigt die Wurzel „Einsatzleitung“ „Anna Schulz“ und „seit 111430“

#### Scenario: Kein Einsatzleiter, aber App-Rolle

- **WHEN** kein Einsatzleiter erfasst ist und ein Mitglied die Einsatzrolle Einsatzleitung trägt
- **THEN** zeigt die Wurzel „Leitung nicht erfasst“ und keinen Namen

#### Scenario: Übernahme mit Einsatzleiter

- **WHEN** der Einsatzleiter „KBM Weber (extern)“ erfasst ist und die Person „In Lagebericht übernehmen“ wählt
- **THEN** steht im neuen Lagebericht unter „Einsatzleitung“ „KBM Weber (extern)“ mit seinem „seit“, als Text und nicht als Markup

#### Scenario: Stab freigegeben

- **WHEN** ein Mitglied in seiner Mitgliedschaft S2 führt und kein Mitglied S1, S3, S4, S5 oder S6
- **THEN** zeigt die Stabsstelle nur „S2“ mit dem Namen dieses Mitglieds

#### Scenario: Stab gesperrt

- **WHEN** kein Mitglied des Einsatzes ein Sachgebiet S1–S6 führt
- **THEN** zeigt das Organigramm keine Stabsstelle

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
verschachtelte Liste mit Rufname, Leitung und Stärke, an einem beurteilten Abschnitt dazu „Lage
<Zustand>“, und unter „Gliederung“ die Teile der Sammelzeile, wenn eine Leitung fehlt. Namen
erscheinen als Text, nie als Markup. Solange eine Quelle lädt, MUST die
Aktion gesperrt sein. Ein Fehler MUST an der Seite stehen.

#### Scenario: Erfolgreiche Übernahme

- **WHEN** eine berechtigte Person „In Lagebericht übernehmen“ wählt
- **THEN** wird genau ein `POST …/lageberichte` mit Startinhalt gesendet und kein PATCH, und die
  Person landet im neuen Bericht

#### Scenario: Übernahme mit Lagezustand und Lücken

- **WHEN** der Abschnitt „UHS Turnhalle“ als kritisch beurteilt ist, zwei Abschnitte keinen
  Abschnittsleiter haben und die Person „In Lagebericht übernehmen“ wählt
- **THEN** trägt die Zeile von „UHS Turnhalle“ im Bericht „Lage kritisch“, und unter
  „Gliederung“ steht „2 Abschnitte ohne Leitung“

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

### Requirement: Organigramm hält seine Knoten, solange jemand damit arbeitet
Solange der Mauszeiger oder ein Stift über dem Organigramm liegt oder der Fokus darin steht, SHALL
das Organigramm Menge, Ort und Reihenfolge seiner Knoten halten. Neue, umgehängte, umsortierte
und entfallene Knoten MUST warten; ein entfallener Knoten bleibt als Platzhalter ohne Link mit dem
Wort „entfallen“ stehen, und ein Fokus auf ihm MUST im Organigramm bleiben. Name, Rufname, Leitung
und Stärke gezeigter Knoten MUST weiter live aktualisieren, außer bei einem umgehängten Knoten am
alten Ort. Der Inhalt des Kopfs mit Einsatzleitung und Stab MUST still stehen; seine Anordnung
folgt der Breite.

#### Scenario: Fokussierter Link bleibt stehen
- **WHEN** der Fokus auf einem Namenslink im Organigramm steht und an einem anderen Arbeitsplatz
  ein oberster Abschnitt angelegt wird
- **THEN** bleibt der fokussierte Link an derselben Stelle, der neue Abschnitt steht noch nicht im
  Organigramm, und der Sammelbanner nennt einen neuen Knoten

#### Scenario: Zeiger über dem Organigramm
- **WHEN** der Mauszeiger auf einem Namenslink liegt und live ein Unterabschnitt unter einen
  anderen Abschnitt gehängt wird
- **THEN** bleibt der Link unter dem Zeiger an derselben Stelle, der Unterabschnitt steht noch am
  alten Ort, und der Sammelbanner nennt einen umgehängten Knoten

#### Scenario: Stärke fließt weiter
- **WHEN** der Mauszeiger über dem Organigramm liegt und live die Stärke einer gezeigten Einheit
  geändert wird
- **THEN** zeigen die Einheit und ihr Abschnitt sofort die neue Stärke an derselben Stelle

#### Scenario: Aufgelöster Abschnitt bleibt als Platzhalter
- **WHEN** der Fokus im Organigramm steht und live ein gezeigter Abschnitt aufgelöst wird
- **THEN** steht an seiner Stelle sein Name ohne Link mit dem Wort „entfallen“, und der
  Sammelbanner nennt einen entfallenen Knoten

#### Scenario: Fokus auf dem aufgelösten Abschnitt
- **WHEN** der Fokus auf dem Namenslink eines Abschnitts steht und live genau dieser Abschnitt
  aufgelöst wird
- **THEN** steht der Platzhalter an derselben Stelle, und der Fokus liegt auf der Zeile des
  Sammelbanners statt auf dem Seitenanfang

#### Scenario: Ohne Zeiger und Fokus gilt der Live-Stand sofort
- **WHEN** weder Zeiger noch Fokus im Organigramm liegen und live ein Abschnitt angelegt wird
- **THEN** erscheint er sofort, und es steht kein Sammelbanner

### Requirement: Sammelbanner des Organigramms
Wartet bei geschlossener Schleuse mindestens eine Änderung, SHALL im Organigramm zwischen Kopf und
erster Ebene ein Sammelbanner stehen. Er MUST nennen, wie viele Knoten neu, umgehängt, umsortiert oder entfallen sind, und eine
Aktion „anzeigen“ bieten, die den Live-Stand anwendet. Die Zeile, in der er steht, MUST eine feste
Höhe haben, damit sein Erscheinen und Verschwinden das Organigramm nicht verschiebt. Der Weg des
Zeigers vom Organigramm zum Banner MUST die Schleuse nicht öffnen.

#### Scenario: „anzeigen“ wendet den Stand an
- **WHEN** Änderungen warten und die Person im Sammelbanner „anzeigen“ wählt
- **THEN** zeigt das Organigramm den Live-Stand, und der Sammelbanner verschwindet

#### Scenario: Banner verschiebt das Organigramm nicht
- **WHEN** der Sammelbanner bei 390 px oder 1366 px Breite erscheint oder verschwindet
- **THEN** bleibt die Oberkante der ersten Ebene des Organigramms auf derselben Höhe

#### Scenario: Zeiger verlässt das Organigramm
- **WHEN** Änderungen warten und Zeiger und Fokus das Organigramm verlassen
- **THEN** zeigt das Organigramm den Live-Stand, und der Sammelbanner verschwindet

### Requirement: Druck und Übernahme zeigen den Live-Stand
Druck und „In Lagebericht übernehmen“ SHALL immer den aktuellen Stand der Gliederung zeigen, auch
wenn die Schleuse am Bildschirm gerade Änderungen hält. Der Sammelbanner und seine Zeile MUST im
Ausdruck fehlen.

#### Scenario: Druck bei wartender Änderung
- **WHEN** ein neuer Abschnitt hinter dem Sammelbanner wartet und die Person „Drucken / als PDF“
  wählt
- **THEN** enthält der Ausdruck den neuen Abschnitt, und weder Banner noch Standzeile stehen darauf

### Requirement: Führungsstelle an der Wurzel
Ist die eigene Führungsstelle erfasst, SHALL die Wurzel „Einsatzleitung“ ihre Bezeichnung und ihren
Rufnamen zeigen, soweit gesetzt, am Bildschirm, im Druck und in der Übernahme in den Lagebericht
gleich. „Leitung nicht erfasst“ MUST bleiben, denn die Führungsstelle nennt keine Person. Ist sie
nicht erfasst oder ihr Abruf gescheitert, MUST die Wurzel aussehen wie ohne diese Anforderung.

#### Scenario: Wurzel mit Führungsstelle
- **WHEN** die Führungsstelle „ELW 2 Musterstadt“ mit Rufname „Florian Musterstadt 10/1“ erfasst ist
- **THEN** zeigt die Wurzel „Einsatzleitung“, „ELW 2 Musterstadt“, „Florian Musterstadt 10/1“ und „Leitung nicht erfasst“

#### Scenario: Führungsstelle ohne Bezeichnung
- **WHEN** die Führungsstelle nur einen Rufnamen trägt
- **THEN** zeigt die Wurzel den Rufnamen und keine erfundene Bezeichnung

### Requirement: Lagezustand am Abschnittsknoten

Ein Abschnittsknoten SHALL den gepflegten Lagezustand seines Abschnitts als Etikett neben dem Namen
zeigen, in derselben Form wie der Gliederungsbaum: Rand in der Rolle der Stufe und das Wort
„planmäßig“, „angespannt“ oder „kritisch“. Ein nicht beurteilter Abschnitt MUST ohne Etikett
bleiben. Der Knoten MUST nur den eigenen Zustand zeigen, keinen aus Unterabschnitten.

#### Scenario: Kritischer Abschnitt

- **WHEN** der Abschnitt „UHS Turnhalle“ als kritisch beurteilt ist
- **THEN** trägt sein Knoten neben dem Namen das Etikett „kritisch“ in Alarmrolle

#### Scenario: Nicht beurteilter Abschnitt

- **WHEN** an einem Abschnitt kein Lagezustand gepflegt ist
- **THEN** trägt sein Knoten kein Lagezustandsetikett, auch kein neutrales

#### Scenario: Unterabschnitt schlechter als sein Abschnitt

- **WHEN** ein planmäßiger Abschnitt einen kritischen Unterabschnitt hat
- **THEN** trägt der Abschnitt „planmäßig“ und der Unterabschnitt darunter „kritisch“

### Requirement: Lagezustand fließt live

Eine Änderung des Lagezustands SHALL am gezeigten Knoten live erscheinen, auch während die Schleuse
die Struktur hält. Ausgenommen MUST ein umgehängter Knoten am alten Ort sein: er zeigt seinen
gehaltenen Inhalt bis „anzeigen“ oder bis die Schleuse öffnet.

#### Scenario: Zustand ändert sich, während der Zeiger über dem Organigramm liegt

- **WHEN** der Mauszeiger über dem Organigramm liegt und an einem anderen Arbeitsplatz ein
  gezeigter Abschnitt auf „kritisch“ gesetzt wird
- **THEN** zeigt sein Knoten an derselben Stelle sofort „kritisch“, ohne Sammelbanner

### Requirement: Sammelzeile der fehlenden Leitung

Über dem Organigramm SHALL eine Sammelzeile die Knoten ohne Leitung zählen, je Art ein Etikett in
Achtungrolle: Abschnitte ohne Abschnittsleiter, Einheiten ohne Führer, Wort in Einzahl oder
Mehrzahl. Ein Teil mit 0 MUST entfallen. Gezählt werden alle Knoten im Live-Stand, Einheiten ohne
Abschnitt und unterstellte eingeschlossen. Die Zeile MUST auch im Druck stehen.

#### Scenario: Abschnitte und Einheiten ohne Leitung

- **WHEN** zwei Abschnitte keinen Abschnittsleiter und sieben Einheiten keinen Führer haben
- **THEN** stehen über dem Organigramm die Etiketten „2 Abschnitte ohne Leitung“ und „7 Einheiten
  ohne Führer“

#### Scenario: Nur eine Einheit ohne Führer

- **WHEN** alle Abschnitte einen Abschnittsleiter haben und genau eine Einheit keinen Führer
- **THEN** steht über dem Organigramm nur das Etikett „1 Einheit ohne Führer“

#### Scenario: Einheiten nicht geladen

- **WHEN** die Abschnitte geladen sind, die Einheiten aber nicht, und ein Abschnitt keinen
  Abschnittsleiter hat
- **THEN** nennt die Sammelzeile „1 Abschnitt ohne Leitung“ und keine Zahl zu Einheiten, auch
  nicht „0“

#### Scenario: Druck mit Lücken

- **WHEN** ein Abschnitt keinen Abschnittsleiter hat und die Person „Drucken / als PDF“ wählt
- **THEN** steht die Sammelzeile auch im Ausdruck über dem Organigramm

### Requirement: Sammelzeile ohne Lücke und ohne Sprung

Die Sammelzeile SHALL immer gleich hoch dastehen, auch während die Schleuse die Struktur hält.
Fehlt keine Leitung, MUST sie leise „Leitung überall besetzt“ nennen, bei nicht geladenen Einheiten
„Alle Abschnitte mit Leitung“, ohne Etikett in Achtungrolle; ohne jeden Knoten bleibt sie leer.
Ihr Wechsel MUST den Baum nicht verschieben.

#### Scenario: Alles besetzt

- **WHEN** jeder Abschnitt einen Abschnittsleiter und jede Einheit einen Führer hat
- **THEN** steht über dem Organigramm leise „Leitung überall besetzt“ und kein Etikett in
  Achtungrolle

#### Scenario: Leitung fällt weg, während jemand im Organigramm arbeitet

- **WHEN** alle Knoten besetzt sind, der Mauszeiger über dem Organigramm liegt und live an einer
  gezeigten Einheit der Führer gelöscht wird
- **THEN** zeigen der Knoten „Leitung nicht besetzt“ und die Sammelzeile „1 Einheit ohne Führer“
  sofort, und die erste Ebene des Organigramms bleibt auf derselben Höhe

#### Scenario: Neue Lücke wartet hinter dem Sammelbanner

- **WHEN** der Mauszeiger über dem Organigramm liegt und live eine Einheit ohne Führer hinzukommt
- **THEN** zählt die Sammelzeile sie sofort, während der Knoten hinter dem Sammelbanner wartet, und
  weder „anzeigen“ noch das Verlassen verschiebt die erste Ebene
