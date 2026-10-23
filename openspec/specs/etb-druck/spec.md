# etb-druck Specification

## Purpose
Macht das Einsatztagebuch als vollständiges, zuordenbares Papier- bzw. PDF-Dokument
ausgebbar, für die Einsatznachbereitung und die Beweissicherung.

## Requirements

### Requirement: Einstieg in den ETB-Druck

Das Einsatztagebuch SHALL eine Aktion „Drucken / als PDF“ anbieten, die eine eigene
Druckansicht öffnet. Die Druckansicht SHALL eine eigene, teilbare Adresse haben, die den
Filter des Tagebuchs trägt. Die Aktion SHALL den gerade aktiven Filter (Suchbegriff, Typ,
Zeitraum, betroffene Einheit) unverändert mitnehmen.

#### Scenario: Aus dem gefilterten ETB drucken

- **WHEN** eine Person im ETB nach Typ „Meldung“ und einem Zeitraum filtert und
  „Drucken / als PDF“ wählt
- **THEN** öffnet sich die Druckansicht mit genau diesem Filter
- **AND** ein Neuladen der Druckansicht behält den Filter

#### Scenario: Unbrauchbarer Filter in der Adresse

- **WHEN** die Adresse der Druckansicht einen unbekannten Typ trägt
- **THEN** wird dieser Filterwert verworfen und nicht als Auswahl im Kopf genannt

### Requirement: Zugriff wie das Tagebuch

Die Druckansicht SHALL genau die Personen zulassen, die das Tagebuch lesen dürfen,
einschließlich Beobachtern und abgeschlossener Einsätze. Ist das Modul ETB für die Person
gesperrt oder ist die Aufbewahrungsfrist des Einsatzes abgelaufen, MUST die Druckansicht
keine Einträge zeigen und nicht druckbar sein.

#### Scenario: Beobachter druckt

- **WHEN** ein Beobachter des Einsatzes die Druckansicht öffnet
- **THEN** sieht er alle Einträge der Auswahl und kann drucken

#### Scenario: Modul gesperrt

- **WHEN** das Modul ETB für die Person gesperrt ist
- **THEN** zeigt die Druckansicht keine Einträge und bietet kein Drucken an

### Requirement: Vollständige Auswahl statt geladenem Fenster

Die Druckansicht SHALL alle Einträge laden, auf die der Filter passt, unabhängig davon, wie
viele das Tagebuch am Bildschirm gerade geladen hat. Die Auswahl MUST dieselbe Menge sein, die
das Tagebuch mit demselben Filter liefert. Solange nicht alle Einträge geladen sind, MUST das
Drucken gesperrt sein und die Ansicht den Ladefortschritt nennen. Scheitert ein Teilabruf,
MUST die Ansicht den Fehler nennen, einen neuen Versuch anbieten und das Drucken gesperrt
lassen. Ein Teilausdruck ist ausgeschlossen.

#### Scenario: Tagebuch mit 1 200 Einträgen

- **WHEN** ein Einsatz 1 200 ETB-Einträge hat und die Druckansicht ohne Filter geöffnet wird
- **THEN** stehen alle 1 200 Einträge in der Druckansicht
- **AND** der Kopf nennt „1 200 Einträge“

#### Scenario: Abruf scheitert mittendrin

- **WHEN** beim Laden der dritten Seite ein Fehler auftritt
- **THEN** ist „Drucken / als PDF“ gesperrt
- **AND** die Ansicht nennt den Fehler und bietet „Erneut laden“ an

#### Scenario: Leere Auswahl

- **WHEN** keine Einträge auf den Filter passen
- **THEN** sagt die Ansicht „Keine Einträge in dieser Auswahl“ und bleibt druckbar

### Requirement: Stand ist ein Schnappschuss

Die Druckansicht SHALL den Stand zum Zeitpunkt des Ladens zeigen. Einträge, die danach
erfasst werden, MUST NOT still in die geladene Ansicht eingeschoben werden. Der Kopf SHALL den
Stand nennen (Ladezeitpunkt und höchste enthaltene laufende Nummer). Die Ansicht SHALL
„Neu laden“ anbieten.

#### Scenario: Neuer Eintrag während der Vorbereitung

- **WHEN** während die Druckansicht offen ist ein neuer ETB-Eintrag erfasst wird
- **THEN** bleibt die Ansicht unverändert, bis die Person „Neu laden“ wählt

### Requirement: Auswahl im Kopf

Der Druckkopf der ETB-Druckansicht SHALL die gedruckte Auswahl in Worten nennen: Typ als
Typwort, Zeitraum von/bis in der Zeitzone der Organisation, Suchbegriff wörtlich und eine
betroffene Einheit mit ihrem Namen. Eine Datenbank-Kennung MUST NOT im Kopf erscheinen. Ohne
Filter SHALL der Kopf „vollständiges Tagebuch“ nennen.

#### Scenario: Zeitraum in der Org-Zeitzone

