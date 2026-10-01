# Proposal

## Why

Die Textstufe `schwach` trägt jede Augenbraue (10 px, Versalien), die Platzhalter (bei
mehreren Filtern die einzige Beschriftung), die Feldhilfe in Dialogen und über antds
`colorTextTertiary`/`colorTextDescription` weiteren echten Text. Am Tag liegt sie bei 5,33 : 1
auf `grund`, auf `flaeche3` bei 4,99 und auf der überfälligen Ablösungskarte (`alarmFlaeche`)
bei 5,20. Nachts erreicht die Feldhilfe im Dialog 4,81 und bleibt damit unter dem Nachtboden 5.
Für Tertiärtext ist kein Boden festgelegt: `tokens.ts` vergleicht den Wert nur mit dem bisherigen
Stand, und vier Browser-Gates führen ihn bis zu dieser Entscheidung als benannte Ausnahme mit
4,5 : 1 (LFH-618 Befund 8, Kommentar aus LFH-646).

Beim Nachrechnen kam eine zweite Lücke heraus. Am Tag hält auch `gedaempft` (`#474e57`) den
Tagesboden nicht überall: 6,60 auf `flaeche3`, 6,86 auf `alarmFlaeche`. Hebt man nur `schwach`
an, fällt die Rangfolge der beiden Stufen zusammen. Die Textstufen müssen deshalb gemeinsam
festgelegt werden.

## What Changes

- **Ein Boden für jeden Text im Inhalt, auch für Tertiärtext:** Tag ≥ 7 : 1, Nacht ≥ 5 : 1 auf
  jeder deckenden Fläche, auf der die Stufe steht. Ausgenommen bleibt nur Gesperrtes (WCAG 1.4.3
  nimmt inaktive Komponenten aus), wie heute im Rahmen.
- **Tagesleiter neu gestuft:** `schwach` `#58606a` → `#424a53`, `gedaempft` `#474e57` →
  `#363d45`. `text` und `text2` bleiben. Die Rangfolge bleibt messbar: zwischen benachbarten
  Stufen liegen mindestens 5 Einheiten Helligkeit (ΔL\*).
- **Nacht:** `schwach` `#7d858e` → `#838b94` (≥ 5,11 auf jeder Fläche, die Dialogfläche
  eingeschlossen). `gedaempft` bleibt. `rahmenFarben.gesperrt` folgt `schwach` weiter und hält
  seine Prüfungen (≥ 4,5 auf dem Leistengrund, Abstand zu `gedaempft` > 1,4).
- **Abgeleitete Werte ziehen mit:** ETB-System-Kante und -Wort, `--lfh-rahmen-gesperrt`, die
  Kontrastangaben an den Werten in `tokens.ts`.
- **Wächter:** ein Unit-Test rechnet jede Textstufe in beiden Betriebsarten gegen jede deckende
  Fläche und prüft den ΔL\*-Abstand der Stufen. Er ersetzt den Vergleich mit dem bisherigen
  Stand.
- **Ausnahmen fallen:** Die `TERTIAER`-Ausnahme in `abloesung-`, `verpflegung-` und
  `betreuung-`Gate und die beiden 4,5-Messungen „(LFH-643)“ im `betroffene-kontrast`-Gate
  messen künftig gegen den vollen Boden.
- **Browsermessung der Augenbraue** auf `grund`, `paneel` und `flaeche` in beiden
  Betriebsarten, mit dem Messkern `e2e/kontrast-kern.ts`.
- `frontend/AGENTS.md` (Farbachsen, Tagmodus) nennt den Boden für alle Textstufen.

## Capabilities

### New Capabilities

- `textstufen-kontrast`: die Textstufen der Oberfläche (`text`, `text2`, `gedaempft`, `schwach`)
  in Tag und Nacht. Sie legt fest, welchen Kontrastboden jede Stufe auf welchen Flächen hält,
  wie weit benachbarte Stufen mindestens auseinanderliegen und wo die Ausnahme für Gesperrtes
  gilt.

### Modified Capabilities

(keine)

## Impact

- `frontend/src/theme/tokens.ts`, `frontend/src/theme/rollen.css` (Werte und Kommentare),
  `frontend/src/theme/rahmenKontrast.test.ts` (Messangabe für `gesperrt`), neuer Wächter unter
  `frontend/src/theme/`.
- e2e: `abloesung-kontrast`, `verpflegung-kontrast`, `betreuung-pruefliste`,
  `betroffene-kontrast` (Ausnahmen entfernen), `hellmodus-kontrast` (Augenbraue).
- Sichtbar: Am Tag werden Augenbrauen, Metazeilen, Platzhalter und Feldhilfen dunkler, und
  Sekundärtext (`gedaempft`) wird eine Spur dunkler. Nachts wird Tertiärtext leicht heller.
  Statusfarben, Flächen und der Rahmen ändern sich nicht.
- Kein Backend, keine Migration, keine API.
- `docs/superpowers/specs/2026-09-22-lfh-618-hellmodus-pruefliste.md` bleibt eingefroren.
  Befund 8 wird dort nicht nachgetragen, die Auflösung steht in dieser Change.
