# stab-funkplan Specification

## Purpose
Der Funkplan des Sachgebiets S6 nach FwDV 100 Anlage 5: eine schreibgeschützte Tabelle, die aus
den erfassten Abschnitten, Einheiten, Fahrzeugen und Sprechgruppen abgeleitet wird. Sie zeigt
auch, was im Funkplan fehlt.

## Requirements

### Requirement: Eigene Adresse unter dem Stab mit Einstieg aus der S6-Zeile
Der Funkplan SHALL unter einer eigenen, als Lesezeichen tauglichen Adresse unter dem Stab-Modul
eines Einsatzes erreichbar sein. Die Navigation MUST dort das Stab-Modul als aktiv zeigen. Die
Sachgebietszeile S6 der Stabseite SHALL einen Verweis „Funkplan“ auf diese Adresse tragen. Der
Funkplan MUST NOT als eigenes Modul in Rail, Modulpanel oder Modulfreigabe erscheinen. Er erbt die
Sichtbarkeit und Sperre des Stab-Moduls.

#### Scenario: Einstieg aus der Stabseite
- **WHEN** eine Person mit Leserecht auf den Stab in der Zeile S6 auf „Funkplan“ tippt
- **THEN** öffnet sich der Funkplan des Einsatzes unter seiner eigenen Adresse, und das Stab-Modul
  ist in der Navigation als aktiv markiert

#### Scenario: Direkter Aufruf als Lesezeichen
- **WHEN** die Adresse des Funkplans direkt aufgerufen wird
- **THEN** erscheint der Funkplan ohne Umweg über die Stabseite

Weil keine Quelle des Funkplans den Stab selbst prüft, MUST die Seite die Freigabe des Stabs
ermitteln, bevor sie Daten zeigt. Solange sie nicht ermittelt ist, zeigt die Seite keine Daten.
Scheitert die Ermittlung, zeigt sie einen Fehler mit Wiederholen, nicht den Funkplan.

#### Scenario: Stab gesperrt
- **WHEN** das Stab-Modul für die Person ausgeblendet oder für ihre Rolle gesperrt ist
- **THEN** ist auch der Funkplan nicht erreichbar, so wie jede andere Seite des Moduls

#### Scenario: Freigabe nicht ermittelbar
- **WHEN** der Abruf der Modulfreigaben scheitert
- **THEN** zeigt die Seite einen Fehler mit Wiederholen und weder Tabelle noch Übernahme

### Requirement: Zeilen als Baum Abschnitt → Einheit → Fahrzeug
Der Funkplan SHALL eine Tabelle mit einer Zeile je Abschnitt, je Einheit und je Fahrzeug im
Einsatz zeigen. Die Zeilen bilden einen Baum:
- Unterabschnitte stehen unter ihrem Abschnitt.
- Einheiten stehen unter dem Abschnitt, in dem sie wirken, Untereinheiten unter ihrer Einheit.
- Fahrzeuge stehen unter ihrer Einheit.

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

### Requirement: Spalten mit fixierter menschenlesbarer Kennung
Die Tabelle SHALL diese Spalten führen: Stelle, Rufname/OPTA, Leiter/Führer, TMO-Sprechgruppen,
DMO-Sprechgruppen, Kommunikationsmittel, Erreichbarkeit.
- Die Spalte „Stelle“ MUST beim waagerechten Bildlauf stehen bleiben und MUST NOT ausblendbar
  sein. Sie MUST eine menschenlesbare Kennung tragen, nie eine Datenbank-Kennung: beim Abschnitt
  und bei der Einheit den Namen, beim Fahrzeug den Funkrufnamen.
- Die Spalte „Rufname/OPTA“ MUST beim Abschnitt die Kurzbezeichnung, bei der Einheit den
  Funkrufnamen und beim Fahrzeug die OPTA zeigen, jeweils nur, wenn sie erfasst sind. Ein
  fehlender Wert MUST NOT aus anderen Angaben erraten werden.
- Sprechgruppen MUST aus den Zuordnungen stammen, getrennt nach Betriebsart. Die eingefrorenen
  Altfelder der Sprechgruppen MUST NOT verwendet werden.
- Rufnamen, OPTA und Sprechgruppen MUST in Festbreitenschrift mit gleich breiten Ziffern stehen.

#### Scenario: Sprechgruppen nach Betriebsart
- **WHEN** einer Einheit die Sprechgruppen „TMO 311“ und „DMO 505“ zugeordnet sind
- **THEN** steht „311“ in der Spalte TMO und „505“ in der Spalte DMO derselben Zeile

#### Scenario: Leeres Feld
- **WHEN** einem Abschnitt kein Kommunikationsmittel erfasst ist
- **THEN** bleibt die Zelle als „—“ leer, und das System erfindet keinen Wert

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
- Einheiten ohne Erreichbarkeit
- einsatzlokale Sprechgruppen, die weder einem Abschnitt noch einer Einheit zugeordnet sind

