# stab-funkplan Specification

## Purpose
Der Funkplan des Sachgebiets S6 nach FwDV 100 Anlage 5: eine schreibgeschützte Tabelle, die aus
den erfassten Abschnitten, Einheiten, Fahrzeugen und Sprechgruppen abgeleitet wird. Sie zeigt
auch, was im Funkplan fehlt. Er gehört zum Modul Fernmeldewesen (Fähigkeit `fernmeldewesen`).

## Requirements

### Requirement: Startseite des Moduls Fernmeldewesen
Der Funkplan SHALL die Startseite des Moduls Fernmeldewesen sein, unter dessen Modulroute
`/einsaetze/:id/fernmeldewesen` als Lesezeichen tauglich erreichbar, mit dem Modul Fernmeldewesen
als aktiv in der Navigation. Er SHALL Sichtbarkeit und Sperre des Moduls Fernmeldewesen erben, nicht
die des Stabs; den Fall ohne Zugriff fängt der Einsatzrahmen ab (Capability `modul-freigabe`). Die
alte Adresse `/einsaetze/:id/stab/funkplan` SHALL samt `?ansicht=` auf die neue umleiten. Die
Sachgebietszeile S6 der Stabseite SHALL einen Verweis „Funkplan“ auf diese Adresse tragen, gesperrt,
solange das Fernmeldewesen für die Person gesperrt ist.

#### Scenario: Einstieg aus der Stabseite
- **WHEN** eine Person mit Leserecht auf Stab und Fernmeldewesen in der Zeile S6 auf „Funkplan“ tippt
- **THEN** öffnet sich der Funkplan unter `/einsaetze/:id/fernmeldewesen`, und das Modul
  Fernmeldewesen ist in der Navigation als aktiv markiert

#### Scenario: Direkter Aufruf als Lesezeichen
- **WHEN** die Adresse des Funkplans direkt aufgerufen wird
- **THEN** erscheint der Funkplan ohne Umweg über die Stabseite

#### Scenario: Altes Lesezeichen
- **WHEN** eine Person `/einsaetze/:id/stab/funkplan` aufruft
- **THEN** landet sie auf `/einsaetze/:id/fernmeldewesen` und sieht den Funkplan

#### Scenario: Stab gesperrt
- **WHEN** der Stab für die Person gesperrt oder im Einsatz ausgeblendet ist und das Fernmeldewesen
  frei
- **THEN** zeigt der Funkplan Tabelle, Skizze und Sprechgruppen wie mit Stab

#### Scenario: Fernmeldewesen gesperrt
- **WHEN** das Modul Fernmeldewesen für die Person ausgeblendet oder für ihre Rolle gesperrt ist
- **THEN** zeigt der Rahmen den einheitlichen Hinweis für „Fernmeldewesen“ statt des Funkplans,
  auch wenn der Stab frei ist

Weil die Quellen des Funkplans (Abschnitte, Einheiten, Fahrzeuge, Personal, Sprechgruppen) das
Fernmeldewesen nicht selbst prüfen, MUST die Seite dessen Freigabe ermittelt haben, bevor sie Daten
zeigt, auch wenn der Rahmen bei gescheitertem Freigabeabruf die Seite rendert. Scheitert die
Ermittlung, zeigt sie einen Fehler mit Wiederholen, nicht den Funkplan. Ohne Netz gilt der zuletzt
geladene Stand der Freigaben.

#### Scenario: Freigabe nicht ermittelbar
- **WHEN** der Abruf der Modulfreigaben scheitert
- **THEN** zeigt die Seite einen Fehler mit Wiederholen und weder Tabelle, Skizze noch Übernahme

#### Scenario: Altes Lesezeichen bei ausgeblendetem Stab
- **WHEN** der Stab im Einsatz ausgeblendet ist und eine Person `/einsaetze/:id/stab/funkplan`
  aufruft
- **THEN** landet sie im Funkplan des Moduls Fernmeldewesen, nicht beim Hinweis „Stab ausgeblendet“

