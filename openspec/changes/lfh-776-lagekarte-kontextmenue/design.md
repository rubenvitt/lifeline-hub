# Design

## Context

Motivation steht in `proposal.md`. Die Pfade sind relativ zu `frontend/src/`, der Stand ist
`alpha` vom 03.10.2026.

- **maplibre-gl 6.11.2** (`BlockableMapEventHandler`, `src/ui/handler/map_event.ts`):
  - Ein Finger, der 500 ms ruhig liegt, startet einen Zeitgeber, der `contextmenu` als
    `MapMouseEvent` feuert. Der Finger liegt dann **noch** auf dem Schirm. Das Originalereignis ist
    ein selbst gebautes `MouseEvent` (`isTrusted: false`, `button: 2`), mit den Koordinaten des
    Fingers.
  - Bewegt sich der Finger weiter als `clickTolerance`, kommt ein zweiter Finger dazu oder hebt der
    Finger ab, verfällt der Zeitgeber.
  - Ein natives `contextmenu` während einer Berührung (Android-Chrome) unterdrückt maplibre per
    `preventDefault`, aber **nicht** per `stopPropagation`.
  - Ein Rechtsklick mit der Maus feuert `contextmenu` wie bisher. Hört jemand auf `contextmenu`,
    unterdrückt maplibre das Browser-Menü.
- **antd-Dropdown** (`@rc-component/trigger` 3.10, `useWinClick`): Ein offenes Overlay schließt
  bei jedem `mousedown` **und** jedem `contextmenu` außerhalb des Popups. Der Hörer sitzt in der
  Capture-Phase am `window`.
- **Flächen-Auswahlmenü** (LFH-812, `pages/lagekarte/FlaechenwahlMenue.tsx`): gesteuertes antd-`Dropdown`
  im Portal mit `autoFocus`. Es hängt an einem unsichtbaren 1×1-Anker am Tipppunkt, innerhalb der
  `position: relative`-Hülle von `Kartenflaeche`. Geschlossen wird es nur über `onOpenChange`, bei
  `movestart` und wenn die Prop `flaechenwahl` falsch wird. Danach geht der Fokus zurück an die
  Karte. Die Eintragshöhe stellt `flaechenwahlEintragStil(token)` sicher (`minHeight: controlHeight`).
- **Klickziele** (LFH-764/812): `klickzielAm(map, e)` urteilt einmal je Originalereignis über alle
  Klickebenen. Das Ergebnis ist Punktziel > Trefferzone > Fläche bzw. `mehrdeutig`, oder `null`
  für die freie Karte.
- **Exklusive Modi:** `exklusiverModusAktiv = modus.art !== 'idle'` (`useKartenInteraktion.ts`).
  `LagekartePage` reicht es heute als `flaechenwahl={!exklusiverModusAktiv}` weiter.
- **Messen** (`messZeichnung.ts`): ein eigener terra-draw-Controller (`td-mess`). Nach außen bietet
  er nur `starten`, `stoppen`, `zerstoeren` und `abschliessen` an. terra-draw hat keine öffentliche
  API, um einen ersten Punkt in einer laufenden Zeichnung zu setzen. Der Adapter hört auf
  `pointerdown`, `pointermove` und `pointerup` am Kartenelement. `abschliessen` benutzt schon heute
  eine synthetische Geste (Enter).
- **Freies Zeichen** (`useKartenInteraktion.ts`, `legeZeichenMutation`): legt im Modus `zeichen`
  beim Kartenklick an, nur mit `darfSchreiben`, und trägt danach in „Zuletzt verwendet“ ein
  (`merkeZuletztVerwendet`). `FreiesZeichenPicker` hat `wert`, `onChange`, `onAbsenden` (Enter)
  und `autoFokus`.
- **Koordinaten:** `useAnzeigeKonventionen().formatKoordinate(lat, lon)` folgt dem aktiven
  System, auch dem Override aus `koordinatenSystemStore`. Das Kopiermuster mit
  `navigator.clipboard?.writeText` und Quittung steht in `components/KopierbarerText.tsx`.

## Goals / Non-Goals

**Goals:**
- Ein Ereignis (`contextmenu`) bedient Maus und Touch. Die Menülogik kennt den Auslöser nur dort,
  wo er etwas ändert (Nachklick-Riegel, Fokus im Dialog).
