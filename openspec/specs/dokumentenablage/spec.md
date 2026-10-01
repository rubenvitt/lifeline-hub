# dokumentenablage Specification

## Purpose
Die Dokumentenablage hält die Dateien eines Einsatzes (Lagepläne, Befehle, Formulare, Fotos) mit
Titel, Kategorie und optionalem Bezug bereit. Jede Änderung daran ist im Einsatztagebuch
nachgewiesen. Die Oberfläche antwortet auf Ablegen und Entfernen so, dass niemand über den Stand
einer langen Übertragung oder einer Löschung im Unklaren bleibt, und merkt ohne Verbindung nichts
vor.

## Requirements

### Requirement: Angaben eines Dokuments sind nachträglich änderbar
Das System SHALL Titel, Kategorie und Bezug eines lebenden Dokuments ändern können, ohne die Datei
neu hochzuladen. Jedes der drei Felder SHALL einzeln änderbar sein: ein nicht genanntes Feld
bleibt, wie es ist. Der Bezug SHALL sich setzen, auf ein anderes Ziel wechseln und entfernen
lassen. Datei, Dateiname, Ablagezeit, ablegende Person und der ETB-Eintrag der Ablage SHALL
unverändert bleiben. Die Antwort SHALL das Dokument im neuen Stand liefern.

#### Scenario: Titel und Kategorie korrigieren
- **WHEN** ein Schreibberechtigter bei einem als „Sonstiges“ abgelegten Dokument „Lagepaln“ den
  Titel auf „Lageplan“ und die Kategorie auf „Lagekarte/Plan“ ändert
- **THEN** antwortet das System mit 200 und dem Dokument mit Titel „Lageplan“ und Kategorie
  `lagekarte_plan`
- **AND** Dateiname, Größe und Download liefern dieselbe Datei wie vorher

#### Scenario: Vergessenen Bezug nachtragen
- **WHEN** ein Schreibberechtigter einem Dokument ohne Bezug einen Abschnitt dieses Einsatzes als
  Bezug gibt
- **THEN** zeigt das Dokument in der Liste diesen Abschnitt als Bezug

#### Scenario: Bezug entfernen
- **WHEN** ein Schreibberechtigter bei einem Dokument mit Bezug den Bezug ausdrücklich leert
- **THEN** hat das Dokument keinen Bezug mehr

#### Scenario: Nicht genanntes Feld bleibt
- **WHEN** eine Änderung nur den Titel nennt
- **THEN** bleiben Kategorie und Bezug des Dokuments unverändert

### Requirement: Eine Änderung wird wie die Ablage geprüft
Das Ändern SHALL dieselben Feldregeln anwenden wie das Ablegen. Ein Fehler eines einzelnen Felds
SHALL mit 400 abgelehnt werden: leerer Titel, Titel über 200 Zeichen, unbekannte Kategorie,
unbekannter Bezugstyp, nicht numerische Bezugs-ID, unbekanntes oder fremdes Bezugsziel. Ein Fehler
im Zusammenhang SHALL mit 422 abgelehnt werden: Bezugstyp und Bezugs-ID nicht gemeinsam. Eine
Anfrage, die keines der drei Felder nennt, SHALL mit 400 abgelehnt werden. Eine abgelehnte Anfrage SHALL
nichts ändern und keinen ETB-Eintrag schreiben.

#### Scenario: Leerer Titel
- **WHEN** eine Änderung den Titel auf eine Zeichenfolge aus Leerzeichen setzt
- **THEN** antwortet das System mit 400 und das Dokument behält seinen Titel

#### Scenario: Bezugstyp ohne Bezugs-ID
- **WHEN** eine Änderung einen Bezugstyp nennt, aber keine Bezugs-ID
- **THEN** antwortet das System mit 422

#### Scenario: Bezug auf einen Abschnitt eines anderen Einsatzes
- **WHEN** eine Änderung als Bezug einen Abschnitt eines anderen Einsatzes nennt
- **THEN** antwortet das System mit 400 und das Dokument behält seinen Bezug

#### Scenario: Leere Anfrage
- **WHEN** eine Änderung keines der Felder Titel, Kategorie und Bezug nennt
- **THEN** antwortet das System mit 400

### Requirement: Ändern braucht dieselben Rechte wie Ablegen
Das Ändern SHALL dieselben Voraussetzungen verlangen wie das Ablegen und Entfernen: Mitglied mit
Schreibrecht im Einsatz, freigegebenes Modul Dokumente und aktiven Einsatz. Ein Dokument eines
anderen Einsatzes, ein unbekanntes und ein entferntes Dokument SHALL mit 404 abgelehnt werden.