### Requirement: Zeilen als Baum Abschnitt → Einheit → Fahrzeug
Der Funkplan SHALL eine Tabelle mit einer Zeile je Abschnitt, je Einheit und je Fahrzeug im
Einsatz zeigen. Die Zeilen bilden einen Baum:
- Unterabschnitte stehen unter ihrem Abschnitt.
- Einheiten stehen unter dem Abschnitt, in dem sie wirken, Untereinheiten unter ihrer Einheit.
- Fahrzeuge stehen unter ihrer Einheit.
- Fahrzeuge, die der eigenen Führungsstelle zugeordnet sind, stehen unter der Zeile der
  Führungsstelle und MUST NOT zugleich unter ihrer Einheit oder im Sammelknoten stehen (LFH-1106).
  Steht keine Zeile der Führungsstelle da, bleiben sie, wo sie ohne Zuordnung stünden.

Einheiten ohne Abschnitt und Fahrzeuge ohne Einheit MUST in einem eigenen, benannten Sammelknoten
stehen und MUST NOT wegfallen. Die Reihenfolge MUST der Sortierung der Quelllisten folgen. Die
Tabelle MUST NOT sortierbar, filterbar oder durchsuchbar sein.

#### Scenario: Vollständiger Baum
- **WHEN** ein Einsatz einen Abschnitt „EA Nord“ mit der Einheit „1. Zug“ hat und dieser das
  Fahrzeug „Florian Musterstadt 1/42-1“ angehört
- **THEN** steht das Fahrzeug unter der Einheit und die Einheit unter dem Abschnitt

#### Scenario: Fahrzeug ohne Einheit
- **WHEN** ein disponiertes Fahrzeug keiner Einheit angehört
- **THEN** erscheint es im Sammelknoten für nicht zugeordnete Kräfte und nicht in einem Abschnitt

#### Scenario: ELW 2 unter der Führungsstelle
- **WHEN** der ELW 2 „Florian Musterstadt 10/1“ der Führungsstelle zugeordnet ist und der Einheit
  „FüGr EL“ angehört
- **THEN** steht seine Zeile unter „Führungsstelle“ und nicht unter „FüGr EL“

### Requirement: Spalten mit fixierter menschenlesbarer Kennung
Die Tabelle SHALL diese Spalten führen: Stelle, Rufname/OPTA, Leiter/Führer, TMO-Sprechgruppen,
DMO-Sprechgruppen, Telefon. Funk und Telefon stehen getrennt: Funk zeigt sich an Rufname und
Sprechgruppen, „Telefon“ zeigt die Verbindungen der Mittel Festnetz und Mobil aus den
Verbindungen des Datensatzes (Capability `stab-kommunikationsplan`, „Verbindungen an Abschnitt,
Einheit und Führungsstelle“). Eine Spalte „Kommunikationsmittel“ oder „Erreichbarkeit“ MUST NOT
es geben.
- Die Spalte „Stelle“ MUST beim waagerechten Bildlauf stehen bleiben und MUST NOT ausblendbar
  sein. Sie MUST eine menschenlesbare Kennung tragen, nie eine Datenbank-Kennung: beim Abschnitt
  und bei der Einheit den Namen, beim Fahrzeug den Funkrufnamen.
- Die Spalte „Rufname/OPTA“ MUST beim Abschnitt den Rufnamen und, wenn keiner erfasst ist, die
  Kurzbezeichnung, bei der Einheit den Funkrufnamen und beim Fahrzeug die OPTA zeigen, jeweils
  nur, wenn sie erfasst sind. Ein fehlender Wert MUST NOT aus anderen Angaben erraten werden.
- Sprechgruppen MUST aus den Zuordnungen stammen, getrennt nach Betriebsart. Die eingefrorenen
  Altfelder der Sprechgruppen MUST NOT verwendet werden.
- Rufnamen, OPTA und Sprechgruppen MUST in Festbreitenschrift mit gleich breiten Ziffern stehen.

#### Scenario: Sprechgruppen nach Betriebsart
- **WHEN** einer Einheit die Sprechgruppen „TMO 311“ und „DMO 505“ zugeordnet sind
- **THEN** steht „311“ in der Spalte TMO und „505“ in der Spalte DMO derselben Zeile

#### Scenario: Rufname des Abschnitts vor der Kurzbezeichnung
- **WHEN** der Abschnitt „EA Nord“ die Kurzbezeichnung „EA N“ und den Rufnamen
  „Rotkreuz Musterstadt 1/10-1“ trägt
- **THEN** zeigt seine Zeile in der Spalte „Rufname/OPTA“ „Rotkreuz Musterstadt 1/10-1“; ohne
  Rufnamen zeigt sie „EA N“

