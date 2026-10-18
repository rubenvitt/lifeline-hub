## MODIFIED Requirements

### Requirement: Vorgabe „aus“
Die Ebene „Betroffene“ MUST ausgeschaltet sein, solange niemand sie ausdrücklich
eingeschaltet hat. Das gilt für neue und für bestehende gespeicherte Kartenansichten, die
den Schalter noch nicht kennen. Das Einschalten MUST wie jeder andere Ebenen-Schalter die
Ansicht als geändert markieren und mit ihr gespeichert werden. Ein laufender oder gerade
erledigter Verortungsauftrag für eine Person MUST die Ebene zeichnen, ohne den Schalter
umzustellen (Spec `lagekarte-verortungsauftrag`).

#### Scenario: Bestehende Ansicht ohne Schalterwert
- **WHEN** eine Kartenansicht geöffnet wird, die vor dieser Änderung gespeichert wurde
- **THEN** ist die Ebene „Betroffene“ aus, und die übrigen Ebenen behalten ihren gespeicherten Zustand

#### Scenario: Einschalten wird mit der Ansicht gespeichert
- **WHEN** ein Benutzer die Ebene einschaltet und die Ansicht speichert
- **THEN** ist die Ebene beim nächsten Öffnen dieser Ansicht an

#### Scenario: Platzier-Modus zeigt die Ebene, ohne den Schalter zu ändern
- **WHEN** bei ausgeschalteter Ebene ein Verortungsauftrag für eine Person läuft und danach die Ansicht gespeichert wird
- **THEN** waren die Personenmarker während des Auftrags sichtbar, und die gespeicherte Ansicht hat die Ebene weiter aus
