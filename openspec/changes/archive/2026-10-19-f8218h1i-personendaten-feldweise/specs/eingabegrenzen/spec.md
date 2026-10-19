## ADDED Requirements

### Requirement: Freitexte einer Person sind begrenzt

Name, Vorname, Herkunft / Adresse, Fundort, Melder / Kontakt, Notiz und Zustand / Verdacht einer
Person sowie der Text einer Verlaufsnotiz MUST beim Anlegen, beim Ändern und beim Anlegen einer
Verlaufsnotiz die Grenzen der Tabelle in `design.md` (D7) einhalten, sonst MUST der Server mit 400
und der Meldung „{Feld} darf höchstens {max} Zeichen lang sein“ antworten und nichts schreiben.
Ein Wert genau an der Grenze MUST angenommen werden. Ein PATCH, der ein Feld nicht nennt, MUST
dessen gespeicherten Wert nicht prüfen. Jede Maske dieser Felder MUST die Grenze mit Zähler
zeigen und nie kürzen.

#### Scenario: Name an und über der Grenze
- **WHEN** ein Name mit 200 Zeichen und danach einer mit 201 Zeichen gespeichert wird
- **THEN** wird der erste angenommen, und der zweite ergibt 400, der Name bleibt der erste

#### Scenario: Alter Überlänge in einem anderen Feld
- **WHEN** eine Person einen gespeicherten Melder über der Grenze hat und nur ihr Vorname geändert wird
- **THEN** wird der Vorname gespeichert
