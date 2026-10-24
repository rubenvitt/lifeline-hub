## ADDED Requirements

### Requirement: Material der Vorlage
Das System SHALL je Vorlage eine Liste von Material-Positionen führen. Jede Position MUST ein
Stamm-Material der eigenen Organisation, eine Menge von mindestens 1 und als Ort entweder die
Einheit der Vorlage oder ein Fahrzeug derselben Vorlage tragen. Dasselbe Material MAY in einer
Vorlage mehrfach stehen, etwa auf zwei Fahrzeugen. Die Liste MUST als Ganzes ersetzt werden und
höchstens 50 Positionen haben (400 sonst). Eine Menge unter 1 MUST mit 400 abgelehnt werden. Ein
Gerät MUST höchstens Menge 10 tragen, ein Gerät mit Bestandsnummer genau Menge 1. Ein Gerät mit
Bestandsnummer MUST im selben Vorlagen-Baum höchstens einmal stehen. Jeder dieser Verstöße und
ein Fahrzeug außerhalb der Vorlage MUST mit 422 abgelehnt werden. Neu aufnehmen MUST NOT ein
Material, das außer Dienst steht (422); ein später außer Dienst gestelltes bleibt und meldet
seinen Dienststatus. Entfernt eine Änderung ein Fahrzeug aus der Vorlage, MUST dessen Material in
derselben Änderung an die Einheit der Vorlage fallen. Jede Position MUST in der Antwort
Bezeichnung, Art, Bestandsnummer und Dienststatus aus dem Stamm nennen.

#### Scenario: Wolldecken an der Einheit, Rucksack auf dem RTW
- **WHEN** der Admin der Rettungsstaffel 50 Wolldecken ohne Fahrzeug und einen Sanitätsrucksack auf RTW 1 zuordnet
- **THEN** führt die Vorlage beide Positionen, die Decken an der Einheit, den Rucksack auf RTW 1

#### Scenario: Stromerzeuger doppelt im Baum
- **WHEN** der Admin den Stromerzeuger „SE-1“ der Staffel zuordnet, obwohl er schon am übergeordneten Zug steht
- **THEN** antwortet das System mit 422 und ändert nichts

#### Scenario: Gerät mit Menge 3
- **WHEN** der Admin einen Sanitätsrucksack ohne Bestandsnummer mit Menge 3 zuordnet
- **THEN** führt die Vorlage die Position mit Menge 3

#### Scenario: Fahrzeug aus der Vorlage genommen
- **WHEN** der Admin RTW 1 aus der Vorlage entfernt, auf dem ein Rucksack der Vorlage liegt
- **THEN** steht der Rucksack danach an der Einheit der Vorlage

#### Scenario: Fremdes Material
- **WHEN** der Admin ein Material einer anderen Organisation zuordnet
- **THEN** antwortet das System mit 422 und ändert nichts

## MODIFIED Requirements

### Requirement: Pflege in der Verwaltung
Die Verwaltung SHALL unter Stammdaten eine Sektion „Einheiten-Vorlagen“ mit einer Liste (Name,
Typ, Unterstellung, Fahrzeuge, Soll, Demo-Marke) und eine Detailseite je Vorlage zeigen, auf der
Kopfdaten, Untereinheiten, Fahrzeuge, Stammbesetzung und Material gepflegt werden. Warnungen
(„auch in …“, „außer Dienst“) MUST als Wort sichtbar sein, nicht nur als Farbe. Ohne Admin-Recht
MUST die Seite nur lesen lassen und das benennen.

#### Scenario: Warnung sichtbar
- **WHEN** ein Fahrzeug der Vorlage auch in einer anderen Vorlage steht
- **THEN** zeigt die Detailseite am Fahrzeug „auch in <Vorlage>“

#### Scenario: Material pflegen
- **WHEN** der Admin in der Sektion „Material“ 50 Wolldecken an der Einheit und einen Rucksack auf RTW 1 einträgt und speichert
- **THEN** zeigt die Sektion beide Positionen mit Menge und Ort

