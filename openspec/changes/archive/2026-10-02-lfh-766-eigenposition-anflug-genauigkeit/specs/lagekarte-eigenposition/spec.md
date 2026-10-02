## MODIFIED Requirements

### Requirement: Eigenposition ein- und ausschalten
Die Lagekarte SHALL im Knopfblock der Karte einen Umschalter „Eigenposition" anbieten. Eingeschaltet
MUST die Karte den Gerätestandort als Punkt mit einem Kreis in der Größe der gemeldeten Genauigkeit
zeigen und beide bei jeder neuen Standortmeldung nachführen. Beim ersten Standort nach dem Einschalten
MUST die Karte einmal so anfliegen, dass der Genauigkeitskreis vollständig im Bild steht; bei genauer
Ortung MUST sie dabei nicht näher heranzoomen als bis zum Anflugzoom der übrigen Kartenziele. Wurde die
Karte seit dem Einschalten bedient — von Hand verschoben oder gezoomt, ein Ort angesteuert oder ein
Zeichen-, Platzier- oder Messmodus benutzt —, MUST der Anflug entfallen und der Ausschnitt bleiben, wo er
ist. Nach dem ersten Standort MUST die Karte der Position nicht folgen, damit der Ausschnitt frei
verschiebbar bleibt. Ausgeschaltet MUST der Punkt verschwinden und das Gerät keine weiteren Standorte
mehr anfragen. Der eingeschaltete Zustand MUST am Knopf als gedrückt erkennbar sein. Der Knopf steht
auch ohne Schreibrecht zur Verfügung.

#### Scenario: Einschalten zeigt und fliegt an
- **WHEN** der Knopf „Eigenposition" eingeschaltet wird, die Karte bis zum ersten Standort nicht bedient wird und das Gerät einen Standort liefert
- **THEN** erscheint der eigene Punkt mit Genauigkeitskreis, die Karte fliegt einmal dorthin, und der Knopf ist als gedrückt markiert

#### Scenario: Grobe Ortung steht vollständig im Bild
- **WHEN** der Knopf eingeschaltet wird und der erste Standort eine Genauigkeit von 2 km meldet
- **THEN** steht der Genauigkeitskreis nach dem Anflug vollständig im sichtbaren Kartenausschnitt

#### Scenario: Genaue Ortung zoomt nicht näher als bisher
- **WHEN** der Knopf eingeschaltet wird und der erste Standort eine Genauigkeit von wenigen Metern meldet
- **THEN** fliegt die Karte den Punkt an und zoomt dabei nicht näher als bis zum Anflugzoom der übrigen Kartenziele

#### Scenario: Bedienung vor dem ersten Standort verhindert den Anflug
- **WHEN** der Knopf eingeschaltet ist, die Karte vor dem ersten Standort von Hand verschoben oder gezoomt wird und danach der erste Standort eintrifft
- **THEN** erscheint der Punkt mit Genauigkeitskreis, und der Kartenausschnitt bleibt, wo er ist

#### Scenario: Kartenmodus vor dem ersten Standort verhindert den Anflug
- **WHEN** der Knopf eingeschaltet ist, vor dem ersten Standort ein Zeichen-, Platzier- oder Messmodus begonnen wird und danach der erste Standort eintrifft
- **THEN** erscheint der Punkt mit Genauigkeitskreis, und der Kartenausschnitt bleibt, wo er ist

#### Scenario: Neue Position führt nach, ohne die Karte zu verschieben
- **WHEN** der Knopf eingeschaltet ist, die Karte von Hand verschoben wurde und das Gerät einen neuen Standort meldet
- **THEN** wandert der Punkt an den neuen Standort, und der Kartenausschnitt bleibt, wo er ist

#### Scenario: Ausschalten
- **WHEN** der eingeschaltete Knopf erneut betätigt wird
- **THEN** verschwindet der Punkt, und es werden keine Standorte mehr angefragt

#### Scenario: Kartengrundlage wechseln
- **WHEN** die Eigenposition eingeschaltet ist und die Kartengrundlage gewechselt wird
- **THEN** stehen Punkt und Genauigkeitskreis danach weiter auf der Karte

## ADDED Requirements

### Requirement: Eigenposition verdeckt keine laufende Zeichnung
Punkt und Genauigkeitskreis der Eigenposition SHALL über den Lagedaten der Karte (Marker, Flächen,
Fachebenen, Suchnadel) liegen, MUST aber unter der Figur liegen, die gerade gezeichnet oder gemessen
wird, samt ihren Stützpunkten. Das MUST auch gelten, wenn während des Zeichnens neue Standorte
eintreffen.

#### Scenario: Zeichnen am eigenen Standort
- **WHEN** die Eigenposition eingeschaltet ist und am eigenen Standort eine Fläche gezeichnet wird, während weitere Standortmeldungen eintreffen
- **THEN** bleiben die gesetzten Stützpunkte und die Linie der Figur über dem eigenen Punkt sichtbar

#### Scenario: Eigenposition über den Lagedaten
- **WHEN** die Eigenposition eingeschaltet ist und an ihrem Standort ein Marker oder eine Suchnadel steht
- **THEN** liegt der eigene Punkt über ihnen
