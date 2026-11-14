# pr-pruefstufen Specification

## Purpose
Legt fest, welche Prüfungen auf einem offenen Pull Request und auf den Kanal-Branches wann laufen:
im PR nur die leichten Pflicht-Checks (mit dem Label `voll` zusätzlich alle Suiten ohne Pflicht),
auf `alpha`, `beta` und `main` alle Suiten, abbrechbar durch einen neueren Push, mit einem Release
nur aus einem vollständig grünen Lauf.

## Requirements

### Requirement: Kanal-Branches prüfen immer voll
Ein Push auf `alpha`, `beta` oder `main` MUST alle Suiten einschließlich e2e voll fahren, unabhängig von Auto-Merge, Labels und geänderten Dateien. Der Release-Job MUST auf alle vier Prüfjobs (Schnellprüfungen, Rust, Frontend, e2e) dieses Laufs warten und MUST entfallen, wenn einer davon abgebrochen wurde.

#### Scenario: Merge auf alpha
- **WHEN** ein PR auf `alpha` gemergt wird
- **THEN** laufen auf dem Merge-Commit Schnellprüfungen, Rust-, Frontend- und e2e-Suite, und ein Release entsteht nur, wenn alle grün sind

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
- **WHEN** ein PR ohne Auto-Merge ist und auf ihn gepusht wird
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

### Requirement: Ein PR prüft nur leicht
Ein Push auf einen offenen Pull Request gegen `alpha`, `beta` oder `main` MUST die Schnellprüfungen starten. Ohne das Label `voll` MUST er weder die Rust-, die Frontend- noch die e2e-Suite starten. Pflicht für das Mergen MUST nur sein: `Schnellprüfungen`, `Migrationsnummern`, `ADR-Nummern` und `Baut mit Ziel-Branch`.

#### Scenario: PR ohne Label
- **WHEN** auf einen PR ohne Label `voll` ein Commit gepusht wird, der Backend- und Frontend-Code ändert
- **THEN** laufen die Schnellprüfungen, und kein Job fährt die Rust-, Frontend- oder e2e-Suite

#### Scenario: Mergebar ohne Suiten
- **WHEN** an einem PR mit Auto-Merge `Schnellprüfungen`, `Migrationsnummern`, `ADR-Nummern` und `Baut mit Ziel-Branch` grün sind
- **THEN** ist er mergebar, ohne dass eine schwere Suite auf ihm lief

### Requirement: Das Label `voll` fährt alle Suiten im PR
Trägt ein PR das Label `voll`, MUST jeder Push auf ihn und das Setzen des Labels die Rust-, Frontend- und e2e-Suite ganz starten, ohne Auswahl nach geänderten Dateien. Ihre Ergebnisse MUST NOT Pflicht für das Mergen sein. An einem PR ohne `voll` MUST ein anderes Label keine schwere Suite starten und keinen laufenden Lauf abbrechen. An einem PR mit `voll` MUST jedes Ereignis die Suiten neu starten, damit kein übersprungener Check eine rote Suite verdeckt.

#### Scenario: Label gesetzt
- **WHEN** ein PR das Label `voll` bekommt
- **THEN** laufen auf seinem Kopf-Commit Schnellprüfungen, Rust-, Frontend- und e2e-Suite

#### Scenario: Rote Suite mit Label
- **WHEN** an einem PR mit Label `voll` die Frontend-Suite rot ist und die Pflicht-Checks grün sind
- **THEN** ist der PR trotzdem mergebar, und die rote Suite steht sichtbar am PR

#### Scenario: Anderes Label
- **WHEN** ein PR ohne `voll` ein anderes Label bekommt
- **THEN** startet keine schwere Suite, und ein laufender Lauf läuft weiter

#### Scenario: Anderes Label an einem PR mit `voll`
- **WHEN** ein PR mit `voll` und roter Rust-Suite ein weiteres Label bekommt
- **THEN** laufen die Suiten neu, und die Rust-Suite steht danach wieder mit echtem Ergebnis am PR, nie als übersprungen

### Requirement: Ein PR ist fertig, wenn Auto-Merge an ist
Ein offener PR MUST als fertig gelten, solange Auto-Merge eingeschaltet ist. Labels, Kommentare und Reviews MUST daran nichts ändern.

#### Scenario: Auto-Merge eingeschaltet
- **WHEN** an einem PR Auto-Merge eingeschaltet wird
- **THEN** gilt er als fertig, und `Baut mit Ziel-Branch` rechnet

#### Scenario: Label ohne Auto-Merge
- **WHEN** ein PR ohne Auto-Merge das Label `voll` oder `e2e` trägt
- **THEN** gilt er nicht als fertig

### Requirement: Ein neuer Push auf einen Kanal-Branch bricht die Tests des laufenden Laufs ab
Ein Push auf `alpha`, `beta` oder `main` MUST die Testjobs (Rust-, Frontend-, e2e-Suite) eines noch laufenden Laufs auf demselben Branch abbrechen. Ein Release-Job, der schon läuft, MUST NOT abbrechen. Ein Release MUST nur aus einem Lauf entstehen, dessen Schnellprüfungen und Suiten alle grün sind.

#### Scenario: Zwei Merges kurz hintereinander
- **WHEN** während des Laufs zu Merge A auf `alpha` Merge B landet
- **THEN** brechen die Testjobs zu A ab, die zu B laufen voll, und ein Release kommt nur aus dem Lauf zu B

#### Scenario: Release läuft schon
- **WHEN** im Lauf zu A der Release-Job schon läuft und Merge B landet
- **THEN** läuft der Release zu A zu Ende, und der Release zu B wartet auf ihn
