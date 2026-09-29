# Design

## Context

Siehe proposal.md für das Warum. Stand heute:

- `pages/lagekarte/taktischesZeichen.ts` leitet aus App-Feldern die Props des Altpakets ab
  (`TzProps`): `baueTzProps` sowie `einsatzortTz`, `schadenTz`, `uhsTz` und
  `betreuungsstelleTz`. Welche Overlays gesetzt werden, entscheidet der `accepts`-Katalog des
  Altpakets.
- `marker.ts` schreibt `tz` an jeden Marker. Das gilt auch für freie Zeichen
  (`baueFreiesZeichenTz`).
- `markerIcons.ts:tzIconKey` bildet den Bild-Schlüssel. `Kartenflaeche.tsx` erzeugt das Bild im
  `styleimagemissing`-Handler, und zwar asynchron: SVG-Data-URL → `Image` → `addImage`, normiert
  auf 34 px, ohne `devicePixelRatio`.
- Die Inspector-Kachel nutzt dieselbe Data-URL. `kraefte/EinheitZeichen.tsx` nutzt die
  React-Komponente des Altpakets, ohne `try/catch`.
- `@einsatzzeichen/core` 2.1.0 bringt `drawSymbol(spec)` mit `DEFAULT_PORTS`, `renderSvg`,
  `vocabulary`/`checkSpec` und `serializeSpec`. `@einsatzzeichen/maplibre` 2.1.0 bringt
  `addSymbolImage`, synchron über Canvas. `@einsatzzeichen/react` 2.1.0 bringt `Einsatzzeichen`.
  Alle Pakete pinnen einander exakt.
- Probe vom 29.09.2026: Jede Hub-Abbildung unten komponiert, und keine davon zeichnet Text. Der
  viewBox ist immer 32 × 32 mm.

## Goals / Non-Goals

**Goals:**
- Das Hub-Vokabular (`TzProps`) wird zur Zeichenbeschreibung der Bibliothek (`SymbolSpec`). Die
  Übersetzung steht an genau einer Stelle, mit Rückfallkaskade und Cache.
- Karte, Inspector-Kachel und Meldebild zeichnen die Fachobjekte über diese eine Stelle.
- Die Kartenbilder werden synchron und in Bildschirmschärfe erzeugt.

**Non-Goals:**
- Freie Zeichen, Picker und `FreiesZeichenInspector` bleiben auf dem Altpaket (LFH-836).
- Keine Schrift-Auslieferung, denn die Fachobjekt-Zeichen tragen keinen Text (LFH-832 für später).
- Kein Dunkelmodus-Umbau (LFH-833).
- Keine Änderung an Backend, DB, `ERLAUBTE_ORG`, den Auswahllisten in Inspector und Verwaltung
  oder den gespeicherten Werten.

## Decisions

### D1 Das Hub-Vokabular bleibt, übersetzt wird beim Lesen
`baueTzProps` und die Fest-Specs liefern weiter `TzProps` mit den alten Kennungen. Neu ist
`frontend/src/zeichen/fachobjektZeichen.ts`. Es übersetzt `TzProps` in eine `SymbolSpec` und
löst sie über eine Kaskade zu der ersten Fassung auf, die tatsächlich komponiert. Rückgabe ist
`{ spec, drawing, schluessel }`. `schluessel` ist `'ez|' + serializeSpec(spec)`.

*Warum:* DB-Spalten, Snapshots, IndexedDB und Offline-Stände tragen die alten Werte. Nur ein
Leseadapter erreicht alle diese Ablageorte. Eine SQL-Migration erreicht Snapshots und Geräte
nicht (siehe Scope). *Verworfen:* eine Migration der Spalten auf neue Kennungen. Sie ist
unvollständig, und `ERLAUBTE_ORG`, Bootstrap und die Tests müssten mitwandern, ohne Nutzen für
den Anwender.

### D2 Abbildungstabellen im Adapter
- **Grundzeichen:**
  - `taktische-formation` → `formation`
  - `kraftfahrzeug-landgebunden` → `vehicle-land` + `kfz-kategorie-1`
  - `wasserfahrzeug` → `vehicle-water`
  - `hubschrauber` → `vehicle-air`
  - `anhaenger` → `trailer`
  - `zweirad` → `vehicle-land` (Entscheidung)
  - `person` → `person`
  - `befehlsstelle` → `formation` + Organisation `fuehrung-leitung` (Abschnitt neutral)
  - `anlass` → `event`
  - `gefahr` → `hazard`
  - `stelle` → `circle-12` + `hilfsorganisation` (Entscheidung)
- **Organisation:** `fuehrung` → `fuehrung-leitung`, `gefahrenabwehr` →
  `sonstige-gefahrenabwehr`, `zivil` → `zivile-einheiten`. Die übrigen Kennungen bleiben
  gleich.
- **Stärke:** trupp, staffel, gruppe und zug bleiben gleich. `zugtrupp` → `trupp` +
  Körpermarke `formation-solid-cap-3mm`.
