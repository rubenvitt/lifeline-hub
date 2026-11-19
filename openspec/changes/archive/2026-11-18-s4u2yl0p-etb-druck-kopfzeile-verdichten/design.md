# Design

## Context

Die ETB-Druckansicht (`pages/EtbDruckPage.tsx`) setzt einen `Druckkopf` und darunter
`etb/EtbDruckTabelle.tsx`, ein schlichtes `<table>` mit sechs Spalten. `druck/druck.css` macht `thead`
zur `table-header-group`; Chromium und Firefox wiederholen ihn je Seite, WebKit nicht (LFH-1110,
hingenommen). Das Randfeld `@page` trägt nur „Seite n von m“ und wird nur von Chromium gezeichnet;
freier Text dort ist per Regel ausgeschlossen (`druck.css`, `druck/AGENTS.md`), weil er als
CSS-Zeichenkette in ein `<style>` müsste. Systemeinträge (`typ = 'system'`) schreibt nur der Server,
kurze Texte ohne Von/An/Meldeweg.

## Goals / Non-Goals

**Goals:**
- Jede Seite, die ihren Tabellenkopf wiederholt, nennt Einsatz und Stand.
- Systemeinträge brauchen deutlich weniger Höhe, ohne die Nummernfolge zu brechen.

**Non-Goals:**
- Kein Ersatz für WebKit (weder Seitenblöcke noch JS-Paginierung: Format und Skalierung wählt man
  erst im Druckdialog, Begründung in `druck.css`).
- Keine Änderung am Druckkopf, an der Seitenzählung, am Filter `system=aus` oder an der
  Zeitachse am Bildschirm.
- Keine Verdichtung anderer Typen und kein Schalter „ausführlich“.

## Decisions

### D1 Laufzeile als erste Zeile im `thead`

Eine zusätzliche `<tr>` vor den Spaltenköpfen mit einer Zelle `colSpan={6}`, Markierung
`data-lfh="etb-druck-laufzeile"`. Text: „Einsatztagebuch · <Bezeichnung (Nummer)> · Stand <DTG> · bis
Nr. N“. Die Einsatzbezeichnung bildet dieselbe Regel wie der `Druckkopf` (Nummer in Klammern, nur
falls vorhanden); diese Bildung wird aus `Druckkopf.tsx` als kleine Funktion herausgezogen und an
beiden Stellen genutzt, statt sie zu kopieren. Den Stand-Text baut die Seite heute schon für den
Druckkopf; er wird einmal gebildet und an Kopf und Tabelle gereicht (`laufzeile`-Prop der Tabelle,
fertiger Text oder Teile).

- Kleiner, sekundär gesetzt (`fontSizeSM`, `colorTextSecondary`), ohne eigene Rahmenlinie, damit sie
  sich vom Spaltenkopf abhebt und schwarz-weiß lesbar bleibt.
- Am Bildschirm sichtbar wie der Rest der Tabelle; Seite 1 trägt sie zusätzlich zum Druckkopf.
  Ein Ausblenden nur auf Seite 1 geht mit CSS nicht und lohnt keinen Sonderweg.
- Am schmalen Schirm (`druckansichtSchmal.css`) bleibt die Zelle über die volle Breite; da nur
  `colSpan` greift, ist keine eigene Regel zu erwarten (zu prüfen im mobilen Gate).

Verworfen: `@page @top-*` mit Einsatztext (nur Chromium, bricht die Escape-Regel); `string-set` /
laufende Elemente (in keinem Browser); eigene Seitenblöcke per JS (Format unbekannt).

### D2 Systemeintrag als verdichtete Zeile

In `EtbDruckTabelle` verzweigt die Zeile nach `e.typ === 'system'`:
- Zelle Nr. und Zelle Zeit wie bisher (Zeit samt Nachtragshinweis).
- Eine Zelle `colSpan={4}` mit „System · <Inhalt> · <Erfasser[, Funktion]>“, dazu Berichtigungshinweise
  wie bei der vollen Form, `fontSizeSM`, Polsterung oben/unten minimal. Der Inhalt läuft über
  `Markdown` wie sonst, die Absatzränder werden in dieser Zelle auf 0 gesetzt, damit die Zeile
  einzeilig bleibt, solange der Text passt; lange Texte brechen normal um.
- `tr` trägt `data-lfh="etb-druck-system"` für Tests und Stil.
- Am schmalen Schirm entfällt die Metazeile; die eine Zelle nimmt die Breite von Typ bis Erfasser
  (Klasse `druckansicht-textspalte`, damit die Schmal-Regeln sie wie die Inhaltsspalte behandeln).

Verworfen: Läufe zu einem Block zusammenfassen (Zeile je Nummer fällt weg, Abstimmung 18.11.2026);
Systemeinträge standardmäßig weglassen (Lücken in der Nummernfolge, Spec „Ungefiltert“).

### D3 Regeln und Doku

`druck/AGENTS.md`, „ETB-Druck“, bekommt zwei Sätze: Laufzeile im `thead` (kein `@page`-Text), Systemeinträge
verdichtet. `docs/anwender/kapitel/drucken-export.md` beschreibt beides im Abschnitt zur
ETB-Druckansicht; das Bild der Druckansicht wird nach den Regeln in `docs/anwender/AGENTS.md`
erneuert, falls es die geänderte Stelle zeigt.

## Risks / Trade-offs

- [Safari/iPad druckt Folgeseiten weiter ohne Einsatz] → Engine-Grenze, bereits für den Tabellenkopf
  hingenommen; in der Anwenderdoku benennen.
- [Die Laufzeile verlängert jeden Seitenkopf um eine Zeile] → Die Verdichtung spart ein Vielfaches;
  Messwert im e2e-Lauf (Seitenzahl vorher/nachher) festhalten.
- [Ein Chromium-Kopf mit `colSpan` in `thead` könnte die Spaltenbreiten verschieben] → `table-layout`
  bleibt `auto`, eine `colSpan`-Zelle bestimmt keine Einzelspaltenbreite; das e2e-Druckbild prüft die
  Spalten weiter.
