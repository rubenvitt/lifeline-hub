# zeitdarstellung Specification

## Purpose
Legt fest, wie die Oberfläche Zeitpunkte zeigt: in einer Schreibweise für Funk, ETB, Lagekarte und
Druck, der taktischen Datum-Zeit-Gruppe (DTG), oder wahlweise als Datum und Uhrzeit; dazu Dauern,
die Uhr im Kopf und den Datenstand. Grundlage sind die Entscheidungen E1–E4 vom 22.10.2026
(LLH-1045, Bau LLH-1053) und E5 vom 17.11.2026 (LLH-1750). Wie Zeiten eingegeben werden, regelt
`zeiteingabe`.

## Entscheidungen
- **E1 Schreibweise der vollen DTG:** `101430okt26` — Tag, Uhrzeit, Monatskürzel klein und ohne
  Umlaut (`jan feb mrz apr mai jun jul aug sep okt nov dez`), Jahr zweistellig. Quelle der
  Systematik: FwDV/DV 810 „Sprech- und Datenfunkverkehr“, Ausgabe 2018, Teil I, 5.1.1.12 („Tag des
  Monats – Uhrzeitgruppe (hhmm), soweit erforderlich können Monat und Jahr angefügt werden“,
  Beispiel `271938jan19`). Die Vorschrift nennt nur dieses Kürzel; die Liste der zwölf ist die
  Entscheidung E1.
- **E2 Kurzform:** taktisch ohne Doppelpunkt, heute `1446`, an anderen Tagen `091446`. (Die
  Ausnahme für Uhr im Kopf und Dauern hebt E5 auf.)
- **E3 Wahl:** Organisation und Einsatz geben die Darstellung vor (Vorgabe taktisch); am Gerät
  kann man „taktisch“ oder „Datum und Uhrzeit“ wählen, wie das Koordinatensystem.
- **E4 Druck und Servertexte:** der Druck folgt Einsatz und Organisation, nie dem Gerät.
  Servertexte schreiben künftig die volle DTG; Alteinträge bleiben (Umsetzung LLH-1061).
- **E5 Uhr, Dauer und Datenstand** (17.11.2026, LLH-1750): die Uhr im Kopf folgt der Darstellung
  (Gerätezeit, `1731` bzw. `17:31`); eine Dauer hat eine Form („45 min“, „8 h“, „5 h 01 min“, die
  Einsatzdauer ab 24 h „2 d 14 h“), unabhängig von der Darstellung; der Datenstand heißt überall
  „Stand 1731“, auf Lageflächen mit Alter. Herleitung:
  `openspec/changes/archive/2026-11-18-aovwhho1-zeitformate/design.md`.

## Requirements

### Requirement: Drei Rollen, zwei Darstellungen
Jede Zeitangabe für Menschen SHALL eine von drei Rollen tragen und in der wirksamen Darstellung
erscheinen: „Zeitpunkt“, „kurz“ (heute nur die Uhrzeit, sonst Tag und Uhrzeit) und „Uhrzeit“
(nur wo der Tag aus dem Zusammenhang feststeht). Die Zeit MUST in der Anzeigezone stehen (Spec
`zeiteingabe`, „Eingabe in der Anzeigezone“), auch „heute“ wird dort bestimmt.

#### Scenario: Taktisch
- **WHEN** die Darstellung taktisch ist, die Anzeigezone Europe/Berlin und der Zeitpunkt 10.10.2026 14:30 Ortszeit
- **THEN** zeigt die Rolle „Zeitpunkt“ `101430okt26`, die Rolle „kurz“ am selben Tag `1430` und die Rolle „Uhrzeit“ `1430`

#### Scenario: Kurzform am Vortag
- **WHEN** die Darstellung taktisch ist und der Zeitpunkt 09.10.2026 14:30 am 10.10.2026 gezeigt wird
- **THEN** zeigt die Rolle „kurz“ `091430`

#### Scenario: Datum und Uhrzeit
- **WHEN** die Darstellung „Datum und Uhrzeit“ ist und derselbe Zeitpunkt 10.10.2026 14:30 gezeigt wird
- **THEN** zeigt die Rolle „Zeitpunkt“ `10.10.26 14:30`, die Rolle „kurz“ am selben Tag `14:30` und am Folgetag `10.10. 14:30`, die Rolle „Uhrzeit“ `14:30`

#### Scenario: Monatswechsel
- **WHEN** der Zeitpunkt 31.10.2026 23:30 UTC in der Anzeigezone Europe/Berlin gezeigt wird
- **THEN** zeigt die Rolle „Zeitpunkt“ `010030nov26`

#### Scenario: Jahreswechsel
- **WHEN** der Zeitpunkt 31.12.2026 23:15 UTC in der Anzeigezone Europe/Berlin gezeigt wird
- **THEN** zeigt die Rolle „Zeitpunkt“ `010015jan27` bzw. `01.01.27 00:15`

#### Scenario: Sommerzeitgrenze
- **WHEN** die Zeitpunkte 29.03.2026 00:30 UTC und 01:30 UTC in der Anzeigezone Europe/Berlin gezeigt werden
- **THEN** zeigt die Rolle „Zeitpunkt“ `290130mrz26` und `290330mrz26`

