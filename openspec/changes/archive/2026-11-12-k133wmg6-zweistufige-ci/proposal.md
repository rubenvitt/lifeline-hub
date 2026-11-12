# Proposal

Zunder: https://zunder.rubeen.dev/#/aufgabe/k133wmg628slx2hgcw6t7mdk (LLH-1662)

## Why

Ein voller PR-Lauf belegt rund zwölf Jobs und dauert wegen der e2e-Anteile etwa eine Stunde, und
jeder Push startet ihn neu. Gemessen am 12.11.2026 (die letzten 100 PR-Läufe von `ci.yml`,
11.11. 10:17 bis 12.11. 07:50 UTC, 19 Branches): 59 abgebrochen, im Schnitt nach 19 Minuten,
7 rot, 25 grün, 9 liefen noch. Das sind rund fünf Läufe je PR, und sechs von zehn waren
umsonst. Die Grenze ist nicht Geld (das Repository ist öffentlich), sondern die Zahl
gleichzeitiger Jobs: abgebrochene e2e-Läufe halten Runner fest, auf die andere PRs warten.

Die teure Stufe braucht ein PR erst, wenn er fertig ist. Bis dahin reichen die
Schnellprüfungen und die Unit-Suiten.

## What Changes

- **Zwei Stufen je PR:** Bei jedem Push laufen Schnellprüfungen, Rust- und Frontend-Suite wie
  heute, nur für die betroffenen Bereiche (`scripts/bereiche.sh`). e2e-Binary und die Anteile
  `e2e 1/4` bis `4/4` laufen erst, wenn der PR als fertig markiert ist.
- **Fertig heißt:** Auto-Merge ist eingeschaltet oder das Label `e2e` ist gesetzt. Beim
  Einschalten startet die zweite Stufe für den aktuellen Kopf-Commit, und danach bei jedem
  weiteren Push, solange eines davon gilt. Wird beides zurückgenommen, bricht ein laufender
  e2e-Lauf ab.
- **Vor der zweiten Stufe fehlen die e2e-Pflicht-Checks** (`e2e-Binary`, `e2e 1/4` bis
  `4/4`), statt leer grün zu melden. Der PR ist ohne sie nicht mergebar, und Auto-Merge wartet
  genau darauf. Das Ruleset 17017911 bleibt unverändert.
- **Push-Läufe auf `alpha`, `beta` und `main` prüfen weiter voll**, e2e eingeschlossen; der
  Release wartet wie bisher auf alle Suiten.
- **Umnummerierung je Suite (Anschluss an LLH-1660):** Die Übernahme nach einem reinen
  Umnummerierungs-Commit entscheidet je Suite. Die Frontend-Suite wird übernommen, wenn sie am
  Vorgänger grün war; die e2e-Suite in der zweiten Stufe, wenn sie dort grün war. Ein Vorgänger
  ohne e2e-Lauf lässt die Frontend-Übernahme nicht mehr scheitern.
- **Stau-Wächter (Anschluss an LLH-1660):** Ist Auto-Merge an, trägt der Kopf-Commit aber nach
  der Wartezeit keinen e2e-Lauf, steht das als Hinweis am PR.
- **Messung:** `scripts/ci-messung.sh` zählt Läufe und Jobs je PR über einen Zeitraum, damit
  vorher und nachher gleich gemessen werden.
- Nicht Teil: mehr e2e-Anteile, eine eigene Merge Queue (LLH-1663), Änderungen am Ruleset.

## Capabilities

### New Capabilities

- `pr-pruefstufen`: Legt fest, welche Suiten auf einem offenen PR wann laufen, was einen PR
  als fertig markiert, wie die Pflicht-Checks der zweiten Stufe vorher aussehen und dass
  Kanal-Branches immer voll geprüft werden.

### Modified Capabilities

- `migrationsvergabe`: „Kollidierende PRs werden automatisch umnummeriert“ übernimmt Frontend-
  und e2e-Suite künftig je Suite, nicht nur gemeinsam.
- `merge-stau`: neue Anforderung, dass ein PR mit Auto-Merge ohne e2e-Lauf auf dem Kopf-Commit
  als Hinweis am PR steht. Die Fähigkeit entsteht mit PR #1289 (LLH-1660). Diese Change setzt
  deren Merge voraus.

## Impact

- **CI:** neu `.github/workflows/e2e.yml` (zweite Stufe für PRs, von `ci.yml` für Push-Läufe
  aufgerufen); geändert `.github/workflows/ci.yml` (e2e-Jobs nur noch über den Aufruf bei Push,
  Bericht nur Vitest im PR, Job `aenderungen` in ein Skript gezogen, das beide Workflows
  teilen).
- **Skripte:** neu `scripts/ci-messung.sh` samt Selbsttest; geändert
  `scripts/nur-umnummeriert.sh` (Prüfung je Suite) und `scripts/stau-waechter.sh` (Befund
  „e2e fehlt“) samt Selbsttests, alle aus PR #1289.
- **Regeln und Doku:** `scripts/AGENTS.md` (Abschnitt zu den betroffenen Suiten),
  `docs/architektur/07-verteilungssicht.md` (Release-Kette), Hinweis für Sitzungen, wie sie
  e2e-Rückmeldung bekommen (Label `e2e` oder lokal).
- **Arbeitsweise:** Eine Sitzung bekommt e2e-Ergebnisse auf GitHub nur noch nach Auto-Merge oder
  mit Label `e2e`. Rote e2e-Anteile fallen später auf, im Tausch gegen weniger Stau.
- **Reihenfolge:** Umsetzung erst nach dem Merge von PR #1289; Zunder hält das als `blocked_by`
  fest.
- Kein Anwendungscode, keine Migration, keine sichtbare Wirkung in der App.
