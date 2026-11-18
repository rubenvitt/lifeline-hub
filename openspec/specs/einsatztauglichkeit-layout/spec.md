# einsatztauglichkeit-layout Specification

## Purpose
Gerenderte Layout-Zusicherungen der Bedien-Leitlinie für die dichtesten Einsatzflächen:
Treffflächen folgen der Dichtestufe, angepinnte und schwebende Leisten lassen genug Fläche
übrig, und kein Fokusziel verschwindet beim Tabben vollständig hinter einem Aufbau.

Bezugsgrößen dieser Spec: **Fükw** 1366 × 768, **Führungs-Tablet** 1024 × 768,
**Handschirm** 390 × 844. Dichtestufen `kompakt`, `komfortabel`, `handschuh` mit den
Steuerhöhen 30 / 48 / 72 px (`controlHeightSM` 24 / 48 / 72 px).

## Requirements

### Requirement: Trefffläche folgt der Dichtestufe

Die folgenden Bedienziele SHALL in jeder Dichtestufe mindestens die Steuerhöhe der Stufe
erreichen (30 / 48 / 72 px). Menüeinträge in einem aufgeklappten Menü MUST mindestens
`controlHeightSM` erreichen (24 / 48 / 72 px). Ziele ohne Beschriftung (nur Symbol oder ein
Kürzel) MUST diesen Boden auf **beiden** Achsen erreichen. Kartenknöpfe haben den Boden
32 / 48 / 72 px. Für die Ziele der Modul-Prüflisten (ab „Kommunikation“) gilt in `kompakt` der
Boden aus A1 Gate 3 (24 px), in `komfortabel` und `handschuh` die Steuerhöhe; unbeschriftete
Ziele dort tragen die kleine Steuerhöhe (24 / 48 / 72) auf beiden Achsen.

- ETB: Zeilen des Slash-Menüs, Auslöser „Aktionen zu Eintrag N“ und die Einträge seines
  Menüs, dazu Textfeld und Knopf „Erfassen“ der Schnellerfassung, der Entwurfstab und sein
  Schließen-Kreuz.
- Lagekarte: die Segmente „Ebenen“, „Objekte“ und „Auswahl“ der Kartenleiste, im Ebenenbaum
  die Zeilen, die Gruppenköpfe und die Gruppenschalter, in der Objektliste die Marke „Nicht
  verortet“, die Gruppenköpfe, die Zeilen und ihre Knöpfe, der Rückweg der Auswahl, die fünf
  Kartenknöpfe (Hineinzoomen, Herauszoomen, Nach Norden ausrichten, Messen, Zeichenwerkzeuge) und
  die Knöpfe der ausgeklappten Zeitachse, einschließlich „Abspielen“.
- Gefahrenmatrix: alle 58 Zell-Auslöser und die Gebietszeilen.
- Kommunikation (Meldungen, Erinnerungen, Nachforderungen, Aufträge und Befehle, Chat): die
  Primäraktion des Seitenkopfs, die Aktionsknöpfe und Auswahlfelder jeder Karte, auf der Seite
  Aufträge die Tabs „Einzelaufträge“ und „Einsatzbefehle“, die Status-Segmente und das Suchfeld
  beider Reiter, das Auswahlziel jeder Auftrags- und Befehlskarte und die Handlungen und Sprünge
  des Detailpaneels, im Chat Eingabefeld und Senden-Knopf.
- Einsatz-Einstellungen: die Sektionswahl, Auswahl- und Zahlfelder, der Speichern-Knopf und die
  Modulzeilen (Schalter, Rollenauswahl), in der Sektion „Zugriff“ die Personen- und
  Rollenauswahl, „Hinzufügen“ und die Aktionen jeder Mitgliederzeile. Einsatzdaten: die
  Bearbeiten- und Eintragen-Knöpfe der Zeilen und die Nebenwege im Seitenkopf. Profil: „Passwort ändern“ und „2FA einrichten“. Die
  Verwaltungsseite „Anzeige“: Auswahlfelder und Speichern-Knopf.
- Verwaltung: die Zeilenknöpfe der Fahrzeug-Katalogseite; Text-, Auswahl- und Zahlfelder und der
  Speichern-Knopf der Fahrzeug-Detailseite; die Rollenauswahl der Modulzeilen und der
  Speichern-Knopf der Seite „Einsatz-Vorgaben“.
- Einsatzabschnitte: die Baumknoten, ihre Aufklapper und die Aktionen der Detailkarte.
  Bereitstellungsraum: der Raumwechsler und die Knöpfe „zuweisen“ der Leiste „Kräfte ohne BR“.
- Lagebericht: die Sprungziele der Gliederung und der Umschalter „Bearbeiten | Lesefassung“ des
  Entwurfs und die Kopfaktionen der Detailseite, „Neuer
  Bericht“ und der Link einer Berichtskarte, die Filtersegmente und das Suchfeld der Seite
  „Lagemeldungen“.
- Seitenkopf: jeder Link im Ortspfad (Brotkrume) jeder Seite, die den gemeinsamen Seitenkopf
  trägt, auch im Kopf der Verwaltungsseiten (etwa „Fahrzeuge“ bzw. „Personal“ über der
  Fahrzeug- und der Personal-Detailseite der Stammdaten). Seine Schrift MUST dabei 12 px bleiben; die Trefffläche wächst um Fläche über und
  unter dem Text, nicht über die Schrift. Der Ortspfad MUST den Seitenkopf in `kompakt` am
  Fükw-Schirm nicht über seine 44 px heben. Jeder Link im Ortspfad MUST zudem mindestens so breit
  sein wie ein Knopf der Stufe (`controlHeightSM`: 24 / 48 / 72 px), auch bei einem kurzen Wort
  wie „ETB“.
- Hinweise: das Schließen-Kreuz jedes schließbaren Hinweises (Hinweisfläche über dem Inhalt einer
  Seite, eines Paneels oder einer Leiste). Es ist ein unbeschriftetes Ziel und MUST die kleine
  Steuerhöhe (24 / 48 / 72 px) auf beiden Achsen erreichen; der Hinweis MUST dadurch nicht höher
  werden als ohne diesen Boden.

Nicht Teil dieser Zusicherung sind Kennungs-Links in Tabellenzellen, beschriftete Checkboxen
und das Löschkreuz eines Auswahlfelds (das Feld selbst ist das gleichwertige Ziel). Gibt es zum
Löschkreuz keinen anderen Weg zurück zum leeren Zustand, gilt die Ausnahme nicht: Die
Sortierauswahl der Kartenansicht einer Liste MUST die gelieferte Reihenfolge („wie geliefert“) als
eigenen Eintrag der Auswahl führen und trägt kein Löschkreuz.

#### Scenario: Handschuh-Betrieb
- **WHEN** die Dichtestufe `handschuh` gewählt ist und die Seite neu geladen wurde
- **THEN** misst jedes genannte Ziel mindestens 72 px in der Höhe und jedes unbeschriftete Ziel zusätzlich mindestens 72 px in der Breite

#### Scenario: Die Stufe schlägt tatsächlich durch
- **WHEN** dieselben Ziele in `kompakt` gemessen werden
- **THEN** ist ihre Höhe kleiner als in `handschuh` (ausgenommen das mehrzeilige Textfeld der Schnellerfassung, dessen Höhe der Inhalt bestimmt), und keine Matrixzelle ist in `kompakt` 48 px oder breiter

#### Scenario: Abspielknopf der Zeitachse
- **WHEN** die Zeitachse der Lagekarte auf dem Handschirm ausgeklappt ist
- **THEN** ist der Knopf „Abspielen“ in jeder Stufe mindestens so breit wie hoch

#### Scenario: Nur-Lese-Zweig im Handschuh-Betrieb
- **WHEN** eine Person ohne Schreibrecht (Beobachter bzw. Führungskraft in der Verwaltung) eine der neu genannten Flächen in `handschuh` öffnet
- **THEN** steht der Rechtehinweis, wo die Seite einen trägt, und die Aktion ist gesperrt oder abwesend
- **AND** misst jedes verbleibende genannte Ziel mindestens 72 px in der Höhe

