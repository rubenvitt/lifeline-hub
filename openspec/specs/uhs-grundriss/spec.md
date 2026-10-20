# uhs-grundriss Specification

## Purpose
Bedienform der Platzkarte im UHS-Grundriss je Dichtestufe. Diese Spec legt fest, wie die
Aktionen eines Behandlungsplatzes in jeder Dichtestufe erreichbar sind, ohne dass Kartengröße
oder gespeichertes Layout sich ändern.

## Requirements

### Requirement: Kartengröße und Layout sind dichteunabhängig
Die Platzkarte SHALL in jeder Dichtestufe dieselbe feste Größe haben, die in das Platzraster
des Servers passt: Sie bleibt schmaler als der Spaltenabstand und niedriger als der
Zeilenabstand. Gespeicherte Positionen von Plätzen MUST beim Wechsel der Dichtestufe unverändert
gelten. Weder Server noch Client dürfen sie umrechnen oder migrieren.

#### Scenario: Wechsel auf Handschuh
- **WHEN** ein Grundriss mit zehn im Raster angelegten Plätzen in der Stufe „Handschuh“ geöffnet wird
- **THEN** stehen die Karten an denselben Positionen wie in „kompakt“ und überlappen einander nicht

#### Scenario: Verschobenes Layout
- **WHEN** Plätze im Bearbeiten-Modus verschoben und gespeichert wurden und danach die Dichtestufe wechselt
- **THEN** zeigt der Grundriss die gespeicherten Positionen unverändert, und der Server erhält keinen Schreibzugriff

### Requirement: Zeilenform in der kompakten Stufe
In der Stufe „kompakt“ SHALL die Platzkarte ihre Aktionen als Knopfzeile tragen. Die Zeile
enthält „Verbleib / Entlassung erfassen“, „zurückweisen“, „als frei markieren“ und den Auslöser
des Platzmenüs, jeweils nur, wenn sie anwendbar sind. Jeder Knopf MUST den Trefflächenboden der
Stufe halten, das sind 24 px in der kurzen Achse. Die Zeile MUST in die Innenbreite der Karte
passen, Knöpfe und Lücken zusammengerechnet. Neben dem Gefahrknopf „zurückweisen“ MUST ein
Abstand von mindestens dem kleinen Randabstand der Stufe stehen. Ein Klick auf die freie Fläche
eines unbelegten Platzes SHALL wie bisher direkt den Zuweisungsdialog öffnen.

#### Scenario: Belegter Platz in kompakt
- **WHEN** ein belegter Platz in Aufbereitung in der Stufe „kompakt“ angezeigt wird
- **THEN** trägt die Karte vier Knöpfe mit je mindestens 24 px, alle innerhalb der Karte, und „zurückweisen“ steht nicht bündig an einem Nachbarn

#### Scenario: Ein-Klick-Zuweisung bleibt
- **WHEN** in „kompakt“ auf die Fläche eines unbelegten Platzes geklickt wird
- **THEN** öffnet sich der Dialog „Patient zuweisen“ ohne Zwischenschritt

### Requirement: Kartenform in den Berührungsstufen
In den Stufen „komfortabel“ und „Handschuh“ SHALL die ganze Platzkarte das einzige Bedienziel
der Karte sein. Ein Tipp, ein Klick oder Enter auf der Karte MUST das Aktionsmenü dieser Karte
öffnen. Außerhalb des Bearbeiten-Modus MUST das auch die Leertaste tun. Im Bearbeiten-Modus
startet die Leertaste weiter den Tastatur-Zug des Layouts. Die Karte MUST keine Knopfzeile tragen, und in ihr darf kein
weiteres Klickziel verschachtelt liegen. Der zugängliche Name der Karte MUST die Bezeichnung des
Platzes nennen. Die Karte MUST in beiden Achsen mindestens die Steuerhöhe der Stufe messen, also
48 bzw. 72 px, und jeder Menüeintrag ebenso. Jeder Menüeintrag MUST vollständig im sichtbaren
Fenster liegen, auch wenn das Menü dafür die Karte überdeckt oder selbst scrollen muss.

#### Scenario: Tipp auf unbelegten Platz
- **WHEN** in „komfortabel“ auf einen unbelegten Platz getippt wird
- **THEN** öffnet sich das Aktionsmenü, sein erster Eintrag ist „Patient zuweisen“, und es öffnet sich noch kein Zuweisungsdialog

#### Scenario: Zuweisen in zwei Tipps
- **WHEN** im geöffneten Menü „Patient zuweisen“ gewählt wird
- **THEN** öffnet sich der Zuweisungsdialog, und das Menü schließt sich

