# personen-detail Specification

## Purpose
Legt fest, wie die Detailseite einer Person (Modul Betroffene, auch am UHS-Gerät) aufgebaut ist
und bedient wird. Oben beantwortet sie die Patientenfragen auf einen Blick, Sichten, Verbleib und
Notiz gehen in der Ansicht. Tier- und Schadenbezüge stehen in einer Liste.

## Requirements

### Requirement: Patientenkopf beantwortet die Patientenfragen

Die Detailseite einer angetroffenen Person SHALL als erstes Paneel einen Patientenkopf zeigen.
Er MUST enthalten:
- die aktuelle Sichtung mit taktischer Zeit (DTG), Abstand zu jetzt („vor n min“) und dem Namen
  dessen, der bestätigt hat, falls es ihn gibt;
- „Zustand / Verdacht“;
- den Aufenthalt (UHS mit Platz oder Wartebereich und seit wann) oder nach dem Austritt den
  letzten Verbleib (Art, Ziel, Transportmittel, Zeit);
- die letzte Verlaufsnotiz.

Bei 1280 × 800 und 1440 × 900 MUST all das ohne Bildlauf sichtbar sein. Bei 390 × 844 MUST mindestens
Sichtung, Zustand / Verdacht und Aufenthalt in der ersten Bildschirmhöhe stehen. Der Abstand zu
jetzt MUST im Minutentakt nachlaufen. Das Öffnen der Seite MUST weiterhin genau einen Abruf des
Details auslösen.

#### Scenario: Patient im Wartebereich am Tablet
- **WHEN** das Detail eines Patienten mit SK II, Zustand „Verdacht auf Hüftfraktur“ und Aufenthalt
  im Wartebereich der UHS „Turnhalle“ bei 1280 × 800 geöffnet wird
- **THEN** stehen ohne Bildlauf „SK II“ mit DTG und „vor n min“, „Verdacht auf Hüftfraktur“ und
  „Turnhalle · Wartebereich · seit …“

#### Scenario: Patient nach dem Abtransport
- **WHEN** das Detail einer Person geöffnet wird, die per Transport an „KH Mitte“ übergeben wurde
- **THEN** zeigt der Kopf statt des Aufenthalts den Verbleib „Transport → KH Mitte“ mit
  Transportmittel und Zeit

#### Scenario: Ein Abruf beim Öffnen
- **WHEN** die Detailseite geöffnet wird
- **THEN** wird das Detail genau einmal abgerufen, und für UHS- und Platznamen folgt kein weiterer
  Abruf

### Requirement: Sichten, Verbleib und Notiz ohne Dialog

Nachsichten, Verbleib erfassen und eine Verlaufsnotiz anlegen SHALL auf der Detailseite ohne
Dialog gehen: Die Sichtungswahl klappt im Patientenkopf auf, der Verbleib als Paneel in der
Ansicht, die Notiz als Eingabezeile. Eine Ablehnung des Servers MUST am Ort stehen bleiben, bis
erneut abgeschickt wird. Ein laufendes Speichern MUST nur das eigene Paneel sperren. Ohne
Schreibrecht MUST keine dieser Bedienungen erscheinen. Die Wahl „verstorben“ MUST weiter eine
Rückfrage auslösen.

#### Scenario: Nachsichten im Kopf
- **WHEN** jemand mit Schreibrecht auf die Sichtung im Patientenkopf tippt, „SK I“ wählt und
  „Übernehmen“ drückt
- **THEN** ist die Sichtung gespeichert, ohne dass ein Dialog geöffnet wurde, und der Kopf zeigt
  „SK I“ mit neuer Zeit

#### Scenario: Ablehnung am Ort
- **WHEN** der Server eine Verbleib-Erfassung ablehnt
- **THEN** steht der Grund im Verbleib-Paneel, die Eingaben bleiben erhalten, und die übrigen
  Paneele bleiben bedienbar

#### Scenario: Ohne Schreibrecht
- **WHEN** ein Beobachter das Detail öffnet
- **THEN** zeigt der Kopf Sichtung, Zustand / Verdacht, Aufenthalt und letzte Notiz nur lesend

### Requirement: Aufenthalt mit Verlegen und Austragen

Der Aufenthalt im Patientenkopf SHALL die Handlungen am Aufenthalt tragen: „In UHS aufnehmen“,
wenn die Person in keiner UHS steht, sonst „Verlegen“ und „Austragen“. Die Handlungen MUST nur mit
Schreibrecht und nicht am gekoppelten Gerät erscheinen. Der Aufenthalt MUST ohne Aufklappen
sichtbar sein.

#### Scenario: Verlegen aus dem Kopf
- **WHEN** jemand mit Schreibrecht bei einer Person in der UHS „Turnhalle“ „Verlegen“ wählt und
  die UHS „Zelt Nord“ übernimmt
- **THEN** zeigt der Kopf danach „Zelt Nord · Wartebereich · seit …“

#### Scenario: Am UHS-Tablet nur lesen
- **WHEN** das Detail am gekoppelten UHS-Tablet geöffnet wird
- **THEN** steht der Aufenthalt im Kopf, aber ohne „Verlegen“ und „Austragen“

### Requirement: Bezüge zu Tier und Schaden in einer Liste

Die Detailseite SHALL Tier- und Schadenbezüge einer Person in einem Abschnitt „Bezüge“ als eine
Liste in Einsatzsprache zeigen, etwa „Halter von T-003 · Hund „Bello““ oder „Geschädigt bei
S-007 · Wasserschaden“. Jede Zeile MUST zum Tier bzw. Schaden springen und mit Schreibrecht
„Bezug lösen“ anbieten. „Bezug hinzufügen“ MUST eine gemeinsame Suche über die freien Tiere und
die Schäden des Einsatzes öffnen. Hinzufügen MUST einen Knopf, eine Suche und eine Wahl kosten.
Ein abgelehnter Schreibversuch MUST an seiner Zeile stehen. Ist der Abschnitt eingeklappt, MUST
er erst beim Aufklappen laden.

#### Scenario: Tier als Bezug hinzufügen
- **WHEN** jemand mit Schreibrecht „Bezug hinzufügen“ wählt, „Bello“ sucht und das Tier T-003
  wählt
- **THEN** steht in den Bezügen „Halter von T-003 · Hund „Bello““, und T-003 nennt die Person als
  Halter

#### Scenario: Bezug lösen wird abgelehnt
- **WHEN** das Lösen eines Bezugs vom Server abgelehnt wird
- **THEN** steht der Grund an dieser Zeile, und die übrigen Zeilen bleiben unverändert

#### Scenario: Keine Bezüge
- **WHEN** eine Person weder Tier noch Schaden als Bezug hat
- **THEN** zeigt der Abschnitt „Bezüge 0“ und mit Schreibrecht den Knopf „Bezug hinzufügen“