#### Scenario: Beobachter darf nicht ändern
- **WHEN** ein Beobachter des Einsatzes ein Dokument ändern will
- **THEN** antwortet das System mit 403

#### Scenario: Abgeschlossener Einsatz
- **WHEN** ein Schreibberechtigter ein Dokument eines abgeschlossenen Einsatzes ändern will
- **THEN** antwortet das System mit 409

#### Scenario: Entferntes Dokument
- **WHEN** ein Schreibberechtigter ein entferntes Dokument ändern will
- **THEN** antwortet das System mit 404

### Requirement: Eine wirksame Änderung ist im ETB nachgewiesen
Ändert eine Anfrage mindestens eine Angabe, SHALL das System in derselben Transaktion einen
System-ETB-Eintrag schreiben, der mit „Dokument geändert:“ beginnt, den neuen Titel und die neue
Kategorie nennt und jede geänderte Angabe mit altem und neuem Wert aufführt. Es SHALL denselben
Live-Hinweis auslösen wie das Ablegen. Eine Anfrage, deren Werte dem Stand entsprechen, SHALL
mit 200 antworten, ohne ETB-Eintrag und ohne Live-Hinweis.

#### Scenario: Titeländerung im ETB
- **WHEN** ein Schreibberechtigter den Titel eines Befehls von „Befehl 1“ auf „Befehl 1 – Nachtrag“
  ändert
- **THEN** steht im ETB genau ein neuer System-Eintrag, der mit „Dokument geändert:“ beginnt und
  „Befehl 1“ wie „Befehl 1 – Nachtrag“ nennt

#### Scenario: Unveränderte Werte
- **WHEN** eine Änderung Titel, Kategorie und Bezug mit den Werten nennt, die das Dokument schon
  trägt
- **THEN** antwortet das System mit 200 und das ETB erhält keinen neuen Eintrag

### Requirement: Die Dokumentenseite bietet Bearbeiten je Zeile
Mit Schreibrecht SHALL jede Zeile der Dokumentenseite die Aktion „Bearbeiten“ neben „Entfernen“
tragen, in Tabelle und Karte. Sie SHALL einen Dialog öffnen, der Titel, Kategorie und Bezug des
Dokuments vorbelegt zeigt, auch einen Bezug auf einen ETB-Eintrag außerhalb der zur Wahl
geladenen. Eine Ablehnung SHALL im Dialog stehen und die Eingaben stehen lassen. Ohne Schreibrecht
SHALL keine Zeile „Bearbeiten“ tragen.

#### Scenario: Dialog vorbelegt
- **WHEN** ein Schreibberechtigter bei einem Dokument mit Titel „Lageplan“, Kategorie
  „Lagekarte/Plan“ und Bezug auf Abschnitt „Nord“ „Bearbeiten“ wählt
- **THEN** zeigt der Dialog „Dokument bearbeiten“ genau diese drei Werte

#### Scenario: Speichern übernimmt die Änderung
- **WHEN** ein Schreibberechtigter im Dialog die Kategorie ändert und speichert
- **THEN** schließt der Dialog und die Zeile zeigt die neue Kategorie

#### Scenario: Ablehnung bleibt im Dialog
- **WHEN** der Server eine Änderung ablehnt
- **THEN** bleibt der Dialog mit den eingegebenen Werten offen und zeigt den Fehler

#### Scenario: Beobachter sieht kein Bearbeiten
- **WHEN** ein Beobachter die Dokumentenseite öffnet
- **THEN** trägt keine Zeile die Aktion „Bearbeiten“

### Requirement: Fortschritt beim Ablegen

Solange die Datei einer Ablage überträgt, SHALL der Dialog „Dokument ablegen“ den Fortschritt als
Balken mit ganzzahliger Prozentangabe zeigen. Der Wert MUST aus den übertragenen Bytes stammen,
nie aus einer Schätzung über die Zeit, und MUST nie zurückgehen. Die Anzeige MUST spätestens
100 ms nach dem Absenden erscheinen. Kennt der Browser die Gesamtgröße nicht, MUST der Balken ohne
Prozentzahl als laufend erscheinen.

#### Scenario: Große Datei über langsame Leitung
- **WHEN** eine Person eine 20-MiB-Datei ablegt und 5 MiB übertragen sind
- **THEN** zeigt der Dialog „Wird hochgeladen“ mit 25 %, und der Knopf „Ablegen“ ist gesperrt

#### Scenario: Prozentwert bleibt monoton
- **WHEN** der Browser nach 40 % ein Ereignis mit kleinerem Stand meldet
- **THEN** bleibt die Anzeige bei 40 %

