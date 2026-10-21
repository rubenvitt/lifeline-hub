# lagekarte-zeichnen Specification

## Purpose
Macht das Zeichnen von Flächen und Linien auf der Lagekarte korrigierbar: einzelne Punkte lassen sich
zurücknehmen, der Stand ist sichtbar, und Esc verwirft nie still, sondern schrittweise und quittiert.

## Requirements

### Requirement: Letzten Punkt zurücknehmen
Während eine Figur gezeichnet wird, SHALL die Zeichnen-Steuerung einen Knopf „Letzten Punkt zurück"
anbieten. Ein Klick MUST genau den zuletzt gesetzten Punkt der laufenden Figur entfernen und die übrigen
Punkte unverändert lassen. Der Knopf MUST gesperrt sein, solange die laufende Figur keinen Punkt hat,
und seine Freigabe MUST jeder Änderung des Zeichenstands ohne weiteres Zutun folgen (Punkt gesetzt,
Punkt zurückgenommen, Figur verworfen, Zeichnen gestartet oder beendet). Das Zurücknehmen des letzten
verbliebenen Punktes SHALL keine Verwerfen-Quittung auslösen.

#### Scenario: Ein Punkt wird zurückgenommen
- **WHEN** drei Punkte einer Fläche gesetzt sind und „Letzten Punkt zurück" geklickt wird
- **THEN** hat die Figur zwei Punkte, der dritte ist von der Karte verschwunden, und „Abschließen" ist wieder gesperrt

#### Scenario: Ohne Punkt gesperrt, mit Punkt frei
- **WHEN** das Zeichnen gestartet ist und noch kein Punkt gesetzt wurde
- **THEN** ist „Letzten Punkt zurück" gesperrt
- **WHEN** danach ein Punkt gesetzt wird
- **THEN** ist der Knopf frei

#### Scenario: Nach dem Zurücknehmen des letzten Punktes wieder gesperrt
- **WHEN** genau ein Punkt gesetzt ist und „Letzten Punkt zurück" geklickt wird
- **THEN** hat die Figur keinen Punkt, der Knopf ist gesperrt, der Zeichenmodus bleibt aktiv, und es erscheint keine Quittung „Zeichnung verworfen"

### Requirement: Punktzähler in der Zeichnen-Steuerung
Die Zeichnen-Steuerung SHALL während der Zeichenphase die Zahl der gesetzten Punkte der laufenden Figur
als Text anzeigen. Die Zahl MUST beim Setzen, Zurücknehmen und Verwerfen mitgehen.

#### Scenario: Zähler folgt Setzen und Zurücknehmen
- **WHEN** drei Punkte gesetzt und einer zurückgenommen wird
- **THEN** zeigt die Steuerung „2 Punkte"

### Requirement: Esc wirkt beim Zeichnen zweistufig
Esc SHALL beim Zeichnen schrittweise Richtung reiner Ansicht führen, und jede Stufe MUST sichtbar sein:

1. Ist eine Figur angefangen (mindestens ein Punkt) oder in der Bestätigungsphase fertig, aber noch
   nicht gespeichert, MUST Esc diese Figur verwerfen, den Zeichenmodus aktiv lassen (aus der
   Bestätigungsphase zurück in die Zeichenphase desselben Typs und derselben Form) und die Quittung
   „Zeichnung verworfen" zeigen.
2. Ist keine Figur angefangen, MUST Esc den Zeichenmodus beenden. Sind in einer laufenden Serie schon
   Objekte gespeichert, MUST das wie „Fertig" wirken: die gespeicherten Objekte bleiben.

Esc MUST keine Wirkung haben, solange ein Speichern läuft, solange der Fokus in einem Eingabefeld
liegt oder wenn ein anderes Element die Taste bereits verarbeitet hat (z. B. ein offenes Menü oder ein
Dialog). Die Wirkung MUST unabhängig davon eintreten, ob die Karte oder ein Knopf der Steuerung den Fokus
hat. Die Zeichnen-Steuerung SHALL beide Stufen als Hinweis nennen.

#### Scenario: Erstes Esc verwirft die angefangene Figur
- **WHEN** drei Punkte einer Fläche gesetzt sind und Esc gedrückt wird
- **THEN** ist die Figur von der Karte verschwunden, die Steuerung zeigt „0 Punkte", der Zeichenmodus ist weiter aktiv, und die Quittung „Zeichnung verworfen" erscheint

#### Scenario: Zweites Esc beendet das Zeichnen
- **WHEN** danach ohne neuen Punkt noch einmal Esc gedrückt wird
- **THEN** ist die Zeichnen-Steuerung geschlossen und die Karte ist in der reinen Ansicht

