# Spec Delta

## Purpose

Ein geschlossener Katalog der Führungsfunktionen nach FwDV 100 Anlage 1 und 2. Er dient als
adressierbarer Empfänger von Erinnerungen und Aufträgen und als Führungsstelle eines Mitglieds.
Zur Lesezeit löst er auf die aktuelle Besetzung auf, ohne die historische Anzeige zu verändern.

## ADDED Requirements

### Requirement: Geschlossener Katalog mit art-Achse
Das System SHALL einen festen Katalog von Führungsfunktionen führen, jede mit Code, Kürzel,
Standardlabel und `art`:

| Code | art | Standardlabel |
|---|---|---|
| `el` | `leitung` | Einsatzleitung |
| `s1`–`s6` | `sachgebiet` | nach FwDV 100 Anlage 2: Personal, Lage, Einsatz, Versorgung, Presse- und Medienarbeit, Information und Kommunikation |
| `s7` | `sachgebiet` | Psychosoziale Notfallversorgung |
| `fuehrungshilfspersonal` | `fuehrungshilfspersonal` | Führungshilfspersonal |
| `fachberater` | `fachberater` | Fachberater |

Ein Code außerhalb dieses Katalogs MUST mit 400 abgelehnt werden. `art` ist aus dem Code
abgeleitet und MUST NOT gesondert gespeichert oder vom Client gesetzt werden. Führungshilfspersonal
und Fachberater MUST NOT als Sachgebiet (S-Zeile) erscheinen.

#### Scenario: Katalog abrufen
- **WHEN** ein angemeldeter Benutzer den Katalog seiner Organisation abruft
- **THEN** erhält er die Einträge in der Reihenfolge `el`, `s1`–`s6`, `s7` (falls eingeschaltet),
  `fuehrungshilfspersonal`, `fachberater`. Jeder Eintrag trägt Code, Kürzel, wirksames Label,
  `art` und die Angabe, ob eine Bezeichnung Pflicht ist

#### Scenario: Unbekannter Code
- **WHEN** ein Empfänger mit dem Code `s9` angelegt werden soll
- **THEN** antwortet der Server mit 400, und nichts wird gespeichert

### Requirement: Bezeichnung bei Führungshilfspersonal und Fachberater
Eine Funktion der art `fuehrungshilfspersonal` oder `fachberater` SHALL eine nichtleere
Bezeichnung tragen, z. B. „Lagekartenführer“ oder „THW“. Fehlt sie, MUST der Server
mit 422 ablehnen. Eine Bezeichnung zu `el` oder einem Sachgebiet MUST ebenfalls mit 422 abgelehnt
werden.

#### Scenario: Fachberater ohne Bezeichnung
- **WHEN** ein Auftrag an `fachberater` mit leerer Bezeichnung erteilt wird
- **THEN** antwortet der Server mit 422, und der Auftrag entsteht nicht

#### Scenario: Sachgebiet mit Bezeichnung
- **WHEN** eine Erinnerung an `s3` mit der Bezeichnung „Müller“ angelegt wird
- **THEN** antwortet der Server mit 422

### Requirement: Mandantenlabels und S7
Eine Organisation SHALL das Anzeigelabel jedes Katalogcodes überschreiben können. Ein leeres
Label stellt das Standardlabel wieder her. S7 SHALL je Organisation ein- und ausschaltbar sein,
Vorgabe aus. Ist S7 aus, MUST ein neuer Empfänger oder eine neue Führungsstelle mit `s7` mit 422
abgelehnt werden. Bestehende Datensätze mit `s7` bleiben lesbar. Labels und Schalter pflegt nur ein
Admin der eigenen Organisation. Das wirksame Label MUST in allen neu erzeugten Anzeigen und Texten
gelten: Snapshot des Empfängers, Stabseite, abgeleitete Funktion im Kopf, System-ETB-Text der
Besetzung.

#### Scenario: THW-Label
- **WHEN** ein Admin das Label von `s4` auf „Versorgung (Logistik)“ setzt und danach ein Auftrag an
  `s4` erteilt wird
