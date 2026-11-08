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
