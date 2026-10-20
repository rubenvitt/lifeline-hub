# gefahrenmatrix Specification

## Purpose
Darstellung der Gefahrenmatrix eines Gefahrengebiets (Gefahr × Schutzobjekt) und die Beurteilung
des Gebiets. Eine Zelle ohne Bewertung zeigt die Vorgabe „keine“. Ob jemand die Matrix angesehen
hat, zeigt die Beurteilung am Gebiet: „beurteilt <DTG> · <Name>“ oder „nicht beurteilt“. Das
schreibt die Entscheidung fort, dass eine offene Beurteilung nicht wie eine Entwarnung aussehen
darf: diese Aussage trägt jetzt „nicht beurteilt“ am Gebiet, nicht mehr eine leere Zelle.

## Requirements

### Requirement: Eine Zelle ohne Bewertung zeigt die Vorgabe „keine“
Jede gültige Zelle der Gefahrenmatrix SHALL die Stufe „keine“ mit Zeichen „–“, Fläche und
zugänglichem Namen („Bewertung <Gefahr> × <Schutzobjekt>: keine“) zeigen, solange keine andere
Stufe gesetzt ist. Eine Zelle ohne gespeicherte Bewertung und eine Zelle mit der Stufe „keine“
MUST gleich aussehen. Die Matrix MUST keinen Zähler unbewerteter Felder zeigen. Solange die
Bewertungen laden, MUST eine Zelle ohne geladene Bewertung ohne Zeichen und gesperrt bleiben:
ein Strich vor dem Laden wäre eine ungeprüfte Entwarnung.

#### Scenario: Neues Gebiet
- **WHEN** ein Gefahrengebiet ohne jede Bewertung geöffnet ist und die Bewertungen geladen sind
- **THEN** zeigen alle 58 gültigen Zellen „–“ mit dem Namen „…: keine“, und über der Matrix steht keine Zahl unbewerteter Felder

#### Scenario: Details an einer Zelle ohne Bewertung
- **WHEN** eine Person mit Schreibrecht an einer Zelle ohne gespeicherte Bewertung „Details …“ wählt und eine Erläuterung speichert
- **THEN** wird die Zelle mit der Stufe „keine“ und der Erläuterung gespeichert

#### Scenario: Bewertungen laden noch
- **WHEN** die Matrix angezeigt wird, bevor die Bewertungen geladen sind
- **THEN** trägt keine Zelle einen Strich, und keine Zelle lässt sich bedienen

### Requirement: Ein nicht anwendbares Paar ist schraffiert
Eine Zelle, deren Paar aus Gefahr und Schutzobjekt nicht anwendbar ist, SHALL eine Schraffur in
der Farbrolle des Bedienrahmens tragen, ohne Text und ohne Knopf, mit dem zugänglichen Namen
„<Gefahr> × <Schutzobjekt>: nicht anwendbar“. Die Schraffur MUST gegen ihren Grund mindestens
3 : 1 erreichen, im Tag- und im Nachtbild. Die Legende MUST dieselbe Schraffur mit dem Wort
„nicht anwendbar“ zeigen; das Wort trägt die Aussage.

#### Scenario: Ungültige Zelle
- **WHEN** die Matrix eines Gebiets geladen ist
- **THEN** tragen die sieben nicht anwendbaren Zellen eine Schraffur ohne Text und ohne Knopf und heißen für Hilfstechnik „…: nicht anwendbar“

#### Scenario: Kontrast der Schraffur
- **WHEN** die Matrix im Tag- oder im Nachtbild gezeigt wird
- **THEN** erreicht die Schraffur in der Zelle und in der Legende mindestens 3 : 1 gegen ihren Grund

### Requirement: Beurteilung je Gefahrengebiet
Das Gefahrengebiet SHALL zeigen, ob und von wem seine Matrix beurteilt ist: „beurteilt <DTG> ·
<Name>“ oder „nicht beurteilt“, in der Gebietsliste als Zusatz „nicht beurteilt“. Eine Person mit
Schreibrecht im Modul Gefahren SHALL die Beurteilung mit „Beurteilung bestätigen“ setzen; ohne
Schreibrecht MUST der Knopf fehlen und der Server die Bestätigung mit 403 ablehnen. Jede
Bestätigung MUST Zeit und Person setzen und einen Systemeintrag „Beurteilung der Gefahrenmatrix in
«<Gebiet>» bestätigt.“ ins ETB schreiben. Ändert danach jemand eine Zelle, MUST die Beurteilung in
derselben Transaktion auf diese Zeit und Person wechseln. Eine Zelländerung an einem nie
beurteilten Gebiet MUST das Gebiet nicht beurteilen.

#### Scenario: Beurteilung bestätigen
- **WHEN** eine Person mit Schreibrecht in einem nicht beurteilten Gebiet „Beurteilung bestätigen“ wählt
- **THEN** steht am Gebiet „beurteilt <DTG> · <ihr Name>“, im ETB steht „Beurteilung der Gefahrenmatrix in «<Gebiet>» bestätigt.“, und andere Arbeitsplätze sehen den neuen Stand ohne Neuladen

#### Scenario: Beobachter
- **WHEN** eine Person ohne Schreibrecht im Modul Gefahren ein Gebiet öffnet
- **THEN** sieht sie „nicht beurteilt“ oder „beurteilt …“, aber keinen Knopf „Beurteilung bestätigen“

#### Scenario: Spätere Zelländerung
- **WHEN** in einem beurteilten Gebiet eine Person eine Zelle ändert
- **THEN** nennt die Beurteilung danach die Zeit dieser Änderung und diese Person

#### Scenario: Zelländerung ohne Beurteilung
- **WHEN** in einem nicht beurteilten Gebiet eine Zelle gesetzt wird
- **THEN** bleibt das Gebiet „nicht beurteilt“

### Requirement: Lagebild und Überblick nennen nicht beurteilte Gebiete
Das Paneel „Gefahren“ im Lagebild SHALL je Gefahr die höchste Stufe über „keine“ zeigen und in
seinem Fuß die nicht beurteilten Gebiete nennen: bis zwei mit Namen („<Gebiet>: nicht
beurteilt“), mehr als zwei als Zahl („<n> Gebiete nicht beurteilt“). Die Kennzahl „Warnstufe“ im
Überblick SHALL in ihrer Notiz die Zahl nicht beurteilter Gebiete nennen, wenn sie größer als
null ist.

#### Scenario: Ein Gebiet nicht beurteilt
- **WHEN** ein Einsatz zwei Gefahrengebiete hat und nur eines beurteilt ist
- **THEN** nennt der Fuß des Paneels „Gefahren“ das andere Gebiet mit „: nicht beurteilt“, und die Notiz der Kennzahl „Warnstufe“ nennt „1 nicht beurteilt“

#### Scenario: Alles beurteilt
- **WHEN** alle Gefahrengebiete beurteilt sind
- **THEN** trägt der Fuß des Paneels keinen Hinweis auf die Beurteilung
