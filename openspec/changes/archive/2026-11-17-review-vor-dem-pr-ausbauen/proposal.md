# Proposal

## Why

Seit dem 12.11.2026 startet der Agent vor jedem PR selbst einen Review mit frischem Kontext,
lässt jeden Befund von einem zweiten Agenten gegenprüfen und weist das Ergebnis im PR nach
(Change `2026-11-12-review-vor-dem-pr`). Bei Tasks mit Subtasks läuft das als Workflow mit vier
Reviewern und je einem Gegenprüfer pro Befund. Am 17.11.2026 hat Ruben entschieden, den Schritt
wieder auszubauen: die letzten Sitzungen haben sehr viele Tokens verbraucht, und der Review nach
der Umsetzung ist der Teil, auf den er am ehesten verzichten kann.

## What Changes

Nachgeschärft am selben Tag: kein Review auf Zuruf, sondern nach Ermessen des Agenten, und dazu
das Warten ohne Wecken. Eine Auswertung von 30 Sitzungen (09. bis 16.11.2026) zeigte, dass 58 %
der Kosten im erneuten Lesen des Kontexts liegen: Sitzungen wachsen auf 400.000 bis 800.000
Tokens, und jede Runde, auch ein „ich warte“ oder eine Wächter-Zwischenmeldung, liest alles neu.
Der Review-Fix-Durchgang einer Sitzung kostete allein 22 % von ihr.

- **Review nach Ermessen:** Der Agent entscheidet am Diff, ob ein Review nötig ist (feste
  Anlässe: Berechtigung, Eingaben von außen, Datenverlust, Offline/Sitzung/Live, Größe), und
  startet ihn dann selbst. Ein Agent mit frischem Kontext, kein Workflow, keine Gegenprüfer; die
  Befunde prüft der Main-Loop selbst an der Stelle. Im PR eine Zeile unter „Geprüft“.
- **Warten ohne Wecken:** Gates in einem Aufruf (Portionen hintereinander im selben Aufruf), kein
  Monitor mit Zwischenständen, keine Wecker zum Nachsehen, eine Meldung ohne Handlungsbedarf
  ohne Werkzeugaufruf beenden. Das PR-Abo bleibt bis zum Merge (Konflikte und Stau-Wächter);
  weckt der Merge, nur `done`, `release_task` und die Abschlussmeldung.
- **Die Prüfliste bleibt** für den Review nach Ermessen; die Pflicht, sie bei jedem
  durchgerutschten Fehler zu erweitern, entfällt.
- **Weg fallen:** der Abschnitt „Review vor dem PR“ samt Auftragsvorlagen, Gegenprüfung und
  Verbleib-Tabelle, das Skelett „Review-find-verify“ in `workflow-bausteine.md` und der Abschnitt
  „Review“ der PR-Vorlage.

Erwogen und verworfen (mit Ruben, 17.11.2026): das PR-Abo nach grüner CI beenden, damit der Merge
nicht weckt. Dann erreichten Konflikte und „alpha rot“ die Sitzung nicht mehr; das Wecken beim
Merge ist der kleinere Preis. Ebenso eine Sammelrunde für `done`.

Nicht Teil dieser Change: kein Ersatz in der CI, keine GitHub-Action, CodeRabbit kommt nicht
zurück.

## Capabilities

### New Capabilities

- `warten-ohne-wecken`: wie eine Sitzung auf Gates, CI und Merge wartet, ohne für nichts geweckt
  zu werden.

### Modified Capabilities

- `review-vor-dem-pr`: Die sieben Anforderungen des Pflicht-Reviews entfallen; übrig bleibt eine
  Anforderung, dass der Agent nach festen Anlässen selbst entscheidet und den Review startet.

## Impact

- `.claude/skills/dev-zunder-ausfuehren/SKILL.md` (Agenten-Tabelle, Schritt 4, Abschnitt
  „Review vor dem PR“ → „Review nach Ermessen“, neuer Abschnitt „Warten ohne Wecken“, Don'ts)
- `.claude/skills/dev-zunder-ausfuehren/references/review-pruefliste.md` (Kopf)
- `.claude/skills/dev-zunder-orchestrieren/SKILL.md` (Einleitung, Phasentabelle, Phase 4, Don'ts)
  und `references/workflow-bausteine.md` (Skelett 3 entfällt)
- `AGENTS.md`, Abschnitt „Planung und Ausführung“
- `.github/pull_request_template.md` (Abschnitt „Review“ entfällt, eine Zeile unter „Geprüft“)
- Kein Projektcode, keine Gates, keine Migration. Keine Zunder-Aufgabe: kein `<kurz>`-Vorsatz,
  keine `Zunder:`-Zeile.
