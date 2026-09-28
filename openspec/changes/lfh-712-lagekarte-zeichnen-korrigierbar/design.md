# Design

## Context

Motivation: siehe `proposal.md` — Why. Verhalten: siehe die beiden Specs.

Heutiger Stand, soweit er den Weg bestimmt:

- `pages/lagekarte/zeichnen.ts` kapselt eine terra-draw-Instanz je Zeichenart (Abschnitt `drawRef`,
  Zone `zoneDrawRef` in `Kartenflaeche.tsx`; das Messen hat mit `messZeichnung.ts` eine eigene, dritte
  Instanz, jede mit eigenem `prefixId`). Nach außen meldet es nur `onBereitschaftAendern(bereit)`, aus
  dem die Seite `zeichnenBereit` für „Abschließen" hält. Die Punkte zählt es selbst über Canvas-Klicks
  (terra-draw veröffentlicht keine Zahl der fest gesetzten Punkte; der Snapshot enthält den beweglichen
  Vorschaupunkt).
- terra-draw ist 1.34.0. Es bringt Undo nur, wenn der Konstruktor `undoRedo: { modeLevel: new
  TerraDrawModeUndoRedo() }` bekommt — ohne die Option liefert `undo()` konstant `false`. `undo()` und
  `canUndo()` **werfen**, solange die Instanz gestoppt ist. Neu gegenüber dem C9-Stand (1.32) ist das
  Ereignis `history` mit `undoSize`.
- Esc gehört heute terra-draw: die Modi haben `keyEvents.cancel = 'Escape'` als Vorgabe und brechen auf
  `keyup` **am Canvas** ab — nur, wenn der Canvas den Fokus hat. Die Seite erfährt davon nichts.
- Der C9-Commit `585b741c` (Branch `worktree-feat+lfh-344-lagekarte-einsatztauglich`) hat
  `punktZurueck`/`kannZurueck` und eine Esc-Quittung schon einmal gebaut, auf 1.32, ohne `prefixId` und
  mit einstufigem Esc, das den Modus beendete. Er wird **nicht** cherry-gepickt, sondern gelesen und von
  Hand übertragen.
- Die Kartenknöpfe (`KartenUeberlagerung.tsx`) sind eigene `Kartenknopf`-Elemente in einer Spalte oben
  rechts; MapLibre-Controls gibt es nicht mehr. `personen/BetroffeneKarte.tsx` nutzt dieselbe
  Überlagerung ohne „Messen" und ohne „Zeichnen".
- `setStyle(…, { diff: false })` beim Grundlagenwechsel wirft alle eigenen Sources/Layer weg;
  `planeReAnlegenNachStyle` legt die bekannten Ebenen neu an.

## Goals / Non-Goals

**Goals:**
- Ein Zustand, aus dem „Abschließen", „Letzten Punkt zurück" und der Zähler abgeleitet sind — kein
  zweiter Boolean, der auseinanderlaufen kann.
- Esc hat beim Zeichnen genau **einen** Besitzer.
- Eigenposition ohne jeden Serverkontakt und ohne Persistenz.

