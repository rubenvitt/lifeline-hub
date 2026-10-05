# Design

## Context

Warum: proposal.md. Heute fährt Schritt 4 `cargo test --workspace --exclude lifeline-desktop`
ohne Features. Hinter `dev-seeds` stehen `src/dev/` (Modul in `src/lib.rs`, 12 Tests in
`src/dev/seed.rs`), `src/routes/dev.rs` mit seiner Registrierung in `src/app.rs`,
`tests/dev_present.rs` (Gegenstück `tests/dev_absent.rs` läuft ohne Feature schon in Schritt 4)
und ein Block in `src/main.rs`, der `dev_seed` beim Start aufruft. Das Feature hat keine Abhängigkeiten (`dev-seeds = []`).

Die CI fährt die Rust-Suite als einen Job (`Rust-Suite`, `--nur rust`), der als einziger den
geteilten Cargo-Cache pflegt; Schritt 4 braucht dort rund 17 Minuten.

## Goals / Non-Goals

**Goals:** Bau und Tests des Feature-Codes im vollen Gate und in der CI; ein roter Seed sperrt
den PR über einen bestehenden Pflicht-Check.

**Non-Goals:** Die übrigen rund 2 400 Tests unter `src/` ein zweites Mal mit Feature fahren;
e2e mit Feature; andere Feature-Kombinationen (`--no-default-features` ohne `clamav`).

## Decisions

### D1 Eigener Schritt 15, nicht in Schritt 4 angehängt

Ein eigener Schritt erscheint mit eigenem Namen im Schlussbericht des Gates („Dev-Seed mit
Feature `dev-seeds`“). Ein roter Seed liest sich dann nicht als „Rust-Suite rot“, und der
Schrittläufer (`scripts/lib/schritte.sh`) fährt ihn auch, wenn Schritt 4 rot ist.

*Alternative:* zwei Zeilen am Ende von `schritt_4`. Spart eine Nummer, aber ein Fehler in
Schritt 4 (`set -e` in der Subshell) übersprünge den Seed, und der Bericht unterscheidet nicht.

### D2 Bündel `rust`, kein neuer CI-Job

`BUENDEL_rust="4 15"`. Der Job `Rust-Suite` hat die Abhängigkeiten gerade gebaut; Schritt 15
baut danach nur das eigene Crate neu, weil sich mit dem Feature dessen Fingerprint ändert, die
Abhängigkeiten aber nicht.

*Alternativen:* Bündel `schnell` müsste alle Abhängigkeiten selbst bauen (dort ist der
Cargo-Cache nur gelesen, und der Job wäre nicht mehr „schnell“). Ein eigener Job müsste in
`ci.yml` und als Pflicht-Check im Ruleset 17017911 eingetragen werden; ohne Eintrag sperrte er
nichts (wie bei LFH-729 abgewogen).

### D3 Umfang: zwei Cargo-Aufrufe auf `-p lifeline-hub`

```
cargo test -p lifeline-hub --features dev-seeds --lib dev::
cargo test -p lifeline-hub --features dev-seeds --test dev_present --bin lifeline-hub
```

- `--lib dev::` baut die ganze Bibliothek mit Feature (also auch `routes::dev` und die
  Registrierung in `app.rs`) und fährt nur die Tests, deren Pfad `dev::` enthält
  (`dev::seed::tests`).
- `--test dev_present` prüft, dass `/api/dev/users` im Feature-Build antwortet.
- `--bin lifeline-hub` baut `src/main.rs` mit Feature; dort steht Code, den sonst kein Bau
  sieht (Aufruf von `dev_seed` beim Start).
- Zwei Aufrufe, weil ein Filter in einem Aufruf für alle Ziele gälte und die Testnamen in
  `dev_present` kein `dev::` tragen.
- `-p lifeline-hub` statt `--workspace`: die Feature-Angabe gilt so ohne Paketpräfix, und die
  übrigen Mitglieder sind nicht betroffen. Der Sweep (unten) belegt, dass dabei keine
  Abhängigkeit neu gebaut wird.

Wie Schritt 4: vorher `bauziel_pruefen` (LFH-520), Aufruf über `ohne_dev_env`.

### D4 Nachweis durch Mutationsproben von Hand

Ein Selbsttest, der eine echte Cargo-Kompilation mit gebrochener Quelle fährt, kostete Minuten
in jedem Lauf. Die Proben aus tasks.md 1.3 belegen einmalig, dass jede Szenario-Art aus der
Spec den Schritt rot macht; die Bündel-Selbstprüfung von `check-all.sh` sichert dauerhaft, dass
der Schritt in einem Bündel steht.

## Sweep (vor dem Scharfschalten)

Stand `alpha` 3fa9a4d3, Cloud-Sitzung, 4 Kerne, `CARGO_INCREMENTAL=0`, Debuginfo aus:

- `cargo test --workspace --exclude lifeline-desktop --no-run` kalt: MESSUNG_BASIS
- danach die Ziele aus D3 mit Feature `--no-run`: MESSUNG_DEVSEED, neu gebaut nur
  `lifeline-hub`
- Tests mit Feature: MESSUNG_TESTS

## Risks / Trade-offs

- [Mehrlaufzeit im kritischen CI-Pfad] → nur das eigene Crate wird neu gebaut; gemessen oben.
  Der Job `Rust-Suite` bleibt der kritische Pfad, `timeout-minutes: 90` reicht weiter.
- [Ein Seed-Test außerhalb von `dev::`] (etwa in `auth::provider`) liefe weiter nur ohne
  Feature → Kommentar am Schritt nennt den Filter; ein neuer Test hinter `dev-seeds` gehört
  nach `src/dev/` oder nach `tests/dev_present.rs`.
- [Plattenplatz] Ein zweiter Bau des eigenen Crates kostet zusätzlichen Platz in `target/`
  → gemessen oben; die CI hat ab 40 GB frei keinen Engpass.

## Migration Plan

Kein Datenbestand betroffen. Rückweg: Schritt 15 entfernen und `BUENDEL_rust` zurücksetzen.
