## MODIFIED Requirements

### Requirement: Fläche auf der Stabseite
Die Stabseite SHALL die Checkliste als eigenes Paneel „Arbeitsaufnahme“ unter den bestehenden
Paneelen zeigen, mit dem Zähler der erledigten Punkte, sobald Daten vorliegen. Jede Zeile SHALL den
Haken samt Punkttext als eine Trefffläche anbieten, die auf jeder Dichtestufe mindestens die
Steuerhöhe erreicht. Ein erledigter Punkt SHALL die Uhrzeit des Hakens zeigen. Die Bemerkung SHALL
inline bearbeitbar sein und im leeren Zustand sagen, dass man sie schreiben kann. Scheitert das
Speichern, MUST der Fehler an der Zeile stehen, nicht als Toast, und der Haken MUST den
Serverstand zeigen. Scheitert das Laden, MUST ein Fehler mit Wiederholen statt offener Punkte
stehen. Die Besetzung MUST unverändert bleiben. Die Lagebesprechung trägt die Stabseite nicht mehr
selbst; sie steht dort nur als Termin-Zeile mit Sprung in das Modul Lagebesprechung.

#### Scenario: Tipp auf den Text
- **WHEN** eine Person mit Schreibrecht auf den Text einer Zeile tippt
- **THEN** wechselt der Haken der Zeile

#### Scenario: Speichern scheitert
- **WHEN** der Server einen Haken ablehnt
- **THEN** steht der Fehler an dieser Zeile, der Haken zeigt den vorigen Stand, und es erscheint
  kein Toast

#### Scenario: Laden scheitert
- **WHEN** die Checkliste nicht geladen werden kann
- **THEN** zeigt das Paneel einen Fehler mit Wiederholen und keine offenen Punkte

#### Scenario: Live auf zweitem Schirm
- **WHEN** Schirm A einen Punkt abhakt
- **THEN** zeigt Schirm B den Punkt ohne Neuladen als erledigt
