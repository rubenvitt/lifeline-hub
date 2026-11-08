## Context

Motivation und Schnitt: `proposal.md`. Bestand, auf dem der Entwurf aufsetzt:

- **⋮-Menü:** `components/MenueAusloeser.tsx` trägt die Mechanik des gebündelten Menüs einmal
  (`autoFocus`, Gefahr hinter Trenner, Riegel gegen Portal-Aufsteigen). `menueEintraege()` baut
  aus `MenueEintrag[]` die antd-Items. Ein Wächter (`menueAusloeser.guard.test.ts`) verhindert
  Kopien des Dreipunkt-Auslösers.
- **`Datensicht`:** Der Kartenplan (`karte.aktion`: `PrimaerAktion`, `karte.weitere`:
  `WeitereAktionen`) beschreibt die Aktionen einer Zeile als Daten. Der Kartenzweig rendert daraus
  Knopf und ⋮. Im Tabellenzweig zeichnen die Seiten (Material, Fahrzeuge, Personen, Dokumente)
  dieselben Aktionen in einer eigenen Spalte. Offene ⋮-Menüs halten die Zeilenschleuse über
  `reportKartenMenue` (LLH-1130). Zeilenklick und Anker-Riegel laufen über `onRow`.
- **Skizze:** `stab/skizze/SkizzenFlaeche.tsx` baut den langen Druck selbst (550 ms, 8 px, nur
  Nicht-Maus-Zeiger), `onContextMenu` am Element, und `bedienung.ts` übersetzt `ContextMenu` und
  Umschalt+F10 in den Befehl `menue`. `FernmeldeskizzeBild.tsx` zeigt das Menü in
  `PunktankerMenue`, verankert an der Hülle.
- **Lagekarte:** maplibre meldet Rechtsklick und langen Druck als ein Ereignis. Der
  Nachklick-Riegel `pages/lagekarte/nachklickRiegel.ts` verschluckt nach einem langen Druck
  `contextmenu`, `mousedown`, `mouseup` und `click` bis 400 ms nach dem Abheben (LFH-776 D3). Die
  Schale `PunktankerMenue.tsx` teilen Flächenwahl, Kontextmenü der Karte und Skizze.

## Goals / Non-Goals

**Goals:**

- Eine Auslöse-Mechanik für Rechtsklick, langen Druck und Tasten, die jede Fläche gleich nutzt.
- Eine Quelle der Einträge: Das Kontextmenü eines Datensatzes entsteht aus denselben Daten wie
  Primärknopf und ⋮-Menü, ohne dass eine Seite eine zweite Liste pflegt.
- Eine Menü-Schale für alle Punktmenüs (Karte, Skizze, Datensatz).

**Non-Goals:**

- Keine neuen Aktionen. Was weder Primäraktion noch ⋮-Eintrag ist, kommt nicht ins Menü
  (auch nicht „Öffnen“ oder „In neuem Tab öffnen“).
- Die Lagekarte behält ihren Auslöser (maplibre-Ereignis); ihre Treffer- und Modusregeln bleiben.
- Keine Anbindung der Einzelstellen außerhalb der `Datensicht` (LLH-1597 bis LLH-1601).

## Decisions

### D1 Auslöser als Hook mit Fabrik je Datensatz

`components/useKontextMenue.ts` liefert eine Funktion `ausloeser(schluessel)`, die die Handler
für ein Element zurückgibt (`onContextMenu`, `onPointerDown/Move/Up/Cancel`, `onKeyDown`). Ein
Hook je Fläche, nicht je Zeile: Eine Liste mit 200 Zeilen hält genau einen Langdruck-Zustand und
einen Riegel. Gemeldet wird `onOeffnen(schluessel, anker, ursprung)` mit `anker` in
Fensterkoordinaten und `ursprung` `'zeiger' | 'tastatur'`.

*Alternative:* eine Hüllkomponente `<KontextZone>` je Zeile. Verworfen: Sie legt um jede
Tabellenzeile ein zusätzliches Element, und antd erlaubt am `<tr>` nur Props über `onRow`.

### D2 Wann das Browsermenü bleibt

Die Prüfung `browsermenueBleibt(ereignis)` liegt im Hook und gilt für Rechtsklick und langen
Druck:

- Ziel liegt in `a[href]`, `input`, `textarea`, `select` oder `[contenteditable]`;
- die Fenster-Markierung ist nicht leer und enthält das Ziel;
- `onOeffnen` meldet über den Rückgabewert, dass der Datensatz keine Einträge hat.

Dann gibt es kein `preventDefault()` und kein Menü. Für die Tastatur gilt nur die Ausnahme
Eingabefeld: Der Fokus einer Datensicht-Zeile steht fast immer auf ihrem Titel-Link. Ließe die
Taste dort das Browsermenü, wäre das Kontextmenü per Tastatur nicht erreichbar (abgestimmt mit
Rubens Wahl „auf Link Browsermenü“, die sich auf den Zeiger bezieht; zur Freigabe vorgelegt).

