# Design

## Context

Den Grund nennt `proposal.md`, „Why“. Stand am 16.11.2026 (34be1aab):

- **Raster heute:** `dichten[*].abstand` in `frontend/src/theme/tokens.ts`:
  - kompakt 3/7/11/18
  - komfortabel 5/11/18/28
  - handschuh 7/16/26/44

  Für `kompakt` gilt: md/lg aus A1 Festlegung 4, xs/sm abgeleitet. `theme/rollen.css` spiegelt das als `--lfh-luft-1…4` je `[data-dichte]`, `rollen.guard.test.ts` hält beides deckungsgleich.
- **antd:** `antdToken()` bildet nur XS/SM/Basis/LG ab. XXS, MD und XL stehen auf antds festen Vorgaben (4/20/32), mit 121 + 46 + 21 + 3 Verwendungen.
- **Export `abstand`** (`= dichten.kompakt.abstand`): 8 Importeure, 41 Zugriffe. Sie folgen der Dichte nicht.
- **Literale:** 303 Abstands-Literale > 2 in 147 TS/TSX-Dateien, davon 27 unter `components/` (12 in `instrument/`). Dazu `<Space size={n}>`, `gap={n}` und `gutter`. In CSS stehen 96 px-Abstände, 65 davon in `hilfe/Hilfe.css` und 11 in `pages/LoginPage.css`.
- **Feste Pins:**
  - `e2e/dialogfuss-dichte.spec.ts` (`titel: 7`, `fuge: 16`), `e2e/katalogtabelle-kopf-dichte.spec.ts`
  - `theme/tokens.test.ts`, `theme/rollen.guard.test.ts`
  - Abstandswächter (`aktionsabstand`, `aktionenSpace`, `dichte`, `kopfpolsterung`, `seitenrinne`, `rahmenOben`, `katalogTabelle`, `leistenAbstand`)
  - Zahlen in `frontend/AGENTS.md`, „Aktionen“ (7/11/16, 11/18/26)
- **Untergrenzen** aus `einsatztauglichkeit-layout`: Abstand zwischen klickbaren Kennzahlen und zwischen Dialogfuß-Knöpfen mindestens 8 px in `komfortabel` und 16 px in `handschuh`.

## Goals / Non-Goals

**Goals:**
- ein Raster je Dichte, das jedes antd-Abstandstoken trägt;
- kein fester Kompakt-Export mehr;
- ein Wächter, der neue Literale verhindert und die Altlast sichtbar herunterzählt;
- der erste Schnitt der Migration in den geteilten Bausteinen.

**Non-Goals:**
- Migration der Seiten-Literale außerhalb von `components/` und der 8 `abstand`-Importeure. Das kommt als Folgeaufgabe je Bereich.
- Neue Stapel- oder Textbausteine (LLH-1810).
- Neue Bilder für die Anwenderdoku (Folgeaufgabe).
- `sizeXXS…sizeXXL`, antds Größen für Space/Flex ohne Abstandsnamen. Sie bleiben, es sei denn, die Umsetzung zeigt, dass ein Abstandsbaustein sie liest (Aufgabe 2.3).

## Decisions

**D1: Werte des Rasters (Vielfache von 4, Gleichstände zur Literal-Seite).**

| Stufe | xxs | xs | sm | md | lg | xl |
|---|---|---|---|---|---|---|
| kompakt | 4 | 4 | 8 | 12 | 16 | 24 |
| komfortabel | 4 | 4 | 12 | 20 | 28 | 40 |
| handschuh | 4 | 8 | 16 | 24 | 44 | 64 |

- Gerundet wird auf das nächste Vielfache von 4. Drei Werte liegen genau zwischen zwei Vielfachen:
  - kompakt lg 18 → 16, weil die 40 Literale 16 dann in `kompakt` ohne sichtbare Änderung umziehen.
  - komfortabel md 18 → 20 und handschuh md 26 → 24 halten die Folge xs < sm < md < lg mit sichtbaren Schritten.
- `xl` ist neu: die 1,5-fache `lg`, auf ein Vielfaches von 4 gerundet. Es trägt antds XL und die 24er-Literale.
- `xxs` bleibt fest 4, so wie antds XXS heute wirkt. Die 167 Verwendungen von `marginXXS`/`paddingXXS` ändern sich damit nicht.
  - Verworfen: `xxs = 2`. Das hätte jede Symbol-Text-Lücke in allen Stufen halbiert, ohne dass jemand danach gefragt hat.
  - Die Literale 1–2 px sind Feinsatz (D4) und brauchen keine Stufe.
- Die Untergrenzen aus `einsatztauglichkeit-layout` bleiben erfüllt: `sm` ist 12 in komfortabel (≥ 8) und 16 in handschuh (≥ 16).
- Verworfen: die Werte aus A1 behalten (Variante B, siehe Scope-Abstimmung). Dann gäbe es keine Vierer-Skala, und jeder migrierte Wert änderte `kompakt` sichtbar.
- Verworfen: zwei Achsen, ein festes Layout-Raster neben dem Dichte-Raster (Variante C). Das wären zwei Raster samt der Frage, welches gilt.

**D2: Abbildung auf antd.** `antdToken()` setzt:
- `paddingXXS`/`marginXXS` ← xxs
- XS ← xs
- SM ← sm
- Basis ← md
- MD ← lg
- LG ← lg
- XL ← xl

antd ordnet MD zwischen Basis und LG ein. Das Raster hat dazwischen keine Stufe, deshalb fällt MD mit LG zusammen. Das ist ehrlicher als ein Zwischenwert außerhalb der Vierer-Skala. `marginXXL` (heute 0 Verwendungen) bleibt bei antd. Der Typ `Abstandsraster` bekommt `xxs` und `xl`. `ABSTAND_ANTD` im Generator nennt dieselbe Abbildung.

