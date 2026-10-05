# Design

## Context

Motivation und Messwerte: `proposal.md`. Hier nur, was den Weg bestimmt.

- `antdToken` setzt `colorPrimary = bedien`, aber nicht `colorPrimaryBg`/`colorPrimaryBgHover`.
  antd leitet beide aus der Palette von `colorPrimary` ab (Index 1 und 2); daraus folgen die
  Alias-Tokens `controlItemBgActive` und `controlItemBgActiveHover`. `colorPrimaryBg` ist kein
  Seed-Token und lässt sich über `token` überschreiben, auch nachts nach `seedTreu`.
- **Wer die Fläche zeichnet** (antd 6.6.5, `grep -rn "colorPrimaryBg\|controlItemBgActive"
  node_modules/antd/es`), getrennt nach Nutzung in der App:

  | Leser | Stelle in der App | Schrift darauf |
  | --- | --- | --- |
  | `dropdown/style` (gewählter Eintrag) | `components/StatusWahl.tsx`, `etb/Schnellerfassung.tsx` (Typwahl) | `colorPrimary` = `bedien` |
  | `select/style` (`optionSelectedBg`) | jede `Select`/`AutoComplete` (rund 90 Dateien) | `colorText`, fett |
  | `tree/style` (`nodeSelectedBg`) | `pages/EinsatzabschnittePage.tsx` | `colorText` |
  | `date-picker/style` (Bereichszellen) | eine `DatePicker`-Stelle, kein Bereich | — |
  | eigene Stellen mit `token.colorPrimaryBg` | `pages/gefahren/GefahrenPage.tsx` (gewähltes Gebiet), `pages/lagekarte/Sidebar.tsx` (Bild platzieren), `pages/uhs/Grundriss.tsx` (Drop-Ziel, drei Stellen) | Text, Beschreibung |
  | eigene Stelle mit `token.controlItemBgActive` | `etb/SlashMenu.tsx` (aktiver Eintrag) | `colorText` |
  | `menu/style` | `admin/AdminLayout.tsx` überschreibt `itemSelectedBg` schon mit `flaeche3` | — |

  Weitere Leser (Table-Zeilenauswahl, Steps, Transfer, Splitter, Cascader, Calendar,
  `Button` `variant="filled"`) nutzt die App heute nicht.
- Die Gründe, auf denen gewählt wird: Dropdown und Auswahlliste stehen auf `colorBgElevated`
  (= `flaeche2`), der Baum auf `flaeche`/`paneel`. Der Zeiger legt `controlItemBgHover`
  (Tag `rgba(0,0,0,0.04)`, Nacht `rgba(255,255,255,0.08)`) darüber.
- Die Böden schnüren den Spielraum ein. Am Tag verlangt `schwach` ≥ 7 eine relative Luminanz
  ≥ 0,75, `steuerRahmen` ≥ 3 eine ≥ 0,74; nachts verlangen `schwach` ≥ 5 und `steuerRahmen` ≥ 3
  eine Luminanz ≤ 0,010. Die Auswahl kann sich deshalb nachts nicht über die Helligkeit absetzen,
  am Tag kaum, sondern über den Farbton.

## Goals / Non-Goals

**Goals:**
- Jede Textstufe, `bedienText` und `steuerRahmen` halten auf der Auswahlfläche ihren Boden, in
  Ruhe und unter dem Zeiger, gerechnet und im Browser gemessen.
- Eine Stelle für die Auswahlfläche, für antd und für die eigenen Leser.

**Non-Goals:**
- Das Admin-Menü (`AdminLayout`): es hinterlegt die Auswahl schon mit `flaeche3`.
- Bausteine, die die App nicht nutzt (Table-Zeilenauswahl, Steps, Transfer …). Sie folgen dem
  globalen Token mit, werden aber nicht eigens gemessen.
- Das Drop-Ziel im UHS-Grundriss neu zu gestalten. Es liest weiter `colorPrimaryBg` (s. Risks).

## Decisions

### E1 — Eine neue Rolle `auswahlFlaeche`, global auf `colorPrimaryBg` gesetzt

Gewählt: neue Farbrolle `auswahlFlaeche` (Tag `#dbe7f5`, Nacht `#08172b`), gespiegelt in
`rollen.css` als `--lfh-auswahl-flaeche`, und in `antdToken`:

```ts
colorPrimaryBg: farben.auswahlFlaeche,
colorPrimaryBgHover: farben.auswahlFlaeche,
```

Gerechnet (WCAG, ΔE CIE76 gegen `flaeche2` in Ruhe und unter dem Zeiger):

| Kandidat | knappster Text | `bedien` | `steuerRahmen` | ΔE Ruhe | ΔE Zeiger |
| --- | --- | --- | --- | --- | --- |
| Tag heute `#b9c1c4` | 4,92 | 4,68 | 2,16 | 19,5 | 16,0 |
| Tag `bedienFlaeche` `#e4edf7` | 7,60 | 7,23 | 3,34 | 6,0 | **4,9** |
| **Tag `#dbe7f5`** | 7,17 | 6,83 | 3,15 | 9,2 | 7,5 |
| Nacht heute `#253a4e` | 3,39 | 3,64 | 2,13 | 19,7 | 14,1 |
| Nacht `bedienFlaeche` `#0d1620` | 5,28 | 5,66 | 3,32 | **5,0** | 11,5 |
| **Nacht `#08172b`** | 5,21 | 5,59 | 3,28 | 12,3 | 16,2 |

