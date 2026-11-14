# etb-zeitachse-darstellung Specification

## Purpose
Wie eine Zeile der Zeitachse je Dichtestufe aufgebaut ist und wie die ETB-Oberfläche
Systemeinträge aus- und einblendet, damit der Führungsassistent im Fükw möglichst viele Handeinträge
im Zusammenhang liest.

## Requirements

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

### Requirement: Komfortabel und Handschuh behalten die Spalte
Ab Breite `md` SHALL die Zeile in den Dichten komfortabel und Handschuh Verfasser, Meldeweg und
Aktionen rechts untereinander zeigen, mit der Trefffläche der Stufe (48 bzw. 72 px). Unter `md`
gilt in jeder Dichte die Zeile auf dem Handschirm.

#### Scenario: Tablet quer
- **WHEN** die Dichte komfortabel ist und die Seite ab Breite `md` steht
- **THEN** steht das Zeilenmenü rechts unter dem Verfasser und ist mindestens 48 px hoch

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
- **WHEN** Einträge aus 13 und 14 Uhr von heute geladen sind und die Darstellung taktisch ist
- **THEN** steht die Gruppe „1300“ über der Gruppe „1400“, und in jeder Gruppe wächst die laufende Nummer nach unten

### Requirement: Zeiten der Zeitachse aus dem Formatkern
Die Zeitachse SHALL jede Zeit in den Rollen der Spec `zeitdarstellung` zeigen (LLH-1061): die
Zeitspalte einer Zeile (gesendet, vorgemerkt oder abgelehnt) und der Kopf einer Stundengruppe in
der Rolle „kurz“ — heute nur die Uhrzeit, an einem anderen Tag mit Tag —, Beginn und Ende einer
Bündelzeile in der Rolle „Uhrzeit“, weil der Kopf ihrer Stundengruppe den Tag trägt. Die
Darstellung MUST der wirksamen Wahl folgen (Gerät vor Einsatz vor Organisation).

#### Scenario: Heute und Vortag, taktisch
- **WHEN** am 10.10. ein Eintrag von 14:46 Uhr desselben Tages und einer vom 09.10. 14:46 Uhr in der Zeitachse stehen
- **THEN** zeigt die Zeitspalte `1446` bzw. `091446`, und die Stundenköpfe lauten `1400` bzw. `091400`

#### Scenario: Datum und Uhrzeit
- **WHEN** die wirksame Darstellung „Datum und Uhrzeit“ ist
- **THEN** zeigt dieselbe Zeitspalte `14:46` bzw. `09.10. 14:46`, und der Stundenkopf des Vortags lautet `09.10. 14:00`

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
als schmales Banner mit „Zur Marke springen“ erscheinen. Die Seite öffnet trotzdem am Ende. Blendet
die Zeitachse die Systemeinträge aus, MUST die Zahl sie nicht mitzählen: ein Banner über Einträge,
die nicht zu sehen sind, führte ins Leere.

#### Scenario: Marke im Fenster
- **WHEN** Nr. 120 zuletzt gesichtet wurde und 14 neuere Einträge geladen sind
- **THEN** steht zwischen Nr. 120 und Nr. 121 die Linie „Neu seit …“ mit 14 Einträgen, und die Seite steht am Ende

#### Scenario: Marke außerhalb
- **WHEN** der zuletzt gesichtete Eintrag nicht im geladenen Fenster liegt
- **THEN** steht ein Banner mit derselben Angabe und „Zur Marke springen“, und keine Linie steht in der Achse

#### Scenario: Nur neue Systemeinträge
- **WHEN** seit der letzten Sichtung nur Systemeinträge dazukamen und die Zeitachse sie ausblendet
- **THEN** steht weder Linie noch Banner

### Requirement: Systemeinträge leise
Ein Systemeintrag SHALL leiser als ein Handeintrag stehen: Text in der gedämpften Textstufe, eine
Schriftstufe kleiner, ohne Zeilentönung, der Text ungekürzt. Sind Von und An beide die
Systemkennung, MUST „Von → An“ entfallen. Eine bekannte Seite bleibt sichtbar, ebenso Verfasser
und Funktion; in der Spaltenzeile stehen sie im Titel und im Zeilenmenü. Die gedämpfte Stufe hält
den Textboden (Tag ≥ 7 : 1, Nacht ≥ 5 : 1).

#### Scenario: Reiner Systemeintrag
- **WHEN** ein Systemeintrag Von „System“ und An „System“ trägt
- **THEN** zeigt seine Zeile kein „System → System“, aber Verfasser und Funktion

#### Scenario: Systemeintrag mit bekannter Seite
- **WHEN** ein Systemeintrag An „ELW 1“ trägt
- **THEN** zeigt seine Zeile „System → ELW 1“

