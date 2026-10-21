# lagekarte-abschnitt-fokus Specification

## Purpose

Die Lagekarte richtet sich auf Wunsch auf einen Einsatzabschnitt aus: Sie passt den Ausschnitt
auf seine Fläche ein und dämpft die Kräfte fremder Abschnitte, ohne sie zu entfernen. Der Fokus
ist reine Darstellung. Er ändert weder Ebenen noch Zähler, wird nicht gespeichert und lässt sich
per Band im Kartenfuß oder per Esc wieder aufheben. Ein Link `?abschnitt=<id>` öffnet die Karte
mit diesem Fokus.

## Requirements

### Requirement: Einstieg über den Inspector

Die Lagekarte SHALL den Fokus über die Handlung „Abschnitt fokussieren“ im Inspector eines
ausgewählten Einsatzabschnitts anbieten. Die Handlung MUST ohne Schreibrecht stehen, weil der
Fokus nichts ändert. Sie MUST fehlen, solange genau dieser Abschnitt fokussiert ist. Die Zeilen
der Objektliste MUST keine eigene Fokus-Handlung tragen. Ein Abschnitt ohne Fläche hat keinen
Marker; seine Zeile in der Objektliste MUST ihn auswählen, und sein Inspector MUST ohne
Koordinate und ohne „Verortung löschen“ stehen und „Abschnitt fokussieren“ tragen.

#### Scenario: Abschnitt aus dem Inspector fokussieren

- **WHEN** eine Person den Abschnitt „EA Süd“ auf der Karte wählt und „Abschnitt fokussieren“ betätigt
- **THEN** steht der Fokus auf „EA Süd“, und das Band im Kartenfuß nennt ihn

#### Scenario: Kein zweiter Einstieg für denselben Abschnitt

- **WHEN** „EA Süd“ fokussiert ist und eine Person ihn erneut wählt
- **THEN** trägt sein Inspector die Handlung „Abschnitt fokussieren“ nicht

#### Scenario: Abschnitt ohne Fläche aus der Objektliste

- **WHEN** „EA Ost“ keine Fläche hat und eine Person in der Objektliste seine Zeile tippt und dann „Abschnitt fokussieren“ betätigt
- **THEN** steht der Fokus auf „EA Ost“, und sein Inspector zeigte keine Koordinate

### Requirement: Ausschnitt auf den Abschnitt

Beim Fokussieren MUST die Karte den Ausschnitt auf die Fläche des Abschnitts einpassen, mit Rand
und höchstens bis zum Anflug-Zoom, bei gleichbleibender Drehung. Hat der Abschnitt keine Fläche,
MUST sie die Flächen seiner Unterabschnitte und die verorteten Kräfte des Abschnitts samt
Unterabschnitten einpassen. Steht davon nichts auf der Karte, MUST der Fokus ohne Kamerafahrt
gelten.

#### Scenario: Abschnitt mit Fläche

- **WHEN** „EA Nord“ eine Fläche hat und fokussiert wird
- **THEN** passt die Karte den Ausschnitt auf diese Fläche ein

#### Scenario: Abschnitt ohne Fläche

- **WHEN** „EA Ost“ keine Fläche hat, aber zwei verortete Einheiten führt, und fokussiert wird
- **THEN** passt die Karte den Ausschnitt auf diese beiden Einheiten ein

#### Scenario: Nichts zu zeigen

- **WHEN** ein Abschnitt ohne Fläche und ohne verortete Kräfte fokussiert wird
- **THEN** gilt der Fokus, und die Kamera bleibt stehen

### Requirement: Fremde Kräfte gedämpft, nicht entfernt

Im Fokus MUST die Karte Einheiten, Fahrzeuge, Abschnittszeichen und Abschnittsflächen fremder
Abschnitte mit verringerter Deckkraft zeichnen und MUST sie weiter zeichnen. Eigen sind der
fokussierte Abschnitt und alle seine Unterabschnitte; eine Einheit gehört zu ihrem eigenen oder
geerbten Abschnitt, ein Fahrzeug zum Abschnitt seiner Einheit. Kräfte ohne Abschnitt,
Führungskräfte und alle übrigen Objekte MUST ungedämpft bleiben.

#### Scenario: Fremde Einheit

- **WHEN** „EA Nord“ fokussiert ist und die Einheit „Gruppe A“ zu „EA Süd“ gehört
- **THEN** zeichnet die Karte „Gruppe A“ gedämpft an ihrer Stelle, und sie bleibt anwählbar

#### Scenario: Unterabschnitt

- **WHEN** „EA Nord“ fokussiert ist und „UA Hafen“ darunter liegt
- **THEN** zeichnet die Karte Fläche und Kräfte von „UA Hafen“ voll

#### Scenario: Schadenstelle

- **WHEN** ein Abschnitt fokussiert ist
- **THEN** zeichnet die Karte Schadenstellen voll

### Requirement: Bündel im Fokus

Im Fokus MUST die Karte ein Bündel von Markern, dessen Marker alle gedämpft sind, mit derselben
verringerten Deckkraft zeichnen, und das Bündel MUST sich weiter auffächern lassen. Ein Bündel mit
mindestens einem ungedämpften Marker MUST voll bleiben. Der Lageplan MUST ein Bündel so zeichnen
wie die Karte.

#### Scenario: Bündel nur aus fremden Kräften

- **WHEN** „EA Nord“ fokussiert ist und drei Einheiten von „EA Süd“ zu einem Bündel zusammenstehen
- **THEN** zeichnet die Karte das Bündel gedämpft, und es fächert beim Antippen auf

