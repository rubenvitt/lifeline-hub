# kraefte-schichtplan Specification

## Purpose
Ein Einsatz hat einen Schichtplan: Blöcke an Einheiten, UHS und der Zeile „Pause“, mit Soll und
eingeteilten Personen. Der Plan ist Soll und ändert kein Ist. Prüfbefunde zeigen an und
blockieren nie (LLH-1552, Konzept LLH-1523). Er gibt einer laufenden Schicht die Fälligkeit und
belegt den Wechsel vor (`kraefte-abloesung`, „Fälligkeit laut Plan“ und „Vollzug aus dem Plan“,
LLH-1555); der Wechsel selbst ist ein Griff, kein Automatismus. Das Raster regelt LLH-1554, das Einlesen aus einer Datei LLH-1556.
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
steht, MUST NOT in den Einsatz übernommen, alarmiert oder in der Stärke gezählt werden; erst der
Vollzug aus dem Plan übernimmt (`kraefte-abloesung`, LLH-1555), ein übernommener Helfer zeigt dann
das Ist seiner Kraft. Personen
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

Der Dienst-Befund liest nur Planblöcke. Das Ist der Kräfte-Zeitachse stuft dieselbe Regel gegen
dieselben Grenzwerte ein (Capability `kraefte-zeitachse`, „Einstufung gegen die Grenzwerte des
Einsatzes“); ein Befund des Plans entsteht daraus nicht.

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
MUST einen ETB-Systemsatz schreiben. Dieselben wirksamen Werte MUST auch die Einstufung der
Kräfte-Zeitachse lesen; es gibt keine zweite Einstellung.

#### Scenario: Vorgabe ohne eigenen Wert
- **WHEN** ein Einsatz keinen eigenen Höchstwert und keine eigene Mindestruhe setzt
- **THEN** gelten 12 h und 8 h im Plan und in der Einstufung der Kräfte-Zeitachse

#### Scenario: Eigener Wert gilt für Plan und Ist
- **WHEN** jemand den Höchstwert des Einsatzes auf 10 h setzt
- **THEN** entsteht ein ETB-Systemsatz, und Plan-Befund `dienst` und Einstufung der Kräfte-Zeitachse prüfen gegen 10 h

### Requirement: Grenzwerte bedienen
Die Einstellungen des Einsatzes SHALL Höchstdienst und Mindestruhe zeigen, ändern und auf die
Vorgabe zurücksetzen. Wer in der Ablösung schreiben darf, darf das auch; für alle anderen ist es
nur lesbar. Ein Wert, für den die Vorgabe gilt, MUST als Vorgabe gekennzeichnet sein. Dauern
MUST in derselben Form wie in der Ablösung stehen, nie dezimal. Die Ansicht „Schichtplan“ MUST
die wirksamen Werte nennen und SHALL keine zweite Bedienstelle haben.

#### Scenario: Vorgabe gekennzeichnet
- **WHEN** ein Einsatz keinen eigenen Höchstdienst und keine eigene Mindestruhe setzt
- **THEN** stehen in den Einstellungen „12 h (Vorgabe)“ und „8 h (Vorgabe)“, und der Schichtplan nennt dieselben Werte

#### Scenario: Eigenen Wert setzen
- **WHEN** die Einsatzleitung den Höchstdienst auf „10 h“ setzt
- **THEN** steht „10 h“ ohne Kennzeichnung, ein ETB-Systemsatz entsteht, und Schichtplan, Meldebild und Personalliste prüfen ohne Neuladen gegen 10 h

#### Scenario: Leeres Feld heißt Vorgabe
- **WHEN** jemand im Dialog das Feld „Mindestruhe“ leert und speichert
- **THEN** gilt für die Mindestruhe wieder die Vorgabe 8 h, und der Höchstdienst bleibt, wie er war

#### Scenario: Vorgaben wiederherstellen
- **WHEN** ein eigener Wert gilt und jemand „Vorgaben wiederherstellen“ wählt
- **THEN** gelten für beide Werte die Vorgaben, ohne Rückfrage, und „Rückgängig“ stellt die vorherigen Werte wieder her

#### Scenario: Grenzen der Eingabe
- **WHEN** jemand als Höchstdienst „45 min“ oder als Mindestruhe „25 h“ eingibt
- **THEN** nennt das Feld den erlaubten Bereich in Dauerform, und es wird nichts gespeichert

#### Scenario: Ohne Schreibrecht
- **WHEN** jemand ohne Schreibrecht in der Ablösung die Einstellungen oder den Schichtplan öffnet
- **THEN** sieht er die wirksamen Werte, aber weder „Werte ändern“ noch „Vorgaben wiederherstellen“ noch den Sprung „ändern“

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