- Die Einträge entstehen in einer reinen Ableitung (Rechte-Riegel dort), die in Vitest prüfbar ist.
  Die Karte liefert nur Punkt, Pixel und Auslöser.
- Das Bauteil mit dem Punktanker gibt es genau einmal, für das Flächen-Auswahlmenü und das
  Kontextmenü.
- Jede Wirkung läuft über vorhandene Wege: Messen über den Modus `messen`, das Zeichen über
  `legeFreiesZeichenAn` und `merkeZuletztVerwendet`, die Koordinate über `formatKoordinate`.

**Non-Goals:**
- Öffnen per Tastatur (Kontextmenü-Taste, Shift+F10). Alle drei Handlungen sind ohne das Menü
  erreichbar (Koordinate im Kartenfuß, „Messen“ in der Überlagerung, Zeichen in der Leiste).
  maplibre ignoriert ein `contextmenu` ohne vorheriges `mousedown`. Möglicher Nachzug.
- Kontextmenü auf Objekten (Marker, Cluster, Fachebenen-Punkt). Ein langer Druck dort bleibt
  wirkungslos. Objektbezogene Handlungen haben ihren Weg über Inspector und `MenueAusloeser`.
- „Einsatzort hierher verlegen“ und „Abschnitt hier anlegen“: verworfen, siehe D8.
- Neue Messformen: „Messen ab hier“ misst immer eine Strecke.

## Decisions

### D1 — Gemeinsame Schale `PunktankerMenue`, zwei Menüs

`FlaechenwahlMenue.tsx` gibt die Mechanik an ein neues Bauteil `PunktankerMenue.tsx` ab:

- gesteuertes `Dropdown open`, `trigger={['click']}`, `autoFocus`
- 1×1-Anker an `x/y`
- Schließen nur über `onOpenChange`
- `domEvent.stopPropagation()` am Eintrag
- Fokus zurück beim Schließen und beim Aushängen

Die Schale nimmt `aria-label`, die antd-`items`, `onWaehlen`, `onSchliessen`, `fokusZiel` und
einen `datenLfh`-Namen für den Anker. Der Eintragsstil heißt neutral `punktmenueEintragStil` und
steht in der Schale. `flaechenwahlEintragStil` bleibt als Wiederexport stehen, damit der
LFH-812-Test unverändert grün bleibt. `FlaechenwahlMenue` wird zur dünnen Hülle und behält seine
Props.

- *Verworfen: eine Kopie für das Kontextmenü.* Die heikle Fokus- und Schließ-Mechanik stünde
  zweimal da, und eine Korrektur am einen Menü erreichte das andere nicht.
- *Verworfen: `MenueAusloeser`.* Er ist ein Knopf-Auslöser mit Dreipunkt. Hier gibt es keinen
  Knopf, verankert wird am Druckpunkt.

### D2 — Die Karte meldet den Ort, die Seite liefert die Einträge

`Kartenflaeche` bekommt die Prop
`kontextmenue?: { eintraege(punkt): KontextEintraege; onWaehlen(key, punkt): void } | null`.
`null` sperrt das Menü. `LagekartePage` setzt `null`, solange `exklusiverModusAktiv` gilt, nach
demselben Muster wie `flaechenwahl`. `punkt` ist `{ lng, lat, quelle: 'maus' | 'touch' }`.

- Ein `contextmenu`-Hörer in `Kartenflaeche` (Prop über einen Ref, also kein Neubinden) fragt
  `klickzielAm(map, e)` und entscheidet über die neue reine Funktion `istOrtsziel(ziel)` in
  `klickziel.ts`. Sie ist wahr bei `null` (freie Karte), `zone`, `abschnitt` und `mehrdeutig`,
  und bei `fachebene` nur dann, wenn das Merkmal auf einer Flächenebene liegt
  (`ordneKlickebene(...) === 'fachebeneFlaeche'`). Die Art `fachebene` steht heute für Punkt,
  Bündel, Trefferzone **und** Fläche, deshalb reicht die Art allein nicht. Falsch ist die
  Funktion bei `marker` (Zeichen, Plakette, Trefferzone, aufgefächertes Blatt), `personenCluster`
  und bei Fachebenen-Punkt, -Bündel und -Trefferzone.
