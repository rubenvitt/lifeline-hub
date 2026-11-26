---
id: ADR-0108
titel: rusqlite kommt nur transitiv über die gepatchte Kopie von matrix-sdk-sqlite in den Server, für den Speicher des Matrix-SDK, nie für Daten des Hubs
status: vorgeschlagen
datum: 2026-11-26
gilt_fuer:
  - Cargo.toml
  - vendor/matrix-sdk-sqlite/**
  - tests/sqlite_version.rs
herleitung:
  - docs/superpowers/specs/2026-11-25-ntaizave-ausgang-matrix-design.md
  - vendor/matrix-sdk-sqlite/PATCH.md
  - https://zunder.rubeen.dev/#/aufgabe/ntaizaveziu8k9qzqu9tencu
---

# ADR-0108: rusqlite kommt nur transitiv über die gepatchte Kopie von matrix-sdk-sqlite in den Server, für den Speicher des Matrix-SDK, nie für Daten des Hubs

Nachtrag zu ADR-0002 („kein zweiter Datenbanktreiber, kein rusqlite im Server“) für den
Schlüsselspeicher des Matrix-Ausgangs (ADR-0107).

## Regeln

- MUST NOT: `rusqlite` steht als direkte Abhängigkeit in einem `Cargo.toml` des Workspace; es kommt
  nur über `matrix-sdk-sqlite` (Kopie unter `vendor/matrix-sdk-sqlite`, `[patch.crates-io]`).
- MUST NOT: Code des Hubs unter `src/` spricht `rusqlite` oder `matrix_sdk_sqlite` an; Daten des
  Hubs liegen nur in der Datenbank nach ADR-0002 und in der Cache-Datei.
- MUST: Im Lockfile steht genau ein `libsqlite3-sys`, das sqlx und `rusqlite` teilen
  (`tests/sqlite_version.rs`, `lockfile_hat_genau_ein_libsqlite3_sys`).
- MUST: Die Kopie weicht von Upstream nur in der `rusqlite`-Zeile ab, nach `PATCH.md`; sie fällt,
  sobald Upstream dieselbe `libsqlite3-sys` wie sqlx verlangt.

## Prüfung

```sh
verbiete '^rusqlite *=' Cargo.toml karten-service/Cargo.toml src-tauri/Cargo.toml push-relais/Cargo.toml
verbiete '(rusqlite|matrix_sdk_sqlite)::' 'src/**/*.rs'
verlange '^matrix-sdk-sqlite = \{ path = "vendor/matrix-sdk-sqlite" \}' Cargo.toml
verlange 'fn lockfile_hat_genau_ein_libsqlite3_sys' tests/sqlite_version.rs
test -f vendor/matrix-sdk-sqlite/PATCH.md
```

## Kontext

Der verschlüsselte Ausgang per Matrix braucht einen dauerhaften Speicher für Olm- und
Megolm-Sitzungen; den liefert `matrix-sdk-sqlite` über `rusqlite`. Ein eigener `CryptoStore` über
sqlx wären Dutzende Methoden, deren Speicherformat Sache des SDK ist. Cargo erlaubt nur ein Crate
mit `links = "sqlite3"`, deshalb hebt die Kopie `rusqlite` auf die `libsqlite3-sys` von sqlx.

## Konsequenzen

Der Server enthält einen zweiten SQLite-Zugriffsweg, aber nur für Dateien des SDK unter
`matrix/`; die Hub-Datenbank bleibt bei sqlx. Ein Bump von `libsqlite3-sys` oder `matrix-sdk`
zieht die Kopie mit (`PATCH.md`), und eine SQLite-Lücke trifft beide Wege zugleich.
