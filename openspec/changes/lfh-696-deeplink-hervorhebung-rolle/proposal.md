# Proposal

## Why

Die Deeplink-Hervorhebung einer Zeile (LFH-25, `.zeile-hervorgehoben` in `frontend/src/index.css`)
trägt die rohen Farbwerte `#fffbe6` (Tag) und `#2b2611` (Nacht). Das verstößt gegen LFH-352/A0:
Farbwerte kommen nur aus `theme/tokens.ts` und `theme/rollen.css`. Der Block ist durchgerutscht,
weil Gate 5 (`theme/gate5.guard.test.ts`) in CSS nur nach Kopien von Rollenwerten sucht, nicht nach
rohen Farbwerten überhaupt (LFH-696, Folgebefund aus LFH-375).

Keine vorhandene Rolle trägt die Hervorhebung. Gemessen wurde am Scope-Checkpoint (design.md,
Entscheidung 1): `achtungFlaeche` ist nachts kaum vom Hover zu unterscheiden, `lueckeZeile` trifft
auf der Personenseite mit der Lückentönung zusammen, und `flaeche3` ist der Tabellen-Hover selbst.
Nach der Befund-7-Grenze des Token-Fundament-Spec ist eine fehlende Rolle eine eigene Entscheidung.
Am 01.10.2026 wurde entschieden, eine neue Zeilentönung einzuführen.

## What Changes

- Neue Farbrolle **`hervorhebungZeile`** in der Familie der Zeilentönungen (`berichtigungZeile`,
  `lueckeZeile`, `problemZeile`). TS-Seite in `Farbrollen` (`farbenHell`, `farbenDunkel`),
  CSS-Seite `--lfh-hervorhebung-zeile` in `theme/rollen.css`. Die Werte bleiben `#fffbe6` und
  `#2b2611`, **es gibt also keine Tonverschiebung**.
- `.zeile-hervorgehoben` in `index.css` liest die Rolle über `var(--lfh-hervorhebung-zeile)`. Der
  Nachtblock entfällt, weil die Rolle schon je Modus steht. Der Tabellenselektor wird an die Form
  von `.zeile-luecke` angeglichen, damit die Tönung nicht an der Einfügereihenfolge gegen antds
  Zellregel hängt.
- **Gate 5 bekommt eine zweite CSS-Prüfung:** kein roher Hex-Farbwert in handgeschriebenem `*.css`
  außerhalb von `src/theme/`. Heute trifft sie nur `index.css`, nach dem Fix ist sie also grün
  geboren.
- Ein Browsernachweis misst die Tönung an einer angesteuerten Tabellenzeile in beiden Modi:
  welcher Grund dort wirklich steht und welchen Kontrast der Zeilentext darauf hat.

## Capabilities

### New Capabilities

- `farbrollen-herkunft`: woher Farbwerte im Frontend kommen. Handgeschriebenes CSS außerhalb von
  `theme/` nennt keine rohen Farbwerte und liest Rollen. Ein Gate weist das nach.

### Modified Capabilities

- `farbrollen-kontrast`: neue Anforderung zur Deeplink-Hervorhebung. Die angesteuerte Zeile trägt
  eine eigene Zeilentönung, die sich vom Zeiger-Hover und von den übrigen Zeilentönungen
  unterscheidet, und der Zeilentext hält darauf die Textböden.

## Impact

- `frontend/src/theme/tokens.ts`, `frontend/src/theme/rollen.css` (neue Rolle, Parität per
  `rollen.guard.test.ts`)
- `frontend/src/index.css` (`.zeile-hervorgehoben`)
- `frontend/src/theme/gate5.guard.test.ts` (neue Prüfung)
- e2e: Kontrast- und Grundnachweis der hervorgehobenen Zeile
- `frontend/AGENTS.md`: Rollenliste und Tagmodus-Absatz nennen die neue Zeilentönung
- Nutzer der Klasse (Fahrzeuge, Personal, Personen, Tiere, Betreuung, ETB, `Datensicht`): keine
  Codeänderung, Klasse und Name bleiben
- Nur Frontend, keine API, keine Migration
