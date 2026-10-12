# Spec Delta

## Purpose

Legt fest, welche Angaben ein Einzelauftrag trägt und in welcher Reihenfolge das
Auftragsformular sie abfragt und die Auftragskarte sie zeigt. Grundlage ist das Schema der
FwDV 100 für den Einzelauftrag (Einheit – Auftrag – Mittel – Ziel – Weg, ergänzt um die Zeit).

## ADDED Requirements

### Requirement: Das Auftragsformular folgt der Reihenfolge der FwDV 100
Das Formular für einen neuen Auftrag SHALL im Ausgangszustand genau vier Felder zeigen, in dieser
Reihenfolge: Empfänger, „Auftrag / Was“, Priorität, „Frist (Quittung/Vollzug)“. Empfänger und
„Auftrag / Was“ sind Pflicht und MUST sichtbar bleiben. Das erste Feld, das beim Öffnen und nach
jedem Serien-Speichern den Fokus bekommt, SHALL der Empfänger sein. Die Reihenfolge MUST in
jeder Einbettung des Formulars gelten: Auftragsliste, ETB, Meldung und Chat.

#### Scenario: Ausgangszustand
- **WHEN** jemand das Formular „Neuer Auftrag“ öffnet
- **THEN** stehen genau Empfänger, „Auftrag / Was“, Priorität und „Frist (Quittung/Vollzug)“ als Felder im Formular, in dieser Reihenfolge
- **AND** der Fokus liegt im Empfänger

#### Scenario: Auftrag aus einer Meldung
- **WHEN** jemand aus einer Meldung einen Auftrag formuliert und der Auftragstext vorbelegt ist
- **THEN** steht der Empfänger vor dem vorbelegten „Auftrag / Was“ und hat den Fokus

### Requirement: Die Ausführung steht in einem eigenen Klappteil
Hinter dem ersten Klappteil „Ausführung: Mittel, Ziel, Weg, Zeit“ SHALL das Formular genau diese
vier Felder in dieser Reihenfolge tragen: „Mittel / Womit“, „Ziel / Ort“, „Weg“, „Zeit / Wann“.
Hinter dem zweiten Klappteil „Weitere Angaben“ SHALL es „Lage“, „Absicht“, „Verbindung /
Meldewege“, „Sicherheit / Besonderes“, „Richtung“ und „Erteilt am (optional)“ tragen. Bei Richtung
„Extern“ kommen „Externe Stelle“ und „Bezeichnung der Stelle“ dazu. Beide Klappteile MUST im
Ausgangszustand geschlossen sein, und im Ausgangszustand MUST kein Feld eines Klappteils als
Feld im Formular stehen.

#### Scenario: Aufklappen der Ausführung
- **WHEN** jemand im Ausgangszustand „Ausführung: Mittel, Ziel, Weg, Zeit“ aufklappt
- **THEN** stehen acht Felder im Formular
- **AND** die vier neuen sind „Mittel / Womit“, „Ziel / Ort“, „Weg“ und „Zeit / Wann“, in dieser Reihenfolge

#### Scenario: Aufklappen der weiteren Angaben
- **WHEN** jemand im Ausgangszustand „Weitere Angaben“ aufklappt
- **THEN** kommen „Lage“, „Absicht“, „Verbindung / Meldewege“, „Sicherheit / Besonderes“, „Richtung“ und „Erteilt am (optional)“ dazu

### Requirement: Ein Klappteil öffnet sich bei einem Prüffehler darin
Scheitert beim Absenden die Prüfung eines Feldes, das hinter einem geschlossenen Klappteil liegt,
SHALL sich dieses Klappteil öffnen, damit der Grund am Feld sichtbar ist. Es MUST NOT ein
Auftrag entstehen.

#### Scenario: Zu langer Weg bei geschlossenem Klappteil
- **WHEN** im Feld „Weg“ mehr als 2 000 Zeichen stehen, jemand den Klappteil „Ausführung: Mittel, Ziel, Weg, Zeit“ schließt und „Auftrag erteilen“ wählt
- **THEN** ist der Klappteil wieder offen, am Feld „Weg“ steht der Grund, und es wurde keine Anfrage gesendet

### Requirement: Ein Auftrag trägt den Weg
Ein Auftrag SHALL eine optionale Angabe „Weg“ tragen: die Wegführung oder Anmarschroute der
Einheit. Sie ist ein Feld des Befehlsschemas mit derselben Höchstlänge wie die übrigen Felder.
Der Server MUST sie auf jedem Weg annehmen, getrimmt speichern und leer als nicht gesetzt führen,
auf dem ein Auftrag entsteht (Auftragsliste, ETB, Meldung, Chat). Jede Antwort, die einen Auftrag
ausliefert, SHALL sie tragen. Bei einer Schwärzung des Einsatzes MUST sie wie die übrigen Felder
des Befehlsschemas geleert werden.

#### Scenario: Weg gespeichert und gelesen
- **WHEN** ein Auftrag mit dem Weg „  über B 3, Abfahrt Nord  “ erteilt wird
- **THEN** trägt der Auftrag im Detail und in der Liste den Weg „über B 3, Abfahrt Nord“

#### Scenario: Leerer Weg
- **WHEN** ein Auftrag mit einem Weg aus Leerzeichen erteilt wird
- **THEN** trägt der Auftrag keinen Weg

#### Scenario: Zu langer Weg
- **WHEN** ein Auftrag mit einem Weg von 2 001 Zeichen erteilt wird
- **THEN** antwortet der Server mit 400, die Meldung nennt „Weg“, und es entsteht kein Auftrag

#### Scenario: Schwärzung
- **WHEN** ein Einsatz geschwärzt wird, dessen Auftrag einen Weg trägt
- **THEN** ist der Weg danach leer

### Requirement: Ziel und Absicht sind getrennte Angaben
Das Formular und die Auftragskarte SHALL das Ziel und die Absicht eines Auftrags getrennt führen.
„Ziel / Ort“ ist der Ort, an dem oder zu dem der Auftrag ausgeführt wird. „Absicht“ ist der Zweck
des Auftrags. Bestehende Aufträge MUST ihre gespeicherten Werte behalten: was als „Ort / Wo“
gespeichert wurde, erscheint als „Ziel / Ort“, und was als „Absicht / Ziel“ gespeichert wurde,
erscheint als „Absicht“.

#### Scenario: Bestandsauftrag
- **WHEN** ein vor dieser Änderung erteilter Auftrag mit Ort „Halle 3“ und Absicht „Brand eindämmen“ angezeigt wird
- **THEN** zeigt die Karte „Ziel / Ort: Halle 3“ und „Absicht: Brand eindämmen“

### Requirement: Die Auftragskarte liest in derselben Reihenfolge
Die Lesefassung der Befehlsschema-Felder an der Auftragskarte SHALL dieselbe Reihenfolge
wie das Formular haben:
- Mittel
- Ziel / Ort
- Weg
- Zeit
- Lage
- Absicht
- Verbindung / Meldewege
- Sicherheit / Besonderes
- Erteilt am

Leere Felder MUST wegfallen. Ohne ein gesetztes Feld MUST der Klappteil der Details fehlen.

#### Scenario: Teilweise gefüllter Auftrag
- **WHEN** ein Auftrag mit Mittel, Weg und Absicht angezeigt und seine Details aufgeklappt werden
- **THEN** stehen genau „Mittel“, „Weg“, „Absicht“ und „Erteilt am“ in dieser Reihenfolge
