## ADDED Requirements

### Requirement: Der Zustand von alpha wird nach jedem CI-Lauf bewertet
Nach jedem abgeschlossenen CI-Lauf auf `alpha`, mindestens stündlich und von Hand MUST der Wächter
feststellen, ob `alpha` rot ist. Rot ist `alpha`, wenn im jüngsten abgeschlossenen CI-Lauf eine
Prüfung fehlschlägt; ein Fehler allein beim Release zählt nicht. Als vermutliche Ursache MUST er die
PRs nennen, die zwischen dem letzten grünen und dem ersten roten Lauf auf `alpha` gemergt wurden.

#### Scenario: Zwei Merges brechen zusammen
- **WHEN** nach einem grünen Lauf #1319 und #1315 gemergt werden und der nächste CI-Lauf auf `alpha` in der Rust-Suite fehlschlägt
- **THEN** gilt `alpha` als rot, und #1319 und #1315 sind als vermutliche Ursache genannt

#### Scenario: Nur der Release scheitert
- **WHEN** alle Prüfungen eines CI-Laufs auf `alpha` grün sind und nur der Release-Job fehlschlägt
- **THEN** gilt `alpha` nicht als rot

#### Scenario: Lauf noch nicht fertig
- **WHEN** der jüngste CI-Lauf auf `alpha` noch läuft und der davor grün war
- **THEN** gilt `alpha` nicht als rot

### Requirement: Bei rotem alpha ist genau ein PR zuständig
Ist `alpha` rot, MUST genau ein offener PR als zuständig gelten. Trägt ein offener PR das Label
`alpha-rot`, ist er der Fix und zuständig, bei mehreren der älteste. Sonst ist es der älteste
offene PR gegen `alpha`, der kein Entwurf, kein Fork und nicht von Dependabot ist. Ohne Fix-PR MUST
die Zuständigkeit je volle Stunde seit dem ersten roten Lauf zum nächsten dieser PRs wechseln.

#### Scenario: Noch kein Fix-PR
- **WHEN** `alpha` rot wird und die offenen PRs #1314, #1318 und #1322 keinen mit Label `alpha-rot` enthalten
- **THEN** ist #1314 zuständig

#### Scenario: Fix-PR geöffnet
- **WHEN** eine Sitzung einen PR mit Label `alpha-rot` öffnet
- **THEN** ist dieser PR zuständig, und keiner der anderen bekommt mehr den Auftrag

#### Scenario: Zuständiger reagiert nicht
- **WHEN** `alpha` seit mehr als einer Stunde rot ist und kein PR das Label `alpha-rot` trägt
- **THEN** ist der nächstälteste PR zuständig, und er bekommt den Auftrag als neuen Kommentar

#### Scenario: Zwei Fix-PRs
- **WHEN** zwei offene PRs das Label `alpha-rot` tragen
- **THEN** ist der ältere zuständig, und der jüngere trägt einen Hinweis, dass er doppelt ist

### Requirement: Bei rotem alpha trägt jeder offene PR einen Hinweis dazu
Ist `alpha` rot, MUST jeder offene PR gegen `alpha`, der kein Entwurf ist, einen Hinweis tragen,
der die vermutliche Ursache und die fehlgeschlagenen Prüfungen nennt. Dem Zuständigen ohne Label
MUST er auftragen, den Fix in einem eigenen PR von `alpha` mit Label `alpha-rot` zu bauen; allen
übrigen MUST er sagen, wer sich kümmert und dass sie nicht selbst reparieren. Dieser Hinweis MUST
neben einem Hinweis zum PR stehen und ihn nicht verdrängen; sonst gelten die Regeln des
Konflikt-Hinweises.

#### Scenario: PR ist nicht zuständig
- **WHEN** `alpha` rot ist und #1318 nicht zuständig ist
- **THEN** trägt #1318 einen Hinweis, der den zuständigen PR nennt und sagt, dass #1318 nichts reparieren soll

#### Scenario: PR trägt schon einen Konflikt-Hinweis
- **WHEN** `alpha` rot wird und PR B schon einen Konflikt-Hinweis trägt
- **THEN** trägt PR B beide Hinweise, und der Konflikt-Hinweis bleibt unverändert

#### Scenario: Zuständigkeit wechselt
- **WHEN** ein Fix-PR mit Label `alpha-rot` geöffnet wird, während #1314 den Auftrag trägt
- **THEN** ersetzt ein neuer Kommentar den Auftrag an #1314 durch den Hinweis, dass der Fix-PR sich kümmert

#### Scenario: Befund unverändert
- **WHEN** der Wächter erneut läuft und Ursache, Zuständiger und fehlgeschlagene Prüfungen gleich sind
- **THEN** entsteht kein weiterer Kommentar

### Requirement: Nach dem Fix bekommen rote PRs alpha hineingemergt
Ist `alpha` wieder grün, MUST jeder Hinweis zu „alpha rot“ das als behoben zeigen. In jeden PR mit
einem solchen Hinweis, dessen jüngster CI-Lauf auf dem Kopf-Commit rot ist, MUST der Wächter `alpha`
als Merge-Commit pushen, sofern der PR konfliktfrei ist und den grünen Stand von `alpha` nicht schon
enthält. Für den Push gelten die Regeln „Der Wächter schreibt nur per Fast-Forward auf PR-Branches“.

#### Scenario: Roter PR nach dem Fix
- **WHEN** der Fix-PR gemergt ist, der CI-Lauf auf `alpha` grün ist und #1322 mit Hinweis eine rote Rust-Suite trägt
- **THEN** trägt #1322 einen Merge-Commit von `alpha`, auf ihm läuft die CI, und der Hinweis zeigt „behoben“

#### Scenario: Grüner PR nach dem Fix
- **WHEN** `alpha` wieder grün ist und ein PR mit Hinweis auf seinem Kopf grüne Checks trägt
- **THEN** wird nichts gepusht, und der Hinweis zeigt „behoben“

#### Scenario: PR mit Konflikt nach dem Fix
- **WHEN** `alpha` wieder grün ist und ein PR mit Hinweis mit `alpha` kollidiert
- **THEN** wird nichts gepusht, und der PR trägt den Konflikt-Hinweis

## MODIFIED Requirements

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
