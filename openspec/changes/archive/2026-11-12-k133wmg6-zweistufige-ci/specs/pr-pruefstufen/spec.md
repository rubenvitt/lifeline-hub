## Purpose

Legt fest, welche Prüfungen auf einem offenen Pull Request wann laufen: die billigen bei jedem
Push, die e2e-Suite erst, wenn der PR als fertig markiert ist. So kostet ein PR in Arbeit wenig
Runner-Zeit, und trotzdem mergt nichts ohne grüne e2e-Anteile auf seinem Kopf-Commit.

## ADDED Requirements

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
