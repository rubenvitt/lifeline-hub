# Spec Delta

## Purpose

Legt fest, dass der Agent vor jedem PR selbst einen Review mit frischem Kontext startet, wogegen
dieser Review prüft, wie seine Befunde gegengeprüft werden und wo ihr Verbleib nachlesbar ist.

## ADDED Requirements

### Requirement: Der Agent startet den Review vor dem PR selbst
Bevor ein PR entsteht, MUST der Main-Loop einen Review der Änderung starten, ohne dass der Mensch
ihn anstößt. Das gilt auf jeder Route außer `trivial`. Der Review MUST abgeschlossen und seine
bestätigten Befunde MUST behandelt sein, bevor der PR geöffnet wird. Je PR läuft ein Review über
den ganzen Diff des Branches.

#### Scenario: Umsetzung auf der Route „klar“ ist fertig
- **WHEN** ein Task auf der Route `klar` umgesetzt und verifiziert ist
- **THEN** startet der Main-Loop den Review, ohne zu fragen, und öffnet den PR erst danach

#### Scenario: Route „trivial“
- **WHEN** ein Task auf der Route `trivial` nur einen Anzeigetext ändert
- **THEN** läuft kein Review, und der PR nennt das im Abschnitt „Review“

#### Scenario: Task mit Subtasks in einem PR
- **WHEN** `dev-zunder-orchestrieren` mehrere Subtasks in einem Branch umsetzt
- **THEN** läuft ein Review über den ganzen Diff des Branches und nicht einer je Subtask

#### Scenario: Reine Dokumentationsänderung
- **WHEN** ein Task auf der Route `klar` nur Dateien unter `docs/` und `openspec/` ändert
- **THEN** läuft der Review trotzdem

### Requirement: Der Reviewer arbeitet mit frischem Kontext
Der Reviewer MUST ein eigener Agent sein, der das Gespräch der Umsetzung nicht kennt. Er MUST den
Diff gegen `origin/alpha`, die für die geänderten Dateien geltenden `AGENTS.md`-Dateien, die
Prüfliste und, wenn es eine gibt, die Spec der Change bekommen. Er MUST NOT Dateien ändern,
pushen, einen PR öffnen oder Zunder aufrufen; er liefert nur Befunde zurück.

#### Scenario: Reviewer bekommt die Begründung der Umsetzung nicht
- **WHEN** der Main-Loop den Reviewer startet
- **THEN** enthält dessen Auftrag den Diff, die Regeln und die Prüfliste, aber keine
  Zusammenfassung, warum der Code so gebaut wurde

#### Scenario: Änderung mit OpenSpec-Change
- **WHEN** der Branch eine Change mit Delta-Spec trägt
- **THEN** bekommt der Reviewer die Delta-Spec und prüft das Verhalten dagegen

#### Scenario: Reviewer findet einen Fehler
- **WHEN** der Reviewer einen Fehler im Diff findet
- **THEN** meldet er ihn mit Datei, Stelle und Begründung zurück und ändert selbst nichts

### Requirement: Der Review prüft gegen eine Prüfliste
Es MUST genau eine Prüfliste geben, die die Befundklassen mit je einer Prüffrage und Beispielen
aus dem Repo nennt. Jeder Review MUST gegen jede Klasse prüfen, die der Diff berühren kann, und
MUST darüber hinaus Fehler melden, die in keine Klasse fallen. Der Orchestrator MUST dieselbe
Prüfliste verwenden und MUST NOT eigene Review-Dimensionen daneben führen.

#### Scenario: Backend-Änderung an einer Schnittstelle zur Gegenstelle
- **WHEN** der Diff eine Liste entgegennimmt, die eine gekoppelte Instanz schickt
- **THEN** prüft der Review die Klassen „Grenzen für Eingaben von außen“, „Berechtigung und
  Geltungsbereich“ und „Stiller Verlust“ ausdrücklich

#### Scenario: Reiner Frontend-Diff
- **WHEN** der Diff nur Dateien unter `frontend/` ändert
- **THEN** entfallen die Klassen, die nur das Backend betreffen, und die Klassen zu Lade-, Fehler-
  und Offline-Zustand und zu veraltetem Zustand werden geprüft

#### Scenario: Fehler außerhalb der Prüfliste
- **WHEN** der Reviewer einen Fehler findet, der in keine Klasse der Prüfliste passt
- **THEN** meldet er ihn trotzdem

#### Scenario: Review im Orchestrator
- **WHEN** Phase 4 von `dev-zunder-orchestrieren` den Review als Workflow startet
- **THEN** stammen die Prüffragen der Agents aus der Prüfliste

