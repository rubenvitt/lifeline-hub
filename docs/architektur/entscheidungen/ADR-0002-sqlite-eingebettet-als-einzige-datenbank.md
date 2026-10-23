---
id: ADR-0002
titel: SQLite ist eingebettet die einzige Datenbank, angesprochen über sqlx
status: akzeptiert
datum: 2026-05-23
gilt_fuer:
  - Cargo.toml
  - src/db.rs
  - src/db/**
  - src/cache_db.rs
  - src/tx.rs
  - migrations/**
herleitung:
  - docs/superpowers/specs/2026-05-23-fundament-etb-kern-design.md
  - docs/betrieb/packaging.md
---

# ADR-0002: SQLite ist eingebettet die einzige Datenbank, angesprochen über sqlx

## Regeln

- MUST: Daten liegen in SQLite im WAL-Modus (`src/db.rs`), angesprochen über `sqlx` mit dem
  Treiber `sqlite`; SQLite wird über `libsqlite3-sys` mit Feature `bundled` einkompiliert.
- MUST NOT: kein zweiter Datenbanktreiber und kein ORM (Postgres, MySQL, `sqlx`-Feature
  `any`, diesel, rusqlite, sea-orm) im Server, in der Hülle oder im Karten-Service.
- MUST: Das Schema ändert sich nur über Dateien in `migrations/`, eingespielt mit
  `sqlx::migrate!`; Vergabe der Nummern: Wurzel-`AGENTS.md`, „Backend — Migrationsvergabe“.
- SHOULD: Externe Nachschlage-Caches schreiben in die eigene Cache-Datei (`src/cache_db.rs`),
  nicht in die operative Datenbank.
- SHOULD: Eine schreibende Transaktion, die zuerst liest, läuft über `write_retry!`
  (`src/tx.rs`, `BEGIN IMMEDIATE` mit Busy-Retry).
- MUST: Ein Bump von `libsqlite3-sys` zieht `tests/sqlite_version.rs` und den Abschnitt
  „Eingebettetes SQLite“ in `docs/betrieb/packaging.md` mit.

## Prüfung

```sh
verlange '^libsqlite3-sys = .*"bundled"' Cargo.toml
verlange '^sqlx = .*"sqlite"' Cargo.toml
verbiete '^sqlx = .*"(postgres|mysql|any)"' Cargo.toml karten-service/Cargo.toml src-tauri/Cargo.toml
verbiete '^(diesel|rusqlite|sea-orm|tokio-postgres|postgres|mysql_async|mongodb|redis) *=' Cargo.toml karten-service/Cargo.toml src-tauri/Cargo.toml
verlange 'sqlx::migrate!\("\./migrations"\)' src/db.rs
test -f tests/sqlite_version.rs
```

## Kontext

Das Fundament-Design sucht eine Datenbank, die eine Freiwilligenorganisation ohne Administration
betreibt: eine Datei, die mit dem Binary kommt und sich durch Kopieren sichern lässt. Die Last
eines Einsatzes (dort angenommen 5–50 gleichzeitige Nutzer) trägt SQLite. `bundled` hält die
Version reproduzierbar und das Binary unabhängig vom Zielsystem.

## Konsequenzen

Betrieb und Sicherung bleiben einfach (eine Datei, `VACUUM INTO`). SQLite hat genau einen
Schreiber; Lese-dann-Schreib-Transaktionen brauchen deshalb die Disziplin aus `src/tx.rs`. Eine
SQLite-Lücke schließt nur ein Rebuild mit Crate-Bump, kein System-Update
([Risiken](../11-risiken-und-technische-schulden.md)). Der Server läuft als eine Instanz je
Datenbankdatei.