#### Scenario: Kalendertag ohne Uhrzeit
- **WHEN** nur der Tag eines Zeitpunkts gebraucht wird (Tageskopf, Platzhalter `{datum}` im ETB-Baustein) und der Zeitpunkt der 10.10.2026 ist
- **THEN** steht taktisch der Tagesteil der DTG `10okt26`, bei „Datum und Uhrzeit“ `10.10.26`

#### Scenario: Anzeigezone weicht von der Browserzone ab
- **WHEN** der Browser auf UTC steht, die Anzeigezone Europe/Berlin ist, es 10.10.2026 22:30 UTC ist und der Zeitpunkt 10.10.2026 21:00 UTC gezeigt wird
- **THEN** zeigt die Rolle „kurz“ `102300`, denn in der Anzeigezone ist schon der 11.10.

### Requirement: Darstellung von Organisation, Einsatz und Gerät
Organisation und Einsatz SHALL je eine Einstellung „Zeitdarstellung“ mit den Werten „Taktisch“ und
„Datum und Uhrzeit“ führen; leer heißt Vorgabe, also taktisch. Am Gerät SHALL man die Darstellung
übersteuern können (Profil, „Darstellung auf diesem Gerät“, und Sprungpalette), ohne Umweg über
den Server (die Wahl bleibt auf dem Gerät). Wirksam MUST sein: Gerät vor Einsatz vor Organisation vor Vorgabe. Eine Gerätewahl MUST
sofort in allen offenen Ansichten wirken, auch wenn der Browser keinen Speicher erlaubt (dann bis
zum Neuladen).

#### Scenario: Altwerte
- **WHEN** eine Organisation vor der Umstellung „24 Stunden“ oder „12 Stunden“ gespeichert hatte
- **THEN** ist ihre Zeitdarstellung danach leer, es gilt die Vorgabe taktisch

#### Scenario: Gerätewahl wirkt sofort
- **WHEN** der Einsatz taktisch vorgibt und jemand im Profil „Datum und Uhrzeit“ wählt, während eine Ansicht des Einsatzes offen ist
- **THEN** zeigt diese Ansicht ohne Neuladen `10.10.26 14:30` statt `101430okt26`

#### Scenario: Zurück zur Vorgabe
- **WHEN** jemand am Gerät „Vorgabe“ wählt
- **THEN** gilt wieder die Darstellung des Einsatzes bzw. der Organisation

### Requirement: Druck ohne Gerätewahl
Ein Ausdruck SHALL die Darstellung von Einsatz bzw. Organisation zeigen; die Gerätewahl MUST NOT in
den Druck eingehen.

#### Scenario: Druck bei abweichender Gerätewahl
- **WHEN** der Einsatz taktisch vorgibt, das Gerät „Datum und Uhrzeit“ gewählt hat und gedruckt wird
- **THEN** steht im Druckbild `101430okt26`, am Bildschirm danach wieder `10.10.26 14:30`

### Requirement: Servertexte
Texte, die der Server fertig schreibt und speichert oder verteilt (Systemeinträge und Meldungen im
ETB, Detailzeile eines Hinweises), SHALL Zeitpunkte in der Darstellung von Einsatz bzw.
Organisation nennen, Vorgabe taktisch (LLH-1061); die Gerätewahl MUST NOT eingehen. Sie bildet nur
`src/zeitdarstellung.rs`. Ein Zeitpunkt steht in der Rolle „Zeitpunkt“, ein Zeitraum als Zeitpunkt
und Uhrzeit, wenn das Ende am selben Ortstag liegt, sonst als zwei Zeitpunkte; die Rolle „kurz“
MUST NOT vorkommen, denn ein gespeicherter Text weiß nicht, wann er gelesen wird. Wo der Tag aus
dem Zusammenhang feststeht (Fälligkeit einer Ablösung im Hinweis), steht die Rolle „Uhrzeit“.
Geschriebene Einträge MUST unverändert bleiben (E4).

#### Scenario: Nachtrag in voller DTG
- **WHEN** weder Einsatz noch Organisation eine Darstellung wählen und ein Eintreffen für 30.09.2026 06:40 Ortszeit nachgetragen wird
- **THEN** nennt der ETB-Eintrag `300640sep26`

#### Scenario: Zeitraum in beiden Darstellungen
- **WHEN** ein Verpflegungs-Zeitfenster am 24.09.2026 von 12:00 bis 13:30 Ortszeit angelegt wird
- **THEN** nennt der ETB-Eintrag taktisch `241200sep26–1330`, bei „Datum und Uhrzeit“ `24.09.26 12:00–13:30`, und über Mitternacht beide Tage (`242200sep26–250200sep26`)

#### Scenario: Einsatz vor Organisation
- **WHEN** die Organisation „Datum und Uhrzeit“ wählt und der Einsatz „Taktisch“
- **THEN** schreibt der Server für diesen Einsatz `300640sep26`

#### Scenario: Alteinträge bleiben
- **WHEN** ein Einsatz von „Datum und Uhrzeit“ auf „Taktisch“ umgestellt wird
- **THEN** behalten die vorher geschriebenen ETB-Einträge ihren Wortlaut, neue nennen die volle DTG

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
