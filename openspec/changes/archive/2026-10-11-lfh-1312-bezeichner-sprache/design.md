# Design

## Context

Motivation: siehe `proposal.md`, Abschnitt Why. Bestand am 11.10.2026 (Stand `alpha`,
1.0.0-alpha.108): rund 2 100 Quelldateien in `src/`, `crates/` und `frontend/src/`. Darin
stehen 313 Rust-Funktionen mit deutschem Technikverb (`fn lade_…`, `hole_…`, `pruefe_…`, `ist_…`,
`hat_…`, `erzeuge_…`, `speichere_…`, `aktualisiere_…`, `loesche_…`) und 527 vergleichbare
Deklarationen im Frontend (`ladeX`, `holeX`, `baueX`, `setzeX`, `zeigeX` …). Englische
Strukturwörter gibt es schon heute (`…Props`, `use…`-Hooks, `repo.rs`, `mod.rs`).

Die Sprachvorgabe stand bisher nur in den „Global Constraints“ einzelner Pläne
(`docs/superpowers/plans/2026-08-20-lfh-341-uhs-grundriss-touch.md:19`,
`2026-07-27-lfh-328-token-fundament.md:31`, `2026-05-25-navigation-redesign.md:43`). Dieses
Verzeichnis ist laut Wurzel-`AGENTS.md` ein eingefrorenes Archiv.

## Goals / Non-Goals

**Goals:**
- Eine Regel, die ein Agent ohne Rückfrage anwenden kann: Für jedes Wort im Bezeichner ist klar,
  ob es deutsch oder englisch steht.
- Der Bestand wird besser, ohne dass ein Task über seinen eigenen Zweck hinauswächst.

**Non-Goals:**
- Eine Umbenennung des Bestands in einem Zug, auch nicht je Bereich als eigenes Epic.
- Ein Wächter im Sammel-Gate. Ein Verbot wäre rot geboren (840 Treffer). Eine Sperrklinke
  („Zahl der deutschen Technikverben darf nicht steigen“) ist denkbar, bekommt aber ein eigenes
  Ticket, sobald die Regel eine Weile gelebt hat.
- Umbenennen von Grenzwerten (Wire, Datenbank, Migrationen, generierte Typen, Speicher-Schlüssel,
  Routen, Ereignisse).

## Decisions

**D1: Prüffrage für „Fachbegriff“.** Ein Wort ist Fachbegriff, wenn eine Einsatzkraft es so
benutzt oder die Oberfläche es so zeigt (Einsatz, Lage, Lagemeldung, Kräfte, Einheit, Sichtung,
Betreuung, Abschnitt, Ablösung, Gerätekonto, Funkplan …). Alles, was nur Programmierer sagen,
ist Technikwort: Abläufe (load, fetch, save, create, update, delete, check, validate, parse,
format, build, render, map, filter, sort), Präfixe für Wahrheitswerte (is, has, can, should),
Struktur- und Musterwörter (Props, State, Store, Hook, Handler, Provider, Repo, Service, Cache,
Query, Mutation, Guard, Error, Config, Util, List, Map, Id, Key, Count, Index). Im Zweifel bleibt
das Wort deutsch, wenn die Oberfläche dasselbe Wort zeigt. So decken sich Code und Oberfläche
(gemeinsame Sprache im Sinne von DDD). Verworfen: eine abschließende Wortliste. Sie veraltet und
lädt zu Streit über Randfälle ein. Die Liste in der `AGENTS.md` ist deshalb ausdrücklich nur eine
Beispielliste.

**D2: Schreibweise unverändert.** Umlaute werden umschrieben (`kraefte`, `geraet`), die
Groß-/Kleinschreibung folgt der Sprache (Rust `snake_case`, TypeScript `camelCase`/`PascalCase`).
Gemischte Bezeichner sind gewollt: `load_einsatz`, `isGeraetekonto`, `EinsatzKopfProps`.
Dateinamen folgen derselben Regel wie die Bezeichner, die sie tragen.

**D3: Pfadfinderregel mit klarer Grenze.** Umgestellt wird ein bestehender Bezeichner, wenn der
Task Code ändert, der ihn deklariert, und seine Verwendungen im Diff liegen oder sich
mechanisch mitziehen lassen (Umbenennen per Werkzeug, keine Logikänderung). Eine Namensfamilie in
derselben Datei (`lade_a`, `lade_b`) wird zusammen umgestellt, damit keine Datei halb umbenannt
zurückbleibt. Die Umbenennung kommt als eigener Commit (`refactor(<bereich>): Bezeichner
englisch`) in denselben Branch, damit der Verhaltens-Diff lesbar bleibt. Verworfen: „jede
berührte Datei komplett umstellen“, weil ein Bugfix in einer großen Datei sonst zum
Umbau-PR würde.

