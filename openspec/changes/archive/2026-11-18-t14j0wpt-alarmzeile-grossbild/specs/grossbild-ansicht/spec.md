# Spec Delta

## MODIFIED Requirements

### Requirement: Inhalt des Großbilds im Lagebild

Das Großbild des Lagebilds SHALL zeigen: ganz oben die Alarmzeile „Was brennt“ mit denselben
Einträgen in derselben Folge wie auf der Seite, die Uhrzeit des Lagebilds und den Datenstand, die
sechs Kennzahlen der Reihe des Einsatzes, die Gefahrenmatrix verdichtet je Gefahrentyp (in der
Reihe „Sanitätsdienst“ statt dessen den Verlauf), die Sichtungsverteilung und den Stand
(Lagebericht, UHS aktiv). Die Alarmzeile MUST ohne Sprünge stehen; was nicht in die Breite passt,
steht als „+n“ ohne Liste. Die Kennzahlen „Aufträge offen“ und „Meldungen offen“ MUST NOT im
Großbild des Lagebilds stehen; ihre Heimat ist der Überblick (`lage-alarmzeile`, Seitenrollen),
ihr Überfällig-Signal trägt die Alarmzeile. Die jüngsten ETB-Einträge MUST NOT im Großbild
stehen. Töne der Kennzahlen (Alarm, Achtung) MUST dieselben sein wie auf der Seite.

#### Scenario: Vermisste Person

- **WHEN** eine Person als vermisst geführt wird
- **THEN** steht „Vermisste“ im Großbild in Alarmrolle wie auf der Seite, und die Alarmzeile des
  Großbilds zeigt „1 vermisst“ in Alarmrolle

#### Scenario: Überfälliger Auftrag

- **WHEN** ein Auftrag überfällig ist
- **THEN** zeigt die Alarmzeile des Großbilds „1 Auftrag überfällig“ in Alarmrolle, und weder
  „Aufträge offen“ noch „Meldungen offen“ steht im Großbild des Lagebilds

#### Scenario: Neuer Eintrag während der Präsentation

- **WHEN** während des Großbilds eine Sofortmeldung eingeht
- **THEN** erscheint ihr Eintrag ohne Neuladen in der Alarmzeile des Großbilds wie auf der Seite,
  und der Inhalt darunter verschiebt sich nicht

#### Scenario: Zu viele Einträge im Großbild

- **WHEN** mehr Arten vorliegen, als in die Breite des Großbilds passen
- **THEN** zeigt die Zeile die vorderen Einträge und „+n“, und „+n“ öffnet keine Liste

#### Scenario: Alarmzeile auf dem Beamer

- **WHEN** das Großbild des Lagebilds in einem Fenster von 1280 × 720 läuft
- **THEN** ist der Text der Alarmzeile zwei Drittel so groß wie bei 1920 × 1080, und die Fläche
  braucht keinen Bildlauf

### Requirement: Inhalt des Großbilds in der Lagebesprechung

Das Großbild der Lagebesprechung SHALL den Termin der nächsten Besprechung mit seinem Zustand
(„in 25 min“, „jetzt fällig“, „seit 5 min überfällig“ im Ton nach `lagebesprechung-vorbereitung`)
und die Zeilen der Vorbereitung in deren Reihenfolge zeigen, je Zeile Bezeichnung, Wert und Notiz,
sowie den Stand der Vorbereitung. Die Quellenangabe je Zeile MUST NOT im Großbild stehen; sie
bleibt in der normalen Ansicht und in der Übernahme in einen Lagebericht. Die Alarmzeile „Was
brennt“ MUST NOT im Großbild der Lagebesprechung stehen, denn ihre Seite zeigt sie nicht.

#### Scenario: Termin überfällig im Großbild

- **WHEN** der Termin seit 5 Minuten verstrichen ist
- **THEN** zeigt das Großbild „seit 5 min überfällig“ im Ton `achtung`

#### Scenario: Überfälliger Auftrag in der Lagebesprechung

- **WHEN** ein Auftrag überfällig ist und das Großbild der Lagebesprechung läuft
- **THEN** steht er in der Zeile der Vorbereitung wie im Paneel, und das Großbild zeigt keine
  Alarmzeile