**D3: `abstand` entfällt, Ersatz ist das Token.** Die 8 Importeure lesen `theme.useToken().token.margin*`/`padding*`: `xs`→`XS`, `sm`→`SM`, `md`→Basis, `lg`→`LG`. Wo eine Rechnung die Stufe direkt braucht (z. B. `PersonenPage`), nimmt sie `dichten[dichte].abstand`. Verworfen: `abstand` auf einen Hook umbiegen. Ein zweiter Zugang neben dem Token wäre genau die Doppelquelle, die diese Change abbaut.

**D4: Der Wächter `theme/abstandsraster.guard.test.ts`.**
- **Muster:** `cssFarbquelle.guard` und `dichte.guard`, eine reine exportierte Funktion `befunde(dateien, schuld)` mit Unit-Tests an Texten.
- **Gezählt** wird außerhalb von Kommentaren (`ohneKommentare`):
  - (a) TS/TSX: `padding*`/`margin*`/`gap`/`rowGap`/`columnGap` mit einer Zahl > 2 oder einem px-String mit einem Wert > 2;
  - (b) `<Space … size={n}>`, `gap={n}` und `gutter={n | [n, n]}` mit n > 2;
  - (c) CSS: `padding*`/`margin*`/`gap`/`row-gap`/`column-gap` mit einem px-Wert > 2, außer in `theme/rollen.css`.
- **Feinsatz ≤ 2** ist frei (Haarlinie, Symbolversatz). Diese Grenze steht im Vertrag.
- **Schuld:** eine Zahl je Datei, `SCHULD: Record<pfad, anzahl>`. Mehr Funde als die Schuld färben rot. Weniger auch: Wer abbaut, senkt die Zahl im selben Commit. So zählt die Liste die Altlast genau mit und kann nie still wieder wachsen.
- **Ausnahmen:** `AUSNAHMEN: Record<muster, grund>` für `geraet/Lagemonitor*`, `hilfe/Hilfe.css`, `pages/LoginPage.css` und `druck/**`.
- **Nicht gezählt:** Testdateien.
- **Bekannte Grenzen:**
  - Werte aus Variablen oder Rechnungen (`x * 2`) sieht der Wächter nicht.
  - Die Kurzschreibweise `padding: '8px 12px'` zählt je Wert.

Verworfen wurde ein ESLint-Regelwerk: Die Schuld je Datei ließe sich dort nur über Disable-Kommentare führen, und die Abstimmung hat ausdrücklich einen schrumpfenden Wächter gewählt.

**D5: Erster Migrationsschnitt.**
- Die Literale unter `components/instrument/` und `components/*.tsx` sowie die px-Abstände in `theme/sprache.css` und `pages/EinsaetzePage.css` ziehen auf die nächste Stufe der kompakten Zuordnung um: 4→xs, 8→sm, 12→md, 16→lg, 24→xl. In TSX geschieht das über das Token, in CSS über `--lfh-luft-*`. Ein Wert ohne Stufe (5, 6, 10, 20 …) bleibt Schuld, wenn die Stelle optisch fein abgestimmt ist. Sonst zieht er auf die nächste Stufe um, mit Begründung im Commit.
- Die rund 20 Stellen `paddingTop: 80` werden zu `flaeche.zustandOben`, ohne sichtbare Änderung.
- Alles Übrige bleibt Schuld. Die Folgeaufgaben je Bereich senken sie.

**D6: Regeltext.** Ein Spiegelstrich „Abstandsraster“ in `frontend/AGENTS.md`, Gestaltungssprache. Er nennt die Quelle (`dichten`, Token), die Stufen, den Wächter und die Ausnahmen. Die Zahlen unter „Aktionen“ werden auf die neuen Werte gezogen. Die Begründung steht in der ADR (Kapitel 9, eigene Datei), nicht in AGENTS.md.

## Risks / Trade-offs

- [Alle Token-Abstände verschieben sich um 1–2 px; in `kompakt` wird lg von 18 auf 16 kleiner, Karten und Paneele werden etwas enger] → Die Werte werden in allen drei Stufen gegen die Spec-Untergrenzen und die e2e-Pins geprüft. Bilder der geänderten Bausteine (Nacht/Tag, kompakt/handschuh) kommen in den PR, und die Anwenderdoku wird in einer Folgeaufgabe neu aufgenommen.
- [MD fällt mit LG zusammen, und eine Stelle mit `marginMD` (17) wird in `kompakt` von 20 auf 16 kleiner] → Das ist so gewollt. Die Stellen sieht das Review an den Bildern.
- [Eine Schuldliste mit rund 150 Einträgen ist Pflegeaufwand] → Die Zahl je Datei fällt beim Abbau mechanisch, und der Wächter nennt den Sollwert in der Meldung.
- [Ein vorübergehender Wächter mehr, obwohl LLH-1724 Wächter abbauen will] → Am 16.11.2026 so abgestimmt. Er entfällt, sobald die Schuld bei null ist. Das steht in seinem Kopf und in der ADR.
- [Das Design System driftet, wenn der Generator nicht nachläuft] → `designSystem.guard.test.ts` ist rot, bis `pnpm design-system` gelaufen ist. Danach wird nach dem Merge neu veröffentlicht.

## Migration Plan

Alles in einem Branch, keine Daten, kein Server.
- **Zurück:** Revert des Commits, der das Raster ändert. Wächter und Migration bleiben gültig, weil sie Stufen statt Zahlen nennen.
- **Wenn ein Pin bricht:** Die e2e-Pins, die exakte Pixel erwarten, ziehen im selben Commit wie das Raster mit.
