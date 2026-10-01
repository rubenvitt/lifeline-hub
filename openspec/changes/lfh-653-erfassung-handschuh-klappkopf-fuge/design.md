# Design

## Context

Motivation in `proposal.md` („Why“), Anforderungen in `specs/einsatztauglichkeit-layout/spec.md`.

Stand heute (antd 6.6.5, Dichte über `ThemeModeProvider` → `ConfigProvider`):

- **Klappkopf.** `antd/es/collapse/style/index.js` setzt den Kopf als Flex-Zeile mit
  `alignItems: 'flex-start'`, `padding: headerPadding` (= `paddingSM` × `padding`) und
  `lineHeight`. Höhe = `fontSize · lineHeight + 2 · paddingSM`: 13,5 · 1,5714 + 14 ≈ 36 ·
  15 · 1,5714 + 22 ≈ 45,6 · 15 · 1,5714 + 32 ≈ 55,6. Das deckt sich mit der Messung
  36 / 45 / 55. Es gibt rund 25 `Collapse`-Stellen ohne gemeinsamen Baustein, darunter
  Erfassungsmasken („Weitere Angaben“), das Lagebericht-Akkordeon, `AuftragKarte`,
  `FreiesZeichenPicker` (Lagekarte) und `GefahrenMatrixAuszug`. Die meisten tragen `ghost`,
  keine trägt `size`.
- **Erfassungsfuß.** `components/Erfassung.tsx` rendert die Knöpfe in einem `<Space>` ohne
  `size`. antd nimmt dafür `paddingXS`, und `antdToken` setzt das auf `abstand.xs` = 3 / 5 / 7.
  Der Primärknopf trägt `danger={unumkehrbar}`.
- **antds eigene Füße.** Modal-Fuß: `> .ant-btn + .ant-btn { marginInlineStart: marginXS }`
  (`modal/style/index.js`). `modal.confirm`: dieselbe Regel unter `-confirm-btns`
  (`modal/style/confirm.js`). `Popconfirm`: `-buttons button { marginInlineStart: marginXS }`.
  `marginXS` ist bei uns `abstand.xs`. Daher die 3 / 5 / 7 px in jeder Rückfrage.
- **Vorhandene Muster.** `antdKnopf(dichte)` setzt den Knopfboden über den Kontext, weil er so
  auch antds selbstgebaute Knöpfe erreicht (LFH-381). `antdKomponenten(farben, dichte)` trägt
  dichteabhängige Komponenten-Tokens (`Switch`, LFH-380), nachgewiesen am erzeugten CSS der
  `css-var-…`-Klasse (`ThemeModeProvider.test.tsx`). Handgebaute Bedienziele nehmen
  `minHeight: controlHeight` plus Polsterung (LFH-365).

## Goals / Non-Goals

**Goals**

- Böden aus der Spec an jeder Stelle auf einmal, ohne Änderung an den Verbrauchern.
- `kompakt` behält Höhe und Bild des Klappkopfs.
- Jeder Wert steht in einer reinen, exportierten Funktion und wird mit Literalen geprüft.

**Non-Goals**

- Freie Aktionsreihen außerhalb von Dialogfüßen. Die hält der Abstands-Guard
  (`aktionsabstand.guard.test.ts`) weiter je Datei.
- Die Abstände des Modal-Titels und des Modal-Inhalts. Die bleiben, wie sie sind.

## Decisions

### D1 · Klappkopf über den Kontext: `minHeight` plus Mittellage

Eine reine Funktion `antdKlappkopf(dichte)` in `theme/tokens.ts` liefert die
`ConfigProvider`-Einstellung `collapse`:
`{ styles: { header: { minHeight: dichten[dichte].zeilenhoehe, alignItems: 'center' } } }`.
`ThemeModeProvider` reicht sie neben `button={knopf}` durch. Die Polsterung bleibt antds
`paddingSM`/`padding`, die schon der Staffel folgen. Das sind die „zwei Angaben“ aus LFH-365:
Boden plus Polsterung. In `kompakt` liegt der Inhalt mit 36 px über dem 30-px-Boden, der Kopf
bleibt also gleich. `alignItems: 'center'` hält die Beschriftung und den Pfeil in der Mitte.
Sonst klebten sie im 72-px-Kopf oben.

Warum `dichten[dichte].zeilenhoehe` und nicht das Token: Die Kontext-Einstellung sieht kein
Token. Der Wert stammt aus derselben Zeile, aus der `antdToken` `controlHeight` setzt. So
gibt es eine Quelle.

