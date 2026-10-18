# Design

## Context

Die Sichtung wird heute an zwei Stellen gewählt, und zwar auf zwei verschiedene Arten:

- **Erfassung** (`personen/AufnahmeFelder.tsx`, eingebaut in `PersonErfassungModal`, in
  `pages/personen/AufnahmePage` und am UHS-Tablet): eine `Radio.Group` im Stil `outline`, in jeder
  Fläche ein `SichtungsTag`. Der Boden ist 64 px (`skFlaechenStil`), eine Abwahl gibt es nicht.
- **Nachsichtung** (`personen/SichtungDialog.tsx`, `ErfassungsModal`): ein `Select` ohne Farbe.

Die Punktfarben `sichtungsfarben` (`theme/tokens.ts`) erreichen als Vollfläche den Textboden
(Tag 7 : 1, Nacht 5 : 1, Spec `textstufen-kontrast`/`farbrollen-kontrast`) nicht. Weiß auf
`#f5222d` misst 4,08 : 1, Weiß auf `#1677ff` 4,10 : 1. `SK_REIHE` liegt lokal in
`AufnahmeFelder.tsx`, `SK_WORT` in `personMeta.ts`. Kontrasttests rechnen über
`src/test/farbmass.ts` (`kontrast`).

Gemessen (WCAG) mit den Rollen `grund`/`flaeche` (Tag `#e9ebee`/`#ffffff`, Nacht
`#08090b`/`#0f1215`):

| Fläche | Text | Text : Fläche | Fläche : Grund Tag | Fläche : Grund Nacht |
|---|---|---|---|---|
| Rot `#a8071a` | weiß | 7,75 | 6,49 | 2,57 |
| Blau `#003eb3` | weiß | 8,97 | 7,51 | 2,22 |
| Grün `#135200` | weiß | 9,40 | 7,87 | 2,12 |
| Gelb `#fadb14` | schwarz | 15,21 | 1,16 | 14,4 |
| Schwarz `#000000` | weiß | 21 | 17,6 | 1,05 |

Nachts kommen Rot, Blau, Grün und Schwarz also nicht von selbst vom Grund weg, am Tag Gelb nicht.

## Goals / Non-Goals

**Goals:**
- Ein Baustein für jede Stelle, an der eine Sichtung gewählt wird.
- Textboden ohne Ausnahme; die Wahl ist auch ohne Farbe erkennbar.
- Eine Nachsichtung kostet höchstens zwei Tipps.

**Non-Goals:**
- Die lesende Anzeige `SichtungsTag` (Listen, Karte, Druck) bleibt unverändert.
- Die Sichtung ohne Dialog im Patientenkopf baut die Change `y18v58dt-patientenkopf-bezuege`, das
  Popover in der Liste die Change `n08alz2v-betroffenenliste-zeilenaktionen`. Beide nutzen
  diesen Baustein.
- Die Sichtung ohne Netz (LLH-1138) gehört in Welle 2.

## Decisions

1. **Flächenpalette (Option B, Entscheidung Ruben 18.10.).** Ein eigener Satz
   `sichtungsflaechen` in `theme/tokens.ts` neben `sichtungsfarben`, je Kategorie mit Fläche und
   Schriftfarbe:

   | Kategorie | Fläche | Schrift |
   |---|---|---|
   | SK I | `#a8071a` | `#ffffff` |
   | SK II | `#fadb14` | `#000000` |
   | SK III | `#135200` | `#ffffff` |
   | SK IV | `#003eb3` | `#ffffff` |
   | tot | `#000000` | `#ffffff` |

   Beide Modi nutzen dieselben Töne, weil der BBK-Farbton in beiden gleich bleibt.
   - Verworfen A: ein neutrales Schild in der gesättigten Fläche. Es hält den Boden, wirkt aber
     unruhig und braucht doppelt so viel Fläche für den Text.
   - Verworfen C: eine Großschrift-Ausnahme mit 4,5 : 1. Sie widerspricht dem Textboden (LFH-643).
   - Farbliterale stehen nur in `tokens.ts` und, falls CSS sie braucht, in `theme/rollen.css`.
