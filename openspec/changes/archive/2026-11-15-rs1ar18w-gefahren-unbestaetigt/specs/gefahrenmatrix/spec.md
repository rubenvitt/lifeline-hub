# Spec Delta

## MODIFIED Requirements

### Requirement: Beurteilung je Gefahrengebiet
Das Gefahrengebiet SHALL zeigen, ob und von wem seine Matrix bestätigt ist: „bestätigt <DTG> ·
<Name>“ oder „unbestätigt“, in der Gebietsliste im Etikett der Stufe („<Stufe> · unbestätigt“). Eine
Person mit Schreibrecht im Modul Gefahren SHALL die Beurteilung mit „Beurteilung bestätigen“ setzen;
ohne Schreibrecht MUST der Knopf fehlen und der Server die Bestätigung mit 403 ablehnen. Jede
Bestätigung MUST Zeit und Person setzen und einen Systemeintrag „Beurteilung der Gefahrenmatrix in
«<Gebiet>» bestätigt.“ ins ETB schreiben. Ändert danach jemand eine Zelle, MUST die Beurteilung in
derselben Transaktion auf diese Zeit und Person wechseln. Eine Zelländerung an einem nie
bestätigten Gebiet MUST das Gebiet nicht bestätigen. Für eine offene Beurteilung MUST überall
dasselbe Wort „unbestätigt“ stehen, nie „nicht beurteilt“.

#### Scenario: Beurteilung bestätigen
- **WHEN** eine Person mit Schreibrecht in einem unbestätigten Gebiet „Beurteilung bestätigen“ wählt
- **THEN** steht am Gebiet „bestätigt <DTG> · <ihr Name>“, im ETB steht „Beurteilung der Gefahrenmatrix in «<Gebiet>» bestätigt.“, und andere Arbeitsplätze sehen den neuen Stand ohne Neuladen

#### Scenario: Beobachter
- **WHEN** eine Person ohne Schreibrecht im Modul Gefahren ein Gebiet öffnet
- **THEN** sieht sie „unbestätigt“ oder „bestätigt …“, aber keinen Knopf „Beurteilung bestätigen“

#### Scenario: Spätere Zelländerung
- **WHEN** in einem bestätigten Gebiet eine Person eine Zelle ändert
- **THEN** nennt die Beurteilung danach die Zeit dieser Änderung und diese Person

#### Scenario: Zelländerung ohne Beurteilung
- **WHEN** in einem unbestätigten Gebiet eine Zelle gesetzt wird
- **THEN** bleibt das Gebiet „unbestätigt“

#### Scenario: Druck eines unbestätigten Gebiets
- **WHEN** jemand die Gefahrenseite für ein unbestätigtes Gebiet mit Stufe hoch druckt
- **THEN** nennt der Druckkopf „Warnstufe hoch“ und „Beurteilung unbestätigt“

### Requirement: Lagebild und Überblick nennen nicht beurteilte Gebiete
Das Paneel „Gefahren“ im Lagebild SHALL je gesetzter Gefahr (Stufe über „keine“ oder mit
Erläuterung) die höchste Stufe zeigen und in seinem Fuß die unbestätigten Gebiete nennen: bis zwei
mit Namen („<Gebiet>: unbestätigt“), mehr als zwei als Zahl („<n> Gebiete unbestätigt“). Die
Kennzahl „Warnstufe“ im Überblick SHALL in ihrer Notiz die Zahl unbestätigter Gebiete nennen
(„<n> unbestätigt“), wenn sie größer als null ist.

#### Scenario: Ein Gebiet nicht beurteilt
- **WHEN** ein Einsatz zwei Gefahrengebiete hat und nur eines bestätigt ist
- **THEN** nennt der Fuß des Paneels „Gefahren“ das andere Gebiet mit „: unbestätigt“, und die Notiz der Kennzahl „Warnstufe“ nennt „1 unbestätigt“

#### Scenario: Drei Gebiete offen
- **WHEN** drei Gefahrengebiete unbestätigt sind
- **THEN** nennt der Fuß des Paneels „Gefahren“ „3 Gebiete unbestätigt“

#### Scenario: Alles beurteilt
- **WHEN** alle Gefahrengebiete bestätigt sind
- **THEN** trägt der Fuß des Paneels keinen Hinweis auf die Beurteilung

### Requirement: Die Gebietsliste sagt, was im Gebiet los ist
Jede Zeile der Gebietsliste SHALL neben Warnstufe und Namen bei einem bestätigten Gebiet die
Zahl seiner Gefahren über „keine“ (Gefahrentypen, nicht Zellen) und deren höchste Stufe zeigen
(„3 Gefahren · hoch“, „1 Gefahr · akut“, „0 Gefahren“). Bei einem unbestätigten Gebiet SHALL das
Etikett der Stufe Stufe und Zusatz zusammen tragen („hoch · unbestätigt“, „keine · unbestätigt“),
und die Zeile MUST keine Zahl und keinen zweiten Zusatz zeigen. Solange die Matrix eines Gebiets
nicht geladen ist, MUST die Zeile keine Zahl zeigen. Die Zahl der Zonen MUST beim Sprung zur Karte
stehen („Auf Karte zeigen ↗ · 1 Zone“), nicht in der Liste.

#### Scenario: Beurteiltes Gebiet mit Gefahren
- **WHEN** ein bestätigtes Gebiet Bewertungen über „keine“ für Brand (hoch und mittel) und Ertrinken (niedrig) trägt
- **THEN** zeigt seine Zeile „2 Gefahren · hoch“

#### Scenario: Nicht beurteiltes Gebiet
- **WHEN** ein Gebiet mit höchster Stufe hoch unbestätigt ist
- **THEN** trägt sein Etikett „hoch · unbestätigt“ in der Rolle der Stufe, und die Zeile zeigt keine Zahl und kein „nicht beurteilt“

#### Scenario: Unbestätigtes Gebiet ohne Gefahr
- **WHEN** ein unbestätigtes Gebiet keine Zelle über „keine“ trägt
- **THEN** trägt sein Etikett „keine · unbestätigt“, damit das offene Gebiet nicht wie eine Entwarnung aussieht
