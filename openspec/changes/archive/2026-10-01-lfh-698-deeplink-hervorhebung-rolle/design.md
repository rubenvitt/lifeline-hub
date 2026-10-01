# Design

## Context

Motivation: siehe `proposal.md`, Abschnitt „Why“. Anforderungen: `specs/deeplink-hervorhebung`
und `specs/css-farbquelle`.

Ist-Stand, der den Entwurf bestimmt:

- `frontend/src/index.css:10-21` färbt `.zeile-hervorgehoben > td` und die Datensicht-Karte mit
  `#fffbe6` / `#2b2611`. Gesetzt wird die Klasse von `Datensicht` (`zeilenKlasse`,
  `HERVORGEHOBEN`) und direkt von Seiten (`FahrzeugePage`, `PersonalPage`, `PersonenPage`,
  `TierePage`, `EtbZeitachse` u. a.). Sie bleibt nach dem Sprung stehen, sie blendet nicht aus.
- Der Hover einer Katalogtabelle ist `rowHoverBg: flaeche3` (`components/KatalogTabelle.tsx`,
  `tabellenTokens`). Die Lückentönung (`personen/betroffene.css`) hebt ihre Spezifität bewusst
  über antds Zellregel (`.ant-table-wrapper .ant-table-tbody > tr > td`, (0,2,2) hinter
  `:where(…)`); die heutige Hervorhebung steht mit (0,1,1) darunter. Ob sie im Browser überhaupt
  sichtbar wird oder nur an der Einfügereihenfolge hängt, ist **nicht** belegt und wird in
  Aufgabe 1 gemessen.
- Katalogtabellen fixieren die menschenlesbare Kennung (Bedien-Leitlinie). antd gibt fixierten
  Zellen einen eigenen deckenden Grund; die Markierung muss auch diese Zelle erreichen.
- Gerechnete Abstände (WCAG, sRGB) gegen den Tabellengrund `flaeche`:

  | Kandidat | Tag | Nacht |
  | --- | --- | --- |
  | Alt-Gelb (`#fffbe6` / `#2b2611`) | 1,04 | 1,24 |
  | `flaeche3` (= Hover) | 1,28 | 1,07 |
  | `bedienFlaeche` | 1,18 | 1,03 |
  | Linie `bedien` gegen `bedienFlaeche` | 7,23 | 5,66 |
  | Linie `bedien` gegen `flaeche` | 8,55 | 5,84 |
  | Linie `bedien` gegen `flaeche3` | 6,71 | 5,48 |

  Text auf `bedienFlaeche` am Tag: `text` 15,61 · `text2` 11,10 · `gedaempft` 7,12 ·
  `bedienText` 7,11. Nachts liegt `bedienFlaeche` fast auf der Luminanz von `flaeche`, die
  Textstufen halten dort dieselben Werte wie auf der Tabelle. Die Browsermessung in Aufgabe 3
  ersetzt diese Rechnung, sie bestätigt sie nicht nur.

**Gemessen vor dem Fix** (Chromium, Dev-Stack der e2e-Suite, 01.10.2026, Personalseite per
`?personal=<id>`, ETB per `?eintrag=<id>`, Zeiger außerhalb):

| Stelle | Tag | Nacht |
| --- | --- | --- |
| Tabellenzelle | `rgb(255, 251, 230)` | `rgb(43, 38, 17)` |
| fixierte, sortierte Kennungszelle | `rgb(250, 250, 250)` — antds Sortierspalten-Grund, die Regel verliert | `rgb(43, 38, 17)` |
| Nachbarzeile, Kennungszelle | `rgb(250, 250, 250)` | `rgb(25, 27, 30)` |
| Karte unter `md` | `rgb(255, 251, 230)` | `rgb(43, 38, 17)` |
| ETB-Zeile | inline `bedienFlaeche` `rgb(228, 237, 247)` | inline `bedienFlaeche` `rgb(13, 22, 32)` |

Drei Befunde: (1) Am Tag verliert die alte Regel (0,1,1) an der fixierten Kennung gegen antds
Sortierspalte; nur nachts gewinnt sie über `[data-theme='dark']` (0,2,1). (2) Die ETB-Zeitachse
setzt ihre Hervorhebung schon inline auf `bedienFlaeche` (`etb/EtbZeitachse.tsx`, „Die
Hervorhebung als Rollenfläche“); die Klassenregel erreicht dort die Fläche nicht. Die Wahl in E1
ist damit kein neuer Ton, sondern zieht die übrigen Zweige auf die Rolle nach, die das ETB schon
trägt. (3) Keine markierte Stelle trägt einen `box-shadow`.

## Goals / Non-Goals

**Goals:**

