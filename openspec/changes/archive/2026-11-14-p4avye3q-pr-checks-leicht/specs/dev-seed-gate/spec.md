# Spec Delta

## MODIFIED Requirements

### Requirement: Der Schritt läuft in der CI ohne eigenen Job
Der Schritt MUST einem Bündel des Sammel-Gates angehören, das ein bestehender CI-Job fährt: die
Rust-Suite auf den Kanal-Branches und an PRs mit dem Label `voll`. Ein roter Schritt MUST diesen
Job rot machen. Er MUST NOT einen zweiten vollen Testlauf des Workspace starten.

#### Scenario: Bündelauswahl der CI
- **WHEN** die CI das Sammel-Gate mit `--nur rust` aufruft
- **THEN** läuft der Dev-Seed-Schritt in diesem Aufruf mit

#### Scenario: Selbstprüfung der Bündel
- **WHEN** der Schritt keinem Bündel zugeordnet ist
- **THEN** bricht das Sammel-Gate vor dem ersten Schritt mit einem Fehler ab