- **Fachaufgabe:** Jede Fachaufgabe bildet auf eine oder mehrere Fassungen ab, jede davon eine
  Teil-Spec. Die Kaskade probiert sie der Reihe nach.
  - `brandbekaempfung` → fire-fighting
  - `rettungswesen` → medical-service. Am Kfz zusätzlich die Fassung `plain-wheel-pair` ohne
    Kategorie (RTW, F.2).
  - `aerztliche-versorgung` → physician
  - `technische-hilfeleistung` → technical-assistance
  - `bergung` → recovery
  - `betreuung` → care
  - `iuk` → information-communications
  - `wasserrettung` → water-rescue
  - `logistik` → `bodyVariant: foot-band`
  - `verpflegung` → foot-band + catering
  - Die übrigen umbenannten Kennungen folgen der Scope-Tabelle.
  - Jede Fähigkeit wird zuerst als `bodyMarks` (randbündig, wie die Referenzrezepte) versucht,
    dann als `capabilities` (Box).
  - `fuehrung` bildet auf nichts ab. Die Bibliothek kennt keine Fähigkeit „Führung“. Die Farbe
    der Organisation bleibt die Aussage, eine gelbe Umfärbung eines Feuerwehr-ELW wäre
    irreführend. Der Abschnitt ist davon unberührt, er ist per Grundzeichen gelb.
- **Führungskraft:** Die Fachaufgabe wird an `person` nie gesetzt (Entscheidung), die Funktion
  `fuehrungskraft` ebenso nicht. Es gibt kein generisches Gegenstück, siehe LFH-830.
- **Farbe (Schaden):** Der Hexwert aus `AUSMASS_FARBE` wird auf ein Token der Palette
  abgebildet: `#52c41a` → gruen, `#faad14` → gelb, `#fa8c16` → orange, `#f5222d` → rot, sonst
  grau. `schadenTz` behält seinen Hexwert, weil andere Stellen (Kreis, Akzent) ihn lesen.
- **Symbole der UHS** (`sammelplatz-betroffene`, `sammeln`): Sie haben keine Achse. Die Typen
  Patientenablage und Verletztensammelstelle werden deshalb wie „sonstige“ gezeichnet (Stelle
  HiOrg + Sanität). Der Typ steht ohnehin in der Unterzeile. LFH-834 holt die Symbole nach.

*Verworfen:* ein generischer Abgleich über `vocabulary()`. Die Tabelle ist klein, fachlich
entschieden und als Pin testbar. `vocabulary()` gehört in den Picker (LFH-836).

### D3 Rückfallkaskade statt accepts-Gating
Die Reihenfolge ist:
1. volle Spec, dabei jede Fassung der Fachaufgabe
2. ohne Fachaufgabe
3. ohne Stärke und Kappe
4. ohne Organisation
5. Körper allein

Jeder Schritt ruft `drawSymbol` in `try/catch`. `CompositionError` und `NotMeasuredError`
gelten als „nächste Stufe“. Ein anderer `Error` gilt ebenfalls als Rückfall, wird aber in DEV
per `console.warn` gemeldet, weil er auf einen Programmfehler hindeutet. Wirft auch der Körper
allein, liefert der Adapter `null`: Die Karte zeigt dann den Kreis wie heute ohne `tz`, das
Meldebild ein leeres Feld.

`baueTzProps` verliert sein accepts-Gating über den Katalog des Altpakets. Die Kaskade ersetzt
es, und der Schlüssel entsteht aus der *wirksamen* Spec, dedupliziert also von selbst.
`grundzeichenAkzeptiert` bleibt nur für die freien Zeichen stehen und fällt mit LFH-836.

*Warum:* `validateSpec() === []` sagt nichts über die Komponierbarkeit (gemessen). Nur die
Komposition selbst entscheidet. *Verworfen:* eine handgepflegte Accepts-Tabelle. Sie würde bei
jedem Bibliotheks-Release still veralten.

### D4 Cache
Der Adapter cacht nach einem Eingabeschlüssel, das ist der bisherige `tzIconKey`-String der
`TzProps`, in einer modulweiten `Map`. Eine Komposition kostet etwa 0,04 ms, eine Kaskade
höchstens rund zehn Versuche. Der Cache verhindert, dass jeder Marker-Effekt neu komponiert. Er
hat keinen Deckel: Die Zahl der unterschiedlichen Fachobjekt-Zeichen je Sitzung ist klein
(Grundzeichen × Organisation × Fachaufgabe × Stärke).

### D5 Ein Schlüssel je Marker, zwei Renderwege
`markerIcons.ts` bekommt `markerIconKey(mk)`:
- Für `typ === 'freies_zeichen'` gilt weiter `tzIconKey(tz)` mit dem Präfix `tz|` (Altpaket).
- Für alle übrigen Marker mit `tz` gilt der Adapter-`schluessel` mit dem Präfix `ez|`.

