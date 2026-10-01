# dokumentenablage Specification

## Purpose
Legt fest, wie die Dokumentenablage eines Einsatzes in der Oberfläche auf Ablegen und Entfernen
antwortet und wie sie sich ohne Verbindung verhält, damit niemand über den Stand einer langen
Übertragung oder einer Löschung im Unklaren bleibt.

## Requirements

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
