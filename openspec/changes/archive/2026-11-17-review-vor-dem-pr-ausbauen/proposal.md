# Proposal

## Why

Seit dem 12.11.2026 startet der Agent vor jedem PR selbst einen Review mit frischem Kontext,
lässt jeden Befund von einem zweiten Agenten gegenprüfen und weist das Ergebnis im PR nach
(Change `2026-11-12-review-vor-dem-pr`). Bei Tasks mit Subtasks läuft das als Workflow mit vier
Reviewern und je einem Gegenprüfer pro Befund. Am 17.11.2026 hat Ruben entschieden, den Schritt
wieder auszubauen: die letzten Sitzungen haben sehr viele Tokens verbraucht, und der Review nach
der Umsetzung ist der Teil, auf den er am ehesten verzichten kann.

## What Changes

- **Kein Pflicht-Review vor dem PR.** Schritt 4 von `dev-zunder-ausfuehren`, Phase 4 von
  `dev-zunder-orchestrieren` und `AGENTS.md` verlangen keinen Review mehr; der Agent startet
  keinen von sich aus.
- **Review nur auf Wunsch:** Verlangt der Mensch einen, prüft ein Agent mit frischem Kontext den
  Branch gegen die Prüfliste. Ohne Pflicht-Gegenprüfung je Befund und ohne Workflow-Skelett.
- **Die Prüfliste bleibt** als Nachschlagewerk für diesen Fall
  (`dev-zunder-ausfuehren/references/review-pruefliste.md`); die Pflicht, sie bei jedem
  durchgerutschten Fehler zu erweitern, entfällt.
- **Weg fallen:** der Abschnitt „Review vor dem PR“ samt Auftragsvorlagen und Verbleib-Tabelle,
  das Skelett „Review-find-verify“ in `workflow-bausteine.md`, der Abschnitt „Review“ der
  PR-Vorlage und die Don'ts dazu.

Nicht Teil dieser Change: kein Ersatz in der CI, keine GitHub-Action, CodeRabbit kommt nicht
zurück. Die Gates (`check-all.sh`) bleiben die einzige Prüfung vor dem PR.

## Capabilities

### New Capabilities

Keine.

### Modified Capabilities

- `review-vor-dem-pr`: Die sieben Anforderungen des Pflicht-Reviews entfallen; übrig bleibt eine
  Anforderung, dass ein Review nur auf Wunsch des Menschen läuft.

## Impact

- `.claude/skills/dev-zunder-ausfuehren/SKILL.md` (Agenten-Tabelle, Schritt 4, Abschnitt
  „Review vor dem PR“ → „Review auf Wunsch“, Don'ts)
- `.claude/skills/dev-zunder-ausfuehren/references/review-pruefliste.md` (Kopf)
- `.claude/skills/dev-zunder-orchestrieren/SKILL.md` (Einleitung, Phasentabelle, Phase 4, Don'ts)
  und `references/workflow-bausteine.md` (Skelett 3 entfällt)
- `AGENTS.md`, Abschnitt „Planung und Ausführung“
- `.github/pull_request_template.md` (Abschnitt „Review“ entfällt)
- Kein Projektcode, keine Gates, keine Migration. Keine Zunder-Aufgabe: kein `<kurz>`-Vorsatz,
  keine `Zunder:`-Zeile.