#### Scenario: Langer Systemeintrag
- **WHEN** ein Systemeintrag mehr als drei Zeilen belegt
- **THEN** steht er ungekürzt, ohne „mehr“

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
Trägt ein Eintrag Berichtigungen (`berichtigt_durch`), SHALL er das zeigen, unabhängig davon, ob die
Berichtigung geladen ist oder zum Filter passt: im `Zeitachseneintrag` eine Statusmarke „berichtigt“
im Ton Achtung samt Sprung „→ Nr. n“ auf die jüngste Berichtigung in der Kopfzeile, in Spalten- und
Handschirm-Zeile den Vermerk „berichtigt durch Nr. n“ mit Sprung und den Inhalt durchgestrichen. Der
Text MUST lesbar bleiben. Weitere Berichtigungen MUST erreichbar sein.

#### Scenario: Berichtigung nicht geladen
- **WHEN** eine Meldung `berichtigt_durch` mit Nr. 135 trägt und Nr. 135 nicht im Fenster liegt
- **THEN** zeigt ihre Zeile „berichtigt“ und den Sprung auf Nr. 135

#### Scenario: Typfilter Meldung
- **WHEN** der Typfilter „Meldung“ gilt und eine Meldung berichtigt wurde
- **THEN** trägt sie die Kennzeichnung „berichtigt“, obwohl keine Berichtigung in der Liste steht

### Requirement: Berichtigung berichtigen
Das Zeilenmenü SHALL „Berichtigen“ auch an einer Berichtigung anbieten. Die Erfassung MUST dann die
Kette nennen: „Berichtigung zu Nr. n“ und, wenn die Nummer des Grundeintrags bekannt ist,
„(berichtigt Nr. m)“, sonst „(berichtigt einen älteren Eintrag)“.

#### Scenario: Kette
- **WHEN** an Nr. 135, einer Berichtigung von Nr. 134, „Berichtigen“ gewählt wird und Nr. 134 geladen ist
- **THEN** zeigt die Erfassung „Berichtigung zu Nr. 135 (berichtigt Nr. 134)“

### Requirement: Nachtrag mit Tag
Liegen Ereigniszeit und Erfassung eines Eintrags an verschiedenen Kalendertagen der Anzeigezone,
SHALL der Hinweis auf den Nachtrag die Erfassung mit Tag nennen; am selben Tag genügt die Uhrzeit.
Im `Zeitachseneintrag` lautet er „nachgetragen …“, in Spalten- und Handschirm-Zeile steht er als
Vermerk „Nachtrag · erfasst …“. Die Schreibweise MUST der wirksamen Darstellung folgen (Spec
`zeitdarstellung`): taktisch `110020` bzw. `1421`, sonst `11.10. 00:20` bzw. `14:21`.

#### Scenario: Über Mitternacht
- **WHEN** ein Eintrag die Ereigniszeit 10.10. 23:50 trägt und am 11.10. um 00:20 erfasst wurde
- **THEN** nennt der Hinweis „110020“, im `Zeitachseneintrag` als „nachgetragen 110020“, in der Spaltenzeile als „Nachtrag · erfasst 110020“

### Requirement: Vermerke in eigener Spalte
Verweise und Marken eines Eintrags („Meldung #5 ↗“, „Auftrag ↗“, „Einheit … ↗“, „Nachtrag ·
erfasst 1926“, „berichtigt durch Nr. 231“, „berichtigt Nr. 230“, Anhänge) SHALL in der
Spalte Vermerk stehen, nicht in einer eigenen Zeile unter dem Inhalt. Reicht die Spalte nicht,
MUST sie mit „+n“ enden und alle Vermerke im Zeilenmenü und im Titel nennen. Ein berichtigter
Eintrag SHALL seinen Inhalt durchgestrichen zeigen.

#### Scenario: Meldung mit Verweis
- **WHEN** ein Eintrag vom Typ „Meldung“ die Meldung #5 angelegt hat
- **THEN** steht „Meldung #5 ↗“ in der Spalte Vermerk derselben Zeile, und die Zeile bleibt einzeilig

#### Scenario: Berichtigt
- **WHEN** Nr. 230 durch Nr. 231 berichtigt ist
- **THEN** zeigt Nr. 230 ihren Inhalt durchgestrichen und „berichtigt durch Nr. 231“ als Vermerk

### Requirement: Anhänge im Zeilenmenü
Ein Bild-Anhang SHALL im Zeilenmenü der Spaltenzeile neben „herunterladen“ auch „Vorschau“
(Großansicht in der App) und, wer Originale laden darf, „Original (mit Standort)“ anbieten:
Vorschaubild und Original stehen in der Spalte Vermerk nicht. Ein Download aus dem Menü MUST am
Spiegel denselben Weg nehmen wie der Verweis und „wird geholt“ melden, statt eine Fehlerantwort als
Datei zu speichern.

#### Scenario: Ein Foto ohne weitere Vermerke
- **WHEN** an einem Eintrag nur ein Foto hängt und die Spalte kein „+n“ trägt
- **THEN** öffnet „Vorschau: <Datei>“ im Zeilenmenü die Großansicht, und wer Originale laden darf,
  findet dort „Original (mit Standort): <Datei> herunterladen“

#### Scenario: Anhang am Spiegel noch nicht da
- **WHEN** die Instanz ein Spiegel ist und der Anhang noch nicht geholt wurde
- **THEN** meldet „herunterladen“ im Zeilenmenü „wird geholt“ und speichert keine Datei

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