#### Scenario: Leeres Feld
- **WHEN** einem Abschnitt keine Verbindung der Mittel Festnetz oder Mobil erfasst ist
- **THEN** bleibt die Zelle „Telefon“ als „—“ leer, und das System erfindet keinen Wert, auch
  nicht aus einer E-Mail-Adresse oder einem Fax

### Requirement: Fahrzeugführer nur mit Leserecht auf Personal
Die Spalte Leiter/Führer SHALL beim Abschnitt den Leiter und bei der Einheit den Führer zeigen.
Beim Fahrzeug SHALL sie die Person zeigen, die im Einsatzpersonal dem Fahrzeug mit der Position
„Führer“ zugeordnet ist. Ist die Personalliste für die Person gesperrt oder nicht geladen, MUST die
Zelle beim Fahrzeug „—“ zeigen und den Grund nennen (gesperrt bzw. nicht geladen). Sie MUST NOT den
Eindruck erwecken, das Fahrzeug habe keinen Führer.

#### Scenario: Führer aus dem Personal
- **WHEN** dem Fahrzeug eine Person mit Position „Führer“ zugeordnet ist und Personal lesbar ist
- **THEN** zeigt die Fahrzeugzeile deren Namen in der Spalte Leiter/Führer

#### Scenario: Personal gesperrt
- **WHEN** die Personalliste mit 403 abgelehnt wird
- **THEN** zeigen die Fahrzeugzeilen „—“ mit dem Hinweis, dass Personal nicht freigegeben ist, und
  der Rest der Tabelle bleibt vollständig

### Requirement: Rechteweiche je Quelle
Der Funkplan SHALL jede Quellliste (Abschnitte, Einheiten, Fahrzeuge, Personal, Sprechgruppen)
einzeln laden. Wird eine Liste abgelehnt (403) oder scheitert ihr Abruf, MUST die Seite das an der
betroffenen Stelle mit Grund sagen: „nicht freigegeben“ bzw. „nicht geladen“. Die übrigen Ebenen
MUST sie weiter zeigen. Die Seite MUST NOT eine fehlende Ebene als leeren Bestand darstellen: Eine
Liste, die noch nie Daten hatte (auch eine ohne Netz pausierte), gilt als „lädt“, nicht als leer.
Die leere Tabelle sagt „kein Bestand“ nur, wenn Abschnitte, Einheiten und Fahrzeuge geladen sind,
sonst nennt sie den Grund.

#### Scenario: Alle Strukturquellen gesperrt
- **WHEN** Abschnitte, Einheiten und Fahrzeuge mit 403 abgelehnt werden
- **THEN** sagt die leere Tabelle „Abschnitte, Einheiten, Fahrzeuge: nicht freigegeben“ und nicht
  „Weder Abschnitte noch Einheiten noch Fahrzeuge im Einsatz“

#### Scenario: Fahrzeuge gesperrt
- **WHEN** die Fahrzeugliste mit 403 abgelehnt wird
- **THEN** zeigt der Funkplan Abschnitte und Einheiten, nennt oberhalb der Tabelle, dass Fahrzeuge
  nicht freigegeben sind, und zeigt keine Fahrzeugzeilen

### Requirement: Lücken oberhalb der Tabelle
Oberhalb der Tabelle SHALL der Funkplan diese Lücken als Anzahl zeigen:
- Abschnitte ohne Sprechgruppe
- Einheiten ohne Sprechgruppe
- Einheiten ohne Funkrufname
- Einheiten ohne Telefon (keine Verbindung der Mittel Festnetz oder Mobil)
- einsatzlokale Sprechgruppen, die weder einem Abschnitt noch einer Einheit noch der eigenen
  Führungsstelle zugeordnet sind
- Verbindungen ohne gemeinsame Sprechgruppe: eine Stelle und ihre übergeordnete Stelle haben beide
  Sprechgruppen, aber keine gemeinsame. Übergeordnete Stelle eines obersten Abschnitts ist die
  eigene Führungsstelle.
- Sprechgruppen mit nur einem Teilnehmer (Stelle oder Komponente); eine einsatzlokale ohne
  Teilnehmer zählt nur bei „ohne Zuordnung“
- Leitstelle ohne Verbindung, nach derselben Regel wie im Kommunikationsplan