- Kräfte-Cluster (Donut) und Bildgriffe sind DOM-Marker ohne Klickebene, `klickzielAm` sieht sie
  nicht. Liegt unter der Stelle ein `.maplibregl-marker` (`elementFromPoint` an den Koordinaten des
  Originalereignisses, die auch der lange Druck trägt), öffnet der Hörer ebenfalls nichts (Review,
  03.10.2026).
- Der Menüzustand `{ nr, x, y, punkt }` liegt in `Kartenflaeche`, wie `offeneWahl`, weil nur dort
  die Pixel, `movestart` und der Fokus der Karte bekannt sind. `movestart` schließt, und wird die
  Prop `null`, schließt das Menü ebenfalls.
- Zwei Menüs zugleich gibt es nicht. Öffnet das Kontextmenü, wird `offeneWahl` geleert, und
  umgekehrt.
- *Warum Fläche ja, Punktziel nein:* Zonen und Gefahrengebiete bedecken große Teile der Karte.
  Ein Menü, das auf Flächen nicht öffnet, wäre im Einsatzgebiet meist nicht zu haben. Auf einem
  Punktziel dagegen erwartet der Mensch eine Handlung am **Objekt**. Ein Ortsmenü dort hieße
  „falsches Ziel“.

### D3 — Nachklick-Riegel für den langen Druck

Der lange Druck öffnet das Menü, solange der Finger noch liegt. Danach können drei Ereignisse
das gerade geöffnete Menü sofort wieder schließen (rc-trigger, `mousedown`/`contextmenu` am
`window`) oder als Tipp auf der Karte landen (`click` → Auswahl, Flächen-Auswahlmenü):

- das native `contextmenu` von Android-Chrome
- die Kompatibilitäts-Mausereignisse des Browsers beim Abheben
- ein `click`

Ein kleiner, rein prüfbarer Riegel (`pages/lagekarte/nachklickRiegel.ts`) wird beim Mounten von
`Kartenflaeche` am `window` in der **Capture-Phase** angemeldet, also vor jedem Dropdown. Er wird
scharf, wenn `contextmenu` aus einem langen Druck kommt (`quelle: 'touch'`). Dann verschluckt er
`contextmenu`, `mousedown`, `mouseup` und `click` (`stopImmediatePropagation` und
`preventDefault`), bis 400 ms nach `touchend`/`touchcancel` vergangen sind. Ein neues
`touchstart` löst ihn sofort.

- **Quelle erkennen:** Der Riegel führt selbst mit, ob ein Finger auf der Karte liegt
  (`touchstart` bis `touchend`, gehört am `window`, gezählt nur mit Ziel im Kartencontainer). Ein
  Finger außerhalb, etwa im Menü im Portal, löst den Riegel ebenfalls sofort. Ein `contextmenu` bei liegendem Finger kommt aus einem langen
  Druck. `isTrusted` wird nicht benutzt, weil sich darauf in Tests nicht bauen lässt.
- *Verworfen: das Menü erst beim Abheben öffnen.* Damit bliebe es beim Halten ohne Rückmeldung,
  und die Kompatibilitäts-Ereignisse nach dem Abheben kämen trotzdem. Den Riegel bräuchte es also
  ohnehin.
- *Verworfen: `click` auf der Karte global unterdrücken, solange ein Menü offen ist.* Das bräche
  „Tipp daneben schließt“ und stünde gegen LFH-812.

### D4 — Einträge als reine Ableitung mit Rechte-Riegel

`pages/lagekarte/kontextmenue.ts` exportiert:

```ts
kontextEintraege({ darfSchreiben }): MenueEintrag<'kopieren' | 'messen' | 'zeichen'>[]
```

Die Reihenfolge ist „Koordinate kopieren“, „Messen ab hier“ und, nur bei `darfSchreiben`, „Hier
Zeichen setzen“. Fehlt das Schreibrecht, fehlt der Eintrag, er steht nicht gesperrt da. Das ist
die Regel „kein Auslöser ohne Rechte“ aus LFH-365, angewandt auf den einzelnen Eintrag.

- Alle drei Einträge sind umkehrbar, also keiner rot und kein Trenner.
- Die antd-Items baut `menueEintraege()` aus `MenueAusloeser.tsx`. Damit gilt LFH-365 ohne
  zweite Implementierung.
