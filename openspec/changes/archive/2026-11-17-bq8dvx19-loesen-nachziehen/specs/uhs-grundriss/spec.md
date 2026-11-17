## MODIFIED Requirements

### Requirement: Zeilenform in der kompakten Stufe
In der Stufe „kompakt“ SHALL die Platzkarte ihre Aktionen als Knopfzeile tragen. Die Zeile
enthält „Verbleib / Entlassung erfassen“, „zurückweisen“, „als frei markieren“ und den Auslöser
des Platzmenüs, jeweils nur, wenn sie anwendbar sind. Jeder Knopf MUST den Trefflächenboden der
Stufe halten, das sind 24 px in der kurzen Achse. Die Zeile MUST in die Innenbreite der Karte
passen, Knöpfe und Lücken zusammengerechnet. Neben „zurückweisen“ MUST ein
Abstand von mindestens dem kleinen Randabstand der Stufe stehen; es steht neutral, denn es
hat ein Rückgängig (LLH-1924). Ein Klick auf die freie Fläche
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
- **THEN** öffnet sich das Aktionsmenü, sein erster Eintrag ist „Verbleib / Entlassung erfassen“, und es enthält „Person öffnen“, „Zurück in den Wartebereich“, die Verfügbarkeiten sowie hinter einem Trenner „zurückweisen“ als neutralen Eintrag

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

## ADDED Requirements

### Requirement: Zurückweisen rückgängig
Nach „zurückweisen“ an einem Platz SHALL ein Hinweis „<Kennung> zurückgewiesen“ mit „Rückgängig“
stehen. „Rückgängig“ MUST den eben gebuchten Austritt zurücknehmen, mit denselben Regeln wie
beim Austragen im Patientenkopf (Platz, Wartezeit, zehn Minuten). Eine Ablehnung MUST im
Hinweis der Seite stehen, ohne Fehler-Toast. Weil es umkehrbar ist, steht „zurückweisen“ neutral
(ADR-0055), hinter dem Trenner zuletzt.

#### Scenario: Zurückweisen rückgängig
- **WHEN** jemand im Grundriss bei R-009 auf Platz 3 „zurückweisen“ und im Hinweis „Rückgängig“ wählt
- **THEN** liegt R-009 wieder auf Platz 3, und Platz 3 steht nicht in Aufbereitung

#### Scenario: Am UHS-Laptop
- **WHEN** am gekoppelten Gerät der UHS „zurückweisen“ und danach „Rückgängig“ gewählt wird
- **THEN** liegt die Person wieder auf ihrem Platz
