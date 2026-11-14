# Spec Delta

## ADDED Requirements

### Requirement: Ein überholter Lauf macht keinen PR rot
Bewegt sich der Ziel-Branch oder der PR-Kopf, während `Baut mit Ziel-Branch` rechnet, MUST weder der Check noch ein Job des Laufs als abgebrochen oder fehlgeschlagen enden. Ausgenommen ist ein Lauf, der sich nicht starten ließ. Der Check MUST auf „läuft“ bleiben, bis ein jüngerer Check zum neuen Stand ihn ablöst.

#### Scenario: Fremder Merge während des Laufs
- **WHEN** ein fertiger PR gegen Stand X von `alpha` rechnet und währenddessen ein anderer PR auf `alpha` gemergt wird
- **THEN** zeigt der PR zu keinem Zeitpunkt einen roten oder abgebrochenen Check aus diesem Workflow, und `Baut mit Ziel-Branch` steht auf „läuft“, bis das Ergebnis gegen den neuen Stand gemeldet ist

### Requirement: Ein überholter Check ohne Nachfolger wird rot
Hat sich während eines Laufs nur der Ziel-Branch bewegt und erscheint binnen 5 Minuten kein jüngerer Check `Baut mit Ziel-Branch` am Kopf, ohne dass ein Lauf zum neuen Stand aussteht, MUST der überholte Check rot werden und sagen, dass der Lauf neu zu starten ist. Hat sich der PR-Kopf bewegt, MAY er ohne Frist offen bleiben, denn der PR zeigt den alten Kopf nicht mehr.

#### Scenario: Kein neuer Lauf folgt
- **WHEN** ein Lauf überholt ist, weil sich der Ziel-Branch bewegt hat, binnen 5 Minuten kein jüngerer Check am Kopf erscheint und kein Lauf zum neuen Stand aussteht
- **THEN** ist der Check rot und rät, den Lauf neu zu starten, statt still auf „läuft“ zu bleiben

### Requirement: Läufe je PR werden auf den jüngsten Stand gebündelt
Je PR MUST höchstens ein Lauf von `Baut mit Ziel-Branch` rechnen und höchstens einer warten. Ein neuer Anstoß MUST den wartenden ersetzen und MUST NOT den rechnenden abbrechen. Der wartende MUST gegen den Stand des Ziel-Branches rechnen, der bei seinem Start gilt.

#### Scenario: Fünf Merges in zehn Minuten
- **WHEN** innerhalb von zehn Minuten fünf PRs auf `alpha` gemergt werden und ein weiterer PR fertig ist, dessen Lauf etwa zehn Minuten dauert
- **THEN** rechnet dieser PR höchstens zweimal, und das gemeldete Ergebnis gilt gegen den letzten der fünf Stände

#### Scenario: Stand schon gerechnet
- **WHEN** ein wartender Lauf schon gegen den neuesten Stand gerechnet hat und der Anstoß zu genau diesem Stand erst danach kommt
- **THEN** rechnet der PR nicht ein drittes Mal, und der Check zu diesem Anstoß übernimmt das vorhandene Ergebnis samt Fehlerausgabe. Ein Lauf ohne Ergebnis zählt nicht als gerechnet, und ein von Hand neu gestarteter Einzellauf rechnet immer.

#### Scenario: Neuer Commit am PR während des Laufs
- **WHEN** an einen rechnenden fertigen PR ein neuer Commit gepusht wird
- **THEN** rechnet der Lauf zum alten Kopf zu Ende, ohne am PR etwas Rotes zu hinterlassen, und der neue Kopf rechnet direkt danach
