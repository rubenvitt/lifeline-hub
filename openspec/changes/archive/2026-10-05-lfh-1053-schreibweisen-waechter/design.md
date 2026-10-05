# Design

## Context

Motivation: siehe `proposal.md`, Abschnitt Why. Alle CI-Jobs, die `check-all.sh` fahren, laufen
auf `ubuntu-latest` (`.github/workflows/ci.yml`). Der Windows-Build in `artefakte.yml` ist ein
Cross-Build auf Linux (MinGW) und sieht den Konflikt deshalb auch nicht. Einzig der Job
`macos-arm64` baut auf einem Dateisystem ohne Unterscheidung der Schreibung, und der läuft erst
nach `release: published`.

Gate-Schritte sind Funktionen in `scripts/check-all.sh`, die ein Prüfskript und dessen
Selbsttest rufen (Vorbild: Schritt 13, `check-openspec-archiv.sh` mit `*.test.sh`). Ein Schritt
im Bündel `schnell` muss in Sekunden fertig sein.

## Goals / Non-Goals

**Goals:**
- Die Fehlerklasse aus LFH-1050 unter Linux erkennen, bevor ein Release entsteht.
- Rot ist nur, was auf macOS oder Windows tatsächlich kollidiert; keine Fehlalarme für übliche
  Paare wie `X.tsx` neben `x.css`.

**Non-Goals:**
- Importpfade in Quelltexten gegen die tatsächliche Schreibung prüfen (`import './foo'` bei
  Datei `Foo.ts`). Das deckt `forceConsistentCasingInFileNames` von `tsc` bereits ab, das in
  TypeScript 5 Standard ist.
- Andere plattformspezifische Build-Fehler. Dafür ist der Entwurfs-Release (LFH-1054) gedacht.

## Decisions

**D1: Vergleich je Verzeichnis, nicht über ganze Pfade.** Jeder Pfad wird in seine Verzeichnis-
und Dateinamen zerlegt, und je Elternverzeichnis werden die direkten Einträge verglichen. So
fallen auch kollidierende Verzeichnisse (`Stab/` gegen `stab/`) auf, die beim Vergleich ganzer
Pfade nicht auffielen, wenn sie verschiedene Dateien enthalten. Verworfen: `sort -f | uniq -di`
über ganze Pfade, weil es genau diesen Fall übersieht.

**D2: Zwei Schlüssel je Eintrag.** Der erste Schlüssel ist der ganze Name in Kleinbuchstaben
(jede Dateiart, Verzeichnisse eingeschlossen). Der zweite ist der Modulname in Kleinbuchstaben,
also der Name ohne TS/JS-Endung (`.d.ts` vor `.ts` geprüft) für Moduldateien und der
Verzeichnisname für Verzeichnisse. Eine Gruppe ist rot, wenn ihre Mitglieder unter diesem
Schlüssel mehr als eine tatsächliche Schreibung tragen. Damit bleiben `EinsatzSeite.tsx` und
`EinsatzSeite.test.tsx` (verschiedene Schlüssel) sowie `GefahrenMatrix.tsx` und
`gefahrenMatrix.css` (das Stylesheet hat keinen Modulnamen) grün. Verzeichnisse zählen beim
Modulschlüssel mit, weil `./lagekarte` auf macOS sonst `Lagekarte.tsx` statt
`lagekarte/index.ts` fände. Der Abgleich am 05.10.2026 ergab auf `alpha` keinen solchen Fall,
der Schritt wird also grün geboren.

**D3: Dateiliste aus Git.** `git ls-files --cached --others --exclude-standard` liefert
versionierte und neue, nicht ignorierte Dateien. `node_modules/`, `target/` und Build-Ausgaben
bleiben so außen vor, ohne eine eigene Ausschlussliste zu pflegen, und eine lokal angelegte, noch
nicht hinzugefügte Datei fällt vor dem Commit auf. Verworfen: `find` über den Checkout, weil es
eine handgepflegte Ausschlussliste bräuchte.

**D4: Bash und awk, kein Node.** Wie die übrigen Wächter läuft das Skript ohne `mise` und ohne
`node_modules`. Gruppiert wird in einem einzigen `awk`-Lauf über die NUL-getrennte Liste; die
Kleinschreibung übernimmt `tolower`, das nur ASCII sicher umsetzt. Umlaute in Dateinamen gibt
es im Repo heute nicht; ein Nicht-ASCII-Name fällt höchstens durch, er erzeugt keinen
Fehlalarm.

**D5: Eigener Schritt 14 im Bündel `schnell`.** Vorbild ist Schritt 13: erst der Selbsttest,
dann die Prüfung. Die Bündel-Selbstprüfung in `check-all.sh` erzwingt, dass der Schritt genau
einem Bündel angehört. Verworfen: den Wächter in Schritt 2 (Lint) einzuhängen, weil eine
ESLint-Regel nur `frontend/` sähe und Verzeichniskollisionen nicht erfasst.

## Risks / Trade-offs

- [Nicht-ASCII-Namen werden nur in ihrem ASCII-Anteil verglichen] → im Repo heute ohne Fall;
  steht im Skriptkopf.
- [Ein Selbsttest, der nur grüne Fälle prüft, ließe einen Wächter durch, der nie anschlägt] →
  der Selbsttest enthält den Stand vor LFH-1050 als roten Fall und prüft Exit-Code und Meldung.
- [Ein Wächter, der rot geboren würde, würde abgeschaltet statt befolgt] → vor dem Scharfschalten
  läuft er gegen `alpha`; grün belegt (Abgleich vom 05.10.2026, wird in Aufgabe 3.1 wiederholt).
