# Spec Delta

## MODIFIED Requirements

### Requirement: Protokoll, offene Rückrufe und Kennzahlen
Die Protokollseite SHALL die Anrufe als zeitlich geordnete Liste in Funkprotokoll-Ordnung zeigen:
ältester geladener Anruf oben, jüngster unten direkt über der Erfassung; beim Öffnen steht die
Seite am Ende. Sortierung und Spaltenfilter gibt es nicht. Eine Segmentleiste MUST zwischen „alle“
und „offene Rückrufe“ umschalten; „offene Rückrufe“ lädt die Liste mit dem Filter `status=offen`.
Über dem Protokoll steht:
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

#### Scenario: Eigener Anruf erscheint über der Erfassung
- **WHEN** am Seitenende ein Anruf erfasst wird
- **THEN** steht er ohne eigenes Rollen als unterste Zeile direkt über der Erfassung

### Requirement: Das Protokoll wird seitenweise geladen
`GET /api/einsaetze/{id}/stab/infotelefon` SHALL je Aufruf eine Seite liefern, jüngster Eingang
zuerst, bei gleichem Eingang die höhere Kennung zuerst. `limit` begrenzt die Seite (Vorgabe 100,
größere Werte werden auf die Obergrenze geklemmt). `vor_zeit` und `vor_id` (Eingang und Kennung
des letzten gelesenen Anrufs) liefern die Seite dahinter. Nur einer der beiden Cursorwerte MUST
mit 422 abgelehnt werden. Die Protokollseite SHALL die Seiten in ihrer Leserichtung zeigen, also
gespiegelt.

#### Scenario: Blättern ohne Lücke
- **WHEN** 250 Anrufe mit teils gleichem Eingang seitenweise mit `limit=100` geladen werden
- **THEN** liefern drei Seiten jeden Anruf genau einmal in der Ordnung der Liste

#### Scenario: Halber Cursor
- **WHEN** `vor_zeit` ohne `vor_id` übergeben wird
- **THEN** antwortet das System mit 422

#### Scenario: Ältere laden
- **WHEN** die Protokollseite mehr Anrufe hat als eine Seite
- **THEN** zeigt sie die jüngsten Anrufe unten und über ihnen „Ältere laden“, das die nächste
  Seite darüber einfügt, ohne dass die gelesene Zeile springt
