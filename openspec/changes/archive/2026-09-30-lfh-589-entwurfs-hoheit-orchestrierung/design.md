# Design

## Context

Den Anlass beschreibt `proposal.md`. Heute gilt:

- `dev-clickup-orchestrieren/SKILL.md` gibt Phase 1 (Scope-Fan-out) und Phase 2 („Plan je
  Subtask“ oder Judge-Panel) je einem Workflow. Phase 3 ruft pro Subtask
  `dev-clickup-ausfuehren` auf. Dessen Routing schickt „Multi-Step / mehrere Files“ nach
  `/opsx:propose` → Checkpoint → `/opsx:apply` und „Anforderung unklar“ nach `/opsx:explore`.
  Ein Task mit Subtasks kann also zweimal entworfen werden: einmal im Plan-Workflow von
  Phase 2 und dann noch einmal über `/opsx:propose` in Phase 3.
- Das Workflow-Tool läuft im Hintergrund und kann den Menschen nicht fragen (Kernprinzip des
  Orchestrierungs-Skills). `/opsx:explore` ist ausdrücklich ein Gespräch: Es schreibt erst nach
  einer Ja/Nein-Bestätigung in einer eigenen Nachricht. `/opsx:propose` fragt bei wesentlicher
  Mehrdeutigkeit vor dem Anlegen zurück und hält nach den Artefakten an.
- Das Skelett „Scope-Fan-out“ (`references/workflow-bausteine.md`, Abschnitt 1) liefert je
  Subtask `complexity: trivial | klar | unklar | multi-step`. Das sind fast die Routen von
  `dev-clickup-ausfuehren`, nur fehlt „Bug, Ursache unklar“, und „multi-step“ hat kein Kriterium.
- Im Archiv liegen 46 Changes, fast alle Features über Backend und Frontend oder neue
  Projektregeln (LFH-658, LFH-520). LFH-588 selbst (Arbeitsteilung OpenSpec ↔ Superpowers) hat
  keine Change bekommen, obwohl es eine Regel eingeführt hat. Genau diese Lücke soll das Kriterium
  schließen.

## Goals / Non-Goals

**Goals:**
- Für Phase 1 und Phase 2 ist je genau ein Mechanismus zuständig, erkennbar an einem Feld der
  Scope-Map, nicht an der Stimmung des Laufs.
- Ob eine Change entsteht, lässt sich aus der Scope-Map ablesen (Dateien → Subsysteme, Gründe
  E1–E3).
- Der Pflicht-Checkpoint aus LFH-588 ist gegen Workflows strukturell gesichert, nicht nur per
  Ermahnung.

**Non-Goals:**
- Keine Änderung an den OpenSpec-Skills selbst (`openspec-*`, `.claude/commands/opsx/`).
- Kein Guard-Skript für die Regel. Die Skills sind Anleitungen und kein prüfbarer Code.
  `check-openspec-archiv.sh` bleibt die einzige maschinelle Wache.
- Keine nachträgliche Change für LFH-588 oder andere schon gemergte Tasks.

## Decisions

### D1 — Schnitt 2: Der Workflow besitzt die Menge, OpenSpec den Datensatz
Das Ticket nennt drei Schnitte.
- **Schnitt 1 (OpenSpec besitzt beides)** ist verworfen. `/opsx:explore` und `/opsx:propose`
  laufen im Main-Loop und nacheinander. Bei acht Subtasks wären das acht Gespräche bzw. acht
  serielle Codebase-Lektüren, und der parallele Scan fiele weg, für den das Workflow-Tool da ist.
  Außerdem liefern sie keine Querschau: Welche Subtasks teilen Dateien und welche hängen
  voneinander ab? Das braucht aber die Moduswahl in Phase 3.
- **Schnitt 3 (OpenSpec nur, wo ohnehin eine Spec nötig ist)** ist allein keine Regel, nur die
  Frage nach dem Kriterium. Sein Kern wird übernommen (D2).
- **Schnitt 2** trennt nach der Form der Arbeit. Parallel über viele Tasks lesen und bewerten
  kann nur der Workflow. Einen einzelnen Entwurf festhalten, nachfragen und freigeben lassen
  kann nur der Main-Loop mit OpenSpec. So steht jede Fähigkeit dort, wo ihr Werkzeug sie trägt.

### D2 — Kriterium an genau einer Stelle: die Route „Entwurf“ in `dev-clickup-ausfuehren`
Die Zeile „Multi-Step / mehrere Files“ wird zu „Entwurf“ und bekommt die Gründe E1–E3 aus der
Spec. Sie steht im Routing von `dev-clickup-ausfuehren`, weil der Orchestrierungs-Skill das
Routing ausdrücklich nicht kopiert („eine Quelle der Wahrheit“). Der Orchestrierungs-Skill und
das Skelett verweisen darauf. Das Skelett trägt die Gründe zusätzlich im Reader-Prompt, weil ein
Workflow-Agent den Skill nicht selbst liest.

Warum „Subsystem“ und nicht „mehrere Dateien“: Mehrere Dateien hat fast jede Änderung, auch
jeder Bugfix mit Test. Ein Subsystemwechsel lässt sich an den Pfaden der Scope-Map ablesen und
trifft, was das Archiv zeigt: Changes entstanden für Features über Backend und Frontend und für
neue Regeln. Die Ausnahmen bei E3 (Bugfix, der Bestehendes wiederherstellt, und reine
Textkorrektur) verhindern, dass ein Fix oder ein Label über Backend und Frontend eine
Spec-Zeremonie auslöst, obwohl keine Regel neu entsteht. Pfade außerhalb der Liste (`docs/`,
`openspec/`, Wurzeldateien) zählen zu keinem Subsystem. So bleibt E3 an der Liste ablesbar.

