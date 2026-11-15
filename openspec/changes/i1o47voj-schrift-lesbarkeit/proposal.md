# Proposal

Epic LLH-1719 „Design System: Schrift und Lesbarkeit“ (Zunder:
https://zunder.rubeen.dev/#/aufgabe/i1o47vojh2fap2ng9davmw3a), Unteraufgaben LLH-1773, LLH-1774,
LLH-1775, LLH-1776 und LLH-1777. LLH-1772 (Schrift-Reset in `index.css`) läuft ohne Change vorweg
im selben Branch.

## Why

Die UI/UX-Analyse vom 12.11.2026 (LLH-1714) hat über 16 Kernseiten in fünf Kontexten gemessen: Am
Fükw liegen 26,7 % der Zeichen unter 12 px, am Handy 33,9 %. 16,7 % sind höchstens 10 px, der
Seitentitel ist so groß wie der Lauftext, und gerendert werden 14 Größen in 46 Kombinationen. Die
Schrift wächst nicht mit der Bediendichte, nur antds Grundschrift tut es (rund 22 % der Zeichen),
und der Zoom ist gesperrt. Versalien mit Sperrung bei 9–10 px tragen die Feldetiketten, und 13 %
aller Zeichen sind Wörter in Mono. Wer im Einsatz mit Abstand, Handschuh oder müden Augen liest,
liest das schlecht.

## What Changes

- **Sechs Größenstufen** ersetzen die freie Wahl: 11 / 12 / 14 / 16 / 22 / 32 px. Die Rollen der
  Schriftskala (`seitentitel`, `meta`, `augenbraue` …) bleiben als Kombination aus Stufe, Gewicht
  und Familie bestehen. 9, 10, 13, 13,5, 15, 30 und 40 px fallen weg.
- **Anheben:** antds Grundschrift 13,5 → 14, `augenbraue` 10 → 11 (Sperrung .14 → .08em),
  `railEtikett` 9 → 11, `meta` 11 → 12, Seitentitel und Uhr 14 → 16. Neue Rolle `warnung` (14/600)
  für Warnhinweise.
- **Kopplung an die Dichte:** Die Stufen bis 16 px wachsen mit dem Faktor 1 / 1,15 / 1,25
  (`kompakt` / `komfortabel` / `handschuh`), auch antds Schriftgrößen. Die Datenwerte (22, 32)
  bleiben fest.
- **BREAKING (Bedienung): Der Zoom ist frei.** Der Viewport sperrt ihn nicht mehr. Die Regel „Kein
  Zoom wie in einer App“ (LLH-1328) wird umgekehrt.
- **Keine Größen-Literale mehr:** alle `fontSize`-Literale (rund 240 in 180 Dateien), alle
  `monoStil(<px>)`-Aufrufe (rund 400) und die `font-size`-Literale in CSS laufen auf die Stufen. Ein
  Wächter verbietet neue, ohne Schuldmenge. Ausgenommen sind Druck-CSS (pt) und die
  Fernsicht-Skala des Lagemonitors.
- **Neue Bausteine:** `Schrift` (Text in einer Stufe) und `Feldetikett` (Feldetikett gemischt
  geschrieben, Stufe `klein`, Textstufe `gedaempft`). `Datenfeld`, `DatenfeldEingabe` und
  `FeldLabel` tragen das Feldetikett. Die Augenbraue bleibt Paneelköpfen, Kennzahl-Titeln,
  Tabellenköpfen und dem Rail-Etikett.
- **Mono-Grenze:** `meta` wechselt auf Archivo mit `tabular-nums`. `monoStil` wird zu
  `zahlStil(stufe)` und trägt nur noch Zahl, Zeit, Kennung und Funkrufname. Gemischte Knoten
  stehen ganz in Archivo.
- Die Regeln dazu kommen in `frontend/AGENTS.md`. Sie kehren Teile des Neuentwurfs vom 21.09.2026
  um (Augenbraue als Feldetikett, Mono-Meta, kein Zoom) und tragen die Marke
  „umgekehrt 15.11.2026“. Das Design System wird neu erzeugt.

## Capabilities

### New Capabilities

- `schriftskala`: die Größe der Schrift: sechs Stufen als einzige Quelle, Boden 11 px,
  Seitentitel über dem Lauftext, Warnhinweise mindestens 14 px, Kopplung an die Bediendichte, kein
  Größen-Literal außerhalb des Themes, freier Zoom.
- `schriftrollen`: Familie und Schreibweise: Mono nur für Zahl, Zeit, Kennung und Funkrufname;
  Versalien mit Sperrung nur für Paneelköpfe, Kennzahl-Titel, Tabellenköpfe und Rail-Etikett;
  Feldetiketten gemischt geschrieben.

### Modified Capabilities

- `einsatztauglichkeit-layout`: Die Brotkrume trägt künftig die Stufe `klein` der Schriftskala
  und wächst mit der Dichte, statt in jeder Stufe 12 px zu bleiben. In `kompakt` bleibt sie
  12 px, und der Seitenkopf bleibt 44 px hoch.

## Impact

- **Theme:** `theme/tokens.ts` (`schriftskala`, `dichten`, `antdToken`), `theme/rollen.css`,
  `theme/sprache.css`, `index.html` (Viewport), die Wächter `rollen.guard.test.ts`,
  `tokens.test.ts`, `keinZoom.guard.test.ts` (wird zum Gegenwächter), neue Wächter für Literale.
- **Bausteine:** `components/instrument/` (`rollenwerte.ts`, `Augenbraue`, `Datenraster`, neue
  `Schrift` und `Feldetikett`), `Kopfleiste.tsx` (Uhr, Rail-Etikett), Seitenkopf.
- **Bestand:** rund 180 TS/TSX-Dateien und 12 CSS-Dateien im ganzen Frontend werden umgestellt.
  Sichtbar ist das in jedem Modul: die meisten Texte werden 1–2 px größer, in `komfortabel` und
  `handschuh` deutlich größer.
- **Tests:** e2e-Maße (Trefffläche, Seitenkopf, Rail-Etikett, Brotkrume, Kontrast der Augenbraue)
  ziehen nach; Anwender-Doku-Bilder ändern sich mit.
- **Design System:** `pnpm -C frontend design-system`, Veröffentlichung nach dem Merge.
- Kein Backend, keine API, keine Migration.
