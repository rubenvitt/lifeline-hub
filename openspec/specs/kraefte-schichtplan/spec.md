# kraefte-schichtplan Specification

## Purpose
Ein Einsatz hat einen Schichtplan: Blöcke an Einheiten, UHS und der Zeile „Pause“, mit Soll und
eingeteilten Personen. Der Plan ist Soll und ändert kein Ist. Prüfbefunde zeigen an und
blockieren nie (LLH-1552, Konzept LLH-1523). Wechsel aus dem Plan regelt `kraefte-abloesung`
(LLH-1555), das Raster LLH-1554.

## Requirements

### Requirement: Planschicht
Ein Einsatz SHALL Planschichten an einer Einheit, einer UHS oder der Pause führen können, mit
Beginn, Ende, Soll-Anzahl, Qualifikationssoll, Personen und Notiz. Beginn und Ende MUST auf vollen
5 Minuten liegen, ein Block MUST mindestens 10 Minuten und höchstens 24 Stunden dauern (400
sonst). Blöcke eines Postens außer der Pause MUST sich nicht überschneiden (422); Berühren ist
erlaubt. Ein Pausenblock MUST ohne Soll sein. Schreiben MUST das Schreibrecht in der Ablösung
und einen aktiven Einsatz verlangen.

#### Scenario: Überschneidung
- **WHEN** an der Streife 2 ein Block 14:00–16:00 besteht und jemand 15:00–17:00 anlegt
- **THEN** antwortet das System mit 422 und legt nichts an

#### Scenario: Anschluss
- **WHEN** an der Streife 2 ein Block 14:00–16:00 besteht und jemand 16:00–18:00 anlegt
- **THEN** legt das System den Block an

#### Scenario: Pause überlappt
- **WHEN** in der Pause ein Block 14:00–15:00 besteht und jemand 14:30–15:30 anlegt
- **THEN** legt das System den Block an

#### Scenario: Andere Zeile
- **WHEN** jemand einen Block von der Streife 2 zur UHS Markt verschiebt und dort nichts im Weg ist
- **THEN** steht der Block an der UHS und behält Zeit, Soll und Personen

### Requirement: Soll-Vorgabe vom Posten
Ein neuer Block ohne Soll-Angabe MUST das wirksame Soll des Postens als eigenen Wert übernehmen:
bei einer Einheit die Summe F/UF/M und das wirksame Qualifikationssoll, bei einer UHS deren
Soll-Anzahl und Qualifikationssoll. Spätere Änderungen am Posten MUST bestehende Blöcke nicht
ändern.

#### Scenario: Vorgabe RTW
- **WHEN** ein Block am RTW 1 mit Soll 0/0/2 und „mind. 1 Rettungssanitäter“ angelegt wird
- **THEN** trägt der Block Soll-Anzahl 2 und „mind. 1 Rettungssanitäter“

### Requirement: Personen im Plan
Ein Block SHALL bis zu 50 Personen aufnehmen: Stamm-Personal der Organisation, Ad-hoc-Kräfte des
Einsatzes oder Helfer des Plans (Name, Telefon, Organisation, Qualifikationen). Wer nur im Plan
steht, MUST NOT in den Einsatz übernommen, alarmiert oder in der Stärke gezählt werden. Personen
zu schreiben MUST die Freigabe des Moduls Personal verlangen (403 sonst). Ohne diese Freigabe
MUST das Lesen keine Namen liefern.

#### Scenario: Nur im Plan
- **WHEN** eine Stamm-Person, die nicht disponiert ist, in einen Block der Spätschicht eingeteilt wird
- **THEN** steht sie nicht in der Personalliste des Einsatzes und bekommt keine Alarmierung

#### Scenario: Helfer
- **WHEN** jemand einen Helfer „Mia Beispiel, DRK OV Nord, Sanitäter“ anlegt und einteilt
- **THEN** zeigt der Block ihn mit Qualifikation, und die Deckung rechnet mit ihr

### Requirement: Prüfbefunde
Das Lesen des Plans MUST je Block und Person Befunde liefern, ohne Schreiben zu blockieren:
- `doppelt`: eine Person in zwei Blöcken mit überschneidender Zeit.
- `quali`: geforderte Qualifikationen, die die freien Plätze nicht mehr aufnehmen können
  (Deckungsregel `qualifikationen`). Vorher sind sie Teil der Lücke.
- `dienst`: eine Dienststrecke länger als der Höchstwert, wobei Lücken unter der Mindestruhe und
  Pausen die Strecke nicht trennen.
- `verfuegbar`: die Person ist außer Dienst oder entlassen, oder der Posten ist aufgelöst.
- `abweichung`: ab Blockbeginn plus 10 Minuten bis Blockende ist eine eingeteilte Person nicht am
  Posten.

Die Kräfte-Zeitachse MUST weiterhin nicht gegen Grenzwerte einstufen; der Dienst-Befund liest
nur Planblöcke.

#### Scenario: Doppelt
- **WHEN** Anna in Streife 2 14:00–16:00 und an der UHS 15:00–19:00 steht
- **THEN** tragen beide Blöcke den Befund „doppelt“ für Anna