### Requirement: Wechsel an der UHS
Das System SHALL zu einem UHS-Block einen Wechsel vollziehen: Kommende bekommen die UHS, Gehende
verlieren sie, Bleibende bleiben; die Mitgliedschaft in einer Einheit MUST unberührt bleiben.
Vorbelegt MUST kommen, wer im Block steht und nicht an der UHS ist, und gehen, wer an der UHS ist
und nicht im Block steht; beide Listen lassen sich abwählen. Stamm-Personen und Helfer MUST dabei
in den Einsatz übernommen werden. Kommende ohne Einheit MUST ein Eintreffen bekommen, Gehende ohne
Einheit eine Ablösung (Quelle `abloesung`). Ein ETB-Eintrag MUST UHS, Gehende, Kommende und
Bleibende nennen. Kommen MUST nur, wer beim Vollzug im Block steht (sonst 422). Der Wechsel MUST die Freigaben der Module Unfallhilfsstellen und Personal
verlangen (403); eine aufgelöste oder stornierte UHS MUST 409 sein.

#### Scenario: UHS Markt um 18:00
- **WHEN** an der „UHS Markt“ „Anna“ und „Dana“ arbeiten, der Block ab 18:00 „Dana“ und „Ben“ hat und der Wechsel vollzogen wird
- **THEN** arbeiten „Dana“ und „Ben“ an der UHS, „Anna“ nicht mehr, und das ETB nennt „Geht «Anna». Kommt «Ben». Bleibt «Dana».“

### Requirement: Pause aus dem Plan
Das System SHALL zum Beginn eines Pausenblocks den Kräften des Blocks den Status setzen, den der
Katalog als Pause kennzeichnet (höchstens einer je Organisation), und zum Ende den vorigen Status
zurückgeben (auch einen leeren), wenn die Kraft dann noch den Pausenstatus trägt. Ohne gekennzeichneten Status MUST
der Beginn gesperrt sein (422 mit Grund), das Ende einer begonnenen Pause MUST weiter gehen; ein Ende ohne Beginn MUST 422 sein. Wer nicht im
Einsatz ist, MUST übersprungen und genannt werden. Der Wechsel MUST die Freigabe des Moduls
Personal verlangen (403).

#### Scenario: Pause zurück
- **WHEN** „Anna“ „im Einsatz“ war, ihre Pause 16:00–16:30 begonnen und um 16:30 beendet wird
- **THEN** trägt sie wieder „im Einsatz“

### Requirement: Wechsel zurücknehmen
Ein Wechsel aus dem Plan MUST je Block und Art höchstens einmal offen vollzogen sein (sonst 409).
Die Rücknahme MUST nur zurücklegen, was noch den Stand des Wechsels trägt: an der UHS die Zuordnung
der Kraft, in der Pause den Status. Sie MUST die Ereignisse der Zeitachse streichen und einen
ETB-Eintrag schreiben. Den Beginn einer Pause MUST sie erst nach Rücknahme ihres Endes zulassen
(409). Danach lässt sich der Wechsel erneut vollziehen. Einen Pausenblock mit begonnener, nicht
beendeter Pause MUST das System weder löschen noch aus der Zeile „Pause“ verschieben (409). Ist der
Pausenblock gelöscht oder nicht mehr in der Zeile „Pause“, MUST die Rücknahme seiner Wechsel 409
sein. Eine Kraft, die in einem späteren, nicht zurückgenommenen Wechsel an einer UHS
steht, MUST die Rücknahme an der UHS auslassen.

### Requirement: Wechsel-Leiste
Über dem Raster SHALL der Schichtplan je Zeitpunkt der nächsten 24 h einen Knopf mit der Zahl der
Wechsel zeigen, dazu frühere Zeitpunkte der letzten 12 h, an denen noch etwas offen ist (als
„überfällig“). Ein Wechsel ist an einer Einheit das Ende eines Blocks oder der Beginn eines Blocks
ohne Vorgänger; ein Block, der binnen der Toleranz nach dem Ende beginnt, MUST zum Wechsel am Ende
gehören. An einer UHS ist es der Beginn eines Blocks, in der Pause Beginn und Ende. Jeder Eintrag
MUST seinen Stand nennen: offen, vollzogen oder, an einer Einheit ohne Schicht laut Plan, „keine
Schicht“; eine abgezogene oder vollzogene Schicht laut Plan macht den Eintrag „vollzogen“, auch
wenn der Posten endet. Der gewählte Zeitpunkt MUST seine Wechsel mit Griff zeigen: an einer Einheit mit offener
Schicht den Vollzug der Ablösung, an UHS und Pause den Wechsel des Blocks. Zeitpunkte, Einträge
und Stand MUST der Server rechnen (`wechsel` im Plan). Der Sprung `?wechsel=<minute>` MUST den
Zeitpunkt wählen.

