# Design

## Context

Motivation: `proposal.md`, „Why“. Anforderungen: `specs/review-vor-dem-pr/spec.md`.

Stand heute:

- `dev-zunder-ausfuehren`, Schritt 4, nennt `superpowers:requesting-code-review` „vor dem Mergen“,
  ohne zu sagen, wer es wann startet und was mit den Befunden geschieht.
- `dev-zunder-orchestrieren`, Phase 4, hat einen eigenen Fan-out (Skelett „Review-find-verify“
  in `references/workflow-bausteine.md`) mit vier allgemeinen Dimensionen und ruft danach
  zusätzlich `superpowers:requesting-code-review`.
- `AGENTS.md` nennt `requesting-code-review` an zwei Stellen im Abschnitt „Planung und
  Ausführung“. Die Datei hat 189 Zeilen und muss unter 200 bleiben.
- `.github/pull_request_template.md` hat die Abschnitte „Was ändert sich“, „Warum so“, „Bilder“,
  „Geprüft“.
- `entwurfs-hoheit` erlaubt das Review als Subagent oder Workflow parallel zu `check-all.sh`.

Grundlage der Prüfliste sind die 49 Commits vom 08. bis 12.11.2026, die CodeRabbit nennen
(`git log -i --grep=coderabbit`).

## Goals / Non-Goals

**Goals:**

- Der Review läuft ohne Zutun des Menschen und ohne Plugin, lokal und in der Cloud gleich.
- Er findet die Fehlerarten, die CodeRabbit gefunden hat, weil er gezielt danach fragt.
- Ob er gelaufen ist und was er ergab, steht im PR.

**Non-Goals:**

- Erzwingen per Gate oder Hook (Variante B, zurückgestellt).
- Review nach dem PR durch einen Dienst (Variante C).
- Ablösung der übrigen Superpowers-Skills.
- Die Prüfliste als Gate-Skript: Sie ist eine Anleitung für einen Agenten, kein Wächter. Wo sich
  eine Klasse mechanisch prüfen lässt, ist das ein eigener Task.

## Decisions

### D1 — Der Review ist ein Abschnitt im Skill, kein Hook und kein Gate

Schritt 4 von `dev-zunder-ausfuehren` bekommt den Punkt „Review vor dem PR“ und einen eigenen
Abschnitt gleichen Namens, der den Ablauf trägt. Reihenfolge in Schritt 4:
Verifikation → Review (darf parallel zu `check-all.sh` starten) → Befunde behandeln →
Change archivieren → PR.

Verworfen:

- **Hook in `.claude/settings.json`** (etwa vor `create_pull_request`): Ein Hook kann einen
  Aufruf sperren, aber keinen Agenten mit Diff und Prüfliste starten und nicht beurteilen, ob
  Befunde behandelt sind. Er sähe nur ein Merkzeichen, das der Agent selbst setzt.
- **CI-Wächter auf den Abschnitt „Review“:** von Ruben zurückgestellt (Variante B). Er braucht
  eine Ausnahme für Dependabot und prüft nur, dass Text da ist.
- **GitHub-Action mit Review je PR:** kostet Tokens je PR und findet erst nach dem PR, also in
  derselben Schleife, die CodeRabbit teuer gemacht hat.

### D2 — Ein Reviewer mit frischem Kontext über das Agent-Tool

Der Main-Loop startet einen Agenten (Typ `general-purpose`) mit einem festen Auftrag. Der Auftrag
steht als Vorlage im Abschnitt „Review vor dem PR“ und enthält:

- den Befehl für den Diff (`git diff origin/alpha...HEAD`, vorher `git fetch origin alpha`) und
  die Liste der geänderten Dateien;
- die Anweisung, jede `AGENTS.md` von der Wurzel bis zu den geänderten Dateien zu lesen und
  `scripts/adr-fuer.sh <pfade>` aufzurufen;