#### Scenario: Lücke statt Befund
- **WHEN** ein Block Soll 3 mit „mind. 1 Rettungssanitäter“ hat und zwei Sanitäter eingeteilt sind
- **THEN** meldet der Block „1 Platz offen, braucht Rettungssanitäter“ und keinen Befund „quali“

#### Scenario: Qualifikation fehlt
- **WHEN** ein Block Soll 2 mit „mind. 1 Rettungssanitäter“ hat und zwei Sanitäter eingeteilt sind
- **THEN** meldet der Block den Befund „quali“ für 1 Rettungssanitäter

#### Scenario: Zu lange ohne Ruhe
- **WHEN** die Werte 12 h / 8 h gelten und Anna 08:00–14:00 und 16:00–22:00 steht
- **THEN** meldet der Plan für Anna „dienst“ (14 h ohne 8 h Ruhe)

#### Scenario: Genug Ruhe
- **WHEN** die Werte 12 h / 8 h gelten und Anna 06:00–12:00 und 20:00–02:00 steht
- **THEN** meldet der Plan für Anna keinen Befund „dienst“

#### Scenario: Plan gegen Ist
- **WHEN** Ben ab 14:00 an der Streife 2 eingeteilt ist und um 14:15 noch dem RTW 1 zugeordnet ist
- **THEN** meldet der Block „abweichung“ für Ben; um 14:05 noch nicht

### Requirement: Grenzwerte des Einsatzes
Ein Einsatz SHALL einen Höchstwert für den Dienst (60 bis 1440 Minuten) und eine Mindestruhe (0
bis 1440 Minuten) tragen. Ohne eigenen Wert MUST 12 Stunden bzw. 8 Stunden gelten. Eine Änderung
MUST einen ETB-Systemsatz schreiben.

### Requirement: Schichten erzeugen
Das System SHALL einen Zeitraum an einem Posten mit Blöcken füllen: mit angegebener Länge oder
nach dem Schichtmodell des Einsatzes (Rhythmus oder Wechselzeiten in der Zone des Einsatzes).
Ohne Länge und ohne Schichtmodell MUST es mit 422 ablehnen. Überschneidet sich ein erzeugter
Block mit einem bestehenden, MUST nichts angelegt werden (422 mit Zeilen). Ein Erzeugen MUST
einen ETB-Systemsatz schreiben; einzelne Blöcke schreiben keinen.

#### Scenario: Wechselzeiten
- **WHEN** das Schichtmodell Wechselzeiten 06:00, 14:00, 22:00 hat und jemand an der UHS 10:00–23:00 erzeugt
- **THEN** entstehen 10:00–14:00, 14:00–22:00 und 22:00–23:00 nach Mindestdauer des Modells

#### Scenario: Eigene Länge
- **WHEN** jemand an der Streife 2 18:00–00:00 mit 2 h erzeugt
- **THEN** entstehen drei Blöcke zu 2 h mit dem Soll der Streife

### Requirement: Schichtplan drucken
Die Ablösung SHALL den Schichtplan eines Einsatzes als Druckansicht ausgeben, wahlweise je
Posten (Aushang) oder je Person (Zettel), für alle Blätter oder ein einzelnes. Jedes Blatt MUST
auf einer neuen A4-Seite beginnen und den Druckkopf tragen. Der Aushang MUST je Schicht Zeit,
eingeteilte Personen mit Qualifikationen und offene Plätze als Wort zeigen, aber keine
Prüfbefunde. Der Zettel MUST je Schicht Zeit, Posten mit Abschnitt und die übrigen Eingeteilten
zeigen und die Stunden ohne Pausen summieren. Die Pause MUST keinen Aushang haben. Ohne Freigabe
des Moduls Personal MUST der Aushang nur die Besetzung als Zahl zeigen und der Zettel gesperrt
sein. Eine Tabellenzeile MUST in Chromium, Firefox und WebKit nicht über eine Seitengrenze
geschnitten werden.

#### Scenario: Aushang an der UHS
- **WHEN** jemand in der Ansicht Schichtplan „Drucken“ wählt, „Je Posten“ und die UHS Marktplatz
- **THEN** zeigt die Druckansicht ein Blatt UHS Marktplatz mit den Schichten nach Beginn, den
  Eingeteilten und „1 offen“ an der Schicht mit fehlender Person

#### Scenario: Zettel einer Person
- **WHEN** eine Person drei Schichten zu je drei Stunden und eine Pause von 30 Minuten hat
- **THEN** zeigt ihr Zettel vier Zeilen und „3 Schichten, 9 h“

#### Scenario: Ohne Modul Personal
- **WHEN** jemand ohne Freigabe des Moduls Personal die Druckansicht öffnet
- **THEN** zeigt der Aushang „3 von 4 besetzt“ ohne Namen, und „Je Person“ ist mit Grund gesperrt

#### Scenario: Langer Posten
- **WHEN** ein Posten mehr Schichten hat, als auf eine Seite passen
- **THEN** läuft die Tabelle auf der nächsten Seite mit wiederholtem Tabellenkopf weiter, und
  keine Zeile ist abgeschnitten