Jede Zahl MUST aus denselben geladenen Listen gerechnet werden wie die Tabelle. Hängt eine Zahl an
einer gesperrten, nicht geladenen oder noch ladenden Liste, MUST sie „—“ mit Grund zeigen und
MUST NOT „0“ zeigen. Bei einer Zahl größer null MUST der Funkplan die betroffenen Datensätze
nennen: Abschnitte und Einheiten als Verweis auf die Stelle, an der sie gepflegt werden,
einsatzlokale Sprechgruppen und Sprechgruppen mit nur einem Teilnehmer mit ihrer Bezeichnung,
Verbindungen als Verweis auf die untere Stelle, die fehlende Leitstelle als Verweis auf den
Kommunikationsplan.
Die Lücken MUST im ersten Bild stehen, bei 1366 × 768 px mit offenem Modulpanel. Sie MUST in
jeder Darstellung des Funkplans (Tabelle, Skizze und Sprechgruppen) dieselben sein.

#### Scenario: Abschnitt ohne Sprechgruppe
- **WHEN** einem von drei Abschnitten keine Sprechgruppe zugeordnet ist
- **THEN** zeigt der Funkplan „1“ bei „Abschnitte ohne Sprechgruppe“

#### Scenario: Einsatzlokale Sprechgruppe ohne Zuordnung
- **WHEN** im Einsatz die lokale Sprechgruppe „DMO 999“ angelegt, aber nirgends zugeordnet ist
- **THEN** zählt sie bei „einsatzlokale Sprechgruppen ohne Zuordnung“ und wird dort mit ihrer
  Bezeichnung genannt

#### Scenario: Einsatzlokale Sprechgruppe nur an der Führungsstelle
- **WHEN** die lokale Sprechgruppe „DMO 999“ nur der eigenen Führungsstelle zugeordnet ist
- **THEN** zählt sie nicht bei „einsatzlokale Sprechgruppen ohne Zuordnung“

#### Scenario: Einheiten gesperrt
- **WHEN** die Einheitenliste mit 403 abgelehnt wird
- **THEN** zeigen „Einheiten ohne Sprechgruppe“, „Einheiten ohne Funkrufname“, „Einheiten ohne
  Telefon“, „einsatzlokale Sprechgruppen ohne Zuordnung“ und „Verbindungen ohne gemeinsame
  Sprechgruppe“ „—“ mit Grund, nicht „0“

#### Scenario: Funkrufname und Telefon getrennt
- **WHEN** die Einheit „1. Zug“ den Funkrufnamen „Florian 1“, aber nur eine E-Mail-Adresse trägt
- **THEN** zählt sie bei „Einheiten ohne Telefon“, aber nicht bei „Einheiten ohne Funkrufname“

#### Scenario: Einheit ohne gemeinsamen Kanal mit ihrem Abschnitt
- **WHEN** der Abschnitt „EA Nord“ die Sprechgruppe „TMO 311“ trägt und die ihm zugeordnete
  Einheit „1. Zug“ nur „DMO 505“
- **THEN** zeigt der Funkplan „1“ bei „Verbindungen ohne gemeinsame Sprechgruppe“ und nennt
  „1. Zug“ als Verweis auf die Einheit

#### Scenario: Oberster Abschnitt ohne gemeinsamen Kanal mit der Führungsstelle
- **WHEN** die Führungsstelle nur „TMO 311“ trägt und der oberste Abschnitt „EA Nord“ nur „DMO 505“
- **THEN** zählt „EA Nord“ bei „Verbindungen ohne gemeinsame Sprechgruppe“ und wird als Verweis auf den Abschnitt genannt

#### Scenario: Führungsstelle ohne Sprechgruppe
- **WHEN** die Führungsstelle nicht erfasst ist oder keine Sprechgruppe trägt
- **THEN** zählt kein oberster Abschnitt bei „Verbindungen ohne gemeinsame Sprechgruppe“

#### Scenario: Stelle ohne Sprechgruppe zählt nicht doppelt
- **WHEN** eine Einheit gar keine Sprechgruppe trägt
- **THEN** zählt sie bei „Einheiten ohne Sprechgruppe“, aber nicht bei „Verbindungen ohne
  gemeinsame Sprechgruppe“

#### Scenario: Sprechgruppe mit nur einem Teilnehmer
- **WHEN** „DMO 505“ nur der Einheit „1. Zug“ zugeordnet ist
- **THEN** zeigt der Funkplan „1“ bei „Sprechgruppen mit nur einem Teilnehmer“ und nennt „DMO 505“

