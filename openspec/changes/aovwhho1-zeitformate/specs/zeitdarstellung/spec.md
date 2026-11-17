## MODIFIED Requirements

### Requirement: Eine Formatstelle
Zeitangaben für Menschen SHALL nur der Formatkern in `frontend/src/anzeige/` bilden, Zeitpunkte wie
Dauern. Ein Wächter MUST jede neue Formatierung mit Datums- oder Uhrzeit-Token außerhalb davon
ablehnen; Maschinenformate in ISO-Reihenfolge sind ausgenommen. Ein zweiter Wächter MUST eine neue
Dauer ablehnen, die außerhalb des Kerns aus Minuten oder Stunden zusammengesetzt wird. Der Bestand vom 22.10.2026 ist
abgebaut (LLH-1061); die Schuldmengen beider Wächter MUST leer bleiben. Die Uhr des Lagemonitors und
die Uhr im Großbild nehmen dieselbe Formatierung wie die Uhr im Kopf. Der Datenstand rechnet bewusst
in der Gerätezeit, folgt aber der Darstellung.

#### Scenario: Neue eigene Formatierung
- **WHEN** eine Seite unter `pages/` `dayjs().format('HH:mm')` einführt
- **THEN** ist der Wächter rot

#### Scenario: Neue eigene Dauer
- **WHEN** eine Seite unter `pages/` eine Wartezeit als `${min} min` aus einer Minutenzahl zusammensetzt
- **THEN** ist der Wächter für Dauern rot

## ADDED Requirements

### Requirement: Eine Form für Dauern
Jede Dauer für Menschen SHALL in einer Form erscheinen: unter einer Stunde in Minuten („45 min“),
volle Stunden ohne Minuten („8 h“), sonst Stunden und zweistellige Minuten („5 h 01 min“). Ab 24 h
MUST die Einsatzdauer des Einsatzes und eine relative Angabe Tage und Stunden zeigen („2 d 14 h“);
jede andere Dauer, die gegen Stunden-Grenzwerte steht (Kräfte, Rhythmus), MUST in Stunden
weiterlaufen. Die Form MUST unabhängig von der Zeitdarstellung sein, ohne Doppelpunkt.

#### Scenario: Unter einer Stunde
- **WHEN** eine Wartezeit von 45 Minuten gezeigt wird
- **THEN** steht „45 min“

#### Scenario: Stunden und Minuten
- **WHEN** eine Einsatzdauer von 301 Minuten gezeigt wird
- **THEN** steht „5 h 01 min“, in beiden Zeitdarstellungen

#### Scenario: Volle Stunden
- **WHEN** ein Rhythmus von 480 Minuten gezeigt wird
- **THEN** steht „8 h“

#### Scenario: Einsatzdauer über einen Tag
- **WHEN** der Einsatz seit 2 Tagen, 14 Stunden und 20 Minuten läuft
- **THEN** zeigt seine Einsatzdauer „2 d 14 h“

#### Scenario: Kraft über einen Tag
- **WHEN** eine Einheit seit 26 Stunden und 5 Minuten im Einsatz ist
- **THEN** zeigt ihre Zelle „Im Einsatz“ „26 h 05 min“

#### Scenario: Eingestellte Länge über einen Tag
- **WHEN** ein Rhythmus von 167 Stunden und 59 Minuten gezeigt wird
- **THEN** steht „167 h 59 min“

### Requirement: Relative Angaben in der Form der Dauer
Eine relative Zeitangabe SHALL die Form der Dauer mit einem Vorwort tragen: „vor …“ für Vergangenes,
„seit …“ für Andauerndes, „in …“ für Kommendes, „noch …“ für Verbleibendes. Unter einer Minute MUST
„gerade eben“ bzw. „in < 1 min“ stehen. Rohe Minutenzahlen über 59 („301 min“) MUST NOT vorkommen.

#### Scenario: Alarmzeile mit langer Wartezeit
- **WHEN** die älteste überfällige Rückmeldung seit 301 Minuten aussteht
- **THEN** nennt die Alarmzeile „längste 5 h 01 min“

#### Scenario: Gerade eben
- **WHEN** eine Sichtung 20 Sekunden zurückliegt
- **THEN** steht „gesichtet gerade eben“

#### Scenario: Kommender Termin
- **WHEN** die nächste Lagebesprechung in 2 Stunden und 5 Minuten beginnt
- **THEN** zeigt ihr Zustand „in 2 h 05 min“

### Requirement: Uhr im Kopf in der Darstellung
Die Uhr im Kopf SHALL die Gerätezeit in der Rolle „Uhrzeit“ der wirksamen Darstellung zeigen:
taktisch „1731“, bei „Datum und Uhrzeit“ „17:31“. Dieselbe Uhr MUST im Lagemonitor und im Großbild
stehen. Eine Seite MUST NOT eine zweite Uhr neben ihren Titel stellen. Ohne Netz MAY die Uhr weiterlaufen,
denn sie zeigt die Gerätezeit und nicht den Datenstand. Hebt E2 für die Uhr auf (Entscheidung E5).

#### Scenario: Taktische Uhr
- **WHEN** die wirksame Darstellung taktisch ist und das Gerät 17:31 zeigt
- **THEN** steht im Kopf „1731“

#### Scenario: Gerätewahl Datum und Uhrzeit
- **WHEN** jemand am Gerät „Datum und Uhrzeit“ wählt
- **THEN** steht im Kopf ohne Neuladen „17:31“

#### Scenario: Lagebild ohne eigene Uhr
- **WHEN** eine Person das Lagebild öffnet
- **THEN** steht neben dem Titel der Datenstand und keine Uhrzeit

### Requirement: Eine Form für den Datenstand
Der Datenstand SHALL als Zeitpunkt in der Rolle „kurz“ erscheinen: „Stand 1731“, an einem anderen
Tag „Stand 221432“, ohne Netz mit „· offline“. Auf Lagebild, Großbild und Lagemonitor MUST ab einer
Minute Alter das Alter folgen („Stand 1731 · vor 2 min“); jünger MUST kein Alter stehen. „Stand vor
0 s“ und ein Stand nur als Alter MUST NOT vorkommen.

#### Scenario: Seite mit frischem Stand
- **WHEN** das Lagebild vor 20 Sekunden um 17:31 abgerufen wurde
- **THEN** steht „Stand 1731“ ohne Alter

#### Scenario: Lagebild mit älterem Stand
- **WHEN** das Lagebild seit 17:31 keinen neuen Stand erhalten hat und es 17:33 ist
- **THEN** steht „Stand 1731 · vor 2 min“

#### Scenario: Lagebild ohne Netz
- **WHEN** das Netz weg ist und der letzte Stand von 17:31 stammt
- **THEN** zeigt das Lagebild um 17:40 „Stand 1731 · vor 9 min · offline“

#### Scenario: Stand auf einer gewöhnlichen Seite
- **WHEN** eine Liste um 17:31 abgerufen wurde und um 17:40 gezeigt wird
- **THEN** steht im Kopf „Stand 1731“ ohne Alter
