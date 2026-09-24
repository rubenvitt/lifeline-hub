# Design

## Context

Motivation und Entscheidung des Auftraggebers stehen in `proposal.md`. Hier nur der Bestand,
der den Weg bestimmt.

- `components/Datensicht.tsx` trägt heute die einzige Zählwahrheit: `sichtbareSpalten`
  (Spalte 0 und `immerSichtbar` nie entfernbar, Handauswahl und `abBreite` in einem Zähler,
  doppelt Verborgenes einmal gezählt), `waehlbareSpalten`/`hatWaehlbareSpalten`, `etikettVon`
  und die Komponente `SpaltenSchalter`. Der Schalter fragt die Breite selbst über
  `useViewport` ab und bekommt keinen Zähler übergeben.
- **Die Importrichtung** ist `Datensicht → KatalogTabelle`: `Datensicht` rendert seinen
  Tabellenzweig durch das Primitiv. Importierte `KatalogTabelle` den Schalter aus
  `Datensicht.tsx`, entstünde ein Zyklus.
- `KatalogTabelle` hat eine Werkzeugzeile (`data-lfh="katalog-werkzeuge"`), die nur mit
  `suche` existiert. Sie liegt bewusst außerhalb von `.ant-table`, weil
  `katalogtabelle-schmal.spec.ts` die Bildlaufbreite am Tabellenwurzelknoten misst. Die
  Tastaturebene „Katalogtabelle-Filter“ meldet nur `filter-zuruecksetzen`.
- Beide Kartenverwaltungen nutzen antds `sorter` und `filters`, ihre Tests bedienen
  `.ant-table-filter-trigger` und `columnheader`. Kein Konsument der 18 Katalogtabellen setzt
  heute antds `responsive` oder `hidden` (gegrept).
- Die Vitest-Vorgabebreite ist 1024 px (`test/viewport.ts`, `VIEWPORT_STANDARD`). Sie liegt
  über `lg` (992) und unter `xl` (1200).

## Goals / Non-Goals

**Goals:**
- Eine Zählfunktion und eine Schalter-Komponente mit zwei Trägern. `Datensicht` verhält sich
  danach byte-gleich zu vorher.
- Opt-in an `KatalogTabelle`, das ohne das Prop nichts verändert.
- Der Zähler kann nicht lügen, auch nicht über antds eigene Ausblendwege.

**Non-Goals:**
- Kein Schalter an den übrigen sechzehn Katalogtabellen. Die Ausnahme bleibt dort bestehen
  und wird im Dateikopf neu formuliert.
- Keine Persistenz der Handauswahl. Auch `Datensicht` hält sie nur im Komponentenzustand.
- Kein Umbau der Kartenverwaltungen auf `Datensicht`, keine Änderung an Sortierung, Filter
  oder Suche.
- Kein ETB-Anteil. Er ist gegenstandslos (siehe `proposal.md`).

## Decisions

### D1 — Eigenes Modul `components/SpaltenSchalter.tsx` statt Verbleib in `Datensicht`
Das Modul enthält `sichtbareSpalten`, `waehlbareSpalten`, `hatWaehlbareSpalten`,
`etikettVon` und die Komponente `SpaltenSchalter`. Es arbeitet auf einem strukturellen
Minimaltyp:

```ts
interface SchaltbareSpalte<K extends string = string> {
  key: K; etikett?: string; title?: unknown; immerSichtbar?: boolean; abBreite?: AbBreitePunkt;
}
```

`DatensichtSpalte` erfüllt ihn ohne Anpassung. `Datensicht.tsx` importiert von dort und
exportiert die fünf Namen weiter. So bleiben `Datensicht.test.tsx`,
`Datensicht.tastaturaktionen.test.tsx` und alle anderen Importe unverändert.

*Verworfen:* eine zweite Zählfunktion in `KatalogTabelle`. Das wären zwei Stellen, die „wie
viele sind ausgeblendet“ beantworten, und genau diese Drift verbietet die Festlegung aus
LFH-330/B2.
*Verworfen:* ein Modul ohne Komponente, nur mit den reinen Funktionen. Der Schalter trägt
eigene gemessene Zusicherungen (Umschalten am Menüeintrag statt am Kästchen, `autoFocus`,
Zähler als Text statt `Badge`). Eine zweite Kopie davon würde driften.