**D4: Grenzwerte bleiben.** Ein Wire-Name, eine Spalte oder ein gespeicherter Schlüssel wird
nicht umbenannt, auch nicht über `#[serde(rename)]` mit internem englischen Namen. Das würde
den generierten Typ (LFH-120) und den Rust-Namen auseinanderziehen, und der Leser müsste zwei
Namen kennen. Wer einen Grenzwert ändern will, macht eine eigene Change mit Übergangsweg.

**D5: Ort der Regel.** Die Regel betrifft Backend, Frontend, Desktop-Hülle und Skripte, gehört
also in die Wurzel-`AGENTS.md` (Abschnitt „Bezeichner-Sprache (LFH-1312)“, direkt nach „Wo die
Regeln stehen“). Die Datei wächst von 131 auf rund 150 Zeilen und bleibt unter der Grenze von
200. Die alten Pläne werden nicht angefasst. Die Regel nennt sie ausdrücklich als überholt.

**Wortlaut für die Wurzel-`AGENTS.md`** (Entwurf, Feinschliff bei der Umsetzung):

```markdown
## Bezeichner-Sprache (LFH-1312)

- **Fachbegriffe deutsch, Technik englisch.** Ein Wort, das eine Einsatzkraft so benutzt oder die
  Oberfläche so zeigt, bleibt deutsch (`einsatz`, `lagemeldung`, `kraefte`, `sichtung`,
  `geraetekonto`). Alles, was nur Programmierer sagen, ist englisch: Abläufe (`load`, `fetch`,
  `save`, `create`, `update`, `delete`, `check`, `parse`, `build`, `render`), Wahrheitswerte
  (`is`, `has`, `can`), Strukturwörter (`Props`, `State`, `Hook`, `Handler`, `Repo`, `Error`,
  `List`, `Count`). Also `load_einsatz`, `isGeraetekonto`, `EinsatzKopfProps`, nicht
  `lade_einsatz`, `istGeraetekonto`. Im Zweifel deutsch, wenn die Oberfläche dasselbe Wort zeigt.
  Umlaute werden umschrieben (`kraefte`).
- **Prosa bleibt deutsch:** Kommentare, Commit-Nachrichten, UI-Texte, Testbeschreibungen, Doku.
- **Grenzwerte bleiben:** Wire-Felder und -Werte, Tabellen und Spalten, Migrationen, generierte
  Typen, gespeicherte Schlüssel, Routen und Ereignisnamen nicht nur wegen dieser Regel umbenennen.
- **Bestand beim Anfassen umstellen, nie in einem Zug:** Neue Bezeichner folgen der Regel sofort.
  Ein bestehender wird umgestellt, wenn der Task Code ändert, der ihn deklariert, und seine
  Verwendungen im Diff liegen oder sich mechanisch mitziehen lassen; eine Namensfamilie in
  derselben Datei zusammen. Die Umbenennung kommt als eigener `refactor`-Commit in denselben Branch.
- Die Vorgabe „Bezeichner auf Deutsch“ in älteren Plänen unter `docs/superpowers/plans/` ist
  überholt. Herleitung: `openspec/changes/archive/…-lfh-1312-bezeichner-sprache/design.md`.
```

## Risks / Trade-offs

- [Der Bestand bleibt lange gemischt.] → Gewollt. Die Familienregel in D3 hält wenigstens jede
  einzelne Datei einheitlich. Ob eine Sperrklinke nötig ist, zeigt sich nach einigen Wochen.
- [Agenten lesen einen alten Plan und benennen weiter deutsch.] → Die Regel nennt die alten
  Pläne ausdrücklich als überholt. Reviews (`requesting-code-review`) prüfen gegen die
  `AGENTS.md`.
- [Streit über Grenzfälle zwischen Fachbegriff und Technikwort.] → Die Prüffrage aus D1 mit dem
  Vorrang für das Wort der Oberfläche entscheidet. Ein Grenzfall ist kein Review-Blocker.
- [Umbenennungen erzeugen Merge-Konflikte mit parallelen Branches.] → Die Pfadfinderregel
  beschränkt sie auf den Code, den der Task ohnehin ändert. Der eigene Commit macht einen
  Konflikt leicht auflösbar.

## Migration Plan

Kein Deploy, kein Rückweg nötig: Die Änderung betrifft nur die Arbeitsanleitung. Rückgängig
macht sie ein Revert des Abschnitts.