### D3 Langer Druck selbst gemessen, Riegel geteilt

Für `pointerType !== 'mouse'` startet `pointerdown` einen Zeitgeber über 550 ms. Eine Bewegung
über 8 px, `pointerup` oder `pointercancel` bricht ab. Werte aus der Skizze (`LANGDRUCK_MS`,
`LANGDRUCK_WEG`), dort entfernt und aus dem Hook exportiert. Das native `contextmenu`, das
Android-Chrome beim Halten selbst feuert, wird während eines laufenden Touchdrucks unterdrückt,
sonst öffnete das Menü doppelt oder das Browsermenü käme dazwischen. iOS feuert keins und braucht
den Zeitgeber.

Nach dem Öffnen per langem Druck schärft der Hook den Nachklick-Riegel. Er wandert unverändert von
`pages/lagekarte/nachklickRiegel.ts` nach `components/nachklickRiegel.ts`; die Lagekarte importiert
ihn von dort. So schließt das Abheben das Menü nicht und wirkt nicht als Klick auf die Zeile
(`onZeileKlick`, Titel-Link).

Während eines Touchdrucks setzt der Hook am gedrückten Element `user-select: none` und
`-webkit-touch-callout: none` und nimmt beides beim Abheben zurück. Sonst markiert iOS nach rund
500 ms Text, bevor der Zeitgeber feuert.

*Alternative:* nur das native `contextmenu` (wie maplibre). Verworfen: iOS Safari meldet keins.

### D4 Tastatur: keydown öffnet, Folge-`contextmenu` wird geschluckt

`onKeyDown` erkennt `ContextMenu` und Umschalt+F10 (aus `stab/skizze/bedienung.ts` in den Hook
gezogen; `tastenBefehl` der Skizze ruft die gemeinsame Prüfung `istKontextTaste`). Es öffnet das
Menü am Element (untere linke Ecke von `getBoundingClientRect()` des Datensatzes) und merkt sich
den Zeitpunkt. Ein `contextmenu`, das der Browser auf dieselbe Taste hin nachschiebt (Windows bei
`keyup`), wird bis 500 ms danach verworfen. Der Fokus geht beim Schließen ohne Wahl an
`document.activeElement` vom Öffnen zurück.

### D5 Schale am Fenster: `PunktankerMenue` zieht nach `components/`

`PunktankerMenue.tsx` (samt `punktmenueEintragStil` und Test) wandert nach
`components/PunktankerMenue.tsx` und bekommt die Prop `bezug: 'huelle' | 'fenster'` (Vorgabe
`'huelle'`). Bei `'fenster'` rendert der unsichtbare Anker per Portal in `document.body` mit
`position: fixed`, sodass Bildlauf und `transform` der Vorfahren ihn nicht versetzen. Karte,
Flächenwahl und Skizze bleiben bei `'huelle'` und ändern nur den Importpfad.

*Alternative:* eine zweite Schale nur für Datensätze. Verworfen: zwei Schalen liefen bei
Dichte-Staffel und Fokusrückgabe auseinander (Grund für die Schale in LFH-812).

### D6 `KontextMenue` für Datensätze: Einträge aus Primäraktion und `weitere`

`components/KontextMenue.tsx` nimmt `eintraege: MenueEintrag[]`, `onWahl`, `anker`,
`zugaenglicherName` und `onSchliessen` und rendert `PunktankerMenue` mit `bezug: 'fenster'` und
`menueEintraege()` aus `MenueAusloeser.tsx`. So gilt die Gefahr-hinter-Trenner-Regel aus derselben
Funktion wie im ⋮-Menü. Der Riegel gegen Portal-Aufsteigen aus `MenueAusloeser` gilt hier ohne
eigene Hülle, weil das Menü über `onWahl` mit gestopptem `domEvent` wählt (wie in
`PunktankerMenue`).

Die `Datensicht` baut die Einträge je Zeile mit `kontextEintraege(karte, zeile)`:

1. Primäraktion, wenn `aktion` gesetzt und `sichtbar` wahr ist: Schlüssel `__primaer`,
   Etikett `etikett`;
2. dann `weitere.eintraege(zeile)`, bei `weitere.laeuft(zeile)` alle mit `gesperrt`.

Die Wahl von `__primaer` ruft `aktion.onKlick`, mit `bestaetigung` vorher `modal.confirm` mit
`title: bestaetigung`, `okText: bestaetigungKnopf ?? etikett` und `okButtonProps.danger` aus
`bestaetigungGefahr`. Andere Schlüssel gehen an `weitere.onWahl`. Leere Liste ⇒ kein Menü,
Browsermenü (D2).

