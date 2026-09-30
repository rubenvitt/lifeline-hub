# sprungpalette Specification

## Purpose
Öffnungswege der Sprungpalette (Strg/⌘+K). Diese Spec legt fest, wie die markierte Zeile
außer mit ↵ geöffnet wird: in einem neuen Browser-Tab oder als Lese-Vorschau in der Palette.
Außerdem regelt sie, welche Fußhinweise diese Wege ankündigen.

## Requirements

### Requirement: Strg/⌘+↵ öffnet das Ziel in einem neuen Tab
Die Palette SHALL auf Strg+↵ (unter macOS ⌘+↵) das Navigationsziel der markierten Zeile in
einem neuen Browser-Tab öffnen, die Palette schließen und die aktuelle Seite unverändert
lassen. Das gilt für jede Zeile mit Navigationsziel. Ein Navigationsziel haben Datensätze,
der ETB-Sammeltreffer, die Koordinate, Module, Zuletzt-Einträge, Schnellaktionen,
Einsatzwechsel, Navigationseinträge und Gedächtniszeilen. Hat die markierte Zeile kein
Navigationsziel (Aktionen, Einstellungen, Abmelden), MUST die Taste wirkungslos bleiben:
Sie führt die Zeile nicht aus, schließt die Palette nicht und löst keine
Anwendungs-Tastaturaktion aus. Die Zeile MUST sich in beiden Fällen gleich merken lassen:
Befehlsgedächtnis und Modulgedächtnis zeichnen die Öffnung in einem neuen Tab genauso auf
wie ein ↵.

#### Scenario: Datensatz im neuen Tab
- **WHEN** eine Person als Treffer markiert ist und Strg+↵ gedrückt wird
- **THEN** öffnet sich ihre Detailseite in einem neuen Tab, die Palette schließt sich und die aktuelle Route bleibt unverändert

#### Scenario: Zeile ohne Ziel
- **WHEN** die Aktion „Speichern“ markiert ist und Strg+↵ gedrückt wird
- **THEN** öffnet sich kein Tab, die Aktion wird nicht ausgeführt, die Palette bleibt offen und die Speichern-Aktion der Seite wird nicht ausgelöst

#### Scenario: Strg/⌘+Klick
- **WHEN** eine Zeile mit Navigationsziel mit gedrückter Strg- oder ⌘-Taste angeklickt wird
- **THEN** verhält sich die Palette wie bei Strg/⌘+↵

#### Scenario: Gedächtnis zeichnet auf
- **WHEN** ein merkbarer Befehl, etwa „Stammdaten“, mit Strg+↵ geöffnet wird
- **THEN** steht er beim nächsten Öffnen der Palette in „Zuletzt ausgeführt“ wie nach ↵

#### Scenario: Neuer Tab als Kaltstart
- **WHEN** das Ziel im neuen Tab lädt
- **THEN** zeigt der Tab den Datensatz bzw. die Seite angemeldet und vollständig, ohne dass der Nutzer erneut anmelden oder navigieren muss

### Requirement: → öffnet eine Vorschau in der Palette
Die Palette SHALL auf → eine Lese-Vorschau der markierten Zeile anstelle der Trefferliste
zeigen. Voraussetzung ist, dass die Zeile eine Vorschau hat und der Cursor am Ende des
Suchfelds ohne Textauswahl steht. In jedem anderen Fall MUST → sich im Suchfeld wie gewohnt
verhalten, also den Cursor bewegen. Die Vorschau MUST nur lesen und darf keinen Datensatz
verändern. Sie MUST benennen, welcher Datensatz gezeigt wird, und einen sichtbaren,
klickbaren Weg zurück zur Trefferliste haben.

#### Scenario: Personenvorschau
- **WHEN** eine Person als Treffer markiert ist, der Cursor am Textende steht und → gedrückt wird
- **THEN** zeigt die Palette anstelle der Treffer Status, Sichtung, Stammdaten und Verlauf dieser Person, das Suchfeld bleibt fokussiert

