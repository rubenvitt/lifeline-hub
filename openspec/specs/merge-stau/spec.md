# merge-stau Specification

## Purpose
Sorgt dafür, dass ein offener Pull Request gegen einen Ziel-Branch nicht unbemerkt liegen
bleibt: Ein Konflikt oder ein fehlender CI-Lauf wird am PR sichtbar, und wo keine Konfliktlösung
nötig ist, läuft die CI ohne Zutun an.

## Requirements

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
PR-Branch zu mergen ist. Je PR MUST es höchstens einen Hinweis zum PR selbst geben; der Hinweis
zum Zustand von `alpha` steht getrennt davon. Ändert sich der Befund
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

### Requirement: Der Zustand von alpha wird nach jedem CI-Lauf bewertet
Nach jedem abgeschlossenen CI-Lauf auf `alpha`, stündlich und von Hand MUST der Wächter
feststellen, ob `alpha` rot ist: im jüngsten abgeschlossenen CI-Lauf schlägt eine Prüfung fehl,
ein Fehler allein beim Release zählt nicht. Ein abgebrochener Lauf (ein neuer Push hat seine
Tests abgebrochen) MUST übersprungen werden; es zählt der Lauf davor. Läuft ein neu gestarteter
Lauf oder sind seine Jobs nicht lesbar, MUST der Zustand als unbestimmt gelten. Als Ursache MUST
er die zwischen letztem Grün und erstem Rot gemergten PRs nennen.

#### Scenario: Zwei Merges brechen zusammen
- **WHEN** nach einem grünen Lauf #1319 und #1315 gemergt werden und der nächste CI-Lauf auf `alpha` in der Rust-Suite fehlschlägt
- **THEN** gilt `alpha` als rot, und #1319 und #1315 sind als vermutliche Ursache genannt

#### Scenario: Nur der Release scheitert
- **WHEN** alle Prüfungen eines CI-Laufs auf `alpha` grün sind und nur der Release-Job fehlschlägt
- **THEN** gilt `alpha` nicht als rot

#### Scenario: Lauf noch nicht fertig
- **WHEN** der jüngste CI-Lauf auf `alpha` noch läuft und der davor grün war
- **THEN** gilt `alpha` nicht als rot

#### Scenario: Abgebrochener Lauf
- **WHEN** der jüngste abgeschlossene CI-Lauf auf `alpha` abgebrochen ist, weil ein neuer Push seine Tests abbrach, und der davor grün war
- **THEN** gilt `alpha` nicht als rot

#### Scenario: Roter Lauf wird neu gestartet
- **WHEN** der rote Lauf neu gestartet wird und noch läuft
- **THEN** gilt `alpha` weder als rot noch als grün: kein Hinweis wird geschlossen, nichts wird gemergt

#### Scenario: Jobs nicht lesbar
- **WHEN** der jüngste Lauf fehlgeschlagen ist und seine Jobs nicht lesbar sind
- **THEN** gilt `alpha` als unbestimmt, nicht als grün

### Requirement: Bei rotem alpha ist höchstens ein PR zuständig
Ist `alpha` rot, MUST höchstens ein offener PR zuständig sein. Ein PR mit Label `alpha-rot` ist der
Fix und zuständig, bei mehreren der älteste. Sonst ist es ein offener PR gegen `alpha` ohne Entwurf,
Fork oder Dependabot: zuerst der älteste, und ein erteilter Auftrag MUST eine volle Stunde an
seinem PR haften, bevor er an den nächsten geht. Fehlt das Label im Repository, MUST der Wächter es
anlegen.

#### Scenario: Noch kein Fix-PR
- **WHEN** `alpha` rot wird und die offenen PRs #1314, #1318 und #1322 keinen mit Label `alpha-rot` enthalten
- **THEN** ist #1314 zuständig

#### Scenario: Fix-PR geöffnet
- **WHEN** eine Sitzung einen PR mit Label `alpha-rot` öffnet
- **THEN** ist dieser PR zuständig, und keiner der anderen bekommt mehr den Auftrag

#### Scenario: Zuständiger reagiert nicht
- **WHEN** der Auftrag seit mehr als einer Stunde an #1314 hängt und kein PR das Label `alpha-rot` trägt
- **THEN** ist der nächste PR nach #1314 zuständig, und er bekommt den Auftrag als neuen Kommentar

#### Scenario: Neuer PR mitten in der Stunde
- **WHEN** #1314 den Auftrag seit zehn Minuten hat und ein PR mit kleinerer Nummer aus dem Entwurf kommt
- **THEN** behält #1314 den Auftrag

#### Scenario: Label fehlt
- **WHEN** `alpha` rot wird und das Label `alpha-rot` im Repository fehlt
- **THEN** legt der Wächter es an

#### Scenario: Zwei Fix-PRs
- **WHEN** zwei offene PRs das Label `alpha-rot` tragen, auch als Entwurf
- **THEN** ist der ältere zuständig, und der jüngere trägt einen Hinweis, dass er doppelt ist

#### Scenario: Halter kurz nicht lesbar
- **WHEN** die Kommentare des PRs, der den Auftrag trägt, einmal nicht lesbar sind
- **THEN** schreibt der Wächter in dieser Runde nichts zu „alpha rot“, und der Auftrag springt nicht

### Requirement: Bei rotem alpha trägt jeder offene PR einen Hinweis dazu
Ist `alpha` rot, MUST jeder offene PR gegen `alpha` ohne Entwurf einen Hinweis mit Ursache und
roten Prüfungen tragen. Dem Zuständigen ohne Label trägt er auf, den Fix in einem eigenen PR von
`alpha` mit Label `alpha-rot` zu bauen; den übrigen sagt er, nicht selbst zu reparieren, und nennt
den Fix-PR, sobald es ihn gibt. Er MUST neben dem Hinweis zum PR stehen, ohne ihn zu verdrängen;
sonst gelten die Regeln des Konflikt-Hinweises.