#### Scenario: Esc in der Bestätigungsphase
- **WHEN** eine Fläche abgeschlossen, aber noch nicht gespeichert ist und Esc gedrückt wird
- **THEN** ist die Figur verworfen, nichts wurde gespeichert, die Steuerung steht wieder in der Zeichenphase desselben Zonentyps, und die Quittung „Zeichnung verworfen" erscheint

#### Scenario: Esc bei laufendem Speichern
- **WHEN** das Speichern einer Figur läuft und Esc gedrückt wird
- **THEN** ändert sich nichts

#### Scenario: Esc im Eingabefeld
- **WHEN** der Fokus in einem Textfeld liegt und Esc gedrückt wird
- **THEN** bleibt die Figur unverändert

#### Scenario: Esc beendet eine Serie mit Gespeichertem
- **WHEN** in einer Zonen-Serie schon eine Zone gespeichert ist, keine Figur angefangen ist und Esc gedrückt wird
- **THEN** endet der Zeichenmodus und die gespeicherte Zone bleibt erhalten

### Requirement: Kreis um einen Punkt
Jede Zonenart mit Fläche SHALL sich als Kreis zeichnen lassen; eine Absperrgrenze (Linie) MUST
NOT. Der Radius in Metern MUST als Zahl eingebbar sein, mit Schnellwahl 50, 100, 300, 500 und
1000 m, größer als 0 und höchstens 50 000 m. Die Mitte MUST per Tipp auf die Karte setzbar sein
und, wenn vorhanden, aus Einsatzort oder Suchnadel übernehmbar. Ein Griff am Kreisrand MUST den
Radius durch Ziehen setzen; die Karte bleibt außerhalb des Griffs verschiebbar.

#### Scenario: Linie ist kein Kreis
- **WHEN** das Werkzeugmenü offen ist
- **THEN** bietet die Absperrgrenze keinen Eintrag „Kreis“

### Requirement: Kreis anlegen
„Übernehmen“ SHALL einen Kreis sofort als Zone anlegen, ohne zweite Bestätigung. Gespeichert MUST
eine Fläche mit 64 Ecken werden, die der Server aus Mitte und Radius rechnet, dazu Mitte und Radius;
die Abweichung vom Kreis MUST höchstens 1 % betragen. Der Einsatztagebuch-Eintrag MUST den Radius
nennen („Absperrbereich «Nord» eingerichtet · Kreis r = 300 m“). Für das Esc gilt die Mitte als
angefangene Figur.

#### Scenario: Absperrbereich mit 300 m
- **WHEN** der Mensch im Werkzeugmenü beim Absperrbereich „Kreis“ wählt, auf die Karte tippt, „300 m“ wählt und „Übernehmen“ tippt
- **THEN** steht ein Absperrbereich als Kreis mit Radius 300 m um die getippte Stelle, und das Einsatztagebuch nennt „Kreis r = 300 m“

#### Scenario: Radius über der Grenze
- **WHEN** ein Radius über 50 000 m an den Server geht
- **THEN** lehnt der Server mit 400 ab, und es entsteht keine Zone

#### Scenario: Esc mit gesetzter Mitte
- **WHEN** beim Kreis die Mitte gesetzt ist und Esc gedrückt wird
- **THEN** ist die Mitte verworfen, der Radius bleibt eingetragen, und das Zeichnen läuft weiter

### Requirement: Radius einer Kreiszone ändern
Der Zonen-Inspector SHALL bei einer Kreiszone den Radius zeigen und mit Schreibrecht änderbar
machen. Eine Änderung MUST die Fläche um dieselbe Mitte neu rechnen und im Einsatztagebuch
„<Art> «Name»: Radius 300 m → 500 m“ schreiben. Die Karte MUST eine Kreiszone mit dem Radius
beschriften („Nord · r = 300 m“). Eine punktweise geänderte Fläche MUST ihre Kreisangaben
verlieren; ein Radius an einer Zone ohne Kreis MUST mit 422 abgelehnt werden.

#### Scenario: Radius von 300 auf 500 m
- **WHEN** im Inspector einer Kreiszone der Radius auf 500 m gesetzt und das Feld verlassen wird
- **THEN** ist der Kreis um dieselbe Mitte 500 m groß, und das Einsatztagebuch nennt „Radius 300 m → 500 m“

#### Scenario: Punktweise geändert
- **WHEN** eine Kreiszone eine neue Fläche bekommt
- **THEN** zeigt der Inspector keinen Radius mehr