### Requirement: Prüfphase nach der Übertragung

Ist die Datei vollständig übertragen, die Antwort des Servers aber noch offen, SHALL der Dialog
statt der Prozentangabe „Datei wird geprüft“ zeigen, bis die Antwort kommt. Felder und Datei
MUST bis dahin unverändert stehen bleiben.

#### Scenario: Virenscan dauert
- **WHEN** alle Bytes übertragen sind und der Server noch scannt
- **THEN** zeigt der Dialog „Datei wird geprüft“ ohne Prozentzahl, und „Ablegen“ bleibt gesperrt

#### Scenario: Ablage gelingt
- **WHEN** der Server die Ablage bestätigt
- **THEN** schließt der Dialog, die Erfolgsmeldung „Dokument abgelegt“ erscheint, und beim nächsten Öffnen steht kein Fortschritt mehr

### Requirement: Fehlermeldung nennt die Phase des Abbruchs

Scheitert eine Ablage ohne Antwort des Servers, MUST die Meldung im Dialog unterscheiden, ob die
Datei schon vollständig übertragen war. Vorher MUST sie sagen, dass nichts abgelegt wurde. Danach
MUST sie sagen, dass unklar ist, ob das Dokument angekommen ist, und bitten, die Liste zu prüfen,
bevor erneut abgelegt wird. In beiden Fällen MUST der Dialog mit Datei und Feldern offen bleiben.

#### Scenario: Leitung bricht während der Übertragung ab
- **WHEN** die Verbindung bei 60 % abreißt
- **THEN** steht im Dialog, dass die Verbindung fehlt und nichts abgelegt wurde, und Datei, Titel und Kategorie stehen unverändert

#### Scenario: Antwort bleibt nach vollständiger Übertragung aus
- **WHEN** alle Bytes übertragen sind und die Antwort innerhalb des Zeitlimits ausbleibt
- **THEN** steht im Dialog, dass das Ergebnis unbekannt ist und die Liste vor einem neuen Versuch zu prüfen ist, nicht „nicht abgeschickt“

#### Scenario: Server lehnt ab
- **WHEN** der Server mit einer Meldung ablehnt (etwa Dateityp oder Schadsoftware)
- **THEN** steht dessen Meldung im Dialog wie bisher

### Requirement: Keine Vormerkung ohne Verbindung

Die Dokumentenablage MUST eine Ablage ohne Verbindung NICHT auf dem Gerät vormerken: weder die
Datei noch die Angaben dazu MUST in einem Gerätespeicher landen. Ohne Verbindung SHALL der Dialog
die Ablage als nicht erfolgt melden und mit Datei und Feldern offen bleiben, sodass „Ablegen“ sie
erneut versucht.

#### Scenario: Ablegen im Funkloch
- **WHEN** eine Person ohne Verbindung „Ablegen“ wählt
- **THEN** meldet der Dialog, dass nichts abgelegt wurde, die Offline-Queue bleibt unverändert, und ein erneutes „Ablegen“ mit Verbindung legt das Dokument ab

### Requirement: Sichtbarer Entfernen-Zustand

Nach dem Bestätigen von „Entfernen“ SHALL die betroffene Zeile bis zur Antwort des Servers
stehen bleiben und als „wird entfernt“ gekennzeichnet sein; ihr Entfernen-Auslöser MUST den
Ladezustand zeigen und keine zweite Löschung auslösen. Das MUST in Tabelle und Kartenansicht
gelten und spätestens 100 ms nach dem Bestätigen sichtbar sein. Die Zeile MUST NOT vor der
Bestätigung durch den Server ausgeblendet werden.

#### Scenario: Entfernen läuft
- **WHEN** eine Person das Entfernen von „Lageplan Nord“ bestätigt und der Server noch nicht geantwortet hat
- **THEN** steht die Zeile „Lageplan Nord“ noch in der Liste, trägt „wird entfernt“, und ihr Entfernen-Knopf zeigt den Ladezustand

#### Scenario: Entfernen gelingt
- **WHEN** der Server das Entfernen bestätigt
- **THEN** verschwindet die Zeile, und „Dokument entfernt“ erscheint

#### Scenario: Entfernen scheitert
- **WHEN** der Server das Entfernen ablehnt oder die Verbindung fehlt
- **THEN** verliert die Zeile die Kennzeichnung, bleibt stehen, und der Fehler steht im Hinweis-Slot der Seite

#### Scenario: Andere Zeilen bleiben bedienbar
- **WHEN** das Entfernen einer Zeile läuft
- **THEN** tragen die übrigen Zeilen keine Kennzeichnung und ihre Auslöser keinen Ladezustand
