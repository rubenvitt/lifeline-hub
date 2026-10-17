# etb-zeitachse-darstellung Specification

## Purpose
Wie eine Zeile der Zeitachse je Dichtestufe aufgebaut ist und wie die ETB-Oberfläche
Systemeinträge aus- und einblendet, damit der Führungsassistent im Fükw möglichst viele Handeinträge
im Zusammenhang liest.

## Requirements

### Requirement: Kompakte Zeile ohne senkrechte Metaspalte
In der kompakten Dichte SHALL eine Zeitachsenzeile Verfasser und Meldeweg in der Metazeile neben
Typwort und Von→An zeigen und ein Zeilenmenü am Ende dieser Zeile. Der Verfasser MUST einzeilig
bleiben, bei Überlänge gekürzt, mit dem Volltext als Titel. Ein bedienbarer Verfasser (ein Verweis
mit eigener Trefffläche) MUST mit dem Meldeweg rechts bleiben; das Zeilenmenü steht trotzdem in
der Kopfzeile, und der Text MUST ihm die Breite freihalten.

#### Scenario: Einzeiliger Eintrag im Fükw
- **WHEN** ein einzeiliger ETB-Eintrag mit Verfasser „Administrator · EL“ und Meldeweg „Funk“ in kompakter Dichte bei 1440×900 steht
- **THEN** ist die Zeile höchstens 56 px hoch, und zwischen Filter- und Erfassungsleiste stehen mindestens 9 Einträge

#### Scenario: Bedienbarer Verfasser
- **WHEN** eine Zeile in kompakter Dichte einen Verweis als Verfasser trägt
- **THEN** steht er mit dem Meldeweg rechts in der Spalte, und die Kopfzeile wird nicht höher als ohne ihn

#### Scenario: Langer Verfasser
- **WHEN** der Verfasser länger ist als der verfügbare Platz
- **THEN** bricht er nicht um, sondern endet mit Auslassung und trägt den vollen Namen als Titel

### Requirement: Komfortabel und Handschuh behalten die Spalte
In den Dichten komfortabel und Handschuh SHALL die Zeile Verfasser, Meldeweg und Aktionen rechts
untereinander zeigen, mit der Trefffläche der Stufe (48 bzw. 72 px).

#### Scenario: Tablet quer
- **WHEN** die Dichte komfortabel ist
- **THEN** steht das Zeilenmenü rechts unter dem Verfasser und ist mindestens 48 px hoch

### Requirement: Systemeinträge zeigen
Die ETB-Seite SHALL einen Umschaltknopf „Systemeinträge zeigen“ in der Filterleiste haben, Vorgabe
an. Aus blendet er alle Einträge vom Typ `system` aus, die Zeitordnung der übrigen bleibt. Der
Zustand MUST in der URL stehen und Neuladen, Teilen und Druck überstehen; der Knopf nennt die Zahl
der Systemeinträge. Er MUST seinen Zustand über `aria-pressed` melden und ausgeschaltet zusätzlich
zur Farbe ein zweites Zeichen tragen.

#### Scenario: Ausblenden
- **WHEN** der Umschaltknopf ausgeschaltet wird
- **THEN** enthält die Zeitachse keinen Systemeintrag, und Kopf und Bilanz zeigen „n Treffer“ bzw. „Bilanz im Filter“ über dieselbe Menge

#### Scenario: Neuladen
- **WHEN** die Seite mit ausgeblendeten Systemeinträgen neu geladen wird
- **THEN** bleiben sie ausgeblendet

#### Scenario: Sprung auf einen ausgeblendeten Eintrag
- **WHEN** `?eintrag=` auf einen Systemeintrag zeigt, während Systemeinträge ausgeblendet sind
- **THEN** blendet die Seite sie wieder ein, hebt den Eintrag hervor und sagt, dass sie eingeblendet hat

#### Scenario: Sprung unter einem Typfilter
- **WHEN** `?eintrag=` unter einem Typfilter und ausgeblendeten Systemeinträgen ins Leere zeigt
- **THEN** bleibt der Ausschluss bestehen, und die Seite räumt den Sprungparameter ohne Hinweis