- Der Kopf mit der Koordinate (`formatKoordinate(...)`) steht als eigene Zeile über dem Menü
  (Prop `kopf` der Schale, `popupRender`). Er ist kein Eintrag und nicht wählbar. *Nicht als
  antd-Gruppe:* rc-menu fokussierte mit `autoFocus` die Gruppe statt des ersten Eintrags (in
  jsdom belegt). Die Hülle um Kopf und Menü reicht den Fokus an den ersten Eintrag weiter.
- `darfSchreiben` kommt aus `useLagekarteDaten` (Snapshot ⇒ `false`). Das ist der Rechte-Riegel
  an der Ableitung, nicht im Callback.
- LFH-616 („ein Sprung ist keine Handlung“) greift nicht, denn keiner der Einträge ist ein
  Deeplink.

### D5 — „Koordinate kopieren“

`navigator.clipboard?.writeText(text)` nach dem Muster von `KopierbarerText`:

- Erfolg: `message.success('Koordinate kopiert')`.
- Fehler oder fehlende API: `message.error('Kopieren nicht möglich: <Koordinate>')`. Die
  Koordinate steht damit lesbar in der Meldung, und wer am Funk ist, kann sie ablesen.

Der Text ist genau der Kopf des Menüs (`formatKoordinate`), so dass Kopf und Inhalt der
Zwischenablage nicht auseinanderlaufen können.

### D6 — „Messen ab hier“ über einen Startpunkt am Messcontroller

- `MessZeichnung` bekommt `setzeStartpunkt({ lng, lat })`. Die Methode projiziert den Punkt auf
  den Bildschirm (`map.project` plus `getBoundingClientRect` des Canvas). Dort feuert sie
  `pointerdown` und `pointerup` (`pointerType: 'mouse'`, `isPrimary`, `button: 0`) am
  Kartenelement des Adapters. terra-draw nimmt das als Klick und setzt den ersten Punkt.
- `useKartenInteraktion` erhält `onMessenAb(punkt)`: `dispatch({ t: 'messen', form: 'strecke' })`
  plus ein Startpunkt `{ lng, lat, nr }` im State. Der Startpunkt wird beim Ende des Messens
  geleert.
- `Kartenflaeche` nimmt die Prop `messStart`. Im bestehenden Messen-Effekt ruft sie nach
  `starten(messen)` einmal `setzeStartpunkt` auf, wenn `messStart` frisch ist (`nr`). Danach gilt
  alles wie beim Start über die Steuerung: ein Esc beendet (`lagekarte-zeichnen`, „Messen bleibt
  einstufig“).
- *Warum synthetisch:* terra-draw 1.35 bietet keinen öffentlichen Weg, einen Punkt in eine
  laufende Zeichnung zu setzen. `addFeatures` legt nur fertige Figuren an, und eine Linie mit
  einem Punkt ist ungültig. Dieselbe Technik trägt `abschliessen` schon heute. Das Risiko, dass
  ein terra-draw-Update sie bricht, deckt die e2e-Probe aus Aufgabe 6 ab.
- *Verworfen: in die Moduslogik von terra-draw greifen* (`TerraDrawLineStringMode`, interne
  Felder). Das ist privat, also bei jedem Update ein Bruch.

### D7 — „Hier Zeichen setzen“ als Dialog mit der Zeichenwahl

`pages/lagekarte/ZeichenHierDialog.tsx` ist ein antd-`Modal` mit dem Titel „Zeichen hier
setzen“. Es öffnet nach dem Schließen des Menüs (Spec `datensatz-aktionsmenue`: eine Rückfrage
öffnet erst nach dem Menü).

- **Inhalt:** `FreiesZeichenPicker`. Der Startwert ist derselbe Entwurf wie in der Leiste. Die
  Leiste „Zuletzt verwendet“ liefert der Picker selbst mit.
- **Knöpfe:** „Setzen“ (primär) und „Abbrechen“. Enter im Picker (`onAbsenden`) wirkt wie
  „Setzen“.
- **Fokus:** `autoFokus` nur bei `quelle: 'maus'`. Am Tablet klappte sonst die Bildschirmtastatur
  über das Raster.
- **Anlegen:** `useKartenInteraktion` erhält `legeZeichenAnPunkt(spec, punkt)`, eine eigene
  Mutation über `legeFreiesZeichenAn` mit `ansicht_id`, `merkeZuletztVerwendet` und Invalidierung
  wie `legeZeichenMutation`, aber ohne den Modus `zeichen`.