### D7 Ein Menü je `Datensicht`, angebunden in beiden Zweigen

Die `Datensicht` hält einen Zustand `{ schluessel, anker, ursprung } | null` und rendert höchstens
ein `KontextMenue`. Im Tabellenzweig kommen die Handler über `onRow` (zusammengeführt mit
Zeilenklick und Fenster-Props), im Kartenzweig an das Element `data-lfh="datensicht-karte"`. Das
offene Menü meldet sich über denselben Weg wie ein offenes ⋮ (`reportKartenMenue`) und hält so die
Schleuse. Verschwindet die Zeile oder liefert sie keine Einträge mehr, schließt das Menü im Render
(abgeleiteter Zustand wie in `MenueAusloeser`).

Die Seiten zeichnen ihre Tabellenspalte weiter selbst. Material, Fahrzeuge und Personen speisen
Spalte und Kartenplan bereits aus derselben Funktion. Für Dokumente prüft Aufgabe 4.4, dass
Spalte und Kartenplan übereinstimmen.

### D8 Wächter gegen eigene Mechaniken

`components/kontextMenue.guard.test.ts` zählt Quelldateien mit `onContextMenu` außerhalb von
`useKontextMenue.ts`. Ausnahmen mit Grund: `geraet/LagemonitorPage.tsx` (unterdrückt nur, kein
Menü) und die Übersicht der Skizze (unterdrückt nur). Ein Eintrag ohne Fund färbt den Wächter rot,
wie in `menueAusloeser.guard.test.ts`.

### D9 Nachträge aus dem Review (08.11.2026)

- **Nur Ereignisse aus dem eigenen DOM-Teilbaum.** React lässt Ereignisse aus Portalen (offenes
  ⋮-Menü, Auswahlliste, Rückfrage) durch den Komponentenbaum aufsteigen. Ohne Prüfung öffnete ein
  Rechtsklick in das offene ⋮-Menü ein zweites Menü. Alle Handler prüfen deshalb
  `currentTarget.contains(target)`, wie der Riegel des Zeilenklicks in `Datensicht`.
- **`kannOeffnen` vor dem Druck.** Erst beim Aufsetzen des Fingers zu fragen, ob es Einträge gibt,
  hält Markieren, Systemblase und Browsermenü an Datensätzen ohne Einträge frei (D2). Meldet
  `onOeffnen` beim Zeitgeber doch „keine“, endet der Druck.
- **Tasten-Nachlauf am `window`.** Das nachgeschobene `contextmenu` der Taste trifft das schon
  fokussierte Menü (Portal), nicht den Datensatz. Der Hook verwirft es deshalb in der
  Capture-Phase am `window`, vor rc-trigger, das das Menü sonst schlösse (statt in `onContextMenu`
  wie in D4 zuerst gedacht).
- **Stift ohne Touch-Ereignisse.** Der Touch-Riegel wird nur mit einem gesehenen `touchstart`
  scharf. Liefert der Zeiger keins (Stift unter Windows), schluckt ein eigener Riegel des Hooks
  `mousedown`, `mouseup`, `click` und `contextmenu` bis 400 ms nach dem Abheben; ein neuer Zeiger
  löst ihn sofort.

## Risks / Trade-offs

- [Am Touchgerät lässt sich in Zeilen mit Kontextmenü kein Text mehr per langem Druck markieren
  (D3).] → Gilt nur für Datensätze mit Aktion. Links bleiben ausgenommen, der Titel-Link öffnet
  weiter das Linkmenü des Systems. Kopieren am Tablet ist dort selten; die Detailseite bleibt.
- [Android-Chrome feuert sein `contextmenu` vor oder nach dem eigenen Zeitgeber, je nach Version.]
  → Unterdrückung während eines Touchdrucks unabhängig vom Zeitpunkt; e2e mit CDP-Touch wie
  `e2e/lagekarte-touch.spec.ts`.
- [Rechtsklick mit Maus auf die Zeile ändert das Verhalten für Leute, die dort das Browsermenü
  gewohnt sind (Seite neu laden, Untersuchen).] → Auf Link und Text bleibt es; außerhalb gibt es
  das Browsermenü über eine Zeile ohne Aktion oder den Seitenrand.
- [Verschieben von `PunktankerMenue` und `nachklickRiegel` bricht stille Verweise in Doku und
  Kommentaren.] → Vorher grep über das Repo, Verweise im selben Commit nachziehen.
- [Tauri-Hülle: Die Desktop-Hülle zeigt beim Rechtsklick ein eigenes Webview-Menü.] → Wo die App
  `preventDefault` ruft, erscheint es nicht; sonst unverändert.

## Migration Plan

Reines Frontend, keine Daten. Ausrollen mit dem nächsten Release, Rücknahme durch Revert des PRs.
