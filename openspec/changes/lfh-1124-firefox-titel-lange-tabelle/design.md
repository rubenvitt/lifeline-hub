# Design

## Context

Motivation: proposal.md, „Why“. Stand nach LFH-1098 (`druck/einsatzbericht/Bloecke.tsx`,
`druck/druck.css`, Regel „Abschnittstitel stehen im Titelblock“ in `frontend/src/druck/AGENTS.md`):

- Block und Abschnitt reichen ihre Titel an das erste Inhaltsstück weiter. Eine Tabelle bis
  `KURZE_TABELLE` (12) Zeilen steht mit ihnen in `data-lfh="titelblock-tabelle"`, die nur in
  Firefox nicht bricht (`@supports (-moz-appearance: none)`). Eine längere steht hinter einer
  freien `Titelfolge`.
- Firefox setzt `break-after: avoid` nicht um (LFH-1008) — am 10.10.2026 mit Firefox 157 und der
  Minimalprobe aus LFH-813 nachgemessen: unverändert. Er lässt außerdem einen `thead` allein am
  Seitenende stehen, wenn die erste Zeile nicht mehr passt, und wiederholt ihn dann oben.
- Was Firefox einhält: `break-inside: avoid` an einem Block, der auf eine Seite passt;
  `thead { display: table-header-group }` wiederholt den Kopf; gestutzte Ränder am Seitenanfang.
- Die Messwerkzeuge aus LFH-1098 (`/mnt/project-files/lfh-1098/werkzeug/`) sind in dieser Sitzung
  nicht erreichbar. Gemessen wurde mit einer eigenen Probe (Puppeteer über WebDriver BiDi, PDF,
  `pdftotext -bbox`), die mit der Change unter `werkzeug/` abgelegt wird.

Probe (Firefox 157, A4, Titel h3 + h4 vor einer Tabelle mit 40 Zeilen, Titel in 8-px-Schritten
über das Seitenende geschoben, 31 Lagen):

| Variante | Titel mit erster Zeile | Bemerkung |
| --- | --- | --- |
| Ist (Titel vor der Tabelle) | 11/31 | 6 × nur Kopf, 8 × Titel allein |
| Deckel mit `visibility: collapse` | — | Firefox fragmentiert eingeklappte Zeilen, Kopf doppelt versetzt |
| Grid-Stapelung (Deckel und Tabelle in einer Rasterzelle) | 31/31 | rückt schon bei 249 px Rest weiter, also ganze Rasterzeile |
| Deckel mit festen Spaltenbreiten | 31/31 | Spalten nicht mehr automatisch, Blatt ändert sich |
| **Deckel mit Maßzeilen** | **31/31** | weiter erst, wenn Titel + Kopf + erste Zeile nicht passen (≤ 161 px Rest) |

## Goals / Non-Goals

**Goals:**

- Firefox-Druck: kein Titel allein oder nur mit Spaltenkopf am Seitenende vor einer langen
  Tabelle; keine fast leere Seite; Kopf auf jeder Folgeseite (Spec-Delta `einsatzbericht`).
- Chromium-Druck, WebKit-Druck und Bildschirm bleiben unverändert.

**Non-Goals:**

- Kurze Tabellen (≤ `KURZE_TABELLE`) und andere Druckstücke (ETB-Druck, Modul-Listen, Markdown-
  Tabellen) — sie behalten ihre Mechanik. Der Deckel ist dort übertragbar, aber nicht gemessen.
- Ein allein stehender Kopf ohne Titel mitten in einem Abschnitt (zweites Inhaltsstück): kein
  Titel, also nicht Gegenstand von LFH-1124.
- WebKit wiederholt `thead` nicht (LFH-1110) — bleibt hingenommen.

## Decisions

### D1 Deckel mit Maßzeilen, nur im Firefox-Druck

Vor einer Tabelle mit Titeln und mehr als `KURZE_TABELLE` Zeilen rendert `Bloecke.tsx`:

1. **Deckel** `data-lfh="titelblock-deckel"`: die Titel (`Titelfolge`) und eine **Deckeltabelle**
   (`aria-hidden`, ohne eigene Hülle): Kopf, erste Zeile und die Zeilen 2…n als **Maßzeilen**.
2. Die **echte Tabelle** wie bisher (`TabellenAnzeige`), ihre erste Zeile mit
   `data-lfh="deckel-erste-zeile"`.

Im Markup trägt der Deckel `display: contents` und die Kopie `display: none`. Die erste Messung
mit dem Deckel als Block und der Kopie in ihrer Bildlauf-Hülle machte Chromium schlechter
(44/51 und 43/51, Titel allein): zwischen Titel und Tabelle stand eine Box, und `break-after:
avoid` am Titel griff nicht mehr. Ohne Box ist der Baum in Chromium und WebKit der alte.

Im Firefox-Druck (`@supports (-moz-appearance: none)` unter `@media print`, `druck.css`):

- Der Deckel wird zum Block (`display: block !important`), bricht nicht (`break-inside: avoid`),
  liegt über der Tabelle (`position: relative; z-index: 1`) und hat deckenden Papiergrund (`background: white !important;
  print-color-adjust: exact`), denn die Druckwurzel setzt jeden Grund durchsichtig.
- Die Kopie erscheint (`display: table !important`).
- Die echte Tabelle ist um ihre Kopfhöhe hochgezogen (`margin-top: calc(-1 * Kopfhöhe)`): ihr
  erster Kopf liegt unter dem unteren Rand des Deckels (über dessen erster Zeile) und ist
  verdeckt. Ihre erste Zeile ist eine Maßzeile, Zeile 2 schließt also unmittelbar an die erste
  Zeile des Deckels an.
