# grossbild-ansicht Specification

## Purpose
Legt fest, wie eine Lageseite am Bedienplatz als Großbild für Beamer und Wandschirm gezeigt wird:
lesbar aus 2–3 m, nur zum Ansehen, mit denselben Zahlen wie die Seite selbst.

## Requirements

### Requirement: Einstieg

Die Seiten Lagebild und Lagebesprechung SHALL ab Tablet-Breite (`md`) im Seitenkopf eine Aktion
„Großbild“ anbieten, für jede Person, die die Seite sehen darf, auch ohne Schreibrecht. Auf dem
Handy fehlt sie. Sie MUST die Großbild-Ansicht der
Seite bildschirmfüllend zeigen, ohne Kopfleiste, Rail, Modulpanel und Seitenkopf, und dabei Vollbild
und Bildschirm-Wachhalten anfordern. Lehnt der Browser beides ab, MUST die Ansicht trotzdem das
ganze Fenster füllen.

#### Scenario: Großbild öffnen

- **WHEN** eine Person im Lagebild „Großbild“ wählt
- **THEN** füllt das Lagebild den Bildschirm im Vollbild, ohne Kopfleiste und Rail

#### Scenario: Ohne Schreibrecht

- **WHEN** eine Person ohne Schreibrecht die Seite Lagebesprechung öffnet
- **THEN** steht die Aktion „Großbild“ bereit

### Requirement: Ausstieg

Die Großbild-Ansicht SHALL mit „Großbild verlassen“, mit der Taste Esc und beim Verlassen des
Vollbilds enden und auf die normale Seite an derselben Stelle zurückführen. Ein Neuladen MUST die
normale Seite zeigen. Die Ansicht MUST NOT in der Adresse, im Browserspeicher oder am Gerät
festgehalten werden.

#### Scenario: Vollbild mit Esc verlassen

- **WHEN** die Person im Großbild Esc drückt
- **THEN** endet das Vollbild, und die normale Seite Lagebild steht wieder da

#### Scenario: Browser ohne Vollbild

- **WHEN** der Browser kein Vollbild kennt und die Person „Großbild“ wählt
- **THEN** füllt die Großbild-Ansicht das Browserfenster, und „Großbild verlassen“ führt zurück

### Requirement: Nur Ansehen

Die Großbild-Ansicht SHALL nur zeigen. Kennzahlen, Zeilen und Paneele MUST NOT in ein Modul führen
und MUST NOT Daten ändern; es gibt keine Schnellwahl, keine Übernahme und keinen Abschluss. Die
einzigen Bedienelemente MUST „Großbild verlassen“ und, solange das Vollbild nicht aktiv ist,
„Vollbild“ sein. Tastenkürzel der App (etwa die Sprungpalette) MUST NOT im Großbild wirken.

#### Scenario: Klick auf eine Kennzahl

- **WHEN** jemand im Großbild des Lagebilds auf die Kennzahl „Betroffene“ klickt
- **THEN** bleibt die Großbild-Ansicht stehen, und es öffnet sich kein Modul

#### Scenario: Sprungpalette im Großbild

- **WHEN** jemand im Großbild Strg+K drückt
- **THEN** öffnet sich keine Sprungpalette, und das Großbild bleibt stehen

#### Scenario: Vollbild nachholen

- **WHEN** der Browser das Vollbild beim Öffnen abgelehnt hat und die Ansicht das Fenster füllt
- **THEN** bietet die Ansicht „Vollbild“ an, und ein Klick fordert es erneut an

### Requirement: Lesbar aus der Entfernung

Die Großbild-Ansicht SHALL bei 1920 × 1080 jede führende Zahl mindestens 72 px und jeden Text
mindestens 28 px hoch zeigen, Kontrast nach `farbrollen-kontrast`. Die Größen MUST mit dem Fenster
im selben Verhältnis wachsen und schrumpfen, sodass bei 1280 × 720 und bei 3840 × 2160 dieselbe
Aufteilung ohne Bildlauf erscheint. Die Ansicht MUST NOT einen Bildlauf brauchen, um ihren Inhalt
zu zeigen. Ein Wert MUST direkt neben oder unter seiner Bezeichnung stehen, nie am anderen Rand
der Fläche.

#### Scenario: Kennzahl bei Full HD

- **WHEN** das Großbild des Lagebilds bei 1920 × 1080 die Zahl der Betroffenen zeigt
- **THEN** ist die Zahl mindestens 72 px hoch, und ihre Bezeichnung mindestens 28 px

#### Scenario: Beamer mit 1280 × 720

- **WHEN** das Großbild der Lagebesprechung in einem Fenster von 1280 × 720 läuft
- **THEN** sind Termin und alle Zeilen der Vorbereitung ohne Bildlauf sichtbar

