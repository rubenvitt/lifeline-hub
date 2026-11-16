# Spec Delta

## MODIFIED Requirements

### Requirement: Einträge nach Dringlichkeit mit Deeplink
Jeder Abschnitt SHALL höchstens drei Einträge zeigen, das Überfällige zuerst, dann nach der
nächsten Frist, dann das Älteste; die Kennung ordnet als letzte Stufe. Im Abschnitt „Meldungen“
SHALL nach „Bestätigung überfällig“ die Priorität ordnen: Sofort vor Dringend vor den übrigen,
innerhalb von Sofort und Dringend die neueste zuerst. Ein Eintrag MUST per
Deeplink auf sein Objekt führen, das das Ziel hervorhebt (`?meldung=`, `?auftrag=`,
`?nachforderung=`, `?schicht=`, `?erinnerung=`). Ein Eintrag mit Alarm
(Bestätigung überfällig, Auftrag überfällig, Ablösung überfällig) MUST die Alarmkante links und
das Wort tragen; eine überfällige Nachforderung trägt nur das Wort im Ton „achtung“.
Erinnerungen zeigen die fälligen und die in den nächsten 30 Minuten fälligen offenen; Ablösungen
die laufenden, die überfällig oder in ihrer Vorwarnzeit sind.

#### Scenario: Überfälliger Auftrag
- **WHEN** von zwei offenen Aufträgen der jüngere seine Frist verpasst hat
- **THEN** steht er zuerst, mit Alarmkante und „überfällig“, und führt auf
  `/einsaetze/{id}/auftraege?auftrag={auftrag}`

#### Scenario: Frische Sofortmeldung
- **WHEN** drei ältere neue Normalmeldungen offen sind und eine Sofortmeldung eingeht
- **THEN** steht die Sofortmeldung nach der Live-Aktualisierung an erster Stelle, mit dem Wort „SOFORT“ in der Alarmrolle und ohne Alarmkante

#### Scenario: Zwei Sofortmeldungen
- **WHEN** zwei Sofortmeldungen offen sind, deren Bestätigung nicht überfällig ist
- **THEN** steht die zuletzt eingegangene zuerst

#### Scenario: Überfällige Bestätigung vor Sofort
- **WHEN** eine Normalmeldung mit überfälliger Bestätigung und eine frische Sofortmeldung offen sind
- **THEN** steht die überfällige zuerst, mit Alarmkante und „Bestätigung überfällig“, die Sofortmeldung danach mit „SOFORT“

#### Scenario: Dringende Meldung
- **WHEN** eine dringende Meldung und eine ältere Normalmeldung offen sind
- **THEN** steht die dringende zuerst und trägt das Wort „DRINGEND“ in der Achtungsrolle

## ADDED Requirements

### Requirement: Eine fällige Erinnerung heißt im Überblick überall gleich
Eine offene Erinnerung, deren Fälligkeit erreicht ist, SHALL im Überblick im Abschnitt
„Erinnerungen“ und in den „Nächsten Marken“ dasselbe Wort „fällig“ in derselben Rolle „achtung“
tragen. Das Wort „überfällig“ in der Rolle „alarm“ MUST einer Erinnerung nicht zugeordnet werden;
es bleibt Fristen von Aufträgen, Nachforderungen und Ablösungen.

#### Scenario: Erinnerung erreicht ihre Fälligkeit
- **WHEN** die Fälligkeit einer offenen Erinnerung verstreicht, während der Überblick offen ist
- **THEN** zeigen Abschnitt „Erinnerungen“ und „Nächste Marken“ sie beide als „fällig“ in Gelb, keine Stelle zeigt „überfällig“

#### Scenario: Auftrag mit verpasster Frist
- **WHEN** die Frist eines offenen Auftrags verstrichen ist
- **THEN** zeigen die „Nächsten Marken“ ihn weiter als „überfällig“ in Rot
