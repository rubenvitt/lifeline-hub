# Design

## Context

Warum, steht in proposal.md. Der Ausgangswert von 19 GB je Worktree stammt vom Mac des
Nutzers (30.09.2026, LFH-520). Die Messung hier lief am 03.10.2026 im Cloud-Container: Linux
x86_64, 4 Kerne, cargo 1.97.0, rund 29 GB freie Plattenzuteilung. Die Rohdaten und Skripte
stehen in `messprotokoll.txt`.

Unter Linux steht die Debuginfo im Binary selbst (`split-debuginfo = "off"`). Jedes der 129
ausführbaren Artefakte in `target/debug/deps` (Integrationstests, Unit-Test-Binaries, Server,
`karten-service`) linkt die Debuginfo aller Abhängigkeiten neu mit. Unter macOS bleibt sie in
den Objektdateien (`unpacked`), die Binaries sind dort kleiner. Deshalb sind die absoluten
Zahlen zwischen beiden Systemen nicht vergleichbar. Die Rangfolge der Varianten gilt aber
auf beiden.

Stand heute:
- `Cargo.toml` setzt kein `debug`, also gilt die Vorgabe `debug = true` (volle Debuginfo).
- `ci.yml` und `coverage.yml` setzen `CARGO_PROFILE_DEV_DEBUG=line-tables-only` als
  Umgebung. Die CI fährt also schon Variante B. Frühere Cloud-Sitzungen (LFH-666, LFH-688,
  LFH-734, LFH-747) mussten das per Hand setzen, weil die Platte volllief.

## Messung

Varianten (das Testprofil erbt vom Dev-Profil, `[profile.test]` braucht keinen eigenen Eintrag):

| | Einstellung |
| --- | --- |
| A | heute: `debug = true` überall |
| B | `[profile.dev] debug = "line-tables-only"` |
| C | `[profile.dev.package."*"] debug = false`, eigener Code voll |
| D | B und C zusammen |

**Ein Testbinary, kalt gebaut** (`cargo clean`, dann `cargo test -p lifeline-hub --test einsatz
--test <panik-probe> --no-run`):

| | `einsatz`-Binary | `target` gesamt | Bauzeit |
| --- | ---: | ---: | ---: |
| A | 501 MB | 5,0 GB | 319 s |
| B | 208 MB | 3,2 GB | 283 s |
| C | 302 MB | 3,7 GB | 287 s |
| D | **142 MB** | **2,5 GB** | **274 s** |

**Voller Bau** (`cargo build` und `cargo test --no-run`, Workspace ohne Hülle):

| | Ergebnis |
| --- | --- |
| A | Abbruch bei voller Platte nach ~29 GB, `deps` allein 23,6 GB. Hochgerechnet ~64 GB. |
| B | Abbruch bei voller Platte. Hochgerechnet ~27 GB allein für die Binaries. |
| C | Abbruch bei voller Platte. Hochgerechnet ~39 GB allein für die Binaries. |
| D | **21,6 GB**, davon 129 Binaries 15,7 GB. `cargo build` 276 s, `test --no-run` 215 s. |

Hochgerechnet ist jeweils 129 × die Größe des `einsatz`-Binarys. Nur D passt in die Zuteilung
einer Cloud-Sitzung.

Ein D-Binary besteht noch aus `.text` 44 MB, `.strtab` 39 MB, `.debug_*` 33 MB, Rest 25 MB.
Die verbliebene Debuginfo sind die Zeilentabellen des eigenen Codes, der monomorphisierten
Fremd-Generics und der Standardbibliothek. Mehr holt eine Debug-Einstellung nicht heraus.

**Backtrace** (Panik in einem `tokio::spawn`, `RUST_BACKTRACE=1`): In allen vier Varianten
nennen die Frames des eigenen Codes Datei und Zeile (`./tests/…rs:4:6`, `:9:34`). Auch der
`tokio`-Frame trägt in C und D seine Zeile (`core.rs:380:24`), weil generischer Fremdcode im
eigenen Crate instanziiert wird und dessen Einstellung erbt. Ohne Zeile bleiben in C und D nur
nicht-generische Funktionen der Abhängigkeiten.

## Goals / Non-Goals

**Goals:**
- Ein voller Bau passt in die Zuteilung einer Cloud-Sitzung und belegt lokal deutlich weniger.
- Die Einstellung steht an einer Stelle, `Cargo.toml`, und gilt für lokal, Cloud und CI gleich.

