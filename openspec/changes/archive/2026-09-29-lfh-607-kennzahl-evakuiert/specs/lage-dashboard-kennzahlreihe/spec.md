# Spec Delta

## Purpose

Die lagebezogene Kennzahlreihe des Lage-Dashboards: sechs feste Plätze, deren zwei Lageplätze
durch bewusste Entscheidungen am Einsatz belegt werden. Diese Fähigkeit beschreibt hier die
Lagekennzahl „Evakuiert“ auf Lageplatz B.

## ADDED Requirements

### Requirement: Auslöser „evakuiert“ am Einsatz

Das System SHALL in der Einsatzdarstellung (Einzelabruf und Liste) die Lagekennzahl
`evakuiert` genau dann ausweisen, wenn der Einsatz mindestens einen aktiven
Evakuierungsbezirk hat. Aktiv ist ein Bezirk, der nicht storniert ist und dessen
Räumungszustand nicht `aufgehoben` ist. Ein geräumter Bezirk MUST aktiv bleiben. Die Zahl der
Evakuierten und die Höhe der Plangröße MUST den Auslöser nicht beeinflussen. Einzelabruf und
Liste MUST denselben Auslöser liefern. Das Feld `lagekennzahlen` MUST immer vorhanden sein,
auch als leere Liste.

#### Scenario: Ohne Bezirk
- **WHEN** der Einsatz keinen Evakuierungsbezirk hat
- **THEN** enthält `lagekennzahlen` im Einzelabruf und in der Liste kein `evakuiert`

#### Scenario: Bezirk angelegt
- **WHEN** ein Evakuierungsbezirk mit Plangröße angelegt wird
- **THEN** enthält `lagekennzahlen` im Einzelabruf und in der Liste `evakuiert`

#### Scenario: Bezirk geräumt
- **WHEN** der einzige Bezirk auf Räumung `geraeumt` gesetzt wird
- **THEN** bleibt `evakuiert` in `lagekennzahlen`

#### Scenario: Letzter Bezirk aufgehoben oder storniert
- **WHEN** der letzte aktive Bezirk aufgehoben oder storniert wird
- **THEN** enthält `lagekennzahlen` kein `evakuiert` mehr

#### Scenario: Standmeldung ändert den Auslöser nicht
- **WHEN** zu einem aktiven Bezirk ein Stand gemeldet oder zurückgenommen wird
- **THEN** bleibt `lagekennzahlen` unverändert

#### Scenario: Pegel und Evakuierung
- **WHEN** der Einsatz einen festgelegten Pegel und einen aktiven Bezirk hat
- **THEN** enthält `lagekennzahlen` sowohl `pegel` als auch `evakuiert`

#### Scenario: Anderer Einsatz unberührt
- **WHEN** in Einsatz A ein Bezirk angelegt wird
- **THEN** enthält `lagekennzahlen` von Einsatz B kein `evakuiert`

### Requirement: Heimatplatz von „Evakuiert“

Das Lage-Dashboard SHALL „Evakuiert“ ausschließlich auf Platz 3 (Lageplatz B) zeigen, und
zwar genau dann, wenn der Einsatz die Lagekennzahl `evakuiert` trägt. Sonst MUST Platz 3
„Schäden offen“ zeigen. Die Reihe MUST immer sechs Plätze haben. Das Hinzukommen oder
Wegfallen von `evakuiert` MUST genau Platz 3 ändern. Die Reihenfolge der Lagekennzahlen in
der Antwort MUST die Reihe nicht beeinflussen.

#### Scenario: Evakuierung ohne Pegel
- **WHEN** der Einsatz nur `evakuiert` trägt
- **THEN** lautet die Reihe Verbleib offen · Betroffene · Evakuiert · Kräfte · Vermisste · Einsatzdauer

#### Scenario: Hochwasser wie Entwurf S3
- **WHEN** der Einsatz `pegel` und `evakuiert` trägt, in beliebiger Reihenfolge
- **THEN** lautet die Reihe Pegel · Betroffene · Evakuiert · Kräfte · Vermisste · Einsatzdauer

#### Scenario: Eine Entscheidung ändert einen Platz
- **WHEN** zu einer beliebigen Menge von Lagekennzahlen `evakuiert` hinzukommt
- **THEN** unterscheidet sich die neue Reihe von der alten genau an Platz 3

### Requirement: Wert und Notiz von „Evakuiert“

