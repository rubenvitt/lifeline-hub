# eingabegrenzen Specification

## Purpose
Schreibendpunkte nehmen Freitexte, Listen und Geometrien nur bis zu einer festen Größe an.
So kann kein einzelner Request die Schreibsperre lange belegen oder dauerhaft übergroße
Einträge im ETB, in der Lagekarte und im Offline-Lagebild hinterlassen.

## Requirements

### Requirement: Freitext über der Grenze ist ein Feldfehler
Ein Freitextfeld mit Grenze MUST nach dem Trimmen höchstens so viele Zeichen (Unicode-
Skalarwerte) enthalten, wie seine Grenze erlaubt. Ein längerer Wert MUST mit 400 und der
Meldung „{Feld} darf höchstens {max} Zeichen lang sein“ abgelehnt werden, ohne dass etwas
gespeichert wird. Ein Wert mit genau `max` Zeichen MUST angenommen werden.

#### Scenario: Genau an der Grenze
- **WHEN** ein ETB-Eintrag mit einem `inhalt` von genau 20 000 Zeichen erfasst wird
- **THEN** antwortet der Server mit Erfolg und speichert den Eintrag

#### Scenario: Ein Zeichen zu viel
- **WHEN** ein ETB-Eintrag mit einem `inhalt` von 20 001 Zeichen erfasst wird
- **THEN** antwortet der Server mit 400, die Meldung nennt „Inhalt“ und 20 000, und es entsteht kein Eintrag

#### Scenario: Umlaute zählen als ein Zeichen
- **WHEN** ein Feld mit Grenze 200 einen Wert aus 200 „ä“ erhält
- **THEN** wird der Wert angenommen

### Requirement: ETB-Felder sind auf jedem Eingang begrenzt
`inhalt` eines ETB-Eintrags MUST höchstens 20 000 Zeichen, `von`, `an` und `veranlassung`
MUST höchstens 500 Zeichen lang sein. Das MUST für jeden Weg gelten, auf dem Text von außen
unverändert in diese Felder gelangt: Erfassung und Berichtigung, Heraufstufen aus dem Chat,
Meldung, Nachforderung und Vollzugsmeldung. Systemtexte des ETB sind davon ausgenommen.

#### Scenario: Zu langer Absender einer Meldung
- **WHEN** eine Meldung mit einem Absender von 501 Zeichen angelegt wird
- **THEN** antwortet der Server mit 400, und weder Meldung noch ETB-Eintrag entstehen

#### Scenario: Heraufstufen eines zu langen Chat-Texts
- **WHEN** eine Chat-Nachricht ohne eigenen Text heraufgestuft wird und ihr gespeicherter Inhalt länger als 20 000 Zeichen ist
- **THEN** antwortet der Server mit 400, und es entsteht kein ETB-Eintrag

#### Scenario: Replay vor der Grenzprüfung
- **WHEN** ein ETB-Eintrag mit einer schon verwendeten `client_id` und demselben Inhalt erneut gesendet wird
- **THEN** antwortet der Server wie bisher mit dem gespeicherten Eintrag

### Requirement: Auftrag begrenzt Text und Empfänger
Ein Auftrag MUST höchstens 50 Empfänger im Request haben, sonst 400. Gleiche Empfänger
(gleicher Typ und gleiches Ziel) MUST zu einem zusammengeführt werden. `auftrag_text` MUST
höchstens 10 000, `extern_bezeichnung` höchstens 200 und jedes Feld des Befehlsschemas
höchstens 2 000 Zeichen lang sein. Das MUST auf jedem Weg gelten, auf dem ein Auftrag entsteht,
und ebenso für die Berichtigung eines Auftrags. Der Grund beim Aufheben eines Auftrags MUST
höchstens 2 000 Zeichen lang sein, sonst 400.

#### Scenario: Doppelte Empfänger
- **WHEN** ein Auftrag mit drei identischen Empfängern derselben Einheit erteilt wird
- **THEN** entsteht der Auftrag mit genau einem Empfänger

#### Scenario: Zu viele Empfänger
- **WHEN** ein Auftrag mit 51 Empfängern erteilt wird, ob aus der Auftragsliste, dem ETB, einer Meldung oder dem Chat
- **THEN** antwortet der Server mit 400, und es entsteht kein Auftrag

