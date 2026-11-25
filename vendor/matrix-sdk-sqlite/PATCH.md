# Gepatchte Kopie von `matrix-sdk-sqlite` 0.20.0 (LLH-2094)

Quelle: crates.io, `matrix-sdk-sqlite` 0.20.0 (Upstream-Commit
`bc1c5da3fbd63c4e9eaa8679bb60c36a8ec58c3b`, Pfad `crates/matrix-sdk-sqlite`, siehe
`.cargo_vcs_info.json`). Eingebunden über `[patch.crates-io]` im Wurzel-`Cargo.toml`; kein
Mitglied des Workspace (`exclude`), damit Tests, rustfmt und Lints des Hubs die Fremdkopie nicht
anfassen.

## Was geändert ist

Genau eine Zeile in `Cargo.toml`: die Version von `rusqlite` unter
`[dependencies.rusqlite]` steht auf `0.42.0` statt `0.41.1`. `Cargo.toml.orig` (die
Upstream-Fassung mit Workspace-Erbe) bleibt unverändert; Cargo liest sie nicht. Entfernt ist
nur das `Cargo.lock` des Pakets, das Cargo für eine Pfadabhängigkeit ohnehin nicht liest.

## Warum

`rusqlite 0.41` verlangt `libsqlite3-sys 0.39`, sqlx 0.9 verlangt `libsqlite3-sys 0.40`. Beide
Crates tragen `links = "sqlite3"`, und Cargo erlaubt im Graphen nur eines davon: ohne Patch
scheitert die Auflösung. `rusqlite 0.42` nutzt `libsqlite3-sys 0.40`; `matrix-sdk-sqlite`
übersetzt damit ohne weitere Änderung. Ergebnis: eine eingebackene SQLite im Binary, die
sqlx und der Matrix-Schlüsselspeicher teilen.

## Prüfweg

- `tests/sqlite_version.rs`, `lockfile_hat_genau_ein_libsqlite3_sys`: im Lockfile steht genau
  ein `libsqlite3-sys`.
- `cargo tree -i libsqlite3-sys` nennt nur 0.40, mit `rusqlite 0.42` und `sqlx-sqlite` darüber.
- Die Kopie vergleichen: `diff -r ~/.cargo/registry/src/*/matrix-sdk-sqlite-0.20.0
  vendor/matrix-sdk-sqlite` zeigt nur die `rusqlite`-Zeile, `Cargo.lock`, `.cargo-ok` und
  diese Datei.

## Wann die Kopie fällt

Sobald eine Version von `matrix-sdk-sqlite` erscheint, die `rusqlite` mit derselben
`libsqlite3-sys` wie sqlx verlangt: `matrix-sdk` (fest gepinnt im `Cargo.toml`) auf diese
Version heben, den Eintrag unter `[patch.crates-io]` und `exclude` löschen, dieses Verzeichnis
löschen. Bleibt der Wächtertest grün, ist der Patch entbehrlich. Bei jedem Bump von
`matrix-sdk` ohne passendes Upstream-Release wird die Kopie aus der neuen Version neu gezogen
und dieselbe eine Zeile geändert, nie weitergepflegt.
