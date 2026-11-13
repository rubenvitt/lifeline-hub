## RENAMED Requirements

- FROM: `### Requirement: Kompakte Zeile ohne senkrechte Metaspalte`
- TO: `### Requirement: Spaltenzeile in kompakter Dichte`

## MODIFIED Requirements

### Requirement: Spaltenzeile in kompakter Dichte
In der kompakten Dichte ab Breite `lg` SHALL eine Zeitachsenzeile in festen Spalten stehen: Zeit,
Nr., Typ, Von → An, Inhalt, Vermerk und Zeilenmenü. Die Spalten MUST über alle Zeilen
fluchten, und ein Spaltenkopf mit denselben Breiten SHALL über der Zeitachse stehen. Von → An MUST
in der Textschrift stehen, mindestens 13 px, der Meldeweg dahinter in der gedämpften Stufe. Der
Verfasser SHALL im Titel der Zeile und im Zeilenmenü stehen, nicht in einer eigenen Spalte. Kein
Text einer Zeile MUST kleiner als 12 px sein. Ein einzeiliger Eintrag MUST höchstens 36 px hoch
sein; zwischen Filterleiste und Erfassung SHALL bei 1440 × 900 Platz für mindestens 14 einzeilige
Einträge sein.

#### Scenario: Einzeiliger Eintrag im Fükw
- **WHEN** ein einzeiliger ETB-Eintrag mit Von „Sanitätszug Musterstadt“, An „EL“ und Meldeweg Funk in kompakter Dichte bei 1440 × 900 steht
- **THEN** ist die Zeile höchstens 36 px hoch, Von → An steht in mindestens 13 px Textschrift, und zwischen Filter- und Erfassungsleiste stehen mindestens 14 Einträge

#### Scenario: Spalten fluchten
- **WHEN** zwei Einträge mit verschieden langem Absender untereinander stehen
- **THEN** beginnt ihr Inhalt an derselben Stelle wie die Spalte „Inhalt“ im Spaltenkopf

#### Scenario: Langer Absender
- **WHEN** Von → An länger ist als seine Spalte
- **THEN** endet es mit Auslassung und trägt den vollen Text als Titel

#### Scenario: Bedienbarer Verfasser
- **WHEN** eine Zeile in kompakter Dichte einen Verweis als Verfasser trägt
- **THEN** steht der Verweis im Zeilenmenü, und die Zeile wird nicht höher als ohne ihn

#### Scenario: Langer Verfasser
- **WHEN** der Verfasser lang ist
- **THEN** steht er vollständig im Titel der Zeile und im Zeilenmenü, und die Zeile bleibt einzeilig

### Requirement: Systemeinträge zeigen
Die ETB-Seite SHALL einen Umschaltknopf „Systemeinträge zeigen“ in der Filterleiste haben, Vorgabe
aus. Aus blendet er alle Einträge vom Typ `system` aus, die Zeitordnung der übrigen bleibt. Der
Zustand MUST in der URL stehen und Neuladen, Teilen und Druck überstehen; der Knopf nennt die Zahl
der Systemeinträge. Er MUST seinen Zustand über `aria-pressed` melden und ausgeschaltet zusätzlich
zur Farbe ein zweites Zeichen tragen.

#### Scenario: Vorgabe
- **WHEN** die ETB-Seite ohne Filter in der Adresse geöffnet wird
- **THEN** enthält die Zeitachse keinen Systemeintrag, und der Knopf meldet `aria-pressed="false"` mit der Zahl der Systemeinträge als Beschreibung

#### Scenario: Einblenden
- **WHEN** der Umschaltknopf eingeschaltet wird
- **THEN** stehen die Systemeinträge in der Zeitachse, gebündelt nach „Folgen von Systemeinträgen gebündelt“, und der Zustand steht in der Adresse

#### Scenario: Ausblenden
- **WHEN** der eingeschaltete Umschaltknopf wieder ausgeschaltet wird
- **THEN** enthält die Zeitachse keinen Systemeintrag, und der Kopf nennt die Zahl der ausgeblendeten

