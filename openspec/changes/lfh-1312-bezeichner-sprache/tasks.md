# Tasks

## 1. Regel

- [ ] 1.1 Abschnitt „Bezeichner-Sprache (LFH-1312)“ nach design.md D5 (Wortlaut) in die
  Wurzel-`AGENTS.md` direkt nach „Wo die Regeln stehen“ einfügen. Jede Anforderung aus
  `specs/bezeichner-sprache/spec.md` ist darin wiederzufinden (Fachbegriff, Technikwort, Prosa,
  Grenzwerte, Pfadfinderregel samt Namensfamilie, alte Pläne überholt). Prüfen mit
  `wc -l AGENTS.md` (unter 200).
- [ ] 1.2 Widersprüche suchen: `grep -rniE "bezeichner|identifier|englisch|deutsch"` über alle
  `AGENTS.md` und `.claude/skills/`. Eine gegenläufige Sprachvorgabe außerhalb des eingefrorenen
  Archivs `docs/superpowers/` wird angeglichen oder auf die Wurzelregel verwiesen. Ergebnis
  hier vermerken.

## 2. Nachweis

- [ ] 2.1 `openspec validate lfh-1312-bezeichner-sprache --strict` grün.
- [ ] 2.2 `./scripts/check-all.sh --nur schnell` grün; der Archiv-Wächter (Schritt 13) sieht die
  Change noch als aktiv mit offenen Kästchen bis zum Archiv.

## Workflow follow-up

- `/opsx:archive` im selben Branch (Spec `bezeichner-sprache` nach `openspec/specs/`), den
  Herleitungsverweis in der `AGENTS.md` auf den Archivpfad mit Datum setzen, dann erst der PR.
- ClickUp LFH-1312 auf `in review` setzen, nach dem Merge auf `shipped`.