#### Scenario: Zustand für Hilfsmittel
- **WHEN** Systemeinträge ausgeblendet sind
- **THEN** meldet der Knopf `aria-pressed="false"`, sein zugänglicher Name bleibt „Systemeinträge zeigen“, und die Zahl steht als Beschreibung daneben

### Requirement: Funkprotokoll-Ordnung
Die ETB-Zeitachse SHALL wie ein Funkprotokoll lesen: älteste geladene Zeile oben, neueste unten
direkt über der Erfassung, Stundengruppen aufsteigend. Beim Öffnen ohne Sprungziel MUST die Seite
am Ende stehen, sodass der jüngste Eintrag ohne Rollen über der Erfassung sichtbar ist.

#### Scenario: Öffnen
- **WHEN** die ETB-Seite eines Einsatzes mit 134 Einträgen ohne `?eintrag=` geöffnet wird
- **THEN** steht Nr. 134 direkt über der Erfassungsleiste im Bild, und Nr. 133 steht darüber

#### Scenario: Eigener Eintrag
- **WHEN** jemand am Seitenende einen Eintrag erfasst und der Server ihn annimmt
- **THEN** steht der neue Eintrag ohne eigenes Rollen direkt über der Erfassungsleiste

#### Scenario: Stundenwechsel
- **WHEN** Einträge aus 13 und 14 Uhr geladen sind
- **THEN** steht die Gruppe „13 Uhr“ über der Gruppe „14 Uhr“, und in jeder Gruppe wächst die laufende Nummer nach unten

### Requirement: Mitlaufen am Ende
Steht die Seite am Ende und liegt der Fokus nicht in der Zeitachse, SHALL ein neuer fremder Eintrag
unten erscheinen und die Seite ihm nachlaufen. Wer hochgerollt hat oder den Fokus in der Zeitachse
hält, MUST keinen Sprung erleben; neue Einträge melden sich dann über ein Sammelbanner am unteren
Rand der Zeitachse.

#### Scenario: Am Ende
- **WHEN** die Seite am Ende steht und ein fremder Eintrag eintrifft
- **THEN** steht er sichtbar über der Erfassungsleiste, ohne dass jemand rollt

#### Scenario: Hochgerollt
- **WHEN** jemand 20 Zeilen hochgerollt hat und drei fremde Einträge eintreffen
- **THEN** bleibt die gelesene Zeile an ihrem Platz, und unten steht „3 neue Einträge ↓“, das ans Ende führt

### Requirement: Lesemarke als Trennlinie
Gibt es ungesichtete Einträge und liegt der zuletzt gesichtete im geladenen, ungefilterten Fenster,
SHALL die Zeitachse unter ihm eine Trennlinie „Neu seit <Uhrzeit> · n Einträge“ mit „Als gesichtet
markieren“ zeigen. Liegt er außerhalb des Fensters oder unter einem Filter, MUST dieselbe Angabe
als schmales Banner mit „Zur Marke springen“ erscheinen. Die Seite öffnet trotzdem am Ende.

#### Scenario: Marke im Fenster
- **WHEN** Nr. 120 zuletzt gesichtet wurde und 14 neuere Einträge geladen sind
- **THEN** steht zwischen Nr. 120 und Nr. 121 die Linie „Neu seit …“ mit 14 Einträgen, und die Seite steht am Ende

#### Scenario: Marke außerhalb
- **WHEN** der zuletzt gesichtete Eintrag nicht im geladenen Fenster liegt
- **THEN** steht ein Banner mit derselben Angabe und „Zur Marke springen“, und keine Linie steht in der Achse

### Requirement: Systemeinträge leise
Ein Systemeintrag SHALL leiser als ein Handeintrag stehen: Text in der gedämpften Textstufe, eine
Schriftstufe kleiner, ohne Zeilentönung, der Text ungekürzt. Sind Von und An beide die
Systemkennung, MUST „Von → An“ entfallen. Eine bekannte Seite bleibt sichtbar, ebenso Verfasser
und Funktion. Die gedämpfte Stufe hält den Textboden (Tag ≥ 7 : 1, Nacht ≥ 5 : 1).

