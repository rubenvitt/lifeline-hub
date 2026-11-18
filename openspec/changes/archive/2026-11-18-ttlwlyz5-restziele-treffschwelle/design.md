# Design

## Context

Messwerte und Anlass stehen in `proposal.md`. Die Dichte-Staffel wirkt auf antd über Tokens und
über Kontext-Stile am `ConfigProvider` (`theme/ThemeModeProvider.tsx`: `button`, `collapse`,
`checkbox`, `radio`). Handgebaute Ziele halten ihren Boden über reine, exportierte Stilfunktionen
mit aufgelösten Tokens (`frontend/AGENTS.md`, „Handgebautes Bedienziel“).

- antds `Alert` zeichnet sein Kreuz als `button.ant-alert-close-icon` mit `fontSize` und
  `lineHeight` = `fontSizeIcon` (12 px) und `overflow: hidden` (`alert/style/index.js`), in jeder
  Stufe gleich. Der Kontext kennt `alert.styles.close` (semantischer Stil des Knopfs) und
  `alert.closable.closeIcon`.
- Der Ortspfad bekommt seine Höhe über `--lfh-ortspfad-ziel` (`ortspfadStil`, `EinsatzSeite.css`),
  eine Breite setzt niemand.
- Die Sortierauswahl des Kartenzweigs in `components/Datensicht.tsx` ist ein `Select allowClear`
  mit Platzhalter „wie geliefert“; ohne Kreuz käme man nicht mehr zu `null` zurück.

## Goals / Non-Goals

**Goals:** die drei Ziele aus der Spec-Delta auf die Stufe bringen, jeweils an der einen Stelle,
die alle Aufrufer erreicht.

**Non-Goals:**
- Kreuze anderer antd-Bauteile (Modal, Drawer, Tag): nicht gemessen und nicht Teil dieses Auftrags.
  Fällt beim Messen eines davon auf, wird es eine eigene Aufgabe.
- Löschkreuze der übrigen Auswahlfelder: die Ausnahme der Spec bleibt für sie bestehen.
- Schriftgröße der Spaltenköpfe (LLH-1956).

## Decisions

### D1 Hinweis-Kreuz: semantischer Stil am Kontext, höhenneutral

`ConfigProvider alert={{ styles: { close: hinweisKreuzStil(token) } }}` mit einer reinen,
exportierten Stilfunktion in `theme/tokens.ts` (Muster `antdKnopf`, Name nach LFH-1312):
`minWidth`/`minHeight` = `controlHeightSM`, `inline-flex` mittig, `marginBlock` =
`-(controlHeightSM − fontSizeIcon) / 2`. Die Fläche gehört dem Knopf selbst, deshalb schneidet
antds `overflow: hidden` nichts ab, und der negative Rand nimmt den Zuwachs aus dem Layout: der
Hinweis bleibt so hoch wie vorher (Muster `entfernenStil` des ETB-Entwurfstabs).

- Verworfen: `closable.closeIcon` mit eigenem Span. Der Span läge im Knopf mit `overflow: hidden`
  und würde beschnitten; außerdem ersetzt ein `closable`-Objekt an der Stelle das des Kontexts.
- Verworfen: CSS-Regel auf `.ant-alert-close-icon` in `sprache.css`. Sie bräuchte `var(--lfh-*)`
  für die Dichte, und die Regel will aufgelöste Tokens an handgebauten Zielen.
- Ein `style` an einem einzelnen `Alert` schlägt den Kontext nicht für `styles.close`; die vier
  Stellen setzen keinen.

### D2 Sortierauswahl: „wie geliefert“ als Eintrag

Erster Eintrag der Optionen ist „wie geliefert“ mit einem festen Wert, der nie Spaltenschlüssel
sein kann (`''` scheidet aus, antd behandelt leere Werte wie fehlende); seine Wahl setzt die
Sortierung auf `null`. Ohne Sortierung zeigt das Feld diesen Eintrag als Wert, nicht mehr als
Platzhalter. `allowClear` entfällt.

- Verworfen: Kreuz vergrößern. Im Feld neben der Suche (am Handy rund 160 px) bliebe kaum Platz
  für den Wert; abgestimmt am 18.11.2026.

### D3 Brotkrume: Breitenboden wie ein Knopf

`ortspfadStil` setzt zusätzlich `--lfh-ortspfad-breite` = `controlHeightSM`, `EinsatzSeite.css`
setzt `min-width` darauf und mittet den Text. Die Hover-Hinterlegung bleibt auf der Textzeile
(`background-clip: padding-box`), sie wird nur so breit wie die Fläche. Die Höhe des Seitenkopfs
ändert sich nicht.

### D4 Entwurfskreuz bleibt

Wirksam 36 × 24 / 60 × 48 / 84 × 72 px; nur die Box des Knopfs ist 14 px hoch, weil `entfernenStil`
die Fläche bewusst aus dem Layout nimmt. Kein Code.

## Risks / Trade-offs

- [Breiteres Kreuz drückt den Titel eines Hinweises in `handschuh` um rund 60 px] → Hinweise sind
  einzeilige Sätze über voller Breite; ein Umbruch bleibt möglich und ändert die Höhe nur mit dem
  Text, nicht durch das Kreuz.
- [Ein Hinweis direkt unter einem anderen Element: die überstehende Fläche (bis 30 px in
  `handschuh`) überdeckt dessen Rand] → Die Hinweise tragen `marginBottom`; der e2e-Nachweis prüft
  per `elementFromPoint`, dass das Kreuz in seiner Fläche trifft.
- [Unit-Tests, die das Sortieren über `.ant-select-clear` zurücksetzen] → heute keiner in
  `Datensicht`; Tests wählen künftig „wie geliefert“.
