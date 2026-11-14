# Spec Delta

## ADDED Requirements

### Requirement: Ein überholter Lauf macht keinen PR rot
Bewegt sich der Ziel-Branch oder der PR-Kopf, während `Baut mit Ziel-Branch` rechnet, MUST weder der Check noch ein Job des Laufs als abgebrochen oder fehlgeschlagen enden. Ausgenommen ist ein Lauf, der sich nicht starten ließ. Der Check MUST auf „läuft“ bleiben, bis ein Ergebnis gegen den neuen Stand vorliegt. Liegt es vor, MUST es auch jeden älteren noch offenen Check dieses Namens auf demselben Kopf-Commit schließen.

#### Scenario: Fremder Merge während des Laufs
- **WHEN** ein fertiger PR gegen Stand X von `alpha` rechnet und währenddessen ein anderer PR auf `alpha` gemergt wird
- **THEN** zeigt der PR zu keinem Zeitpunkt einen roten oder abgebrochenen Check aus diesem Workflow, und `Baut mit Ziel-Branch` steht auf „läuft“, bis das Ergebnis gegen den neuen Stand gemeldet ist

#### Scenario: Ergebnis schließt ältere Checks
- **WHEN** auf einem Kopf-Commit ältere Checks `Baut mit Ziel-Branch` offen stehen und ein jüngerer Lauf ein gültiges Ergebnis meldet
- **THEN** sind danach alle diese Checks mit diesem Ergebnis geschlossen, und ein Check, der erst nach dem gemeldeten Lauf angelegt wurde, bleibt offen

### Requirement: Läufe je PR werden auf den jüngsten Stand gebündelt
Je PR MUST höchstens ein Lauf von `Baut mit Ziel-Branch` rechnen und höchstens einer warten. Ein neuer Anstoß MUST den wartenden ersetzen und MUST NOT den rechnenden abbrechen. Der wartende MUST gegen den Stand des Ziel-Branches rechnen, der bei seinem Start gilt.

#### Scenario: Fünf Merges in zehn Minuten
- **WHEN** innerhalb von zehn Minuten fünf PRs auf `alpha` gemergt werden und ein weiterer PR fertig ist, dessen Lauf etwa zehn Minuten dauert
- **THEN** rechnet dieser PR höchstens zweimal, und das gemeldete Ergebnis gilt gegen den letzten der fünf Stände

#### Scenario: Stand schon gerechnet
- **WHEN** ein wartender Lauf schon gegen den neuesten Stand gerechnet hat und der Anstoß zu genau diesem Stand erst danach kommt
- **THEN** rechnet der PR nicht ein drittes Mal, und der Check zu diesem Anstoß übernimmt das vorhandene Ergebnis

#### Scenario: Neuer Commit am PR während des Laufs
- **WHEN** an einen rechnenden fertigen PR ein neuer Commit gepusht wird
- **THEN** rechnet der Lauf zum alten Kopf zu Ende, ohne am PR etwas Rotes zu hinterlassen, und der neue Kopf rechnet direkt danach