### Requirement: Vorschau im Einsatz
Das System SHALL zu einer Vorlage im Einsatz eine Vorschau liefern: die aktiven Einheiten des
Baums und je Fahrzeug und Person der Vorlage den Zustand im Einsatz als einen von „neu“, „frei“,
„gebunden“ (mit Einheit oder Fahrzeug), „außer Dienst“, „entlassen“. Eine stornierte Kraft MUST
als „neu“ gelten. Je Material-Position MUST die Vorschau Bezeichnung, Art, Menge, Ort in der
Vorlage und den Zustand als einen von „neu“, „außer Dienst“, „schon im Einsatz“ nennen. „Schon im
Einsatz“ gilt nur für ein Gerät mit Bestandsnummer, das aktiv im Einsatz steht. Ein Gerät mit
Bestandsnummer MUST mit Menge 1 erscheinen. Art und Bestandsnummer MUST aus dem Stamm von jetzt
stammen. Die Vorschau MUST NOT etwas schreiben; maßgeblich bleibt die Prüfung beim Bilden.

#### Scenario: Fahrzeug in anderer Einheit
- **WHEN** RTW 2 im Einsatz dem „2. Zug“ angehört
- **THEN** meldet die Vorschau RTW 2 als gebunden mit „2. Zug“

#### Scenario: Gerät schon im Einsatz
- **WHEN** der Stromerzeuger „SE-1“ der Vorlage schon aktiv im Einsatz steht
- **THEN** meldet die Vorschau seine Position als „schon im Einsatz“

#### Scenario: Verbrauchsgut mehrfach
- **WHEN** im Einsatz schon Wolldecken disponiert sind
- **THEN** meldet die Vorschau die Wolldecken der Vorlage als „neu“

### Requirement: Vorschau achtet die Modulfreigabe
Fahrzeug-, Personen- und Materialzeilen der Vorschau MUST nur erscheinen, wenn das jeweilige Modul
(Fahrzeuge, Personal, Material) für die Rolle freigegeben ist; sonst MUST die Vorschau den Teil als
gesperrt melden.

#### Scenario: Personal gesperrt
- **WHEN** die Rolle das Modul Personal nicht freigegeben hat
- **THEN** enthält die Vorschau keine Personen und meldet das Personal als gesperrt

#### Scenario: Material gesperrt
- **WHEN** die Rolle das Modul Material nicht freigegeben hat
- **THEN** enthält die Vorschau kein Material und meldet das Material als gesperrt

### Requirement: Seite zum Bilden aus der Vorlage
Die Seite SHALL den Namen der obersten Einheit (vorbelegt, änderbar), den Abschnitt und den Baum
der Vorlage mit einem Häkchen je Fahrzeug (Vorgabe an), je Person (Vorgabe aus) und je
Material-Position (Vorgabe an) zeigen. Jede Zeile MUST ihren Zustand als Wort tragen; eine
gebundene Kraft MUST nur über ein Häkchen „umhängen“ wählbar sein, eine außer Dienst stehende
Kraft oder Position und eine Position „schon im Einsatz“ MUST gesperrt sein. Eine Person, deren
Fahrzeug nicht mitkommt, MUST „ohne Fahrzeug“ zeigen, eine Material-Position in diesem Fall „an der
Einheit“. Die Zusammenfassung MUST die gewählten Positionen nennen, sobald die Vorlage Material
führt.

#### Scenario: Vorgaben der Häkchen
- **WHEN** die Führung „Sanitätszug Musterstadt“ wählt und keine Kraft im Einsatz ist
- **THEN** sind alle Fahrzeuge angehakt, keine Person, und die Zusammenfassung nennt „1 Zug, 1 Staffel, 3 Fahrzeuge, 0 Kräfte“

#### Scenario: Fahrzeug abgewählt
- **WHEN** die Führung RTW 1 abwählt und eine Person der Vorlage auf RTW 1 anhakt
- **THEN** zeigt die Person „ohne Fahrzeug“

#### Scenario: Material angehakt
- **WHEN** die Vorlage zwei Material-Positionen führt und keine gesperrt ist
- **THEN** sind beide angehakt, und die Zusammenfassung nennt „2 Material“

#### Scenario: Material ohne sein Fahrzeug
- **WHEN** die Führung RTW 1 abwählt, auf dem ein Rucksack der Vorlage liegt
- **THEN** zeigt der Rucksack „an der Einheit“
