# Proposal

## Why

Schriftgröße, Abstand und Feldbreite werden heute an jeder Stelle als Inline-Stil neu gesetzt
(3.553 `style={` in 706 TSX-Dateien; `fontSize` 12 ×121, 13 ×52, 11 ×35, 15 ×15, davon 13 und 15
keine Stufe der `schriftskala`). Damit eine neue Seite korrekt aussieht, muss man viel Regeltext
kennen, und Wächter wie `feldbreiten.guard.test.ts` fangen Fehler erst nachträglich. Bausteine,
die nur erlaubte Werte annehmen, machen die richtige Form zur einfachsten. Abstandsraster
(LLH-1809), Bausteinkarten (LLH-1807) und die Bausteinwahl (LLH-1808) sind gemergt; darauf baut
diese Change auf (LLH-1810).

## What Changes

- Neue Stufe `kartentitel` (15/600, Familie `text`) in der `schriftskala` samt CSS-Spiegel
  `--lfh-typo-kartentitel-*`.
- Vier Bausteine in `components/instrument/`:
  - `Textstufe`: Text in einer Stufe der Skala und einem Ton (`text`, `text2`, `gedaempft`,
    `schwach`, `alarm`), wählbares Element. Größen fest, unabhängig von der Dichte.
  - `Stapel`: Flex-Container, `abstand` nur als Rasterstufe `xxs`…`xl` der aktiven Dichte,
    `richtung` `spalte` (Vorgabe) oder `zeile`, `umbruch`, `ausrichten`.
  - `MetaZeile` mit `MetaZeile.Teil`: Angaben in `textKlein`/`schwach`, Trenner „·“ vor dem
    Screenreader versteckt, leere Teile samt Trenner weg, `mono` für Zahl, Zeit, Kennzeichen.
  - `Feld`: Hülle um antds `Form.Item` mit `breite` `kurz` (120) · `schmal` (200) · `mittel`
    (320) · `voll`; das Steuerelement ist immer 100 % breit bis zur Obergrenze.
- Pilot im Verwaltungsteil (`stammdaten/`, `karten/`, `pages/einstellungen/`,
  `pages/BenutzerPage.tsx`): Schriftgrößen-, Stapel-, Meta- und Feldbreiten-Inline-Stile auf die
  Bausteine umgestellt; 13-px-Stellen rasten auf `text` oder `textKlein`, 15-px-Kartentitel auf
  `kartentitel`.
- **BREAKING (Projektregel):** `components/feldbreiten.guard.test.ts` entfällt; an seine Stelle
  tritt ein Wächter, der im Pilotbereich ein Eingabefeld mit eigener `width` außerhalb von `Feld`
  ablehnt.
- Neuer Ratschen-Wächter `theme/schriftgroesse.guard.test.ts` mit Schuld-Datei
  `schriftgroesse.schuld.ts`: neue `fontSize`-Zahl-Literale sind verboten, die Schuld je Datei
  sinkt nur.
- `frontend/AGENTS.md` (Abschnitte „Gestaltungssprache“ → Bausteine und Schrift, „Bausteinwahl“)
  und Design-System-Karten nachgezogen; Regeltext, den die Bausteine überflüssig machen, fällt.
- Übrige Bereiche (ETB, Einsatzmodule, Rahmen) kommen als Folgeaufgaben je Bereich.

## Capabilities

### New Capabilities
- `schriftstufen`: Text erscheint nur in benannten Stufen einer festen Skala und in benannten
  Tönen; Metaangaben folgen einer gemeinsamen Form; neue freie Schriftgrößen sind ausgeschlossen.
- `feldbreiten`: Eingabefelder sind fluid bis zu einer benannten Obergrenze und ragen an keinem
  Schirm über den Rand.

### Modified Capabilities
- `abstandsraster`: Ein Layoutbaustein für Stapel und Zeilen nimmt seinen Abstand nur als
  benannte Rasterstufe an.

## Impact

- Frontend: `theme/tokens.ts`, `theme/rollen.css` (Skala), `components/instrument/` (vier neue
  Bausteine, `index.ts`), rund 60 Dateien im Pilotbereich, zwei Wächter neu, einer entfällt,
  `abstandsraster.schuld.ts` sinkt mit.
- Design System: neue Karten unter `docs/design/design-system/project/components/`, Generator
  `frontend/scripts/design-system/previews.tsx`; Neuveröffentlichung nach dem Merge.
- Regeln: `frontend/AGENTS.md`. Kein Backend, keine API, keine Migration.
- Entwurf: `docs/design/2026-11-18-text-stapel-meta-feld/`.