Die Registry in `Kartenflaeche.tsx` hält je Schlüssel entweder `{ art: 'ez', drawing }` oder
`{ art: 'tz', tz }`. `ez|` bedient **`map.setMissingStyleImageResolver`** synchron:

`addSymbolImage(map, id, drawing, { size: 34, pixelRatio: max(1, ceil(devicePixelRatio)) })`

Das geschieht unter `hasImage`-Guard und in `try/catch`. Der `tz|`-Weg bleibt im
`styleimagemissing`-Handler.

*Warum der Resolver und nicht `styleimagemissing`:* MapLibre 6 baut die Bildantwort einer Kachel,
**bevor** es das Event feuert (`render/image_manager.ts`, `_getImagesForIds`). Ein erst dort
angelegtes Bild fehlt im laufenden Layout und erscheint erst beim nächsten Neu-Layout. Nach einem
Stilwechsel ohne neue Daten erscheint es nie. Im Review gemessen: Der Einsatzort war nach
`setStyle` registriert, aber nie gezeichnet, und Schadenszeichen fehlten in 1 von 4 Läufen. Den
Resolver wartet MapLibre ab, und er überlebt `setStyle`. Dieselbe Ursache betrifft die Plaketten
(`plakette|`) und das Altpaket (`tz|`), siehe Nachzug im Board.

*Warum synchron über Canvas:* Das entfernt das `ladendeIcons`-Rennen für diesen Weg. Die Schärfe
folgt dem Bildschirm. `size × pixelRatio` bleibt ganzzahlig, sonst wirft die Bibliothek einen
`RangeError`. *Verworfen:* weiter über ein SVG-Bild. Das wäre auf HiDPI unscharf, und sobald ein
Zeichen Text trägt, fehlte die Schrift.

### D6 Inspector-Kachel und Meldebild
- **Inspector:** `markerBild(marker)`. Für Fachobjekte ist das eine Data-URL aus
  `renderSvg(drawing, { size: 64, idPrefix })`, für freie Zeichen der bisherige Weg.
- **Meldebild:** `EinheitZeichen` nimmt `<Einsatzzeichen drawing size={22} idPrefix={useId()…} />`
  aus `@einsatzzeichen/react`. Ist `drawing` gleich `null`, bleibt das Feld leer. Der Rahmen
  (26 px, `aria-hidden`) bleibt, wie er ist.
- **Gemeinsamer Baustein:** `zeichen/EinsatzZeichen.tsx` kapselt den Adapter für React (Adapter
  + Komponente + `useId`-Präfix).

*Warum `idPrefix`:* Der Vorgabepräfix `ez` erzeugt in einer Liste doppelte IDs.

### D7 Abhängigkeiten
Aufgenommen werden `@einsatzzeichen/core`, `schema`, `react` und `maplibre`, alle exakt `2.1.0`
ohne `^`. Ein Vitest-Guard prüft, dass alle `@einsatzzeichen/*` in `package.json` dieselbe exakte
Version tragen. Sonst entstünde still ein zweites `core` im Bundle, weil `react@2.0.0` exakt
`core@2.0.0` pinnt (gemessen).

Nicht aufgenommen werden:
- `catalog`: deprecated und auf 1.5 gepinnt.
- `conformance`: nur für Node.

Der Chunk landet in den Lazy-Routen Lagekarte und Kräfteübersicht. Einen eigenen
`dynamic import` braucht es nicht.

## Risks / Trade-offs

- **[Optik ändert sich sichtbar]:** Polizei-Grün, Stelle als kleiner Kreis, Kfz mit Fahrwerk,
  Abschnitt gelb statt „Befehlsstelle“. → Das ist fachlich gewollt (BABZ 2025). Die Prüfliste
  zur Einsatztauglichkeit und eine Sichtprüfung im Browser gehen jedem Merge voraus.
- **[Zwei Zeichenbibliotheken parallel bis LFH-836]:** Das Bundle wächst vorübergehend um die
  Größe beider Bibliotheken. → Das ist befristet. Das Altpaket fällt in Schnitt 2, im Chunk der
  Lazy-Routen.
- **[Bibliotheks-Update ändert die Komponierbarkeit]:** → Die Pin-Tests je Abbildung rufen
  `drawSymbol` echt auf. Ein Update, das eine Hub-Abbildung bricht, wird rot statt still zum
  Rückfall. Die Kaskade schützt nur den Betrieb, nicht die Tests.
- **[jsdom hat kein Canvas]:** → Der Kartenweg wird nur in e2e belegt (`lagekarte-smoke`,
  `gate3-trefflaeche`, neue Größenprobe über `__lfhKarte.getImage`). Adapter und SVG-Wege laufen
  in Vitest.
- **[Dunkel bleibt schwarz auf dunkel]:** Das ist wie heute. → LFH-833 in der Bibliothek.

## Migration Plan

Es gibt keine Datenmigration. Das Deployment ist ein normaler Release. Für einen Rückbau genügt
ein Revert des Frontends, da Backend und Daten unberührt bleiben.
