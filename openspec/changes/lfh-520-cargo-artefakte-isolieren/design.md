# Design

## Context

Warum das nötig ist, steht in proposal.md (Why). Die Mechanik ist am 30.09.2026 gemessen
(cargo 1.98.1):

- **Ursache.** Den `-C metadata`-Hash eines Workspace-Mitglieds bildet Cargo aus der
  Paket-Id mit dem Quellpfad **relativ zur Workspace-Wurzel**. `lifeline_hub-<hash>` ist deshalb
  in jedem Worktree gleich. Die Frische prüft Cargo per mtime: Die Dep-Info-Pfade des Pakets
  werden gegen das Alter der Ausgabe verglichen. Im Mini-Repro teilten zwei Kopien a/b ein Ziel,
  und b meldete `Fresh` und gab „Quellstand A“ aus. Am Projekt lief ein Stand ohne Abweisung
  von `vermisst` + UHS mit 6/6 durch und führte `person_aufnahme_uhs-77a78146d006cd0a` aus A aus.
- **Nebenbefund.** Verschiedene Aufrufformen erzeugen wegen der Feature-Vereinigung
  verschiedene Hashes, etwa `--workspace` gegenüber `--test x`. Deshalb tritt der Fehler nur
  sporadisch auf.
- **Plattenmessung.** Kalter Bau je Worktree: `cargo build` 73 s, `cargo test --workspace
  --exclude lifeline-desktop --no-run` 93 s, `-p lifeline-desktop --no-run` 23 s, zusammen
  ~3 min. Ergebnis: 19 GB. Davon entfallen auf `deps` 15,6 GB, nämlich Testbinaries 8,8,
  Projekt-Crates 2,4 und Fremd-Crates 4,3. Dazu kommen `incremental` 2,5 GB und `build`
  0,6 GB. Teilbar wären nur die Fremd-Crates mit `build`, zusammen ~4,9 GB oder ~26 %.
- **Rahmen.** Die Platte ist zu 94 % belegt, 53 GB sind frei, es gibt 13 Worktrees. Der
  Nutzer hat das gemeinsame Ziel am 06.09.2026 wegen der Platte eingeführt: vorher 40–90 GB je
  Worktree, damals ohne Bereinigung.

## Goals / Non-Goals

**Goals:**
- Korrektheit hängt an einer einzigen, versionierten Stelle, die jeder Cargo-Aufruf im
  Checkout liest: Gate, Einzelaufrufe, rust-analyzer, Playwright über `cargo metadata`.
- Ein Rückfall auf ein fremdes Ziel wird im Gate laut, nicht still.

**Non-Goals:**
- Die globale `~/.cargo/config.toml` ändern. Sie gehört dem Nutzer, eine Korrektur des
  Kommentars wird nur vorgeschlagen.
- Fremde Worktrees oder deren Artefakte bereinigen.
- Die Debuginfo- oder Profilgrößen verkleinern. Das wäre der größere Plattenhebel: Die
  Testbinaries machen 8,8 GB aus. Es betrifft aber Debugging und CI und wird als eigenes
  Ticket vorgeschlagen.

## Decisions

### D1 — `.cargo/config.toml` im Repo mit `[build] target-dir = "target"`

Relative Pfade in einer Konfigurationsdatei löst Cargo gegen den Elternordner von `.cargo/`
auf, also gegen die Worktree-Wurzel. Die tiefere Datei schlägt die globale, die Umgebung
schlägt beide. Gemessen: `cargo metadata` meldet `<worktree>/target`, a/b geben A/B aus, der
Paralleltest am Projekt liefert A 6/6 und B 5/1.

Verworfene Alternativen:
- **`build.build-dir = "…/{workspace-path-hash}"`.** Das trennt nur die Zwischenartefakte. Das
  hochgezogene `<target-dir>/debug/lifeline-hub` bliebe geteilt (gemessen: eine Datei für a
  und b), und genau dieses Binary startet Playwright.
- **Hash der Projekt-Crates je Worktree salzen**, etwa über Profil-Overrides pro Paket. Einen
  stabilen, pro Worktree verschiedenen Hebel gibt es nicht. Das Endbinary bliebe trotzdem
  geteilt, und Altlasten sammelten sich ohne Aufräumweg im gemeinsamen Verzeichnis.
- **`CARGO_TARGET_DIR` über `mise.toml [env]`.** Das greift nur mit aktiviertem mise, also
  nicht zuverlässig in Hintergrund-Shells und Subagenten, und nicht in rust-analyzer. Die
  Übergangsschwäche (Vererbung vom Eltern-Checkout) wäre dieselbe.
- **`-Zchecksum-freshness`.** Instabil. Die Checkouts überschrieben sich weiter gegenseitig,
  und bei parallelen Läufen verschwänden Testbinaries mitten im Lauf.

Der Name bleibt `target`, weil CI, rust-cache, `ci.yml:182` und `artefakte.yml` diesen Pfad
erwarten und `.gitignore` ihn schon ausblendet.

### D2 — Plattenplatz: nur Ziel je Worktree, kein Vorbefüllen (Empfehlung, **Entscheidung am Checkpoint**)

- **Option A (empfohlen): nur D1.** Jeder Worktree baut beim ersten Mal kalt (~3 min, bis
  19 GB bei vollem Testbau). Der Platz wird mit dem Worktree frei, wenn der Harness ihn
  entfernt. Das ist heute nicht so: Das gemeinsame Verzeichnis wächst unabhängig von den
  Worktrees.