### Requirement: Dieselben Zahlen wie die Seite

Die Großbild-Ansicht SHALL jede Zahl aus derselben Zusammenstellung beziehen wie die normale Seite
und MUST zur selben Zeit denselben Wert zeigen. Sie MUST sich live aktualisieren wie die Seite und
den Datenstand mit Alter nennen. Ist das Netz weg oder der Live-Kanal getrennt oder im Wiederaufbau, MUST sie das
zeigen, wie die Kopfleiste, die sie verdeckt. Eine gesperrte Quelle MUST als „—“ mit Grund erscheinen, eine
ladende oder gescheiterte als solche, nie als 0.

#### Scenario: Neue Betroffene während der Präsentation

- **WHEN** eine andere Person einen Betroffenen aufnimmt, während das Großbild des Lagebilds läuft
- **THEN** steigt die Zahl der Betroffenen im Großbild ohne Neuladen auf denselben Wert wie auf der
  normalen Seite

#### Scenario: Nachforderungen nicht freigegeben

- **WHEN** die Person das Modul Nachforderungen nicht sehen darf
- **THEN** zeigt das Großbild der Lagebesprechung bei „Nachforderungen offen“ „—“ mit „nicht
  freigegeben“

### Requirement: Inhalt des Großbilds im Lagebild

Das Großbild des Lagebilds SHALL zeigen: die Uhr in der Form der Uhr im Kopf und den Datenstand mit Alter (Spec
`zeitdarstellung`), die sechs
Kennzahlen der Reihe des Einsatzes, die Gefahrenmatrix verdichtet je Gefahrentyp (in der Reihe
„Sanitätsdienst“ statt dessen den Verlauf), die Sichtungsverteilung und den Stand (Lagebericht,
UHS aktiv). Aufträge und Meldungen MUST NOT im Großbild des Lagebilds stehen; ihre Heimat ist der
Überblick (`lage-alarmzeile`, Seitenrollen). Die jüngsten ETB-Einträge MUST NOT im Großbild
stehen. Töne der Kennzahlen (Alarm, Achtung) MUST dieselben sein wie auf der Seite.

#### Scenario: Vermisste Person

- **WHEN** eine Person als vermisst geführt wird
- **THEN** steht „Vermisste“ im Großbild in Alarmrolle wie auf der Seite

#### Scenario: Überfälliger Auftrag

- **WHEN** ein Auftrag überfällig ist
- **THEN** steht weder „Aufträge offen“ noch „Meldungen offen“ im Großbild des Lagebilds

#### Scenario: Uhr und Stand im Großbild

- **WHEN** das Großbild des Lagebilds um 17:33 in taktischer Darstellung läuft und der letzte Stand von 17:31 stammt
- **THEN** steht dort die Uhr „1733“ und „Stand 1731 · vor 2 min“

### Requirement: Inhalt des Großbilds in der Lagebesprechung

Das Großbild der Lagebesprechung SHALL den Termin der nächsten Besprechung mit seinem Zustand
(„in 25 min“, „jetzt fällig“, „seit 5 min überfällig“ im Ton nach `lagebesprechung-vorbereitung`)
und die Zeilen der Vorbereitung in deren Reihenfolge zeigen, je Zeile Bezeichnung, Wert und Notiz,
sowie den Stand der Vorbereitung. Die Quellenangabe je Zeile MUST NOT im Großbild stehen; sie
bleibt in der normalen Ansicht und in der Übernahme in einen Lagebericht.

#### Scenario: Termin überfällig im Großbild

- **WHEN** der Termin seit 5 Minuten verstrichen ist
- **THEN** zeigt das Großbild „seit 5 min überfällig“ im Ton `achtung`

### Requirement: Alarme und Übung im Großbild

Liegen Einträge in der Alarmzone, SHALL die Großbild-Ansicht ihre Zahl zeigen, ohne Titel und
ohne Personenbezug: Alarme in Alarmrolle („2 Alarme offen“), Hinweise in Bedienrolle („1 Hinweis
offen“); bearbeitet werden sie nach dem Verlassen. Ist der
Einsatz eine Übung, MUST das Großbild die Übungsmarke tragen, wie auf jeder Seite des Einsatzes.

#### Scenario: Alarm während der Präsentation

- **WHEN** während des Großbilds eine Alarmmeldung eingeht
- **THEN** zeigt das Großbild „1 Alarm offen“ in Alarmrolle, und nach dem Verlassen steht der
  Eintrag in der Alarmzone

#### Scenario: Übung

- **WHEN** der Einsatz eine Übung ist
- **THEN** trägt das Großbild die Übungsmarke
