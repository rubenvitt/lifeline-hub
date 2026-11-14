# Proposal

## Why

Am 14.11.2026 standen rund zehn fertige PRs rot und mergten nicht (LLH-1889). Die PRs hatten keinen Fehler. Nach jedem Merge in `alpha` brach „Baut mit Ziel-Branch“ den laufenden Kompilierlauf jedes fertigen PRs ab und schloss Checks als `cancelled`. Bei Merges im Abstand unter 20 Minuten kam kaum ein Lauf durch. Der Check ist Pflicht im Ruleset, also mergte Auto-Merge nichts, und die PRs stauten sich.

## What Changes

- Ein neuer Ziel-Stand bricht keinen laufenden Lauf mehr ab. Je PR rechnet höchstens ein Lauf, ein zweiter wartet, und ein später kommender ersetzt den wartenden. So bündeln sich mehrere Merges kurz hintereinander auf den jüngsten Stand.
- Kein Lauf schließt mehr einen Check `Baut mit Ziel-Branch` als abgebrochen, weil er überholt oder übernommen wurde. Ein überholtes Ergebnis lässt den Check auf „läuft“, bis der jüngere Check zum neuen Stand ihn ablöst. Kommt binnen 5 Minuten keiner, wird er rot mit „neu starten“. Ist ein Stand auf dem Kopf schon gerechnet, rechnet er nicht noch einmal.
- Auch die Push-Läufe (`verteilen`) brechen sich nicht mehr gegenseitig ab.
- Der Stau-Wächter bekommt keine neue Befundart. Sein Selbsttest hält fest, dass ein laufender `Baut mit Ziel-Branch` „grün, nicht gemergt“ verhindert. Die Doku beschreibt den neuen Ablauf.
- Nicht Teil dieser Change ist der gemeinsame Kompilierlauf für alle fertigen PRs (Punkt 3 der Aufgabe). Er wird in LLH-1890 abgewogen.

## Capabilities

### New Capabilities

(keine)

### Modified Capabilities

- `pr-pruefstufen`: Zwei neue Anforderungen für den Check `Baut mit Ziel-Branch`. Ein überholter Lauf macht keinen PR rot, und Läufe je PR werden auf den jüngsten Stand gebündelt.

## Impact

- `.github/workflows/ziel-branch-build.yml` (Nebenläufigkeit, Kopfkommentar)
- `scripts/ziel-branch-build.sh` (`einzellauf`, `melden`) und `scripts/ziel-branch-build.test.sh`
- `scripts/stau-waechter.test.sh` (Absicherung), `scripts/AGENTS.md` („Baut mit Ziel-Branch“)
- Der Pflicht-Check behält Namen und Zusicherung. Am Ruleset 17017911 ändert sich nichts.
