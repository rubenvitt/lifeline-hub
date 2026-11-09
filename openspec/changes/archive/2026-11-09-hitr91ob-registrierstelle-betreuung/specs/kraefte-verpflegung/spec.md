## MODIFIED Requirements

### Requirement: Bedarfsvorschläge aus Personal und Betreuung

Die Oberfläche SHALL beim Anlegen eines Zeitfensters den Bedarf vorbelegen: die
Einsatzkräfte mit der aktuellen Personalstärke des Einsatzes, die Betreuten mit der Kopfzahl
„in Betreuung“ zum Beginn des Zeitfensters, die Sonderkost je Kostform mit der Zählung der
Registrierten (Kostformen ohne Personenbezug, Stand jetzt), sofern mindestens eine Person mit
Sonderkost registriert ist. Der Bedarf wird gespeichert und danach nicht
mehr aus den Quellen nachgerechnet. Jeder Vorschlag MUST sichtbar beschriftet und
überschreibbar sein. Liefert eine Quelle nichts, MUST das Feld leer bleiben statt 0 zu
zeigen. Eine Quelle, deren Modul der Person nicht zugänglich ist (ausgeblendet, per Rolle
gesperrt oder vom Server mit 403 abgelehnt), MUST ohne Fehler und ohne Wiederholungsversuch
entfallen.

#### Scenario: Vorschlag aus beiden Quellen
- **WHEN** der Einsatz 186 Personen im Personal führt und für den Beginn des Zeitfensters 70 Personen in Betreuung gemeldet sind
- **THEN** stehen 186 und 70 vorbelegt in den Bedarfsfeldern, jeweils mit Herkunftsangabe

#### Scenario: Betreuung ohne Meldung
- **WHEN** im Einsatz keine Betreuungsstelle eine Belegung gemeldet hat
- **THEN** bleibt das Feld Betreute leer und trägt den Hinweis, dass nichts gemeldet ist

#### Scenario: Kopfzahl ist eine Untergrenze
- **WHEN** zum Beginn des Zeitfensters mindestens eine Betreuungsstelle ohne Meldung existiert
- **THEN** trägt der Vorschlag den Hinweis, dass er eine Untergrenze ist

#### Scenario: Zeitfenster in der Zukunft
- **WHEN** das Zeitfenster nach dem aktuellen Zeitpunkt beginnt
- **THEN** trägt der Betreuungsvorschlag den Hinweis, dass er den heutigen Stand zeigt

#### Scenario: Betreuung nicht zugänglich
- **WHEN** das Modul Betreuung für die Person ausgeblendet ist
- **THEN** öffnet der Dialog ohne Fehlermeldung, und das Feld Betreute bleibt ohne Vorschlag

#### Scenario: Späterer Personalzuwachs
- **WHEN** nach dem Anlegen eines Zeitfensters weiteres Personal in den Einsatz kommt
- **THEN** bleiben Bedarf und Fehlmenge des Zeitfensters unverändert

#### Scenario: Sonderkost aus der Registrierung
- **WHEN** im Einsatz 40 Personen registriert sind, davon 6 vegetarisch und 2 vegan, und ein Zeitfenster angelegt wird
- **THEN** stehen 6 bei vegetarisch und 2 bei vegan vorbelegt, mit dem Hinweis „aus 40 Registrierten, Stand jetzt“, und die übrigen Sonderkost-Felder bleiben leer

#### Scenario: Keine Registrierten
- **WHEN** im Einsatz niemand registriert ist
- **THEN** bleiben die Sonderkost-Felder leer und ohne Hinweis
