## Purpose

Der Stabsmonitor zeigt im Stabsraum dauerhaft und ohne Bedienung, wer welches Sachgebiet führt, was
dort offen ist und wann die nächste Lagebesprechung ansteht. Er ist der Großbildschirm des Stabs,
ein Gegenstück zum Lagemonitor, und läuft als Funktionsansicht `stabsmonitor` auf einem
gekoppelten Gerät.

## ADDED Requirements

### Requirement: Ansicht Stabsmonitor
Die Funktionsansicht `stabsmonitor` SHALL an keine Stelle gebunden sein, die Einsatzrolle
Beobachter tragen und nur den Einsatzkopf, die Modulfreigaben, den Live-Kanal und das verdichtete
Lagebild des Stabs `GET /api/einsaetze/{id}/stabsmonitor` lesen dürfen. Er MUST NOT schreiben
dürfen, in keinem Modul. Jede andere Route MUST 403 sein. Der Endpunkt des Stabsmonitors MUST jeder
Sitzung, die kein Stabsmonitor ist, mit 403 antworten. Eine Kopplung mit Stelle MUST 400 sein.
Ist der Stab im Einsatz ausgeblendet oder für Mitglieder gesperrt, MUST der Endpunkt 403 sein, und
der Monitor zeigt bildschirmfüllend „Stab in diesem Einsatz nicht freigegeben“.

#### Scenario: Stabsmonitor schreibt nichts
- **WHEN** ein Stabsmonitor irgendeine schreibende Anfrage an eine Einsatzroute schickt
- **THEN** antwortet der Server mit 403

#### Scenario: Person ruft den Endpunkt
- **WHEN** eine angemeldete Einsatzleitung `GET …/stabsmonitor` aufruft
- **THEN** antwortet der Server mit 403

#### Scenario: Ungebundene Ansicht mit Stelle
- **WHEN** die Einsatzleitung einen Stabsmonitor mit einem Sachgebiet koppeln will
- **THEN** antwortet der Server mit 400

### Requirement: Kachelung S1 bis S6 ohne Bedienung
Der Stabsmonitor SHALL ohne Bildlauf bei 1920 × 1080 zeigen:
- sechs Kacheln S1 bis S6 in fester Reihenfolge
- eine Kopfzeile mit Einsatz, Uhrzeit und dem Termin der nächsten Lagebesprechung
- eine Statusleiste mit Datenstand

Jede Kachel SHALL tragen:
- Kennung und wirksames Label des Sachgebiets
- die Besetzung: nicht vergeben, bei der Einsatzleitung, Funktionsträger mit Namen, extern oder
  rückwärtig
- die Zustandszahlen der Werkzeuge des Sachgebiets, die der Server zählt, je mit Wort

Die Kacheln MUST NOT auf Klick, Tippen oder Ziehen reagieren. Eine Kachel MUST ihren Inhalt nie
abschneiden.

#### Scenario: Kein Bildlauf
- **WHEN** der Stabsmonitor auf einem Bildschirm mit 1920 × 1080 läuft
- **THEN** sind alle sechs Kacheln, Kopfzeile und Statusleiste ohne Bildlauf sichtbar

#### Scenario: Besetzung
- **WHEN** S2 mit „M. Muster“ besetzt ist und S5 nicht vergeben
- **THEN** zeigt die Kachel S2 „M. Muster“ und die Kachel S5 „nicht vergeben“

### Requirement: Zahlen je Sachgebiet vom Server
Der Server SHALL die Zahlen jeder Kachel verdichtet liefern, mit derselben Bedeutung wie die
Modulzähler und die Kennzahlen ihrer Heimat:
- S1: offene Nachforderungen samt unterwegs, Einheiten im Einsatz
- S2: ETB-Einträge, neue Lagemeldungen
- S3: offene Aufträge samt überfälligen, offene Meldungen, Einsatzabschnitte
- S4: offene Nachforderungen samt unterwegs
- S5: offene Presseanfragen, offene Rückrufe des Informationstelefons
- S6: keine Zahl

Eine Zahl eines Moduls, das im Einsatz ausgeblendet ist, MUST fehlen. Sie MUST NOT als „0“
erscheinen. Überfällige Aufträge MUST als Achtung mit Wort stehen.

#### Scenario: Gleiche Zahl wie das Modulmenü
- **WHEN** das Modulmenü einer Einsatzleitung bei Aufträgen „5, davon 1 überfällig“ zeigt
- **THEN** zeigt die Kachel S3 des Stabsmonitors zur selben Zeit „5“ als Achtung mit „1 überfällig“

#### Scenario: Ausgeblendetes Modul
- **WHEN** der Einsatz die Lagemeldungen ausblendet
- **THEN** fehlt die Zahl der Lagemeldungen in der Kachel S2

### Requirement: Nur Namen der Funktionsträger
Der Stabsmonitor SHALL Namen nur für die Besetzung der Sachgebiete zeigen. Der Endpunkt MUST NOT
diese Daten liefern:
- Namen oder Kennungen von Betroffenen, Anrufern, Medienkontakten oder Ansprechpersonen
- Freitexte aus Presse-Log, Informationstelefon, Meldungen, Aufträgen oder Lagebesprechungen
- Rufnummern

#### Scenario: Antwort ohne Personenbezug
- **WHEN** im Einsatz ein Anruf mit Name und Rückrufnummer und ein Medienkontakt mit Ansprechperson
  erfasst sind
- **THEN** enthält die Antwort des Stabsmonitors weder Name noch Rückrufnummer noch Ansprechperson,
  nur die Zahlen

### Requirement: Nächste Lagebesprechung im Kopf
Die Kopfzeile SHALL den Termin der nächsten Lagebesprechung zeigen, sobald einer gesetzt ist, sonst
„keine Lagebesprechung angesetzt“. Ist der Termin erreicht oder verstrichen, MUST sie ihn mit Ton
und Wort der Fähigkeit `lagebesprechung-vorbereitung` zeigen.

#### Scenario: Überfälliger Termin
- **WHEN** der Termin seit 12 Minuten verstrichen ist
- **THEN** zeigt die Kopfzeile „seit 12 min überfällig“ im Ton `achtung`

### Requirement: Großbild, Aktualisierung und Gerät wie beim Lagemonitor
Für den Stabsmonitor SHALL dasselbe gelten wie für den Lagemonitor (Fähigkeit `lagemonitor`):
- Kennzahlen mindestens 72 px und jeder Text mindestens 28 px bei 1920 × 1080
- „Anzeige starten“ mit Vollbild und wach gehaltenem Bildschirm
- Aktualisierung über den Live-Kanal mit regelmäßigem Nachladen, der Stand ab 2 Minuten als
  veraltet hervorgehoben
- das Gerätemenü erst nach 3 Sekunden Drücken auf die Statusleiste
- „Kopplung beendet“ bei 401
- eine gestiegene Zahl 60 Sekunden lang hervorgehoben, ohne Ton und ohne Blinken

#### Scenario: Neuer Termin auf dem Monitor
- **WHEN** auf der Seite Lagebesprechung ein neuer Termin gesetzt wird
- **THEN** zeigt der Stabsmonitor ihn ohne Neuladen

#### Scenario: Monitor widerrufen
- **WHEN** die Einsatzleitung den Stabsmonitor widerruft
- **THEN** zeigt der Monitor „Kopplung beendet“ ohne Lagebild