- Die Hervorhebung bezieht ihre Farben aus vorhandenen Rollen und ist in beiden Modi sichtbar,
  gemessen im Browser.
- `index.css` ist frei von Farbliteralen; ein Guard hält das für alle CSS-Dateien fest.

**Non-Goals:**

- Keine neue Farbrolle. Reicht keine vorhandene, wäre das eine eigene Entscheidung mit eigenem
  Ticket.
- Kein Ausblenden der Hervorhebung nach einer Zeit (bleibt wie in LFH-25).
- Die Schuld in `Markdown.css` / `MarkdownEditor.css` wird nicht getilgt, nur eingefroren
  (Nachzug als eigener Task, s. Aufgabe 2).
- Keine Verhaltensänderung an `gate5.guard.test.ts`; der neue Guard ergänzt ihn. Gate 5 gibt nur
  `ohneKommentare` an das geteilte Modul `test/ohneKommentare.ts` ab (E3).

## Decisions

### E1: Fläche `bedienFlaeche` plus Ober- und Unterlinie in `bedien`

Die angesprungene Zeile ist das Ziel einer Beziehung („du kamst von dort hierher“). Blau ist die
Bedien- und Beziehungsfarbe der Sprache (Übergabe, Banner, Link-Hover tragen sie schon), Gelb
ist Achtung. Die Fläche allein trägt nachts nicht (1,03 : 1), deshalb ein zweiter Kanal: je eine
2-px-Linie oben und unten als `box-shadow: inset 0 2px 0 var(--lfh-bedien), inset 0 -2px 0
var(--lfh-bedien)`. Sie hält gegen jede angrenzende Fläche ≥ 5,48 : 1.

`box-shadow` statt `border`: verändert die Zeilenhöhe nicht (keine Layoutverschiebung beim
Sprung), braucht keine Sonderbehandlung für `border-collapse`, und der Messkern
(`e2e/kontrast-kern.ts`) lehnt nur `background-image`, Deckkraft und Mischmodi ab, nicht
Schatten. Im Tabellenzweig liegt der Schatten an jeder `td`, so entsteht eine durchgehende Linie
über alle Zellen einschließlich der fixierten Kennung.

Verworfene Alternativen:

- **`flaeche3` allein** (Vorschlag im Ticket): identisch mit dem Hover der Katalogtabelle, nachts
  1,07 : 1. Verstößt gegen „unterscheidbar von Hover“.
- **`achtungFlaeche`** (nächster Ton am Alt-Gelb): Warnzustand, Kriterium 7.
- **`bedienFlaeche` allein**: nachts unsichtbar (1,03 : 1).
- **Linke Kante in `bedien`**: kollidiert mit den linken Typkanten der ETB-Zeitachse (Meldung
  ist dort blau) und mit der Lückentönung der Betroffenen, die ebenfalls an der Zeile hängt.
- **Umlaufender 2-px-Rahmen in `bedien`**: ist die Form des Fokusrings (`:focus-visible`,
  `outline: 2px solid var(--lfh-bedien)`); eine markierte Zeile sähe fokussiert aus.
- **Neue Rolle `sprungZeile`**: verlangt eine Palettenentscheidung, die das Ticket ausdrücklich
  ausschließt („nur eine vorhandene“).

**Gewollte Farbverschiebung:** Gelb → Bedienblau. Benannt als Korrektur in Commit und PR.

### E2: Spezifität wie die Lückentönung

Selektoren: `.ant-table-wrapper .ant-table-tbody > tr.zeile-hervorgehoben > td` (0,3,2) und
`[data-lfh='datensicht-karte'].zeile-hervorgehoben`, die Form der Lückentönung. Sie liegt über
antds Sortierspalte (`.ant-table-wrapper td.ant-table-column-sort`, (0,2,1), weil
`:where(.css-…)` null zählt; `antd/es/table/style/sorter.js`). An ihr verlor die alte Regel
(0,1,1) am Tag, während die alte Nachtregel (0,2,1) den Gleichstand als spätere Regel gewann
(gemessen, s. o.).
Eine zusätzliche Zellklasse (0,4,2) war erwogen und bringt nichts: die Gegenprobe mit (0,3,2) hält
die Fläche in jeder Zelle einschließlich der fixierten, sortierten Kennung (e2e, „uneinheitliche
Fläche“). Die Linien liegen im `box-shadow`, den antd an der Zelle nicht setzt; unter dem Zeiger
bleiben sie stehen. In der ETB-Zeitachse setzt der Baustein seinen Grund inline
(`bedienFlaeche`); die Klassenregel liefert dort nur die Linie, und das ist gewollt. Das `[data-theme='dark']`-Duplikat fällt
weg, weil die Rollen-Properties den Modus selbst tragen.