Die Route bleibt nach Phase 1 fest, damit `dev-clickup-ausfuehren` im orchestrierten Lauf nicht
neu schätzt und einen Task zweimal entwirft. Einzige Ausnahme: `bug-unklar` → `entwurf`, wenn
die gefundene Ursache eine Entscheidung (E1) oder Regel (E2) verlangt. Der Status bleibt dann
auf `in development` (nur vorwärts), der Freigabe-Halt gilt trotzdem.

Verworfen: „Change, wenn eine SHALL-Anforderung entsteht“ allein. Das verfehlt Entscheidungen
ohne neue Anforderung (E1) und macht die Frage „ist das eine Anforderung?“ zur Einzelfall-Debatte.

### D3 — Scope-Map bekommt `route`, `entwurfsgruende`, `faehigkeiten`
`complexity` wird ersetzt durch `route: trivial | klar | bug-unklar | unklar | entwurf`, das sind
die fünf Zeilen des Routings. Dazu kommen `entwurfsgruende: ('E1'|'E2'|'E3')[]` (leer, außer bei
`entwurf`) und `faehigkeiten: string[]`, die Pfade unter `openspec/specs/`, deren Anforderungen
der Subtask ändert oder neu anlegt. Bloßes Berühren zählt nicht, sonst führten zwei
`klar`-Subtasks im selben Bereich über die Hintertür zu einer Change. Aus `faehigkeiten` ergibt
sich die gemeinsame Change (Spec, „Die Scope-Map ist die Eingabe der Change“): Überschneiden
sich dort zwei Subtasks **auf `entwurf`**, entsteht eine Change am Parent. Solche Subtasks
laufen nie parallel autonom, weil sie dieselbe `tasks.md` abhaken. Die Route bleibt
ein Vorschlag des Readers. Bestätigt wird sie am Phase-1-Checkpoint, der dafür ohnehin besteht.

Verworfen: ein zusätzliches Feld `braucht_change: boolean`. Es wäre redundant zu
`route === 'entwurf'` und könnte auseinanderlaufen.

### D4 — „Plan je Subtask“ entfällt, das Judge-Panel wird Zulieferer
Für Tasks auf „Entwurf“ ist `tasks.md` der Plan. Ein zweiter Plan im Workflow-Ergebnis wäre eine
Dublette ohne Ablageort. Tasks ohne „Entwurf“ brauchen keinen Plan, sie laufen direkt per TDD
oder Debugging. Das Muster fällt deshalb aus Phase 2 und aus dem Skelett-Text.

Das Judge-Panel bleibt, weil `/opsx:propose` konkurrierende Entwürfe nicht parallel bewerten
kann. Es liefert nur Eingabe und schreibt nichts. Einen eigenen Checkpoint zwischen Panel und
Proposal gibt es nicht: `/opsx:propose` schreibt den Sieger als Entscheidung und die übrigen als
Alternativen in `design.md`. Der Mensch wählt am Freigabe-Checkpoint. Will er einen anderen Weg,
läuft `/opsx:update`. So bleibt es bei einem Halt statt zwei.

### D5 — Checkpoint strukturell: Workflows rufen kein `/opsx:*`
Die Regel ist an Werkzeuggrenzen festgemacht, nicht an Einsicht. Workflows rufen kein `/opsx:*`
und schreiben nicht unter `openspec/changes/`. Einzige Ausnahme ist das Abhaken von Aufgaben einer
freigegebenen Change im autonomen Dev-Modus. Grund: `/opsx:explore` und `/opsx:propose` brauchen
den Menschen, und ein Workflow-Agent, der `/opsx:propose` ausführt, würde am Halt einfach enden.
Das sähe aus wie ein Erfolg, und der Orchestrator ginge weiter. Mehrere Proposals eines Laufs
legt der Main-Loop gesammelt vor, ein Halt für alle. Das ist mit der *planning boundary* von
`/opsx:propose` vereinbar, weil keine Umsetzung im selben Zug beginnt.

### D6 — Diese Change folgt ihrer eigenen Regel
LFH-589 ändert nur `.claude/` und `CLAUDE.md` (ein Subsystem, E3 trifft nicht zu). Es trifft
aber eine Entscheidung zwischen drei Schnitten (E1) und führt eine Regel ein (E2). Nach dem
Kriterium bekommt es also eine Change, und deshalb liegt diese hier. LFH-588 hätte nach derselben
Regel ebenfalls eine bekommen (E2).

## Risks / Trade-offs

- [Reader schätzt die Route falsch] → Die Route ist nur ein Vorschlag. Der Main-Loop bestätigt
  sie am Phase-1-Checkpoint, und E3 ist aus den Pfaden nachprüfbar.
- [Mehr Changes als bisher, etwa für kleine Regeländerungen (E2)] → Gewollt: Eine Regel ohne
  Herleitung ist die Lücke, die LFH-588 offen ließ. Eine kleine Change kostet vier kurze Dateien
  und ist vor dem Merge archiviert.
- [Subsystemliste veraltet, etwa durch ein neues Top-Level-Verzeichnis] → Die Liste steht nur in
  der Spec und im Routing von `dev-clickup-ausfuehren`. Das Skelett verweist darauf, statt sie zu
  kopieren, außer im Reader-Prompt (D2). Wer ein Subsystem hinzufügt, zieht zwei Stellen nach.
- [Keine maschinelle Prüfung] → Bewusst (Non-Goal). Die Skills sind Anleitungen. Dass die
  Change vor dem Merge archiviert wird, prüft weiter `check-openspec-archiv.sh`.

## Migration Plan

Keine. Es läuft keine Orchestrierung, und `openspec/changes/` ist leer. Die neue Regel gilt ab
dem Merge für den nächsten Lauf.
