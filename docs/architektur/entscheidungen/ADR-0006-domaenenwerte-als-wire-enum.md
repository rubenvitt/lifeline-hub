---
id: ADR-0006
titel: Domänenwerte mit fester Wertemenge sind Rust-Enums aus wire_enum!
status: akzeptiert
datum: 2026-07-10
gilt_fuer:
  - src/**/*.rs
  - tests/enum_wire_kontrakt.rs
herleitung:
  - docs/superpowers/plans/2026-07-10-lfh126-domaenen-newtypes.md
---

# ADR-0006: Domänenwerte mit fester Wertemenge sind Rust-Enums aus wire_enum!

## Regeln

- SHOULD: Ein Rollen-, Status- oder Artwert mit fester Wertemenge ist im Server ein Enum, nicht
  ein `String`, von der Zeile (`FromRow`) bis zur Antwort.
- MUST: Ein neues feldloses Enum mit Wire-Wert wird mit `wire_enum!` (`src/wire_enum.rs`)
  deklariert; serde, OpenAPI-Schema, `as_str()` und `parse()` lesen dasselbe Literal.
- MUST NOT: kein handgeschriebenes `fn as_str` unter `src/` außerhalb von `src/wire_enum.rs`; der
  Bestand an Enums mit `#[serde(rename_all …)]` ohne Makro (15 am 23.10.2026) wächst nicht.
- MUST: Jede neue Variante steht im Enum-Wire-Kontrakt (`tests/enum_wire_kontrakt.rs`); dessen
  Inventar-Guard findet Enums über den Text `pub enum <Name>`. Wire-Regeln und
  Schema-Anker: `src/AGENTS.md`, „Backend↔Frontend — Typ-Codegen“.
- SHOULD: Request-DTOs nehmen den Wert als `String` und führen ihn im Handler per
  `Enum::parse` in das Enum über; ein unbekannter Wert ist 400 (`src/AGENTS.md`,
  „Statuscode-Konvention“).
- MUST NOT: Wire-Werte nicht umbenennen (Wurzel-`AGENTS.md`, „Bezeichner-Sprache“,
  Grenzwerte).

## Prüfung

```sh
verlange '^macro_rules! wire_enum' src/wire_enum.rs
verbiete 'fn as_str\(' 'src/**/*.rs' ':(exclude)src/wire_enum.rs'
verlange 'Inventar-Guard' tests/enum_wire_kontrakt.rs
# Bestand ohne Makro darf nur schrumpfen.
# Gezählt werden nur Enums: ein Struct mit `rename_all` (etwa für fremdes JSON) bleibt erlaubt.
test "$(git grep --untracked -h -A4 'serde\(rename_all' -- ':(glob)src/**/*.rs' | awk '/serde\(rename_all/ { o = 1; next } o && /^[[:space:]]*(pub(\([a-z]+\))? )?enum / { n++; o = 0; next } o && /^[[:space:]]*(pub(\([a-z]+\))? )?struct / { o = 0 } END { print n + 0 }')" -le 15
```

## Kontext

Rollen, Status und Arten liefen als freie Strings durch Handler, Repos und Antworten; ein
Tippfehler wurde zum Datenbankfehler (500) oder zu einem stillen Wire-Drift. LFH-126 zog die
Werte auf Enums, `wire_enum!` beseitigte danach die Abschrift zwischen serde-Attribut und
`as_str()`.

## Konsequenzen

Ungültige Werte scheitern am Rand mit einem sprechenden Fehler, und die OpenAPI-Union entsteht aus
derselben Liste wie das Enum. Eine neue Variante berührt Enum, Kontrakttest und die generierten
Typen in einem Commit. Ein Enum mit Feldern fällt nicht unter das Makro.
