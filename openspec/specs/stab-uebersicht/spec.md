# stab-uebersicht Specification

## Purpose
Die Stab-Seite als Übersicht der Stabsfunktionen S1–S6: wer welches Sachgebiet führt, was dort
offen ist und wie man mit einem Klick in die Arbeit des Sachgebiets kommt.

## Requirements

### Requirement: Raster der Sachgebiete
Die Stab-Seite SHALL je Sachgebiet S1–S6 eine Kachel zeigen, in der festen Reihenfolge S1 bis S6.
Das Raster MUST unter `md` eine Spalte, ab `md` zwei und ab `xl` drei Spalten haben, und die Seite
MUST bei 390 px Breite ohne waagerechten Überlauf bleiben. Jede Kachel SHALL tragen:
- als Überschrift die Kennung und das wirksame Label der Organisation („S4 · Versorgung (Logistik)“),
- die Besetzung als Statuschip mit Wort, ungekürzt (ein langer Name oder Zusatz bricht um),
- die Aufgaben des Sachgebiets gekürzt auf eine Zeile mit der Fundstelle „FwDV 100 Anl. 2, S. n“,
- die Werkzeuge des Sachgebiets.

Die Fundstelle MUST sichtbar sein, auch ohne Zeiger. Den vollen Aufgabentext trägt die Hilfe.
Die Kachel selbst MUST NOT klickbar sein. Bedienziele sind nur ihre Aktion und ihre Werkzeuge.

#### Scenario: Sechs Kacheln
- **WHEN** eine Person mit Leserecht auf den Stab die Stab-Seite öffnet
- **THEN** stehen sechs Kacheln S1 bis S6 in dieser Reihenfolge, jede mit Überschrift, Besetzung,
  Aufgabenzeile mit Fundstelle und Werkzeugen

#### Scenario: Mandantenlabel
- **WHEN** die Organisation das Label von `s4` auf „Versorgung (Logistik)“ gesetzt hat
- **THEN** heißt die Kachel „S4 · Versorgung (Logistik)“

#### Scenario: Handy
- **WHEN** die Stab-Seite auf 390 px Breite geöffnet wird
- **THEN** stehen die Kacheln untereinander, und die Seite läuft nicht waagerecht über

### Requirement: Besetzung je Kachel
Jede Kachel SHALL die Besetzung ihres Sachgebiets zeigen: nicht vergeben, bei der Einsatzleitung,
Name, extern oder rückwärtig. Solange die Besetzung nicht geladen ist, MUST die Kachel nichts über
sie behaupten. Scheitert das Laden ohne vorhandenen Stand, MUST an Stelle des Rasters ein Fehler mit
Wiederholen stehen und keine Kachel „nicht vergeben“ zeigen. Scheitert ein erneuter Abruf mit
vorhandenem Stand, MUST die Seite den Stand als veraltet kennzeichnen.

Mit Schreibrecht SHALL jede Kachel die Aktion „Besetzung ändern“ tragen. Ihr zugänglicher Name MUST
Kennung und Label des Sachgebiets enthalten („Besetzung ändern – S4 Versorgung“). Ohne Schreibrecht
MUST die Aktion fehlen, und der Seitenhinweis MUST den Grund nennen.

Der Seitenkopf SHALL den Besetzungsstand als Meta zeigen („4/6 besetzt“), sobald die Besetzung
geladen ist. Als besetzt zählt jedes Sachgebiet, das nicht „nicht vergeben“ ist.

#### Scenario: Besetzung ändern
- **WHEN** eine Person mit Schreibrecht in der Kachel S4 auf „Besetzung ändern“ tippt
- **THEN** öffnet sich der Dialog der Besetzung von S4

#### Scenario: Nur Ansicht
- **WHEN** ein Beobachter die Stab-Seite öffnet
- **THEN** trägt keine Kachel die Aktion „Besetzung ändern“, und der Seitenhinweis nennt den Grund

#### Scenario: Laden scheitert
- **WHEN** die Besetzung nicht geladen werden kann und kein Stand vorliegt
- **THEN** steht ein Fehler mit Wiederholen, und keine Kachel zeigt „nicht vergeben“

#### Scenario: Besetzungsstand
- **WHEN** vier von sechs Sachgebieten besetzt sind
- **THEN** zeigt der Seitenkopf „4/6 besetzt“

### Requirement: Werkzeuge je Sachgebiet
Jede Kachel SHALL ihre Werkzeuge als gleich große Bedienziele zeigen, die mindestens die
Trefffläche der Dichtestufe halten. Die Werkzeuge sind:
- S1: Personal, Einheiten, Bereitstellungsräume, Nachforderungen
- S2: Lagekarte, Lagemeldungen, Einsatztagebuch
- S3: Einsatzabschnitte, Aufträge, Meldungen
- S4: Nachforderungen, Verpflegung, Material
- S5: Pressearbeit, Informationstelefon
- S6: Funkplan, Fernmeldeskizze, Sprechgruppen, Kommunikationsplan