- den Pfad der Prüfliste;
- bei einer Change den Pfad der Delta-Spec;
- die Pflichtpunkte für Worker aus „Agenten nach Bedarf“ und zusätzlich: nichts ändern, nur
  Befunde zurückgeben, je Befund Datei, Stelle, Klasse, der konkrete Fall (Eingabe oder Zustand →
  falsches Ergebnis).

Der Auftrag enthält **nicht**, warum der Code so gebaut wurde. Das ist der Wert des zweiten
Blicks: CodeRabbit kannte den Entwurf auch nicht.

Verworfen: den Review im Main-Loop selbst zu machen. Der Main-Loop hat den Code geschrieben und
liest ihn mit denselben Annahmen.

### D3 — Größe: ein Reviewer, ab großem Diff der Workflow

- Bis etwa 600 geänderte Zeilen (ohne generierte Dateien, Lockfiles, Bilder): ein Reviewer, dann
  je Befund ein Gegenprüfer, parallel über das Agent-Tool.
- Darüber, oder wenn der Diff Backend und Frontend zugleich berührt: das Skelett
  „Review-find-verify“ als Workflow, je Gruppe von Klassen ein Reviewer.

Die Grenze ist ein Richtwert, kein Zähler; der Main-Loop entscheidet. Der Größenrichtwert der
Umgebung für Workflows gilt weiter.

Gruppen des Skeletts (ersetzen `bugs`, `security`, `konventionen`, `tests`):

| Schlüssel | Klassen der Prüfliste |
| --- | --- |
| `daten` | Stiller Verlust, Atomarität, Grenzen für Eingaben von außen |
| `zugriff` | Berechtigung und Geltungsbereich, Live-Verteilung |
| `oberflaeche` | Lade-, Fehler- und Offline-Zustand, veralteter Zustand im Frontend |
| `belege` | Tests, die nichts prüfen; Verhalten gegen Spec; Doku, ADR und Spec untereinander; Projektregeln der `AGENTS.md` |

Das Skelett liest die Prüffragen nicht als Kopie: Jeder Agent bekommt den Pfad der Prüfliste und
die Namen seiner Klassen.

### D4 — Gegenprüfung mit Vorgabe „im Zweifel verworfen“

Je Befund ein zweiter Agent mit dem Auftrag, ihn am Code zu widerlegen. Er antwortet mit
`isReal` und Begründung; bei Unsicherheit `false`. So steht es schon im heutigen Skelett und hat
sich bewährt: Es hält erfundene Befunde aus dem PR.

Verworfen: Befunde ungeprüft abzuarbeiten. CodeRabbit hat auch Unzutreffendes gemeldet (ein
Commit der Testphase nennt einen Befund „nicht verifiziert“); jede Behebung eines Scheinbefunds
kostet einen Gate-Lauf.

### D5 — Verbleib der Befunde

| Ergebnis | Was der Main-Loop tut |
| --- | --- |
| Bestätigt, ein klarer Ausweg | Beheben, mit Test, der ohne die Behebung rot wird; eigener Commit; Gates der Bereiche erneut |
| Bestätigt, Ausweg ändert Verhalten für Anwender oder hat mehrere vertretbare Wege | Dem Menschen vorlegen (Task auf `blocked`), wie in „Gemeinsam ausarbeiten“ |
| Bestätigt, gehört nicht in diesen Task | Aufgabe über `zunder-task-anlegen`, Link im Abschnitt „Review“ |
| Verworfen | Im Abschnitt „Review“ mit einem Satz Grund |

Nach einer Behebung läuft kein zweiter voller Review. Ändert die Behebung mehr als die gemeldete
Stelle, prüft ein Gegenprüfer nur diesen Commit.

### D6 — Abschnitt „Review“ in der PR-Vorlage

Zwischen „Bilder“ und „Geprüft“:

```markdown
## Review

<!-- Der Review vor dem PR (`dev-zunder-ausfuehren`, „Review vor dem PR“). Lief keiner: der Grund
     (Route `trivial`). Sonst je Befund eine Zeile:
     - bestätigt: was, wo, Commit der Behebung (oder Link auf die Folgeaufgabe)
     - verworfen: was, warum
     Kein Befund: ein Satz. -->
```

