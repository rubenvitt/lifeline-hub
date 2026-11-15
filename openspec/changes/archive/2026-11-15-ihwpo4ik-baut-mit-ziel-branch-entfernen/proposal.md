# Proposal

Zunder: LLH-1899 (https://zunder.rubeen.dev/#/aufgabe/ihwpo4ikatqiq1kerjbxs4ht)

## Why

Der Pflicht-Check `Baut mit Ziel-Branch` (LLH-1849) hat seit dem 14.11.2026 den Merge-Fluss
blockiert. Nach einem Push auf `alpha` rechnete er für jeden fertigen PR rund 9 Minuten neu. Bei
sieben PRs ergab das eine Stunde Kette. Kein PR, dessen grüner Check aus diesem Neuberechnen
stammte, hat danach gemergt (20:54, 07:04, 08:20); es mergten nur PRs mit einem Check aus dem
PR-Ereignis. Seit LLH-1889 landen Testbrüche ohnehin auf `alpha`, und der Befund „alpha rot“
fängt sie. Ruben hat am 15.11.2026 entschieden, den Check abzuschaffen, und ihn im Ruleset
ausgetragen.

## What Changes

- **BREAKING (Ablauf):** `Baut mit Ziel-Branch` ist kein Pflicht-Check mehr. Pflicht sind nur noch
  `Schnellprüfungen`, `Migrationsnummern` und `ADR-Nummern` (Liste in `scripts/ruleset-pruefen.sh`).
- `ziel-branch-build.yml`, `ziel-branch-verteilen.yml`, `scripts/ziel-branch-build.sh` und der
  Selbsttest entfallen. Nach einem Merge auf `alpha` startet keine Kette von Kompilierläufen mehr.
- „Fertig = Auto-Merge an“ verliert seine Bedeutung für die CI; der Stau-Wächter liest Auto-Merge
  weiter für „Grün, aber nicht gemergt“.
- `check-all.sh --nur baut` bleibt als schneller lokaler Kompilierlauf (`cargo check`), ohne Check.
- Eine neue ADR ersetzt ADR-0030 und behält deren Regel zu „alpha rot“.

## Capabilities

### New Capabilities

(keine)

### Modified Capabilities

- `pr-pruefstufen`: Die Anforderungen zu `Baut mit Ziel-Branch` und zu „fertig“ entfallen; die
  Pflichtliste schrumpft auf drei.

## Impact

- Workflows: zwei entfallen; `stau-waechter.yml` unverändert.
- `merge-stau` bleibt unverändert: sein Szenario „Baut mit Ziel-Branch rechnet noch“ gilt
  sinngemäß für jeden laufenden Check (OpenSpec lässt ein Szenario einer geänderten Anforderung
  nicht weg; die Anforderung selbst ändert sich nicht).
- Skripte: `ruleset-pruefen.sh` (Liste), `stau-waechter.test.sh`, `check-all.sh`/`check-all.test.sh`
  (Kommentare, Schritt 11), `ci-stufen.test.sh` (Formfälle).
- Doku: `scripts/AGENTS.md`, Skill `dev-zunder-ausfuehren`, Kapitel 7 und 11, ADR-0030 → neue ADR.
- Ruleset: schon von Hand angepasst (15.11.2026, 08:36).
- LLH-1890 (gemeinsamer Lauf aller PRs) wird hinfällig.
