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
- „Versorgt von“ mit versorgender Einheit und Abschnitt und dem Verweis „aus Meldung #n“, falls
  es sie gibt oder Schreibrecht besteht;
- den Aufenthalt (UHS mit Platz oder Wartebereich und seit wann) oder nach dem Austritt den
  letzten Verbleib (Art, Ziel, Transportmittel, Zeit);
- den Transportstand (Priorität, Art, benötigte Fachrichtung), falls es einen gibt;
- die PAT-Nummer und die Marke „kontaminiert“, falls angegeben;
- die gültigen Maßnahmen mit Uhrzeit;
- die gültigen Verletzungen als nummerierte Liste mit Uhrzeit, ab `md` mit kleiner Figur;
- die letzte Verlaufsnotiz.

Bei 1280 × 800 und 1440 × 900 MUST all das ohne Bildlauf sichtbar sein. Lange Listen von Maßnahmen
oder Verletzungen MUST der Kopf kürzen, die jüngsten zuerst zeigen und die Zahl der übrigen
nennen. Bei 390 × 844 MUST
mindestens Sichtung, Zustand / Verdacht und Aufenthalt in der ersten Bildschirmhöhe stehen. Der
Abstand zu jetzt MUST im Minutentakt nachlaufen. Das Öffnen der Seite MUST weiterhin genau einen
Abruf des Details auslösen.

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

#### Scenario: Voller PAT-Kern bei 1280 × 800
- **WHEN** das Detail eines Patienten mit Transport „dringlich · liegend · Unfallchirurgie“,
  PAT-Nummer, Kontamination, drei Maßnahmen und vier Verletzungen bei 1280 × 800 geöffnet wird
- **THEN** stehen Sichtung, Zustand / Verdacht, Aufenthalt, Transport, PAT-Nummer, „kontaminiert“,
  Maßnahmen, Verletzungen und letzte Notiz ohne Bildlauf

### Requirement: Sichten, Verbleib und Notiz ohne Dialog

Nachsichten, Verbleib erfassen, eine Verlaufsnotiz anlegen, den Transport festlegen, eine
Maßnahme erfassen und eine Verletzung markieren SHALL auf der Detailseite ohne Dialog gehen. Die
Sichtungswahl klappt im Patientenkopf auf. Verbleib, Transport, Maßnahme und Verletzung erscheinen
je als Paneel in der Ansicht, die Notiz als Eingabezeile. Eine Ablehnung des Servers MUST am Ort
stehen bleiben, bis erneut abgeschickt wird. Ein laufendes Speichern MUST nur das eigene Paneel
sperren. Ohne Schreibrecht MUST keine dieser Bedienungen erscheinen. Die Wahl „verstorben“ MUST
weiter eine Rückfrage auslösen.

Am UHS-Gerät ohne Netz MUST ein Eintrag vorgemerkt werden statt zu scheitern. Am Ort MUST dann die
Quittung „Offline vorgemerkt“ stehen. Lehnt der Server den Eintrag später ab, MUST der Grund in der
Wiederherstellung der Warteschlange stehen, bis ihn jemand verwirft.

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

#### Scenario: Nachsichtung am Tablet ohne Netz
- **WHEN** am UHS-Tablet ohne Netz eine Nachsichtung übernommen wird
- **THEN** steht im Kopf „Offline vorgemerkt“
- **AND** nach der Rückkehr des Netzes steht die Sichtung einmal mit ihrer Erfassungszeit im Verlauf

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

### Requirement: Versorgende Einheit und Meldung im Patientenkopf

Der Patientenkopf SHALL unter „Zustand / Verdacht“ die Zeile „Versorgt von“ zeigen: die
versorgende Einheit mit dem Abschnitt dahinter („Streife 2 · Bühne“) und, wenn die Person aus
einer Meldung angelegt wurde, den Verweis „aus Meldung #n“ auf `meldungen?meldung=<id>`. Der
Abschnitt MUST zur Abfragezeit aus der Einheit folgen, nicht aus einem Schnappschuss. Mit
Schreibrecht MUST die Einheit inline änderbar und leerbar sein, über einen PATCH mit Feld-CAS
(`erwartet` = Einheit beim Öffnen); zur Wahl stehen die nicht aufgelösten Einheiten des Einsatzes
über `GET …/personen/einheiten`, die erst beim Öffnen lädt. Ohne Netz MUST das Feld mit Grund
gesperrt stehen, am gekoppelten Gerät nur lesend. Lesend fehlt die Zeile ohne Einheit und
Meldung. Ohne Zugriff auf das Modul Meldungen MUST „aus Meldung #n“ Text ohne Verweis sein. Der
Meldungsbezug MUST nach dem Anlegen fest bleiben.

