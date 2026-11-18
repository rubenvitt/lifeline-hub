# status-darstellung Specification

## Purpose
Ein Zustand erscheint überall als derselbe randlose Baustein `Status` mit Wort, Tönung und
Formzeichen; eine Kennzeichnung als neutrale `Marke`. Ein Rahmen heißt bedienbar: nur der
Statusknopf trägt einen.

Herkunft: `openspec/changes/archive/2026-11-18-eon26eat-status-und-bedienung/`.

## Requirements

### Requirement: Ein Zustand hat eine Form

Jeder angezeigte Zustand eines Datensatzes (Status, Urteil, Lebenszyklus) SHALL als getönte
Fläche ohne Rahmen erscheinen, mit Formzeichen und Wort in der Farbe seiner Statusrolle, in einer
von genau zwei Größen. Er MUST NOT als farbiges Wort ohne Fläche oder als umrandetes Etikett
erscheinen. Die Sichtungskategorie bleibt als BBK-Feld ausgenommen.

#### Scenario: Derselbe FMS-Status an zwei Stellen
- **WHEN** ein Fahrzeug auf S2 im Meldebild und in der Fahrzeugliste ohne Schreibrecht angezeigt
  wird
- **THEN** hat der Status an beiden Stellen dieselbe Fläche, dasselbe Formzeichen und keinen Rahmen

#### Scenario: Urteil an einer Einheit
- **WHEN** eine Einheit „unterbesetzt“ ist
- **THEN** erscheint das Urteil in der Form eines Zustands in seiner Statusrolle, ohne Rahmen

#### Scenario: Wort ist Pflicht
- **WHEN** ein Zustand nur als Zahl oder Ziffer angezeigt wird
- **THEN** trägt er sein Wort für Vorleser und als Titel

### Requirement: Eine Kennzeichnung ist neutral und randlos

Eine Kennzeichnung ohne Zustand (Herkunft wie „ad-hoc“, Rolle wie „Einheitsführer“, Typ, Kennung)
SHALL als neutrale Marke ohne Rahmen erscheinen, ohne Formzeichen und ohne Statusfarbe. Ihre
Beschriftung MUST den Textboden halten (Tag ≥ 7 : 1, Nacht ≥ 5 : 1).

#### Scenario: Ad-hoc-Fahrzeug in der Nacht
- **WHEN** im Nachtmodus die Fahrzeugliste ein Ad-hoc-Fahrzeug zeigt
- **THEN** trägt es die Marke „ad-hoc“ neutral und randlos, und ihre Beschriftung misst gegen die
  Fläche mindestens 5 : 1

### Requirement: Rohes antd-Tag ist gesperrt

Außerhalb der Bausteine für Zustand und Marke MUST NOT Code das antd-`Tag` verwenden. Das Gate
MUST rot werden, wenn eine Datei es importiert.

#### Scenario: Neues rohes Tag
- **WHEN** eine Änderung in einer Seite `Tag` aus antd importiert
- **THEN** schlägt der Lint-Schritt fehl und nennt den Baustein, der stattdessen gilt

### Requirement: Rahmen heißt bedienbar

Ein Rahmen SHALL nur an etwas stehen, das man bedienen kann. Ein Zustand oder eine Marke, die
nichts auslöst, MUST NOT einen Rahmen tragen. Eine entfernbare Marke (etwa ein Filter) MUST einen
Rahmen tragen.

#### Scenario: Status mit und ohne Schreibrecht
- **WHEN** dieselbe Kraft einmal mit und einmal ohne Schreibrecht angezeigt wird
- **THEN** trägt ihr Status mit Schreibrecht einen Rahmen und einen Pfeil, ohne Schreibrecht weder
  Rahmen noch Pfeil

#### Scenario: Gesetzter Filter
- **WHEN** in der Kräfteübersicht ein Suchfilter gesetzt ist
- **THEN** trägt seine Marke einen Rahmen und ein Zeichen zum Entfernen

### Requirement: Der bedienbare Status ist ein Knopf

Ein Status, der ein Menü zum Wechseln öffnet, SHALL als getönter Knopf erscheinen: Fläche seiner
Statusrolle, Rahmen in der Kante dieser Rolle, Formzeichen, Wort in 14 px und ein Pfeil ▾. Seine
sichtbare Höhe MUST der Trefferfläche der Dichte entsprechen (kompakt 30 px, komfortabel 48 px,
Handschuh 72 px). Der Rahmen MUST gegen die umgebende Fläche und gegen die eigene Fläche im Tag-
und im Nachtmodus mindestens 3 : 1 halten; die Beschriftung hält den Textboden.

#### Scenario: Handschuh-Betrieb
- **WHEN** im Handschuh-Betrieb die Fahrzeugliste mit Schreibrecht angezeigt wird
- **THEN** ist der Statusknopf sichtbar 72 px hoch, nicht nur seine Trefferfläche

#### Scenario: Rahmen in der Nacht
- **WHEN** im Nachtmodus ein Fahrzeug auf S2 mit Schreibrecht angezeigt wird
- **THEN** misst der Rahmen des Statusknopfs gegen die Zeilenfläche und gegen seine eigene Fläche
  jeweils mindestens 3 : 1