#### Scenario: Drei Wechsel um 14:00
- **WHEN** „RTW 1“ und „RTW 2“ laut Plan um 14:00 wechseln und an der „UHS Nord“ um 14:00 ein Block beginnt
- **THEN** zeigt die Leiste „14:00 · 3 Wechsel“, und der Knopf listet beide Einheiten mit „Ablösung vollziehen“ und die UHS mit „Wechsel vollziehen“

### Requirement: Ein Hinweis je Zeitpunkt
Schichten, die laut Plan zum selben Zeitpunkt fällig sind, SHALL das System gebündelt melden: die
Vorwarnung und die Fälligkeit MUST es je Zeitpunkt einmal melden (Bezug `schichtplan_wechsel`, der
Zeitpunkt in Minuten seit 1970), nicht je Schicht (EEMUA 191). Die Detailzeile MUST die Zahl der
Wechsel und die Uhrzeit nennen („15 Wechsel um 1400“), bei einem einzigen Wechsel die Einheit wie
bei einer Schicht. Der Sprung MUST in den Schichtplan auf den Zeitpunkt führen
(`?ansicht=plan&wechsel=`). Kommt eine Schicht zu einem Zeitpunkt hinzu, dessen Hinweis noch
offen ist, MUST sie schweigen; ist er quittiert, MUST sie ihn neu melden. Ist eine Schicht zum
Beginn eines Folgeblocks fällig, der binnen der Toleranz nach dem Ende eines Blocks beginnt, MUST
das Ende dieses Blocks ihr Zeitpunkt sein, wie in der Leiste. Schichten nach Rangfolge MUST sich
weiter einzeln melden. Wechsel an
UHS und Pause haben keine Frist und melden sich nicht.

#### Scenario: 15 Posten um 14:00
- **WHEN** 15 Einheiten laut Plan um 14:00 wechseln
- **THEN** bekommt jeder Leser der Ablösung um 13:30 eine Vorwarnung und um 14:00 einen Alarm „Ablösung fällig“ mit „15 Wechsel um 1400“, nicht je 15

### Requirement: Austauschformat
Das System SHALL einen Schichtplan aus einer Datei lesen können, als Excel (`.xlsx`) oder CSV,
höchstens 2 MB und 5.000 Zeilen. Die erste Zeile MUST die Kopfzeile sein; eine Zeile steht für
eine Person in einer Schicht. Pflicht sind `Beginn`, `Ende` und, außer bei der Pause, `Posten`.
Eine Zeit mit Versatz MUST so gelten, wie sie ist; eine Zeit ohne Versatz oder eine Datumszelle
MUST als Ortszeit in der Zone des Einsatzes gelten. Raster und Länge der Blöcke MUST den Regeln
der Planschicht folgen. Das Format MUST in der Anwenderdoku beschrieben sein.

#### Scenario: CSV aus dem deutschen Excel
- **WHEN** jemand eine CSV mit `;` als Trennzeichen und BOM einliest
- **THEN** liest das System dieselben Blöcke wie aus der gleichen Liste als XLSX

#### Scenario: Zeit ohne Zone
- **WHEN** eine Zeile `Beginn` = `2026-08-15 14:00` ohne Versatz trägt und der Einsatz in Europe/Berlin läuft
- **THEN** beginnt der Block um 12:00 UTC, und die Vorschau nennt einen Hinweis zur Zeile

### Requirement: Schichtplan einlesen
Das Einlesen MUST in zwei Schritten laufen: Die Vorschau MUST nichts schreiben und je Posten
einen Vorschlag (bestehende Einheit oder UHS, sonst neu) und je Person einen Abgleich (Kennung
und Herkunft, Kennung mit Name, Name mit Telefon, Name allein als unsicher, sonst neu als Helfer
des Plans) zeigen, dazu Fehler und Hinweise mit Zeile. Erst das Übernehmen MUST schreiben, alles
oder nichts, und MUST bei einem Fehler mit 422 antworten. Neue Personen MUST Helfer des Plans mit
Kennung und Herkunft werden, kein Stamm-Personal. Das Einlesen MUST NOT alarmieren, disponieren
oder einen Status setzen. Es MUST das Schreibrecht in der Ablösung und die Freigabe des Moduls
Personal verlangen, für Blöcke an Einheiten (bestehend oder neu) zusätzlich die Freigabe
Einheiten, an UHS die Freigabe Unfallhilfsstellen, wie beim Planen von Hand.

#### Scenario: Vorschau schreibt nichts
- **WHEN** jemand die Beispieldatei „Stadtfest“ in der Vorschau öffnet
- **THEN** zeigt das System Posten, Personen und Zählung, und der Plan bleibt unverändert

