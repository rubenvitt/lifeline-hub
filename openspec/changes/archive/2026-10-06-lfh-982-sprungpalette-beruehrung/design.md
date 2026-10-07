# Design

## Context

Motivation: `proposal.md`, „Why“. Anforderungen: `specs/sprungpalette/spec.md`.

So steht es heute (alpha fd06e31, 06.10.2026), alles in `frontend/src/command-palette/CommandPalette.tsx`:

- Das `Modal` ist `closable={false}` und `keyboard={false}`; Esc behandelt der globale Dispatcher,
  aus der Vorschau `aufWurzelTaste` (mit `preventDefault`). Ein Tipp auf die Maske schließt
  (`onCancel`).
- Kopf: Lupe, Suchfeld, Modusanzeige, dann `<Tastenkuerzel aria-hidden>Esc</Tastenkuerzel>`.
- Zeile (`optionsZeile`): Icon, Label, Kontext, dann entweder die Kürzelmarke `b.kuerzel` (nur
  die Tastatur-Aktionen aus `TASTATUR_AKTIONEN`: Speichern, Verwerfen, Filter zurücksetzen) oder
  die ↵-Marke (nur an der aktiven Zeile sichtbar, Breite überall reserviert), dann das
  Vorschau-Ziel (`title="Vorschau (→)"`).
- Fußzeile `data-lfh="palette-fuss"`: „↵ öffnen“, „Strg ↵ neuer Tab“, je nach Zustand „→ Vorschau“
  oder „Esc zurück“, rechts die Präfix-Legende aus `modiMitPraefix()` (Zeichen als Marke,
  `kurz` als Wort, `legende` als `title`). Feste Maße, `flexWrap: 'wrap'`.
- Die Live-Region sagt in der Vorschau „Vorschau: …. Escape führt zurück.“
- Die Palette fragt keine Zeigerart ab. `useViewport()` liefert `istBeruehrung`
  (`(pointer: coarse)`, primärer Zeiger, mit `change`-Zuhörer); der Viewport-Guard verlangt diesen
  Weg für jede Zeigerfrage. Vitest stellt die Zeigerart über `setzeZeigerGrob` aus
  `test/viewport.ts` um, `test/setup.ts` setzt sie nach jedem Test zurück. In Playwright meldet
  `hasTouch: true` den groben Zeiger (`e2e/dichte-ableitung.spec.ts`).
- Ein grober Zeiger ohne gespeicherte Wahl startet in der Dichte `komfortabel` (48).

Das Ticket nennt noch einen Fußhinweis „Koordinate → Lagekarte“. Den gibt es seit der Überholung
der Palette nicht mehr (Spec: „MUST keinen Hinweis auf den Koordinatensprung tragen“); es bleibt
nichts zu erhalten.

## Goals / Non-Goals

**Goals:**
- Bei grobem Zeiger: echter Schließknopf ≥ 48 × 48 px, keine Tastenhinweise, Präfixe als Chips,
  „Öffnen“ in der Vorschau. Die Fußzeile steht bei 390 px in einer Reihe (≤ 70 px).
- Bei feinem Zeiger: kein Unterschied zu heute, alle bestehenden Palette-Tests bleiben grün.

**Non-Goals:**
- Kein Tippweg für „im neuen Tab öffnen“. Auf Touch gibt es dafür keine gängige Geste, und ein
  Knopf je Zeile kostete Platz in jeder Zeile.
- Keine Weiche nach Breite. `CommandPaletteTrigger` bleibt, wie er ist.
- Die Modulbeschreibung als zweite Zeile an Modulzeilen gehört zu einer anderen Arbeit. Sie ändert
  den linken Teil von `optionsZeile` (Label), diese Change nur die Marken rechts.

## Decisions

**D1 – Eine Weiche, am primären Zeiger.** `const { istBeruehrung } = useViewport()` einmal in
`CommandPalette`. Jede Touch-Abweichung liest diese eine Konstante. Die Breite fragt die Palette
weiterhin nicht. Grund: das Ticket und die Bedien-Leitlinie (Fükw mit schmalem Fenster hat eine
Tastatur). Folge: Ein Tablet mit angesteckter Tastatur, das weiter `coarse` meldet, sieht keine
Tastenhinweise; die Tasten wirken trotzdem. Ein 2-in-1 mit Tastatur meldet `fine` und sieht sie.

**D2 – Schließknopf im Kopf, nicht antds Schließkreuz.** Ein antd-`Button type="text"` mit
`IconKreuz`, `aria-label="Sprungpalette schließen"`, Breite und Höhe
`Math.max(48, token.controlHeight)` (Muster `CommandPaletteTrigger`), `onClick={schliesse}`.
Er steht in der Flex-Zeile des Kopfs an der Stelle der Esc-Marke. Verworfen: `closable` am Modal.
antd setzt das Kreuz absolut in die Ecke über das Suchfeld, es misst 22 px und bräuchte eigene
Maße über `styles.close`. Ein Knopf in der Kopfzeile reiht sich ein und wächst mit der Staffel.
Der Kopf wächst in Handschuh dadurch von 52 auf 72 px.