#### Scenario: Cursor nicht am Textende
- **WHEN** der Cursor mitten im Suchbegriff steht und → gedrückt wird
- **THEN** rückt der Cursor um ein Zeichen vor und es öffnet sich keine Vorschau

#### Scenario: Zeile ohne Vorschau
- **WHEN** ein Modul markiert ist und → gedrückt wird
- **THEN** bleibt die Trefferliste stehen

### Requirement: Rückweg und Aktionen aus der Vorschau
Solange eine Vorschau offen ist, SHALL Esc oder ← zur Trefferliste zurückführen. Dabei
bleiben Suchbegriff und markierte Zeile erhalten, und die Palette bleibt offen. Ein
weiteres Esc schließt die Palette. ↵ MUST den gezeigten Datensatz öffnen, Strg/⌘+↵ ihn in
einem neuen Tab. Eine Änderung des Suchbegriffs MUST die Vorschau verlassen und die
Trefferliste für den neuen Begriff zeigen.

#### Scenario: Esc führt zurück
- **WHEN** die Vorschau einer Person offen ist und Esc gedrückt wird
- **THEN** steht die Trefferliste mit demselben Suchbegriff und derselben markierten Person wieder da und die Palette ist offen

#### Scenario: Zweites Esc schließt
- **WHEN** nach dem Rückweg aus der Vorschau erneut Esc gedrückt wird
- **THEN** schließt sich die Palette

#### Scenario: Öffnen aus der Vorschau
- **WHEN** die Vorschau einer Person offen ist und ↵ gedrückt wird
- **THEN** navigiert die App auf die Detailseite der Person und die Palette schließt sich

#### Scenario: Weitertippen verlässt die Vorschau
- **WHEN** die Vorschau offen ist und ein Zeichen getippt wird
- **THEN** zeigt die Palette die Trefferliste für den geänderten Begriff

### Requirement: Fußzeile und Zeilenmarke kündigen die Wege an
Die Fußzeile der Palette SHALL den Hinweis für den neuen Tab tragen (macOS: `⌘↵`, sonst
`Strg+↵`). Innerhalb eines Einsatzes SHALL sie zusätzlich den Hinweis `→ Vorschau` tragen.
Jede Zeile mit Vorschau MUST das Vorschau-Ziel zeigen, auch wenn sie nicht markiert ist; es
ist die Zeilenmarke für die Vorschau und tritt an die Stelle der `→`-Marke aus LFH-645.
Neben dem Ziel MUST keine zweite →-Marke stehen. Die Fußzeile MUST für ⇧↵ keinen Hinweis tragen.
Solange die Vorschau offen ist, MUST die Fußzeile die dort gültigen Wege nennen: öffnen,
neuer Tab und zurück.

#### Scenario: Marke an der Personenzeile
- **WHEN** die Trefferliste eine Person und ein Modul zeigt
- **THEN** trägt die Personenzeile das Vorschau-Ziel, markiert oder nicht, und die Modulzeile trägt keins

#### Scenario: Kein zweiter Pfeil
- **WHEN** eine Zeile mit Vorschau markiert ist
- **THEN** steht in ihr neben dem Vorschau-Ziel keine →-Marke

#### Scenario: Kein Vorschauhinweis außerhalb eines Einsatzes
- **WHEN** die Palette auf der Einsatzauswahl geöffnet wird
- **THEN** nennt die Fußzeile den neuen Tab, aber keine Vorschau

### Requirement: Jede Datensatzsorte hat eine Vorschau
Die Palette SHALL für jeden Datensatztreffer eine Lese-Vorschau anbieten, nicht nur für
Personen. Das gilt für ETB-Eintrag, Meldung, Auftrag, Fahrzeug, Personal, Einheit, Schaden,
Unfallhilfsstelle, Lagebericht, Gefahrengebiet und Einsatzabschnitt. Jede dieser Zeilen MUST
das Vorschau-Ziel tragen, markiert oder nicht, und → MUST unter den Bedingungen aus LFH-645
(Cursor am Textende, keine Auswahl) ihre Vorschau öffnen. Rückweg, Öffnen aus der Vorschau
und Fußzeile gelten für jede Sorte wie für die Person.