#### Scenario: Leitstelle ohne Verbindung
- **WHEN** keine Stelle der Art Leitstelle eine Verbindung, eine Sprechgruppe oder eine Verbindung
  in der Fernmeldeskizze trägt
- **THEN** zeigt der Funkplan die Lücke „Leitstelle: keine Verbindung erfasst“ mit Verweis auf den
  Kommunikationsplan

#### Scenario: Kommunikationsplan nicht geladen
- **WHEN** der Abruf des Kommunikationsplans scheitert
- **THEN** zeigt die Lücke „Leitstelle“ „—“ mit Grund, nicht „0“

### Requirement: Fehlende eigene Gegenstelle wird benannt
Ist die eigene Führungsstelle des Einsatzes erfasst, SHALL der Funkplan sie als erste Zeile vor den
Abschnitten zeigen. Die Zeile trägt:

- die Stelle „Führungsstelle“,
- Rufname, TMO- und DMO-Sprechgruppen und Telefon aus ihren Angaben,
- in der Spalte Leiter/Führer den erfassten Einsatzleiter, in derselben Darstellung wie die
  Kopfleiste der Einsatzdaten, und „—“, wenn keiner erfasst ist.

Die Zeile MUST ohne Kinder stehen; der Baum darunter bleibt unverändert. Ist die Führungsstelle
nicht erfasst, SHALL der Funkplan oberhalb der Tabelle ausdrücklich sagen, dass die eigene
Gegenstelle nicht erfasst ist. Er MUST NOT eine Zeile dafür erfinden oder aus anderen Daten
vermuten. Ist ihr Abruf gesperrt oder gescheitert, MUST der Hinweis den Grund nennen statt „nicht
erfasst“.

#### Scenario: Hinweis auf die Gegenstelle
- **WHEN** der Funkplan eines Einsatzes ohne erfasste Führungsstelle geöffnet wird
- **THEN** steht oberhalb der Tabelle der Hinweis „Eigene Gegenstelle (Führungsstelle) nicht
  erfasst“, und die Tabelle enthält keine erfundene Zeile dafür

#### Scenario: Erfasste Führungsstelle
- **WHEN** die Führungsstelle mit Rufname „Florian Musterstadt 10/1“ und der Sprechgruppe „TMO 311“ erfasst ist
- **THEN** steht vor dem ersten Abschnitt die Zeile „Führungsstelle“ mit diesem Rufnamen und „311“ in der Spalte TMO, und der Hinweis „nicht erfasst“ fehlt

#### Scenario: Einsatzleiter in der Zeile der Führungsstelle
- **WHEN** an der Führungsstelle der Einsatzleiter „Anna Schulz“ erfasst ist
- **THEN** zeigt die Zeile „Führungsstelle“ in der Spalte Leiter/Führer „Anna Schulz“, und der übernommene Lagebericht nennt sie als Einsatzleiter dieser Zeile

#### Scenario: Ohne Einsatzleiter
- **WHEN** die Führungsstelle erfasst ist, aber kein Einsatzleiter, und ein Mitglied die Einsatzrolle Einsatzleitung trägt
- **THEN** zeigt die Spalte Leiter/Führer der Zeile „Führungsstelle“ „—“ und keinen Namen

#### Scenario: Führungsstelle im Druck
- **WHEN** der Funkplan mit erfasster Führungsstelle gedruckt wird
- **THEN** ist die Zeile der Führungsstelle die erste Zeile des Ausdrucks, samt Telefon

### Requirement: Telefon schützen
Das Telefon ist personenbezogen.
- Am Bildschirm SHALL sie erst ab der Breite `xl` gezeigt werden. Darunter lässt sie sich über den
  Spaltenschalter einblenden, und der Schalter zählt sie als ausgeblendet mit.
- Im Druck SHALL sie immer erscheinen, unabhängig von der Fensterbreite.
- In den Lagebericht MUST NOT sie übernommen werden.

#### Scenario: Schmales Fenster
- **WHEN** der Funkplan in einem Fenster unter `xl` angezeigt wird
- **THEN** fehlt die Spalte Telefon, und der Spaltenschalter nennt eine ausgeblendete Spalte

#### Scenario: Druck aus schmalem Fenster
- **WHEN** der Funkplan aus einem Fenster unter `xl` gedruckt wird
- **THEN** enthält der Ausdruck die Spalte Telefon

