# Tasks

## 1. Regel

- [x] 1.1 Abschnitt „Bezeichner-Sprache (LFH-1312)“ nach design.md D5 (Wortlaut) in die
  Wurzel-`AGENTS.md` direkt nach „Wo die Regeln stehen“ einfügen. Jede Anforderung aus
  `specs/bezeichner-sprache/spec.md` ist darin wiederzufinden (Fachbegriff, Technikwort, Prosa,
  Grenzwerte, Pfadfinderregel samt Namensfamilie, alte Pläne überholt). Prüfen mit
  `wc -l AGENTS.md` (unter 200). Ergebnis 11.10.2026: 155 Zeilen; der Abschnitt nennt dazu
  `#[serde(rename)]` als ausgeschlossenen Umweg (D4) und die Rust-Testnamen als Prosa.
- [x] 1.2 Widersprüche suchen: `grep -rniE "bezeichner|identifier|englisch|deutsch"` über alle
  `AGENTS.md` und `.claude/skills/`. Eine gegenläufige Sprachvorgabe außerhalb des eingefrorenen
  Archivs `docs/superpowers/` wird angeglichen oder auf die Wurzelregel verwiesen. Ergebnis
  11.10.2026: keine Bereichs-`AGENTS.md` regelt die Sprache von Bezeichnern; in den Skills nur
  `clickup-task-anlegen` (Tasktitel deutsch), das ist Prosa und passt zur Regel.

## 2. Nachweis

- [x] 2.1 `openspec validate lfh-1312-bezeichner-sprache --strict` grün.
- [x] 2.2 `./scripts/check-all.sh --nur schnell` grün; der Archiv-Wächter (Schritt 13) sieht die
  Change noch als aktiv mit offenen Kästchen bis zum Archiv. Ergebnis 11.10.2026: In der
  Cloud-Sitzung fehlt `mise`, Schritte 1 und 2 brechen dort mit Exit 127 ab, unabhängig vom
  Stand. Die Schritte ohne Werkzeugbedarf, die diese Änderung berühren, sind samt Selbsttest grün:
  `check-openspec-archiv.sh`, `check-schreibweisen.sh`, `check-migrationen.sh`. Das volle
  Bündel läuft in der PR-CI.

## Workflow follow-up

- `/opsx:archive` im selben Branch (Spec `bezeichner-sprache` nach `openspec/specs/`), den
  Herleitungsverweis in der `AGENTS.md` auf den Archivpfad mit Datum setzen, dann erst der PR.
- ClickUp LFH-1312 auf `in review` setzen, nach dem Merge auf `shipped`.
