# Design

## Context

Siehe proposal.md, Why. Der Stand im Code:

- `frontend/src/index.css:11-21` färbt `.zeile-hervorgehoben > td` und
  `[data-lfh='datensicht-karte'].zeile-hervorgehoben` mit `#fffbe6`, unter `[data-theme='dark']`
  mit `#2b2611`. Die Klasse vergibt `Datensicht` (`HERVORGEHOBEN`), dazu Fahrzeuge, Personal,
  Personen, Tiere, Betreuung und die ETB-Zeitachse.
- Die Zeilentönungen `berichtigungZeile`, `lueckeZeile` und `problemZeile` stehen als Rollen in
  `theme/tokens.ts` (`Farbrollen`) und als `--lfh-*-zeile` in `theme/rollen.css`.
  `rollen.guard.test.ts` hält beide Seiten Wert für Wert gleich, über die Zuordnungstabelle
  Rolle → Custom Property.
- `.zeile-luecke` (`personen/betroffene.css`) setzt ihre Tönung mit dem Selektor
  `.ant-table-wrapper .ant-table-tbody > tr.zeile-luecke > td`, ausdrücklich um über antds
  Zellregel zu kommen. `.zeile-hervorgehoben > td` hat nur (0,1,1). Ob die Hervorhebung in einer
  Tabelle heute überhaupt sichtbar steht, belegt kein Test: `e2e/deeplinks-smoke.spec.ts` prüft
  nur die Klasse an der ETB-Zeile, und die ist eine Karte, keine Tabellenzeile.
- Gate 5 (`theme/gate5.guard.test.ts`) liest alle `*.ts|tsx|css|svg` unter `src/` und sucht nur
  nach Kopien bestimmter Rollenwerte (`ROLLENWERT`). Rohe Werte, die keiner Rolle gleichen,
  entgehen ihm.

## Goals / Non-Goals

**Goals:**

- Die Hervorhebung liest eine Rolle, ohne dass sich der Ton ändert.
- Die Tönung steht nachweislich als Grund einer Tabellenzelle, in beiden Modi.
- Ein roher Hex-Wert in handgeschriebenem CSS außerhalb von `theme/` wird rot.

**Non-Goals:**

- Kein rgba-Scan. Grenze 1 von Gate 5 bleibt, der Scan bleibt bei Hex.
- Keine rohen Farbwerte in TSX. Die deckt Gate 5 heute nur für Rollenwerte ab. Ein breiterer
  TSX-Scan hätte Fehlalarme in `pages/lagekarte/` (Kartenfarben) und ist ein eigener Schnitt.
- Kein Verblassen oder Zeitverhalten der Hervorhebung. Die `transition` bleibt, wie sie ist.

## Decisions

### Entscheidung 1: Neue Zeilentönung `hervorhebungZeile` statt einer vorhandenen Rolle

Entschieden am 01.10.2026 am Scope-Checkpoint, nach diesen Messwerten (WCAG; „Abhebung“ =
Kontrast der Tönung gegen die Zeile `flaeche`, „zum Hover“ = gegen `flaeche3`):

| Kandidat | Tag Abhebung · gedaempft · bedienText | Nacht Abhebung · zum Hover · gedaempft | Verworfen, weil |
| --- | --- | --- | --- |
| **`hervorhebungZeile` (`#fffbe6` / `#2b2611`)** | 1,04 · 8,09 · 8,09 | **1,24** · 1,17 · 5,86 | — gewählt |
| `achtungFlaeche` | 1,15 · 7,32 · 7,31 | 1,05 · 1,01 · 6,92 | Nachts, im Vorgabemodus, kaum vom Hover zu unterscheiden. Die Farbe ist außerdem schon die Statusfläche „Achtung“, eine angesteuerte Zeile läse sich als Warnung. |
| `lueckeZeile` | 1,11 · 7,57 · 7,57 | 1,01 · 1,05 · 7,20 | Auf der Personenseite stehen beide Tönungen in derselben Tabelle (`PersonenPage.tsx:558`), „gefunden“ und „Lücke“ wären nicht zu trennen. |
| `flaeche3` | 1,28 · **6,60** · **6,59** | 1,07 · 1,00 · 6,83 | Sie ist `rowHoverBg` der `KatalogTabelle`, also die Hover-Fläche selbst. Am Tag liegen gedämpfter Text und Link-Text unter 7 : 1 (LFH-877). |
| `bedienFlaeche` | — | — | Blau sagt „bedienbar“, nicht „hier bist du“ (LFH-315, Bedienfarbe). |

Weitere Werte der gewählten Tönung: Tag text 17,76 · text2 12,63 · achtungText 8,87 ·
alarmText 8,62 · normalText 8,82. Nacht text 12,64 · text2 9,34 · bedienText 8,01 ·
achtungText 9,46 · alarmText 5,45 · normalText 8,80. `schwach` liegt bei 6,13 (Tag) bzw. 4,05
(Nacht). Die Rolle trägt nach `textkontrast-rollen` keinen Zeilentext, Platzhalter und Ikonen
führt sie, und der leere Wert „—“ liest `gedaempft`. Gegen die Lückentönung hebt sich die Rolle
am Tag mit 1,07 ab, nachts mit 1,23.

Die Rolle kommt in die Familie der Zeilentönungen, weil sie dasselbe ist: eine Tönung, die eine
ganze Zeile auszeichnet, mit eigenem Wert je Modus. Name nach dem Muster `<anlass>Zeile`,
CSS `--lfh-hervorhebung-zeile`. Die Werte werden 1:1 übernommen. Eine Tonverschiebung gibt es
nicht, damit erfüllt sich das Akzeptanzkriterium „Tonverschiebung benannt“ als „keine“.

