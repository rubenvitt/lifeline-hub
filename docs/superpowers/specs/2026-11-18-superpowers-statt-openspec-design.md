# Superpowers statt OpenSpec — Entwurf

Stand: 18.11.2026 · Entscheidung Ruben (Sitzung vom 18.11.2026)

## Absicht

Ruben will wieder **Superpowers** als Standardwerkzeug zum Entwickeln. Der eigene Werkzeugsatz
aus OpenSpec (`/opsx:*`, Changes, Delta-Specs, Archivieren) fällt weg. Die Arbeit mit **Zunder**
bleibt unverändert: Board-Status, Claim, Branch, PR, `plan`, Kommentare. Superpowers wird im
Repo verankert, damit jeder Checkout und jede Cloud-Sitzung es mitbringt.

## Ziele

- Superpowers ist im Repo als Plugin eingetragen (`.claude/settings.json`).
- Die Skills `dev-zunder-ausfuehren` und `dev-zunder-orchestrieren` führen durch Superpowers
  statt durch `/opsx:*`; Zunder-Spur, Routen, Checkpoints und Fan-out bleiben.
- Wurzel-`AGENTS.md` beschreibt den neuen Ablauf; eine neue ADR löst ADR-0013 ab.
- Kein Werkzeug, Skript oder Gate-Schritt verlangt mehr OpenSpec.

## Nicht-Ziele

- Das Archiv `openspec/` löschen oder umziehen.
- Verweise auf Archiv-`design.md`s in Code, Doku, ADRs oder Migrationen umschreiben.
- Superpowers-Skills ins Repo kopieren oder anpassen.

## Anti-Ziele

- Ein Verweis zeigt ins Leere (vor allem aus Migrationen, die nie geändert werden dürfen).
- Der Freigabe-Halt vor der Umsetzung auf der Route `entwurf` geht verloren.
- Die Zunder-Spur (`open → in_progress → review → done`, `blocked` am Checkpoint) bricht.

## Ansätze

- **A — Werkzeug raus, Ablage einfrieren (gewählt).** Skills, Befehle, CLI und Gate-Wächter
  von OpenSpec entfallen; `openspec/` bleibt als schreibgeschütztes Archiv. Alle 962 Verweise
  bleiben gültig, der Diff bleibt klein.
- B — Alles löschen. Verweise brechen, auch in 26 unveränderlichen Migrationen.
- C — Archiv umziehen und Verweise umschreiben. Großer Diff, Konflikte mit offenen PRs, die
  Migrationen zeigen trotzdem auf den alten Pfad.

Plugin: **im Repo eintragen statt kopieren** (gewählt), damit Updates ankommen.

## Entwurf

**Plugin.** `.claude/settings.json` bekommt `extraKnownMarketplaces` mit
`superpowers-marketplace` (GitHub `obra/superpowers-marketplace`) und
`enabledPlugins: { "superpowers@superpowers-marketplace": true }`. *Meine Wahl:* dieser
Marktplatz führt die Version, die heute läuft (7.0.2), und folgt ihr ohne festgenagelten
Commit.

**Ablauf je Route** (`dev-zunder-ausfuehren`, Schritt 3):

| Route | bisher | neu |
| --- | --- | --- |
| `trivial` | direkt | direkt |
| `klar` | TDD | `superpowers:test-driven-development` |
| `bug-unklar` | Debugging | `superpowers:systematic-debugging` |
| `unklar` | `/opsx:explore` | `superpowers:brainstorming` (klären), danach neu routen |
| `entwurf` | `/opsx:propose` → Halt → `/opsx:apply` → `/opsx:archive` | `superpowers:brainstorming` → Design-Doc → **Halt** (`blocked`, Freigabe) → `superpowers:writing-plans` → `superpowers:subagent-driven-development` oder `executing-plans`, jede Aufgabe per TDD |

- **Ablage:** Design-Docs unter `docs/superpowers/specs/YYYY-MM-DD-<kurz>-<slug>-design.md`,
  Pläne unter `docs/superpowers/plans/`. `docs/superpowers/` ist damit wieder lebendig, nicht
  mehr eingefroren. Die Zunder-Aufgabe trägt den Plan-Pfad im Feld `plan`.
- **Kein Archivschritt mehr:** Design-Doc und Plan bleiben, wo sie liegen. „Ein Plan allein
  bekommt keinen PR“ bleibt: Entwurf, Plan und Umsetzung gehen zusammen in einen PR.
- **Entwurfs-Hoheit bleibt sinngemäß:** Workflows und Subagents liefern Scope-Map und
  Judge-Panel zu, schreiben aber kein Design-Doc und keinen Plan; das geschieht im Main-Loop,
  weil der Mensch dabei ist. Die Gründe E1–E3 für die Route `entwurf` bleiben.
- **Fähigkeits-Specs:** `openspec/specs/` bleibt lesbar (z. B. `bedien-begriffe`) und wird nicht
  mehr fortgeschrieben. Neue verbindliche Regeln stehen in der Bereichs-`AGENTS.md` oder einer
  ADR, die Begründung im Design-Doc.

**Was entfällt:** `.claude/skills/openspec-*`, `.claude/commands/opsx/`, `openspec/config.yaml`,
`scripts/check-openspec-archiv.sh` samt Selbsttest und Schritt in `check-all.sh`, der
OpenSpec-Eintrag in `mise.toml`. Die offene Change `neuigkeiten-versionshinweise` (gemergt,
nur ein Prüfkästchen offen) wandert nach `openspec/changes/archive/`.

**Mitzuziehen:** Wurzel-`AGENTS.md` (Abschnitt „Planung und Ausführung“), `scripts/AGENTS.md`,
`docs/architektur/AGENTS.md` und betroffene arc42-Kapitel, `review-pruefliste.md` (§7),
`workflow-bausteine.md`; neue ADR „Superpowers trägt den Änderungszyklus“ mit
`ersetzt: ADR-0013`, ADR-0013 auf `status: ersetzt`.

**Zunder:** Für diese Arbeit eine Aufgabe auf „Dev: Lifeline-Hub“ anlegen, damit Commit und PR
die `Zunder:`-Zeile tragen.

## Dem Umsetzenden überlassen

Genaue Formulierung der Skill-Abschnitte, Nummer der neuen ADR (nächste freie auf `alpha`),
welche arc42-Kapitel tatsächlich OpenSpec als Werkzeug beschreiben (nicht bloß verlinken).