#### Scenario: Tipp auf belegten Platz
- **WHEN** in „Handschuh“ auf einen belegten Platz getippt wird
- **THEN** öffnet sich das Aktionsmenü, sein erster Eintrag ist „Verbleib / Entlassung erfassen“, und es enthält „Person öffnen“, „Zurück in den Wartebereich“, die Verfügbarkeiten sowie hinter einem Trenner „zurückweisen“ als Gefahreintrag

#### Scenario: Tastatur
- **WHEN** die Karte in „komfortabel“ fokussiert ist und Enter gedrückt wird
- **THEN** öffnet sich das Aktionsmenü mit dem Fokus auf dem ersten Eintrag

#### Scenario: Trefffläche
- **WHEN** das Menü einer Karte in „Handschuh“ geöffnet ist
- **THEN** misst die Karte mindestens 72 × 72 px und jeder Menüeintrag mindestens 72 px in der Höhe

#### Scenario: Langes Menü im Handschuh
- **WHEN** das Menü eines belegten Platzes in „Handschuh“ bei 1024 × 900 px geöffnet wird
- **THEN** liegen alle acht Einträge vollständig im Fenster, und ein Tipp auf den obersten öffnet den Verbleib-Dialog

#### Scenario: Menüwahl löst nichts zusätzlich aus
- **WHEN** im Menü eines unbelegten Platzes „als defekt markieren“ gewählt wird
- **THEN** ändert sich nur die Verfügbarkeit, und weder öffnet sich der Zuweisungsdialog noch das Menü erneut

### Requirement: Alle Aktionen bleiben in jeder Stufe erreichbar
Jede Aktion, die die Zeilenform eines Platzes anbietet, SHALL in der Kartenform als Menüeintrag
erreichbar sein. Das sind „Patient zuweisen“, „Verbleib / Entlassung erfassen“, „zurückweisen“,
„Zurück in den Wartebereich“, „Person öffnen“, alle Verfügbarkeiten und im Bearbeiten-Modus
„Platz löschen“, jeweils nach Belegung, Modus und Schreibrecht. Gefahraktionen MUST hinter einem
Trenner stehen. Solange eine Belegung läuft, MUST das Menü erreichbar bleiben. Einträge, die
eine zweite Bewegung derselben Person anstoßen würden, MUST dann gesperrt angezeigt werden,
nicht entfernt.

#### Scenario: Bearbeiten-Modus
- **WHEN** der Grundriss im Bearbeiten-Modus in „komfortabel“ steht und auf eine Karte getippt wird
- **THEN** enthält das Menü die Verfügbarkeiten und hinter einem Trenner „Platz löschen“, aber nicht „Patient zuweisen“

#### Scenario: Laufende Belegung
- **WHEN** eine Belegung auf einen anderen Platz läuft und das Menü eines belegten Platzes geöffnet wird
- **THEN** stehen „Verbleib / Entlassung erfassen“, „zurückweisen“ und „Zurück in den Wartebereich“ gesperrt im Menü

### Requirement: Ohne Schreibrecht nur Lesen
Ohne Schreibrecht SHALL eine belegte Platzkarte in der Kartenform per Tipp direkt die
Detailansicht der Person öffnen, ohne Menü mit nur einem Eintrag. Eine unbelegte Platzkarte ohne
Schreibrecht MUST dann kein Bedienziel sein.

#### Scenario: Belegter Platz schreibgeschützt
- **WHEN** der Grundriss ohne Schreibrecht in „komfortabel“ steht und auf einen belegten Platz getippt wird
- **THEN** öffnet sich die Detailansicht der belegenden Person, und es erscheint kein Menü

#### Scenario: Unbelegter Platz schreibgeschützt
- **WHEN** der Grundriss ohne Schreibrecht in „komfortabel“ steht
- **THEN** ist ein unbelegter Platz weder fokussierbar noch als Knopf ausgezeichnet

### Requirement: Gesten bleiben Zusatzwege
Das Ziehen einer Person auf einen Platz, das Ziehen einer belegenden Person aus der Karte und das
Verschieben eines Platzes im Bearbeiten-Modus SHALL in jeder Dichtestufe wie bisher
funktionieren. Ein Tipp ohne Bewegung MUST in der Kartenform das Menü öffnen und MUST keinen Zug
auslösen.

