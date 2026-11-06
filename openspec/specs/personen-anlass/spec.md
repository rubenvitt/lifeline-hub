# personen-anlass Specification

## Purpose
Anlass der Hilfeleistung einer Person aus einem festen Katalog, als Verlauf mit aktuellem Stand
(LLH-1566). Sanitätsdienst und Lagebild zählen damit, warum Menschen Hilfe brauchten. Der Anlass
ist ein Behandlungsdatum und steht nie im ETB.

## Requirements

### Requirement: Anlass festlegen

Wer an einer Person sichten darf, SHALL an einer angetroffenen Person genau einen Anlass
festlegen und ändern können, aus dem Katalog `verletzung`, `internistisch`, `neurologisch`,
`intoxikation`, `hitze_kaelte`, `allergie`, `psychisch` und `sonstiges`. Ein leerer Stand MUST
den Anlass aufheben. Jeder Stand MUST als neuer Eintrag im Verlauf stehen, mit Zeitpunkt und
Erfasser; der aktuelle Stand MUST mit der Person geliefert werden, entschieden nach dem jüngsten
Zeitpunkt, nicht nach der Ankunft. Ein unbekannter Katalogwert MUST 400 ergeben, eine stornierte
Person 409, eine vermisste oder abgemeldete 422. Die Betreuungsstelle MUST keinen Anlass
festlegen können (403), weder einzeln noch mit der Anlage.

#### Scenario: Anlass festlegen und wechseln
- **WHEN** jemand an R-012 „Intoxikation“ und später „Hitze / Kälte“ festlegt
- **THEN** liefern Liste und Detail von R-012 „Hitze / Kälte“
- **AND** der Verlauf nennt beide Stände mit Zeitpunkt und Erfasser

#### Scenario: Anlass aufheben
- **WHEN** jemand an R-012 einen leeren Stand festlegt
- **THEN** hat R-012 keinen Anlass mehr
- **AND** der Verlauf nennt die Aufhebung

### Requirement: Drei Wege zum Anlass

Der Anlass SHALL sich in der Erfassungsmaske (unter „Weitere Angaben“), im Patientenkopf und in
der Kurzeingabe mit `!` und einem Kürzel (`!intox`, `!verl` …) setzen lassen. Ein unbekanntes
oder zweites Kürzel MUST die Kurzeingabe als „Nicht erfasst“ melden und nichts anlegen. Ohne Netz
MUST der Anlass wie Sichtung und Transport vorgemerkt werden und mit seiner Erfassungszeit
hinausgehen. Der Patientenkopf MUST dabei weiter den Serverstand zeigen; sein Paneel MUST den Stand
vorwählen, der nach dem Abgleich gilt (den jüngsten vorgemerkten, sonst den Serverstand), und
unverändert abgeschickt nichts senden.

#### Scenario: Vorgemerkte Aufhebung bleibt stehen
- **WHEN** an R-012 mit Anlass „Psychisch“ ohne Netz die Aufhebung vorgemerkt ist
- **AND** jemand das Paneel erneut öffnet
- **THEN** ist kein Anlass vorgewählt
- **AND** ohne Wahl verlangt das Paneel einen Anlass, statt „Psychisch“ erneut vorzumerken

#### Scenario: Kurzeingabe mit Anlass
- **WHEN** jemand „Kowalski sk2 !intox“ eingibt und speichert
- **THEN** entsteht eine Person mit Sichtung SK II und Anlass „Intoxikation“

### Requirement: Kein Anlass im ETB

Ein Anlass MUST NOT im ETB erscheinen, weder beim Festlegen noch mit der Anlage. Im Live-Kanal
MUST NOT mehr als Einsatz und Person stehen.

#### Scenario: Anlass ohne ETB-Eintrag
- **WHEN** jemand an R-012 einen Anlass festlegt
- **THEN** entsteht kein ETB-Eintrag

### Requirement: Zählung je Anlass

Das System SHALL eine Zählung der angetroffenen Personen je Anlass bereitstellen, mit „ohne“ für
Personen ohne Anlass, für Lagebild und Bericht. Vermisste MUST NOT mitzählen, abgeschlossene
Patienten MUST mitzählen.

#### Scenario: Zählung
- **WHEN** zwei Personen „Intoxikation“, eine „Verletzung“ und eine keinen Anlass haben
- **THEN** nennt die Zählung 2 × Intoxikation, 1 × Verletzung und 1 × ohne