#### Scenario: Reiner Systemeintrag
- **WHEN** ein Systemeintrag Von „System“ und An „System“ trägt
- **THEN** zeigt seine Zeile kein „System → System“, aber Verfasser und Funktion

#### Scenario: Systemeintrag mit bekannter Seite
- **WHEN** ein Systemeintrag An „ELW 1“ trägt
- **THEN** zeigt seine Zeile „System → ELW 1“

### Requirement: Folgen von Systemeinträgen gebündelt
Drei oder mehr direkt aufeinanderfolgende schlichte Systemeinträge einer Stundengruppe SHALL die
Zeitachse zu einer Zeile „n Systemeinträge · <von>–<bis> · anzeigen“ bündeln, an ihrem Platz in der
Ordnung und per Tastatur aufklappbar (`aria-expanded`). Ein berichtigter, nachgetragener oder mit
Anhang, Dokument oder Rückverweis versehener Eintrag unterbricht die Folge. Unter `typ=system` und
unter einer Volltextsuche MUST nicht gebündelt werden. Der Druck bündelt nie.

#### Scenario: Schwelle
- **WHEN** in einer Stundengruppe zwei Systemeinträge aufeinander folgen
- **THEN** stehen beide als eigene Zeilen; bei drei steht eine Bündelzeile

#### Scenario: Unterbrechung
- **WHEN** zwischen zwei Paaren von Systemeinträgen eine Meldung steht
- **THEN** entsteht kein Bündel

#### Scenario: Sprung in ein Bündel
- **WHEN** `?eintrag=` auf einen gebündelten Systemeintrag zeigt
- **THEN** ist sein Bündel aufgeklappt, und der Eintrag steht hervorgehoben im Bild

#### Scenario: Aufgeklappt bleibt offen
- **WHEN** ein aufgeklapptes Bündel durch einen neuen Systemeintrag wächst
- **THEN** bleibt es aufgeklappt

### Requirement: Berichtigt unabhängig vom Fenster
Trägt ein Eintrag Berichtigungen (`berichtigt_durch`), SHALL seine Kopfzeile eine Statusmarke
„berichtigt“ im Ton Achtung samt Sprung „→ Nr. n“ auf die jüngste Berichtigung zeigen, unabhängig
davon, ob die Berichtigung geladen ist oder zum Filter passt. Der Text MUST vollständig lesbar
bleiben. Weitere Berichtigungen MUST erreichbar sein.

#### Scenario: Berichtigung nicht geladen
- **WHEN** eine Meldung `berichtigt_durch` mit Nr. 135 trägt und Nr. 135 nicht im Fenster liegt
- **THEN** zeigt ihre Kopfzeile „berichtigt“ und „→ Nr. 135“

#### Scenario: Typfilter Meldung
- **WHEN** der Typfilter „Meldung“ gilt und eine Meldung berichtigt wurde
- **THEN** trägt sie die Marke „berichtigt“, obwohl keine Berichtigung in der Liste steht

### Requirement: Berichtigung berichtigen
Das Zeilenmenü SHALL „Berichtigen“ auch an einer Berichtigung anbieten. Die Erfassung MUST dann die
Kette nennen: „Berichtigung zu Nr. n“ und, wenn die Nummer des Grundeintrags bekannt ist,
„(berichtigt Nr. m)“, sonst „(berichtigt einen älteren Eintrag)“.

#### Scenario: Kette
- **WHEN** an Nr. 135, einer Berichtigung von Nr. 134, „Berichtigen“ gewählt wird und Nr. 134 geladen ist
- **THEN** zeigt die Erfassung „Berichtigung zu Nr. 135 (berichtigt Nr. 134)“

### Requirement: Nachtrag mit Tag
Liegen Ereigniszeit und Erfassung eines Eintrags an verschiedenen Kalendertagen der Anzeigezone,
SHALL der Hinweis „nachgetragen“ die Erfassung mit Tag in taktischer Form nennen; am selben Tag
genügt die Uhrzeit.

#### Scenario: Über Mitternacht
- **WHEN** ein Eintrag die Ereigniszeit 10.10. 23:50 trägt und am 11.10. um 00:20 erfasst wurde
- **THEN** lautet der Hinweis „nachgetragen 110020“
