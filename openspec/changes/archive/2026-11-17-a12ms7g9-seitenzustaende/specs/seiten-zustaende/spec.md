# Spec Delta

## Purpose

Wie sich eine Seite verhält, wenn sie nicht gezeigt werden kann: Ein Fehler beim Zeichnen nimmt
nur die Seite weg und nie den Rahmen, er wird dem Betreiber gemeldet, und ein Objekt, das es
nicht (mehr) gibt, sieht auf jeder Seite und bei jedem Deeplink gleich aus.

## ADDED Requirements

### Requirement: Fehlergrenze je Rahmen

Wirft eine Seite beim Zeichnen oder beim Laden ihres Codes, MUST nur die Seite ersetzt werden,
nicht ihr Rahmen (Einsatzrahmen, Rahmen der Ebene 1, Verwaltung, Gerätehülle). An ihrer Stelle
MUST „Diese Seite konnte nicht angezeigt werden“ stehen, mit genau zwei Auswegen: „Neu laden“
und einem sicheren Ort des Rahmens. Fehlermeldung, Stacktrace und englischer Text MUST NOT
erscheinen. Eine andere Adresse MUST wieder ihre normale Seite zeigen.

#### Scenario: Sicherer Ort je Rahmen
- **WHEN** eine Seite im Einsatz, in Ebene 1 oder Verwaltung, oder in der Gerätehülle abstürzt
- **THEN** heißt der zweite Ausweg „Zum Überblick“, „Zur Einsatzliste“ bzw. „Zur Startseite“

#### Scenario: Ein Modul stürzt ab
- **WHEN** eine Seite im Einsatz beim Zeichnen wirft
- **THEN** stehen Kopf, Rail und Modulleiste weiter da und sind bedienbar
- **AND** an der Stelle der Seite steht „Diese Seite konnte nicht angezeigt werden“ mit „Neu
  laden“ und „Zum Überblick“
- **AND** weder die Fehlermeldung noch ein Stacktrace noch englischer Text ist zu sehen

#### Scenario: Anderes Modul nach dem Absturz
- **WHEN** nach einem Absturz ein anderes Modul über die Rail gewählt wird
- **THEN** zeigt dieses Modul seine normale Seite

#### Scenario: Überblick gesperrt
- **WHEN** eine Seite im Einsatz abstürzt und der Überblick für die Person gesperrt ist
- **THEN** führt „Zum Überblick“ in das erste freie Modul

#### Scenario: Absturz in der Verwaltung
- **WHEN** eine Seite der Verwaltung beim Zeichnen wirft
- **THEN** bleibt das Verwaltungsmenü bedienbar, und der zweite Ausweg heißt „Zur Einsatzliste“

### Requirement: Letztes Netz an der Wurzel

Wirft ein Rahmen selbst, MUST die Anwendung eine ganze Seite in deutscher Sprache zeigen, mit
demselben Titel und den Auswegen „Neu laden“ und „Zur Einsatzliste“. Die Standardseite des
Routers MUST in keinem Fall erscheinen.

#### Scenario: Ein Rahmen wirft
- **WHEN** der Einsatzrahmen selbst beim Zeichnen wirft
- **THEN** steht eine deutsche Fehlerseite mit „Neu laden“ und „Zur Einsatzliste“ da
- **AND** der Text „Unexpected Application Error“ erscheint nicht

### Requirement: Absturz wird dem Server gemeldet

Jeder gefangene Fehler MUST einmal an den Server gehen, mit Routenmuster ohne Kennungen,
Version, gekürzter Meldung und gekürztem Stack, ohne Daten aus Datensatz oder Seite. Der Server
MUST nur von einer Sitzung annehmen, MUST zu große Berichte ablehnen und MUST angenommene
Berichte gedrosselt als Warnung ins Log schreiben, ohne sie zu speichern. Ein Bericht, der den
Server nicht erreicht, MUST still verworfen werden.

#### Scenario: Bericht nach einem Absturz
- **WHEN** eine Seite unter `/einsaetze/7/personen/42` abstürzt
- **THEN** geht genau ein Bericht an den Server
- **AND** er nennt das Routenmuster `/einsaetze/:id/personen/:personId`, nicht die Kennungen 7
  und 42