### Requirement: Deeplink je Zeile, keine Bearbeitung
Jede Zeile SHALL zum Datensatz führen, an dem ihre Angaben gepflegt werden:
- die Führungsstelle zur Seite Einsatzdaten,
- der Abschnitt zum ausgewählten Abschnitt der Abschnittsseite,
- die Einheit zu ihrer Detailseite,
- das Fahrzeug zum ausgewählten Fahrzeug der Fahrzeugseite.

Der Funkplan MUST keine Bearbeitungsmöglichkeit bieten.

#### Scenario: Sprung zur Einheit
- **WHEN** die Person auf die Kennung einer Einheitszeile tippt
- **THEN** öffnet sich die Detailseite dieser Einheit, auf der die Sprechgruppen zugeordnet werden

#### Scenario: Sprung zur Führungsstelle
- **WHEN** die Person auf die Kennung der Zeile „Führungsstelle“ tippt
- **THEN** öffnet sich die Seite Einsatzdaten, auf der die Führungsstelle gepflegt wird

### Requirement: Druck als eigenes Druckstück
Der Funkplan SHALL über „Drucken / als PDF“ als eigenes Druckstück mit der Dokumentart „Funkplan“
gedruckt werden. Vor dem Druck MUST jeder Knoten des Baums aufgeklappt werden. Die Anforderungen
der Capability `druck-dokumente` gelten unverändert.

#### Scenario: Druck mit zugeklappten Knoten
- **WHEN** der Funkplan mit zugeklappten Abschnitten über „Drucken / als PDF“ gedruckt wird
- **THEN** enthält der Ausdruck alle Abschnitte, Einheiten und Fahrzeuge, und kein Teil der
  Tabelle ist rechts abgeschnitten

### Requirement: In Lagebericht übernehmen
Personen mit Schreibrecht im Einsatz SHALL den aktuellen Funkplan mit einer Aktion in einen neuen
Lagebericht (Vorlage Freitext) mit dem Titel „Funkplan <DTG>“ übernehmen können.
- Der Inhalt MUST den Baum mit allen Spalten außer dem Telefon wiedergeben, eine erfasste
  Führungsstelle als erste Zeile. Fehlt eine Quelle (gesperrt, nicht geladen), MUST der Bericht sie
  mit Grund nennen. „Keine Kräfte erfasst“ MUST er nur schreiben, wenn Abschnitte, Einheiten und
  Fahrzeuge geladen sind.
- Nach dem Baum MUST der Inhalt einen Abschnitt „Kommunikationsskizze“ tragen: „Gültig ab“, je
  Sprechgruppe Bedingungszeichen und Teilnehmer mit Rufname (externe Stellen mit Status), danach
  die übrigen Verbindungen der Skizze mit Art, Medium und Status. Rufnummern MUST NOT darin stehen.
  Fehlen die Daten der Skizze oder die externen Stellen, MUST der Abschnitt das mit Grund nennen.
- Namen und Kennungen MUST als Text erscheinen, nie als Auszeichnung des Renderers (etwa `~x~`
  als Durchstreichung).
- Die Aktion MUST gesperrt sein, solange eine Quelle noch lädt. Sie MUST fehlen, wenn das Modul
  Lageberichte für die Person nicht freigegeben ist.
- Die Übernahme MUST in einem einzigen Schritt geschehen, nach `dokument-uebernahme`.
- Nach dem Erfolg SHALL der neue Lagebericht geöffnet werden.
- Scheitert die Übernahme, MUST der Fehler an der Seite stehen, und es MUST kein leerer Entwurf
  entstehen.
- Ohne Schreibrecht MUST die Aktion fehlen.

#### Scenario: Übernahme gelingt
- **WHEN** eine Person mit Schreibrecht „In Lagebericht übernehmen“ wählt
- **THEN** entsteht genau ein Lagebericht „Funkplan <DTG>“ mit dem Funkplan als Text, ohne
  Telefon, und er wird geöffnet

#### Scenario: Führungsstelle im Lagebericht
- **WHEN** die Führungsstelle mit Rufname und einer Mobilnummer erfasst ist und der Funkplan übernommen wird
- **THEN** beginnt die Gliederung des Lageberichts mit der Führungsstelle samt Rufname, und ihre Mobilnummer steht nirgends im Text

#### Scenario: Übernahme scheitert
- **WHEN** das Anlegen des Lageberichts abgelehnt wird
- **THEN** zeigt die Seite den Fehler, und im Einsatz ist kein neuer Lagebericht entstanden