#### Scenario: Berichtigung mit zu langem Text
- **WHEN** eine Berichtigung einen Auftragstext mit 10 001 Zeichen sendet
- **THEN** antwortet der Server mit 400, und der Auftrag bleibt unverändert

#### Scenario: Zu langer Aufhebungsgrund
- **WHEN** ein Auftrag mit einem Grund von 2 001 Zeichen aufgehoben werden soll
- **THEN** antwortet der Server mit 400, und der Auftrag bleibt offen

### Requirement: Das ETB-An eines Auftrags hat eine feste Höchstlänge
Das `an` des ETB-Eintrags, den ein Auftrag anlegt, MUST höchstens 500 Zeichen lang sein.
Passen nicht alle Empfänger hinein, MUST es mit „… und N weitere“ enden, wobei N die Zahl der
nicht genannten Empfänger ist. Die Empfänger des Auftrags selbst MUST vollständig bleiben.

#### Scenario: Viele lange Empfängernamen
- **WHEN** ein Auftrag an 50 Funktionen mit je 200 Zeichen langem Text erteilt wird
- **THEN** hat das `an` des ETB-Eintrags höchstens 500 Zeichen, endet mit „… und N weitere“, und der Auftrag hat 50 Empfänger

### Requirement: Zuordnungslisten sind entdoppelt und begrenzt
Eine Liste von Sprechgruppen für einen Abschnitt, eine Einheit oder die Führungsstelle MUST
entdoppelt werden und darf höchstens 32 verschiedene Einträge haben; eine Liste von
Qualifikationen höchstens 64. Eine längere Liste MUST mit 400 abgelehnt werden, bevor etwas
geschrieben wird. Eine nicht zuordenbare Sprechgruppe MUST weiterhin 422 ergeben.

#### Scenario: Dubletten
- **WHEN** einem Abschnitt die Sprechgruppen `[7, 7, 7, 8]` zugeordnet werden
- **THEN** trägt der Abschnitt genau die Sprechgruppen 7 und 8

#### Scenario: Zu lange Liste bei der Abschnitts-Änderung
- **WHEN** eine Änderung eines Abschnitts einen neuen Lagezustand und 33 verschiedene Sprechgruppen sendet
- **THEN** antwortet der Server mit 400, und weder Lagezustand noch Zuordnung ändern sich

#### Scenario: Fremde Sprechgruppe
- **WHEN** eine Sprechgruppe einer anderen Organisation zugeordnet werden soll
- **THEN** antwortet der Server wie bisher mit 422

### Requirement: Zuordnungen brauchen eine feste Zahl von Anweisungen
Prüfen und Schreiben einer Sprechgruppen- oder Qualifikationsliste MUST eine von der
Listenlänge unabhängige Zahl von Datenbankanweisungen brauchen und MUST unter der
Schreib-Wiederholung laufen, die bei belegter Sperre neu versucht.

#### Scenario: Volle Liste
- **WHEN** einer Einheit 32 Sprechgruppen zugeordnet werden
- **THEN** braucht die Zuordnung nicht mehr Anweisungen als bei einer Sprechgruppe

### Requirement: Geometrien von Zonen und Abschnittsflächen sind strukturell gültig
Die Geometrie einer neuen Zone und einer Abschnittsfläche MUST höchstens 256 KiB groß sein,
höchstens 10 Ringe und 5 000 Stützpunkte haben, und jede Position MUST aus endlichen Zahlen
mit Länge in [-180, 180] und Breite in [-90, 90] bestehen. Verstöße MUST 400 ergeben; kaputtes
JSON und ein unpassender Geometrietyp MUST weiterhin 422 ergeben.

#### Scenario: Zu viele Stützpunkte
- **WHEN** eine Zone mit einem Polygon aus 5 001 Positionen angelegt wird
- **THEN** antwortet der Server mit 400, und die Zone entsteht nicht

#### Scenario: Nichtnumerische Koordinaten
- **WHEN** eine Abschnittsfläche mit der Position `["a", 52]` gesetzt wird
- **THEN** antwortet der Server mit 400

#### Scenario: Gezeichnete Zone
- **WHEN** eine Zone, wie sie das Zeichenwerkzeug der Lagekarte erzeugt, angelegt wird
- **THEN** wird sie unverändert angenommen