#### Scenario: PR ist nicht zuständig
- **WHEN** `alpha` rot ist, #1318 nicht zuständig ist und ein Fix-PR mit Label `alpha-rot` offen ist
- **THEN** trägt #1318 einen Hinweis, der den Fix-PR nennt und sagt, dass #1318 nichts reparieren soll

#### Scenario: PR trägt schon einen Konflikt-Hinweis
- **WHEN** `alpha` rot wird und PR B schon einen Konflikt-Hinweis trägt
- **THEN** trägt PR B beide Hinweise, und der Konflikt-Hinweis bleibt unverändert

#### Scenario: Zuständigkeit wechselt
- **WHEN** ein Fix-PR mit Label `alpha-rot` geöffnet wird, während #1314 den Auftrag trägt
- **THEN** ersetzt ein neuer Kommentar den Auftrag an #1314 durch den Hinweis, dass der Fix-PR sich kümmert

#### Scenario: Befund unverändert
- **WHEN** der Wächter erneut läuft und Ursache, Zuständiger und fehlgeschlagene Prüfungen gleich sind
- **THEN** entsteht kein weiterer Kommentar

### Requirement: Eine Rotation weckt keinen wartenden PR
Wechselt die Zuständigkeit ohne Fix-PR, MUST nur an den PRs ein neuer Kommentar entstehen, deren
Rolle sich ändert (der bisherige und der neue Zuständige). Ein PR, der vorher und nachher wartet,
MUST seinen Hinweis unverändert behalten.

#### Scenario: Zuständigkeit rotiert, PR wartet
- **WHEN** ohne Fix-PR der Auftrag nach einer Stunde von #1314 zu #1318 wechselt und #1322 wartet
- **THEN** bekommen #1314 und #1318 einen neuen Kommentar, #1322 keinen

### Requirement: Nach dem Fix bekommen rote PRs alpha hineingemergt
Ist `alpha` wieder grün, MUST jeder Hinweis zu „alpha rot“ das zeigen. In jeden PR mit Hinweis,
dessen jüngster CI-Lauf rot ist, MUST der Wächter `alpha` pushen, sofern er konfliktfrei ist, kein
Entwurf und den grünen Stand nicht enthält; der Hinweis zeigt dann „angestoßen“, sonst „behoben“.
Ist die Lage nicht bestimmbar (Checks nicht lesbar, CI läuft, Push gescheitert), MUST der Hinweis
offen bleiben. Für den Push gilt „Der Wächter schreibt nur per Fast-Forward auf PR-Branches“.

#### Scenario: Roter PR nach dem Fix
- **WHEN** der Fix-PR gemergt ist, der CI-Lauf auf `alpha` grün ist und #1322 mit Hinweis eine rote Rust-Suite trägt
- **THEN** trägt #1322 einen Merge-Commit von `alpha`, auf ihm läuft die CI, und ein neuer Kommentar zeigt „angestoßen“

#### Scenario: Grüner PR nach dem Fix
- **WHEN** `alpha` wieder grün ist und ein PR mit Hinweis auf seinem Kopf grüne Checks trägt
- **THEN** wird nichts gepusht, und der Hinweis zeigt „behoben“

#### Scenario: Checks nach dem Fix nicht lesbar
- **WHEN** `alpha` wieder grün ist und die Checks eines PRs mit Hinweis nicht lesbar sind
- **THEN** bleibt der Hinweis offen, und der nächste Lauf entscheidet neu

#### Scenario: PR mit Konflikt nach dem Fix
- **WHEN** `alpha` wieder grün ist und ein PR mit Hinweis mit `alpha` kollidiert
- **THEN** wird nichts gepusht, und der PR trägt den Konflikt-Hinweis

### Requirement: Ein grüner PR mit Auto-Merge, der nicht mergt, bekommt einen Hinweis
Sind alle Checks und Commit-Status auf dem Kopf-Commit eines konfliktfreien PRs seit einer
Wartezeit grün und ist Auto-Merge eingeschaltet, der PR aber weiter offen, MUST am PR ein Hinweis
stehen. Je Check-Name zählt dabei der jüngste Check-Run. Ohne eingeschaltetes Auto-Merge wartet
der PR auf einen Menschen und bekommt keinen.

#### Scenario: Grün seit einer Stunde
- **WHEN** alle Checks eines PRs seit mehr als 20 Minuten grün sind, Auto-Merge eingeschaltet ist und der PR offen ist
- **THEN** trägt der PR einen Hinweis, dass er von Hand zu mergen ist

#### Scenario: Ohne Auto-Merge
- **WHEN** alle Checks eines PRs grün sind und Auto-Merge nicht eingeschaltet ist
- **THEN** entsteht kein Hinweis

#### Scenario: Ein Status steht noch aus
- **WHEN** alle Check-Runs grün sind, ein Commit-Status aber noch aussteht oder rot ist
- **THEN** entsteht kein Hinweis

#### Scenario: Erster Lauf abgebrochen, zweiter grün
- **WHEN** auf demselben Kopf-Commit ein Lauf eines Checks abgebrochen wurde, ein späterer grün ist und seit mehr als 20 Minuten nichts mergt
- **THEN** trägt der PR den Hinweis, dass er von Hand zu mergen ist

#### Scenario: Baut mit Ziel-Branch rechnet noch
- **WHEN** alle übrigen Checks grün sind, Auto-Merge an ist und der jüngste `Baut mit Ziel-Branch` noch läuft
- **THEN** entsteht kein Hinweis