### Requirement: Messen bleibt einstufig
Das Messwerkzeug der Lagekarte SHALL weiterhin mit einem einzigen Esc enden; die Zweistufigkeit gilt
nur für das Zeichnen speicherbarer Figuren.

#### Scenario: Esc beim Messen
- **WHEN** eine Strecke gemessen wird und Esc gedrückt wird
- **THEN** endet das Messwerkzeug

### Requirement: Radius messen
Das Messwerkzeug SHALL neben Strecke und Fläche die Form „Radius“ anbieten: der erste Punkt ist
die Mitte, der zweite der Rand. Angezeigt MUST der Radius („r = 300 m“) und daneben die Fläche des
Kreises werden. Gespeichert MUST nichts werden.

#### Scenario: Radius zwischen zwei Punkten
- **WHEN** in der Form „Radius“ eine Mitte und ein Rand im Abstand von 300 m gesetzt sind
- **THEN** zeigt das Messwerkzeug „r = 300 m“ und die Kreisfläche von 28,3 ha

### Requirement: Zeichnen per Link
Die Lagekarte SHALL einen Link mit dem Auftrag `zeichnen=<zonentyp>` annehmen und dann den
Zeichenmodus dieses Zonentyps betreten, genau so, als wäre der Eintrag des Typs im Werkzeugmenü
gewählt worden. Angenommen MUST jeder Zonentyp werden, den das Werkzeugmenü anbietet. Für einen
Typ, der Fläche und Linie erlaubt, MUST der Auftrag die Form als `:flaeche` oder `:linie`
annehmen; fehlt sie, MUST die Fläche gelten. Für einen Typ mit fester Geometrie MUST eine abweichende Form den
Auftrag ungültig machen.

Der Modus MUST nur betreten werden, wenn die Person im Einsatz schreiben darf und die Karte keinen
eingefrorenen Stand zeigt. Solange Einsatz und Rechte noch laden, MUST der Auftrag stehen bleiben.
Danach MUST der Auftrag aus der Adresse entfernt werden, auch wenn er ungültig war oder mangels
Schreibrecht nicht ausgeführt wurde, damit ein Neuladen die Karte nicht erneut in den Modus schickt.
Das Zeichnen per Link MUST denselben Regeln folgen wie das Zeichnen über das Werkzeugmenü,
insbesondere dem zweistufigen Esc.

Ein Auftrag MAY einen Bezug `bezirk=<id>` tragen (LLH-1069). Er MUST nur am Typ
`evakuierungsbezirk` gelten; an einem anderen Typ oder mit unbrauchbarer Kennung MUST der ganze
Auftrag verworfen werden. Mit Bezug MUST die Karte zusätzlich warten, bis die Modulfreigaben und die
Bezirke feststehen, und nur für einen nicht stornierten Bezirk dieses Einsatzes bei lesbarem Modul
Evakuierung starten. Die gespeicherte Fläche MUST dann die Bezeichnung und die Zuordnung des Bezirks
tragen; der Bezug MUST keine Serie fortsetzen. `bezirk` MUST mit dem Auftrag aus der Adresse entfernt
werden, auch allein.

#### Scenario: Gefahrengebiet per Link
- **WHEN** eine Person mit Schreibrecht die Lagekarte mit dem Auftrag `zeichnen=gefahrengebiet` öffnet
- **THEN** steht die Karte im Zeichenmodus für ein Gefahrengebiet als Fläche, die Zeichnen-Steuerung ist sichtbar, und der Auftrag ist aus der Adresse verschwunden

#### Scenario: Neuladen nach dem Auftrag
- **WHEN** die Seite danach neu geladen wird
- **THEN** startet kein Zeichenmodus

#### Scenario: Freie Skizze als Linie
- **WHEN** der Auftrag `zeichnen=freie_skizze:linie` lautet
- **THEN** startet das Zeichnen einer freien Skizze als Linie

#### Scenario: Unpassende Form
- **WHEN** der Auftrag `zeichnen=absperrgrenze:flaeche` lautet
- **THEN** startet kein Zeichenmodus, und der Auftrag ist aus der Adresse verschwunden

#### Scenario: Unbekannter Typ
- **WHEN** der Auftrag einen Typ nennt, den das Werkzeugmenü nicht kennt
- **THEN** startet kein Zeichenmodus, und der Auftrag ist aus der Adresse verschwunden

#### Scenario: Ohne Schreibrecht
- **WHEN** eine Person ohne Schreibrecht im Einsatz den Link öffnet
- **THEN** zeigt die Karte die reine Ansicht ohne Zeichenmodus, und der Auftrag ist aus der Adresse verschwunden

