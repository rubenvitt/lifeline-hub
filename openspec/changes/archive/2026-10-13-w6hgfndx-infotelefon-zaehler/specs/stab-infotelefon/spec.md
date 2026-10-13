# Spec Delta

## ADDED Requirements

### Requirement: Zählung der Anrufe
Das System SHALL unter `GET /api/einsaetze/{id}/stab/infotelefon/zaehler` die Anrufe des
Einsatzes zählen. Die Antwort trägt `gesamt`, `offen` (Anrufe im Status `offen`) und
`je_anliegen` mit einem Wert für **jedes** der sieben Anliegen. Ein Anliegen ohne Anruf MUST als
0 erscheinen und DARF NICHT fehlen. Die Summe über `je_anliegen` MUST `gesamt` ergeben. Die
Zählung hat dasselbe Gate wie die Liste.

#### Scenario: Ungefilterte Zählung
- **WHEN** ein Einsatz 3 Anrufe „Auskunft zur Lage“, davon 1 offen, und 1 Anruf „Hinweis“ hat
- **THEN** antwortet die Zählung mit `gesamt: 4`, `offen: 1`, `je_anliegen.auskunft_lage: 3`,
  `je_anliegen.hinweis: 1` und 0 für die übrigen fünf Anliegen

#### Scenario: Mehr Anrufe als eine Seite
- **WHEN** ein Einsatz 2 000 Anrufe hat
- **THEN** ist `gesamt` 2 000, nicht die Seitengröße der Liste

#### Scenario: Andere Einsätze zählen nicht mit
- **WHEN** ein anderer Einsatz Anrufe hat
- **THEN** sind diese in der Zählung dieses Einsatzes nicht enthalten

#### Scenario: Stab gesperrt
- **WHEN** eine Person ohne Freigabe des Stab-Moduls die Zählung abruft
- **THEN** antwortet das System wie bei der Liste mit 403

### Requirement: Die Zählung folgt dem Filter der Liste
Der Zähl-Endpunkt SHALL denselben Filterparameter annehmen wie die Liste: `status` mit `offen`
oder `erledigt`. Er MUST genau die Anrufe zählen, die die Liste mit demselben Filter über alle
Seiten liefert. Die Seitenparameter `vor_zeit`, `vor_id` und `limit` gehören nicht zum Filter;
der Zähl-Endpunkt MUST sie ignorieren. Ein unbekannter Status MUST bei Liste und Zählung mit 400
abgelehnt werden.

#### Scenario: Liste und Zählung stimmen überein
- **WHEN** für jeden Filter (ohne, `offen`, `erledigt`) die Liste seitenweise vollständig
  geladen wird
- **THEN** ist die Zahl der geladenen Anrufe gleich `gesamt` der Zählung mit demselben Filter

#### Scenario: Nur offene
- **WHEN** `status=offen` gesetzt ist und 2 von 5 Anrufen offen sind
- **THEN** ist `gesamt: 2` und `offen: 2`, und `je_anliegen` verteilt genau diese 2 Anrufe

#### Scenario: Unbekannter Status
- **WHEN** `status=unsinn` gesetzt ist
- **THEN** antworten Liste und Zählung mit 400

### Requirement: Das Protokoll wird seitenweise geladen
`GET /api/einsaetze/{id}/stab/infotelefon` SHALL je Aufruf eine Seite liefern, jüngster Eingang
zuerst, bei gleichem Eingang die höhere Kennung zuerst. `limit` begrenzt die Seite (Vorgabe 100,
größere Werte werden auf die Obergrenze geklemmt). `vor_zeit` und `vor_id` (Eingang und Kennung
des letzten gelesenen Anrufs) liefern die Seite dahinter. Nur einer der beiden Cursorwerte MUST
mit 422 abgelehnt werden.

#### Scenario: Blättern ohne Lücke
- **WHEN** 250 Anrufe mit teils gleichem Eingang seitenweise mit `limit=100` geladen werden
- **THEN** liefern drei Seiten jeden Anruf genau einmal in der Ordnung der Liste

#### Scenario: Halber Cursor
- **WHEN** `vor_zeit` ohne `vor_id` übergeben wird
- **THEN** antwortet das System mit 422

#### Scenario: Ältere laden
- **WHEN** die Protokollseite mehr Anrufe hat als eine Seite
- **THEN** zeigt sie die jüngsten Anrufe und am Ende „Ältere laden“, das die nächste Seite
  anhängt

### Requirement: Einzelner Anruf
Das System SHALL unter `GET /api/einsaetze/{id}/stab/infotelefon/{aid}` einen Anruf einzeln
liefern, mit demselben Gate wie die Liste. Ein Anruf eines anderen Einsatzes MUST mit 404
beantwortet werden. Die Protokollseite MUST einen per `?anruf=<id>` angesteuerten Anruf auch
dann zeigen, wenn er in keiner geladenen Seite steht.

#### Scenario: Deeplink auf einen alten Anruf
- **WHEN** die Seite mit `?anruf=<id>` eines Anrufs geöffnet wird, der hinter der ersten Seite
  liegt
- **THEN** steht der Anruf hervorgehoben im Protokoll

#### Scenario: Fremder Anruf
- **WHEN** ein Anruf eines anderen Einsatzes abgerufen wird
- **THEN** antwortet das System mit 404

## MODIFIED Requirements

### Requirement: Protokoll, offene Rückrufe und Kennzahlen
Die Protokollseite SHALL die Anrufe als zeitlich geordnete Liste zeigen, die jüngsten oben.
Sortierung und Spaltenfilter gibt es nicht. Eine Segmentleiste MUST zwischen „alle“ und „offene
Rückrufe“ umschalten; „offene Rückrufe“ lädt die Liste mit dem Filter `status=offen`. Über dem
Protokoll steht:
- die Zahl der Anrufe gesamt als Kennzahl
- die Zahl offener Rückrufe als Kennzahl
- eine Aufgliederung nach Anliegen

Alle drei MUST aus der Zählung am Server stammen, nicht aus den geladenen Seiten. Ist die
Zählung nicht geladen, steht keine Zahl da, auch nicht die Zahl der geladenen Anrufe. Ein
offener Rückruf SHALL sich erledigen und wieder öffnen lassen. Eine Zeile MUST per `?anruf=<id>`
ansteuerbar sein.

#### Scenario: Offene Rückrufe
- **WHEN** die Person „offene Rückrufe“ wählt und alle Seiten geladen hat
- **THEN** zeigt die Liste nur Anrufe im Status `offen`, und die Kennzahl stimmt mit der
  Zeilenzahl überein

#### Scenario: Rückruf erledigt
- **WHEN** ein offener Rückruf als erledigt markiert wird
- **THEN** steht der Anruf auf `erledigt` mit Person und Zeitpunkt, und die Zahl offener Rückrufe
  sinkt um eins

#### Scenario: Kennzahlen über den ganzen Bestand
- **WHEN** ein Einsatz 2 000 Anrufe hat und die Seite nur die erste Seite geladen hat
- **THEN** zeigt die Kennzahl „Anrufe“ 2 000, und die Aufgliederung nach Anliegen summiert sich
  auf 2 000

#### Scenario: Zählung nicht geladen
- **WHEN** die Liste geladen ist, die Zählung aber scheitert
- **THEN** zeigen die Kennzahlen keinen Wert, sondern den Fehlerzustand, und die Aufgliederung
  fehlt
