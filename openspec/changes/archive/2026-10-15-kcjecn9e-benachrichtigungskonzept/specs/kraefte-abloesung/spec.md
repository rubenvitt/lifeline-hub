# Spec Delta

## MODIFIED Requirements

### Requirement: Hinweis in der AlarmZentrale

Die Oberfläche SHALL zur Vorwarnung und zur Fälligkeit einer Schicht genau einen Toast zeigen,
mit Einheit, Uhrzeit und einem Sprung zur Seite Ablösung. Er kommt als Benachrichtigung
(`abloesung_vorwarnung` als Hinweis, `abloesung_faellig` als Alarm, Spec `benachrichtigungen`)
an alle mit dem Modul Ablösung; das Live-Ereignis `abloesung` frischt nur die Liste auf. Der
Toast MUST dem gemeinsamen Budget der Benachrichtigungen unterliegen (höchstens drei sichtbar, der
Rest gebündelt) und quittierbar sein. Dieselbe Fälligkeit darf nicht zusätzlich als allgemeine
Erinnerung alarmieren.

#### Scenario: Fälligkeit erreicht
- **WHEN** die Schicht von „Florian 1“ um 15:30 fällig wird
- **THEN** erscheint der Alarm „Ablösung fällig“ mit „Florian 1, 15:30“ und Sprung zur Seite Ablösung

#### Scenario: Kein Doppelalarm
- **WHEN** zur selben Fälligkeit auch eine Erinnerung mit Bezug Ablösung fällig wird
- **THEN** entsteht dafür keine zweite Benachrichtigung