Erwogene Alternativen:

- **B · je Stelle** `styles={{ header: … }}` nach LFH-365. Das wären rund 25 Dateien, und
  jede neue Stelle müsste daran denken. Verworfen.
- **C · gemeinsamer Baustein „Weitere Angaben“.** Das ist ein Umbau aller Erfassungsmasken.
  Akkordeon, Auftragkarte und Lagekarte deckt er trotzdem nicht. Verworfen.
- **D · Komponenten-Token `headerPadding` aus der Schriftmetrik rechnen**
  (`(controlHeight − fontSize · lineHeight) / 2`). Die Höhe hinge dann an Rundung und
  Zeilenhöhe der Schrift. Ein Schriftwechsel bräche den Boden still. Ohne `max` würde `kompakt`
  auf 30 px gekürzt. Verworfen: ein Boden ist eine Mindesthöhe, keine errechnete Polsterung.

### D2 · Der Fußabstand ist `abstand.md` (11 / 18 / 26 px)

Dieselbe Stufe, die `<Space size="middle">` liefert (`token.padding`). Die Regel „Rot steht
nicht bündig neben Neutralem“ (LFH-363) verlangt sie schon für Aktionsreihen mit `danger`.
In einer Rückfrage steht fast immer ein roter Knopf neben „Abbrechen“. Damit gilt:
`komfortabel` 18 ≥ 8, `handschuh` 26 ≥ 16.

Erwogene Alternativen:

- **`abstand.sm` (7 / 11 / 16).** Das trifft den Handschuh-Boden genau. In `kompakt` blieben
  aber 7 px zwischen Rot und Neutral. Das ist „bündig“ im Sinne von LFH-363, denn der Guard
  verlangt mehr als `marginSM`. Verworfen.
- **`kompakt` unverändert (3 px) lassen.** Die Leitlinie nimmt `kompakt` vom Zielabstand aus,
  LFH-363 aber nicht vom Abstand zu Rot. Verworfen.

### D3 · Erfassungsfuß: `<Space size="middle">`, Hülle in den Guard

`components/Erfassung.tsx` bekommt `size="middle"` am Knopf-`<Space>`.
`components/Erfassung.tsx` wird in `MIT_NACHBARSCHAFT` von `aktionsabstand.guard.test.ts`
aufgenommen. Der Scanner sieht `danger={unumkehrbar}` als destruktiv und zählt drei
`<Button>`. Er wird mit der Aufnahme rot und mit `size="middle"` grün, das ist der TDD-Schritt.
Die Zeile „Werte behalten“ darüber (`gap: marginXS`) trägt keine Knopfnachbarschaft und
bleibt.

### D4 · antds eigene Füße: Komponenten-Token `marginXS` für `Modal` und `Popconfirm`

`antdKomponenten(farben, dichte)` setzt zusätzlich:

- `Modal: { marginXS: abstand.md, headerMarginBottom: abstand.xs }`
- `Popconfirm: { marginXS: abstand.md }`

antd erlaubt, ein globales Token je Komponente zu überschreiben. Die Fußregeln von Modal,
`modal.confirm` (eigener Stil, aber derselbe Komponentenschlüssel `Modal`) und Popconfirm lesen
dann den weiten Wert. `headerMarginBottom` leitet antd aus `marginXS` ab
(`prepareComponentToken`). Es wird auf den bisherigen Wert gepinnt, damit der Abstand zwischen
Titel und Inhalt bleibt (Spec, Szenario „Dialog mit Standardfuß“).

Bewusst hingenommene Nebenwirkungen in diesen Komponenten (gleiche Richtung, mehr Luft):
`modal.confirm` trennt Titel und Text mit `rowGap: marginXS`. Popconfirm trennt Nachricht und
Knöpfe sowie Warnsymbol und Titel mit `marginXS`. Der Außenrand eines Modals unter 576 px
Breite (`margin: marginXS auto`) wächst ebenfalls. Alle drei wachsen in `handschuh` von 7 auf
26 px.

Erwogene Alternativen:

- **D · CSS-Regel in `theme/sprache.css`** mit einer Dichte-Variable aus `rollen.css`
  (`[data-dichte] .ant-modal-footer > .ant-btn + .ant-btn { margin-inline-start: … }`). Sie
  hätte keine Nebenwirkungen, müsste aber die Spezifität der cssinjs-Selektoren schlagen
  (`:where(.css-var-…)` plus vier Klassen) und ginge am Token-Modell vorbei. Sie bleibt der
  Rückweg, falls D4 im cssVar-Modus nicht greift (s. Risiken).
