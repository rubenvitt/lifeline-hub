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
fertigen PR gegen diesen Branch neu berechnet werden, ohne neuen Commit am PR. Für einen offenen PR,
der nicht fertig ist und den Check schon trägt, MUST der Check auf „wartet“ gehen und neu rechnen,
sobald der PR fertig markiert wird. Ein Ergebnis gegen einen älteren Stand des Ziel-Branches MUST
nie als jüngstes stehen bleiben.

#### Scenario: Fremder Merge, PR mit Auto-Merge
- **WHEN** PR A auf `alpha` gemergt wird und PR B mit Auto-Merge offen ist
- **THEN** rechnet `Baut mit Ziel-Branch` an PR B gegen den neuen Stand von `alpha`, und PR B mergt erst danach, wenn der Check grün ist

#### Scenario: Fremder Merge, PR in Arbeit
- **WHEN** PR A auf `alpha` gemergt wird und PR C ohne Fertig-Markierung den grünen Check von früher trägt
- **THEN** steht der Check an PR C auf „wartet“, und erst das Einschalten von Auto-Merge lässt ihn rechnen

#### Scenario: Zwei Merges kurz hintereinander
- **WHEN** während eines Laufs gegen Stand X von `alpha` ein weiterer PR gemergt wird
- **THEN** zählt am Ende das Ergebnis gegen den neueren Stand, nicht das gegen X

### Requirement: Der Kompilierlauf hat keine Schreibrechte
Der Teil, der Code aus dem PR kompiliert, MUST ohne Schreibrechte am Repository und ohne Secrets
laufen und MUST keinen Cache schreiben, den Läufe auf den Kanal-Branches später lesen. Den Check am
PR MUST ein getrennter Teil schreiben, der keinen Code aus dem PR ausführt. Ein PR aus einem Fork
MUST den Check nie grün bekommen.

#### Scenario: Build-Skript im PR
- **WHEN** ein PR ein Build-Skript enthält, das versucht, auf das Repository zu schreiben
- **THEN** scheitert der Versuch, weil der Kompilierlauf nur lesen darf

#### Scenario: PR aus einem Fork
- **WHEN** ein PR aus einem Fork fertig markiert wird
- **THEN** bleibt `Baut mit Ziel-Branch` aus, und der PR ist nicht mergebar
