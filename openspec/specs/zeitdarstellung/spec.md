# zeitdarstellung Specification

## Purpose
Legt fest, wie die Oberfläche Zeitpunkte zeigt: in einer Schreibweise für Funk, ETB, Lagekarte und
Druck, der taktischen Datum-Zeit-Gruppe (DTG), oder wahlweise als Datum und Uhrzeit. Grundlage sind
die Entscheidungen E1–E4 vom 22.10.2026 (LLH-1045, Bau LLH-1053). Wie Zeiten eingegeben werden,
regelt `zeiteingabe`.

## Entscheidungen
- **E1 Schreibweise der vollen DTG:** `101430okt26` — Tag, Uhrzeit, Monatskürzel klein und ohne
  Umlaut (`jan feb mrz apr mai jun jul aug sep okt nov dez`), Jahr zweistellig. Quelle der
  Systematik: FwDV/DV 810 „Sprech- und Datenfunkverkehr“, Ausgabe 2018, Teil I, 5.1.1.12 („Tag des
  Monats – Uhrzeitgruppe (hhmm), soweit erforderlich können Monat und Jahr angefügt werden“,
  Beispiel `271938jan19`). Die Vorschrift nennt nur dieses Kürzel; die Liste der zwölf ist die
  Entscheidung E1.
- **E2 Kurzform:** taktisch ohne Doppelpunkt, heute `1446`, an anderen Tagen `091446`. Die Uhr im
  Kopf (Gerätezeit) und Dauern bleiben, wie sie sind.
- **E3 Wahl:** Organisation und Einsatz geben die Darstellung vor (Vorgabe taktisch); am Gerät
  kann man „taktisch“ oder „Datum und Uhrzeit“ wählen, wie das Koordinatensystem.
- **E4 Druck und Servertexte:** der Druck folgt Einsatz und Organisation, nie dem Gerät.
  Servertexte schreiben künftig die volle DTG; Alteinträge bleiben (Umsetzung LLH-1061).

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

### Requirement: Eine Formatstelle
Zeitangaben für Menschen SHALL nur der Formatkern in `frontend/src/anzeige/` bilden. Ein Wächter
MUST jede neue Formatierung mit Datums- oder Uhrzeit-Token außerhalb davon ablehnen; Maschinen-
formate in ISO-Reihenfolge und die Uhr im Kopf sind ausgenommen. Der Bestand vom 22.10.2026 ist
abgebaut (LLH-1061); die Schuldmenge im Wächter MUST leer bleiben. Die Uhr des Lagemonitors nimmt
dieselbe Formatierung wie die Uhr im Kopf. Der Datenstand rechnet bewusst in der Gerätezeit, folgt
aber der Darstellung.

#### Scenario: Neue eigene Formatierung
- **WHEN** eine Seite unter `pages/` `dayjs().format('HH:mm')` einführt
- **THEN** ist der Wächter rot