### Requirement: Freitexte in Infotelefon, Presse und Schaden sind begrenzt
Die Freitexte der Anruferfassung, der Medienkontakte (Anlegen, Ändern, Status) und der
Schäden (Anlegen, Ändern) MUST die Grenzen der Tabelle in `design.md` (D6) einhalten, sonst
400. Bestehende 422 für fehlende Rückrufnummer und fehlende Antwort MUST bleiben.

#### Scenario: Zu lange Schadensbeschreibung beim Ändern
- **WHEN** ein Schaden mit einer Beschreibung von 8 001 Zeichen geändert wird
- **THEN** antwortet der Server mit 400, und der Schaden bleibt unverändert

### Requirement: Masken lassen nicht mehr zu als der Server
Jede Eingabemaske eines begrenzten Feldes MUST verhindern, dass ein Wert über der Grenze des
Servers gesendet wird, und MUST NOT einen Text dabei still kürzen. Ab 80 % der Grenze MUST eine
Zählanzeige den Stand als „n / max“ zeigen, über der Grenze zusätzlich „zu lang“. Die
ETB-Erfassung MUST einen zu langen Eintrag vor dem Senden zurückhalten, ihn weder senden noch
in die Offline-Queue einreihen und den Text im Feld lassen.

#### Scenario: Zähler erscheint kurz vor der Grenze
- **WHEN** jemand in die Schadensbeschreibung 6 400 von 8 000 erlaubten Zeichen eingibt
- **THEN** zeigt die Maske „6.400 / 8.000“

#### Scenario: Vorbelegter Text über der Grenze
- **WHEN** eine Maske mit einem Text über der Grenze vorbelegt ist und die Person darin ein Wort löscht
- **THEN** bleibt der übrige Text vollständig stehen, die Zählanzeige nennt die Überlänge, und Senden ist gesperrt, bis gekürzt ist

#### Scenario: Baustein macht den ETB-Text zu lang
- **WHEN** ein eingefügter Baustein den ETB-Inhalt über 20 000 Zeichen bringt und die Person sendet
- **THEN** sendet die Erfassung nicht, reiht nichts ein, nennt die Grenze und lässt den Text im Feld

### Requirement: Die Lagekarte hält zu große Zeichnungen zurück
Beim Zeichnen einer Zone oder einer Abschnittsfläche MUST die Lagekarte ab mehr als 5 000
Punkten auf die Grenze hinweisen und das Speichern verhindern.

#### Scenario: Zeichnung über der Grenze
- **WHEN** eine gezeichnete Zone mehr als 5 000 Punkte hat
- **THEN** zeigt die Zeichensteuerung den Hinweis auf die Grenze, und Speichern ist nicht möglich

### Requirement: Übergroßer Body wird vor dem Handler abgewiesen
Ein Request-Body MUST höchstens 256 KiB groß sein, sofern die Route kein eigenes Limit trägt.
Ein eigenes Limit MUST nur eine Route tragen, deren Body enger zu begrenzen ist (öffentliche
Anmelderouten) oder legitim größer sein kann (Uploads, Logo, Zone anlegen und Abschnittsfläche
setzen mit 320 KiB). Ein JSON-Body über dem Limit seiner Route MUST mit 413 und einer Meldung im
`{error}`-Format abgelehnt werden, ohne dass der Handler läuft. Uploads (Multipart) behalten ihre
eigenen Meldungen.

#### Scenario: Zu großer Body an einer normalen Schreibroute
- **WHEN** ein ETB-Eintrag mit einem Body von 256 KiB + 1 Byte erfasst wird
- **THEN** antwortet der Server mit 413 und einer Meldung, und es entsteht kein Eintrag

#### Scenario: Body an der Grenze erreicht die Feldprüfung
- **WHEN** ein ETB-Eintrag mit einem Body von genau 256 KiB und zu langem `inhalt` erfasst wird
- **THEN** antwortet der Server mit 400 und der Feldmeldung zu „Inhalt“

#### Scenario: Geometrie knapp über 256 KiB
- **WHEN** eine Zone mit einer Geometrie von 256 KiB + 1 Byte angelegt wird
- **THEN** antwortet der Server mit 400 aus der Geometrieprüfung, nicht mit 413