#### Scenario: Kanäle im Lagebericht
- **WHEN** Führungsstelle, „EA 1“ und die Leitstelle (geplant) „TMO BN_BOS“ tragen und der Funkplan
  übernommen wird
- **THEN** enthält der Lagebericht unter „Kommunikationsskizze“ die Zeile „TMO BN_BOS“ mit
  Einsatzleitung, „EA 1“ und der Leitstelle samt „geplant“, und keine Rufnummer

### Requirement: Darstellung „Sprechgruppen“
Der Funkplan SHALL eine dritte Darstellung „Sprechgruppen“ haben: eine Zeile je Sprechgruppe des
Einsatzes, also jede der eigenen Führungsstelle, einem Abschnitt oder einer Einheit zugeordnete und
jede einsatzlokale. Teilnehmer sind die eigene Führungsstelle (zuerst, mit Rufname, Ziel
Einsatzdaten), die Abschnitte und Einheiten, die externen Stellen des Kommunikationsplans mit ihrem
Status und die Komponenten der Fernmeldeskizze. Spalten:
Sprechgruppe (fixiert, Festbreitenschrift), Bedingung (Betriebsart, Netz und Sicherheit in
Festbreitenschrift, getrennt durch „ · “, leere weggelassen), Hinweis, Herkunft (Katalog oder
einsatzlokal) und Teilnehmer. Zuerst TMO, dann DMO, je in der Sortierung der Sprechgruppen. Sie ist
schreibgeschützt und aus denselben Quellen abgeleitet wie die Tabelle. Fehlt eine dieser Quellen,
auch die Führungsstelle, MUST die Zelle „unvollständig“ bzw. den Grund tragen, nie „keine“.

#### Scenario: Bedingung in der Sprechgruppen-Darstellung
- **WHEN** „TMO 311“ Netz „BOS“ und keine Sicherheit trägt
- **THEN** steht in der Spalte „Bedingung“ „TMO · BOS“

#### Scenario: Teilnehmer einer Sprechgruppe
- **WHEN** „TMO 311“ dem Abschnitt „EA Nord“ (Kurzbezeichnung „EA N“) und der Einheit „1. Zug“
  (Funkrufname „Florian Musterstadt 1“) zugeordnet ist
- **THEN** zeigt die Zeile „311“ beide Stellen mit Rufnamen als Teilnehmer, und jede führt zu ihrem
  Datensatz

#### Scenario: Einsatzlokale Sprechgruppe ohne Zuordnung
- **WHEN** die lokale Sprechgruppe „DMO 999“ nirgends zugeordnet ist
- **THEN** steht sie mit Herkunft „einsatzlokal“ und dem Teilnehmer „keine“ in der Darstellung

#### Scenario: Katalog-Sprechgruppe ohne Zuordnung
- **WHEN** eine Sprechgruppe des Organisationskatalogs weder der eigenen Führungsstelle noch einem
  Abschnitt oder einer Einheit des Einsatzes zugeordnet ist
- **THEN** erscheint sie nicht

#### Scenario: Führungsstelle als Teilnehmer
- **WHEN** der eigenen Führungsstelle (Rufname „Florian Musterstadt 10/1“) die einsatzlokale
  „DMO 999“ zugeordnet ist und sonst niemand
- **THEN** nennt die Zeile „DMO 999“ die Führungsstelle mit Rufname als Teilnehmer statt „keine“,
  und sie führt zu den Einsatzdaten

#### Scenario: Katalog-Sprechgruppe nur an der Führungsstelle
- **WHEN** eine Sprechgruppe des Organisationskatalogs nur der eigenen Führungsstelle zugeordnet ist
- **THEN** erscheint sie mit Herkunft „Katalog“ und der Führungsstelle als Teilnehmer

#### Scenario: Führungsstelle nicht geladen
- **WHEN** die Führungsstelle nicht geladen werden kann und eine einsatzlokale Sprechgruppe
  nirgends sonst zugeordnet ist
- **THEN** steht in ihrer Teilnehmerzelle „Führungsstelle nicht geladen“ statt „keine“

#### Scenario: Einheiten gesperrt
- **WHEN** die Einheitenliste mit 403 abgelehnt wird
- **THEN** zeigt die Darstellung die Sprechgruppen der Abschnitte und die einsatzlokalen, und
  oberhalb steht, dass Einheiten nicht freigegeben sind; keine Zeile behauptet, eine Sprechgruppe
  habe keine Teilnehmer, wenn sie nur an einer gesperrten Quelle hängen könnte

