# Spec Delta

## Purpose

Stellt sicher, dass Tests, Sammel-Gate und Browsertests eines Checkouts nur Artefakte aus
dessen eigenem Quellstand verwenden, auch wenn mehrere Worktrees desselben Repos parallel
bauen. Ein grünes Gate belegt damit den Stand, auf dem es läuft.

## ADDED Requirements

### Requirement: Build-Ziel gehört dem Checkout
Ein Cargo-Aufruf in einem Checkout des Repos MUST seine Artefakte in `<checkout>/target`
ablegen und nur von dort lesen. Das gilt auch, wenn die Nutzerkonfiguration ein gemeinsames
Build-Ziel vorgibt. Zwei Checkouts mit verschiedenem Quellstand MUST nie dieselben
Fingerprints, Testbinaries oder dasselbe Backend-Binary verwenden. Eine ausdrücklich gesetzte
Umgebungsvariable (`CARGO_TARGET_DIR` oder `CARGO_BUILD_TARGET_DIR`) MUST das Ziel weiterhin
übersteuern können.

#### Scenario: Zwei Checkouts mit verschiedenem Backend-Verhalten laufen parallel
- **WHEN** Checkout A den Handler mit Abweisung von `vermisst` + UHS trägt, Checkout B ihn
  ohne diese Abweisung trägt, die Quellen von B älter sind als der letzte Bau von A und in
  beiden gleichzeitig `cargo test --test person_aufnahme_uhs` läuft
- **THEN** meldet A 6/6 bestanden und B genau den Fehlschlag im Abweisungsfall; jeder
  Checkout führt das Testbinary aus seinem eigenen Ziel aus, gebaut aus seinen eigenen Quellen

#### Scenario: Globale Nutzerkonfiguration mit gemeinsamem Ziel
- **WHEN** `~/.cargo/config.toml` `build.target-dir` auf ein gemeinsames Verzeichnis setzt
- **THEN** meldet `cargo metadata` für den Checkout `<checkout>/target` als
  `target_directory`

#### Scenario: Ausdrückliche Übersteuerung
- **WHEN** `CARGO_TARGET_DIR` auf ein anderes Verzeichnis gesetzt ist
- **THEN** baut Cargo dorthin, und Sammel-Gate wie Playwright verwenden dieses Verzeichnis

#### Scenario: CI unverändert
- **WHEN** die CI ohne Nutzerkonfiguration baut
- **THEN** liegt das Backend-Binary wie bisher unter `target/debug/lifeline-hub`

### Requirement: Sammel-Gate prüft die Zugehörigkeit des Build-Ziels
Bevor das Sammel-Gate Cargo-Artefakte baut oder startet (Typ-Drift, Rust-Suite, e2e), MUST es das
wirksame Build-Ziel ermitteln. Liegt das Ziel außerhalb des eigenen Checkouts und ist es
nicht ausdrücklich per Umgebungsvariable gewählt, MUST der Schritt rot enden. Die Meldung MUST
das gefundene Ziel und die Ursache nennen. Bei ausdrücklicher Übersteuerung MUST das Gate das
verwendete Ziel ausgeben und weiterlaufen.

#### Scenario: Ziel im eigenen Checkout
- **WHEN** das wirksame Ziel `<checkout>/target` ist
- **THEN** laufen Typ-Drift, Rust-Suite und e2e ohne zusätzliche Meldung weiter

#### Scenario: Geerbtes fremdes Ziel
- **WHEN** das wirksame Ziel aus einer Konfigurationsdatei außerhalb des Checkouts stammt,
  etwa aus der globalen Nutzerkonfiguration oder einem übergeordneten Checkout
- **THEN** endet der Schritt rot, nennt das Ziel und verweist auf die fehlende oder
  überstimmte Repo-Konfiguration

#### Scenario: Vom übergeordneten Checkout geerbtes Ziel
- **WHEN** ein Checkout ohne Repo-Konfiguration unter einem Checkout mit ihr liegt und
  deshalb `<eltern>/target` als Ziel erbt
- **THEN** endet der Schritt rot und nennt `<eltern>/target`

#### Scenario: Übersteuertes Ziel
- **WHEN** `CARGO_TARGET_DIR` gesetzt ist
- **THEN** gibt das Gate das Ziel mit dem Hinweis „ausdrücklich gewählt“ aus und prüft weiter

### Requirement: Backend-Binary für Browsertests ist nachvollziehbar
Sammel-Gate und alleinstehender Playwright-Lauf MUST beim Start den absoluten Pfad des
Backend-Binarys ausgeben, das sie starten. Beide MUST dasselbe Binary wählen.

#### Scenario: Gleiche Wahl in Gate und Einzellauf
- **WHEN** im selben Checkout erst `./scripts/check-all.sh --nur e2e` und dann
  `pnpm e2e` läuft
- **THEN** geben beide denselben Binary-Pfad unter dem Build-Ziel des Checkouts aus