Jede Zahl MUST aus denselben geladenen Listen gerechnet werden wie die Tabelle. Hängt eine Zahl an
einer gesperrten, nicht geladenen oder noch ladenden Liste, MUST sie „—“ mit Grund zeigen und
MUST NOT „0“ zeigen. Bei einer Zahl größer null MUST der Funkplan die betroffenen Datensätze
nennen: Abschnitte und Einheiten als Verweis auf die Stelle, an der sie gepflegt werden,
einsatzlokale Sprechgruppen mit ihrer Bezeichnung. Die Lücken MUST im ersten Bild stehen, bei
1366 × 768 px mit offenem Modulpanel.

#### Scenario: Abschnitt ohne Sprechgruppe
- **WHEN** einem von drei Abschnitten keine Sprechgruppe zugeordnet ist
- **THEN** zeigt der Funkplan „1“ bei „Abschnitte ohne Sprechgruppe“

#### Scenario: Einsatzlokale Sprechgruppe ohne Zuordnung
- **WHEN** im Einsatz die lokale Sprechgruppe „DMO 999“ angelegt, aber nirgends zugeordnet ist
- **THEN** zählt sie bei „einsatzlokale Sprechgruppen ohne Zuordnung“ und wird dort mit ihrer
  Bezeichnung genannt

#### Scenario: Einheiten gesperrt
- **WHEN** die Einheitenliste mit 403 abgelehnt wird
- **THEN** zeigen „Einheiten ohne Sprechgruppe“, „Einheiten ohne Erreichbarkeit“ und
  „einsatzlokale Sprechgruppen ohne Zuordnung“ „—“ mit Grund, nicht „0“

### Requirement: Fehlende eigene Gegenstelle wird benannt
Solange der Einsatz kein Feld für die eigene Führungsstelle trägt (Rufname, Sprechgruppen,
Erreichbarkeit), SHALL der Funkplan oberhalb der Tabelle ausdrücklich sagen, dass die eigene
Gegenstelle nicht erfasst ist. Der Funkplan MUST NOT eine Zeile für die eigene Führungsstelle
erfinden oder aus anderen Daten vermuten.

#### Scenario: Hinweis auf die Gegenstelle
- **WHEN** der Funkplan geöffnet wird
- **THEN** steht oberhalb der Tabelle der Hinweis „Eigene Gegenstelle (Führungsstelle) nicht
  erfasst“, und die Tabelle enthält keine erfundene Zeile dafür

### Requirement: Erreichbarkeit schützen
Die Erreichbarkeit ist personenbezogen.
- Am Bildschirm SHALL sie erst ab der Breite `xl` gezeigt werden. Darunter lässt sie sich über den
  Spaltenschalter einblenden, und der Schalter zählt sie als ausgeblendet mit.
- Im Druck SHALL sie immer erscheinen, unabhängig von der Fensterbreite.
- In den Lagebericht MUST NOT sie übernommen werden.

#### Scenario: Schmales Fenster
- **WHEN** der Funkplan in einem Fenster unter `xl` angezeigt wird
- **THEN** fehlt die Spalte Erreichbarkeit, und der Spaltenschalter nennt eine ausgeblendete Spalte

#### Scenario: Druck aus schmalem Fenster
- **WHEN** der Funkplan aus einem Fenster unter `xl` gedruckt wird
- **THEN** enthält der Ausdruck die Spalte Erreichbarkeit

### Requirement: Deeplink je Zeile, keine Bearbeitung
Jede Zeile SHALL zum Datensatz führen, an dem ihre Angaben gepflegt werden:
- der Abschnitt zum ausgewählten Abschnitt der Abschnittsseite,
- die Einheit zu ihrer Detailseite,
- das Fahrzeug zum ausgewählten Fahrzeug der Fahrzeugseite.

Der Funkplan MUST keine Bearbeitungsmöglichkeit bieten.

#### Scenario: Sprung zur Einheit
- **WHEN** die Person auf die Kennung einer Einheitszeile tippt
- **THEN** öffnet sich die Detailseite dieser Einheit, auf der die Sprechgruppen zugeordnet werden

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
- Der Inhalt MUST den Baum mit allen Spalten außer der Erreichbarkeit wiedergeben. Fehlt eine
  Quelle (gesperrt, nicht geladen), MUST der Bericht sie mit Grund nennen. „Keine Kräfte erfasst“
  MUST er nur schreiben, wenn Abschnitte, Einheiten und Fahrzeuge geladen sind.
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
  Erreichbarkeit, und er wird geöffnet

#### Scenario: Übernahme scheitert
- **WHEN** das Anlegen des Lageberichts abgelehnt wird
- **THEN** zeigt die Seite den Fehler, und im Einsatz ist kein neuer Lagebericht entstanden
