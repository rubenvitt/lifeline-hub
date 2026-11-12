# Tasks

## 1. Kompilierlauf im Gate

- [x] 1.1 `scripts/check-all.sh`: Bündel `--nur baut` (cargo check Workspace mit allen Zielen, dasselbe mit Feature `dev-seeds`, `pnpm typecheck` im Frontend); Skriptkopf und `--help` nennen es. Prüfen: `scripts/check-all.test.sh` kennt das Bündel (erst rot, dann grün), `scripts/check-all.sh --nur baut` läuft lokal grün.
- [x] 1.2 Mutationsprobe: einen Testaufruf mit falscher Argumentzahl (wie am 12.11.) und einen falschen Typ im Frontend einbauen; `--nur baut` wird je rot. Ergebnis im Kommentar an der Zunder-Aufgabe.

## 2. Workflow `Baut mit Ziel-Branch`

- [x] 2.1 `.github/workflows/ziel-branch-build.yml` nach design.md D1/D2: PR-Ereignisse (nur fertig, kein Entwurf, kein Fork) und Push auf `alpha`/`beta`/`main` (Auswahl → Matrix je fertigem PR → Melden; nicht fertige mit vorhandenem Check auf `queued`). Kompilier-Job nur `contents: read`, keine Secrets, `rust-cache` ohne Speichern bei Push-Läufen; Melde-Job `checks: write`, checkt keinen PR-Code aus, schreibt nur, wenn PR-Kopf und Ziel-Branch noch dem gerechneten Stand entsprechen. Actions per SHA gepinnt. Prüfen: `actionlint` (falls vorhanden) und der Selbsttest aus 2.2.
- [x] 2.2 Form-Wächter für den neuen Workflow (in `scripts/ci-stufen.test.sh` oder eigenem Selbsttest, Schritt 11): Rechte je Job, kein Checkout von PR-Code im Melde-Job, `save-if` bei Push, Nebenläufigkeitsgruppen. Prüfen: erst rot gegen eine absichtlich falsche Form, dann grün.
- [x] 2.3 Melde-Logik als Skript (`scripts/ziel-branch-build.sh` oder in der Auswahl), mit Selbsttest gegen eine `gh`-Attrappe wie bei `stau-waechter.test.sh`: fertig/nicht fertig, Fork, veralteter Stand → nichts schreiben, Konflikt → rot mit Grund. Prüfen: Selbsttest grün, im Gate eingehängt.

## 3. Stau-Wächter „alpha rot“ (TDD in `scripts/stau-waechter.test.sh`)

- [x] 3.1 `hinweis_lesen`/`hinweis_setzen` nehmen die Marke als Parameter (design.md D6); bestehende Fälle bleiben grün. Prüfen: Selbsttest grün, neuer Fall „zwei Marken an einem PR stören sich nicht“.
- [x] 3.2 Zustand von `alpha` aus den CI-Läufen (D4): rot/grün/läuft, Release-Fehler zählt nicht, Spanne letzter grüner → erster roter Lauf, Ursache-PRs. Prüfen: Selbsttest-Fälle zu den drei Szenarien der Spec-Anforderung „Der Zustand von alpha wird nach jedem CI-Lauf bewertet“.
- [x] 3.3 Zuständigkeit (D5): Label `alpha-rot`, ältester Kandidat, Rotation je Stunde, Ausschlüsse (Entwurf, Fork, Dependabot), zwei Fix-PRs. Prüfen: Selbsttest-Fälle zu den vier Szenarien von „Bei rotem alpha ist genau ein PR zuständig“.
- [x] 3.4 Hinweise (Arten `zustaendig`, `wartet`, `doppelt`), Texte mit Ursache, fehlgeschlagenen Jobs und dem Rat zum Neustart bei Flakes; gleicher Befund schreibt nichts. Prüfen: Selbsttest-Fälle zu „Bei rotem alpha trägt jeder offene PR einen Hinweis dazu“.
- [x] 3.5 Nach dem Fix (D7): `behoben` bzw. `basis_hineinmergen` und `angestossen` bei rotem jüngstem Lauf, nichts bei Konflikt oder schon enthaltenem Stand. Prüfen: Selbsttest-Fälle zu „Nach dem Fix bekommen rote PRs alpha hineingemergt“, Grenzen aus „Der Wächter schreibt nur per Fast-Forward“ weiter grün.
- [x] 3.6 `.github/workflows/stau-waechter.yml`: Auslöser `workflow_run` (CI, `completed`, `alpha`), `actions: read`; Skriptkopf und Workflow-Kopf nachgezogen. Prüfen: `--nur-zeigen alle` lokal gegen das echte Repo nennt plausible Befunde ohne zu schreiben.

## 4. Regeln, Anleitungen, Doku

- [x] 4.1 `scripts/AGENTS.md`: Stau-Wächter (neuer Befund, zweite Marke) und PR-Prüfstufen (`Baut mit Ziel-Branch`, Bündel `baut`). Prüfen: Prettier/Gate-Schritt grün, Verweise per grep.
- [x] 4.2 `.claude/skills/dev-zunder-ausfuehren/SKILL.md`: Abschnitt „alpha rot“ (zuständig → Fix-PR von `alpha` mit Label `alpha-rot`, sonst nichts reparieren, auf den Merge des Wächters warten; Flake → Job neu starten). Prüfen: Abschnitt gelesen gegen Spec-Szenarien.
- [x] 4.3 ADR (nächste freie Nummer auf `alpha`, vorher `git fetch origin alpha`) „Ein fertiger PR baut mit dem aktuellen Ziel-Branch; bei rotem alpha ist genau ein PR zuständig“, `gilt_fuer` auf die neuen Workflows und Skripte, `herleitung` auf das Archiv dieser Change. Prüfen: `scripts/check-architektur.sh` und `scripts/check-adr-nummern.sh` grün.

## 5. Abschluss

- [ ] 5.1 `scripts/check-all.sh --geaendert` grün (Ausgabe vollständig, kein `| tail`).
- [ ] 5.2 Review vor dem PR nach `dev-zunder-ausfuehren`, „Review vor dem PR“; Verbleib der Befunde im PR.

## Workflow follow-up

- `/opsx:archive` vor dem PR, im selben Branch.
- Nach dem Merge: Ruben trägt `Baut mit Ziel-Branch` im Ruleset 17017911 ein, sobald der Check an einem PR grün lief.
