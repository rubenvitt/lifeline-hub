# Mono-Stufen statt `monoStil` mit freier Größe — Design

Zunder: https://zunder.rubeen.dev/#/aufgabe/ldu5dmkb73g1zjzoc54tzxy0 (LLH-1972)
Stand: 19.11.2026 · Route `entwurf` (E1 Stufenwahl, E2 Regel der Schriftgrößen-Ratsche)

## Absicht

Die Schriftgrößen-Ratsche aus LLH-1810 (`theme/schriftgroesse.guard.test.ts`) zählt
`monoStil(<Zahl>)` nicht, das ist ihre Grenze 1. Mono-Text ist deshalb das letzte Schlupfloch
für freie Schriftgrößen: ~400 Aufrufe in 183 Dateien. ADR-0065 hält in den Konsequenzen fest,
dass `monoStil(<Zahl>)` eigene Stufen braucht. Ziel ist, dass Mono-Größen aus der
`schriftskala` kommen und eine neue Zahl rot wird.

## Bestand (Messung 19.11.2026)

| Größe | Aufrufe | typisch |
| --- | --- | --- |
| 10 | 29 | Unterzeilen („Stand“, Weg in der Zeitachse) |
| 11 | 66 | Meta, heute schon Stufe `meta` |
| 12 | 130 | Zähler und Zeiten neben `textKlein` |
| 13 | 82 | Funkrufname, PAT, „seit …“ neben `text` |
| 14 | 40 | Kennungen (Schaden-Nr., Registriernummer), Code-Eingaben |
| 8, 9, 15, 16, 20, 22, 24, 28, 40 | ~30 | Einzelfälle, Kennzahlen, Kopplungscodes |
| Variablen (`token.fontSize*`, Maße) | ~33 | Dichte-Grundschrift, Kartenmaße |

## Ziele, Nicht-Ziele, Anti-Ziele

- **Ziel:** Jede Mono-Größe 10–14 kommt aus einer Stufe. Die Ratsche zählt
  `monoStil(<Zahl>)` wie jedes andere Schriftgrößen-Literal.
- **Nicht-Ziel:** Mono-Größen in CSS-Dateien (zählt die Ratsche schon), `Textstufe` für Mono,
  Abbau der übrigen Schriftgrößen-Schuld.
- **Anti-Ziel:** eine sichtbare Änderung. Die Umstellung ist **pixelgleich**. Eine Seite, die
  danach anders aussieht, ist ein Fehler.

## Ansätze (abgestimmt mit Ruben am 19.11.2026)

| Frage | Gewählt | Verworfen |
| --- | --- | --- |
| Stufenschnitt 10–14 | **5 Stufen, pixelgleich** | Verdichten auf 3 (Optik ändert sich an ~110 Stellen), 4 Stufen mit 10 → 11 |
| Gewicht 400/500 | **bleibt Parameter** | eigene Stufen je Gewicht (verdoppelt einen Teil der Skala) |
| Ausreißer außerhalb 10–14 | **auf `datenwert*` abbilden, wo pixelgleich, der Rest kommt in die Schuld** | für alles eine Stufe (Skala wird breit) oder einrasten (Optik) |
| API | **`monoStil(stufe)`** | durch `Textstufe` ersetzen (nimmt kein `style`, ~400 Umbauten mit Farbe, Flex und Ausrichtung) |

## Entwurf

### Neue Stufen in `schriftskala` (`theme/tokens.ts`)

Alle mit `familie: 'zahl'`, `gewicht: 400`, ohne Sperrung:

| Stufe | Größe | CSS-Spiegel |
| --- | --- | --- |
| `metaKlein` | 10 | `--lfh-typo-meta-klein-*` |
| `meta` | 11 | vorhanden |
| `monoKlein` | 12 | `--lfh-typo-mono-klein-*` |
| `mono` | 13 | `--lfh-typo-mono-*` |
| `monoGross` | 14 | `--lfh-typo-mono-gross-*` |

Die Namen sind meine Wahl: der Größe nach geordnet und ohne vorgetäuschte Bedeutung. Bei 12
bis 14 trägt dieselbe Größe Zeiten, Zähler und Kennungen, deshalb taugen Rollennamen hier
nicht. `rollen.css` und `TYPO_ABBILDUNG` in `rollen.guard.test.ts` bekommen die vier neuen
Stufen. Der vorhandene Spiegeltest prüft dann, dass beide Seiten übereinstimmen.

