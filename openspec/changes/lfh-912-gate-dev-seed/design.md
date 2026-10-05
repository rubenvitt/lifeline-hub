# Design

## Context

Warum: proposal.md. Heute fährt Schritt 4 `cargo test --workspace --exclude lifeline-desktop`
ohne Features. Hinter `dev-seeds` stehen `src/dev/` (Modul in `src/lib.rs`, 12 Tests in
`src/dev/seed.rs`), `src/routes/dev.rs` mit seiner Registrierung in `src/app.rs`,
`tests/dev_present.rs` (Gegenstück `tests/dev_absent.rs` läuft ohne Feature schon in Schritt 4)
und ein Block in `src/main.rs`, der `dev_seed` beim Start aufruft. Das Feature hat keine
Abhängigkeiten (`dev-seeds = []`).

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

### D3 Umfang: ein Bau, zwei Läufe, mit dem Paketzuschnitt von Schritt 4

```
A="--workspace --exclude lifeline-desktop --features lifeline-hub/dev-seeds"
cargo test $A --lib --test dev_present --bin lifeline-hub --no-run
cargo test $A --lib dev::
cargo test $A --test dev_present --bin lifeline-hub
```

- `--lib` baut die ganze Bibliothek mit Feature (also auch `routes::dev` und die Registrierung
  in `app.rs`); der Filter `dev::` fährt davon nur `dev::seed::tests` (12 Tests). Die beiden
  anderen Mitglieder haben keinen Test mit `dev::` im Pfad und sind schon gebaut.
- `--test dev_present` prüft, dass `/api/dev/users` im Feature-Build antwortet.
- `--bin lifeline-hub` baut `src/main.rs` mit Feature; dort steht Code, den sonst kein Bau
  sieht (Aufruf von `dev_seed` beim Start).
- **Derselbe Paketzuschnitt wie Schritt 4, nicht `-p lifeline-hub`.** Cargo vereinigt die
  Features der Abhängigkeiten über die ausgewählten Pakete. Mit `-p lifeline-hub` fehlt der
  Beitrag von `karten-service` und `karten-katalog`, und im Sweep baute Cargo rund
  120 Abhängigkeiten ein zweites Mal (177 s). Mit dem Zuschnitt von Schritt 4 baut es nur
  `lifeline-hub` neu. Die Feature-Angabe braucht dann den Paketpräfix.
- **Erst ein Bau, dann zwei Läufe.** Zwei getrennte `cargo test`-Aufrufe bauten nacheinander
  (98 s + 114 s); ein gemeinsamer `--no-run` baut Testbibliothek, Bibliothek, Binary und
  `dev_present` parallel (116 s), die Läufe danach finden alles fertig vor. Zwei Läufe, weil
  der Filter für alle Ziele eines Aufrufs gälte und die Testnamen in `dev_present` kein `dev::`
  tragen.

Wie Schritt 4: vorher `bauziel_pruefen` (LFH-520), Aufruf über `ohne_dev_env`.

### D4 Nachweis durch Mutationsproben von Hand

Ein Selbsttest, der eine echte Cargo-Kompilation mit gebrochener Quelle fährt, kostete Minuten
in jedem Lauf. Die Proben aus tasks.md 1.3 belegen einmalig, dass jede Szenario-Art aus der
Spec den Schritt rot macht; die Bündel-Selbstprüfung von `check-all.sh` sichert dauerhaft, dass
der Schritt in einem Bündel steht.

## Sweep (vor dem Scharfschalten)

Stand `alpha` 3fa9a4d3, Cloud-Sitzung, 4 Kerne, `CARGO_INCREMENTAL=0`, Debuginfo aus:

- `cargo test --workspace --exclude lifeline-desktop --no-run` kalt: 469 s.
- Danach der Bau aus D3: 116 s, neu gebaut nur `lifeline-hub`.
- Die beiden Läufe: 3 s; 12 Tests in `dev::seed::tests`, 1 in `dev_present`, 0 im Binary,
  alle grün. Der Schritt ist also beim Einführen grün.
- `target/` bleibt bei 16 GB (gerundet), der zweite Bau des eigenen Crates fällt nicht ins
  Gewicht.

## Risks / Trade-offs

- [Mehrlaufzeit im kritischen CI-Pfad] rund 2 min auf rund 17 min → nur das eigene Crate wird
  neu gebaut (Sweep). `timeout-minutes: 90` reicht weiter.
- [Ein Mitglied ändert später seine Abhängigkeits-Features] Dann bliebe die Vereinigung
  trotzdem gleich, weil Schritt 4 und 15 dieselben Pakete wählen; nur `-p` bräche das.
- [Ein Seed-Test außerhalb von `dev::`] (etwa in `auth::provider`) liefe weiter nur ohne
  Feature → Kommentar am Schritt nennt den Filter; ein neuer Test hinter `dev-seeds` gehört
  nach `src/dev/` oder nach `tests/dev_present.rs`.

## Migration Plan

Kein Datenbestand betroffen. Rückweg: Schritt 15 entfernen und `BUENDEL_rust` zurücksetzen.