#### Scenario: Treffer über die Personalnummer
- **WHEN** eine Zeile `Kennung` = `DEMO-S-006` und den Namen „Karl Beispiel“ trägt und die Stamm-Person mit dieser Personalnummer so heißt
- **THEN** schlägt die Vorschau diese Stamm-Person als sicheren Treffer vor

#### Scenario: Neuer Helfer
- **WHEN** eine Person der Datei weder über Kennung noch über Name zu finden ist
- **THEN** legt das Übernehmen sie als Helfer des Plans mit Kennung und Herkunft an, und sie steht nicht in der Personalliste des Einsatzes

#### Scenario: Fehler sperrt
- **WHEN** ein Block der Datei sich mit einem vorhandenen Block desselben Postens überschneidet
- **THEN** nennt die Vorschau die Zeile als Fehler, und das Übernehmen antwortet 422 und schreibt nichts

### Requirement: Wiederholtes Einlesen
Ein zweites Einlesen MUST nur ergänzen: Ein Block mit gleichem Posten, Beginn und Ende MUST
bestehen bleiben und nur fehlende Personen aufnehmen; Soll, Notiz und vorhandene Personen MUST
unverändert bleiben. Das Einlesen MUST NOT löschen. Dieselbe Datei ein zweites Mal MUST keine
Änderung, keinen ETB-Satz und kein Live-Ereignis erzeugen.

#### Scenario: Zweiter Lauf
- **WHEN** jemand die Beispieldatei „Stadtfest“ übernommen hat und sie noch einmal übernimmt
- **THEN** meldet das System 0 Änderungen, und der Plan ist derselbe

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

### Requirement: Schichtplan als Excel-Mappe
Das System SHALL den Schichtplan eines Einsatzes als Excel-Mappe ausgeben
(`GET …/abloesungen/schichtplan/export`) mit den Blättern „Austausch“ (zuerst), „Übersicht“,
„Je Posten“, „Je Person“ und „Befunde“. Das Blatt „Austausch“ MUST dem Austauschformat folgen,
Zeiten MUST dort als ISO 8601 mit Versatz stehen und in den übrigen Blättern als Text in der Zone
des Einsatzes. Der Abruf MUST Leserecht in der Ablösung und die Freigabe des Moduls Personal
verlangen (403 sonst) und auch im abgeschlossenen Einsatz gehen. Er MUST NOT ins Einsatztagebuch
schreiben. Eine exportierte Mappe, in denselben Einsatz wieder eingelesen, MUST nur unveränderte
Posten, Blöcke und Personen ergeben.

#### Scenario: Rundweg
- **WHEN** jemand die Mappe eines Einsatzes exportiert und sie in denselben Einsatz einliest
- **THEN** zeigt die Vorschau nur „unverändert“ und keinen unsicheren Treffer, und Übernehmen
  schreibt nichts

#### Scenario: Ohne Modul Personal
- **WHEN** jemand ohne Freigabe des Moduls Personal die Mappe abruft
- **THEN** antwortet das System mit 403, und in der Ansicht ist „Excel“ mit Grund gesperrt

### Requirement: Eigene Bezüge im Austauschformat
Das Austauschformat SHALL zusätzlich zu externen Kennungen eigene Bezüge kennen: Herkunft
„Lifeline Hub“ mit einer Kennung `personal-<id>`, `einsatzkraft-<id>` oder `helfer-<id>`. Helfer
einer Planung ohne eigene Kennung MUST ihre Helfer-ID als Kennung und die Herkunft `vorplanung`
tragen, wie die Übernahme einer Planung sie anlegt. Beim Abgleich der Personen MUST eine Zeile mit
Herkunft „Lifeline Hub“ zuerst gegen den Bezug geprüft werden: Stamm-Personal derselben
Organisation bzw. Ad-hoc-Kraft oder Helfer desselben Einsatzes mit passendem Namen trifft sicher.
Trifft der Bezug nicht, MUST die Zeile wie jede andere abgeglichen werden. Externe Kennungen MUST
das Format ohne Bezug auf ein bestimmtes Fremdsystem beschreiben.

#### Scenario: Bezug auf eine Ad-hoc-Kraft
- **WHEN** eine Zeile `Kennung = einsatzkraft-9`, `Herkunft = Lifeline Hub` trägt und die
  Ad-hoc-Kraft 9 in diesem Einsatz denselben Namen hat
- **THEN** trifft der Abgleich diese Kraft sicher und legt keinen Helfer an

#### Scenario: Bezug aus einem anderen Einsatz
- **WHEN** eine Zeile `Kennung = helfer-4`, `Herkunft = Lifeline Hub` in einen anderen Einsatz
  eingelesen wird
- **THEN** läuft der Abgleich über Kennung, Name und Telefon weiter, und ein neuer Helfer speichert
  Kennung und Herkunft, sodass ein zweiter Lauf ihn trifft