#### Scenario: Brotkrume im Handschuh-Betrieb
- **WHEN** die Dichtestufe `handschuh` gewählt ist und eine Seite mit zwei Links im Ortspfad (etwa „Einsätze“ und das Modul über der Druckansicht einer Liste) am Fükw-Schirm und auf dem Handschirm steht
- **THEN** misst jeder Link im Ortspfad mindestens 72 px in der Höhe, und seine Schrift ist 12 px groß

#### Scenario: Brotkrume in kompakt
- **WHEN** dieselbe Seite in `kompakt` am Fükw-Schirm steht
- **THEN** misst jeder Link im Ortspfad mindestens 30 px in der Höhe, und der Seitenkopf ist 44 px hoch

#### Scenario: Brotkrume der Stammdaten-Detailseiten
- **WHEN** die Fahrzeug- oder die Personal-Detailseite der Stammdaten am Fükw-Schirm und auf dem Handschirm steht
- **THEN** misst der Link „Fahrzeuge“ bzw. „Personal“ im Ortspfad in `handschuh` mindestens 72 px und in `kompakt` mindestens 30 px in der Höhe, und seine Schrift ist in jeder Stufe 12 px groß

#### Scenario: Liste und Detail der Aufträge im Handschuh-Betrieb
- **WHEN** die Dichtestufe `handschuh` gewählt ist und auf dem Handschirm ein offener Auftrag mit offenem Empfänger aufgeklappt ist
- **THEN** misst das Auswahlziel jeder Karte und jeder Knopf des Detailpaneels („Quittieren“, „Bearbeitung beginnen“, „Vollzug melden“) mindestens 72 px in der Höhe