#### Scenario: Geometrie-Route über ihrem Limit
- **WHEN** eine Zone mit einem Body über 320 KiB angelegt wird
- **THEN** antwortet der Server mit 413

### Requirement: Meldende Stelle ist begrenzt
Die meldende Stelle eines Einsatzes MUST beim Ändern des Einsatzes nach dem Trimmen höchstens
200 Zeichen lang sein, sonst 400 ohne Änderung am Einsatz. Ein schon gespeicherter längerer Wert
MUST stehen bleiben, bis jemand ihn ändert. Die Eingabe der Seite Einsatzdaten MUST dieselbe
Grenze einhalten.

#### Scenario: Ein Zeichen zu viel
- **WHEN** ein Einsatz mit einer meldenden Stelle von 201 Zeichen geändert wird
- **THEN** antwortet der Server mit 400, die Meldung nennt „Meldende Stelle“ und 200, und der Einsatz bleibt unverändert

#### Scenario: Genau an der Grenze
- **WHEN** ein Einsatz mit einer meldenden Stelle von genau 200 Zeichen geändert wird
- **THEN** speichert der Server den Wert

#### Scenario: Andere Angabe eines Einsatzes mit Altwert
- **WHEN** ein Einsatz eine gespeicherte meldende Stelle von 300 Zeichen hat und nur die Leitstellen-Nr. geändert wird
- **THEN** speichert der Server die Leitstellen-Nr., und die meldende Stelle bleibt unverändert

### Requirement: Sammel-Disposition ist gedeckelt
Eine Sammel-Disposition MUST höchstens 50 Kräfte je Anfrage annehmen, gezählt vor dem
Entdoppeln, und eine längere Liste mit 400 ablehnen, bevor etwas geschrieben wird. Die Prüfung
der Menge MUST eine von der Listenlänge unabhängige Zahl von Anweisungen brauchen; geschrieben
MAY je Kraft werden.

#### Scenario: 51 Kräfte
- **WHEN** eine Sammel-Disposition 51 Personen schickt
- **THEN** antwortet der Server mit 400, und nichts ist angelegt

#### Scenario: Dubletten
- **WHEN** eine Sammel-Disposition dieselbe Person zweimal nennt
- **THEN** ist die Person genau einmal disponiert

### Requirement: Ad-hoc-Fahrzeug und Fahrzeugbemerkung sind begrenzt
Funkrufname, Typ, Kennzeichen, Trägerorganisation und OPTA eines Ad-hoc-Fahrzeugs MUST beim
Disponieren und beim Ändern höchstens 200 Zeichen lang sein, die Bemerkung einer
Fahrzeug-Disposition höchstens 2 000 Zeichen. Ein längerer Wert MUST mit 400 abgelehnt werden,
bevor ein Zusammenhang geprüft oder etwas geschrieben wird. Die Masken MUST dieselben Grenzen
tragen.

#### Scenario: Zu langer Funkrufname beim Disponieren
- **WHEN** ein Ad-hoc-Fahrzeug mit einem Funkrufnamen aus 201 Zeichen disponiert wird
- **THEN** antwortet der Server mit 400, und weder Fahrzeug noch ETB-Eintrag entstehen

#### Scenario: Grenze vor dem Zusammenhang
- **WHEN** für ein Stamm-Fahrzeug ein Kennzeichen aus 201 Zeichen gesendet wird
- **THEN** antwortet der Server mit 400, nicht mit 422

### Requirement: Name einer Einheit ist begrenzt
Der Name einer Einheit MUST beim Bilden und beim Ändern höchstens 200 Zeichen lang sein, sonst
MUST der Server mit 400 ablehnen, bevor etwas geschrieben wird.

#### Scenario: Zu langer Name beim Bilden
- **WHEN** eine Einheit mit einem Namen aus 201 Zeichen gebildet werden soll
- **THEN** antwortet der Server mit 400, und weder Einheit noch ETB-Eintrag entstehen

#### Scenario: Zu langer Name beim Ändern
- **WHEN** der Name einer Einheit auf 201 Zeichen geändert werden soll
- **THEN** antwortet der Server mit 400, und der Name bleibt