- **WHEN** der Filter am 21.09.2026 von 08:00 bis 12:00 Uhr Ortszeit (Org-Zeitzone Europe/Berlin,
  Sommerzeit) reicht und die Darstellung taktisch ist
- **THEN** nennt der Kopf den Zeitraum mit `210800sep26` und `211200sep26`, nicht in UTC

#### Scenario: Einheit ohne lesbaren Namen

- **WHEN** der Filter eine Einheit enthält, deren Name der Person nicht zur Verfügung steht
  (Modul Einheiten nicht zugänglich oder Einheit nicht gefunden)
- **THEN** nennt der Kopf „betrifft eine Einheit (Name nicht verfügbar)“ statt einer Kennung

#### Scenario: Ungefiltert

- **WHEN** die Druckansicht ohne Filter geöffnet wird
- **THEN** nennt der Kopf „vollständiges Tagebuch“

### Requirement: Ordnung nach laufender Nummer

Die Druckansicht SHALL die Einträge aufsteigend nach laufender Nummer ordnen, anders als die
Zeitachse am Bildschirm. Die Nummernfolge macht Lücken und Nachträge auf Papier sichtbar.

#### Scenario: Reihenfolge

- **WHEN** Einträge Nr. 3, 1 und 2 geladen sind
- **THEN** stehen sie im Ausdruck in der Folge 1, 2, 3

### Requirement: Inhalt je Eintrag

Jeder Eintrag SHALL mit laufender Nummer, Ereigniszeit, Typwort, Von und An (falls
vorhanden), Meldeweg (falls vorhanden), Inhalt und Erfasser samt Funktion (falls vorhanden)
gedruckt werden. Alle Zeiten MUST in der Zeitzone der Organisation stehen. Die Ereigniszeit SHALL
in der Rolle „Zeitpunkt“ der Spec `zeitdarstellung` stehen, taktisch also als volle DTG
(`101430okt26`), in der Darstellung von Einsatz bzw. Organisation; die Wahl am Gerät MUST NOT in
den Ausdruck eingehen (LLH-1061). Ein Eintrag MUST NOT
über einen Seitenrand geteilt werden, solange er auf eine Seite passt; der Tabellenkopf SHALL
sich auf jeder Seite wiederholen.

#### Scenario: Eintrag im Ausdruck

- **WHEN** ein Meldungseintrag von „Florian 1“ an „ELW“ gedruckt wird
- **THEN** stehen Nummer, Ereigniszeit, „Meldung“, Von, An, Inhalt und Erfasser im Ausdruck

#### Scenario: Volle DTG in der Zeitspalte

- **WHEN** der Einsatz taktisch vorgibt, das Gerät „Datum und Uhrzeit“ gewählt hat und ein Eintrag
  mit Ereigniszeit 10.10.2026 14:30 Uhr Ortszeit gedruckt wird
- **THEN** steht in seiner Zeitspalte `101430okt26`

### Requirement: Nachträge sind erkennbar

Ein nachgetragener Eintrag (Ereigniszeit deutlich vor der Erfassung) SHALL an seiner
laufenden Nummer stehen und neben der Ereigniszeit „nachgetragen um <Erfassungszeit>“ tragen:
am selben Tag in der Rolle „Uhrzeit“, an einem anderen Tag in der Rolle „Zeitpunkt“.

#### Scenario: Nachtrag

- **WHEN** Eintrag Nr. 12 am 21.09.2026 um 10:40 Uhr für ein Ereignis um 09:15 Uhr erfasst wurde
  und die Darstellung taktisch ist
- **THEN** steht er zwischen Nr. 11 und Nr. 13 mit Ereigniszeit `210915sep26` und
  „nachgetragen um 1040“

### Requirement: Berichtigungen sind in beiden Richtungen sichtbar

Eine Berichtigung SHALL „berichtigt Nr. n“ tragen. Ein berichtigter Eintrag SHALL
„berichtigt durch Nr. m“ tragen, auch wenn die Berichtigung selbst nicht zur gedruckten
Auswahl gehört. Liegt der Grundeintrag einer gedruckten Berichtigung außerhalb der Auswahl,
SHALL die Berichtigung das in Worten sagen, statt die Angabe wegzulassen.

#### Scenario: Gefilterter Druck mit später berichtigter Meldung

- **WHEN** nur Meldungen gedruckt werden und Meldung Nr. 7 durch Nr. 20 (Typ Berichtigung)
  berichtigt wurde
- **THEN** trägt Nr. 7 im Ausdruck „berichtigt durch Nr. 20“

#### Scenario: Berichtigung ohne Grundeintrag in der Auswahl

- **WHEN** nur Berichtigungen gedruckt werden
- **THEN** trägt jede Berichtigung „berichtigt Nr. n“, wenn Nr. n bekannt ist, sonst
  „berichtigt einen Eintrag außerhalb dieser Auswahl“
