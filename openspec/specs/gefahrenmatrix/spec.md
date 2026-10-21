# gefahrenmatrix Specification

## Purpose
Darstellung der Gefahrenmatrix eines Gefahrengebiets (Gefahr × Schutzobjekt) und die Beurteilung
des Gebiets. Eine Zelle ohne Bewertung zeigt die Vorgabe „keine“. Ob jemand die Matrix angesehen
hat, zeigt die Beurteilung am Gebiet: „beurteilt <DTG> · <Name>“ oder „nicht beurteilt“. Das
schreibt die Entscheidung fort, dass eine offene Beurteilung nicht wie eine Entwarnung aussehen
darf: diese Aussage trägt jetzt „nicht beurteilt“ am Gebiet, nicht mehr eine leere Zelle.
Verdichtet (LLH-1102): die ganze Zelle ist das Bedienziel, die Zeilen stehen alphabetisch, und
die Gebietsliste nennt Gefahren und höchste Stufe.

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

### Requirement: Die ganze Zelle ist das Bedienziel
Jede gültige Zelle der Gefahrenmatrix SHALL in ihrer ganzen Fläche das Bedienziel sein: ein
Tipp oder Klick irgendwo in der Zelle MUST das Stufenmenü öffnen, nicht nur ein Tipp auf das
Kürzel. Die Zeilenhöhe der Matrix MUST der Steuerhöhe der Dichtestufe entsprechen (30 / 48 /
72 px), ohne zusätzliche senkrechte Tabellenpolsterung, und jede Zelle MUST in jeder Stufe auf
beiden Achsen mindestens die Steuerhöhe messen. Der Fokusring MUST an der Zelle stehen.

#### Scenario: Tipp in die Zellecke
- **WHEN** auf einem Touch-Gerät jemand mit Schreibrecht in die Ecke einer gültigen Zelle tippt
- **THEN** öffnet sich das Stufenmenü dieser Zelle

#### Scenario: Fükw kompakt
- **WHEN** die Matrix bei 1440 × 900 in der Stufe kompakt angezeigt wird
- **THEN** stehen alle 13 Zeilen ohne Bildlauf im Fenster

### Requirement: Gefahren stehen alphabetisch
Jede Anzeige, die Gefahrentypen listet, SHALL sie alphabetisch nach dem Anzeigenamen in
deutscher Kollation ordnen: die Matrix, das Paneel „Gefahrenmatrix“ im Lagebild, der
Matrixauszug der Sprungpalette und die Gefahrenauswahl der Schäden. Die Folge MUST aus EINER
Sortierfunktion kommen; die Reihenfolge des Backend-Katalogs MUST unverändert bleiben. Einen
Schalter für die Sortierung MUST es nicht geben.

#### Scenario: Reihenfolge der Matrix
- **WHEN** die Matrix eines Gefahrengebiets angezeigt wird
- **THEN** stehen die Zeilen in der Folge Absturz, Angstreaktion, Atemgifte, Atomare Strahlung, Ausbreitung, Brand, Chemische Stoffe, Durchbruch, Einsturz, Elektrizität, Erkrankung/Verletzung, Ertrinken, Explosion

#### Scenario: Lagebild
- **WHEN** im Lagebild mehrere Gefahren über „keine“ stehen
- **THEN** stehen sie in derselben alphabetischen Folge wie in der Matrix

### Requirement: Die Gebietsliste sagt, was im Gebiet los ist
Jede Zeile der Gebietsliste SHALL neben Warnstufe und Namen bei einem beurteilten Gebiet die
Zahl seiner Gefahren über „keine“ (Gefahrentypen, nicht Zellen) und deren höchste Stufe zeigen
(„3 Gefahren · hoch“, „1 Gefahr · akut“, „0 Gefahren“), bei einem nicht beurteilten Gebiet
„nicht beurteilt“. Solange die Matrix eines Gebiets nicht geladen ist, MUST die Zeile keine
Zahl zeigen. Die Zahl der Zonen MUST beim Sprung zur Karte stehen („Auf Karte zeigen ↗ ·
1 Zone“), nicht in der Liste.

#### Scenario: Beurteiltes Gebiet mit Gefahren
- **WHEN** ein beurteiltes Gebiet Bewertungen über „keine“ für Brand (hoch und mittel) und Ertrinken (niedrig) trägt
- **THEN** zeigt seine Zeile „2 Gefahren · hoch“

#### Scenario: Nicht beurteiltes Gebiet
- **WHEN** ein Gebiet nicht beurteilt ist
- **THEN** zeigt seine Zeile „nicht beurteilt“ und keine Zahl