Dateiname ohne Basename-Zwilling, damit kein `.ts`/`.tsx`-Beschatten auftritt (Memory
`ts-tsx-basename-shadowing-typecheck`).

### D2 — Opt-in-Prop `spaltenSchalter?: { bezeichnung: string }` an `KatalogTabelle`
`bezeichnung` geht in den zugänglichen Namen („Spalten · 2 ausgeblendet — Online-Quellen“),
wie bei `Datensicht`. Die Handauswahl lebt als `useState` im Primitiv, unkontrolliert. Einen
Konsumenten für eine kontrollierte Achse gibt es nicht.

Ablauf im Primitiv, in dieser Reihenfolge:
1. `sichtbareSpalten({ spalten: columns, verborgen, abBreite })` liefert gezeigte Spalten und
   Zähler.
2. `etikett`, `immerSichtbar` und `abBreite` werden vor der Übergabe an antd herausgelöst.
3. Weiter wie bisher mit `zahl`-Klasse, Fixierung von Spalte 0 und `fliessBreite`. Beide
   rechnen damit über die WIRKLICH gerenderte Garnitur.

Weil `sichtbareSpalten` Index 0 nie entfernt, bleibt die fixierte Kennung die Kennung.

**Schlüsselpflicht:** Der Schalter braucht String-Schlüssel. Hat eine Spalte bei gesetztem
Opt-in keinen String-`key`, meldet sich das in DEV, und die Spalte gilt als `immerSichtbar`.
So kann sie der Zähler nie als „ausgeblendet“ führen, ohne dass sie im Menü wählbar wäre.

### D3 — `abBreite` wirkt nur mit Opt-in
`KatalogSpalte` lernt `etikett`, `immerSichtbar` und `abBreite`, also dieselben Namen wie an
`DatensichtSpalte`. Ohne `spaltenSchalter` bleibt `abBreite` **wirkungslos und meldet sich
in DEV**. Die andere Lesart („wirkt trotzdem“) ließe eine Spalte ohne jeden Zähler
verschwinden, und das ist der Fehler, gegen den Kriterium 14 steht. Ein Opt-in, das still
nichts tut, wäre dagegen von einem kaputten nicht zu unterscheiden. Deshalb die Warnung,
nach dem Muster der `fliessBreite`-Warnung.

### D4 — antds `responsive`/`hidden` doppelt gesperrt
Am Typ: `KatalogSpalte` lässt beide Felder distributiv weg. Ein plumpes `Omit` auf die Union
aus Spalte und Spaltengruppe würde sie zusammenfalten. Die Typsperre greift aber nur an
Objektliteralen, denn eine als `TableColumnsType<T>` annotierte Liste bleibt zuweisbar. Den
Rest übernimmt deshalb ein Guard in `katalogTabelle.guard.test.ts`: kein `responsive:` und
kein `hidden:` in den 18 Konsumentendateien. Kommentare werden über das vorhandene
`ohneKommentare` herausgenommen, dazu kommt ein Selbstbeweis an einem gebauten Fall.
*Verworfen:* antds `responsive` in den Zähler einrechnen. Das wäre eine zweite
Breitensprache neben `abBreite`, und `Datensicht` hat sie aus demselben Grund amputiert.

### D5 — Kein doppelter Schalter unter `Datensicht`
`Datensicht` rendert seinen Schalter selbst in seiner Werkzeugzeile und reicht
`KatalogTabelle` Spalten ohne `abBreite`/`etikett`/`immerSichtbar` herein. Setzte es
zusätzlich `spaltenSchalter`, stünden zwei Schalter mit zwei Zuständen da. Ein Guard hält das
Attribut aus `Datensicht.tsx` fern. Ein Test prüft außerdem, dass eine `Datensicht` mit
`form="tabelle"` genau **einen** Schalter zeigt.