### Entscheidung 2: Selektor in der Form von `.zeile-luecke`

`.zeile-hervorgehoben` bekommt im Tabellenzweig den Selektor
`.ant-table-wrapper .ant-table-tbody > tr.zeile-hervorgehoben > td`. Der Kartenzweig
`[data-lfh='datensicht-karte'].zeile-hervorgehoben` bleibt. Der Grund steht in `betroffene.css`:
antds Zellregel hat (0,2,2), eine schwächere Regel hinge an der Einfügereihenfolge der
Stylesheets. Unter dem Zeiger bleibt antds Hover-Regel stärker. Das ist gewollt, sonst bekäme die
angesteuerte Zeile keine Zeigerrückmeldung.

*Alternative:* Selektor unverändert lassen und nur den Wert tauschen. Verworfen, denn das ließe
genau die Frage offen, ob die Tönung in Tabellen steht. Der Browsernachweis (Entscheidung 4)
entscheidet. Zeigt er schon für den alten Selektor die Tönung an der `td`, bleibt die Angleichung
trotzdem, damit beide Zeilentönungen derselben Form folgen.

Die `transition` bleibt an der Regel. Den Nachtblock `[data-theme='dark'] …` braucht es nicht
mehr, weil die Custom Property je Modus steht.

### Entscheidung 3: Zweite Prüfung in Gate 5 statt eines eigenen Guards

In `theme/gate5.guard.test.ts` kommt ein `it` dazu: jede Datei `*.css` außerhalb von
`/src/theme/`, Zeilen ohne Kommentar (`ohneKommentare`), Muster `#[0-9a-fA-F]{3,8}\b`. Gemeldet
wird `pfad:zeile  inhalt`. Es gibt **keine Ausnahmeliste**: heute trifft die Prüfung nur
`index.css`, nach Entscheidung 1 nichts mehr. Gate 5 ist der Ort, weil es Dateien und
Kommentarfilter schon liest und denselben Vertrag führt („Farbwert kommt aus `theme/`“). Ein
zweiter Guard läse dieselben Dateien noch einmal und bräuchte einen eigenen Selbsttest.

Den Dateikopf von Gate 5 ergänzt ein Absatz zur neuen Prüfung. Grenze 1 (rgba) gilt für sie
ausdrücklich mit.

*Alternative:* `.svg` mitscannen. Verworfen, denn SVG-Dateien tragen ihre Farben legitim selbst
(Marke, `marke/`, erzeugt per Skript).

### Entscheidung 4: Browsernachweis an einer echten Tabellenzeile

jsdom rechnet antds CSS nicht, deshalb misst das ein e2e-Spec, `e2e/hervorhebung-kontrast.spec.ts`:
je Modus (`tag`, `nacht`) ein Einsatz mit zwei Fahrzeugen, Deeplink `?fahrzeug=<id>` auf
die Fahrzeugseite (Tabelle ab `md`), dann

- Grund der `td` der angesteuerten Zeile = Grund des Rollenwerts. Den Wert liest der Test **nicht
  aus dem Produkt**, sondern als Literal (`kontrast-kern.ts`: „eine schlechte Palette muss rot
  werden“).
- Der Grund unterscheidet sich vom Grund einer zweiten Zeile unter dem Zeiger.
- Der Kennungstext der Zeile hält über `pruefe(…)` aus `kontrast-kern.ts` den Boden des Modus
  (7 bzw. 5).

**Mutationsprobe:** Die Rolle testweise auf `flaeche3` setzen, dann wird die Hover-Aussage rot.
Den Tabellenselektor testweise auf die alte Form (0,1,1) zurücksetzen und notieren, ob die
Grund-Aussage rot wird. Das beantwortet die Frage aus Entscheidung 2 mit einem Messwert.

Welche Seite und welcher Query-Parameter tatsächlich trägt, bestätigt der erste Schritt der
Umsetzung am Code (`FahrzeugePage.tsx`, `highlightId`). Passt die Fahrzeugseite nicht, nimmt der
Test eine andere `Datensicht`-Tabelle mit Deeplink, ohne dass sich Spec oder Schnitt ändern.

## Risks / Trade-offs

- [Die Tönung stand in Tabellen bisher gar nicht] → Dann wird sie mit dieser Change zum ersten Mal
  sichtbar, das wäre eine Wirkung über die reine Rollenumstellung hinaus. Sie geht in die
  Abschlussmeldung und den PR-Text, mit dem Messwert der Mutationsprobe.
- [Hex-Muster trifft Nicht-Farben, etwa `#id`-Selektoren in CSS] → `\b` und 3–8 Hexziffern
  treffen auch `#add` oder `#beef`-IDs. Heute gibt es keinen solchen Selektor (Scan am
  01.10.2026: einzige Treffer `index.css:14,20`). Ein künftiger Fehlalarm wird sichtbar rot und
  bekommt dann einen benannten Ausschluss, nicht still.
- [Neue Rolle ohne Nutzung in TSX] → Die Rolle steht in `Farbrollen`, wird aber nur aus CSS
  gelesen. Das gilt für `lueckeZeile` und `problemZeile` genauso. Die Parität hält
  `rollen.guard.test.ts`.

## Migration Plan

Keine. Reines Frontend, keine Daten. Ein Revert stellt die rohen Werte wieder her.
