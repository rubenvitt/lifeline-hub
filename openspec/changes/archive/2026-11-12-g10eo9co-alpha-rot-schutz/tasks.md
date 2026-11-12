# Tasks

## 1. Kompilierlauf im Gate

- [x] 1.1 `scripts/check-all.sh`: Bündel `--nur baut` (cargo check Workspace mit allen Zielen, dasselbe mit Feature `dev-seeds`, `pnpm typecheck` im Frontend); Skriptkopf und `--help` nennen es. Prüfen: `scripts/check-all.test.sh` kennt das Bündel (erst rot, dann grün), `scripts/check-all.sh --nur baut` läuft lokal grün.
- [x] 1.2 Mutationsprobe: einen Testaufruf mit falscher Argumentzahl (wie am 12.11.) und einen falschen Typ im Frontend einbauen; `--nur baut` wird je rot. Ergebnis im Kommentar an der Zunder-Aufgabe.

## 2. Workflow `Baut mit Ziel-Branch`

- [x] 2.1 `.github/workflows/ziel-branch-build.yml` nach design.md D1/D2: PR-Ereignisse (nur fertig, kein Entwurf, kein Fork) und Push auf `alpha`/`beta`/`main` (nach dem Review: Push-Lauf verteilt nur, je fertigem PR ein eigener Lauf auf dessen Branch; nicht fertige mit vorhandenem Check auf `queued`). Kompilier-Job nur `contents: read`, keine Secrets, `rust-cache` ohne Speichern bei Push-Läufen; Melde-Job `checks: write`, checkt keinen PR-Code aus, schreibt nur, wenn PR-Kopf und Ziel-Branch noch dem gerechneten Stand entsprechen. Actions per SHA gepinnt. Prüfen: `actionlint` (falls vorhanden) und der Selbsttest aus 2.2.
- [x] 2.2 Form-Wächter für den neuen Workflow (in `scripts/ci-stufen.test.sh` oder eigenem Selbsttest, Schritt 11): Rechte je Job, kein Checkout von PR-Code im Melde-Job, `save-if` bei Push, Nebenläufigkeitsgruppen. Prüfen: erst rot gegen eine absichtlich falsche Form, dann grün.
- [x] 2.3 Melde-Logik als Skript (`scripts/ziel-branch-build.sh` oder in der Auswahl), mit Selbsttest gegen eine `gh`-Attrappe wie bei `stau-waechter.test.sh`: fertig/nicht fertig, Fork, veralteter Stand → „überholt“ (abgebrochen), Konflikt → rot mit Grund. Prüfen: Selbsttest grün, im Gate eingehängt.

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

- [x] 5.1 `scripts/check-all.sh --geaendert` grün (Ausgabe vollständig, kein `| tail`). Lokal ohne mise/WebKit: die betroffenen Schritte (Selbsttests aus 10/11, 13, 14, 16) grün; den vollen Lauf belegt die CI des PRs.
- [x] 5.2 Review vor dem PR nach `dev-zunder-ausfuehren`, „Review vor dem PR“; Verbleib der Befunde im PR.

## 6. Befunde aus dem Review vor dem PR

- [x] 6.1 Build-Check: PR-Code nie im Bereich eines Kanal-Branches (Push-Lauf `verteilen` startet je fertigem PR einen Lauf per `workflow_dispatch` auf dessen Branch; Entscheidung Ruben). Prüfen: Selbsttest Fall 1/1b, Formwächter F11, Mutation „kompilieren auch bei Push“ rot.
- [x] 6.2 Build-Check: Release-Commits (`[skip ci]`) machen ein Ergebnis nicht überholt; Entwürfe und nicht fertige PRs mit altem Grün warten auch beim PR-Ereignis; ein API-Fehler hält die übrigen PRs nicht auf; ohne `--locked`. Prüfen: Fälle 1c, 4b, 9b, Mutationen je rot.
- [x] 6.3 Formwächter und ADR-Prüfung: jeder rust-cache einzeln mit `save-if: false`, jede mise-Action ohne Cache, kein `actions/cache(/save)?@`. Prüfen: die drei Täuschungen des Reviewers sind je rot.
- [x] 6.4 Wächter: neu gestarteter roter Lauf und unlesbare Jobs machen den Zustand unbestimmt; unlesbare Checks, laufende CI und gescheiterter Push lassen den Hinweis offen; Auftrag haftet eine Stunde (Entscheidung Ruben); Label wird angelegt (Entscheidung Ruben); Entwurf mit Auftrag wird „wartet“; Hinweis ohne Kandidaten; Texte „doppelt“ und Log. Prüfen: Fälle 52–59, Mutationen je rot.
- [x] 6.6 Nach-Review des Behebungs-Commits: Einzellauf prüft PR und Ref (nie Kanal-Branch, nie Fork) und legt einen frischen Check an; Fehler beim „wartet“ und beim Lesen der Checks nicht still; nur „Workflow unbekannt“ gibt den Rat zum Einmergen; Entwurf mit Label wird `doppelt`; unlesbarer Halter verschiebt den Auftrag nicht; abgebrochene Checks laufen nicht; neue rote Jobs erneuern den Auftrag nicht; Log-Zeile; Doku. Prüfen: Fälle 1d–1f, 13–15, 60–63, Formprüfung F12, Mutationen je rot.
- [x] 6.5 Texte nachgezogen: Spec, Design, `scripts/AGENTS.md`, ADR-0030, Skill (Zuständiger öffnet sofort einen Entwurfs-PR mit Label, dann Abstimmung).

## Workflow follow-up

- `/opsx:archive` vor dem PR, im selben Branch.
- Nach dem Merge: Ruben trägt `Baut mit Ziel-Branch` im Ruleset 17017911 ein, sobald der Check an einem PR grün lief.
