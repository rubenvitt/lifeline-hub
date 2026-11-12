## ADDED Requirements

### Requirement: Ein fertiger PR muss mit dem aktuellen Ziel-Branch bauen
Ein fertiger PR MUST den Pflicht-Check `Baut mit Ziel-Branch` tragen. Er MUST den Kopf-Commit des
PRs mit dem aktuellen Stand des Ziel-Branches zusammenführen und das Ergebnis kompilieren: das
Backend mit allen Testzielen und das Frontend per Typprüfung. Grün ist er nur, wenn beides
kompiliert. Solange der PR nicht fertig ist, MUST der Check auf dem Kopf-Commit fehlen oder warten.

#### Scenario: Zwei PRs, einzeln grün, zusammen kein Build
- **WHEN** PR A die Signatur einer Funktion ändert und gemergt wird, und PR B mit Auto-Merge einen Test enthält, der die alte Signatur aufruft
- **THEN** ist `Baut mit Ziel-Branch` an PR B rot, und PR B mergt nicht

#### Scenario: Nur das Frontend bricht
- **WHEN** ein fertiger PR einen Typ verwendet, den ein inzwischen auf dem Ziel-Branch gemergter PR umbenannt hat
- **THEN** ist `Baut mit Ziel-Branch` rot

#### Scenario: PR in Arbeit
- **WHEN** ein PR weder Auto-Merge noch das Label `e2e` hat und auf ihn gepusht wird
- **THEN** kompiliert der Check nicht, und der PR ist nicht mergebar

#### Scenario: Konflikt mit dem Ziel-Branch
- **WHEN** sich ein fertiger PR nicht konfliktfrei mit dem Ziel-Branch zusammenführen lässt
- **THEN** ist der Check rot und nennt den Konflikt als Grund

### Requirement: Bewegt sich der Ziel-Branch, entsteht der Check neu
Nach jedem Push auf `alpha`, `beta` oder `main` MUST `Baut mit Ziel-Branch` für jeden offenen,
fertigen PR gegen diesen Branch auf „läuft“ gehen und neu berechnet werden, ohne neuen Commit am
PR. Ein offener PR, der nicht fertig ist (auch ein Entwurf) und den Check trägt, MUST ihn auf
„wartet“ bekommen. Ein Ergebnis gegen einen älteren Stand MUST nach dem Neuberechnen nicht als
jüngstes stehen bleiben.

#### Scenario: Fremder Merge, PR mit Auto-Merge
- **WHEN** PR A auf `alpha` gemergt wird und PR B mit Auto-Merge offen ist
- **THEN** rechnet `Baut mit Ziel-Branch` an PR B gegen den neuen Stand von `alpha`, und PR B mergt erst danach, wenn der Check grün ist

#### Scenario: Fremder Merge, PR in Arbeit
- **WHEN** PR A auf `alpha` gemergt wird und PR C ohne Fertig-Markierung den grünen Check von früher trägt
- **THEN** steht der Check an PR C auf „wartet“, und erst das Einschalten von Auto-Merge lässt ihn rechnen

#### Scenario: Zwei Merges kurz hintereinander
- **WHEN** während eines Laufs gegen Stand X von `alpha` ein weiterer PR gemergt wird
- **THEN** zählt am Ende das Ergebnis gegen den neueren Stand, nicht das gegen X

#### Scenario: Release-Commit auf alpha
- **WHEN** während eines Laufs gegen Stand X auf `alpha` nur ein Release-Commit landet, der keinen Lauf startet
- **THEN** gilt das Ergebnis gegen X, und der PR bleibt nicht auf „läuft“ hängen

#### Scenario: Altes Grün an einem Entwurf
- **WHEN** ein PR mit grünem Check zum Entwurf wird, `alpha` sich bewegt und der PR danach ohne Fertig-Markierung wieder bereit ist
- **THEN** steht der Check auf „wartet“, nicht auf dem alten Grün

### Requirement: PR-Code läuft nie im Bereich eines Kanal-Branches
Code aus einem PR MUST nie in einem Lauf ausgeführt werden, dessen Ref ein Kanal-Branch ist. Das
Neuberechnen nach einem Push MUST deshalb in einem eigenen Lauf auf dem Branch des PRs geschehen.
Der Teil, der PR-Code kompiliert, MUST ohne Schreibrechte am Repository und ohne Secrets laufen und
MUST keinen Cache speichern. Ein PR aus einem Fork MUST den Check nie grün bekommen.

#### Scenario: Build-Skript im PR
- **WHEN** ein PR ein Build-Skript enthält, das versucht, auf das Repository zu schreiben
- **THEN** scheitert der Versuch, weil der Kompilierlauf nur lesen darf

#### Scenario: Bösartiges Build-Skript beim Push auf alpha
- **WHEN** nach einem Merge auf `alpha` ein fertiger PR neu rechnet, dessen Abhängigkeit beim Bauen Cache-Einträge anzulegen versucht
- **THEN** läuft sein Code in einem Lauf auf seinem eigenen Branch, und kein Eintrag landet im Cache-Bereich von `alpha`

#### Scenario: Einzellauf von Hand auf alpha
- **WHEN** jemand den Lauf des Checks für einen PR von Hand auf `alpha` startet
- **THEN** rechnet er nicht, und kein PR-Code läuft

#### Scenario: Branch kennt den Workflow noch nicht
- **WHEN** ein fertiger PR neu rechnen soll, dessen Branch den Workflow des Checks noch nicht enthält
- **THEN** ist der Check rot und sagt, dass der Ziel-Branch hineinzumergen ist

#### Scenario: PR aus einem Fork
- **WHEN** ein PR aus einem Fork fertig markiert wird
- **THEN** bleibt `Baut mit Ziel-Branch` aus, und der PR ist nicht mergebar