### D6 — Werkzeugzeile und Tastaturebene
Die Werkzeugzeile existiert, wenn `suche` gesetzt ist oder der Schalter steht. Sie wird eine
umbrechende Flex-Zeile mit `gap` aus den Dichte-Tokens: erst die Suche, dann der Schalter.
Die Ebene „Katalogtabelle-Filter“ ist aktiv, wenn eines von beiden da ist. Sie meldet
`filter-zuruecksetzen` nur mit Suche und `spalten` nur, solange `hatWaehlbareSpalten` gilt.
Das ist dieselbe Wahrheit, die auch der Schalter liest. Die Offen-Achse ist kontrolliert,
damit die Palette das Menü öffnen kann. Verschwindet der Schalter, wird sie zurückgesetzt.
Dieselbe gemessene Falle wie in `Datensicht`: antd feuert dann kein `onOpenChange(false)`.

### D7 — Belegung der Kartenverwaltungen
- **Online-Quellen:** Name (Spalte 0) · Typ · URL `abBreite: 'lg'` · Attribution
  `abBreite: 'lg'` · Sortierung · Aktiv · Aktionen `immerSichtbar`.
- **Offline-Karten:** Name (Spalte 0) · Status · Größe · Anzeige · Attribution
  `abBreite: 'lg'` · Aktionen `immerSichtbar`.

URL und Attribution sind die gekappten Freitextspalten (`maxWidth` an der Zelle, voller Wert
im Titel). Sie tragen die schwächste Vergleichsaussage. Die Schwelle ist `lg`, nicht `xl`:
Der Fükw (13–15″) und das Führungs-Tablet im Querformat (1024–1280 px) liegen darüber und
sehen alles, und auch die Vitest-Vorgabebreite von 1024 px liegt darüber. Die
Bestandsaussage „zeigt Name/Status/Größe/Attribution“ bleibt damit ohne Umbau wahr. Darunter,
also auf dem Tablet hochkant und am Handschirm, fallen sie weg und werden gezählt. Die
Spaltenschlüssel stehen schon heute als String-`key` an jeder Spalte.

### D8 — Prüflisten und Doku
Die neue 15-Zeilen-Prüfliste liegt als `pruefliste.md` in diesem Change-Ordner. In den zwei
Alt-Prüflisten unter `docs/superpowers/specs/` bekommt Zeile 14 (Tabelle und Tabelle der
offenen Punkte) je einen Verweis. Das Verdikt steht in der neuen Prüfliste. Der Dateikopf von
`KatalogTabelle` ersetzt den Absatz „Kein Spaltenschalter …“ durch die Opt-in-Regel. Der
CLAUDE.md-Absatz „Tabelle nur, wenn verglichen wird“ nennt den zweiten Träger.

## Risks / Trade-offs

- [Ein Konsument setzt `abBreite` und vergisst das Opt-in] → DEV-Warnung (D3) und
  Vitest-Fall dafür.
- [Die Re-Exporte aus `Datensicht` verschleiern, wo die Funktion wohnt] → Kommentar am
  Re-Export. Neue Aufrufer importieren direkt aus `SpaltenSchalter.tsx`.
- [`etikettVon` behält sein Warn-Präfix `[Datensicht]`, obwohl es jetzt zwei Träger hat] →
  Das Präfix wird neutral (`[Spaltenschalter]`). Vorher wird gegrept, dass kein Test den
  Wortlaut pinnt.
- [Die Menü-Tastaturbedienung ist für den neuen Träger nur über die geteilte Komponente
  belegt] → Der Nachweis bleibt `e2e/datensicht-schmal.spec.ts` für dieselbe Komponente. Für
  die Kartenverwaltung kommt ein e2e-Fall für den 390-px-Handschirm dazu: Tabelle, kein
  Seitenüberlauf, Zähler > 0. Menü-Tastaturwege werden dort nicht ein zweites Mal gemessen.
- [Das Zwei-Sekunden-Polling der Offline-Karten] → irrelevant für den Schalter. Die
  Handauswahl hängt an Spaltenschlüsseln, nicht an Zeilen.

## Migration Plan

Nur Frontend, kein Deploy-Schritt. Rückbau: Opt-in an den zwei Aufrufstellen entfernen. Das
Primitiv verhält sich dann wie vorher.