Die Vorschau MUST den Status des Datensatzes mit Wort zeigen, nicht allein über Farbe, und
die Angaben, die seine Fachseite zum Lesen zeigt. Angaben, für die es keine Datenquelle
gibt, MUST sie weglassen, statt einen Platzhalter zu zeigen. Sie MUST nur lesen: Sie trägt
keine Aktion, die einen Datensatz verändert.

Zeilen ohne Datensatz tragen weiterhin keine Vorschau. Dazu gehören Module, Aktionen, der
ETB-Sammeltreffer „Alle Einträge zu …“ und der Koordinatensprung.

#### Scenario: ETB-Eintrag
- **WHEN** ein ETB-Eintrag als Treffer markiert ist, der Cursor am Textende steht und → gedrückt wird
- **THEN** zeigt die Palette Nummer, Ereigniszeit, Typ, von/an, Meldeweg, Verfasser und den Inhalt dieses Eintrags

#### Scenario: Berichtigung verweist auf den Grundeintrag
- **WHEN** die Vorschau eines ETB-Eintrags geöffnet wird, der einen älteren Eintrag berichtigt
- **THEN** sagt sie, dass er einen älteren Eintrag berichtigt, und trägt einen Verweis auf diesen Grundeintrag

#### Scenario: Meldung
- **WHEN** eine Meldung als Treffer markiert ist und → gedrückt wird
- **THEN** zeigt die Palette Nummer, Status, Priorität, Absender und Empfänger, Inhalt und Bestätigungsstand der Meldung, ohne Knöpfe zum Sichten, Bestätigen oder Erledigen

#### Scenario: Fahrzeug
- **WHEN** ein Fahrzeug als Treffer markiert ist und → gedrückt wird
- **THEN** zeigt die Palette Funkrufname, Status mit Wort, Fahrzeugtyp, Kennzeichen und Trägerorganisation, ohne Statuswahl

#### Scenario: Gefahrengebiet mit bewerteten Gefahren
- **WHEN** ein Gefahrengebiet als Treffer markiert ist, dessen Matrix Bewertungen über „keine“ trägt, und → gedrückt wird
- **THEN** zeigt die Palette Name und höchste Warnstufe des Gebiets und eine Gefahrenmatrix nur mit den Gefahren, die mindestens eine solche Bewertung haben; jede Zelle nennt ihre Warnstufe mit Kürzel, nicht allein über Farbe

#### Scenario: Gefahrengebiet ohne bewertete Gefahren
- **WHEN** ein Gefahrengebiet ohne Bewertung über „keine“ in der Vorschau geöffnet wird
- **THEN** steht statt der Matrix der Satz, dass keine Gefahren bewertet sind

#### Scenario: Ziel an jeder Datensatzzeile
- **WHEN** Treffer jeder der zwölf Datensatzsorten in der Liste stehen
- **THEN** trägt jede dieser Zeilen das Vorschau-Ziel

#### Scenario: Sammeltreffer ohne Vorschau
- **WHEN** der ETB-Sammeltreffer „Alle Einträge zu …“ markiert ist und → gedrückt wird
- **THEN** bleibt die Trefferliste stehen und die Zeile trägt kein Vorschau-Ziel

### Requirement: Die Vorschau liest den Stand der Trefferliste
Die Vorschau SHALL denselben Datenstand zeigen, aus dem der Treffer entstanden ist. Ist
dieser Stand bereits geladen, MUST das Öffnen der Vorschau ohne zusätzlichen Abruf beim
Server auskommen. Ausgenommen sind Angaben, die die Trefferliste nicht trägt: die
Gefahrenmatrix eines Gefahrengebiets, die Stärke eines Einsatzabschnitts und ein ETB-Eintrag
aus der Volltextsuche; sie kommen aus demselben Datenstand wie auf ihrer Fachseite. Ändert sich der Datensatz während der offenen Vorschau durch eine
Live-Aktualisierung, MUST die Vorschau den neuen Stand zeigen.