#### Scenario: Gemischtes Bündel

- **WHEN** „EA Nord“ fokussiert ist und ein Bündel eine Einheit von „EA Süd“ und eine Schadenstelle enthält
- **THEN** zeichnet die Karte das Bündel voll

### Requirement: Fokus als reine Darstellung

Der Fokus SHALL nur die Darstellung der Karte ändern. Ebenenschalter, Gruppenzähler, Objektliste
und Suche MUST vom Fokus unberührt bleiben, und kein Objekt MUST durch ihn von der Karte fallen.

#### Scenario: Ebenenbaum im Fokus

- **WHEN** ein Abschnitt fokussiert ist
- **THEN** zeigen Ebenenschalter und Gruppenzähler dieselben Werte wie ohne Fokus

### Requirement: Fokus aufheben

Solange ein Fokus gilt, MUST der Kartenfuß ein Band mit dem Namen des Abschnitts und der
Handlung „Fokus aufheben“ zeigen, gestapelt nach der Stapelregel des Kartenfußes. „Fokus
aufheben“ MUST die Dämpfung beenden und die Kamera auf den Stand vor dem ersten Fokus
zurückführen; ein Wechsel von einem Abschnitt zum nächsten MUST diesen Stand behalten. Ein
Einsatzwechsel MUST den Fokus beenden.

#### Scenario: Über das Band

- **WHEN** ein Abschnitt fokussiert ist und eine Person „Fokus aufheben“ betätigt
- **THEN** verschwindet das Band, alle Kräfte stehen wieder voll, und die Kamera fährt zurück

### Requirement: Esc im Fokus

Esc MUST bei offener Auswahl erst die Auswahl schließen und erst danach den Fokus aufheben. Ist
ein Bündel der Karte aufgefächert, MUST Esc vorher das Bündel einklappen. Eine Taste MUST genau
eine Stufe wirken. Während eines exklusiven Kartenmodus, in einem Eingabefeld und bei offenem
Menü oder Dialog MUST Esc den Fokus stehen lassen.

#### Scenario: Esc mit offener Auswahl

- **WHEN** ein Abschnitt fokussiert ist, eine Auswahl offen steht und eine Person Esc drückt
- **THEN** schließt sich die Auswahl, und der Fokus bleibt

#### Scenario: Esc ohne Auswahl

- **WHEN** ein Abschnitt fokussiert ist, keine Auswahl offen steht und eine Person Esc drückt
- **THEN** ist der Fokus aufgehoben, und die Kamera fährt zurück

#### Scenario: Esc mit Bündel, Auswahl und Fokus

- **WHEN** ein Abschnitt fokussiert ist, eine Auswahl offen steht, ein Bündel aufgefächert ist und eine Person dreimal Esc drückt
- **THEN** klappt die erste Taste das Bündel ein, die zweite schließt die Auswahl, die dritte hebt den Fokus auf

#### Scenario: Esc beim Messen

- **WHEN** ein Abschnitt fokussiert ist, das Messen läuft und eine Person Esc drückt
- **THEN** endet das Messen, und der Fokus bleibt

### Requirement: Sprung von der Abschnittsseite

Die Seite „Einsatzabschnitte“ SHALL im Detail des gewählten Abschnitts den Sprung „Auf Karte
zeigen ↗“ anbieten, der die Lagekarte mit `?abschnitt=<id>` dieses Abschnitts öffnet. Der Sprung
MUST ohne Schreibrecht stehen und MUST kein Eintrag im Menü der Handlungen sein. Ohne Freigabe des
Moduls Lagekarte MUST er gesperrt stehen und seinen Grund im sichtbaren Text nennen.

#### Scenario: Von der Abschnittsseite auf die Karte

- **WHEN** eine Person auf der Seite „Einsatzabschnitte“ „EA Süd“ wählt und „Auf Karte zeigen ↗“ betätigt
- **THEN** öffnet die Lagekarte mit dem Fokus auf „EA Süd“, und die Adresse trägt den Parameter nicht mehr

#### Scenario: Lagekarte gesperrt

- **WHEN** die Person das Modul Lagekarte nicht nutzen darf
- **THEN** steht „Auf Karte zeigen“ gesperrt mit „Keine Berechtigung“, und es gibt keinen Link

### Requirement: Fokus per Link

Die Lagekarte SHALL den Parameter `?abschnitt=<id>` annehmen. Sobald die Seite geladen und die
Startansicht entschieden ist, MUST sie den Abschnitt fokussieren, wenn sie ihn kennt, und den
Parameter in jedem Fall aus der Adresse entfernen. Der Fokus MUST weder in der Adresse noch in
einer Kartenansicht noch im Browser-Speicher bleiben.

#### Scenario: Link auf einen Abschnitt

- **WHEN** eine Person `/einsaetze/1/lagekarte?abschnitt=3` öffnet und Abschnitt 3 existiert
- **THEN** steht der Fokus auf Abschnitt 3, und die Adresse trägt den Parameter nicht mehr

#### Scenario: Unbekannter Abschnitt

- **WHEN** eine Person `/einsaetze/1/lagekarte?abschnitt=99` öffnet und es keinen Abschnitt 99 gibt
- **THEN** gilt kein Fokus, und die Adresse trägt den Parameter nicht mehr

#### Scenario: Neu laden

- **WHEN** ein Abschnitt fokussiert ist und eine Person die Seite neu lädt
- **THEN** öffnet die Karte ohne Fokus