### E3: CSS-Farbgate bauen, mit Schuldmenge

Nach dem Fix ist `index.css` hex-frei, und **keine** CSS-Datei außer `theme/rollen.css` trägt
noch einen Hex-Wert. Ein reiner Hex-Guard wäre damit grün geboren. Die verbleibenden Literale
sind acht `rgba()`-Werte in `components/Markdown.css` und `components/MarkdownEditor.css`
(Code-Grund und Rahmen des Markdown-Renderers, je Modus). Der Guard prüft Hex **und**
`rgb[a]()`/`hsl[a]()` und führt diese zwei Dateien als Schuldmenge, die nur schrumpfen darf
(Muster `dichte.guard.test.ts`, `OFFEN`). Begründung gegen einen reinen Hex-Guard: gate5 nennt
„rgba-getarnte Werte“ als bekannte Grenze; ein CSS-Guard ohne diese Grenze ist billiger, als sie
in einer zweiten Datei zu wiederholen.

Mechanik: `node:fs` statt `import.meta.glob` (Vitest liefert CSS dort leer, gate5 Grenze 2),
Kommentare über dieselbe Block-Zustandslogik wie gate5 (`ohneKommentare`; wird exportiert oder
in ein geteiltes Modul gezogen, nicht kopiert). `theme/rollen.css` ist die einzige Ausnahme per
Pfad. Ort: `frontend/src/theme/cssFarbquelle.guard.test.ts`, damit `check-all.sh` ihn über die
Vitest-Suite ohne neuen Schritt mitnimmt.

Verworfen: **kein Guard, nur Begründung** — die Fehlerklasse ist zweimal aufgetreten (LFH-375,
LFH-698), und der Guard ist grün geboren bis auf eine benannte Schuld.

## Risks / Trade-offs

- [Nachts trägt die Fläche fast nichts, die Linie allein markiert] → gewollt; die Linie hält
  ≥ 5,48 : 1. Der e2e-Spec misst die Linie (Form, Kontrast, Rolle) und die Fläche (Rolle,
  einheitlich über alle Zellen, verschieden vom Hover).
- [Schatten an jeder `td` zeigt kleine Fugen, wenn antd Zellabstände setzt] → antd-Tabellen
  stehen auf `border-spacing: 0`; der Screenshot-Blick in Aufgabe 3 bestätigt es.
- [`box-shadow` am `td` einer fixierten Spalte konkurriert mit antds Schatten der Fixkante] →
  geprüft: antd zeichnet den Fixschatten an `::after` der Zelle (`ant-table-cell-fix-start-shadow`,
  in Ruhe `none`), nicht an der Zelle selbst.
- [Eine angesprungene ETB-Berichtigung verliert ihre Zeilentönung] → geprüft, besteht, aber nicht
  durch diese Änderung: `etb/EtbZeitachse.tsx` setzt bei Hervorhebung inline
  `{ background: bedienFlaeche }`, und `Zeitachseneintrag` spreizt das nach dem Grund der Tönung.
  Typkante und Typwort „Berichtigung“ bleiben als Kanäle stehen; die Klassenregel fügt nur die
  Linie hinzu. Verhalten unverändert gegenüber vorher.
- [Infotelefon setzt die Klasse an einem `Zeitachseneintrag` ohne Inline-Grund] → die Klassenregel
  erreicht den Grund des Bausteins nicht, der Anruf trug nur die Linie (Review). Behoben wie im
  ETB: `pages/InfotelefonPage.tsx` setzt `bedienFlaeche` inline, Nachweis in
  `InfotelefonPage.test.tsx`.
- [Meldungs- und Auftragskarten (`kommunikation/KommKarte.tsx`) markieren mit einem Ring in
  `bedien`] → liegen außerhalb von `.zeile-hervorgehoben` und damit außerhalb dieser Change; die
  Spec gilt für Datensicht und Zeitachse. Nachzug LFH-896.
- [`schwach` (Platzhalter, Ikonen) liegt am Tag auf `bedienFlaeche` bei 5,39] → `schwach` ist
  keine Textstufe mit Tagesboden (LFH-643/LFH-652); dieselbe Lage wie auf `flaeche3`. Kein
  Handlungsbedarf, aber im Spec nicht als Text gemessen.
- [Der Guard schlägt bei einer künftigen CSS-Datei mit Farbliteral an] → gewollt; der Weg ist
  eine Rolle in `rollen.css` + `tokens.ts`.

## Migration Plan

Reine Frontend-Änderung, ausgeliefert mit dem nächsten Bundle. Rückweg: Revert des Commits.