**Non-Goals:**
- `split-debuginfo` umstellen (Linux `unpacked`/`packed`). Das würde die Debuginfo aus den
  Binaries in gemeinsame `.dwo`-Dateien verlagern. Ob die Backtrace-Auflösung der
  Standardbibliothek das zuverlässig liest, ist hier nicht geprüft; D reicht für das Ziel.
- Fremd-Crates zwischen Worktrees teilen (LFH-520, D2 Option B bleibt zurückgestellt).
- Release-Profil, Desktop-Bundles, Testsemantik.

## Decisions

### D1 — Variante D: Zeilentabellen für den eigenen Code, keine Debuginfo für Abhängigkeiten (Empfehlung, **Entscheidung am Checkpoint**)

```toml
[profile.dev]
debug = "line-tables-only"
[profile.dev.package."*"]
debug = false
```

Begründung: D ist in jeder Messung am kleinsten (−72 % je Binary gegenüber A, −32 %
gegenüber dem heutigen CI-Stand B) und am schnellsten (−14 % Bauzeit gegenüber A). Die
Backtraces bleiben aussagekräftig, auch für Fremdcode, der durch eigene Generics läuft.
`package."*"` trifft nur Nicht-Workspace-Pakete. Die bestehenden `opt-level`-Einträge je
Paket bleiben unberührt, weil Cargo die Schlüssel je Paket einzeln zusammenführt.

Preis: lldb kann im eigenen Code Haltepunkte per Zeile setzen und schrittweise laufen, zeigt
aber keine Variablen. Für eine solche Sitzung holt man volle Debuginfo zurück, ohne die Datei
zu ändern:

```sh
CARGO_PROFILE_DEV_DEBUG=true cargo test --test <name>
```

Das gilt dann für den eigenen Code. Wer auch in Abhängigkeiten Variablen braucht, ergänzt
`--config 'profile.dev.package."*".debug=true'`. Der Kommentar in `Cargo.toml` nennt beides.

Verworfene Alternativen:
- **B allein** (heutiger CI-Stand): passt voll gebaut nicht in eine Cloud-Sitzung, Binaries
  47 % größer als D.
- **C allein**: behält lldb-Variablen im eigenen Code, ist aber größer als B, weil der
  eigene Code mit allen Generics den größten Teil der Debuginfo stellt.
- **Eigenes `[profile.test]`**: Das Testprofil erbt vom Dev-Profil. Ein abweichendes
  Testprofil würde die Abhängigkeiten zweimal bauen, sobald `cargo build` und `cargo test`
  nebeneinander laufen.

### D2 — Die Umgebungsvariable in der CI entfällt

`ci.yml` und `coverage.yml` setzen `CARGO_PROFILE_DEV_DEBUG=line-tables-only`. Mit D1 sagt
`Cargo.toml` dasselbe. Die Zeilen werden gestrichen, die Kommentare verweisen auf
`Cargo.toml`. So steht die Regel einmal. Die CI wechselt dabei von B auf D und bekommt
kleinere Binaries und einen kleineren rust-cache. Das Freiräumen der Runner-Toolchains in
`ci.yml` bleibt unverändert.

## Risks / Trade-offs

- [Die macOS-Zahlen sind nicht gemessen] → Die Rangfolge folgt aus der Mechanik: Weniger
  Debuginfo in den Objektdateien verkleinert dort `deps`, `incremental` und die Binaries.
  Eine Mac-Messung nach dem Merge belegt die Zahl dort (Befehl im PR-Text), ändert aber die
  Entscheidung nicht.
- [lldb ohne Variablen] → Umgebungsvariable wie in D1, im `Cargo.toml`-Kommentar genannt.
- [Erster Bau nach dem Merge ist kalt] → Einmalig je Worktree. Auch die CI baut einmal ohne
  Cache, weil sich die Fingerprints ändern.
- [Backtrace eines Panics tief in einer Abhängigkeit ohne Zeile] → Nur bei nicht-generischem
  Fremdcode. Die Panikmeldung selbst nennt Ort und Zeile über `#[track_caller]`, unabhängig
  von der Debuginfo.

## Migration Plan

Merge nach `alpha`. Rückweg: die beiden Einträge in `Cargo.toml` entfernen und die
Umgebungsvariable in der CI wieder setzen.
