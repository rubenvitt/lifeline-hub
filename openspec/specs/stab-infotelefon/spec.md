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
Die Protokollseite SHALL die Anrufe als zeitlich geordnete Liste zeigen, die jüngsten oben.
Sortierung und Spaltenfilter gibt es nicht. Eine Segmentleiste MUST zwischen „alle“ und „offene
Rückrufe“ umschalten. Über dem Protokoll steht:
- die Zahl der Anrufe gesamt als Kennzahl
- die Zahl offener Rückrufe als Kennzahl
- eine Aufgliederung nach Anliegen

Alle drei MUST aus derselben geladenen Menge gerechnet sein. Ist die Menge nicht geladen, steht
keine Zahl da. Ein offener Rückruf SHALL sich erledigen und wieder öffnen lassen. Eine Zeile MUST
per `?anruf=<id>` ansteuerbar sein.

#### Scenario: Offene Rückrufe
- **WHEN** die Person „offene Rückrufe“ wählt
- **THEN** zeigt die Liste nur Anrufe im Status `offen`, und die Kennzahl stimmt mit der
  Zeilenzahl überein

#### Scenario: Rückruf erledigt
- **WHEN** ein offener Rückruf als erledigt markiert wird
- **THEN** steht der Anruf auf `erledigt` mit Person und Zeitpunkt, und die Zahl offener Rückrufe
  sinkt um eins

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
