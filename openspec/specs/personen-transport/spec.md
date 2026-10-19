# personen-transport Specification

## Purpose
Transportpriorität, Transportart und benötigte Fachrichtung einer Person als Verlauf mit aktuellem
Stand. Die Führung sieht, wer wie dringlich wohin muss. Nur die Priorität erscheint im ETB.

## Requirements

### Requirement: Transport festlegen

Wer im Einsatz Schreibrecht auf das Modul Personen hat, SHALL an einer angetroffenen Person einen
Transportstand festlegen können. Er besteht aus:
- Priorität `sofort`, `dringlich` oder `normal`;
- Art `liegend`, `sitzend` oder `mit_notarzt`;
- benötigte Fachrichtung `unfallchirurgie`, `verbrennung`, `kinder`, `neuro`, `innere`,
  `geburtshilfe`, `psychiatrie` oder `sonstige`.

Jedes der drei Felder MUST einzeln leer sein dürfen. Ein Stand mit drei leeren Feldern MUST den
Transport aufheben. Jeder Stand MUST als neuer Eintrag im Verlauf stehen, mit Zeitpunkt und
Erfasser. Der aktuelle Stand MUST mit der Person geliefert werden. Ein unbekannter Katalogwert MUST
400 ergeben, eine stornierte Person 409, eine vermisste oder abgemeldete 422.

#### Scenario: Priorität dringlich, liegend
- **WHEN** jemand an R-012 „dringlich“, „liegend“ und „Unfallchirurgie“ festlegt
- **THEN** liefern Liste und Detail von R-012 diesen Stand
- **AND** der Verlauf nennt den Eintrag mit Zeitpunkt und Erfasser

#### Scenario: Transport aufheben
- **WHEN** jemand an R-012 einen Stand mit drei leeren Feldern festlegt
- **THEN** hat R-012 keinen Transportstand mehr
- **AND** der Verlauf nennt die Aufhebung

### Requirement: Nur die Priorität steht im ETB

Ändert ein Stand die Priorität, SHALL das System einen System-Eintrag ins ETB schreiben, etwa
„Person R-012: Transportpriorität dringlich“. Am UHS-Gerät folgt der Name der Bestätigung
(„, bestätigt: Name“). Wird die Priorität aufgehoben, MUST der Eintrag „Person R-012:
Transportpriorität aufgehoben“ lauten. Ändert ein Stand nur Art oder Fachrichtung, MUST kein
Eintrag entstehen. Art und Fachrichtung MUST NOT im ETB oder in einem Live-Ereignis erscheinen.
Ein nachgereichter älterer Stand, der die Priorität gegenüber dem zeitlich vorigen Stand ändert,
MUST zusätzlich die weiter geltende Priorität nennen, wie die Sichtung („…, nachgetragen,
aktuelle Priorität bleibt normal“, ohne aktuelle Priorität „…, nachgetragen, aktuell keine
Priorität“).

#### Scenario: Nur die Fachrichtung ändert sich
- **WHEN** bei R-012 nur die Fachrichtung von „Unfallchirurgie“ auf „Verbrennung“ wechselt
- **THEN** entsteht kein ETB-Eintrag

#### Scenario: Eingeschobener älterer Stand
- **WHEN** bei R-012 um 14:00 „normal“ und um 14:20 nur die Art festgelegt ist
- **AND** danach ein um 14:10 vorgemerkter Stand „sofort“ ankommt
- **THEN** lautet sein ETB-Eintrag zur Zeit 14:10 „Person R-012: Transportpriorität sofort,
  nachgetragen, aktuelle Priorität bleibt normal“

#### Scenario: Pseudonym im ETB
- **WHEN** die Priorität von R-012 auf „sofort“ gesetzt wird
- **THEN** nennt der ETB-Eintrag die Registriernummer und „Transportpriorität sofort“
- **AND** er nennt weder Name noch Art noch Fachrichtung

### Requirement: Priorität ordnet innerhalb der Sichtungskategorie

Wartebereich, Zuweisung und Patientenliste am UHS-Gerät SHALL innerhalb einer Sichtungskategorie
zuerst nach Priorität ordnen (sofort, dringlich, normal, ohne), danach nach der längsten Wartezeit.
Die Folge der Sichtungskategorien MUST unverändert bleiben. Die Betroffenenliste MUST eine Spalte
„Transport“ haben, nach der man sortieren kann. Ihre Vorgabe-Sortierung MUST unverändert bleiben.

#### Scenario: Zwei SK I im Wartebereich
- **WHEN** im Wartebereich R-003 (SK I, normal, wartet 20 min) und R-005 (SK I, sofort, wartet 5 min) stehen
- **THEN** steht R-005 vor R-003

#### Scenario: Priorität sticht keine Sichtung
- **WHEN** im Wartebereich R-004 (SK II, sofort) und R-006 (SK I, ohne Priorität) stehen
- **THEN** steht R-006 vor R-004

### Requirement: Transport am UHS-Gerät

Ein Gerät mit UHS-Ansicht SHALL den Transportstand von Personen seiner UHS festlegen können, mit
optionaler Angabe „Bestätigt von“. Eine fremde UHS MUST 404 ergeben, Betreuungsstelle und
Lagemonitor MUST 403 erhalten.

#### Scenario: Festlegen am Tablet
- **WHEN** das Tablet der UHS Nord bei einer Person seiner UHS „sofort“ festlegt
- **THEN** nennt der ETB-Eintrag „UHS Nord · Tablet 1“ als Erfasser