- **Doppelt anlegen:** „Setzen“ ist während `isPending` gesperrt (`loading`), und die Mutation
  prüft `isPending` selbst. `legeFreiesZeichenAn` ist nicht idempotent.
- **Kein Schließen während des Anlegens:** „Abbrechen“, Kreuz, Maske und Esc sind gesperrt, solange
  der POST läuft. Schließen hielte ihn nicht auf, „Abbrechen legt nichts an“ wäre falsch. Der
  Erfolg schließt nur den Dialog seiner eigenen Stelle (Review, 03.10.2026).
- *Verworfen: Modus `zeichen` starten, Leiste öffnen, Punkt vormerken.* Der Mensch müsste in die
  Leiste, die unter `lg` geschlossen ist (LFH-765). Und der vorgemerkte Punkt wäre ein
  unsichtbarer Zustand.
- *Verworfen: Untermenü „Zuletzt verwendet“ im Kontextmenü.* Untermenüs sind am Touchschirm
  schwer zu treffen. Ohne zuletzt verwendetes Zeichen bliebe das Untermenü außerdem leer.

### D8 — Verworfene Einträge (Checkpoint 03.10.2026)

- **„Abschnitt hier anlegen“:** Ein Abschnitt hat keine Punktlage, nur Name und optional eine
  Fläche (`AbschnittEingabe`). „Hier“ hätte keine Wirkung, die der Mensch sehen könnte.
- **„Einsatzort hierher verlegen“:** fachlich denkbar (`verortenMutation`, mit Rückfrage), am
  Checkpoint nicht gewählt. Ein möglicher Nachzug, falls Bedarf entsteht.

### D9 — Nachweis

- **Vitest:**
  - `kontextmenue.test.ts`: Ableitung, Reihenfolge, Rechte
  - `nachklickRiegel.test.ts`: jsdom-Ereignisfolgen
  - `PunktankerMenue`/`KartenKontextMenue.test.tsx`: Tastatur, Esc, Fokus, Kopf
  - `ZeichenHierDialog.test.tsx`: Setzen, Abbrechen, Doppelklick
  - `messZeichnung`: Startpunkt-Geste
  - Stilböden 30/48/72 als Literale
- **e2e** `lagekarte-touch.spec.ts` (`hasTouch`, 390 und 1024 px):
  - langer Druck per CDP `Input.dispatchTouchEvent`: `touchStart`, 700 ms halten, `touchEnd`
  - Menü offen nach dem Abheben, Kamera unverändert, Eintragshöhe ≥ `controlHeight`
  - Belege per Tipp: Messen ab hier, dann Tipp, dann Wert sichtbar; Zeichen setzen, dann Zeichen
    auf der Karte; Langdruck auf Marker, dann kein Menü
  - Messmodus, dann kein Menü
- **e2e Maus** (Fükw): Rechtsklick, Menü, Koordinate kopieren mit der Clipboard-Berechtigung von
  Playwright.
- **Mutationsproben:** Riegel aus ⇒ Touch-Fall „Menü offen nach dem Abheben“ rot. Sperre im Modus
  aus ⇒ Fall „Messmodus“ rot.

## Risks / Trade-offs

- **Synthetischer Startpunkt fürs Messen (D6)** hängt an terra-draws Ereignisannahmen. Dagegen
  hilft die e2e-Probe. Bricht ein Update sie, fällt die Probe rot, und der Eintrag lässt sich
  einzeln abschalten (Ableitung).
- **Riegel-Fenster 400 ms (D3):** Zu kurz, und auf langsamen Geräten käme ein Nachklick durch.
  Zu lang, und ein schneller zweiter Tipp nach dem Abheben ginge verloren. Der Riegel löst
  deshalb schon beim nächsten `touchstart`, ein bewusster Tipp kommt also immer an.
- **Android-natives `contextmenu`:** Das CDP-Touch von Playwright erzeugt es nicht. Den Fall
  belegt nur der jsdom-Test des Riegels. Eine Abnahme am echten Tablet steht als Kriterium in der
  Prüfliste.
- **Kein Menü auf Objekten (D2)** ist eine Lücke, kein Fehler. Ein langer Druck auf einen Marker
  tut sichtbar nichts. Das ist dasselbe Verhalten wie vor diesem Task.