Die Zelle „Evakuiert“ SHALL als Wert die Zahl der Evakuierten (N) und als Notiz „von M
geplant“ zeigen, gerechnet nach der Kennzahl-Anforderung des Fachmoduls Betreuung (LFH-639).
Hat kein aktiver Bezirk eine Standmeldung, MUST der Wert „—“ lauten, nie 0. Bezirke ohne
Meldung MUST in der Notiz ausgewiesen werden. Ein geschätzter Anteil MUST mit „≈“
gekennzeichnet sein. Die Zelle MUST zur Modulseite Betreuung führen. Modulseite und
Dashboard MUST dieselbe Formatierung verwenden. Die Zelle MUST keinen Warnton tragen.

#### Scenario: Zwei gemeldete Bezirke
- **WHEN** Bezirk A (Plan 640, Stand 600, gezählt) und Bezirk B (Plan 1 210, Stand 720, gezählt) aktiv sind
- **THEN** zeigt die Zelle den Wert „1 320“ und die Notiz „von 1 850 geplant“

#### Scenario: Ein Bezirk ohne Meldung
- **WHEN** Bezirk A (Plan 640, Stand 600) und Bezirk B (Plan 1 210, ohne Meldung) aktiv sind
- **THEN** zeigt die Zelle den Wert „600“ und die Notiz „von 1 850 geplant · 1 ohne Meldung“

#### Scenario: Noch keine Meldung
- **WHEN** alle aktiven Bezirke ohne Standmeldung sind
- **THEN** zeigt die Zelle den Wert „—“ und keine 0

#### Scenario: Geschätzt
- **WHEN** ein beteiligter Stand als geschätzt gemeldet ist
- **THEN** trägt der Wert das Zeichen „≈“

### Requirement: Datenzustände der Zelle „Evakuiert“

Die Zelle „Evakuiert“ SHALL die Zustände ihrer eigenen Datenquelle (Betreuungs-Übersicht)
zeigen, unabhängig von den übrigen Kennzahlen. Lädt die Quelle, MUST die Zelle „laden“
zeigen. Ist der Abruf gescheitert, MUST sie „Stand unbekannt“ zeigen, auch wenn ältere Daten
vorliegen. Meldet der Einsatz den Auslöser, die Quelle aber keinen aktiven Bezirk (Stände aus
verschiedenen Abrufen), MUST die Zelle „—“ mit dem Hinweis „keine geplante Evakuierung“
zeigen und keine erfundene Zahl. Darf die Person das Modul Betreuung nicht sehen, MUST die
Quelle nicht abgerufen werden. Die Zelle MUST dann ohne Zahl und ohne Ziel stehen und den
fehlenden Zugriff benennen. Der Platz MUST dabei nicht mit einer anderen Kennzahl belegt
werden.

#### Scenario: Abruf gescheitert
- **WHEN** der Abruf der Betreuungs-Übersicht fehlschlägt
- **THEN** zeigt die Zelle „Stand unbekannt“, und die übrigen Kennzahlen bleiben lesbar

#### Scenario: Auslöser und Quelle laufen auseinander
- **WHEN** der Einsatz `evakuiert` trägt und die Übersicht keinen aktiven Bezirk enthält
- **THEN** zeigt die Zelle „—“ mit „keine geplante Evakuierung“

#### Scenario: Modul für die Person gesperrt
- **WHEN** der Einsatz `evakuiert` trägt und das Modul Betreuung für die Person ausgeblendet oder gesperrt ist
- **THEN** steht auf Platz 3 „Evakuiert“ ohne Zahl und ohne Link, mit Hinweis auf den fehlenden Zugriff, und die Übersicht wird nicht abgerufen

### Requirement: Wechsel von „Evakuiert“ während der Betrachtung

Kommt der Auslöser `evakuiert` hinzu oder fällt weg, während jemand das Dashboard ansieht,
SHALL die Reihe ihren Zuschnitt halten und über das Sammelbanner den neuen anbieten. Eine
eigene Bezirksänderung (anlegen, ändern, stornieren) MUST den Einsatz neu abrufen lassen,
damit der Rückweg zum Dashboard den neuen Zuschnitt ohne Banner zeigt.

#### Scenario: Fremde Anordnung während der Betrachtung
- **WHEN** der Einsatz beim erneuten Abruf zusätzlich `evakuiert` trägt
- **THEN** bleibt „Schäden offen“ auf Platz 3 stehen, und ein Banner bietet „Evakuiert statt Schäden offen · übernehmen“ an

#### Scenario: Eigene Anordnung
- **WHEN** eine Person auf der Modulseite Betreuung einen Bezirk anlegt
- **THEN** wird der Einsatz neu abgerufen
