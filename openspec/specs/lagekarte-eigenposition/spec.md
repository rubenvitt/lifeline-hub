# lagekarte-eigenposition Specification

## Purpose
Zeigt auf der Lagekarte den Standort des eigenen Geräts, damit Führungs-Tablet und Handschirm die
eigene Lage im Verhältnis zu Einsatzstelle, Zonen und Kräften sehen — ohne den Standort zu teilen.

## Requirements

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

### Requirement: Eigenposition ohne sicheren Kontext
Ist die Seite nicht in einem sicheren Kontext geladen (Klartext-HTTP über eine andere Adresse als
`localhost`), SHALL der Knopf „Eigenposition" gesperrt erscheinen und MUST den Grund als lesbaren Text
nennen: beim Antippen bzw. Anklicken erscheint am Knopf eine kurze Erklärung, dass der Standort nur über
eine sichere Verbindung (https) verfügbar ist. Der Grund MUST zusätzlich als Beschreibung des Knopfs für
Vorlesesoftware verfügbar sein. Im gesperrten Zustand MUST keine Standortanfrage stattfinden.

#### Scenario: Klartext-HTTP
- **WHEN** die Lagekarte über Klartext-HTTP geöffnet ist und der Knopf „Eigenposition" angetippt wird
- **THEN** wird kein Standort angefragt, der Knopf ist als gesperrt ausgewiesen, und am Knopf steht als Text, dass der Standort nur über https verfügbar ist

### Requirement: Fehlerfälle der Standortermittlung
Liefert das Gerät keinen Standort, SHALL die Karte das sagen, statt still nichts zu tun, und der Knopf
MUST danach ausgeschaltet stehen:

- Das Gerät oder der Browser kennt keine Standortermittlung → Knopf gesperrt mit Grund als Text (wie
  beim fehlenden sicheren Kontext).
- Die Berechtigung wurde verweigert → Meldung, dass der Standortzugriff im Browser freigegeben werden
  muss.
- Kein Standort in angemessener Zeit oder Standort nicht verfügbar → Meldung, dass kein Standort
  ermittelt werden konnte.

#### Scenario: Berechtigung verweigert
- **WHEN** der Knopf eingeschaltet wird und der Standortzugriff verweigert wird
- **THEN** erscheint eine Meldung mit dem Hinweis auf die Browser-Freigabe, und der Knopf steht ausgeschaltet

#### Scenario: Kein Standort ermittelbar
- **WHEN** der Knopf eingeschaltet wird und das Gerät keinen Standort liefert
- **THEN** erscheint die Meldung, dass kein Standort ermittelt werden konnte, und der Knopf steht ausgeschaltet

### Requirement: Standort verlässt das Gerät nicht
Der eigene Standort MUST ausschließlich auf der Karte des eigenen Geräts dargestellt werden. Er MUST
weder an den Server übertragen noch im Browser gespeichert werden, und der eingeschaltete Zustand MUST
ein Neuladen der Seite nicht überdauern.

#### Scenario: Kein Netzverkehr und kein Speichereintrag
- **WHEN** die Eigenposition eingeschaltet ist und Standorte eintreffen
- **THEN** enthält keine Anfrage an den Server die Koordinaten, und im Browser-Speicher steht kein Standort

#### Scenario: Neuladen
- **WHEN** die Seite bei eingeschalteter Eigenposition neu geladen wird
- **THEN** ist die Eigenposition ausgeschaltet und es wird kein Standort angefragt

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