**13 px:** In `frontend/AGENTS.md`, „`schriftskala`“, steht „13 px gibt es nicht“. Gemeint war
Text in Archivo. JetBrains Mono wirkt bei gleicher Pixelzahl größer, deshalb steht Mono 13
optisch neben Archivo 14. Der Satz wird präzisiert zu „13 px gibt es nur als Mono-Stufe `mono`“.
**Das ist der eine Punkt zur Freigabe.** Die Alternative wäre, 13 auf 12 oder 14 einzurasten:
Dann ändert sich die Optik an 82 Stellen, und das widerspricht dem Anti-Ziel.

### `monoStil` (`components/instrument/rollenwerte.ts`)

```ts
type Monostufe = { [K in Schriftstufenname]: (typeof schriftskala)[K]['familie'] extends 'zahl' ? K : never }[Schriftstufenname];
export function monoStil(groesse: Monostufe | number, gewicht?: 400 | 500)
```

- Eine Stufe liefert **nur die Größe** und als Vorgabe ihr Gewicht. Die Sperrung der
  `datenwert*`-Stufen wird nicht übernommen, damit die Umstellung pixelgleich bleibt;
  `StatusKnopf` setzt seine Sperrung schon selbst. Mit `gewicht` lässt sich überschreiben
  (`monoStil('mono', 500)`).
- Eine **Zahl** bleibt erlaubt, aber nur für Werte aus Variablen (Dichte-Grundschrift
  `token.fontSize*`, Kartenmaße). Ein Literal zählt die Ratsche.

### Umstellung

Ein Skript stellt mechanisch um: `monoStil(10…14[, g])` wird zu
`monoStil('<stufe>'[, g])`. 22 und 40 werden zu `datenwertKlein` und `datenwertGross`, Gewicht
500 ist dort die Vorgabe. Ternäre Literale (`hoehe >= 30 ? 13 : 12`) werden zu Stufennamen.
Alle übrigen Zahlen (8, 9, 15, 16, 18, 20, 24, 28) bleiben stehen und kommen als Schuld je Datei
in `schriftgroesse.schuld.ts`.

### Ratsche (`theme/schriftgroesse.guard.test.ts`)

- Neues Muster `\bmonoStil\(\s*(\d+(?:\.\d+)?)\s*[,)]` in TS/TSX zählt die Zahl als
  Schriftgrößen-Literal. Ein Regeltest am Text kommt dazu, der bisherige Test
  „`monoStil(11)` zählt nicht“ wird umgekehrt.
- Grenze 1 im Kopf lautet dann: Werte aus Variablen und Ausdrücken zählen nicht.
- `rollenwerte.test.ts` und `feld.guard.test.ts` bekommen Stufen statt Zahlen.

### Regeln: ADR und `AGENTS.md`

- ADR-0065 verbietet, dass die Schuld wächst oder einen neuen Eintrag bekommt. Die Ausreißer
  einzubuchen widerspricht dem. Deshalb kommt **ADR-0071** „Mono-Größen kommen aus Stufen der
  `schriftskala`“ mit `ersetzt: ADR-0065`. Sie übernimmt deren Regeln, ergänzt
  „`monoStil` nimmt eine Stufe, ein Zahl-Literal zählt die Ratsche“ und erlaubt die einmalige
  Einbuchung beim Einführen der Mono-Zählung. ADR-0065 bekommt `status: ersetzt`. Die Nummer
  wird vor dem PR gegen `alpha` und die offenen PRs geprüft.
- `frontend/AGENTS.md`, „`schriftskala`“: die Mono-Stufen und `monoStil(stufe)` nennen,
  13 px präzisieren.

## Dem Bauenden überlassen

Reihenfolge der Commits, die Form des Umstellungsskripts (Wegwerf, nicht committet), die Zahl
der Schuldeinträge.

## Prüfung

Typprüfung, `schriftgroesse.guard.test.ts`, `rollen.guard.test.ts`, `rollenwerte.test.ts`,
`./scripts/check-all.sh --geaendert --ohne-e2e`. Pixelgleich belegt ein Bildvergleich vorher und
nachher an 2 bis 3 Seiten mit viel Mono (Überblick, ETB, Lagemeldungen).