### Requirement: Befunde werden gegengeprüft und vor dem PR behandelt
Jeder Befund MUST von einem zweiten Agenten gegengeprüft werden, der ihn zu widerlegen versucht
und ihn im Zweifel verwirft. Ein bestätigter Befund MUST vor dem PR behoben werden; ändert die
Behebung Verhalten, MUST ein Test sie belegen, der ohne sie rot wird. Verlangt ein bestätigter
Befund eine Entscheidung des Menschen, MUST der Main-Loop sie ihm vorlegen, statt selbst zu
wählen.

#### Scenario: Bestätigter Fehler im Code
- **WHEN** die Gegenprüfung einen Befund bestätigt
- **THEN** behebt der Main-Loop ihn vor dem PR, mit einem Test, der ohne die Behebung rot wird

#### Scenario: Widerlegter Befund
- **WHEN** die Gegenprüfung zeigt, dass der gemeldete Fall nicht eintreten kann
- **THEN** ändert der Main-Loop nichts am Code und nennt den Befund im PR als verworfen mit Grund

#### Scenario: Befund verlangt eine Entscheidung
- **WHEN** ein bestätigter Befund mehr als einen vertretbaren Ausweg hat, der das Verhalten für
  Anwender ändert
- **THEN** legt der Main-Loop die Wege dem Menschen vor und wartet auf seine Antwort

#### Scenario: Behebung nach dem Review
- **WHEN** der Main-Loop einen bestätigten Befund behoben hat
- **THEN** laufen die Gates für die geänderten Bereiche erneut, bevor der PR entsteht

### Requirement: Der PR weist den Review nach
Die PR-Beschreibung MUST einen Abschnitt „Review“ tragen. Er MUST nennen, ob ein Review lief, und
jeden bestätigten Befund mit seinem Verbleib sowie jeden verworfenen Befund mit dem Grund. Lief
kein Review, MUST der Abschnitt den Grund nennen.

#### Scenario: Review mit Befunden
- **WHEN** der Review zwei Befunde bestätigt und einen verworfen hat
- **THEN** nennt der Abschnitt „Review“ die zwei mit dem Commit ihrer Behebung und den dritten
  mit dem Grund, warum er verworfen wurde

#### Scenario: Review ohne Befund
- **WHEN** der Review nichts gefunden hat
- **THEN** sagt der Abschnitt „Review“ das in einem Satz

#### Scenario: PR ohne Review
- **WHEN** der PR von der Route `trivial` kommt
- **THEN** nennt der Abschnitt „Review“ die Route als Grund

### Requirement: Der Review braucht kein zusätzliches Plugin
Der Review MUST mit den Werkzeugen laufen, die jede Sitzung von Claude Code mitbringt, lokal wie in
der Cloud. Er MUST NOT von einem Skill oder Plugin abhängen, das nicht im Repo liegt, und MUST NOT
von einem bezahlten Dienst außerhalb der Sitzung abhängen.

#### Scenario: Cloud-Sitzung ohne Plugins
- **WHEN** ein Task in einer Cloud-Sitzung umgesetzt wird, die nur die Skills aus `.claude/` lädt
- **THEN** läuft der Review vollständig

#### Scenario: Anleitung nennt den Review
- **WHEN** jemand `AGENTS.md` und die Skills unter `.claude/` nach dem Review-Schritt durchsucht
- **THEN** verweist keine Stelle für den Review auf `superpowers:requesting-code-review`

### Requirement: Die Prüfliste wächst mit den Fehlern, die durchrutschen
Zeigt ein Fehler nach dem Review (im PR, in der CI oder später), dass eine Fehlerart in der
Prüfliste fehlt oder ihre Prüffrage ihn nicht trifft, MUST die Behebung die Prüfliste im selben
Branch ergänzen. Ein Eintrag MUST eine Fehlerart beschreiben und nicht den einzelnen Fall.

#### Scenario: Mensch findet im PR einen Fehler einer neuen Art
- **WHEN** ein Mensch im PR einen Fehler meldet, den keine Klasse der Prüfliste abdeckt
- **THEN** bekommt die Prüfliste im selben Branch eine neue Klasse mit Prüffrage und diesem Fall
  als Beispiel

#### Scenario: Fehler einer bekannten Klasse rutscht durch
- **WHEN** ein Fehler durchrutscht, dessen Klasse in der Prüfliste steht
- **THEN** wird die Prüffrage geschärft oder das Beispiel ergänzt, statt eine zweite Klasse
  anzulegen