- **THEN** trägt der Empfänger den Snapshot „S4 Versorgung (Logistik)“, und die Stabseite zeigt
  die S4-Zeile mit diesem Label

#### Scenario: Label zurücksetzen
- **WHEN** ein Admin das Label von `s4` leert
- **THEN** gilt wieder „Versorgung“

#### Scenario: S7 ausgeschaltet
- **WHEN** S7 für die Organisation aus ist und eine Erinnerung an `s7` angelegt werden soll
- **THEN** antwortet der Server mit 422, und der Katalog zeigt S7 nicht

#### Scenario: Kein Admin
- **WHEN** ein Benutzer ohne Adminrecht ein Label ändern will
- **THEN** antwortet der Server mit 403

### Requirement: Empfänger mit Katalogwert oder Freitext
Erinnerung, Auftrag (Empfänger vom Typ Funktion) und Führungsstelle eines Mitglieds SHALL
entweder einen Katalogcode (mit Bezeichnung, wo Pflicht) oder einen Freitext tragen. Freitext
bleibt als ausdrücklicher Fallback erlaubt. Das System MUST NOT aus einem Freitext auf einen
Katalogcode schließen, weder beim Speichern noch beim Lesen noch für Bestandsdaten.

#### Scenario: Freitext bleibt Freitext
- **WHEN** ein Auftrag an den Freitext „S3“ erteilt wird
- **THEN** speichert der Server ihn als Freitext ohne Katalogcode. Er wird nicht aufgelöst

#### Scenario: Bestandsdaten
- **WHEN** nach der Migration eine vorher angelegte Erinnerung mit „S2“ im Freitext gelesen wird
- **THEN** erscheint sie unverändert als Freitext „S2“, ohne Katalogcode

### Requirement: Snapshot trägt nur das Funktionslabel
Der Anzeige-Snapshot eines Auftragsempfängers mit Katalogcode SHALL beim Anlegen aus Kürzel und
wirksamem Label entstehen, bei Führungshilfspersonal und Fachberater als „<Label>: <Bezeichnung>“.
Beispiele: „S3 Einsatz“, „Fachberater: THW“. Er MUST NOT den Namen der Person enthalten, die die
Funktion gerade besetzt. Der Snapshot bleibt nach dem Anlegen unverändert. Das `an` des
ETB-Eintrags zur Anordnung SHALL aus diesen Snapshots entstehen.

#### Scenario: Snapshot ohne Person
- **WHEN** S3 mit Müller besetzt ist und ein Auftrag an `s3` erteilt wird
- **THEN** lautet der Snapshot „S3 Einsatz“, und das `an` des ETB-Eintrags enthält „S3 Einsatz“,
  nicht „Müller“

### Requirement: Auflösung zur Lesezeit auf die aktuelle Besetzung
Beim Lesen eines Auftrags oder einer Erinnerung, deren Empfänger ein Sachgebiet `s1`–`s6` ist,
SHALL das System die aktuelle Besetzung dieses Sachgebiets im Einsatz mitliefern: Name der
disponierten oder externen Person, rückwärtige Stelle, „bei der Einsatzleitung“ oder „nicht
vergeben“. Für `el`, `s7`, Führungshilfspersonal, Fachberater und Freitext MUST keine Auflösung
erscheinen. Das Feld fehlt, es gibt keinen Platzhalter. Wer das Stab-Modul im Einsatz nicht lesen
darf, MUST die Auflösung nicht erhalten. Ein Besetzungswechsel SHALL die Anzeige von Aufträgen und
Erinnerungen live aktualisieren.

#### Scenario: Paar-Test Besetzungswechsel
- **WHEN** ein Auftrag an `s3` erteilt wird, während Müller S3 besetzt, und danach S3 auf Schulz
  wechselt
- **THEN** liefert der Auftrag vorher den Snapshot „S3 Einsatz“ mit der Besetzung „Müller“ und
  nachher denselben Snapshot „S3 Einsatz“ mit der Besetzung „Schulz“

#### Scenario: Nicht vergeben
- **WHEN** eine Erinnerung an `s4` gelesen wird und S4 keine Besetzung hat
- **THEN** lautet die Auflösung „nicht vergeben“

