## ADDED Requirements

### Requirement: Der Zustand von alpha wird nach jedem CI-Lauf bewertet
Nach jedem abgeschlossenen CI-Lauf auf `alpha`, stündlich und von Hand MUST der Wächter
feststellen, ob `alpha` rot ist: im jüngsten abgeschlossenen CI-Lauf schlägt eine Prüfung fehl,
ein Fehler allein beim Release zählt nicht. Läuft ein neu gestarteter Lauf oder sind seine Jobs
nicht lesbar, MUST der Zustand als unbestimmt gelten. Als Ursache MUST er die zwischen letztem
Grün und erstem Rot gemergten PRs nennen.

#### Scenario: Zwei Merges brechen zusammen
- **WHEN** nach einem grünen Lauf #1319 und #1315 gemergt werden und der nächste CI-Lauf auf `alpha` in der Rust-Suite fehlschlägt
- **THEN** gilt `alpha` als rot, und #1319 und #1315 sind als vermutliche Ursache genannt

#### Scenario: Nur der Release scheitert
- **WHEN** alle Prüfungen eines CI-Laufs auf `alpha` grün sind und nur der Release-Job fehlschlägt
- **THEN** gilt `alpha` nicht als rot

#### Scenario: Lauf noch nicht fertig
- **WHEN** der jüngste CI-Lauf auf `alpha` noch läuft und der davor grün war
- **THEN** gilt `alpha` nicht als rot

#### Scenario: Roter Lauf wird neu gestartet
- **WHEN** der rote Lauf neu gestartet wird und noch läuft
- **THEN** gilt `alpha` weder als rot noch als grün: kein Hinweis wird geschlossen, nichts wird gemergt

#### Scenario: Jobs nicht lesbar
- **WHEN** der jüngste Lauf fehlgeschlagen ist und seine Jobs nicht lesbar sind
- **THEN** gilt `alpha` als unbestimmt, nicht als grün

### Requirement: Bei rotem alpha ist genau ein PR zuständig
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
- **WHEN** zwei offene PRs das Label `alpha-rot` tragen
- **THEN** ist der ältere zuständig, und der jüngere trägt einen Hinweis, dass er doppelt ist

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
