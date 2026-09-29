# lagekarte-zeichnen Specification

## Purpose
Macht das Zeichnen von Flächen und Linien auf der Lagekarte korrigierbar: einzelne Punkte lassen sich
zurücknehmen, der Stand ist sichtbar, und Esc verwirft nie still, sondern schrittweise und quittiert.

## Requirements

### Requirement: Letzten Punkt zurücknehmen
Während eine Figur gezeichnet wird, SHALL die Zeichnen-Steuerung einen Knopf „Letzten Punkt zurück"
anbieten. Ein Klick MUST genau den zuletzt gesetzten Punkt der laufenden Figur entfernen und die übrigen
Punkte unverändert lassen. Der Knopf MUST gesperrt sein, solange die laufende Figur keinen Punkt hat,
und seine Freigabe MUST jeder Änderung des Zeichenstands ohne weiteres Zutun folgen (Punkt gesetzt,
Punkt zurückgenommen, Figur verworfen, Zeichnen gestartet oder beendet). Das Zurücknehmen des letzten
verbliebenen Punktes SHALL keine Verwerfen-Quittung auslösen.

#### Scenario: Ein Punkt wird zurückgenommen
- **WHEN** drei Punkte einer Fläche gesetzt sind und „Letzten Punkt zurück" geklickt wird
- **THEN** hat die Figur zwei Punkte, der dritte ist von der Karte verschwunden, und „Abschließen" ist wieder gesperrt

#### Scenario: Ohne Punkt gesperrt, mit Punkt frei
- **WHEN** das Zeichnen gestartet ist und noch kein Punkt gesetzt wurde
- **THEN** ist „Letzten Punkt zurück" gesperrt
- **WHEN** danach ein Punkt gesetzt wird
- **THEN** ist der Knopf frei

#### Scenario: Nach dem Zurücknehmen des letzten Punktes wieder gesperrt
- **WHEN** genau ein Punkt gesetzt ist und „Letzten Punkt zurück" geklickt wird
- **THEN** hat die Figur keinen Punkt, der Knopf ist gesperrt, der Zeichenmodus bleibt aktiv, und es erscheint keine Quittung „Zeichnung verworfen"

### Requirement: Punktzähler in der Zeichnen-Steuerung
Die Zeichnen-Steuerung SHALL während der Zeichenphase die Zahl der gesetzten Punkte der laufenden Figur
als Text anzeigen. Die Zahl MUST beim Setzen, Zurücknehmen und Verwerfen mitgehen.

#### Scenario: Zähler folgt Setzen und Zurücknehmen
- **WHEN** drei Punkte gesetzt und einer zurückgenommen wird
- **THEN** zeigt die Steuerung „2 Punkte"

### Requirement: Esc wirkt beim Zeichnen zweistufig
Esc SHALL beim Zeichnen schrittweise Richtung reiner Ansicht führen, und jede Stufe MUST sichtbar sein:

1. Ist eine Figur angefangen (mindestens ein Punkt) oder in der Bestätigungsphase fertig, aber noch
   nicht gespeichert, MUST Esc diese Figur verwerfen, den Zeichenmodus aktiv lassen (aus der
   Bestätigungsphase zurück in die Zeichenphase desselben Typs und derselben Form) und die Quittung
   „Zeichnung verworfen" zeigen.
2. Ist keine Figur angefangen, MUST Esc den Zeichenmodus beenden. Sind in einer laufenden Serie schon
   Objekte gespeichert, MUST das wie „Fertig" wirken: die gespeicherten Objekte bleiben.

Esc MUST keine Wirkung haben, solange ein Speichern läuft, solange der Fokus in einem Eingabefeld
liegt oder wenn ein anderes Element die Taste bereits verarbeitet hat (z. B. ein offenes Menü oder ein
Dialog). Die Wirkung MUST unabhängig davon eintreten, ob die Karte oder ein Knopf der Steuerung den Fokus
hat. Die Zeichnen-Steuerung SHALL beide Stufen als Hinweis nennen.

#### Scenario: Erstes Esc verwirft die angefangene Figur
- **WHEN** drei Punkte einer Fläche gesetzt sind und Esc gedrückt wird
- **THEN** ist die Figur von der Karte verschwunden, die Steuerung zeigt „0 Punkte", der Zeichenmodus ist weiter aktiv, und die Quittung „Zeichnung verworfen" erscheint

#### Scenario: Zweites Esc beendet das Zeichnen
- **WHEN** danach ohne neuen Punkt noch einmal Esc gedrückt wird
- **THEN** ist die Zeichnen-Steuerung geschlossen und die Karte ist in der reinen Ansicht

#### Scenario: Esc in der Bestätigungsphase
- **WHEN** eine Fläche abgeschlossen, aber noch nicht gespeichert ist und Esc gedrückt wird
- **THEN** ist die Figur verworfen, nichts wurde gespeichert, die Steuerung steht wieder in der Zeichenphase desselben Zonentyps, und die Quittung „Zeichnung verworfen" erscheint

#### Scenario: Esc bei laufendem Speichern
- **WHEN** das Speichern einer Figur läuft und Esc gedrückt wird
- **THEN** ändert sich nichts

#### Scenario: Esc im Eingabefeld
- **WHEN** der Fokus in einem Textfeld liegt und Esc gedrückt wird
- **THEN** bleibt die Figur unverändert

#### Scenario: Esc beendet eine Serie mit Gespeichertem
- **WHEN** in einer Zonen-Serie schon eine Zone gespeichert ist, keine Figur angefangen ist und Esc gedrückt wird
- **THEN** endet der Zeichenmodus und die gespeicherte Zone bleibt erhalten

### Requirement: Messen bleibt einstufig
Das Messwerkzeug der Lagekarte SHALL weiterhin mit einem einzigen Esc enden; die Zweistufigkeit gilt
nur für das Zeichnen speicherbarer Figuren.

#### Scenario: Esc beim Messen
- **WHEN** eine Strecke gemessen wird und Esc gedrückt wird
- **THEN** endet das Messwerkzeug