#### Scenario: Kaltstart über den Link
- **WHEN** der Link in einem neuen Tab geöffnet wird und der Einsatz erst nach dem ersten Bild geladen ist
- **THEN** startet der Zeichenmodus, sobald Einsatz und Rechte feststehen, und der Auftrag wird nicht vorher verworfen

#### Scenario: Bezug an einem anderen Typ
- **WHEN** der Auftrag `zeichnen=gefahrengebiet&bezirk=5` lautet
- **THEN** startet kein Zeichenmodus, und beide Parameter sind aus der Adresse verschwunden

#### Scenario: Bezug beim Kaltstart
- **WHEN** der Auftrag `zeichnen=evakuierungsbezirk&bezirk=5` in einem neuen Tab geöffnet wird und die Bezirke erst nach dem ersten Bild geladen sind
- **THEN** startet der Zeichenmodus für Bezirk 5, sobald die Bezirke feststehen, und der Auftrag wird nicht vorher verworfen

#### Scenario: Esc nach dem Link
- **WHEN** der Zeichenmodus per Link gestartet ist, noch kein Punkt gesetzt ist und Esc gedrückt wird
- **THEN** endet der Zeichenmodus

### Requirement: Kreis per Link
Für jeden Zonentyp mit Fläche SHALL der Zeichnen-Auftrag die Form `:kreis` annehmen und das
Zeichnen eines Kreises starten. Die Adresse ist ein stabiler Vertrag für andere Module:
`zeichnen=<zonentyp>:kreis[&radius=<meter>][&mitte=<breite>,<länge>]`. `radius` MUST eine Zahl in
Metern sein, größer als 0 und höchstens 50 000; `mitte` MUST wie `zentrum=` geschrieben sein
(WGS84, Breite vor Länge). Beide belegen nur vor; angelegt MUST erst nach „Übernehmen“ werden.

#### Scenario: Evakuierungsbezirk als Kreis mit Vorbelegung
- **WHEN** eine Person mit Schreibrecht die Lagekarte mit `zeichnen=evakuierungsbezirk:kreis&radius=300&mitte=54.1,9.5` öffnet
- **THEN** steht das Kreis-Band für einen Evakuierungsbezirk mit Radius 300 m und der Mitte 54,1° N 9,5° O, es ist noch keine Zone angelegt, und `zeichnen`, `radius` und `mitte` sind aus der Adresse verschwunden

### Requirement: Teile des Kreis-Links fallen einzeln weg
Ein unbrauchbarer `radius` oder eine unbrauchbare `mitte` SHALL einzeln wegfallen, ohne den
Auftrag ungültig zu machen. Ohne `:kreis` MUST `radius` und `mitte` wirkungslos bleiben. Die Seite
MUST `zeichnen`, `radius` und `mitte` gemeinsam aus der Adresse entfernen, auch bei einem
ungültigen Auftrag.

#### Scenario: Unbrauchbarer Radius im Link
- **WHEN** der Auftrag `zeichnen=absperrbereich:kreis&radius=80000` lautet
- **THEN** startet das Kreis-Band für einen Absperrbereich ohne vorbelegten Radius

#### Scenario: Linie als Kreis
- **WHEN** der Auftrag `zeichnen=absperrgrenze:kreis` lautet
- **THEN** startet kein Zeichenmodus, und `zeichnen`, `radius` und `mitte` sind aus der Adresse verschwunden

### Requirement: Vorgabefarbe einer freien Skizze

Eine freie Skizze ohne gespeicherte Farbe SHALL in genau einer Vorgabefarbe gezeichnet werden.
Dieselbe Vorgabe MUST beim Anlegen (Fläche und Linie), in der Kartendarstellung und als Wert des
Farbfelds im Zonen-Inspector gelten. Die Vorgabe ist ein gespeicherter Datenwert und MUST NOT
mit dem Hell-/Nachtmodus wechseln.

#### Scenario: Farbfeld unverändert verlassen
- **WHEN** im Zonen-Inspector einer freien Skizze ohne gespeicherte Farbe das Farbfeld fokussiert und ohne Änderung verlassen wird
- **THEN** schreibt der Inspector nichts an den Server

#### Scenario: Neue Skizze trägt die Vorgabe
- **WHEN** eine freie Skizze als Fläche oder als Linie neu angelegt wird
- **THEN** wird sie mit der Vorgabefarbe gespeichert, und die Karte zeichnet sie in derselben Farbe

#### Scenario: Moduswechsel
- **WHEN** zwischen Hell- und Nachtmodus gewechselt wird
- **THEN** behalten bestehende und neue freie Skizzen ihre Farbe