2. **Kante an jeder Fläche in der Textfarbe des Modus.** Das Ticket sah eine Kante nur für Gelb
   bei Tag und Schwarz bei Nacht vor. Die Messung oben zeigt aber, dass nachts auch Rot, Blau und
   Grün unter 3 : 1 bleiben. Deshalb trägt jede Fläche eine Kante von 1 px in `text`: nachts hell,
   am Tag dunkel. Das ist eine Regel ohne Fallunterscheidung. `theme/sichtungKontrast.test.ts`
   rechnet Kante gegen `grund` und `flaeche` in beiden Modi.
3. **Aktivzustand.**
   - Ohne Wahl sind alle Flächen gefüllt.
   - Mit Wahl bleibt die gewählte gefüllt und trägt ✓ vor dem Kürzel und einen Rahmen von 3 px in
     `text`.
   - Die übrigen werden zur Randform: Fläche `flaeche`, Schrift `text`, ein linker Streifen von
     8 px in der Flächenfarbe und die Kante wie oben.
   - „unverletzt“ ist immer neutral. Gewählt trägt es ✓ und den kräftigen Rahmen.
   - Der Fokusring liegt außen (`outline` 2 px in `fokus`/`bedien`, Abstand 2 px), damit er nicht
     auf der blauen SK-IV-Fläche verschwindet.
4. **Schnittstelle.**
   - `SichtungsWahl({ value, onChange, abwaehlbar, disabled, 'aria-label' })`. Mit `value`/`onChange`
     wie bei antd-Feldern hängt der Baustein direkt in einem `Form.Item`, und beide Einbauten
     bleiben Formulare.
   - `onChange(null)` nur, wenn `abwaehlbar` gesetzt ist.
   - Tastatur mit Roving-Tabindex: ein Tab-Stopp für die Gruppe, Pfeile wechseln, Leertaste und
     Enter wählen. Enter MUST NOT das Formular absenden; die Erfassungs-Norm ist zu beachten, und
     der Absenden-Weg bleibt Strg+Enter bzw. der Knopf.
5. **Maße.** Höhe `Math.max(72, token.controlHeight)`, Mindestbreite 96 px, Lücke `8` bzw. `16`
   aus der Dichte (`theme/dichte.ts`). Bei 390 px liegen die Flächen im Raster 3 × 2, ab `md` in
   einer Reihe (CSS-Grid mit `auto-fit`, `minmax(96px, 1fr)`). `skFlaechenStil` entfällt.
6. **`SK_REIHE` zentral.** Die Reihe wandert nach `personen/personMeta.ts` und wird exportiert.
   Die Dringlichkeitsreihe der UHS (LLH-1135: ungesichtet vor SK I) baut darauf auf.
7. **Kein Dropdown für die Sichtung.** Ein Komponententest am `SichtungDialog` prüft
   `radiogroup` und kein `combobox` für die Kategorie. Einen Guard über den Quelltext gibt es
   nicht: er wäre zu grob, weil `Select` für andere Felder legitim bleibt.

## Risks / Trade-offs

- [Dunkleres Rot wird als „braunrot“ gelesen] → Der Ton `#a8071a` bleibt im Rotbereich (antd
  red-8). Die Prüfung erfolgt im Bild der Doku in Tag und Nacht. Fällt sie negativ aus, gilt der
  Messwert, und Ruben wird gefragt.
- [Zwei Paletten für dieselbe Achse] → Die Kommentare an beiden Sätzen nennen die Rolle: Punkt
  für die Anzeige, Fläche für die Wahl. Der Test pinnt beide.
- [Größere Flächen verdrängen Felder in der Maske] → Das Feldbudget von vier Feldern bleibt. Die
  Höhe steigt bei 390 px um etwa 2 × 8 px, das prüft `betroffene-handy.spec.ts`.
