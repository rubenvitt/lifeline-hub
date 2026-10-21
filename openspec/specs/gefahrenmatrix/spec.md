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

#### Scenario: Erläuterung an einer Zelle ohne Bewertung
- **WHEN** eine Person mit Schreibrecht an einer Zelle ohne gespeicherte Bewertung „Erläuterung …“ wählt und eine Erläuterung speichert
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
Das Paneel „Gefahren“ im Lagebild SHALL je gesetzter Gefahr (Stufe über „keine“ oder mit
Erläuterung) die höchste Stufe zeigen und in seinem Fuß die nicht beurteilten Gebiete nennen: bis zwei mit Namen („<Gebiet>: nicht
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

### Requirement: Eine Zelle mit Erläuterung ist erkennbar
Eine gültige Zelle mit Erläuterung SHALL ohne Öffnen als solche erkennbar sein: eine Marke in der
Zellecke als Zeichen (nicht nur Farbe) und ein zugänglicher Name, der auf „· mit Erläuterung“
endet. Die Legende MUST die Marke mit ihrem Wort nennen. „Erläuterung …“ MUST an jeder gültigen
Zelle erreichbar sein, auch an einer Zelle ohne Stufe.

#### Scenario: Marke an einer Zelle mit Erläuterung
- **WHEN** die Zelle Elektrizität × Menschen die Stufe „mittel“ und eine Erläuterung trägt
- **THEN** zeigt sie eine Marke in der Ecke und heißt „Bewertung Elektrizität × Menschen: mittel · mit Erläuterung“, und eine Zelle ohne Erläuterung trägt weder Marke noch Zusatz

### Requirement: Lagebild und Palettenauszug zeigen die Marke
Das Paneel „Gefahrenmatrix“ im Lagebild und der Matrixauszug der Sprungpalette SHALL dieselbe
Marke wie die Matrix tragen, mit dem Namenszusatz „· mit Erläuterung“, und ihre Zeilen aus den
gesetzten Gefahren bilden wie Lagekarte und Lagevortrag (Stufe über „keine“ oder mit
Erläuterung). Steht eine Marke, MUST darunter die Marke mit dem Wort „mit Erläuterung“ stehen.
Den Text der Erläuterung MUST keines von beiden zeigen. Die Gebietsliste MUST eine Erläuterung
zu „keine“ nicht als Gefahr zählen.

#### Scenario: Paneel mit Erläuterung
- **WHEN** im Lagebild Ertrinken × Menschen „mittel“ mit Erläuterung und Brand × Menschen „hoch“ ohne Erläuterung stehen
- **THEN** trägt die Zeile Ertrinken die Marke am Gefahrennamen und heißt „Ertrinken: mittel · mit Erläuterung“, die Zeile Brand trägt weder Marke noch Zusatz, und unter der Legende steht „mit Erläuterung“

#### Scenario: Paneel über mehrere Gebiete
- **WHEN** Brand in einem Gebiet „hoch“ ohne Erläuterung und in einem anderen „niedrig“ mit Erläuterung trägt
- **THEN** zeigt das Paneel eine Zeile Brand mit „hoch“ und der Marke

#### Scenario: Erläuterung zu „keine“
- **WHEN** die einzige Aussage zu Elektrizität eine Erläuterung bei Stufe „keine“ ist
- **THEN** stehen Paneel und Auszug mit einer Zeile Elektrizität und der Marke, und die Gebietsliste zählt Elektrizität nicht als Gefahr

#### Scenario: Auszug mit Erläuterung
- **WHEN** die Vorschau eines Gefahrengebiets geöffnet ist, dessen Zelle Elektrizität × Menschen „mittel“ mit Erläuterung trägt
- **THEN** trägt diese Zelle die Marke in der Ecke und heißt „Elektrizität × Menschen: mittel · mit Erläuterung“

### Requirement: Liste der Erläuterungen unter der Matrix
Unter der Matrix SHALL eine Liste „Erläuterungen“ je Zelle mit Erläuterung eine Zeile zeigen:
Gefahr × Schutzobjekt, Stufe, Erläuterung, „gemeldet von …“ (wenn gesetzt) und „geändert <DTG> ·
<Name>“, in der Folge der Matrix. Ohne Erläuterung MUST die Liste ganz entfallen. Ein Tipp auf
eine Zeile SHALL mit Schreibrecht den Dialog der Zelle öffnen und ohne Schreibrecht die Zelle in
der Matrix hervorheben.

#### Scenario: Liste der Erläuterungen
- **WHEN** zwei Zellen eines Gebiets eine Erläuterung tragen
- **THEN** stehen unter der Matrix genau diese zwei in der Folge der Matrix, je mit Stufe, Text und „geändert <DTG> · <Name>“

#### Scenario: Keine Erläuterung
- **WHEN** keine Zelle eines Gebiets eine Erläuterung trägt
- **THEN** steht unter der Matrix keine Liste „Erläuterungen“

#### Scenario: Tipp ohne Schreibrecht
- **WHEN** eine Person ohne Schreibrecht eine Zeile der Liste „Erläuterungen“ antippt
- **THEN** wird die Zelle in der Matrix hervorgehoben, und kein Dialog öffnet sich

### Requirement: Die Gefahrenseite druckt das gewählte Gebiet
Die Gefahrenseite SHALL das gewählte Gebiet drucken („Drucken / als PDF“, auch ohne Schreibrecht,
mit geladener Matrix): Druckkopf mit Gebiet, Warnstufe und Beurteilung, Legende, Matrix und die
Liste „Erläuterungen“ wie am Schirm. Ohne Erläuterung MUST der Teil auch im Druck entfallen. Die
Marke „mit Erläuterung“ MUST schwarz-weiß erkennbar sein. Gebietsliste und Bedienung MUST auf dem
Blatt fehlen.

#### Scenario: Druck mit Erläuterungen
- **WHEN** ein Gebiet gedruckt wird, dessen Zellen Brand × Sachwerte („keine“) und Elektrizität × Menschen („hoch“) eine Erläuterung tragen
- **THEN** stehen auf dem Blatt die Matrix mit schwarzer Marke an beiden Zellen und darunter „Erläuterungen“ mit erst Brand × Sachwerte, dann Elektrizität × Menschen, je mit Stufe, Text und „geändert <DTG> · <Name>“

#### Scenario: Druck ohne Erläuterung
- **WHEN** ein Gebiet ohne Erläuterung gedruckt wird
- **THEN** steht auf dem Blatt die Matrix, aber kein Teil „Erläuterungen“

#### Scenario: Druck ohne Schreibrecht
- **WHEN** eine Person ohne Schreibrecht die Gefahrenseite eines Gebiets mit geladener Matrix öffnet
- **THEN** steht „Drucken / als PDF“ zur Wahl, und das Blatt zeigt weder Gebietsliste noch „Umbenennen“ oder „Beurteilung bestätigen“

### Requirement: Gefahren eines Gebiets auf der Lagekarte
Der Inspector einer Zone vom Typ Gefahrengebiet SHALL die gesetzten Gefahren seines Gebiets zeigen
(Stufe über „keine“ oder mit Erläuterung), je mit Stufe, Gefahr × Schutzobjekt und Erläuterung, in
der Folge der Matrix, höchstens fünf und darunter den Sprung „alle in Gefahren ↗“. Bei gesperrtem
Modul Gefahren oder gesichertem Stand MUST der Abschnitt fehlen und die Matrix ungefragt bleiben;
eine nicht ladbare Matrix MUST der Abschnitt nennen.

#### Scenario: Gebiet mit Gefahren
- **WHEN** eine Person mit Freigabe Gefahren eine Zone eines Gebiets wählt, dessen Matrix Elektrizität × Menschen „hoch“ mit Erläuterung trägt
- **THEN** nennt der Inspector unter „Gefahren“ diese Zelle mit „hoch“ und der Erläuterung

#### Scenario: Gefahren gesperrt
- **WHEN** das Modul Gefahren für die Person gesperrt ist und sie eine Zone vom Typ Gefahrengebiet wählt
- **THEN** zeigt der Inspector keinen Abschnitt „Gefahren“, und die Matrix wird nicht abgefragt

#### Scenario: Mehr als fünf
- **WHEN** ein Gebiet sechs gesetzte Gefahren trägt
- **THEN** zeigt der Inspector fünf davon und den Sprung „alle in Gefahren ↗“ zur Gefahrenseite des Gebiets
