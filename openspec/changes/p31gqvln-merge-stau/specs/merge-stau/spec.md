# Spec Delta

## Purpose

Sorgt dafür, dass ein offener Pull Request gegen einen Ziel-Branch nicht unbemerkt liegen
bleibt: Ein Konflikt oder ein fehlender CI-Lauf wird am PR sichtbar, und wo keine Konfliktlösung
nötig ist, läuft die CI ohne Zutun an.

## ADDED Requirements

### Requirement: Offene PRs werden bewertet, wenn sich der Ziel-Branch bewegt
Jeder offene Pull Request gegen `alpha`, `beta` oder `main`, der kein Entwurf ist, MUST neu
bewertet werden, wenn auf seinen Ziel-Branch gepusht wird. Die Bewertung MUST zusätzlich
mindestens stündlich laufen und von Hand auslösbar sein. Sie MUST keinen Code aus dem PR
ausführen.

#### Scenario: Fremder Merge
- **WHEN** PR A auf `alpha` gemergt wird und PR B offen ist
- **THEN** wird PR B gegen den neuen Stand von `alpha` bewertet

#### Scenario: Entwurf
- **WHEN** ein offener PR als Entwurf markiert ist
- **THEN** bekommt er weder Hinweis noch Commit

### Requirement: Ein Konflikt steht als Hinweis am PR
Lässt sich ein PR nicht konfliktfrei mit seinem Ziel-Branch zusammenführen, MUST am PR ein
Hinweis stehen, der die betroffenen Dateien nennt und sagt, dass der Ziel-Branch in den
PR-Branch zu mergen ist. Je PR MUST es höchstens einen Hinweis geben. Ändert sich der Befund
nicht (gleicher Kopf-Commit, gleiche Dateien), MUST der Hinweis unverändert bleiben. Entsteht ein
Konflikt neu oder ändert sich der Befund, MUST der Hinweis als neuer Kommentar erscheinen, damit
Abonnenten des PRs benachrichtigt werden. Ist der Konflikt behoben, MUST der Hinweis das zeigen.
Sind die Kommentare des PRs nicht lesbar, MUST kein weiterer Hinweis entstehen. Kommentare
anderer Konten MUST unberührt bleiben.

#### Scenario: Konflikt nach fremdem Merge
- **WHEN** PR A gemergt wird und PR B danach in `docs/architektur/06-laufzeitsicht.md` kollidiert
- **THEN** trägt PR B einen Hinweis, der diese Datei nennt

#### Scenario: Ziel-Branch bewegt sich weiter, Befund gleich
- **WHEN** PR B schon einen Hinweis trägt und ein weiterer Merge auf `alpha` dieselben Dateien kollidieren lässt
- **THEN** entsteht kein weiterer Kommentar

#### Scenario: Konflikt behoben
- **WHEN** der Ziel-Branch in den PR-Branch gemergt wurde und der PR wieder konfliktfrei ist
- **THEN** zeigt der Hinweis den Konflikt als behoben

#### Scenario: Konflikt kommt wieder
- **WHEN** ein PR mit behobenem Hinweis durch einen späteren Merge erneut kollidiert
- **THEN** erscheint ein neuer Kommentar, und der alte ist entfernt

### Requirement: Ein PR ohne CI-Lauf bekommt den Ziel-Branch hineingemergt
Trägt der Kopf-Commit eines konfliktfreien PRs aus diesem Repository nach einer Wartezeit keinen
CI-Lauf, MUST der Ziel-Branch als Merge-Commit auf den PR-Branch gepusht werden, sodass die CI
auf dem neuen Kopf-Commit läuft. Ist der Ziel-Branch schon vollständig im PR-Branch enthalten,
MUST stattdessen ein Hinweis am PR stehen.