#### Scenario: Kein zusätzlicher Abruf
- **WHEN** eine Meldung soeben als Treffer geladen wurde und ihre Vorschau geöffnet wird
- **THEN** geht für die Vorschau keine weitere Anfrage an den Server

#### Scenario: Live-Änderung während der Vorschau
- **WHEN** die Vorschau eines Fahrzeugs offen ist und sein Status von anderer Stelle geändert wird
- **THEN** zeigt die Vorschau den neuen Status, ohne dass sie neu geöffnet werden muss

### Requirement: Ein nicht mehr vorhandener Datensatz wird benannt
Findet die Vorschau den gezeigten Datensatz in ihrer Quelle nicht mehr, etwa weil er
gelöscht oder aufgelöst wurde, SHALL sie das mit einem Satz sagen. Sie MUST nicht leer
bleiben und MUST keinen anderen Datensatz an seiner Stelle zeigen. Ein Ladefehler MUST als
Fehler mit Wiederholen-Möglichkeit erscheinen, nicht als leere Fläche.

#### Scenario: Datensatz verschwunden
- **WHEN** die Vorschau eines Einsatzabschnitts offen ist und der Abschnitt aufgelöst wird
- **THEN** zeigt die Vorschau, dass der Abschnitt nicht mehr vorhanden ist

#### Scenario: Nummernlücke im ETB
- **WHEN** die Vorschau eines ETB-Eintrags geladen wird und die Abfrage über die laufende Nummer einen anderen Eintrag liefert
- **THEN** zeigt die Vorschau nicht diesen anderen Eintrag, sondern dass der gesuchte Eintrag nicht mehr vorhanden ist

#### Scenario: Ladefehler
- **WHEN** der Abruf für eine Vorschau scheitert
- **THEN** zeigt die Vorschau eine Fehlermeldung mit der Möglichkeit, es erneut zu versuchen

### Requirement: Verweise in der Vorschau schließen die Palette
Enthält eine Vorschau einen Verweis auf einen anderen Datensatz oder eine andere Seite, SHALL
ein Klick darauf das Ziel öffnen und die Palette schließen. Die App MUST nicht unter der
offenen Palette auf eine andere Seite wechseln.

#### Scenario: Verweis aus der Meldungsvorschau
- **WHEN** in der Vorschau einer Meldung auf den Verweis zum zugehörigen Auftrag geklickt wird
- **THEN** zeigt die App die Aufträge mit diesem Auftrag und die Palette ist geschlossen

### Requirement: Ein Tippziel öffnet die Vorschau
Ein Tipp oder Klick auf das Vorschau-Ziel einer Zeile SHALL die Vorschau dieser Zeile öffnen
und MUST weder den Datensatz öffnen noch die Palette schließen, auch nicht mit Strg/⌘. Ein
Tipp auf die übrige Zeile SHALL wie bisher den Datensatz öffnen. Das Ziel MUST in Höhe und
Breite den Boden der aktiven Dichtestufe tragen (30/48/72 px), bündig an der rechten
Zeilenkante enden und die volle Zeilenhöhe füllen. Der Fokus MUST dabei im Suchfeld bleiben.
Das Ziel ist für Hilfstechnik verborgen; deren Weg in die Vorschau bleibt →.

#### Scenario: Tipp aufs Ziel auf dem Tablet
- **WHEN** auf dem Führungs-Tablet in der Stufe Handschuh das Vorschau-Ziel einer Person getippt wird
- **THEN** zeigt die Palette deren Vorschau, die Seite darunter bleibt stehen und der Fokus steht im Suchfeld

#### Scenario: Tipp auf die übrige Zeile
- **WHEN** auf dem Führungs-Tablet das Label derselben Zeile getippt wird
- **THEN** öffnet die App die Detailseite der Person und die Palette schließt sich

