# Spec Delta

## MODIFIED Requirements

### Requirement: Hinweis in der AlarmZentrale

Die Oberfläche SHALL zur Vorwarnung und zur Fälligkeit einer Schicht genau einen Eintrag zeigen,
mit Einheit, Uhrzeit und einem Sprung zu dieser Schicht auf der Seite Ablösung (`?schicht=<id>`,
Requirement „Sprung zur Schicht“). Er kommt als Benachrichtigung
(`abloesung_vorwarnung` als Hinweis, `abloesung_faellig` als Alarm, Spec `benachrichtigungen`)
an alle mit dem Modul Ablösung; das Live-Ereignis `abloesung` frischt nur die Liste auf. Der
Eintrag MUST in der Alarmzone der Benachrichtigungen stehen (ab zwei gebündelt, Spec
`benachrichtigungen`, „Gemeinsames Budget und Bündelung“) und mit „Öffnen“ oder „Gelesen“
quittierbar sein. Dieselbe Fälligkeit darf nicht zusätzlich als allgemeine
Erinnerung alarmieren. Der Planungshinweis und die Hinweise zur ablösenden Einheit (LLH-1131)
SHALL auf demselben Weg ankommen: als Hinweis mit dezentem Ton, Eintrag im Eingangsband und Sprung zu ihrer
Schicht, ohne dass etwas blinkt. Der Sprungpfad jeder Benachrichtigung mit einem Bezug der
Ablösung MUST `/einsaetze/<id>/abloesung?schicht=<schicht>` sein, auch der Ersatz, wenn der Text
nicht zu holen war.

#### Scenario: Fälligkeit erreicht
- **WHEN** die Schicht von „Florian 1“ um 15:30 fällig wird
- **THEN** erscheint der Alarm „Ablösung fällig“ mit „Florian 1, 1530“ (Darstellung taktisch, Spec `zeitdarstellung`) und Sprung zu ihrer Schicht auf der Seite Ablösung

#### Scenario: Kein Doppelalarm
- **WHEN** zur selben Fälligkeit auch eine Erinnerung mit Bezug Ablösung fällig wird
- **THEN** entsteht dafür keine zweite Benachrichtigung

### Requirement: Sprung zur Schicht

Die Seite Ablösung SHALL den Deeplink `?schicht=<id>` annehmen (LLH-1131 Teil II, Muster
Query-Param aus `frontend/AGENTS.md`): Steht die Schicht unter den laufenden, wählt sie „Laufend“,
gibt zurückgehaltene Schichten frei (wie ein Ansichtswechsel), rollt die Karte ins Bild und hebt
sie kurz hervor; sonst sucht sie die Schicht unter den abgelösten und beendeten und wählt
„Vergangen“ mit dem passenden Status. Die Hervorhebung MUST der Form aus der Spec
`deeplink-hervorhebung` folgen, nach acht Sekunden ohne Übergang enden und MUST NOT blinken. Der
Parameter MUST danach geräumt sein; eine unbekannte Kennung MUST nichts ändern.

#### Scenario: Toast „Ablösung fällig“
- **WHEN** jemand im Alarm „Ablösung fällig“ der Alarmzone zur Schicht von „Florian 1“ springt
- **THEN** steht „Laufend“, die Karte von „Florian 1“ ist im Bild und hervorgehoben, und die Adresse trägt keinen Parameter mehr

#### Scenario: Zurückgehaltene Schicht
- **WHEN** die Schicht hinter dem Sammelbanner wartet und jemand zu ihr springt
- **THEN** reiht die Seite die zurückgehaltenen Schichten ein und hebt die angesprungene hervor

#### Scenario: Schon abgelöst
- **WHEN** jemand zu einer inzwischen abgelösten Schicht springt
- **THEN** wechselt die Seite nach „Vergangen“ → „Abgelöst“ und hebt deren Karte hervor