#### Scenario: CI nie angelaufen
- **WHEN** der Kopf-Commit eines konfliktfreien PRs seit mehr als 20 Minuten besteht, keinen CI-Lauf trägt und `alpha` neuere Commits hat
- **THEN** trägt der PR-Branch danach einen Merge-Commit von `alpha`, auf ihm läuft die CI, und ein Hinweis am PR nennt den Commit

#### Scenario: CI läuft gerade an
- **WHEN** der Kopf-Commit eines PRs vor weniger als 20 Minuten gepusht wurde, auch wenn der Commit selbst älter ist
- **THEN** wird nichts gepusht

#### Scenario: Nichts zu mergen
- **WHEN** ein PR ohne CI-Lauf den Stand von `alpha` schon enthält
- **THEN** wird nichts gepusht, und der PR trägt einen Hinweis, dass die CI fehlt

### Requirement: Ein grüner PR mit Auto-Merge, der nicht mergt, steht als Hinweis am PR
Sind alle Checks und Commit-Status auf dem Kopf-Commit eines konfliktfreien PRs seit einer
Wartezeit grün und ist Auto-Merge eingeschaltet, der PR aber weiter offen, MUST am PR ein Hinweis
stehen. Ohne eingeschaltetes Auto-Merge wartet der PR auf einen Menschen und bekommt keinen.

#### Scenario: Grün seit einer Stunde
- **WHEN** alle Checks eines PRs seit mehr als 20 Minuten grün sind, Auto-Merge eingeschaltet ist und der PR offen ist
- **THEN** trägt der PR einen Hinweis, dass er von Hand zu mergen ist

#### Scenario: Ohne Auto-Merge
- **WHEN** alle Checks eines PRs grün sind und Auto-Merge nicht eingeschaltet ist
- **THEN** entsteht kein Hinweis

#### Scenario: Ein Status steht noch aus
- **WHEN** alle Check-Runs grün sind, ein Commit-Status aber noch aussteht oder rot ist
- **THEN** entsteht kein Hinweis

### Requirement: Der Wächter schreibt nur per Fast-Forward auf PR-Branches
Der Wächter MUST ausschließlich auf den Kopf-Branch eines PRs schreiben, dessen Kopf in diesem
Repository liegt. Er MUST nie auf `alpha`, `beta` oder `main` schreiben und MUST nur per
Fast-Forward auf genau den bewerteten Kopf-Commit pushen. Ist der Kopf-Commit schon ein
Merge-Commit des Wächters und trägt weiter keinen CI-Lauf, MUST er nicht erneut pushen, sondern
einen Hinweis schreiben. Ohne eingerichtete Release-App MUST er nur Hinweise schreiben.

#### Scenario: Branch hat sich während des Laufs bewegt
- **WHEN** zwischen Bewertung und Push ein neuer Commit auf den PR-Branch kommt
- **THEN** wird der Push abgewiesen, und der Branch bleibt unverändert

#### Scenario: Branch wurde gelöscht oder zurückgesetzt
- **WHEN** der PR-Branch zwischen Bewertung und Push gelöscht oder per Force auf einen früheren Commit gesetzt wurde
- **THEN** wird der Push abgewiesen: der Branch entsteht nicht neu, und entfernte Commits kommen nicht zurück

#### Scenario: PR aus einem Fork
- **WHEN** der Kopf eines PRs ohne CI-Lauf in einem Fork liegt
- **THEN** wird nichts gepusht, und der PR trägt einen Hinweis

#### Scenario: Kopf-Branch heißt wie ein Ziel-Branch
- **WHEN** der Kopf-Branch eines PRs `alpha`, `beta` oder `main` heißt
- **THEN** pusht der Wächter nichts

#### Scenario: Merge des Wächters hat die CI nicht gestartet
- **WHEN** der Kopf-Commit ein Merge-Commit des Wächters ist und nach der Wartezeit keinen CI-Lauf trägt
- **THEN** pusht der Wächter nicht erneut und schreibt einen Hinweis