#### Scenario: Ohne Sitzung
- **WHEN** ein Bericht ohne gültige Sitzung eingeht
- **THEN** lehnt der Server ihn mit 401 ab und schreibt nichts ins Log

#### Scenario: Zu großer Bericht
- **WHEN** ein Bericht die Größengrenze überschreitet
- **THEN** lehnt der Server ihn ab, ohne ihn zu lesen

#### Scenario: Viele Berichte
- **WHEN** innerhalb einer Minute viele Berichte eingehen
- **THEN** steht im Log höchstens eine Zeile je Minute, mit der Zahl der Berichte seit der
  letzten Zeile

#### Scenario: Ohne Netz
- **WHEN** eine Seite abstürzt, während die Anwendung offline ist
- **THEN** zeigt die Fehlergrenze dasselbe Bild, und es erscheint kein weiterer Hinweis

### Requirement: Ein Muster für ein Objekt, das es nicht gibt

Zeigt eine Detailseite im Einsatzrahmen ein Objekt, das es nicht (mehr) gibt (404 oder
ungültige Kennung), MUST sie im Rahmen bleiben und „<Sache> gibt es nicht (mehr)“ mit genau einem
Knopf zur Liste des Moduls zeigen, ohne „Erneut abrufen“ und ohne Servermeldung. Ein anderer
Abruffehler MUST „Erneut abrufen“ behalten. Der Rahmen MUST die Adresse nicht als letzten Ort
merken, und eine stille Weiterleitung MUST NOT stattfinden.

#### Scenario: Unbekannte Person
- **WHEN** `/einsaetze/<id>/personen/999999` geöffnet wird
- **THEN** stehen Kopf und Rail des Einsatzes da
- **AND** die Seite zeigt „Diese Person gibt es nicht (mehr)“ und einen Knopf „Zu den
  Betroffenen“
- **AND** es gibt keinen Knopf „Erneut abrufen“ und keine Zeile „Nicht gefunden“

#### Scenario: Unbekannter Befehl
- **WHEN** `/einsaetze/<id>/auftraege/befehle/999999` geöffnet wird
- **THEN** zeigt die Seite „Diesen Befehl gibt es nicht (mehr)“ mit einem Knopf zur Befehlsliste

#### Scenario: Unbekannte Betreuungsstelle
- **WHEN** die Adresse einer Betreuungsstelle geöffnet wird, die es nicht gibt
- **THEN** bleibt die Adresse in der Leiste stehen, und die Seite zeigt das Muster, statt auf
  die Liste umzuleiten

#### Scenario: Serverfehler beim Abruf
- **WHEN** der Abruf einer Detailseite mit 500 scheitert
- **THEN** zeigt die Seite den Abruffehler mit „Erneut abrufen“, nicht das Muster

#### Scenario: Profil-Rückweg
- **WHEN** nach einer solchen Seite das Profil geöffnet und über „Zurück“ verlassen wird
- **THEN** führt der Rückweg nicht auf die Adresse des fehlenden Objekts

### Requirement: Deeplink auf ein Objekt, das es nicht gibt

Zeigt ein Parameter-Deeplink einer Listenseite (`?meldung=`, `?auftrag=`, `?fahrzeug=` …) auf
ein Objekt, das es nicht (mehr) gibt, MUST über der Liste eine schließbare Hinweisleiste
erscheinen, auf allen solchen Listenseiten in derselben Form und nie als Toast. Sie MUST
verschwinden, sobald ein Objekt gewählt wird oder ein neuer Deeplink wirkt. Der Parameter MUST
wie bei jedem Deeplink aus der Adresse verschwinden.

#### Scenario: Unbekannte Meldung
- **WHEN** die Meldungen mit `?meldung=99999` geöffnet werden und es diese Meldung nicht gibt
- **THEN** steht über der Liste „Meldung #99999 gibt es nicht (mehr)“
- **AND** die Adresse enthält den Parameter nicht mehr

#### Scenario: Liste ohne Detailpaneel
- **WHEN** die Fahrzeuge mit `?fahrzeug=99999` geöffnet werden und es dieses Fahrzeug im Einsatz
  nicht gibt
- **THEN** steht über der Liste dieselbe Hinweisleiste

#### Scenario: Hinweis schließen
- **WHEN** die Hinweisleiste geschlossen oder eine Zeile gewählt wird
- **THEN** ist die Leiste weg