Der Abschnitt ist Prosa, keine Checkbox: Eine Checkbox lässt sich abhaken, ohne dass etwas lief.

### D7 — Ein Review je PR; der Orchestrator ruft keinen zweiten

Ruft `dev-zunder-orchestrieren` den Skill je Subtask auf, entfällt der Review dort (wie die
Abschlussmeldung). Phase 4 startet ihn einmal über den ganzen Branch und verweist für Ablauf,
Verbleib und Nachweis auf den Abschnitt in `dev-zunder-ausfuehren`. Punkt 3 von Phase 4
(„Interaktiv: `superpowers:requesting-code-review`“) entfällt.

### D8 — Die Prüfliste: Ort, Form, Inhalt

Ort: `.claude/skills/dev-zunder-ausfuehren/references/review-pruefliste.md`. Sie liegt beim
Skill, der den Schritt trägt (eine Regel steht einmal); der Orchestrator verweist dorthin.

Form je Klasse: Name, Prüffrage(n), „Trifft zu, wenn der Diff …“ (damit der Reviewer Klassen
auslassen kann), zwei bis drei Beispiele mit Commit oder PR. Am Kopf: Herkunft, und dass die
Liste kein Ersatz für das Lesen des Diffs ist.

Inhalt (die Beispiele werden beim Umsetzen aus den Commits übernommen):

| Klasse | Prüffragen | Beispiele |
| --- | --- | --- |
| Stiller Verlust | Rückt ein Stand, Zähler oder Hinweis vor, obwohl etwas abgeschnitten, abgelehnt oder noch nicht übernommen wurde? Was geschieht mit dem Rest einer begrenzten Liste? Ist ein Retry idempotent, und unterscheidet er sich von einer neuen Meldung gleichen Inhalts? Erreicht ein Widerruf die Gegenseite auch nach einem Fehlschlag? | `7a6817e7`, `573056e8`, `da7c3553`, `9728feca` |
| Lade-, Fehler- und Offline-Zustand | Was zeigt und erlaubt die Seite, solange die Abfrage lädt, scheitert oder das Netz fehlt? Blendet ein späterer Fehlschlag vorhandene Daten aus? Lässt sich ein Dialog beim Speichern schließen? Zeigt ein Dialog etwas, das der Server nie wieder liefert? | `f8f0f9e6`, `39a0053e`, `d77a742f` |
| Grenzen für Eingaben von außen | Hat jede Liste und jedes Feld einer Gegenstelle, eines Geräts oder eines Clients eine Obergrenze, vor dem Entdoppeln gezählt? Passen die Grenzen zueinander (Anzahl mal Größe gegen Lesegrenze)? Rechnet Zeit mit geprüfter Arithmetik? | `d5b56723`, `727c5254`, `d40bcb76` |
| Berechtigung und Geltungsbereich | Trifft jede ID von außen nur ein Objekt der eigenen Org, Stelle, Einheit oder Kopplung? Gibt ein Replay mehr zurück, als der Aufrufer sehen darf? Wird einem Kopf nur von einem vertrauten Proxy geglaubt? Kann eine Seite der Kopplung der anderen etwas nehmen? | `773b6b44`, `d77a742f`, `aa02a45b`, `3f5c49cc` |
| Veralteter Zustand im Frontend | Entsteht der Body beim Klick oder beim Rendern? Ist eine Prop beim Einhängen eingefroren? Teilen sich zwei Stellen eine Mutation? Hält eine ausgehängte Komponente noch Aktionen oder Fokus? Endet ein Druck auch außerhalb des Elements? | `4d528bdb`, `4efb2f6b`, `1388a015`, `fd31d60b` |
| Tests, die nichts prüfen | Wird der Test ohne die Änderung rot? Wartet `waitFor` auf etwas, das wirft? Prüft der Test den echten Grenzwert statt eines Beispiels? Wird das Geprüfte vor oder nach dem Signieren gesetzt? | `f6a4ad11`, `c5a2742a`, `d40bcb76` |
| Verhalten gegen Spec | Tut der Code, was Spec und Anwenderkapitel sagen, auch im leeren Fall und im Fehlerfall? Antwortet er dort mit dem Statuscode der Konvention? | `6b3942e0`, `a146a42f` |
| Atomarität | Liegt jedes Lesen und Schreiben einer Entscheidung in derselben Transaktion? Werden Felder, die zusammengehören, zusammen gesetzt? Unterscheidet ein Zähler zwei Ereignisse, die gleich oft vorkamen? | `0eb982c7`, `773b6b44`, `a59413e4` |
| Live-Verteilung | Bekommt jeder, der die Zahl oder den Kopf sieht, das Ereignis, auch ohne das Hauptrecht? Wird nach dem Commit gemeldet? | `b2abdbec`, `da7c3553` |
| Doku, ADR und Spec untereinander | Widersprechen sich ADR, Konzept, Spec und Anwenderkapitel? Zeigt jeder Verweis auf eine Regel, die es gibt? Nennen die `quellen` eines Kapitels die geänderten Dateien? Hat ein neuer Baustein seine Karte im Design System? | `0e4c7ba8`, `72bb0dcc`, `ae50df0b`, `bd12b604` |