- **E · `ConfigProvider modal.okButtonProps.style.marginInlineStart`.** Popconfirm hat diese
  Einstellung im Kontext nicht, ob `modal.confirm` sie liest, ist unsicher, und sie hängt an der
  Knopfreihenfolge. Verworfen.
- **Globales `marginXS` anheben.** Das ändert jede Komponente, die `marginXS` liest. Verworfen.

### D5 · Nachweis

- **Unit, `theme/tokens.test.ts`:** `antdKlappkopf` mit Literalen 30 / 48 / 72 und
  `alignItems: 'center'`. `antdKomponenten(…).Modal.marginXS` und `.Popconfirm.marginXS` =
  11 / 18 / 26, `.Modal.headerMarginBottom` = 3 / 5 / 7. Dazu die Ungleichungen ≥ 16
  (`handschuh`) und ≥ 8 (`komfortabel`).
- **Unit, `theme/ThemeModeProvider.test.tsx`:** nach dem Muster „Switch folgt der Staffel bis
  in den CSS-Text“ in `handschuh` ein offenes `<Modal>` mit Standardfuß und ein offenes
  `Popconfirm` rendern. Das erzeugte CSS ihrer `css-var-…`-Klasse trägt den weiten Abstand.
  Der Klappkopf eines gerenderten `Collapse` trägt `min-height: 72px` als Stil. Dieser Test
  belegt zugleich, dass D4 im cssVar-Modus greift.
- **Guard:** `aktionsabstand.guard.test.ts` mit der Hülle (D3).
- **e2e, `e2e/dokumente.spec.ts` „Dichte-Staffel …“:** Aus „nur gemessen“ wird zugesichert.
  Klappkopf ≥ `soll` (30 / 48 / 72). Fuge Abbrechen │ Ablegen ≥ 16 in `handschuh` und ≥ 8 in
  `komfortabel`, in `kompakt` gemessen und annotiert. Neu: die Bestätigungsblase „Entfernen“
  öffnen und die Fuge zwischen ihren Knöpfen mit denselben Böden messen. Böden stehen als
  Literale in der Tabelle `STAFFEL`.
- **Mutationsprobe** „Stufe festgenagelt → rot“: In `antdKlappkopf` und im Fußabstand von
  `antdKomponenten` testweise `dichten.kompakt` statt `dichten[dichte]` einsetzen. Erwartet
  wird: e2e `komfortabel`/`handschuh` rot, ebenso die Unit-Literale. Danach zurückdrehen und das
  Ergebnis in `tasks.md` vermerken.

## Risks / Trade-offs

- [Die Komponenten-Überschreibung eines globalen Tokens wirkt im cssVar-Modus nicht] → Der
  CSS-Nachweis in `ThemeModeProvider.test.tsx` ist der erste TDD-Schritt für D4. Bleibt er rot,
  gilt Rückweg D. Das wird mit `/opsx:update` in diesem Design nachgezogen, bevor
  weitergebaut wird.
- [Höhere Klappköpfe verschieben enge Layouts: Lagekarte-Zeichenwahl, Lagebericht-Akkordeon,
  Auftragkarte] → Das betrifft nur `komfortabel`/`handschuh`, wo der Boden ohnehin gilt. Das
  ganze e2e-Gate läuft mit, darunter Gate 3 und „Fokus nie verdeckt“ im Ablegen-Dialog (der
  Dialog scrollt in `handschuh` schon heute in seiner Hülle).
- [Ein lokales `styles.header` an einer Stelle verdrängt den Kontext-Stil] → antd führt
  Kontext- und Komponenten-`styles` zusammen. Vor der Umsetzung
  `grep -n -A6 '<Collapse' frontend/src` auf `styles=` durchsehen und Treffer prüfen.
- [Rückfragen in `kompakt` sehen anders aus: 11 statt 3 px] → Das ist beabsichtigt (D2). Die
  Knopfhöhe ändert sich nicht.
- [Popconfirm mit Warnsymbol: 26 px zwischen Symbol und Titel in `handschuh`] → Das ist
  sichtbar, aber unschädlich und hingenommen (D4). Wenn es stört, folgt ein Nachzug für ein
  eigenes Symbol-Token.

## Migration Plan

Reine Frontend-Änderung, kein Datenbestand, keine API. Rückweg: Revert des Commits.
