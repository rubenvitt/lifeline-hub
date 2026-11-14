# pr-pruefstufen Specification

## Purpose
Legt fest, welche Prüfungen auf einem offenen Pull Request wann laufen: die billigen bei jedem
Push, die e2e-Suite erst, wenn der PR als fertig markiert ist. So kostet ein PR in Arbeit wenig
Runner-Zeit, und trotzdem mergt nichts ohne grüne e2e-Anteile auf seinem Kopf-Commit.

## Requirements

### Requirement: Jeder Push auf einen PR prüft die erste Stufe
Ein Push auf einen offenen Pull Request gegen `alpha`, `beta` oder `main` MUST die
Schnellprüfungen sowie die Rust- und die Frontend-Suite starten, beide nur, soweit die
geänderten Dateien sie verlangen. Er MUST keine e2e-Jobs starten, solange der PR nicht als fertig
markiert ist.

#### Scenario: PR in Arbeit
- **WHEN** auf einen PR ohne Auto-Merge und ohne Label `e2e` ein Commit gepusht wird, der Frontend-Code ändert
- **THEN** laufen Schnellprüfungen, Rust- und Frontend-Suite, und kein Job baut das e2e-Binary oder fährt einen e2e-Anteil

#### Scenario: Nur Doku geändert
- **WHEN** ein Push auf einen PR nur Dateien ändert, die keine schwere Suite liest
- **THEN** laufen die Schnellprüfungen, Rust- und Frontend-Suite laufen leer durch

### Requirement: Ein PR ist fertig, wenn Auto-Merge an ist oder das Label `e2e` trägt
Ein offener PR MUST als fertig gelten, solange Auto-Merge eingeschaltet ist oder er das Label
`e2e` trägt. Andere Labels, Kommentare oder Reviews MUST daran nichts ändern.

#### Scenario: Auto-Merge eingeschaltet
- **WHEN** an einem PR Auto-Merge eingeschaltet wird
- **THEN** gilt er als fertig

#### Scenario: Label gesetzt, Auto-Merge aus
- **WHEN** ein PR ohne Auto-Merge das Label `e2e` bekommt
- **THEN** gilt er als fertig, und gemergt wird erst, wenn jemand mergt oder Auto-Merge einschaltet

#### Scenario: Anderes Label
- **WHEN** ein PR ohne Auto-Merge ein anderes Label als `e2e` bekommt
- **THEN** gilt er weiter nicht als fertig

### Requirement: Ein fertiger PR fährt die zweite Stufe auf seinem Kopf-Commit
Wird ein PR fertig, MUST die zweite Stufe (e2e-Binary und die Anteile `e2e 1/4` bis `4/4`) für
seinen aktuellen Kopf-Commit starten, ohne neuen Commit. Jeder weitere Push auf einen fertigen PR
MUST sie für den neuen Kopf-Commit erneut starten. Die zweite Stufe MUST dabei dieselbe Auswahl
nach geänderten Dateien treffen wie die erste: ist e2e nicht betroffen, laufen die Anteile leer
und grün durch.

#### Scenario: Auto-Merge nach grüner erster Stufe
- **WHEN** die erste Stufe eines PRs grün ist und danach Auto-Merge eingeschaltet wird
- **THEN** laufen e2e-Binary und alle vier Anteile auf dem Kopf-Commit, und ist alles grün, mergt GitHub den PR

#### Scenario: Push nach dem Einschalten
- **WHEN** auf einen PR mit eingeschaltetem Auto-Merge ein neuer Commit gepusht wird
- **THEN** laufen erste und zweite Stufe auf dem neuen Kopf-Commit, und ein noch laufender e2e-Lauf für den alten Kopf bricht ab

#### Scenario: e2e nicht betroffen
- **WHEN** ein fertiger PR nur die Desktop-Hülle (`src-tauri/`) ändert, die die e2e-Suite laut Zuordnung nicht braucht
- **THEN** melden `e2e-Binary` und `e2e 1/4` bis `4/4` grün, ohne Browser zu starten

#### Scenario: Erste Stufe ist rot
- **WHEN** an einem PR mit roter Rust-Suite Auto-Merge eingeschaltet wird
- **THEN** läuft die zweite Stufe trotzdem, und der PR mergt nicht, weil die Rust-Suite rot bleibt

### Requirement: Vor der zweiten Stufe fehlen ihre Pflicht-Checks
Solange die zweite Stufe auf dem Kopf-Commit eines PRs nicht gelaufen ist, MUST jeder ihrer
Pflicht-Checks (`e2e-Binary`, `e2e 1/4` bis `4/4`) fehlen. Kein Lauf darf ihn dort als
übersprungen oder leer erfolgreich melden. Die Namen der Pflicht-Checks MUST unverändert bleiben.

#### Scenario: PR in Arbeit
- **WHEN** ein PR nicht als fertig markiert ist und seine erste Stufe grün ist
- **THEN** zeigt GitHub `e2e-Binary` und `e2e 1/4` bis `4/4` als ausstehend, und der PR ist nicht mergebar

#### Scenario: Grüne e2e-Checks eines älteren Commits
- **WHEN** die zweite Stufe auf Commit A grün war und danach Commit B ohne Auto-Merge und ohne Label gepusht wird
- **THEN** fehlen die e2e-Pflicht-Checks auf B, und der PR ist nicht mergebar

### Requirement: Wer die Markierung zurücknimmt, beendet die zweite Stufe
Endet die Fertig-Markierung eines PRs (Auto-Merge aus und kein Label `e2e`), MUST ein laufender
e2e-Lauf dieses PRs abbrechen. Schaltet ein Ereignis die Markierung nicht um (etwa ein anderes
Label oder das Entfernen von `e2e` bei weiter eingeschaltetem Auto-Merge), MUST ein laufender
e2e-Lauf weiterlaufen.

#### Scenario: Auto-Merge aus
- **WHEN** an einem PR ohne Label `e2e` Auto-Merge ausgeschaltet wird, während die e2e-Anteile laufen
- **THEN** brechen die e2e-Jobs ab, und die Pflicht-Checks bleiben für diesen Commit unerfüllt

#### Scenario: Fremdes Label während des Laufs
- **WHEN** ein PR während eines laufenden e2e-Laufs ein anderes Label bekommt
- **THEN** läuft der e2e-Lauf weiter

### Requirement: Kanal-Branches prüfen immer voll
Ein Push auf `alpha`, `beta` oder `main` MUST alle Suiten einschließlich e2e voll fahren,
unabhängig von Auto-Merge, Labels und geänderten Dateien. Der Release-Job MUST auf alle vier
Prüfjobs (Schnellprüfungen, Rust, Frontend, e2e) dieses Laufs warten.

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
