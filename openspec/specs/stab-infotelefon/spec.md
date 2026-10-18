# stab-infotelefon Specification

## Purpose

Das Informationstelefon (Bürgertelefon) des Sachgebiets S5 protokolliert Anrufe aus der
Bevölkerung: Anliegen, Notiz und Rückrufbedarf. So bleibt sichtbar, welche Fragen die Bevölkerung
bewegen und welche Rückrufe noch offen sind.

## Requirements

### Requirement: Anruf erfassen
Das System SHALL je Einsatz Anrufe am Informationstelefon führen. Ein Anruf MUST diese Angaben
tragen:
- **Anliegen:** eines von `vermisstensuche`, `auskunft_lage`, `hinweis`, `hilfeangebot`,
  `beschwerde`, `presse`, `sonstiges`
- **Eingang:** Fehlt er, gilt der Zeitpunkt der Erfassung.

Optional sind Notiz, Name der anrufenden Person und Rückrufnummer. Ein Anruf mit „Rückruf nötig“
MUST im Status `offen` beginnen, jeder andere im Status `erledigt`. „Rückruf nötig“ ohne
Rückrufnummer MUST mit 422 abgelehnt werden. Ein unbekanntes Anliegen MUST mit 400 abgelehnt
werden.

#### Scenario: Auskunft ohne Rückruf
- **WHEN** ein Anruf mit Anliegen „Auskunft zur Lage“ und der Notiz „Frage nach Sperrung B 3“
  ohne Rückruf erfasst wird
- **THEN** steht der Anruf mit Eingang = jetzt und Status `erledigt` im Protokoll

#### Scenario: Rückruf ohne Nummer
- **WHEN** ein Anruf mit „Rückruf nötig“, aber ohne Rückrufnummer erfasst wird
- **THEN** antwortet das System mit 422 und legt nichts an

#### Scenario: Unbekanntes Anliegen
- **WHEN** ein Anruf mit dem Anliegen `spende` erfasst wird
- **THEN** antwortet das System mit 400

### Requirement: Schnellerfassung für Serienbetrieb
Die Erfassung SHALL als Schnellerfassung am Fuß der Protokollseite stehen. Sichtbar sind Anliegen,
Notiz und „Rückruf nötig“. Name, Rückrufnummer und Uhrzeit liegen eingeklappt. Wird „Rückruf
nötig“ gewählt, MUST die Rückrufnummer sichtbar werden. Das Pflichtfeld darf nicht hinter der
Einklappung liegen.

Enter speichert. Nach dem Speichern steht der Fokus wieder im ersten Feld, und die Felder sind
geleert. Die Vorgabe von „Werte behalten“ ist aus.

#### Scenario: Serie
- **WHEN** eine Person drei Anrufe nacheinander mit Enter speichert
- **THEN** stehen drei Anrufe im Protokoll, und der Fokus steht nach jedem Speichern im Feld
  Anliegen

#### Scenario: Rückrufnummer wird Pflicht
- **WHEN** die Person „Rückruf nötig“ anhakt
- **THEN** ist das Feld Rückrufnummer sichtbar und als Pflicht gekennzeichnet, auch wenn der
  eingeklappte Teil zu ist

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

### Requirement: Sprung zu den Vermissten
Ein Anruf mit Anliegen `vermisstensuche` SHALL einen Sprung „Vermisste ↗“ auf die Personenliste mit
dem Filter vermisst tragen. Das gilt nur, wenn das Modul Personen für die Person freigegeben ist.
Das System MUST NOT Anrufe mit Betroffenen abgleichen oder automatisch verknüpfen.

#### Scenario: Personen gesperrt
- **WHEN** das Modul Personen für die Person gesperrt ist
- **THEN** fehlt der Sprung, und der Anruf bleibt sonst unverändert lesbar

### Requirement: Rechte, Lebenszyklus, Live
Lesen SHALL jedes Einsatzmitglied mit Leserecht auf den Stab. Erfassen und Statuswechsel MUST
Schreibrecht und die Freigabe des Stab-Moduls verlangen. Am abgeschlossenen Einsatz ist das
Protokoll schreibgeschützt. Ein Anruf eines anderen Einsatzes MUST mit 404 beantwortet werden.
Anrufe MUST NOT gelöscht werden können. Neue Anrufe anderer Arbeitsplätze SHALL live erscheinen,
ohne dass die Liste unter dem Cursor springt.

#### Scenario: Zwei Telefonplätze
- **WHEN** zwei Personen gleichzeitig Anrufe erfassen
- **THEN** sieht jede die Anrufe der anderen ohne Neuladen, und die Kennzahlen stimmen an beiden
  Plätzen überein

### Requirement: Datenschutz der Anrufdaten
Name, Rückrufnummer und Notiz eines Anrufs MUST als personenbezogen gelten und bei der Schwärzung
entfernt werden. Anliegen, Status und Zeiten bleiben erhalten. Anrufe MUST NOT im Offline-Lagebild
gespeichert werden.

#### Scenario: Schwärzung
- **WHEN** ein Einsatz mit Anrufen geschwärzt wird
- **THEN** sind Name, Rückrufnummer und Notiz leer, und die Zahl der Anrufe je Anliegen ist
  unverändert
