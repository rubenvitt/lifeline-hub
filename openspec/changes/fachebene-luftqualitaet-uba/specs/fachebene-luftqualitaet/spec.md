# Spec Delta

## Purpose

Zeigt die Luftmessstationen des Umweltbundesamts mit ihrem aktuellen Luftqualitätsindex als
Punkt-Fachebene der Lagekarte, damit die Schadstoffbelastung der Umgebungsluft bei Brand-,
Gefahrstoff- und Industrielagen Teil des Lagebilds ist.

## ADDED Requirements

### Requirement: Fachebene Luftqualität am Aggregator

Das System SHALL unter `GET /api/karte/fachebenen/luftqualitaet` eine Fachebenen-Antwort im
bestehenden Umschlag `{ quelle, status, attribution, stand, features }` liefern, mit
`quelle = "luftqualitaet"` und einer GeoJSON-`FeatureCollection` aus Punkten. Die Ebene MUST
ohne `bbox`-Parameter auskommen.

#### Scenario: Abruf der Ebene

- **WHEN** ein angemeldeter Nutzer `GET /api/karte/fachebenen/luftqualitaet` aufruft
- **THEN** antwortet das System mit HTTP 200 und `quelle = "luftqualitaet"`
- **AND** `features` ist eine `FeatureCollection`, deren Features Punktgeometrien tragen

#### Scenario: Kein bbox-Zwang

- **WHEN** die Ebene ohne `bbox`-Parameter abgerufen wird
- **THEN** antwortet das System nicht mit HTTP 400

### Requirement: Nur Stationen mit aktuellem Index

Das System SHALL genau die Stationen als Features liefern, für die die Quelle im
Abfragefenster (die letzten acht Stunden) einen Luftqualitätsindex meldet. Stationen, die
nur in der Stationsliste stehen, MUST NOT gezeichnet werden. Eine Station ohne auflösbare
Koordinaten MUST verworfen werden, ohne die übrigen Stationen zu beeinträchtigen.

#### Scenario: Stationsliste ohne Indexeintrag

- **WHEN** die Stationsliste eine Station führt, für die im Abfragefenster kein Index vorliegt
- **THEN** enthält die Antwort für diese Station kein Feature

#### Scenario: Station ohne Koordinaten

- **WHEN** für eine Station mit Index keine gültigen Koordinaten auflösbar sind
- **THEN** fehlt nur dieses Feature, alle übrigen Stationen werden geliefert

#### Scenario: Mehrere Stunden im Fenster

- **WHEN** die Quelle für eine Station mehrere Stunden im Abfragefenster meldet
- **THEN** trägt das Feature ausschließlich den jüngsten Stundenwert dieser Station

### Requirement: Indexstufe und Leitschadstoff je Station

Jedes Feature SHALL die Indexstufe als Wire-Wort in der Property `klasse` tragen, und zwar
genau eines von `sehr_gut`, `gut`, `maessig`, `schlecht`, `sehr_schlecht`, `keine_daten`
(Quellwerte 0 bis 4 in dieser Reihenfolge; fehlend oder außerhalb 0–4 → `keine_daten`).
Es SHALL den Leitschadstoff (Komponente mit der höchsten Teil-Indexstufe) als lesbares
Kürzel, die vorhandenen Einzelmesswerte der Komponenten als flache Zahlen-Properties mit
Einheit, den Stationsnamen, den Stationscode sowie einen Hinweis tragen, ob die Quelle den
Index als auf unvollständigen Daten beruhend kennzeichnet.

#### Scenario: Index in Wire-Wort übersetzt

- **WHEN** die Quelle für eine Station den Gesamtindex 2 meldet
- **THEN** trägt das Feature `klasse = "maessig"`

#### Scenario: Unbekannter Indexwert

- **WHEN** die Quelle keinen oder einen Gesamtindex außerhalb 0–4 meldet
- **THEN** trägt das Feature `klasse = "keine_daten"` und wird trotzdem geliefert

#### Scenario: Leitschadstoff

- **WHEN** Ozon die höchste Teil-Indexstufe der Station hat
- **THEN** nennt das Feature Ozon als Leitschadstoff

#### Scenario: Unvollständige Datenbasis

- **WHEN** die Quelle den Stundenwert einer Station als unvollständig kennzeichnet
- **THEN** trägt das Feature diese Kennzeichnung, und die Oberfläche zeigt sie als Wort an

### Requirement: Zeitstempel mit Zonenangabe

Die Quelle liefert Zeitpunkte in MEZ **ohne Sommerzeit** (UTC+1 ganzjährig) und ohne
Zonenangabe. Das System SHALL jeden Messzeitpunkt als Zeitpunkt mit Zonenangabe ausgeben, der
denselben absoluten Moment bezeichnet, und `stand` des Umschlags auf den jüngsten
Messzeitpunkt aller gelieferten Stationen setzen. Der Messzeitpunkt einer Station ist das
**Ende** ihrer Messstunde.

#### Scenario: Sommerzeit verschiebt nichts

- **WHEN** die Quelle im Sommer die Messstunde „2026-09-21 08:00:00" (Beginn, MEZ) meldet
- **THEN** bezeichnet der ausgegebene Messzeitpunkt 2026-09-21 08:00 UTC (Stundenende 09:00 MEZ)