#### Scenario: Ohne Stab-Recht
- **WHEN** eine Person mit Leserecht auf Aufträge, aber ohne Freigabe des Stab-Moduls, einen
  Auftrag an `s3` liest
- **THEN** sieht sie den Snapshot „S3 Einsatz“ und keine Besetzung

#### Scenario: Nach der Schwärzung
- **WHEN** ein Einsatz geschwärzt wurde
- **THEN** liefert die Auflösung keinen Personennamen mehr, der Snapshot bleibt

### Requirement: Führungsstelle als Katalogwert
Die Einsatzleitung SHALL die Führungsstelle eines Mitglieds als Katalogwert (mit Bezeichnung, wo
Pflicht) oder als Freitext setzen und leeren können. Die gesetzte Führungsstelle ist die
ausdrückliche Wahl und gewinnt immer gegen eine Ableitung.

#### Scenario: Führungsstelle S2
- **WHEN** die Einsatzleitung einem Mitglied die Führungsstelle `s2` setzt
- **THEN** zeigt die Mitgliederliste „S2 Lage“, und das Mitglied erhält die Führungsstelle als
  Katalogwert an seinem Einsatz

### Requirement: Vorrangregel der ETB-Vorbelegung
Die erste neue ETB-Erfassung eines Mitglieds SHALL das Feld „An“ so vorbelegen:
1. mit der gesetzten Führungsstelle (Katalogwert als Kürzel, bei Führungshilfspersonal und
   Fachberater als „<Label>: <Bezeichnung>“, sonst der Freitext);
2. sonst mit dem Kürzel des ersten Sachgebiets in S1–S6-Folge, das die mit dem Benutzer über
   `personal.benutzer_id` verknüpfte Person besetzt;
3. sonst gar nicht.

Eine Berichtigung MUST NOT vorbelegt werden.

#### Scenario: Führungsstelle gewinnt
- **WHEN** ein Mitglied die Führungsstelle Fachberater mit der Bezeichnung „THW“ hat und zugleich
  S2 besetzt
- **THEN** ist „An“ mit „Fachberater: THW“ vorbelegt

#### Scenario: Ableitung aus der Besetzung
- **WHEN** ein Mitglied keine Führungsstelle hat und über sein Konto S2 und S3 besetzt
- **THEN** ist „An“ mit „S2“ vorbelegt

#### Scenario: Weder noch
- **WHEN** ein Mitglied keine Führungsstelle hat und kein Sachgebiet besetzt
- **THEN** bleibt „An“ leer

### Requirement: Vorschläge aus Katalog und Besetzung
Die Empfängerfelder von Erinnerung und Auftrag und die Führungsstelle SHALL die Katalogeinträge
als Auswahl anbieten. Ein Sachgebiet trägt die aktuelle Besetzung im Vorschlag, sofern sie lesbar
ist, z. B. „S2 – Lage (Müller)“. Für Führungshilfspersonal und Fachberater SHALL der eingetippte
Text als ausdrückliche Wahl „Fachberater: <Text>“ bzw. „Führungshilfspersonal: <Text>“ angeboten
werden, daneben der Freitext. Die Felder „Von“ und „An“ des ETB SHALL die Sachgebiete zusätzlich
zu den Funkrufnamen vorschlagen. Übernommen wird dort das Kürzel als Freitext.

#### Scenario: Auswahl im Auftrag
- **WHEN** jemand im Auftragsformular „S3 – Einsatz (Müller)“ wählt und erteilt
- **THEN** entsteht ein Funktionsempfänger mit dem Code `s3`, nicht der Freitext „S3“

#### Scenario: Fachberater aus dem Tipptext
- **WHEN** jemand im Empfängerfeld „THW“ tippt und „Fachberater: THW“ wählt
- **THEN** entsteht ein Empfänger mit Code `fachberater` und Bezeichnung „THW“

#### Scenario: ETB-Vorschlag
- **WHEN** jemand im ETB-Feld „An“ den Vorschlag „S2 – Lage (Müller)“ wählt
- **THEN** steht im Feld „S2“