#### Scenario: Person aus belegter Karte ziehen
- **WHEN** in „komfortabel“ die Personenmarke einer belegten Karte in den Wartebereich gezogen wird
- **THEN** wird die Person zurückgestellt wie in „kompakt“, und es öffnet sich kein Menü

### Requirement: Die UHS-Seite gliedert sich in Bereiche

Die Detailseite einer UHS SHALL direkt unter dem Seitenkopf eine Bereichsleiste mit „Belegung“,
„Material“, „Kräfte“, „Bewegungen“ und „Dateien“ tragen. „Belegung“ (der Grundriss) MUST die
Vorgabe sein. Jeder Bereich MUST dieselbe Fläche bis zur Fensterhöhe einnehmen, statt unter einem
anderen zu hängen. Der gewählte Bereich MUST in der Adresse stehen, damit ein Link ihn direkt
öffnet. Bei 1440 × 900 und 1280 × 800 MUST jeder Bereich ohne Bildlauf erreichbar sein.

#### Scenario: Material ohne Bildlauf
- **WHEN** die Detailseite der UHS „Turnhalle“ bei 1440 × 900 geöffnet wird
- **THEN** steht die Bereichsleiste über dem Grundriss, und „Material“ ist ohne Bildlauf wählbar

#### Scenario: Direkter Link
- **WHEN** die Detailseite mit `?bereich=material` geöffnet wird
- **THEN** ist der Bereich „Material“ gewählt

#### Scenario: Kopfzahl springt
- **WHEN** jemand im Kopf der UHS auf „3 Posten · 1 Ausfall“ tippt
- **THEN** ist der Bereich „Material“ gewählt

### Requirement: Personenzeile in „Noch nicht aufgenommen“ und „Wartebereich“
Jede Zeile der Listen „Noch nicht aufgenommen“ und „Wartebereich“ SHALL Sichtung, Kennung und
Namen in einer eigenen Zeile über die volle Spaltenbreite zeigen. Nebenangabe (Wartezeit bzw.
Zeit seit der Erfassung) und die Aktion „Verbleib“ MUST darunter stehen; das Wort „Verbleib“
bleibt sichtbar. Ziehen und „Person öffnen“ MUST auf der Personenmarke bleiben, und jedes
Bedienziel MUST die Steuerhöhe der Stufe halten.

#### Scenario: Name in der schmalen Spalte
- **WHEN** der Wartebereich in der 240 px breiten Seitenspalte „R-011 · Ernst, Hans-Jürgen“ mit SK III zeigt
- **THEN** steht „R-011 · Ernst, Hans-Jürgen“ ungekürzt in der ersten Zeile, und „Verbleib“ steht darunter

#### Scenario: Handschuh
- **WHEN** die Liste in der Stufe „Handschuh“ angezeigt wird
- **THEN** misst „Verbleib“ mindestens 72 px in der kurzen Achse, und die Personenmarke ebenso

### Requirement: Spalte „Unterwegs“ statt „Auf Transport gebracht“
Die rechte Spalte des Grundrisses SHALL „Unterwegs“ heißen und die aus dieser UHS ausgetretenen
Personen im Eigentransport zeigen: Sichtung, Kennung, Fahrzeug, Ziel, Transportpriorität und die
Dauer seit der Abfahrt. Jede Zeile MUST „Übergabe quittieren“ anbieten, solange Schreibrecht
besteht. Abgeschlossene Patienten MUST NOT in der Spalte stehen. Der Abwurf einer Person auf die
Spalte MUST die Verbleib-Maske mit der Art Transport öffnen.

#### Scenario: Übergabe aus der Spalte
- **WHEN** R-008 im Eigentransport mit „1/83-1“ in „Unterwegs“ steht und jemand „Übergabe quittieren“ speichert
- **THEN** verlässt R-008 die Spalte

#### Scenario: Fremdes Rettungsmittel
- **WHEN** R-004 aus dem Wartebereich mit dem fremden Rettungsmittel „RTW 3/83-2“ abtransportiert wird
- **THEN** verlässt R-004 den Wartebereich und erscheint nicht in „Unterwegs“

### Requirement: Lange unterwegs ist sichtbar
Ab 60 Minuten seit der Abfahrt SHALL eine Zeile der Spalte „Unterwegs“ die Marke „Übergabe offen“
in der Rolle `achtung` tragen, ohne Ton, Toast oder Sperre. Die Marke MUST mit der Zeit erscheinen,
ohne dass neue Daten eintreffen.

#### Scenario: Lange unterwegs
- **WHEN** R-008 seit 65 Minuten unterwegs ist
- **THEN** trägt seine Zeile die Marke „Übergabe offen“