Ein Werkzeug trägt den Namen seines Moduls bzw. seiner Unterseite, wie Modulmenü und Sprungpalette
ihn zeigen. Die Zahl der Werkzeuge je Kachel ist nicht begrenzt. Ein Werkzeug MUST die Freigabe seines Ziels
übernehmen: Ist das Ziel für die Person ausgeblendet, MUST das Werkzeug fehlen. Ist es gesperrt,
MUST das Werkzeug gesperrt mit sichtbarem Grund stehen, ohne zu springen und ohne Zahl. Solange die
Freigaben nicht ermittelt sind, MUST kein Werkzeug als Sprung erscheinen.

#### Scenario: Nachforderungen bei S1 und S4
- **WHEN** das Modul Nachforderungen für die Person frei ist
- **THEN** führen die Kacheln S1 und S4 je ein Werkzeug „Nachforderungen“ in dasselbe Modul

#### Scenario: Modul gesperrt
- **WHEN** das Modul Einheiten für die Person gesperrt ist
- **THEN** steht „Einheiten“ in der Kachel S1 gesperrt mit Grund, ein Tipp springt nicht, und es
  steht keine Zahl daran

#### Scenario: Modul ausgeblendet
- **WHEN** das Modul Verpflegung ausgeblendet ist
- **THEN** fehlt „Verpflegung“ in der Kachel S4

### Requirement: Zustandszahl je Werkzeug aus ihrer Heimat
Ein Werkzeug SHALL höchstens eine Zahl zeigen, und nur aus einer Quelle, die die Zahl schon führt.
Die Stab-Seite MUST NOT selbst zählen:
- Ein Modul, für das das Modulmenü einen Zähler führt, zeigt dieselbe Zahl mit derselben Bedeutung.
  Aufträge zeigen die offenen und nennen die überfälligen darunter. Sind Aufträge überfällig, MUST
  die Zahl als Achtung gekennzeichnet sein, mit Wort, nicht nur mit Farbe.
- „Pressearbeit“ zeigt die offenen Presseanfragen aus den Kennzahlen des Presse-Logs.
- „Funkplan“ zeigt die Zahl der Funkplan-Lücken, dieselbe wie im Kopf des Lücken-Paneels im
  Funkplan.
- Ein Werkzeug ohne solche Quelle zeigt keine Zahl.

Eine Null MUST als „0“ stehen. Fehlt die Quelle einer Zahl, MUST das Werkzeug zeigen, warum, und
MUST NOT „0“ zeigen: nicht freigegeben „—“ mit Grund, nicht geladen einen unbekannten Stand mit
Grund (auch ohne Netz, wenn die Quelle nicht vorgehalten wird), im Laden den Ladezustand. Jede Zahl MUST live dem Stand ihrer Quelle folgen, ohne Neuladen der Seite.

#### Scenario: Überfällige Aufträge
- **WHEN** zwei Aufträge offen sind, einer davon überfällig
- **THEN** zeigt „Aufträge“ in der Kachel S3 „2“ als Achtung und nennt „1 überfällig“

#### Scenario: Nachforderungen aus dem Modulzähler
- **WHEN** drei Nachforderungen offen sind, eine davon unterwegs
- **THEN** zeigt „Nachforderungen“ bei S1 und bei S4 „3“ und nennt „1 unterwegs“

#### Scenario: Ohne Quelle keine Zahl
- **WHEN** die Kachel S5 das Informationstelefon führt
- **THEN** zeigt „Informationstelefon“ keine Zahl

#### Scenario: Quelle nicht geladen
- **WHEN** der Abruf der Modulzähler scheitert
- **THEN** zeigen die Werkzeuge mit Modulzahl einen unbekannten Stand, keine „0“

#### Scenario: Presseanfragen
- **WHEN** im Presse-Log zwei Anfragen offen sind
- **THEN** zeigt „Pressearbeit“ in der Kachel S5 „2“

#### Scenario: Lücken im Funkplan
- **WHEN** der Funkplan in seinem Lücken-Paneel drei Lücken zählt
- **THEN** zeigt „Funkplan“ in der Kachel S6 „3“

#### Scenario: Live
- **WHEN** auf einem anderen Arbeitsplatz ein Auftrag erledigt wird
- **THEN** sinkt die Zahl an „Aufträge“ ohne Neuladen der Stab-Seite