### D9 — `AGENTS.md`

Im Abschnitt „Planung und Ausführung“:

- Aufzählung „Bei Superpowers bleiben …“: `requesting-code-review` streichen.
- „`/opsx:apply` bringt keine Disziplin mit“: statt `requesting-code-review` „den Review vor dem
  PR (`dev-zunder-ausfuehren`, „Review vor dem PR“)“.
- Ein Punkt in der Art der übrigen: der Agent startet vor jedem PR selbst einen Review mit
  frischem Kontext gegen die Prüfliste, Befunde und Verbleib stehen im PR; Verweis auf den Skill
  und auf die Herleitung im Archiv dieser Change.

Die Datei bleibt unter 200 Zeilen; der Punkt wird so geschnitten, dass es reicht.

### D10 — Pflege der Prüfliste

Im Abschnitt „Review vor dem PR“ steht die Regel aus der Spec: Rutscht ein Fehler durch, ergänzt
die Behebung die Prüfliste im selben Branch, als Fehlerart, nicht als Einzelfall. Kein eigener
Mechanismus; der Ort, an dem der Fehler behoben wird, ist auch der, an dem die Liste wächst.

## Risks / Trade-offs

- [Der Agent überspringt den Schritt] → Der Abschnitt „Review“ in der PR-Vorlage macht es
  sichtbar; fehlt er wiederholt, kommt der CI-Wächter (Variante B) nach.
- [Derselbe Modelltyp reviewt seinen eigenen Code und teilt dessen blinde Flecken] → Frischer
  Kontext ohne Begründung der Umsetzung und Prüffragen aus echten Befunden. Ob das reicht, zeigt
  sich an Fehlern, die später auffallen; sie fließen in die Prüfliste (D10). Ein Review durch
  CodeRabbit auf Zuruf für einzelne riskante PRs bleibt möglich, solange die App installiert ist.
- [Laufzeit und Tokens je PR] → Ein Reviewer bei kleinen Diffs, Workflow erst ab großem Diff
  (D3); der Review läuft parallel zu den Gates.
- [Die Prüfliste wächst zur Wand] → Klassen statt Einzelfälle (Spec), höchstens drei Beispiele
  je Klasse.
- [Scheinbefunde kosten Gate-Läufe] → Gegenprüfung mit „im Zweifel verworfen“ (D4).

## Migration Plan

Keine Migration. Die Änderung wirkt ab dem Merge für jeden neuen Task. Rücknahme: den Commit
zurücknehmen; nichts hängt daran.