#### Scenario: Einheit eintragen
- **WHEN** jemand mit Schreibrecht bei einer Person ohne Einheit „Versorgende Einheit eintragen“
  wählt, „Streife 2 · Bühne“ wählt und speichert
- **THEN** geht ein PATCH mit `versorgende_einheit_id` und `erwartet.versorgende_einheit_id: null`,
  und der Kopf zeigt „Streife 2 · Bühne“

#### Scenario: Gleichzeitige Änderung
- **WHEN** zwei die Einheit derselben Person gleichzeitig ändern
- **THEN** gilt die erste, die zweite bekommt 409, und der Kopf lädt den neuen Stand

#### Scenario: Aus einer Meldung angelegt
- **WHEN** das Detail einer Person geöffnet wird, die über „Patient anlegen“ an Meldung #17
  entstand
- **THEN** steht im Kopf „aus Meldung #17“ mit Verweis auf die Meldung

#### Scenario: Ohne Netz
- **WHEN** der Server nicht erreichbar ist
- **THEN** steht die Einheit lesend mit dem Grund „ohne Netz nicht änderbar“

### Requirement: Austritt aus der UHS zurücknehmen
Das System SHALL den Austritt einer Person aus einer UHS zurücknehmen: als neues Ereignis, das den
Austritt nennt, in dieselbe UHS, auf den Platz davor, wenn er frei oder nur durch diesen Austritt
in Aufbereitung ist, sonst in den Wartebereich. Abgelehnt (409, ohne Änderung) MUST sie werden,
wenn der Austritt nicht der jüngste Schritt ist, älter als zehn Minuten, schon zurückgenommen
oder ein automatischer mit Anlass war.

#### Scenario: Zurück auf den Platz
- **WHEN** eine Person auf Platz 3 der UHS Turnhalle ausgetragen wird und Platz 3 dadurch in Aufbereitung geht und die Rücknahme eine Minute später eingeht
- **THEN** liegt die Person wieder auf Platz 3, und Platz 3 ist belegt statt in Aufbereitung

#### Scenario: Platz inzwischen vergeben
- **WHEN** nach dem Austragen eine andere Person auf Platz 3 gelegt wurde und die Rücknahme eingeht
- **THEN** steht die Person wieder in der UHS Turnhalle im Wartebereich, und die Antwort sagt, dass der Platz nicht frei war

#### Scenario: Person inzwischen in einer anderen UHS
- **WHEN** die Person nach dem Austragen in die UHS Zelt Nord aufgenommen wurde und die Rücknahme eingeht
- **THEN** lehnt der Server mit 409 ab, und die Person bleibt in der UHS Zelt Nord

### Requirement: Wartezeit läuft über die Rücknahme weiter
„Wartet seit“ und der Aufenthalt „seit“ einer Person MUST ein Paar aus zurückgenommenem Austritt
und seiner Rücknahme übergehen: Sie zeigen den Zeitpunkt, der vor dem Austritt galt. Die Folge
nach Wartezeit MUST damit unverändert bleiben.

#### Scenario: Wartebereich nach Fehltipp
- **WHEN** eine Person seit 13:10 im Wartebereich der UHS Turnhalle wartet, um 13:40 ausgetragen und um 13:41 zurückgenommen wird
- **THEN** nennt ihr Aufenthalt „seit 13:10“, und sie steht im Wartebereich an derselben Stelle der Folge wie vor dem Austragen

### Requirement: Austragen rückgängig im Patientenkopf
Nach „Austragen“ im Patientenkopf SHALL ein Hinweis „<Kennung> aus <UHS> ausgetragen“ mit
„Rückgängig“ stehen, der die Rücknahme des eben gebuchten Austritts sendet. Kehrt die Person nur
in den Wartebereich zurück, MUST ein Hinweis das sagen. Eine Ablehnung MUST unter den Handlungen
des Aufenthalts stehen, ohne Fehler-Toast.

#### Scenario: Rückgängig nach Austragen
- **WHEN** jemand bei R-009 auf Platz 3 der UHS Turnhalle „Austragen“ und im Hinweis „Rückgängig“ wählt
- **THEN** zeigt der Kopf wieder „Turnhalle · Platz 3 · seit …“ mit der Zeit vor dem Austragen

#### Scenario: Ablehnung im Kopf
- **WHEN** die Rücknahme abgelehnt wird, weil R-009 inzwischen in der UHS Zelt Nord liegt
- **THEN** steht der Grund unter den Handlungen des Aufenthalts, und es erscheint kein Fehler-Toast