**Non-Goals:**
- Kein Wiederherstellen (Redo) und kein Strg/⌘+Z — der Knopf ist der Weg zurück.
- Kein Undo nach dem Abschluss einer Figur (Bestätigungsphase): dort gilt „Verwerfen" bzw. Esc.
- Kein Undo beim Messen und bei der Bild-Platzierung.
- Der offene Zonen-/Abschnittsentwurf überlebt einen Grundlagenwechsel weiterhin nicht (Bestand,
  CLAUDE.md „Ein Sprung ist keine Handlung").
- Keine Eigenposition auf `BetroffeneKarte`, kein Teilen des Standorts mit anderen, kein Kompass.

## Decisions

### D1 — Ein Stand statt zweier Booleans

`createZeichnung` meldet `onStandAendern({ punkte, bereit, kannZurueck })` statt
`onBereitschaftAendern(bereit)`. Alle drei Werte entstehen an **einer** Stelle im Adapter, der als
einziger die Mindestpunktzahl je Form kennt; die Seite liest `bereit` für „Abschließen", `punkte`
für den Zähler und `kannZurueck` für den Zurück-Knopf. Gemeldet wird nach jeder eigenen Aktion
(Punkt gesetzt, `starten`, `stoppen`, `punktZurueck`, `verwerfen`, `finish`), nur bei Wertänderung.

- `kannZurueck = aktiv && punkte > 0` — aus dem **eigenen** Zähler, nicht aus `draw.canUndo()`
  (Nachtrag aus dem Apply): der Capture-Klick des Adapters läuft, bevor terra-draw den Punkt
  verarbeitet, `canUndo()` wäre beim ersten Punkt noch `false` und der Knopf bliebe eine Runde zu
  lange gesperrt. Ein `history`-Zuhörer wird damit überflüssig.
- `punktZurueck()` fragt terra-draw nur mit eigenem Punkt und hinter dem `enabled`-Riegel
  (`undo()` wirft bei gestopptem TerraDraw).
- Die geordnete Punktliste aus C9 (Array statt Set, Pixel-Entdoppelung bleibt) trägt `punkte`.

*Alternative:* zwei getrennte Callbacks nach LFH-468 (`onZeichnenZurueckAenderung`). Verworfen: zwei
Meldewege für einen Zustand sind genau die Stelle, an der Zähler und Knopf auseinanderlaufen.

### D2 — Esc gehört der Seite, nicht terra-draw

Beide Zeichen-Modi in `zeichnen.ts` bekommen `keyEvents: { cancel: null, finish: 'Enter' }`.
`finish` muss `'Enter'` bleiben: `abschliessen()` löst den Abschluss über ein synthetisches Enter am
Canvas aus. `messZeichnung.ts` bleibt unverändert — dort ist das terra-draw-Esc gewollt.

Die Seite (`LagekartePage.tsx`) hängt, solange ein Zeichenmodus aktiv ist, einen `keydown`-Zuhörer an
`window` (dieselben Riegel wie beim Messen: `defaultPrevented`, Eingabeziele) und entscheidet die Stufe:

| Lage | Wirkung |
|---|---|
| Speichern läuft | nichts |
| Bestätigungsphase (Zone fertig, ungespeichert) | zurück in die Zeichenphase: Reducer-Fall `zone` mit demselben Entwurf + `zoneZeichnenNonce` (derselbe Weg wie der Serienpfad), Quittung |
| Zeichenphase, `punkte > 0` | `verwerfen()` am Adapter (Entwurf löschen, Modus neu setzen), Quittung |
| Zeichenphase, `punkte == 0` | Modus beenden: in einer Serie mit Gespeichertem `onZoneZeichnenFertig`, sonst `onZeichnenAbbrechen` |

Warum der Besitz wechseln muss (gemessen am C9-Stand, nicht vermutet): terra-draw bricht auf `keyup`
am Canvas ab, ein `window`-Zuhörer läuft danach. Er sähe also schon beim **ersten** Esc „0 Punkte" und
spränge direkt in Stufe 2 — das zweistufige Esc wäre im ersten Test einstufig. Und bei Fokus auf einem
Steuerungsknopf erreicht die Taste den Canvas gar nicht; das Verwerfen hinge dann am Fokus.

Die Quittung („Zeichnung verworfen", `message.info` über `App.useApp()`) entsteht **nur** im Esc-Zweig,
nicht aus einem `change`-Ereignis. Dadurch kann das Zurücknehmen des letzten Punktes — terra-draw
löscht dabei den Entwurf — keine falsche Quittung auslösen.

*Entscheidung des Auftraggebers (28.09.2026):* „zweistufig — je öfter Esc, desto mehr Richtung
view-only". Das **widerspricht** dem Tickettext („die LFH-616-Regel ‚nur Messen endet mit Escape' …
bleibt unberührt"): der zweite Esc beendet jetzt auch das Zeichnen. Die Entscheidung gewinnt; die
CLAUDE.md-Aussage „Es ist der einzige Modus, den Escape beendet" wird angepasst. Unverändert bleibt,
dass kein Entwurf mit **einem** Esc samt Modus verloren geht.

*Alternative:* Esc beendet sofort den Modus (C9). Verworfen durch die Entscheidung oben.

### D3 — `keydown`, nicht `keyup`

C9 hing die Quittung an `keyup`, weil terra-draw dort abbrach und ein `keydown`-Zuhörer „quittierte,
bevor etwas passiert ist". Mit D2 gibt es diese Reihenfolge nicht mehr: die Seite verwirft selbst,
synchron, im selben Handler. `keydown` ist dann richtig und entspricht dem Messen-Handler.

### D4 — Steuerung: Knopf, Zähler, Hinweis an genau einer Stelle

`ZeichnenSteuerung` bekommt in der Zeichenphase `punkte` (Anzeige „n Punkte", Mono, `tabular-nums`)
und `onPunktZurueck` + `punktZurueckMoeglich`. Der Knopf ist ein antd-`Button` (erbt die Steuerhöhe,
kein punktuelles `size`), gesperrt über `disabled`. Die Reihe hat damit drei Knöpfe — sie trägt
`Space` mit Umbruch, damit sie im 320-px-Band und bei 390 px nicht überläuft.

Der Tastaturvertrag steht **einmal**, in der Hinweiszeile der Steuerung: „Esc verwirft die Zeichnung,
ein zweites Esc beendet das Zeichnen." — nicht zusätzlich im Knopf oder als Tooltip.

### D5 — Eigenposition: Zustand in einem Hook, Darstellung in der Karte

- **Hook `useEigenposition()`** (`pages/lagekarte/useEigenposition.ts`): kennt `verfuegbarkeit`
  (`'bereit' | 'unsicher' | 'fehlt'` aus `window.isSecureContext` und `'geolocation' in navigator`),
  `an`, `position` (`lat`, `lon`, `genauigkeit`) und schaltet `watchPosition`/`clearWatch`. Aufräumen
  beim Ausschalten **und** beim Unmount (e2e läuft unter StrictMode: doppeltes Einhängen darf keine
  zweite Uhr hinterlassen). Kein `localStorage`, kein Zustand über den Hook hinaus. Fehler
  (`PERMISSION_DENIED`, `POSITION_UNAVAILABLE`, `TIMEOUT`) schalten aus und melden über `message`.
  `enableHighAccuracy: true`, `timeout` endlich (Wert im Apply festlegen).
- **Knopf** in `KartenUeberlagerung.tsx`: optionale Prop `eigenposition` (fehlt → kein Knopf, wie
  `onMessen`), Ikone `TbCurrentLocation`, `aria-pressed` wie „Messen". Gesperrt heißt **`aria-disabled`,
  nicht `disabled`** (Entscheidung des Auftraggebers: der Grund erscheint beim Antippen): der Klick
  öffnet ein Popover mit dem Grund, und der Grund hängt zusätzlich per `aria-describedby` am Knopf.
  Ein echtes `disabled` nähme den Klick und damit den einzigen Weg zum Text auf Touch.
- **Darstellung** in `Kartenflaeche.tsx`: Prop `eigenposition` (Position oder `null`) und eine
  eigene GeoJSON-Quelle (Genauigkeitskreis als Polygon aus Radius in Metern + Punkt), angelegt und
  nach `setStyle` neu angelegt über `planeReAnlegenNachStyle` wie die übrigen Ebenen. Das Anfliegen
  beim ersten Fix übernimmt die Seite über das bestehende `flyToZiel`.
- **`localhost` ist ein sicherer Kontext** — im e2e steht der Knopf deshalb frei. Der gesperrte Zweig
  wird in Vitest mit gestubbtem `isSecureContext` belegt, der Geolocation-Pfad im e2e mit
  Playwrights `geolocation` + `permissions`.

*Alternative Darstellung:* DOM-Marker (`maplibregl.Marker`), der `setStyle` übersteht. Verworfen für
den Kreis: seine Pixelgröße hinge an Zoom und Breite und müsste bei jedem Zoom nachgerechnet werden;
der Punkt allein als Marker hätte zwei Mechanismen für eine Anzeige.

## Risks / Trade-offs

- [eigener Zähler und terra-draws Undo-Stapel laufen auseinander, etwa wenn terra-draw einen
  gezählten Klick verwirft] → `punktZurueck()` zählt nur herunter, wenn `undo()` gelang; der e2e
  belegt „3 → zurück → 2" an der echten Karte.
- [Knopf ist in jsdom „tot"-grün, weil `undoRedo` fehlt] → eigener Test, dass der Konstruktor die
  Option bekommt (Mutationsprobe in C9: ohne sie 4 von 7 rot); der e2e belegt es an echter Karte.
- [Sechster Knopf in der Kartenspalte] bei 390 px im Handschuh-Betrieb 6 × 72 px: kann
  `e2e/fokus-verdeckung.spec.ts` (Fuß endet vor der Knopfspalte, LFH-373) und
  `e2e/gate3-trefflaeche.spec.ts` treffen → beide Specs laufen im Apply mit; bricht einer, wird die
  Spalte geklärt statt der Test gelockert.
- [Esc-Zuhörer an `window` kollidiert mit Menüs/Dialogen] → `defaultPrevented`-Riegel wie beim Messen;
  antd-Dropdowns und -Modals schließen per Esc und setzen den Default-Weg.
- [Eigenposition am Fükw ohne GPS] liefert ungenaue oder keine Position → Genauigkeitskreis zeigt die
  Unschärfe ehrlich; kein Standort → Meldung (Spec).
- [Datenschutz] → Spec „Standort verlässt das Gerät nicht"; e2e prüft, dass keine Anfrage die
  Koordinaten trägt.

## Migration Plan

Reines Frontend, keine Migration, kein Schalter. Rücknahme durch Revert.