- Bricht die Seite nach dem Deckel, stehen auf der Folgeseite der wiederholte Kopf und Zeile 2.
  Passt der Deckel nicht mehr, rückt er ganz weiter; der Rest der Seite ist höchstens so hoch wie
  Titel, Kopf und erste Zeile. Am Seitenanfang stutzt Firefox den negativen Rand nicht weg, weil
  die Tabelle nie am Seitenanfang beginnt (sie folgt immer dem Deckel auf derselben Seite).

Überall sonst (Bildschirm, Chromium, WebKit): Deckeltabelle `display: none`, Deckel ohne
Wirkung, keine Maßzeile, kein Rand — das bisherige Blatt.

**Maßzeile:** Zellen ohne senkrechtes Polster und ohne Rahmen, Inhalt in einer Hülle mit
`height: 0; overflow: hidden`, Zeile `visibility: hidden`. Sie hat keine Höhe, trägt aber ihre
Textbreite in die automatische Spaltenbreite. Deckeltabelle (Kopf, Zeile 1, Maßzeilen 2…n) und
echte Tabelle (Kopf, Maßzeile 1, Zeilen 2…n) sehen dieselben Inhalte und bekommen dieselben
Spalten. Der Inhalt jeder Zelle steht deshalb in beiden Tabellen in einer Hülle.

**Kopfhöhe:** Die Kopfzellen brechen im Firefox-Druck nicht um (`white-space: nowrap`) und
bekommen dort eine feste Zeilenhöhe (`--druck-kopfzeile`, gerundet aus Schriftgröße und
Zeilenhöhe der Tokens); ihre Höhe ergibt sich daraus mit Polster und Rand. `Bloecke.tsx` setzt
beide Werte als CSS-Variablen (`--druck-kopfhoehe` an die echte Tabelle); `druck.css` liest sie.
Am Bildschirm und in Chromium bleibt der Kopf, wie er war.
Die Spaltenköpfe des Berichts sind kurz („Name“, „Funktion“, „Einsatzzeit“, „Freigegeben von“).

Alternativen:

- **Anlagen ab neuer Seite** (`data-lfh="druck-anlage"`): löst die beiden Anlagen, nicht die
  ETB-Entscheidungen im Hauptteil; ändert das Chromium-Blatt (jede Anlage eine neue Seite).
- **Abwarten** auf `break-after: avoid` in Firefox: Firefox 157 kann es nicht; kein Termin.
- **Ganze Tabelle in die Hülle, Titel in `caption`/`thead`, Tabelle teilen:** in LFH-1098
  gemessen und verworfen (leere Seite, Trennung bleibt, Kopf geht verloren).
- **`visibility: collapse`** statt Maßzeilen: im Bildschirm richtig, im Firefox-Druck
  fragmentiert die Deckeltabelle über drei Seiten.
- **Grid-Stapelung** (Deckel und Tabelle in derselben Rasterzelle, kein Rand nötig): Firefox
  rückt die Rasterzeile als Ganzes weiter, 249 px Rest bleiben leer.
- **Feste Spaltenbreiten** (`table-layout: fixed`): hält zusammen, ändert aber die Spalten
  gegenüber Chromium und schneidet Köpfe ab.

### D2 Weiche wie in LFH-1098

Die Firefox-Weiche bleibt `@supports (-moz-appearance: none)`. Das DOM ist in allen Engines
gleich, nur `druck.css` schaltet. Tests im Vitest prüfen die Struktur, `druck.test.ts` die
Regeln, das e2e im Firefox-Projekt die Deckung (Kopf der echten Tabelle innerhalb des Deckels,
Zeile 2 direkt unter Zeile 1 des Deckels) unter Druckmedium und `beforeprint`.

### D3 Messung

Die Verschiebeprobe läuft gegen die echte Komponente: ein Skript rendert `Bloecke` mit
Testdaten (Anlage Personal, 40 Köpfe; ETB mit 30 Entscheidungen) statisch, hängt `druck.css` an
und schiebt den Bericht in Schritten über das Seitenende; Firefox und Chromium drucken über
Puppeteer. Vorher und nachher, Ergebnis in `werkzeug/messung.md`.

## Risks / Trade-offs

- [Kopfhöhe weicht ab (Schrift, Dichte, Rundung)] → Spalt oder Überdeckung zwischen Zeile 1 und
  2. Mitigation: Kopf ohne Umbruch, Höhe aus denselben Tokens wie die Zellen; e2e misst die
  Deckung im Firefox-Projekt auf 0,5 px.
- [Doppelter Text in der PDF-Textebene] → der verdeckte erste Kopf der echten Tabelle steht
  unsichtbar im PDF. Auf Papier ohne Wirkung; Kopieren aus dem PDF zeigt den Kopf zweimal.
  Hingenommen.
- [Druckdialog „Hintergründe drucken“] → `print-color-adjust: exact` erzwingt den weißen Deckel;
  wäre er aus, schiene der verdeckte Kopf durch. Mitigation: die Probe druckt ohne
  Hintergrund-Option, e2e prüft den berechneten Stil.
- [Spaltenkopf länger als die Spalte] → ohne Umbruch ragt er hinaus. Die Köpfe des Berichts sind
  kurz; ein neuer langer Kopf fiele in der Probe auf.
- [Bildschirmleser] → Deckeltabelle `aria-hidden` und außerhalb des Firefox-Drucks
  `display: none`; Maßzeilen nur im Firefox-Druck unsichtbar.

## Migration Plan

Reines Frontend, keine Daten. Rückbau: Deckel in `Bloecke.tsx` entfernen, Regeln in `druck.css`
löschen — das Blatt fällt auf den Stand von LFH-1098 zurück.