### Requirement: Werkzeugmenü an der Karte
Der Kartenknopf „Zeichenwerkzeuge“ SHALL für Personen mit Schreibrecht ein Werkzeugmenü öffnen,
nicht bei eingefrorenem Stand. Es MUST die Gruppen „Flächen und Linien“ und „Taktisches Zeichen“
tragen. Ein Eintrag MUST denselben Modus starten wie der Zeichnen-Auftrag per Link und das Menü
schließen. Messen MUST NOT im Menü stehen; es bleibt der eigene Kartenknopf „Messen“ mit seinen
Formen in der Mess-Steuerung.

#### Scenario: Absperrbereich aus dem Menü
- **WHEN** eine Person mit Schreibrecht „Zeichenwerkzeuge“ und dann „Absperrbereich“ wählt
- **THEN** steht die Karte im Zeichenmodus für einen Absperrbereich als Fläche, und das Menü ist zu

#### Scenario: Ohne Schreibrecht
- **WHEN** eine Person ohne Schreibrecht die Lagekarte öffnet
- **THEN** gibt es keinen Knopf „Zeichenwerkzeuge“, und der Knopf „Messen“ steht da

#### Scenario: Kein Messen im Menü
- **WHEN** das Menü offen ist
- **THEN** trägt es keinen Eintrag zum Messen

### Requirement: Flächen und Linien im Werkzeugmenü
Die Gruppe „Flächen und Linien“ SHALL jeden Zonentyp in jeder erlaubten Form anbieten. Der
Eintrag mit dem Namen des Typs MUST seine Vorgabeform starten (Fläche, bei einer Linienart die
Linie); daneben MUST jede weitere Form stehen: „Linie“ bei einem Typ mit Fläche und Linie,
„Kreis“ bei jeder Flächenart.

#### Scenario: Freie Skizze als Linie
- **WHEN** die Person im Menü bei „Freie Skizze“ die Form „Linie“ wählt
- **THEN** startet das Zeichnen einer freien Skizze als Linie in der Vorgabefarbe

#### Scenario: Kreis je Flächenart
- **WHEN** das Menü offen ist
- **THEN** trägt jede Flächenart einen Eintrag „Kreis“ und die Absperrgrenze keinen

### Requirement: Taktisches Zeichen im Werkzeugmenü
Die Gruppe „Taktisches Zeichen“ SHALL die zuletzt verwendeten Zeichen zum direkten Platzieren
tragen und „Weitere …“, das den Zeichen-Picker als Dialog öffnet. Läuft schon ein Taktisches
Zeichen, MUST die Gruppe nur den Zustand zeigen; bedient wird der Modus im Modus-Band bzw. im
Fuß-Band.

#### Scenario: Zuletzt verwendetes Zeichen
- **WHEN** die Person im Menü das zuletzt verwendete Zeichen „Löschfahrzeug“ tippt und dann die Karte
- **THEN** ist das Zeichen dort gesetzt, ohne dass der Picker offen war

#### Scenario: Weitere Zeichen
- **WHEN** die Person im Menü „Weitere …“ wählt
- **THEN** ist das Menü zu, und der Zeichen-Picker steht als Dialog mit „Platzieren“ und „Abbrechen“

### Requirement: Das Werkzeugmenü hängt am Knopf
Das Werkzeugmenü SHALL allein über den Knopf „Zeichenwerkzeuge“ aufgehen, neben der Knopfspalte
stehen und vom Knopf als auf- und zugeklappt gemeldet werden. Es MUST kein Kontextmenü an einer
Kartenstelle sein (keine Klickebene, kein `contextmenu`). Es MUST per Esc und bei einem Tipp
außerhalb von Menü und Knopf schließen, ohne einen laufenden Modus zu ändern.

#### Scenario: Esc schließt nur das Menü
- **WHEN** das Menü während des Zeichnens eines Gefahrengebiets mit einem gesetzten Punkt offen ist und Esc gedrückt wird
- **THEN** ist das Menü zu, der Punkt bleibt, und der Zeichenmodus läuft weiter

### Requirement: Das Werkzeugmenü verdeckt keine Bedienung
Das Werkzeugmenü MUST bei 390 px und 768 px weder den Knopfblock noch ein Band des Kartenfußes
verdecken; passt es nicht, rollt es in sich. Jeder Eintrag MUST in jeder Dichtestufe mindestens
die kleine Steuerhöhe erreichen (24 / 48 / 72 px).

#### Scenario: Handschuh bei 390 px
- **WHEN** bei 390 px in der Dichte „Handschuh“ das Menü offen ist
- **THEN** ist jeder Eintrag mindestens 72 px hoch, und Knopfblock und Fuß-Bänder bleiben antippbar