**D3 – Tastenhinweise entfallen, die Zeile bleibt.** Bei grobem Zeiger rendert `optionsZeile`
weder `b.kuerzel` noch die ↵-Marke, auch nicht ihren reservierten Platz: ohne Pfeiltasten gibt es
kein Springen, das der Platz verhindern müsste. Das Vorschau-Ziel bleibt (es ist ein Tippziel),
sein `title` heißt „Vorschau“ ohne „(→)“. Die Live-Region sagt in der Vorschau „„Zurück“ führt zur
Liste.“ statt „Escape führt zurück.“. Der Tastaturvertrag (`aufTaste`, `aufWurzelTaste`) bleibt
unangetastet.

**D4 – Präfix-Chips als antd-Knöpfe in einer Zeile.** Je Eintrag aus `modiMitPraefix()` ein
`Button` (Vorgabegröße, also Boden aus `controlHeight`), Inhalt: das Zeichen in Mono und das
Kurzwort, `title` = `legende`, `aria-pressed` = aktiver Modus. Ein Tipp setzt
`praefix + rest`; ist der Modus schon aktiv, nur `rest`. `onMouseDown` ruft `preventDefault`, damit
das Suchfeld den Fokus gar nicht erst verliert (sonst klappte die Bildschirmtastatur zu und wieder
auf); danach `inputRef.current?.focus()` für den Fall, dass der Fokus woanders stand. Die Zeile
bricht nicht um (`flexWrap: 'nowrap'`, `overflowX: 'auto'` als Rückfall): eine feste Zeilenzahl
hält die Palettenhöhe ruhig. Verworfen: `Tag.CheckableTag` (kein Boden aus der Staffel) und
`Segmentleiste` (sie hat keinen „nichts gewählt“-Zustand, der Vorgabemodus ist aber „kein Präfix“).

**D5 – „Öffnen“ in der Vorschau.** Bei grobem Zeiger trägt die Fußzeile in der Vorschau einen
`Button type="primary"` „Öffnen“, der `fuehreAus(vorschau)` ruft, also dasselbe wie ↵ dort.
Ohne ihn käme man auf Touch aus der Vorschau nur über „Zurück“ und einen zweiten Tipp an den
Datensatz. Die Fußzeile hat so in beiden Ansichten eine Reihe Knöpfe gleicher Höhe, die Palette
springt beim Wechsel nicht.

**D6 – Stile als reine Funktion.** Das Maß des Schließknopfs (`Math.max(48, controlHeight)`) kommt
als exportierte Funktion neben `palettenZeilenStil` in `zeilenStil.ts`, mit Böden als Literalen im
Test (Muster `bedienzielStil`). Vitest kann keine Höhen messen (`test/utils.tsx` rendert ohne
Theme), die Maße belegt das e2e.

**D7 – Tests.** Vitest in `CommandPalette.test.tsx`, neuer Block „Zeigerart (LFH-982)“: mit
`setzeZeigerGrob(true)` vor dem Render Schließknopf vorhanden und schließt; keine ↵-, Strg-↵-, →-
und Esc-Marken, keine Kürzelmarke an einer Aktion mit `kuerzel`; Chip „>“ setzt das Präfix, Chip
ersetzt, aktiver Chip nimmt weg; „Öffnen“ in der Vorschau; Zeigerwechsel bei offener Palette
(`sendeZeigerAenderung`). Gegenfall feiner Zeiger: Esc-Marke, Fußzeile mit Tasten, kein Knopf,
keine Chips. Mutationsprobe: `istBeruehrung` durch `false` ersetzt macht den Touch-Block rot,
durch `true` den Gegenfall. e2e in `e2e/command-palette.spec.ts` mit `hasTouch` bei 390 × 844 und
820 × 1180: Schließknopf antippen (`tap`, nicht nur sichtbar), Maß ≥ 48 über `haeltStufe` und
Breite, Fußzeile ≤ 70 px (eine Reihe 48er-Knöpfe plus Polsterung), Chip „@“ antippen. Dieselbe
Messung einmal als Beobachter über `e2e/rollen-kern.ts` (`wechsleZuRolle`), weil der
Palette-Inhalt von der Rolle abhängt.

## Risks / Trade-offs

- [Fußzeile nicht flacher] Das Ticket verlangte eine niedrigere Fußzeile als „rund 95 px“. Das
  war der Stand vor der Überholung der Palette; heute misst die Tasten-Fußzeile bei 390 px 51 px
  (zwei Zeilen Marken). Die Touch-Fußzeile misst in komfortabel 59 px, weil echte Tippziele den
  Boden 48 tragen. Bewusst: 8 px mehr für Ziele, die etwas tun, statt Marken, die nichts tun.
  Ziele unter 48 px wären der Rückschritt, den die Bedien-Leitlinie verbietet.

- [Chips bei 390 px in Handschuh] Drei Knöpfe mit 72 px Boden und „Personen & Kräfte“ passen
  womöglich nicht in 340 px. → Die Zeile scrollt dann waagerecht, statt umzubrechen. Gemessen wird
  im e2e in komfortabel; Handschuh wird beobachtet und das Ergebnis in `tasks.md` notiert.
- [Tablet mit Tastatur] sieht keine Tastenhinweise (D1). Bewusst: die Zeigerart ist das Signal,
  das der Rest der App schon für die Dichte nutzt.
- [Überschneidung Modulbeschreibung] Beide Arbeiten ändern `optionsZeile`. Der Konflikt ist klein
  (unterschiedliche Kinder der Zeile); wer zweit merged, löst ihn.