#### Scenario: stand ist der jüngste Messzeitpunkt

- **WHEN** die jüngste gelieferte Station ihren Wert für die Stunde endend 09:00 MEZ hat
- **THEN** bezeichnet `stand` denselben Zeitpunkt

### Requirement: Status und Offline-Verhalten

Das System SHALL dieselbe Status-Semantik wie die übrigen Fachebenen einhalten: `ok` mit
Stationen, `leer`, wenn die Quelle erreichbar ist, aber keine Station einen Index liefert,
und `offline` mit leerer Collection, wenn die Quelle nicht erreichbar oder ihre Antwort
unbrauchbar ist und kein Cache-Stand vorliegt. Die Route MUST dabei mit HTTP 200 antworten,
nie mit einem 5xx. Ein vorhandener Cache-Stand MUST ausgeliefert werden, solange keine
frische Antwort vorliegt (Stale-while-revalidate), und ein frischer Cache-Stand MUST ohne
Abruf der Quelle ausgeliefert werden; frisch ist ein Stand für 15 Minuten.

#### Scenario: Quelle nicht erreichbar, kein Cache

- **WHEN** die Quelle nicht antwortet und kein Cache-Stand existiert
- **THEN** antwortet das System mit HTTP 200, `status = "offline"` und einer leeren Collection

#### Scenario: Nur einer von zwei Abrufen scheitert

- **WHEN** die Stationsliste oder der Indexabruf fehlschlägt
- **THEN** gilt der gesamte Lauf als fehlgeschlagen und wird nicht als `leer` gecacht

#### Scenario: Quelle ohne Werte

- **WHEN** beide Abrufe gelingen, aber keine Station einen Index trägt
- **THEN** ist `status = "leer"`

#### Scenario: Gecachter Stand

- **WHEN** ein Cache-Stand jünger als 15 Minuten vorliegt
- **THEN** liefert das System ihn aus, ohne die Quelle abzurufen

### Requirement: Attribution

Das System SHALL in jeder Antwort der Ebene — auch bei `offline` — eine Attribution liefern,
die das Umweltbundesamt als Quelle nennt. Die Lagekarte MUST sie wie bei den übrigen
Fachebenen in der Karten-Attribution anzeigen, solange die Ebene sichtbar und nicht offline
ist.

#### Scenario: Attribution auch offline

- **WHEN** die Ebene mit `status = "offline"` antwortet
- **THEN** nennt `attribution` das Umweltbundesamt

### Requirement: Darstellung auf der Lagekarte

Die Lagekarte SHALL die Ebene als eigenen, einzeln schaltbaren Eintrag „Luftqualität (UBA)"
im Fachebenen-Panel führen. Jede Station MUST über zwei Kanäle nach Indexstufe
unterscheidbar sein: eine Statusrolle aus dem zentralen Farbvertrag (`sehr_gut`/`gut` →
normal, `maessig` → achtung, `schlecht`/`sehr_schlecht` → alarm, `keine_daten` → neutral)
**und** einen mit der Stufe wachsenden Punktdurchmesser. Die Farben MUST im Hell- und
Dunkelmodus aus dem jeweiligen Modus aufgelöst werden. Ein Klick auf eine Station SHALL im
Fachebenen-Inspector die Indexstufe als Wort, den Leitschadstoff, die Einzelmesswerte mit
Einheit, den Messzeitpunkt und gegebenenfalls den Hinweis auf eine unvollständige
Datenbasis zeigen.

#### Scenario: Zwei Kanäle

- **WHEN** eine Station `klasse = "sehr_gut"` und eine andere `klasse = "gut"` trägt
- **THEN** haben beide dieselbe Rolle, aber verschiedene Punktdurchmesser, und der Inspector
  nennt verschiedene Wörter

#### Scenario: Inspector

- **WHEN** der Nutzer eine Station mit `klasse = "schlecht"` anklickt
- **THEN** zeigt der Inspector „schlecht" als Wort, den Leitschadstoff und den Messzeitpunkt

#### Scenario: Unbekanntes Wire-Wort

- **WHEN** ein Feature ein unbekanntes `klasse`-Wort trägt
- **THEN** stellt die Oberfläche es als „keine Daten" dar, nie als Rohwert

### Requirement: Persistenz und Wiederherstellung

Die Sichtbarkeit der Ebene SHALL wie die der übrigen Fachebenen in Kartenansichten
gespeichert und beim Laden wiederhergestellt werden. Ein vor dieser Änderung gespeicherter
Stand ohne den Schlüssel MUST als „aus" gelesen werden. Nach einem Wechsel des Kartenstils
(Basemap/Theme) MUST die sichtbare Ebene samt Daten wieder auf der Karte stehen.

#### Scenario: Alter Ansichts-Stand

- **WHEN** eine Kartenansicht geladen wird, deren gespeicherte Fachebenen-Sichtbarkeit den
  Schlüssel `luftqualitaet` nicht kennt
- **THEN** ist die Ebene aus

#### Scenario: Stilwechsel

- **WHEN** die Ebene sichtbar ist und der Nutzer die Basemap wechselt
- **THEN** stehen die Stationen danach wieder auf der Karte
