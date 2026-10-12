# Proposal

## Why

Ruben hat am 12.10.2026 von ClickUp auf Zunder (`https://zunder.rubeen.dev`) umgestellt; ClickUp
wird gekündigt. Die Skills, die Spec `entwurfs-hoheit` und die PR-Vorlage schreiben aber noch
ClickUp-Werkzeuge, ClickUp-Status (`in design`, `ready for development`, `shipped` …) und
sprechende Kennungen `LFH-<n>` vor, die Zunder nicht kennt.

## What Changes

- Skills umbenannt und auf Zunder umgeschrieben: `zunder-task-anlegen`, `dev-zunder-ausfuehren`,
  `dev-zunder-orchestrieren`. Reservierung über `claim_task`/`release_task`, Ergebnisse in
  `branch`, `pr_url`, `plan`, Zerlegung über `decompose_task`, Notizen statt Kommentaren in der
  Beschreibung, `dropped` statt Löschen.
- Ein zentraler Abschnitt „Zunder“ in `AGENTS.md` (IDs, Status-Codes, Kennungen); die
  Status-Spur steht nur in `dev-zunder-ausfuehren`.
- Neue Kennung: Branch `<typ>/<kurz>-<slug>` und Change-Name `<kurz>-<slug>` mit den ersten 8
  Hex-Zeichen der UUID; Commit-Body und PR tragen `Zunder: https://zunder.rubeen.dev/#/aufgabe/<uuid>`.
  Alte `LFH-<n>` bleiben historisch gültig.
- Status-Abbildung: Arbeit `in_progress`, Freigabe-Checkpoint `blocked`, PR offen `review`,
  gemergt `done`, verworfen `dropped`.
- Spec `entwurfs-hoheit`: Skill-Name, Change-Name und Status an Zunder angepasst.

## Capabilities

### New Capabilities

_keine_

### Modified Capabilities

- `entwurfs-hoheit`: Skill `dev-zunder-ausfuehren`, Change-Name `<kurz>-<slug>`, Status `blocked`
  am Freigabe-Checkpoint und `in_progress` danach.

## Impact

- `.claude/skills/` (drei Skills umbenannt), `AGENTS.md`, `.github/pull_request_template.md`,
  `.github/workflows/release.yml` (nur Hinweistext), `release.config.mjs` (KI-Vorlage, Kommentar),
  `scripts/release/pr-kommentare.mjs` (Kommentar)
- `openspec/specs/entwurfs-hoheit/spec.md` (über `/opsx:archive`)
- Kein Projektcode, keine neue Zunder-Integration in der CI.