#### Scenario: Sichtvorgabe aus einem Link
- **WHEN** eine Person `/einsaetze/:id/fernmeldewesen?ansicht=sprechgruppen` öffnet
- **THEN** steht die Darstellung auf „Sprechgruppen“, und `ansicht` ist aus der Adresse entfernt

#### Scenario: Sichtvorgabe über die alte Adresse
- **WHEN** eine Person `/einsaetze/:id/stab/funkplan?ansicht=sprechgruppen` öffnet
- **THEN** landet sie im Modul Fernmeldewesen in der Darstellung „Sprechgruppen“

#### Scenario: Druck der Darstellung
- **WHEN** eine Person in der Darstellung „Sprechgruppen“ druckt
- **THEN** nennt der Druckkopf die Darstellung „Sprechgruppen“, und jede Zeile steht ohne
  waagerechten Überhang auf A4

#### Scenario: Leitstelle als Teilnehmer
- **WHEN** der Leitstelle „ILS Musterhausen“ „TMO SL AS“ mit Status „geplant“ zugeordnet ist
- **THEN** nennt die Zeile „TMO SL AS“ die Leitstelle als Teilnehmer mit dem Wort „geplant“, und
  sie führt zum Kommunikationsplan

### Requirement: Bezeichnung der Führungsstelle im Funkplan
Trägt die erfasste Führungsstelle eine Bezeichnung, SHALL die Zeile „Führungsstelle“ sie als
Zusatz der Stelle zeigen, am Bildschirm wie im Druck. Ohne Bezeichnung MUST die Zeile ohne Zusatz
stehen, und es MUST NOT eine Bezeichnung aus Fahrzeugen, Rufname oder Standort abgeleitet werden.

#### Scenario: Führungsstelle mit Bezeichnung
- **WHEN** die Führungsstelle mit Bezeichnung „ELW 2 Musterstadt“ und Rufname „Florian Musterstadt 10/1“ erfasst ist
- **THEN** zeigt die erste Zeile die Stelle „Führungsstelle“ mit dem Zusatz „ELW 2 Musterstadt“ und den Rufnamen

#### Scenario: Führungsstelle ohne Bezeichnung
- **WHEN** die Führungsstelle nur mit Rufname und dem ELW 2 als Führungsfahrzeug erfasst ist
- **THEN** zeigt die Zeile „Führungsstelle“ keinen Zusatz

### Requirement: Zahl der Lücken
Das Lücken-Paneel des Funkplans SHALL in seinem Kopf die Zahl der Lücken zeigen („3 Lücken“). Sie
ist die Summe der Zahlen aus „Lücken oberhalb der Tabelle“, die Leitstelle ohne Verbindung zählt
dabei als eine Lücke. Die fehlende eigene Gegenstelle zählt nicht mit, sie ist ein Hinweis auf den
Pflegeort. Ein Datensatz, der unter zwei Lücken fällt, zählt bei jeder. Zeigt auch nur eine der
summierten Zahlen „—“, MUST die Zahl der Lücken entfallen bzw. „—“ mit dem Grund der schlechtesten
Quelle zeigen und MUST NOT eine Teilsumme zeigen. Die Stab-Seite MUST dieselbe Zahl aus derselben
Rechnung zeigen. Sie MUST in jeder Darstellung des Funkplans dieselbe sein.

#### Scenario: Summe
- **WHEN** das Lücken-Paneel „1“ bei „Abschnitte ohne Sprechgruppe“, „1“ bei „Einheiten ohne Sprechgruppe“ und „1“ bei „Einheiten ohne Telefon“ zeigt, für dieselbe Einheit, und sonst keine Lücke
- **THEN** zeigt der Kopf des Lücken-Paneels „3 Lücken“, und die S6-Kachel der Stab-Seite zeigt „3“ am Funkplan

#### Scenario: Keine Lücke
- **WHEN** keine der Lücken zutrifft und alle Quellen geladen sind
- **THEN** zeigt der Kopf „0 Lücken“

#### Scenario: Quelle gesperrt
- **WHEN** die Einheitenliste mit 403 abgelehnt wird
- **THEN** zeigt der Kopf keine Teilsumme, und die S6-Kachel zeigt „—“ mit dem Grund „nicht freigegeben“