#### Scenario: Neuladen
- **WHEN** die Seite mit eingeblendeten Systemeinträgen neu geladen wird
- **THEN** bleiben sie eingeblendet

#### Scenario: Sprung auf einen ausgeblendeten Eintrag
- **WHEN** `?eintrag=` auf einen Systemeintrag zeigt, während Systemeinträge ausgeblendet sind
- **THEN** blendet die Seite sie wieder ein, hebt den Eintrag hervor und sagt, dass sie eingeblendet hat

#### Scenario: Sprung unter einem Typfilter
- **WHEN** `?eintrag=` unter einem Typfilter und ausgeblendeten Systemeinträgen ins Leere zeigt
- **THEN** bleibt der Ausschluss bestehen, und die Seite räumt den Sprungparameter ohne Hinweis

#### Scenario: Zustand für Hilfsmittel
- **WHEN** Systemeinträge ausgeblendet sind
- **THEN** meldet der Knopf `aria-pressed="false"`, sein zugänglicher Name bleibt „Systemeinträge zeigen“, und die Zahl steht als Beschreibung daneben

## ADDED Requirements

### Requirement: Vermerke in eigener Spalte
Verweise und Marken eines Eintrags („Meldung #5 ↗“, „Auftrag #4 ↗“, „Einheit … ↗“, „Nachtrag ·
erfasst 1926“, „berichtigt durch Nr. 231“, „berichtigt Nr. 230“, „SOFORT“, Anhänge) SHALL in der
Spalte Vermerk stehen, nicht in einer eigenen Zeile unter dem Inhalt. Reicht die Spalte nicht,
MUST sie mit „+n“ enden und alle Vermerke im Zeilenmenü und im Titel nennen. Ein berichtigter
Eintrag SHALL seinen Inhalt durchgestrichen zeigen.

#### Scenario: Meldung mit Verweis
- **WHEN** ein Eintrag vom Typ „Meldung“ die Meldung #5 angelegt hat
- **THEN** steht „Meldung #5 ↗“ in der Spalte Vermerk derselben Zeile, und die Zeile bleibt einzeilig

#### Scenario: Berichtigt
- **WHEN** Nr. 230 durch Nr. 231 berichtigt ist
- **THEN** zeigt Nr. 230 ihren Inhalt durchgestrichen und „berichtigt durch Nr. 231“ als Vermerk

### Requirement: Eigener Vermerk statt Von → An
Sind Von und An eines Eintrags gleich, SHALL die Spalte Von → An „Vermerk <Stelle>“ zeigen statt
„<Stelle> → <Stelle>“.

#### Scenario: Entscheidung der Einsatzleitung
- **WHEN** eine Entscheidung Von „EL“ und An „EL“ trägt
- **THEN** zeigt ihre Zeile „Vermerk EL“

### Requirement: Lange Einträge eingeklappt
Ein Eintrag, dessen Inhalt mehr als drei Zeilen der Spalte belegen würde (etwa ein Lagebericht),
SHALL eingeklappt auf höchstens drei Zeilen stehen, mit dem Knopf „mehr“ am Ende; „weniger“ klappt
ihn wieder zu. Ein Sprung per `?eintrag=` und eine Volltextsuche mit Treffer im verborgenen Teil
MUST ihn aufgeklappt zeigen. Der Druck klappt nie ein.

#### Scenario: Lagebericht im Strom
- **WHEN** ein Eintrag vom Typ „Lage“ einen Lagebericht mit acht Abschnitten trägt
- **THEN** steht er auf höchstens drei Zeilen mit „mehr“, und „mehr“ zeigt ihn ganz

### Requirement: Zeile auf dem Handschirm
Unter Breite `md` SHALL eine Zeile oben eine Kopfzeile mit Zeit, Typwort und Von → An tragen und
darunter den Inhalt in voller Breite, Vermerke darunter. Verfasser und Zeilenmenü MUST die Breite
des Inhalts nicht verringern.

#### Scenario: 390 px
- **WHEN** ein Eintrag bei 390 × 844 steht
- **THEN** beginnt sein Inhalt am linken Rand der Zeile und nutzt mindestens 330 px Breite