#### Scenario: Ziel an einer nicht markierten Zeile
- **WHEN** das Vorschau-Ziel einer Zeile getippt wird, die nicht markiert ist
- **THEN** öffnet sich die Vorschau dieser Zeile, ohne dass vorher gezeigt oder gepfeilt werden muss

#### Scenario: Boden in jeder Stufe
- **WHEN** die Palette in den Stufen kompakt, komfortabel und Handschuh geöffnet wird
- **THEN** misst das Vorschau-Ziel in Höhe und Breite mindestens 30, 48 und 72 px und sitzt bündig an der rechten Kante über die volle Höhe der Zeile

### Requirement: „Status setzen“ wirkt auf die Fokuszeile
Die Palette SHALL in der Gruppe „Aktionen“ die Aktion „Status setzen“ genau dann anbieten, wenn
der Tastaturfokus beim Öffnen der Palette in einer Listenzeile lag, also in einer Tabellenzeile
oder einer Karte, deren Status die Person dort wechseln kann. Diese Zeile ist die Fokuszeile.
Beim Ausführen MUST die Palette schließen und das Statusmenü genau dieser Zeile öffnen, mit dem
Tastaturfokus im Menü. Den Wert wählt die Person dort. Die Aktion MUST keinen Status von sich aus
setzen und MUST auf keine andere Zeile wirken.

Ohne Fokuszeile MUST die Aktion fehlen. Das gilt auch dann, wenn die Palette ohne Fokus in einer
registrierten Fläche geöffnet wird (etwa über den Knopf „Suchen“) und die Seite Zeilen mit
Statuswechsel zeigt. Sie MUST ebenso fehlen, wenn die Zeile keinen Statuswechsel anbietet: ohne
Schreibrecht, während sie gesperrt ist oder während ihr Statuswechsel läuft.

Die Aktion MUST ohne Tastenkürzel angezeigt werden. Sie MUST keine der Tasten Escape, Strg/⌘+S,
Strg/⌘+↵ oder Strg/⌘+Rücktaste belegen.

#### Scenario: Fokus in einer Zeile
- **WHEN** der Fokus auf der Kennung des Fahrzeugs „Florian 2“ in der Fahrzeugliste steht und Strg+K gedrückt wird
- **THEN** zeigt die Palette unter „Aktionen“ die Zeile „Status setzen“ ohne Tastenkürzel

#### Scenario: Wirkung auf genau diese Zeile
- **WHEN** „Status setzen“ bei Fokus in der Zeile „Florian 2“ ausgeführt wird, während darüber die Zeile „Florian 1“ steht
- **THEN** schließt sich die Palette, das Statusmenü von „Florian 2“ ist geöffnet und hat den Fokus, das Menü von „Florian 1“ bleibt zu, und kein Status wurde geändert

#### Scenario: Kein Fokus in einer Zeile
- **WHEN** der Fokus im Suchfeld der Liste steht und Strg+K gedrückt wird
- **THEN** fehlt „Status setzen“ in der Palette

#### Scenario: Über den Suchen-Knopf geöffnet
- **WHEN** die Palette per Klick auf „Suchen“ geöffnet wird und die Seite Zeilen mit Statuswechsel zeigt
- **THEN** fehlt „Status setzen“ in der Palette

#### Scenario: Zeile ohne Statuswechsel
- **WHEN** der Fokus in einer Zeile steht, deren Statuswechsel gesperrt ist oder für die die Person kein Schreibrecht hat, und Strg+K gedrückt wird
- **THEN** fehlt „Status setzen“ in der Palette

#### Scenario: Weitere Aktionen der Seite bleiben
- **WHEN** der Fokus in einer Zeile einer Seite mit der Aktion „Neue Zeile“ steht und Strg+K gedrückt wird
- **THEN** stehen „Status setzen“ und „Neue Zeile“ zusammen unter „Aktionen“