- **Option B: D1 plus Vorbefüllen per APFS-Klon.** Ein Skript klont beim ersten Lauf ein
  sauberes Basisziel per `cp -c -R`. Gemessen: 6 s, +13 MiB. Danach bereinigt es alle vier
  Workspace-Mitglieder mit `cargo clean -p lifeline-hub -p lifeline-desktop -p karten-katalog
  -p karten-service`. Gemessen: Der Nachbau für einen Testlauf dauerte 40 s und belegte
  +1,3 GB. Das spart ~4,9 GB und die Abhängigkeitskompilierung je Worktree. Kosten: ein
  zusätzliches Skript. Die Basis darf kein Ziel sein, in das gerade gebaut wird (halb gebaute
  Artefakte, vgl. den `openssl-sys`-Befund). Ohne Bereinigung **reproduziert der Klon genau
  den Fehler dieses Tickets** (gemessen: 6/6 mit fremdem Binary). Unter Linux/CI gibt es
  keinen COW-Klon.
- Die Empfehlung A folgt aus der Messung. Drei Viertel des Platzes gehören ohnehin dem Checkout
  und sind nicht teilbar. B lohnt sich erst, wenn viele Worktrees gleichzeitig voll gebaut
  werden. B ist jederzeit nachrüstbar, ohne D1 zu ändern.

### D3 — Prüfung im Gate als Bibliotheksfunktion vor Schritt 3, 4 und 7, nicht als 13. Schritt

`scripts/lib/bauziel.sh` ermittelt `target_directory` über `cargo metadata`. Dieselbe Quelle
verwenden schon Schritt 7 und `playwright.config.ts`, das hält die Pfadlogik von LFH-518
beisammen. Die Funktion vergleicht mit `$ROOT/target`:

- gleich → still weiter;
- abweichend und `CARGO_TARGET_DIR`/`CARGO_BUILD_TARGET_DIR` gesetzt → Ausgabe
  „ausdrücklich gewählt: <pfad>“, weiter;
- abweichend ohne Umgebungsvariable → Schritt rot mit Ziel und Hinweis auf `.cargo/config.toml`.

Aufgerufen wird sie am Anfang von `schritt_3`, `schritt_4` und `schritt_7`, also überall, wo
Cargo-Artefakte entstehen oder gestartet werden. Schritt 3 gehört dazu, weil
`check-typ-codegen.sh` den Test `openapi_spec_aktuell` baut und startet. Der kompiliert seinen
Pfad über `env!("CARGO_MANIFEST_DIR")` ein; ein fremdes Testbinary prüfte oder schriebe also die
`openapi.json` des anderen Worktrees. Schritt 3 liegt im `schnell`-Bündel, Schritt 4 nicht
(Review-Befund).

`PW_BINAER` bleibt eine eigene, schon vorhandene Übersteuerung für Schritt 7. Mit gesetztem
`PW_BINAER` wird nicht geprüft; ein relativer Wert wird gegen die Repo-Wurzel aufgelöst und
absolut an Playwright weitergereicht, damit Gate und Playwright dasselbe Binary nennen.

Der Selbsttest `scripts/bauziel.test.sh` spielt die Fälle mit Wegwerf-Crates durch. Die
„globale“ Konfiguration steht dabei als `.cargo/config.toml` über den Checkouts, nicht in einem
eigenen `CARGO_HOME`, das mise bei jedem Lauf neu einrichtete. Er läuft in Schritt 11 des
`schnell`-Bündels neben den anderen Skript-Selbsttests. Die Schrittzahl bleibt 12.

Warum kein eigener Schritt: Das kostet eine neue Nummer, `SCHRITTE`, Bündelzuordnung und
CI-Jobnamen (vgl. Memory „Ruleset pinnt Jobnamen“). Außerdem gehört die Prüfung als
Vorbedingung zu den Schritten, die das Ziel verwenden.

### D4 — Binary-Zeile in Gate und Playwright

`schritt_7` gibt vor dem Start `Backend-Binary: <pfad>` aus, `playwright.config.ts` ebenso
einmal beim Laden. Beide berechnen den Pfad schon heute gleich (`cargo metadata` bzw.
`PW_BINAER`). Mit der Zeile wird das im Log belegbar.

## Risks / Trade-offs

- [Plattenplatz: parallele Worktrees summieren sich] → Die Messwerte stehen in CLAUDE.md,
  Option B bleibt nachrüstbar, der Platz wird mit dem Entfernen des Worktrees frei. Das
  Debuginfo-Ticket wird vorgeschlagen.
- [Alte Worktrees unter einem Main-Checkout mit Datei erben dessen Ziel] → Das entspricht
  dem heutigen Zustand und ist keine Verschlechterung. Das skill-pflichtige Vorziehen auf
  `alpha` behebt es. Ein Satz dazu kommt in CLAUDE.md. Gemessen im Repro: Zwei Kinder ohne
  Datei gaben beide „Quellstand A“ aus.
- [Verzeichnisse namens `target` verschwanden früher „von fremder Hand“ (Memory
  LFH-359/373)] → Das war bei voller Platte und betraf Scratchpad und `~/.cache`. Im Worktree
  hielt ein Verzeichnis zuletzt. Fehlt das Binary, meldet das Gate das schon heute laut
  (`ÜBERSPRUNGEN`/„Backend-Binary fehlt“). Dieses Risiko entsteht nicht neu.
- [Erster Lauf je Worktree ~3 min länger] → Einmalig; inkrementelle Läufe sind danach
  schneller, weil niemand fremdes das Ziel umschreibt.

## Migration Plan

Mit dem Merge nach `alpha` trägt jeder Worktree, der auf `alpha` vorgezogen wird, die Datei.
Das gemeinsame `~/.cache/cargo-target` wird dann nur noch von Ständen ohne Datei genutzt. Ob
und wann es gelöscht wird, entscheidet der Nutzer. Rückweg: die Datei entfernen, dann gilt
wieder die globale Konfiguration.