„Knappster Text“ ist das Minimum aus `text`, `text2`, `gedaempft`, `schwach`, `bedienText`.

Begründung: Die Fläche selbst ist der Fehler, also wird sie ersetzt, und zwar global, weil sie
überall dieselbe Bedeutung hat („das ist gewählt“). `bedienFlaeche` hielte jeden Boden, hebt sich
aber am Tag vom überfahrenen Eintrag nur um ΔE 4,9 ab und nachts vom ruhenden um 5,0; die
Auswahl wäre am Tag kaum von der Zeigerspur zu unterscheiden. Eine eigene Rolle mit mehr
Sättigung im selben Helligkeitsband verdoppelt den Abstand, ohne einen Boden zu reißen. Sie
bleibt außerdem von „belegt“ im UHS-Grundriss (`bedienFlaeche`) verschieden.

Verworfene Alternativen:
- **(A) `bedienFlaeche` global** (Vorschlag im Ticket): keine neue Rolle, aber der Abstand zur
  Zeigerspur am Tag (4,9) und zur Ruhe in der Nacht (5,0) liegt unter dem Boden aus der Spec. Im
  Grundriss fielen Drop-Ziel und „belegt“ auf dieselbe Farbe.
- **(C) Je Komponente** (`Dropdown`, `Select`, `Tree` als Komponenten-Tokens wie beim `Alert`
  in LFH-739): Die vier eigenen Leser von `token.colorPrimaryBg` blieben auf der trüben
  Ableitung, und jeder künftige antd-Baustein mit Auswahl ebenso. Beim `Alert` war die
  Komponente richtig, weil die Hinweisflächen-Tokens global auch Knopf und Eingabefeld treffen;
  `colorPrimaryBg` dagegen bedeutet überall „Auswahl“.

### E2 — Schrift des gewählten Dropdown-Eintrags in `bedienText`

antd färbt den gewählten Dropdown-Eintrag in `colorPrimary` = `bedien`; das hielte am Tag auch
auf `#dbe7f5` nur 6,83. Gewählt: Komponenten-Token `Dropdown.colorPrimary = bedienText`
(Tag 7,59, Nacht 9,53). Muster wie `Dropdown.colorError = alarmText` (LFH-693). Im Dropdown liest
`colorPrimary` sonst nur der Titel eines gewählten Untermenüs, auch Text.

Verworfen: `bedien` am Tag global dunkler. Das träfe Primärknopf, Fokusring und Schieberegler,
die gerade abgestimmt sind (LFH-661/LFH-737).

### E3 — Unter dem Zeiger keine eigene Stufe für die gewählte Option

`colorPrimaryBgHover` trägt dieselbe Rolle. Die gewählte Option ändert unter dem Zeiger ihre
Fläche nicht; die Zeigerspur zeigen alle anderen Einträge.

Begründung: Im Helligkeitsband, das die Böden lassen (Tag 0,75–0,85), liegen schon Ruhe,
Zeigerspur, `bedienFlaeche` und die Auswahl. Für eine fünfte Stufe mit ΔE ≥ 7 zu allen ist kein
Platz. Die gewählte Option ist der Ausgangspunkt der Wahl; dass der Zeiger auf ihr steht, ist
keine Information, die der Nutzer braucht. Verworfen: zweite Rolle `auswahlFlaecheZeiger`.

### E4 — Nachweis

- Unit-Test `theme/auswahlKontrast.test.ts` (Muster `hinweisKontrast.test.ts`): rechnet mit dem
  AUFGELÖSTEN Token (`getDesignToken` mit echtem Algorithmus je Modus), dass
  `controlItemBgActive`/`controlItemBgActiveHover` die Rolle tragen, jede Textstufe und
  `bedienText` den Boden halten, `steuerRahmen` ≥ 3, und ΔE ≥ 7 gegen Ruhe und Zeigerspur auf
  `flaeche2` und `flaeche`. Böden als Literale.
- Browser-Spec `e2e/auswahl-kontrast.spec.ts` mit `kontrast-kern.ts`: Statuswahl (gewählter
  Eintrag in Ruhe und unter dem Zeiger) und eine Auswahlliste (gewählte Option), Tag und Nacht.

## Risks / Trade-offs

- [Drop-Ziel im UHS-Grundriss auf einem belegten Platz] → `auswahlFlaeche` gegen `bedienFlaeche`
  liegt am Tag nur ΔE 3,2 auseinander (nachts 7,6); heute ist der Unterschied grau gegen blau.
  Ein Patient wird meist auf einen freien Platz gezogen (`flaeche`, ΔE 12). Der Rand der
  Platzkarte bleibt. Fällt es in der Abnahme auf, wird es ein eigenes Ticket für das Drop-Ziel.
- [antd liest die Auswahl in einer künftigen Version über ein anderes Token] → Der Browser-Spec
  misst die gezeichnete Farbe und fällt dann rot; der Unit-Test prüft die aufgelösten Aliase.
- [Knappe Werte] → Tag `schwach` 7,17 und `steuerRahmen` 3,15, Nacht `schwach` 5,21: wer
  `auswahlFlaeche` später verschiebt, sieht es im Unit-Test.
- [Sichtbare Tonänderung jeder gewählten Option] → Gewollt; am Tag hellblau statt grau.
