# Tasks

## 1. Build-Ziel je Checkout

- [x] 1.1 `.cargo/config.toml` mit `[build] target-dir = "target"` und einem Kopfkommentar
      anlegen. Der Kommentar nennt die Ursache (relativer Hash, mtime-Frische), den Vorrang
      (Umgebung > Repo > global) und die Übergangsschwäche bei verschachtelten Checkouts.
      Verifikation: `cargo metadata --no-deps --format-version 1` meldet
      `<worktree>/target` als `target_directory`.
- [x] 1.2 Hermetischen Selbsttest `scripts/bauziel.test.sh` schreiben (zuerst rot gegen einen
      Stand ohne Datei). Ein Wegwerf-Crate in zwei Kopien a/b, eine globale Konfiguration über
      ein eigenes `CARGO_HOME` mit gemeinsamem `target-dir`, die Quellen von b älter als der
      Bau von a. Geprüft wird: ohne Repo-Datei gibt b „A“ aus (Fehlerbeleg), mit Repo-Datei
      „B“, mit `CARGO_TARGET_DIR` gewinnt die Umgebung. Verifikation: Der Test ist grün, und
      die Mutationsprobe (Repo-Datei im Test weglassen) macht ihn rot.

## 2. Prüfung im Sammel-Gate

- [x] 2.1 `scripts/lib/bauziel.sh` mit `bauziel_pruefen` nach design.md D3 schreiben:
      eigenes Ziel still, übersteuert mit Ausgabe, geerbt fremd rot mit Ziel und Hinweis.
      Die drei Fälle kommen in `scripts/bauziel.test.sh` dazu. Verifikation: Der Selbsttest
      deckt alle drei Ausgänge ab, jede Mutation (Vergleich umdrehen, Umgebungsvariable
      ignorieren) macht ihn rot.
- [x] 2.2 `bauziel_pruefen` am Anfang von `schritt_4` und `schritt_7` aufrufen (in Schritt 7
      nicht bei gesetztem `PW_BINAER`) und `scripts/bauziel.test.sh` in den Selbsttest-Schritt
      des `schnell`-Bündels hängen. Der Dateikopf von `check-all.sh` und die Kommentare in
      Schritt 7, die noch vom „globalen build.target-dir“ sprechen, werden nachgezogen.
      Verifikation: `./scripts/check-all.sh --nur=schnell` und `scripts/check-all.test.sh`
      sind grün. Wird `.cargo/config.toml` lokal kurz beiseitegelegt, sodass das globale Ziel
      greift, endet `--nur rust` sofort rot und nennt `~/.cache/cargo-target`.

## 3. Nachvollziehbares Backend-Binary

- [ ] 3.1 `schritt_7` und `frontend/playwright.config.ts` geben `Backend-Binary: <pfad>` aus.
      Verifikation: `check-all.sh --nur e2e` und `pnpm e2e --list` zeigen im selben Checkout
      denselben Pfad unter `<worktree>/target`. `strings <binary> | grep frontend/dist` zeigt
      auf den eigenen Worktree.

## 4. Dokumentation

- [x] 4.1 In `CLAUDE.md` unter „Qualitäts-Gates“ einen Absatz ergänzen: Build-Ziel je Checkout
      (LFH-520), Messwerte (~3 min kalt, bis 19 GB je voll gebautem Worktree), Übersteuerung,
      Übergang bei verschachtelten Checkouts, Verweis auf diesen Change. Verifikation: Der
      Absatz nennt nur Pfade und Funktionen, die es gibt (`git grep`).
- [x] 4.2 Memory `geteiltes-cargo-target-worktrees` und `e2e-geteiltes-cargo-target-fremdes-dist`
      nachziehen. Die Anweisung „`CARGO_TARGET_DIR` ins Scratchpad“ ist überholt, der
      Übergangshinweis bleibt. Dem Nutzer wird die Korrektur des Kommentars in
      `~/.cargo/config.toml` vorgeschlagen, die Datei selbst wird nicht angefasst.
      Verifikation: Die Memory-Dateien widersprechen dem neuen CLAUDE.md-Absatz nicht.
- [x] 4.3 Nachzug-Ticket „Debuginfo der Testbinaries verkleinern“ per `clickup-task-anlegen`
      anlegen, mit den Messwerten aus design.md (angelegt: LFH-845). Verifikation: Die Ticket-ID steht im
      PR-Text.

## 5. Integrationsnachweis

- [x] 5.1 Paralleler Projektnachweis mit zwei Checkouts: dieser Worktree und ein Export von
      HEAD mit ausgeschalteter Abweisung von `vermisst` + UHS, dessen Quellen älter sind.
      Gleichzeitig laufen `cargo test --test person_aufnahme_uhs`. Verifikation: A 6/6, B
      genau ein Fehlschlag in `aufnahme_vermisst_…_abgewiesen`. Das Log wird außerhalb des
      Scratchpads gesichert und im PR zitiert.
- [ ] 5.2 Vollgate `./scripts/check-all.sh` im eigenen Worktree (per `nohup`) ausführen.
      Verifikation: Exit 0, im Log kein `ÜBERSPRUNGEN` und kein „Backend-Binary fehlt“.