#### Scenario: Schließen-Kreuz eines Hinweises
- **WHEN** ein schließbarer Hinweis steht (etwa „Posten #… gibt es nicht (mehr)“ nach einem Deeplink auf einen unbekannten Posten) und die Dichtestufe `kompakt`, `komfortabel` bzw. `handschuh` gewählt ist
- **THEN** trifft ein Tipp das Kreuz „Hinweis schließen“ auf einer Fläche von mindestens 24 × 24, 48 × 48 bzw. 72 × 72 px
- **AND** ist der Hinweis so hoch wie ohne diesen Boden

#### Scenario: Kurzer Link im Ortspfad
- **WHEN** eine Seite mit dem Link „ETB“ im Ortspfad (Druckansicht des ETB) in `kompakt` bzw. `handschuh` steht
- **THEN** ist dieser Link mindestens 24 bzw. 72 px breit, und seine Schrift ist 12 px groß

#### Scenario: Sortierung zurücksetzen am Handschirm
- **WHEN** eine Liste in der Kartenansicht auf dem Handschirm nach einer Spalte sortiert ist
- **THEN** führt die Sortierauswahl den Eintrag „wie geliefert“, und seine Wahl stellt die gelieferte Reihenfolge wieder her
- **AND** trägt die Sortierauswahl kein Löschkreuz

### Requirement: Abstand zwischen klickbaren Kennzahlen

Zwei benachbarte klickbare Kennzahlen eines Kennzahlenbands SHALL in der Dichtestufe
`komfortabel` mindestens 8 px und in `handschuh` mindestens 16 px Abstand zwischen ihren
Treffflächen halten, gemessen auf beiden Achsen. Das Band MUST dabei sein Fugenraster
behalten: die sichtbare Linie zwischen zwei Zellen bleibt in jeder Stufe 1 px breit. Jede
Trefffläche MUST weiterhin die Steuerhöhe der Stufe erreichen (30 / 48 / 72 px).

#### Scenario: Handschuh-Betrieb auf dem Lage-Dashboard
- **WHEN** die Dichtestufe `handschuh` gewählt ist und das Band „Lage in Zahlen“ mit seinen sechs klickbaren Kennzahlen am Fükw-Schirm steht
- **THEN** liegt zwischen jeder Kennzahl und ihrem nächsten anderen Bedienziel im Band ein Abstand von mindestens 16 px, und jede Kennzahl ist mindestens 72 px hoch

#### Scenario: Touch-Betrieb
- **WHEN** dieselbe Seite in der Stufe `komfortabel` steht
- **THEN** beträgt der kleinste Abstand zwischen zwei Kennzahlen mindestens 8 px

#### Scenario: Die Fuge bleibt eine Fuge
- **WHEN** das Band in `handschuh` steht
- **THEN** ist der Spalt zwischen zwei benachbarten Zellflächen weiterhin 1 px breit, und zwischen Zellrand und Trefffläche liegt Zellfläche, keine Linienfarbe

#### Scenario: Kompakt bleibt unverändert
- **WHEN** das Band in `kompakt` steht
- **THEN** füllt die Trefffläche jeder klickbaren Kennzahl ihre Zelle vollständig aus

### Requirement: Klappkopf folgt der Dichtestufe

Jeder Klappkopf eines aufklappbaren Abschnitts („Weitere Angaben“ in Erfassungsmasken und
jede andere Stelle der App) SHALL in jeder Dichtestufe mindestens die Steuerhöhe der Stufe
erreichen (30 / 48 / 72 px). Seine Beschriftung MUST senkrecht mittig im Kopf stehen. Ein
Kopf, der schon höher ist als der Boden, MUST NOT gekürzt werden.

#### Scenario: Handschuh-Betrieb im Ablegen-Dialog
- **WHEN** die Dichtestufe `handschuh` gewählt ist und der Dialog „Dokument ablegen“ offen ist
- **THEN** misst der Klappkopf „Bezug (optional)“ mindestens 72 px in der Höhe

#### Scenario: Touch-Betrieb
- **WHEN** derselbe Dialog in der Stufe `komfortabel` steht
- **THEN** misst der Klappkopf mindestens 48 px

#### Scenario: Kompakt wird nicht gekürzt
- **WHEN** derselbe Dialog in der Stufe `kompakt` steht
- **THEN** misst der Klappkopf mindestens 30 px und ist nicht niedriger als vor dieser Änderung

### Requirement: Abstand zwischen den Knöpfen eines Dialogfußes

In der Fußzeile einer Erfassungsmaske und in jeder Rückfrage (Dialog mit Standardfuß,
Bestätigungsdialog, Bestätigungsblase) SHALL zwischen zwei benachbarten Knöpfen in der
Dichtestufe `komfortabel` mindestens 8 px und in `handschuh` mindestens 16 px Abstand liegen.
Jeder dieser Knöpfe MUST weiterhin mindestens `controlHeightSM` der Stufe erreichen
(24 / 48 / 72 px).

#### Scenario: Erfassungsfuß im Handschuh-Betrieb
- **WHEN** die Dichtestufe `handschuh` gewählt ist und der Dialog „Dokument ablegen“ offen ist
- **THEN** liegen zwischen „Abbrechen“ und „Ablegen“ mindestens 16 px, und beide Knöpfe sind mindestens 72 px hoch

#### Scenario: Bestätigungsblase im Handschuh-Betrieb
- **WHEN** in `handschuh` die Rückfrage zum Entfernen eines Dokuments offen ist
- **THEN** liegen zwischen ihrem Abbrechen-Knopf und dem roten Bestätigungsknopf mindestens 16 px

#### Scenario: Touch-Betrieb
- **WHEN** dieselben Füße in der Stufe `komfortabel` stehen
- **THEN** beträgt der Abstand zwischen den Knöpfen mindestens 8 px

#### Scenario: Dialog mit Standardfuß
- **WHEN** ein Dialog mit dem Standardfuß (Abbrechen und Bestätigen) in `handschuh` geöffnet wird
- **THEN** liegen zwischen beiden Knöpfen mindestens 16 px, und der Abstand zwischen Titel und Inhalt des Dialogs ist derselbe wie vor dieser Änderung

### Requirement: Kein Fokusziel vollständig verdeckt

Beim Durchlauf mit der Tabulatortaste MUST kein fokussiertes Ziel vollständig von einem
angepinnten, fixierten oder schwebenden Aufbau der Seite verdeckt sein (WCAG 2.4.11).
„Vollständig verdeckt“ heißt: Das Rechteck des Ziels liegt ganz innerhalb des Aufbaus, und
am Mittelpunkt des Ziels liegt nicht das Ziel selbst. Das gilt auf dem Handschirm und im
Fükw in `kompakt` und `handschuh`, auch bei geringer Fensterhöhe, solange die Seite einen
Bildlauf hat.

- ETB: die angepinnte Erfassungsleiste gegenüber den Zielen der Zeitachse.
- Gefahrenmatrix: die stehende Kopfzeile und die fixierte Spalte „Gefahr“ gegenüber den
  Zell-Auslösern, sobald die Tabelle waagerecht überläuft.
- Lagekarte und Personenkarte: Knopfblock, Überlagerung links und die Bänder des
  Kartenfußes gegenüber allen Zielen der Kartenspalte.
- Personenliste: die stehende Kopfzeile der Tabelle.
- Tabellen mit stehender Kopfzeile und waagerechtem Scrollen (Katalogtabelle, Tabellenzweig der
  Datensicht, Gefahrenmatrix): rückwärts in die erste Zeile getabbt, MUST das Ziel ganz unter
  der Kopfzeile stehen, auch wo der Browser den Fokusabstand am Scrollcontainer beschneidet.
- Tabellen mit rechts fixierter Aktionsspalte: vorwärts und rückwärts durch eine Zeile getabbt,
  MUST kein Ziel einer rollenden Spalte ganz hinter der Aktionsspalte liegen.
- Rahmen: die klebende Kopfleiste samt Übungsband und Alarmzone gegenüber den Zielen von
  Seitenkopf und Inhalt; ein Fokus in der Kopfleiste selbst MUST die Seite nicht rollen.

#### Scenario: Tabben durch die Zeitachse des ETB
- **WHEN** der Fokus vom ersten Zeilenauslöser aus mit Tab durch 15 Einträge läuft, bei 390 × 600 und 1366 × 520
- **THEN** liegt kein Zeilenauslöser vollständig hinter der Erfassungsleiste, und zwischen seiner Unterkante und der Oberkante der Leiste bleibt ein Streifen frei

#### Scenario: Zeilenwechsel in der Gefahrenmatrix
- **WHEN** der Fokus mit Tab von der letzten Zelle einer Zeile zur ersten Zelle der nächsten wechselt und die Tabelle waagerecht überläuft
- **THEN** liegt die neue Zelle nicht vollständig hinter der Spalte „Gefahr“, und alle 58 Zellen werden im Durchlauf besucht

#### Scenario: Erste Zeile rückwärts unter der stehenden Kopfzeile
- **WHEN** der Fokus in Benutzerliste, Personenliste (ab `md`) oder Einheitenliste (ab `md`) bei 1024 × 600 in `handschuh`, die Benutzerliste zusätzlich bei 390 × 400, mit Shift+Tab von der letzten Zeile in die erste läuft und die erste Zeile dabei unter der Kopfzeile liegt
- **THEN** steht jedes Ziel der ersten Zeile ganz unter der Kopfzeile, auch eines außerhalb der fixierten Spalte

#### Scenario: Durch eine Zeile neben der fixierten Aktionsspalte
- **WHEN** der Fokus in der Fahrzeugliste bei 1024 × 600 in `handschuh` mit Tab durch die Ziele einer Zeile läuft und die Tabelle waagerecht überläuft
- **THEN** liegt kein Ziel einer rollenden Spalte vollständig hinter der rechts fixierten Aktionsspalte

#### Scenario: Kartenknöpfe über dem Fuß
- **WHEN** auf der Lagekarte bei 390 × 844 und 1024 × 768 in `handschuh` die Zeitachse ausgeklappt ist
- **THEN** überschneiden sich Knopfblock und Fußbänder nicht, und jeder Kartenknopf lässt sich anklicken

#### Scenario: Rückwärts unter dem klebenden Kopf
- **WHEN** der Fokus auf einer gerollten Seite bei 1366 × 520 mit Shift+Tab von unten durch die Ziele des Inhalts läuft
- **THEN** liegt kein Ziel vollständig hinter der Kopfleiste

#### Scenario: Rückwärts unter der Alarmzone
- **WHEN** ein Alarm in der Alarmzone steht und der Fokus auf einer gerollten Seite bei 1366 × 520 mit Shift+Tab von unten durch die Ziele des Inhalts läuft
- **THEN** liegt kein Ziel vollständig hinter Kopfleiste oder Alarmzone

#### Scenario: Tab durch die Kopfleiste
- **WHEN** die Seite gerollt ist und der Fokus mit Tab durch die Ziele der Kopfleiste läuft
- **THEN** bleibt die Bildlaufposition unverändert

### Requirement: Die Erfassungsleiste des ETB lässt die Zeitachse sichtbar

Die angepinnte Erfassungsleiste des ETB MUST im Ruhezustand (leerer Entwurf, keine Felder
gesetzt, Menüs geschlossen) höchstens die Hälfte der Fensterhöhe belegen und schon ganz oben
auf der Seite vollständig im Fenster stehen. Das gilt auf Handschirm, Führungs-Tablet und
Fükw in allen drei Dichtestufen. Das Textfeld MUST auf dem Handschirm die volle Breite der
Leiste nutzen und ab `md` die Zeile zwischen Typ-Präfix und den Knöpfen füllen. Gesetzte Felder
MUST auf dem Handschirm die Höhe der Leiste nicht vergrößern: die Feldzeile rollt dort
waagerecht, und der Weg zu weiteren Feldern bleibt sichtbar. Weder ein Fokus in der Leiste noch
Tippen darin MUST die Seite rollen. Die Leiste MUST dabei weder waagerecht überlaufen noch das
Dokument waagerecht verbreitern. Auf dem Handschirm MUST die Seite beim Öffnen mindestens zwei
Einträge der Zeitachse vollständig über der Oberkante der Leiste zeigen, auch für eine Rolle
ohne das Recht, den Einsatz abzuschließen.

#### Scenario: Handschirm im Handschuh-Betrieb
- **WHEN** das ETB bei 390 × 844 in `handschuh` geöffnet ist und die Seite ganz oben steht
- **THEN** ist die Erfassungsleiste höchstens 422 px hoch und steht vollständig im Fenster, das Textfeld ist so breit wie die Leiste abzüglich ihrer Polsterung, und das Dokument ist nicht breiter als 390 px

#### Scenario: Drei gesetzte Felder
- **WHEN** auf dem Handschirm im Handschuh-Betrieb ganz oben auf der Seite drei Felder gesetzt werden
- **THEN** rollt die Seite nicht, die Einträge der Zeitachse bleiben an ihrer Stelle, die Leiste wächst um höchstens 2 px, steht vollständig im Fenster, und die Feldzeile rollt waagerecht

#### Scenario: Textfeld ab md
- **WHEN** das ETB bei 820, 1180 und 1440 px Breite geöffnet ist
- **THEN** ist das Textfeld mindestens 60 % so breit wie die Zeile der Schnellerfassung

#### Scenario: Erster Bildschirm auf dem Handy
- **WHEN** das ETB eines Einsatzes mit mindestens zwei Einträgen bei 390 × 844 geöffnet wird, als Admin und als Führungspersonal ohne Abschließen-Recht
- **THEN** liegen mindestens zwei Einträge der Zeitachse vollständig im Fenster und über der Oberkante der Erfassungsleiste

### Requirement: Das Zeitachsenband der Lagekarte lässt die Karte sichtbar

Die ausgeklappte Zeitachse der Lagekarte MUST höchstens die Hälfte der Kartenhöhe belegen.
Das gilt im Fükw und am Führungs-Tablet sowie auf dem Handschirm mit ausgeblendeter Leiste
(der Vorgabe unter `md`), jeweils in allen drei Dichtestufen. Kein Kind des Bandes MUST über
das Band hinausragen, und das Band MUST in der Kartenspalte bleiben. Die Abstände des Bandes
(Lücken und Polsterung) MUST mit der Dichtestufe wachsen; im Handschuh-Betrieb MUST zwischen je
zwei Bedienzielen des Bandes ein Abstand von mindestens 16 px liegen. Das gilt auch ohne
Schreibrecht.

#### Scenario: Handschirm im Handschuh-Betrieb
- **WHEN** die Lagekarte bei 390 × 844 in `handschuh` mit ausgeklappter Zeitachse und zwei gesicherten Ständen offen ist
- **THEN** ist das Band höchstens halb so hoch wie die Karte, und kein Knopf des Bandes ragt über dessen Rand

#### Scenario: Leiste eingeblendet
- **WHEN** auf dem Handschirm zusätzlich die Leiste eingeblendet ist
- **THEN** bleibt das Band in der Kartenspalte, und Knopfblock und Band überschneiden sich nicht

#### Scenario: Zielabstand im Handschuh-Betrieb
- **WHEN** die Zeitachse in `handschuh` auf Handschirm, Führungs-Tablet oder Fükw ausgeklappt ist, auf dem Handschirm auch ohne Schreibrecht
- **THEN** liegen zwischen je zwei Bedienzielen des Bandes mindestens 16 px

#### Scenario: Abstände wachsen mit der Stufe
- **WHEN** dieselbe Zeitachse nacheinander in `kompakt` und `handschuh` gemessen wird
- **THEN** ist die Polsterung des Bandes in `handschuh` größer als in `kompakt`

### Requirement: Laden ohne Sprung

Das Laden des ETB, der Lagekarte und der Gefahrenmatrix auf dem Handschirm MUST ohne
Layoutverschiebung ablaufen, die nicht auf eine Eingabe folgt: Die Summe der
Verschiebungen (CLS) nach dem Erscheinen des Inhalts MUST höchstens 0,1 betragen.
Eine Fremdänderung einer Matrixzelle, die live eintrifft, MUST die Tabelle nicht
verschieben. Ausgenommen ist das Erscheinen und Gehen der Alarmzone (Spec
`benachrichtigungen`, „Alarmzone verdeckt nichts“): ein Alarm darf den Inhalt um seine Zeile
verschieben; gemessen wird ohne anstehenden Alarm.

#### Scenario: Gefahrenmatrix lädt auf dem Handschirm
- **WHEN** die Gefahrenmatrix bei 390 × 844 frisch geladen wird, bis alle 58 Zellen und die Überschrift des Gebiets stehen
- **THEN** beträgt die Summe der Verschiebungen ohne vorherige Eingabe höchstens 0,1

#### Scenario: Fremdänderung einer Zelle
- **WHEN** eine andere Sitzung eine Zelle auf „akut“ setzt und die Zelle diese Stufe live übernimmt
- **THEN** bleibt die Lage der Tabelle unverändert, und die Summe der Verschiebungen seit dem Ruhezustand ist höchstens 0,1

### Requirement: Das Sammelbanner einer Werkzeugzeile bleibt auf dem Handschirm bedienbar

Steht das Sammelbanner der Ablösung oder der Verpflegung, MUST es auf dem Handschirm in allen
drei Dichtestufen ungekürzt zeigen, wie viele Einträge warten (oder dass nur die Reihenfolge
wartet). Seine Freigabe MUST vollständig im Fenster liegen, und das Dokument MUST nicht breiter
als das Fenster werden. Die vollständige Mitteilung MUST Hilfstechnik erreichen. Das Banner
MUST weder die Höhe der Werkzeugzeile noch die Lage der obersten Karte ändern.

#### Scenario: Verpflegung im Handschuh-Betrieb
- **WHEN** die Verpflegung bei 390 × 844 in `handschuh` offen ist und eine andere Sitzung ein Zeitfenster anlegt
- **THEN** zeigt das Banner „1 neu“ ungekürzt, der Knopf mit „anzeigen“ im Namen liegt mit seiner rechten Kante innerhalb von 390 px, und das Dokument ist nicht breiter als 390 px

#### Scenario: Ablösung in jeder Dichtestufe
- **WHEN** die Ablösung bei 390 × 844 nacheinander in `kompakt`, `komfortabel` und `handschuh` offen ist und eine andere Sitzung eine Schicht beginnt
- **THEN** zeigt das Banner jeweils „1 neu“ ungekürzt, und ein Klick auf den Knopf „anzeigen“ gibt die wartende Schicht frei

#### Scenario: Nur die Reihenfolge wartet
- **WHEN** auf dem Handschirm keine neue Schicht wartet, aber eine fremde Änderung die Reihenfolge umgestellt hat
- **THEN** zeigt das Banner „umgeordnet“ ungekürzt statt einer Zahl

#### Scenario: Kein Sprung beim Eintreffen
- **WHEN** das Banner auf dem Handschirm erscheint
- **THEN** ändern sich die Höhe der Werkzeugzeile und die Oberkante der obersten Karte um höchstens 0,5 px

#### Scenario: Mitteilung für Hilfstechnik
- **WHEN** das Banner auf dem Handschirm in der Kurzform steht
- **THEN** trägt sein Statusbereich die vollständige Mitteilung, etwa „1 neues Zeitfenster, davon 1 mit Unterdeckung“, und der Name des Knopfes enthält „1 neu“ und „anzeigen“

#### Scenario: Breite Schirme unverändert
- **WHEN** dieselbe Seite bei 1366 × 768 oder 1024 × 768 offen ist
- **THEN** steht der volle Satz wie bisher in der Werkzeugzeile neben der Segmentleiste, rechts die Aktion „anzeigen“

### Requirement: Kennzahlenband hält seine Höhe

Das Band „Lage in Zahlen“ im Lage-Dashboard MUST ab einer
Fensterbreite von 768 px seine Höhe behalten, wenn sich die Länge einer Notiz ändert. Jede
Notiz des Bands SHALL dort genau drei Textzeilen hoch sein, ob ihr Text kürzer oder länger
ist. Eine längere Notiz MUST mit einer Auslassung („…“) enden, ihr vollständiger Text MUST
als Hinweistext am Mauszeiger und im zugänglichen Namen der Kennzahl erreichbar bleiben.
Eine Notiz, die in drei Zeilen passt, MUST NOT gekürzt werden. Unter 768 px gilt weiter der
Boden von zwei Zeilen ohne Kürzung.

#### Scenario: Neue Standmeldung bei „Evakuiert“
- **WHEN** bei 1200, 1440 oder 1920 px Breite die Notiz von „Evakuiert“ „von ≈ 1 850 geplant · 1 ohne Meldung“ lautet und eine neue Standmeldung sie zu „von 1 850 geplant“ verkürzt
- **THEN** ist das Band danach genauso hoch wie davor, und Gefahrenmatrix, Sichtung und Meldungsstrom bleiben an ihrem Platz

#### Scenario: Pegel-Notiz mit und ohne Prognose
- **WHEN** die Pegel-Notiz bei derselben Breite einmal ohne und einmal mit „· Prognose … · +1 weitere“ steht
- **THEN** ist das Band in beiden Fällen gleich hoch

#### Scenario: Keine Aussage geht verloren
- **WHEN** die Notiz „von ≈ 1 850 geplant · 1 ohne Meldung“ bei 1200, 1440 oder 1920 px steht
- **THEN** ist sie ganz sichtbar, einschließlich „≈“ und „ohne Meldung“, ohne Auslassung

#### Scenario: Zu lange Notiz
- **WHEN** eine Notiz länger ist als drei Zeilen ihrer Zelle
- **THEN** endet die dritte Zeile mit „…“, der Hinweistext der Notiz zeigt den vollständigen Text, und der zugängliche Name der Kennzahl enthält ihn ebenfalls

### Requirement: Der Rahmen bleibt beim Rollen erreichbar

Die Kopfleiste MUST in jeder Breite beim Rollen am oberen Fensterrand stehen bleiben, ab `lg`
auch die Kategorie-Symbole der Rail und das offene Modulpanel samt Fuß „Einsatzdauer“. Unter `md`
MUST die Kopfleiste im Einsatz einzeilig sein und Menü, Einsatzname, Alarmzentrale, Verbindung
und Uhr tragen; nur in `handschuh` darf eine Störung im Wort der Alarmzentrale sie umbrechen.
Meldet die Betriebszeile unter `md` eine Verbindungsstörung, MUST sie über der Kopfleiste stehen
bleiben. Ab `md` MUST der Seitenkopf einer Einsatz- oder Verwaltungsseite unter der Kopfleiste
stehen bleiben, solange Kopfleiste und Seitenkopf zusammen höchstens ein Drittel der Fensterhöhe
nehmen; sonst rollt er mit. Im ETB kleben Seitenkopf, Filterleiste und Spaltenkopf nur gemeinsam,
solange alle drei mit der Kopfleiste in dieses Drittel passen (Spec `etb-filterleiste`). Jedes
oben klebende Element MUST unter dem klebenden Rahmen stehen, nicht hinter ihm; im Inhalt zählt
ein klebender Seitenkopf zum Rahmen.

#### Scenario: Langes Rollen im ETB ab Tablet
- **WHEN** das ETB bei 820, 1180 und 1440 px Breite auf 1500 px gerollt ist
- **THEN** steht die Kopfleiste mit `position: sticky` bei `top ≥ 0` im Fenster, und ab 1180 px stehen die Kategorie-Symbole der Rail im Fenster

#### Scenario: Langes Rollen im ETB am Handy
- **WHEN** das ETB bei 390 × 844 in `kompakt`, `komfortabel` und `handschuh` bei ruhiger Alarmzentrale auf 1500 px gerollt ist
- **THEN** steht die Kopfleiste einzeilig am oberen Fensterrand, und Menü, Einsatzname, Alarmzentrale, Verbindung und Uhr liegen ganz im Fenster

#### Scenario: Gestörte Alarmzentrale am Handy
- **WHEN** der Ton am Handy blockiert ist
- **THEN** nennt die Alarmzentrale „Ton blockiert“ im Kopf, in `kompakt` und `komfortabel` bleibt die Kopfleiste einzeilig, und der Einsatzname behält seine Mindest-Trefffläche

#### Scenario: Einsatzliste am Handy
- **WHEN** die Einsatzliste bei 390 × 844 in `kompakt` und `komfortabel` auf 1000 px gerollt ist
- **THEN** steht die Kopfleiste einzeilig mit der Uhr am oberen Fensterrand

#### Scenario: Modulpanel bleibt beim Rollen stehen
- **WHEN** das ETB bei 1440 × 900 mit offenem Modulpanel geöffnet wird und damit ans Ende der Zeitachse gerollt ist
- **THEN** stehen Kopf des Modulpanels, alle Moduleinträge der Kategorie und der Fuß „Einsatzdauer“ im Fenster unter der Kopfleiste, und ein Klick auf einen Moduleintrag wechselt das Modul, ohne vorher zu rollen

#### Scenario: Modulpanel länger als das Fenster
- **WHEN** das Modulpanel bei 1366 × 520 im Handschuh-Betrieb mehr Einträge hat, als unter der Kopfleiste Platz finden, und die Seite gerollt ist
- **THEN** rollt das Panel in sich, sein Kopf steht im Fenster, und jeder Eintrag sowie der Fuß „Einsatzdauer“ sind per Wischen oder Tab erreichbar, ohne dass ein Teil des Panels einen anderen verdeckt

#### Scenario: Seitenkopf bleibt auf langen Seiten stehen
- **WHEN** das ETB, das Modul „Personal“, die Einstellungen des Einsatzes oder eine Verwaltungsseite bei 1180 × 820 oder 1440 × 900 bis ans Ende gerollt ist
- **THEN** steht der Seitenkopf mit Titel und Seitenaktionen direkt unter der Kopfleiste im Fenster, und seine Aktionen lassen sich ohne Rollen bedienen

#### Scenario: Niedriges Fenster
- **WHEN** eine Einsatzseite bei 1366 × 520 im Handschuh-Betrieb gerollt ist und Kopfleiste und Seitenkopf zusammen mehr als ein Drittel der Fensterhöhe nähmen
- **THEN** rollt der Seitenkopf mit dem Inhalt, und die Kopfleiste bleibt stehen wie bisher

#### Scenario: Offline auf dem Handy
- **WHEN** das ETB bei 390 × 844 auf 1500 px gerollt ist und das Gerät das Netz verliert
- **THEN** steht die Betriebszeile mit dem Offline-Hinweis am oberen Fensterrand und die Kopfleiste direkt darunter, keine verdeckt die andere

#### Scenario: Tabellenkopf unter dem Rahmen
- **WHEN** eine Seite mit stehendem Tabellenkopf in irgendeiner Breite so weit gerollt ist, dass der Tabellenkopf klebt
- **THEN** liegt seine Oberkante an der Unterkante des klebenden Seitenkopfs, oder an der Unterkante der Kopfleiste, wenn der Seitenkopf mitrollt, nicht darüber

#### Scenario: Niedriges Fenster im ETB
- **WHEN** das ETB gerollt ist und Kopfleiste und Seitenkopf zwar ins Drittel der Fensterhöhe passen, mit Filterleiste und Spaltenkopf aber nicht mehr
- **THEN** rollen Seitenkopf, Filterleiste und Spaltenkopf gemeinsam mit, und die Kopfleiste bleibt stehen

#### Scenario: Fokus unter dem klebenden Seitenkopf
- **WHEN** der Fokus auf einer gerollten Seite mit klebendem Seitenkopf bei 1440 × 900 mit Shift+Tab rückwärts durch die Ziele des Inhalts läuft
- **THEN** liegt jedes fokussierte Ziel ganz unter dem Seitenkopf, nicht dahinter, und ein Fokus in den Seitenaktionen rollt die Seite nicht

### Requirement: Das Modulpanel lässt am Tablet quer Platz

Ohne eigene Wahl MUST das Modulpanel zwischen `lg` und `xl` zugeklappt und ab `xl` offen sein;
eine gemerkte Wahl MUST auf jeder Breite gelten. Das Panel MUST einen sichtbaren Griff mit
`aria-expanded` haben.

#### Scenario: Tablet quer ohne Wahl
- **WHEN** ein Einsatz bei 1180 px ohne gemerkte Wahl geöffnet wird
- **THEN** ist das Modulpanel zugeklappt, und der Griff „Menü“ steht mit `aria-expanded="false"` in der Rail

#### Scenario: Abschnittszeile bei offenem Panel
- **WHEN** der Überblick bei 1180 px mit offenem Modulpanel steht
- **THEN** beginnt der Stärkeblock jeder Abschnittszeile auf der Höhe des Abschnittsnamens

### Requirement: Benutzermenü: Einsatzfunktion im Kopf

Der Kopf des Benutzermenüs MUST die eigene Einsatzfunktion nennen, wenn es eine gibt, auf jeder
Breite. Wo „Profil“ und „Abmelden“ im Menü stehen und was davon am Handy ohne Rollen sichtbar
ist, regelt die Fähigkeit `benutzermenue`; „Abmelden“ MUST auf 390 × 844 und 1180 × 820 in jeder
Dichtestufe im Menü erreichbar sein, im Handschuh-Betrieb am Handy auch erst durch Rollen.

#### Scenario: Schichtwechsel am Handy im Handschuh-Betrieb
- **WHEN** das Benutzermenü bei 390 × 844 in `handschuh` geöffnet wird
- **THEN** ist „Abmelden“ im Menü erreichbar, gegebenenfalls durch Rollen, und meldet nach der Rückfrage ab

#### Scenario: Funktion auf dem Tablet
- **WHEN** das Benutzermenü im Einsatz unter `xl` geöffnet wird und die Person eine Funktion hat
- **THEN** nennt der Menükopf die Funktion

#### Scenario: Funktion am Handy
- **WHEN** das Benutzermenü im Einsatz bei 390 × 844 geöffnet wird und die Person eine Funktion hat
- **THEN** nennt der Menükopf die Funktion

### Requirement: Der Seitenkopf bündelt Nebenwege unter md und ab Stufe 48

Seiten, deren Kopf Nebenwege trägt (Drucken, CSV-Export, Listenzugriffe und Vergleichbares, das
öffnet statt zu erfassen), MUST diese unter `md` (schmaler als 768 px) und in den Stufen
`komfortabel` und `handschuh` in jeder Breite hinter einem einzigen Auslöser „Weitere“ im
Seitenkopf bündeln. Sichtbar bleiben dann die Segmentleiste der Seite, genau eine Erfassung und,
auf Betroffenen- und Tiere-Liste, „Vermisst melden“. In `kompakt` ab `md` MUST jeder Nebenweg als
eigener sekundärer Knopf im Kopf stehen. Der Kopf MUST in jeder Breite höchstens eine Primäraktion
tragen. Der Auslöser MUST einen zugänglichen Namen tragen, der die Seite nennt, und MUST fehlen,
wenn die Seite keinen Nebenweg hat.

#### Scenario: Betroffenenliste auf dem Handschirm
- **WHEN** die Betroffenenliste bei 390 × 844 mit Schreibrecht geöffnet ist
- **THEN** stehen im Seitenkopf ein Erfassungsknopf, „Vermisst melden“, der Knopf „Filter“ und der Auslöser „Weitere“, und weder „Drucken / als PDF“ noch „CSV exportieren“ steht als Knopf im Kopf

#### Scenario: Nebenwege im Menü
- **WHEN** auf dem Handschirm der Auslöser „Weitere“ der Betroffenenliste geöffnet wird
- **THEN** enthält das Menü „Drucken / als PDF“ und „CSV exportieren“, und die Wahl löst denselben Weg aus wie der Knopf in `kompakt` ab `md`

#### Scenario: Ab md unverändert erreichbar
- **WHEN** die Betroffenenliste bei 1180 px Breite in `kompakt` geöffnet ist
- **THEN** stehen „Drucken / als PDF“ und „CSV exportieren“ als Knöpfe im Kopf, und es gibt keinen Auslöser „Weitere“

#### Scenario: Stufe 48 und 72 am Tablet
- **WHEN** die Betroffenenliste bei 1180 × 820 in `komfortabel` oder in `handschuh` geöffnet ist
- **THEN** stehen „Drucken / als PDF“, „CSV exportieren“ und „Versorgt und entlassen“ nur im Menü „Weitere“, und der Erfassungsknopf und „Vermisst melden“ stehen als Knöpfe im Kopf

#### Scenario: Meldebild
- **WHEN** das Meldebild bei 1440 × 900 in `kompakt` geöffnet ist
- **THEN** stehen „Drucken“ und „In Lagebericht übernehmen“ als sekundäre Knöpfe im Seitenkopf und nicht in der Werkzeugzeile über der Tabelle

### Requirement: Die Betroffenenliste zeigt am Handschirm Lage und erste Person

Auf dem Handschirm (390 × 844) MUST die Betroffenenliste beim Öffnen ohne Bildlauf mindestens eine
Personenzeile und die Sichtungszusammenfassung (Zahl je Sichtungskategorie) vollständig im Fenster
zeigen. Das MUST für eine Rolle mit Schreibrecht und für einen Beobachter ohne Schreibrecht gelten.
Unterhalb von `xl` MUST die Sichtungszusammenfassung über der Liste stehen; die ausführliche
Seitenleiste darf darunter folgen.

#### Scenario: Erster Bildschirm mit Schreibrecht
- **WHEN** die Betroffenenliste eines Einsatzes mit mindestens einer Person bei 390 × 844 als Admin geöffnet wird
- **THEN** liegen die erste Personenzeile und die Sichtungszusammenfassung vollständig im Fenster

#### Scenario: Erster Bildschirm als Beobachter
- **WHEN** dieselbe Liste als Beobachter geöffnet wird
- **THEN** liegen die erste Personenzeile und die Sichtungszusammenfassung vollständig im Fenster, und der Kopf trägt keinen Erfassungsknopf

### Requirement: Das Personen-Detail beginnt mit dem Patientenkopf

Das Personen-Detail MUST in jeder Breite mit dem Patientenkopf beginnen (Sichtung, Zustand /
Verdacht, Aufenthalt bzw. Verbleib, letzte Notiz). Darunter folgen der Verlauf und die
Personendaten. Die zwei gleichrangigen Spalten aus medizinischen Angaben und Stammdaten entfallen.
Die Personendaten MUST jedes Etikett über seinem Wert zeigen, und leere Angaben MUST in einer
Zeile „Ohne Angabe“ zusammengefasst stehen statt als eigene Zeilen mit Strich. Mit Schreibrecht
MUST diese Zeile jede leere Angabe als Knopf „+ Etikett“ tragen, ohne Schreibrecht als Satz
„Ohne Angabe: …“.

#### Scenario: Handschirm und Tablet hoch
- **WHEN** das Detail einer Person bei 390 × 844 und bei 820 × 1180 geöffnet wird, als Admin und als Beobachter
- **THEN** liegt die Oberkante des Patientenkopfs über der Oberkante der Personendaten

#### Scenario: Leere Angaben
- **WHEN** eine Person ohne Geburtsdatum, Herkunft und Melder einem Beobachter angezeigt wird
- **THEN** stehen diese Etiketten in einer Zeile „Ohne Angabe: …“, und für sie gibt es kein eigenes Feld mit „—“

#### Scenario: Leere Angaben mit Schreibrecht
- **WHEN** dieselbe Person einem Admin angezeigt wird
- **THEN** stehen in derselben Zeile die Knöpfe „+ Geburtsdatum“, „+ Herkunft / Adresse“ und „+ Melder / Kontakt“, jeder mindestens so hoch wie die Steuerhöhe der Dichtestufe

### Requirement: Der App-Rahmen springt beim Laden nicht

Beim Laden einer Einsatzseite MUST die Kopfleiste im ersten Bild so viele Zeilen haben wie im
fertig geladenen Zustand, in jeder Stufe der Dichte-Staffel und an jeder Breite ab `xl`. Ein
Inhalt der Kopfleiste, der erst nach einem Abruf feststeht, MUST NOT ihre Breite ändern. Die
Summe der Verschiebungen ohne vorherige Eingabe MUST bei 1280 × 800 in `kompakt` und
`komfortabel` unter 0,1 liegen, an der Umbruchkante der Kopfleiste höchstens 0,01. Gemessen wird
ohne anstehenden Alarm; die Alarmzone verschiebt den Inhalt mit Absicht (Spec
`benachrichtigungen`, „Alarmzone verdeckt nichts“).

#### Scenario: Arbeitsplatzmaß
- **WHEN** Überblick, Meldebild und ETB eines Einsatzes bei 1280 × 800 in `kompakt` und in `komfortabel` geladen werden
- **THEN** liegt die Summe der Verschiebungen ohne vorherige Eingabe je Seite unter 0,1

#### Scenario: An der Umbruchkante
- **WHEN** der Überblick in `komfortabel` oder `handschuh` als Admin oder Beobachter an der größten zweizeiligen und an der kleinsten einzeiligen Breite der fertig geladenen Kopfleiste geladen wird
- **THEN** hat die Kopfleiste nach dem Laden so viele Zeilen wie bei der Suche der Kante, und die Summe der Verschiebungen ist höchstens 0,01

#### Scenario: Funktion kommt nach dem Namen
- **WHEN** der Einsatz nach dem ersten Bild lädt und das Benutzermenü statt des Anzeigenamens die Funktion zeigt
- **THEN** behält das Etikett des Benutzermenüs seine Breite

### Requirement: Das erste Bild steht in den Bildschirm-Schriften

Die Bildschirm-Schriften (Archivo 400/500/600, Archivo Narrow 600, JetBrains Mono 400/500) MUST
im ersten Bild der App stehen, wenn sie innerhalb von 300 ms nach dem Start laden. Laden sie nicht
in dieser Frist oder scheitern sie, MUST die App trotzdem rendern, in der Ersatzschrift.

#### Scenario: Schriften kommen verzögert
- **WHEN** jeder Schriftabruf um 150 ms verzögert wird und eine Einsatzseite neu lädt
- **THEN** sind die Bildschirm-Schriften geladen, bevor der Inhalt der App zum ersten Mal im Dokument steht

#### Scenario: Schriften kommen nicht
- **WHEN** die Schriftabrufe nicht innerhalb von 300 ms antworten oder scheitern
- **THEN** rendert die App trotzdem, und der Text steht in der Ersatzschrift

### Requirement: Ein Rail-Sprung achtet die gemerkte Panel-Wahl

Hat eine Person das Modulpanel zugeklappt, MUST es nach einem Klick auf eine andere Kategorie der
Rail zugeklappt bleiben. Ohne gemerkte Wahl SHALL ein solcher Klick das Panel für die laufende
Sitzung öffnen.

#### Scenario: Zugeklappt bleibt zu

- **WHEN** eine Person bei 1440 px das Modulpanel mit „Menü“ zuklappt und dann in der Rail auf
  eine andere Kategorie klickt
- **THEN** wechselt die Seite in ein Modul dieser Kategorie, und das Modulpanel bleibt zugeklappt

#### Scenario: Tablet quer ohne Wahl

- **WHEN** eine Person bei 1180 px ohne gemerkte Wahl in der Rail auf eine andere Kategorie klickt
- **THEN** steht das Modulpanel dieser Kategorie offen

### Requirement: Der Rail-Fuß bleibt im Fenster

Ab `lg` MUST die Spalte der Rail am unteren Fensterrand enden, auch wenn über der Kopfleiste oder
zwischen Kopfleiste und Rail eine Zeile im Fluss steht, etwa die Betriebszeile mit dem
Offline-Hinweis. Passen Kategorien und Fuß („Menü“, „Einst.“) in die Höhe, steht der Fuß damit im
Fenster; sonst rollt die Spalte in sich, und der Fuß folgt den Kategorien.

#### Scenario: Offline am Fükw

- **WHEN** ein Einsatz bei 1366 × 768 oben steht und das Gerät das Netz verliert
- **THEN** liegt die Unterkante von „Einst.“ am oder über dem unteren Fensterrand

### Requirement: Der Navigations-Drawer nutzt die Breite des Handys

Unter `lg` MUST der Navigations-Drawer 360 px breit sein, höchstens aber die Fensterbreite minus
48 px, damit rechts ein Streifen zum Schließen bleibt.

#### Scenario: Handy

- **WHEN** eine Person bei 390 × 844 die Navigation öffnet
- **THEN** ist der Drawer 342 px breit

### Requirement: Suche und Benutzermenü am Handy in der Navigation

Unter `md` SHALL der Kopf im Einsatz weder das Suchfeld der Sprungpalette noch den Auslöser des
Benutzermenüs tragen. Beide MUST in der Navigation stehen, die der Knopf „Menü“ öffnet: „Suchen“
oben, es öffnet die Sprungpalette; der Auslöser des Benutzermenüs unten, mit unverändertem Menü.
Ab `md` SHALL beides im Kopf bleiben.

#### Scenario: Suchen am Handy
- **WHEN** eine Person im Einsatz bei 390 × 844 die Navigation öffnet und „Suchen“ antippt
- **THEN** schließt die Navigation, und die Sprungpalette ist offen

#### Scenario: Benutzermenü am Handy
- **WHEN** eine Person im Einsatz bei 390 × 844 die Navigation öffnet und den Auslöser des Benutzermenüs antippt
- **THEN** öffnet das Benutzermenü mit denselben Einträgen wie ab `md`, bis einschließlich „Abmelden“

#### Scenario: Ab Tablet unverändert
- **WHEN** ein Einsatz bei 820 px Breite geöffnet ist
- **THEN** stehen Suche und Benutzermenü im Kopf

### Requirement: Die Hauptaktion einer Tabellenzeile bleibt im Bild

Die Aktion einer Tabellenzeile (Primäraktion, ⋮ oder beides) SHALL ohne waagerechtes Rollen der
Tabelle erreichbar sein, in jeder Dichtestufe. Ab `md` MUST die Aktionsspalte rechts fixiert
stehen, mit fester Breite je Stufe. Unter `md` MUST eine Tabelle, die nicht in Karten wechselt,
Primäraktion und ⋮ in der fixierten Kennungsspalte tragen, ohne eigene Aktionsspalte. Betroffen
sind Evakuierung, Betreuung, Material, Betroffene und Fahrzeuge.

#### Scenario: Evakuierung am Fükw
- **WHEN** die Evakuierungsbezirke bei 1440 × 900 in `kompakt` mit geöffnetem Modulpanel stehen und die Tabelle breiter ist als ihr Rahmen
- **THEN** liegen „Stand melden“ und das ⋮ jeder Zeile ganz innerhalb des Tabellenrahmens, ohne dass die Tabelle gerollt wurde

#### Scenario: Waagerecht gerollt
- **WHEN** die Fahrzeugliste bei 1024 × 768 in `handschuh` waagerecht bis zum Anfang gerollt ist
- **THEN** steht das ⋮ jeder Zeile weiter am rechten Rand des Rahmens, und Spalten, die darunter rollen, bleiben in ihrer Breite unverändert

#### Scenario: Handschirm ohne Karten
- **WHEN** die Evakuierungsbezirke bei 390 × 844 in `komfortabel` stehen
- **THEN** stehen „Stand melden“ und das ⋮ jeder Zeile in der fixierten Kennungsspalte, und die Seite selbst rollt nicht waagerecht

#### Scenario: Zeile nur mit Menü
- **WHEN** die Fahrzeugliste ab `md` als Tabelle steht und ihre Zeilen nur ein ⋮ tragen
- **THEN** steht das ⋮ in einer rechts fixierten Spalte, so breit wie die Steuerhöhe der Stufe oder der Kopf „Aktionen“, was breiter ist, zuzüglich Zellpolster

### Requirement: Bearbeiten in einer Tabellenzelle verschiebt die Tabelle nicht

Öffnet jemand in einer Tabellenzelle eine Einzelangabe zur Bearbeitung, SHALL die Eingabe samt
„Speichern“ und „Abbrechen“ an der Zelle schweben, nicht in ihr. Breite und Höhe jeder Spalte und
Zeile MUST unverändert bleiben. Fokusrückgabe, Escape-Reihenfolge, Prüfung und Ablehnung MUST wie
bei der Bearbeitung im Fluss gelten, und die Tabelle MUST ihre Zeilenfolge halten. Karten,
Ansichten und die mehrzeilige Bemerkung bearbeiten weiter im Fluss.

#### Scenario: Stift der Einheit in der Fahrzeugliste
- **WHEN** in der Fahrzeugliste bei 1440 × 900 in `kompakt` der Stift der Einheit eines Fahrzeugs gewählt wird
- **THEN** ändert sich keine Spaltenbreite um mehr als 1 px, die Zeile behält ihre Höhe, und „Details“ bleibt neben dem Funkrufnamen

#### Scenario: Handschuh am Tablet
- **WHEN** dasselbe bei 1024 × 768 in `handschuh` geschieht
- **THEN** ändert sich ebenso keine Spaltenbreite und keine Zeilenhöhe, und Eingabe und Knöpfe stehen vollständig im Fenster

#### Scenario: Escape schließt zuerst das Auswahlfeld
- **WHEN** in der schwebenden Bearbeitung die Auswahlliste der Einheit offen ist und Escape gedrückt wird
- **THEN** schließt nur die Auswahlliste; ein weiteres Escape verwirft die Bearbeitung, und der Fokus steht wieder auf dem Wert der Zelle

#### Scenario: Tipp ins Freie bei offener Bearbeitung
- **WHEN** am Tablet die Einheit eines Fahrzeugs in Bearbeitung steht, danach auf eine freie Fläche getippt wird und per Live-Update ein Fahrzeug davor hinzukommt
- **THEN** bleibt die Bearbeitung offen, und die Zeilen rücken nicht, bis sie schließt

#### Scenario: Tab aus einer unveränderten Bearbeitung
- **WHEN** der Fokus mit Tab vom letzten Knopf einer unveränderten schwebenden Bearbeitung weitergeht
- **THEN** schließt sie, und der Fokus steht auf dem nächsten Ziel nach der Zelle

#### Scenario: Ablehnung
- **WHEN** der Server das Speichern ablehnt
- **THEN** bleibt die Bearbeitung mit dem Entwurf offen, und der Grund steht in ihr

#### Scenario: Karte am Handschirm
- **WHEN** die Fahrzeugliste bei 390 px als Karte steht und die Einheit bearbeitet wird
- **THEN** öffnet die Eingabe in der Karte selbst, wie bisher

### Requirement: Die Einheitenliste steht am Handschirm als Karten

Unter `md` SHALL die Einheitenliste ihre Gliederung als Karten zeigen, ab `md` als Tabelle. Jede
Karte MUST den Namen der Einheit mit Zeichen und Marken ungebrochen tragen (Umbruch nur zwischen
Wörtern oder an Silbengrenzen), dazu Ist und Soll mit dem Urteil der Stärke und den
Einheitsführer. Untereinheiten MUST unter ihrer Übereinheit eingerückt und in der Vorgabe
aufgeklappt stehen. Folge und kumulierte Stärken MUST denen der Tabelle gleichen.

#### Scenario: Fünf Einheiten am Handy
- **WHEN** die Einheitenliste mit fünf Einheiten bei 390 × 844 in `komfortabel` geöffnet wird
- **THEN** steht jede Einheit als Karte, kein Name ist innerhalb eines Worts gebrochen, und die Seite rollt nicht waagerecht

#### Scenario: Untereinheit
- **WHEN** die Gruppe „Staffel A“ dem Zug „Zug 1“ unterstellt ist
- **THEN** steht ihre Karte eingerückt unter der Karte von Zug 1, ohne dass etwas aufgeklappt werden musste

#### Scenario: Ab md Tabelle
- **WHEN** dieselbe Liste bei 1024 × 768 geöffnet wird
- **THEN** steht sie als Tabelle mit stehender Kopfzeile

### Requirement: Ein Sprunglink führt zum Inhalt

Jede Seite im Rahmen (Einsatz, Ebene 1, Verwaltung, Planungen) und die Hilfe MUST als ersten
Tab-Halt einen Link „Zum Inhalt springen“ haben, vor Betriebszeile, Kopf und Navigation. Er MUST
den Fokus an den Anfang des Seiteninhalts setzen, in der Verwaltung neben das Menü. Ohne Fokus
MUST er unsichtbar sein; mit Fokus MUST er sichtbar sein, ohne den Rahmen zu verschieben, und
MUST NOT verdeckt sein. Die Adresse MUST dabei unverändert bleiben.

#### Scenario: Erster Halt im Überblick
- **WHEN** der Überblick eines Einsatzes geladen ist und einmal Tab gedrückt wird
- **THEN** hat der Link „Zum Inhalt springen“ den Fokus und ist sichtbar
- **AND** kein Element des Rahmens hat sich verschoben

#### Scenario: Sprung in den Inhalt
- **WHEN** auf dem Link Enter gedrückt und danach einmal Tab gedrückt wird
- **THEN** liegt der Fokus auf dem ersten Bedienelement im Seiteninhalt, nicht in Kopf, Rail
  oder Modulpanel
- **AND** die Adresse ist unverändert

#### Scenario: Verwaltung
- **WHEN** in der Verwaltung der Link benutzt und danach Tab gedrückt wird
- **THEN** liegt der Fokus im Inhalt neben dem Verwaltungsmenü, nicht im Menü

#### Scenario: Störung der Verbindung
- **WHEN** die Betriebszeile eine Störung mit Knöpfen zeigt und die Seite neu geladen ist
- **THEN** ist der erste Tab-Halt trotzdem der Link „Zum Inhalt springen“

#### Scenario: Ohne Fokus
- **WHEN** der Link keinen Fokus hat
- **THEN** ist er nicht zu sehen und nimmt keinen Platz im Rahmen ein

### Requirement: Die Stärke steht im Seitenkopf der Kräfteseiten

Auf Fahrzeuge, Personal und Einheiten SHALL die Stärke samt Fahrzeugverfügbarkeit und Sprung ins
Meldebild im Seitenkopf neben dem Titel stehen, nicht als eigene Zeile über der Liste. Dieselbe
Aufteilung der Fahrzeuge (verfügbar, gebunden, nicht verfügbar) MUST auf einer Seite höchstens
einmal stehen. Der Kopf MUST beim Laden seine Zeilenzahl halten.

#### Scenario: Fahrzeuge ohne Doppel
- **WHEN** die Fahrzeugliste mit Fahrzeugen in mehreren Status bei 1440 × 900 geöffnet ist
- **THEN** steht „Stärke …“ mit „n verfügbar · n gebunden · n nicht verfügbar“ im Seitenkopf, und über der Tabelle steht keine zweite Zeile mit derselben Aufteilung

#### Scenario: Personal und Einheiten
- **WHEN** Personal oder Einheiten bei 1440 × 900 geöffnet sind
- **THEN** steht die Stärke im Seitenkopf, gleich der Summe der Wurzeln im Kräftebaum, und zwischen Seitenkopf und Liste steht keine Stärkezeile

### Requirement: Kennzahlenbänder über Listen lassen sich einklappen

Das Statusband des Meldebilds und die Kennzahlen der Unterbringung auf der Betreuungsseite SHALL
einen Klappkopf tragen. Ohne gemerkte Wahl MUST das Band offen stehen. Eingeklappt MUST eine Zeile
mit den Zahlen in Kurzform stehen bleiben. Die Wahl MUST je Seite auf dem Gerät erhalten bleiben
und ohne Browserspeicher für die Sitzung gelten. Die Sichtungszeile der Betroffenenliste MUST
nicht einklappbar sein.

#### Scenario: Einklappen und neu laden
- **WHEN** das Statusband des Meldebilds eingeklappt und die Seite danach neu geladen wird
- **THEN** steht das Band weiter eingeklappt als eine Zeile mit den Zahlen je Status, und die Tabelle beginnt höher als mit offenem Band

#### Scenario: Erstes Öffnen
- **WHEN** die Betreuungsseite auf einem Gerät ohne gemerkte Wahl geöffnet wird
- **THEN** stehen die Kennzahlen der Unterbringung offen

#### Scenario: Klappkopf im Handschuh-Betrieb
- **WHEN** das Meldebild in `handschuh` geöffnet ist
- **THEN** misst der Klappkopf des Statusbands mindestens 72 px in der Höhe

### Requirement: Filter und Ansichtswahl am Handschirm hinter einem Knopf

Unter `md` SHALL eine Listenseite ihre Ansichtswahl und Filter (Status, Abgeschlossene zeigen und
Vergleichbares) hinter einem Knopf „Filter“ im Seitenkopf tragen, der die Zahl der von der Vorgabe
abweichenden Wahlen nennt („Filter (2)“). Der Knopf MUST die Wahl unter dem Seitenkopf aufklappen
und wieder zuklappen. Ab `md` MUST die Wahl ohne Knopf sichtbar stehen. Betroffen sind
Betroffene und Fahrzeuge.

#### Scenario: Betroffene am Handy
- **WHEN** die Betroffenenliste bei 390 × 844 geöffnet ist und „Abgeschlossene zeigen“ gewählt wurde
- **THEN** steht im Seitenkopf „Filter (1)“, Ansicht-Segmentleiste und Statusfilter stehen erst nach dem Antippen im Bild, und eine Änderung dort wirkt sofort auf die Liste

#### Scenario: Tablet unverändert
- **WHEN** die Fahrzeugliste bei 820 × 1180 geöffnet ist
- **THEN** steht die Ansicht-Segmentleiste im Seitenkopf, und es gibt keinen Knopf „Filter“

### Requirement: Die erste Datenzeile steht oben im Fenster

Beim Öffnen einer Listenseite ohne Bildlauf MUST die erste Datenzeile vollständig im Fenster
stehen, in jeder Dichtestufe, als Admin und als Beobachter. Am Handschirm MUST ihre Oberkante auf
Fahrzeuge, Personal, Einheiten und Betreuung und, ohne Schreibrecht, auf der Betroffenenliste
höchstens bei y = 350 liegen, auf der Betreuung mit eingeklappten Kennzahlen.

#### Scenario: Handschuh am Tablet
- **WHEN** Betroffene, Meldebild, Fahrzeuge, Personal und Einheiten bei 1180 × 820 in `handschuh` als Admin geöffnet werden
- **THEN** liegt die erste Datenzeile jeder Seite vollständig im Fenster

#### Scenario: Handschirm
- **WHEN** Fahrzeuge, die Betreuung mit eingeklappten Kennzahlen und als Beobachter die Betroffenenliste bei 390 × 844 in `kompakt` geöffnet werden
- **THEN** liegt die Oberkante der ersten Datenzeile höchstens bei y = 350
