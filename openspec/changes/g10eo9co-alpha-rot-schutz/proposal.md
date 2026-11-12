# Proposal

Zunder: https://zunder.rubeen.dev/#/aufgabe/g10eo9comda66qzuvf2dai5d (LLH-1849)

## Why

Am 12.11.2026 war `alpha` rot, obwohl jeder PR für sich grün war. #1319 gab
`instanz::melden::handle_meldung` einen fünften Parameter, ein Test aus #1303/#1315 rief die
Funktion noch mit vier Argumenten auf. Git meldet so etwas nicht als Konflikt, und die CI eines PRs
prüft nur den Stand von `alpha`, den es beim letzten Push gab. Danach wurde jeder offene PR rot, und
vier Sitzungen bauten unabhängig voneinander denselben Einzeiler (#1313, #1320, #1322 und ein
geschlossener PR). Weil sich ihre Kommentarzeilen unterschieden, entstanden daraus Merge-Konflikte
in drei weiteren PRs.

Eine Merge Queue, die die Kombination vor dem Merge prüft, gibt es für Repositories eines
Benutzerkontos nicht (Kopf von `.github/workflows/stau-waechter.yml`).

## What Changes

- **Pflicht-Check „Baut mit Ziel-Branch“ (neu):** Ein fertiger PR (Auto-Merge an oder Label `e2e`)
  wird mit dem aktuellen Stand seines Ziel-Branches zusammengeführt und nur kompiliert: Rust mit
  allen Testzielen und das Frontend per Typprüfung. Bewegt sich der Ziel-Branch, wird der Check für
  jeden fertigen PR neu berechnet. PRs in Arbeit bekommen den Check auf „wartet“ und rechnen neu,
  sobald sie fertig markiert werden. Der Kompilierlauf hat keine Schreibrechte, das Ergebnis meldet
  ein getrennter Schritt.
- **Stau-Wächter, Befund „alpha rot“ (neu):** Schlägt die CI auf `alpha` fehl, nennt der Wächter die
  PRs, die seit dem letzten grünen Lauf gemergt wurden, als vermutliche Ursache, und bestimmt genau
  einen Zuständigen. Zuständig ist ein offener PR mit Label `alpha-rot` (der Fix), sonst der älteste
  offene PR. Ohne Fix-PR wechselt die Zuständigkeit stündlich zum nächsten. Alle anderen PRs
  bekommen einen eigenen Hinweis: alpha ist rot, wer sich kümmert, nicht selbst reparieren.
- **Nach dem Fix:** Ist `alpha` wieder grün, wird der Hinweis zu „behoben“, und der Wächter mergt
  `alpha` in jeden PR mit diesem Hinweis, dessen jüngster CI-Lauf rot war. Es gelten dieselben
  Grenzen wie beim Befund „ohne CI“.
- **Sitzungen:** `dev-zunder-ausfuehren` sagt, was eine Sitzung tut, die der Hinweis weckt: Ist sie
  zuständig, baut sie den Fix in einem eigenen PR von `alpha` mit Label `alpha-rot`, sonst wartet sie.
- Nicht Teil: `beta` und `main` (dort landen nur Freigaben aus `alpha`), Brüche, die erst beim
  Ausführen der Tests auffallen (fängt weiter die CI auf `alpha`, dann greift der Wächter).

## Capabilities

### New Capabilities

Keine.

### Modified Capabilities

- `pr-pruefstufen`: Ein fertiger PR braucht zusätzlich den Check „Baut mit Ziel-Branch“, der mit
  dem aktuellen Ziel-Branch rechnet und bei jeder Bewegung des Ziel-Branches neu entsteht.
- `merge-stau`: Neuer Befund „alpha rot“ mit genau einem Zuständigen, eigenem Hinweis neben dem
  bestehenden und dem Hineinmergen nach dem Fix. Die Regel „höchstens ein Hinweis je PR“ gilt
  künftig je Hinweisart (PR-Befund und Zustand von `alpha`).

## Impact

- **Gate und CI:** neu `.github/workflows/ziel-branch-build.yml`; neues Bündel in
  `scripts/check-all.sh` für den Kompilierlauf; `scripts/stau-waechter.sh` samt Selbsttest
  `scripts/stau-waechter.test.sh`; `.github/workflows/stau-waechter.yml` (Auslöser „CI fertig“,
  Leserecht auf Actions).
- **Regeln und Anleitungen:** `scripts/AGENTS.md` (Stau-Wächter, PR-Prüfstufen),
  `.claude/skills/dev-zunder-ausfuehren/SKILL.md` (Verhalten bei „alpha rot“).
- **Handgriff für Ruben nach dem Merge:** `Baut mit Ziel-Branch` im Ruleset 17017911 als Required
  Check eintragen, sobald der Check an einem PR grün gelaufen ist. Bis dahin ist er nur eine
  Anzeige.
- Kein Anwendungscode, keine Migration, keine sichtbare Wirkung in der App.
