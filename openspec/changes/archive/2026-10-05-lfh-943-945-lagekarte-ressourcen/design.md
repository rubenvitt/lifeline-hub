# Design

## Context

Motivation: `proposal.md`, „Why“. Anforderungen: `specs/lagekarte-ressourcen/spec.md`.
Stand `alpha` 894781c9; die Zeilennummern der Tickets (Audit-Stand 0e8db77) sind veraltet.

- **Karten-Effekt und Controller-Abbau** (`Kartenflaeche.tsx`): Der Effekt, der die Karte
  erzeugt, steht vor den Effekten der drei terra-draw-Controller und der Bildgriffe. React führt
  die Cleanups beim Aushängen in Deklarationsreihenfolge aus: erst `map.remove()` (löscht
  `map.style`), dann der eigene Abbau-Effekt mit `zerstoeren()` → `draw.stop()` → Adapter
  `clear()` → `getSource(…)` auf `undefined` → TypeError. Der Wurf bricht den Cleanup ab und
  landet bei der Fehlergrenze des Routers.
- **`wendeKartenDatenAn`** (`kartenDaten.ts`): wartet bei `!isStyleLoaded()` mit einem eigenen
  `render`-Hörer je Aufruf. Elf Aufrufer: zehn in `Kartenflaeche.tsx` (Abschnitte, Zonen,
  Fachebenen, Bilder, Marker, Suchnadel und Eigenposition je zweimal, vertagter Zonen-Start),
  einer in `kartenLayer.ts` (`planeReAnlegenNachStyle`). Die Reihenfolge der Hörer trägt die
  Ebenenfolge nach einem Stilwechsel („zuletzt angemeldet → oben“, Kommentare an Marker,
  Eigenposition und Zonen-Start, LFH-825 D6).
- **maplibre 6.11.2**: `isStyleLoaded()` = `style.loaded()` = `_loaded` **und** keine
  `_updatedSources` **und** alle Kacheln geladen **und** alle Bilder geladen. `addSource`,
  `addLayer` und `removeLayer` prüfen nur `_checkLoaded()`, also `_loaded`. `setData` einer
  GeoJSON-Quelle prüft gar nichts. `Style._loaded` ist im mitgelieferten `.d.ts` öffentlich
  typisiert. `setStyle(…, { diff: false })` setzt synchron ein neues `Style` mit
  `_loaded = false`.
- **Hintergrundbilder** (`useKartenbilder.ts`): Der Ladeeffekt startet je fehlender ID einen
  Download und übernimmt die URL nur, solange sein Lauf nicht abgebrochen ist. Jeder Refetch der
  Bilderliste und jeder Snapshot-Wechsel bricht den Lauf ab; eine danach ankommende URL bleibt
  unerreichbar, und der neue Lauf startet denselben Download noch einmal.
- **Abschnittsflächen**: `LagekartePage` baut die Prop bei jedem Render neu
  (`flaechen.map(…)` bzw. `[]`), `Kartenflaeche` reagiert auf die Identität mit `setData`.
- **KRITIS/Energie** (`useFachebenen.ts`): `gcTime` 6 h je gerasterter bbox; die Abfragen
  werden weder gespeichert (`offline/`) noch von `queryClient.ts` begrenzt.

## Goals / Non-Goals

**Goals:**
- Der Modulwechsel mit laufendem Werkzeug wirft nicht, und alle Controller werden abgebaut.
- Je Karte und Ebene höchstens eine ausstehende Anwendung; die Ebenenfolge nach einem
  Stilwechsel bleibt wie heute.
- Jede Bild-URL wird freigegeben; kein doppelter Download.
- Kein `setData` auf `abschnitte` ohne inhaltliche Änderung.
- KRITIS- und Energie-Einträge nicht beobachteter Zellen nach 5 min aus dem Cache.

**Non-Goals:**
- Eine eigene `errorElement`-Fehlerseite für den Router. Sie wäre ein eigener Task; hier wird
  der Wurf beseitigt, nicht seine Darstellung.
- Den Poll-Takt der Fachebenen und den Anflug der Eigenposition (eigene Tasks im Board).
- Die übrigen Quellen von `setData` (Zonen, Marker) auf Inhaltsvergleich umstellen. Der Befund
  betrifft nur die Abschnitte, deren Prop je Render neu entsteht; Zonen und Marker kommen als
  stabile Query-Daten.

## Decisions

### D1 — Controller vor `map.remove()`, im Cleanup des Karten-Effekts

Der Cleanup des Karten-Effekts baut zuerst `drawRef`, `zoneDrawRef`, `messRef` und
`handlesRef` ab und setzt sie auf `null`, dann folgt `map.remove()`. Der separate
Abbau-Effekt entfällt; der Effekt der Bildgriffe behält seinen eigenen Cleanup für den
Bildwechsel (`zerstoeren()` der Griffe ist wiederholbar: `off`, `Marker.remove`, `clear`).

Zusätzlich fangen `zerstoeren()` in `messZeichnung.ts` und `zeichnen.ts` einen Wurf von
`draw.stop()` ab; in `zeichnen.ts` läuft `zuruecksetzen()` trotzdem (im `finally`). Das ist
die zweite Linie für jeden anderen Weg, auf dem die Karte vor dem Controller verschwindet.

- **Verworfen: nur den Abbau-Effekt vor den Karten-Effekt ziehen.** Die Reihenfolge hinge an
  der Stellung zweier Hooks in einer 1700-Zeilen-Datei; die nächste Umstellung bräche sie still.
  Im selben Cleanup steht die Reihenfolge in drei aufeinanderfolgenden Zeilen.
- **Verworfen: nur `try/catch` in `zerstoeren()`.** Der Controller bliebe halb abgebaut
  (terra-draw-Hörer am Canvas), und das Symptom wäre nur verdeckt.

### D2 — Eine Warteschlange je Karte, ein Schlüssel je Ebene

`wendeKartenDatenAn(map, schluessel, anwenden)`. Eine modulweite
`WeakMap<Karte, Map<string, () => void>>` hält je Karte die ausstehenden Anwendungen, dazu ein
einziger `render`-Hörer je Karte, solange die Warteschlange nicht leer ist.

- **Ersetzen rückt ans Ende** (`delete` + `set`): Die Warteschlange läuft in der Reihenfolge
  der **letzten** Anmeldung. Das ist genau die Folge, die heute aus den gestapelten Hörern
  entsteht (der jüngste Hörer eines Schlüssels läuft zuletzt, die älteren wenden einen
  veralteten oder denselben Stand an). Damit bleibt „zuletzt angemeldet → oben“ wahr.
- **Sofort nur bei leerer Warteschlange.** Ist die Karte bereit, aber steht noch etwas aus,
  reiht sich der Aufruf hinten an. Sonst überholte etwa der vertagte Zonen-Start (er meldet
  sich am `style.load` an) den Neuaufbau der App-Ebenen, der erst im nächsten Frame läuft, und
  terra-draw läge unter den Zonen (LFH-825 D6).
- **Abarbeiten:** Im ersten `render`-Frame mit bereiter Karte die Einträge entnehmen und der
  Reihe nach ausführen; ist die Schlange danach leer, meldet sich der Hörer ab. Was ein Eintrag
  neu anmeldet, läuft im selben Durchgang mit.
- Schlüssel: `abschnitte`, `zonen`, `fachebenen`, `bilder`, `marker`, `suchnadel`,
  `eigenposition`, `zonen-start`, `stil-neuaufbau`. Suchnadel und Eigenposition teilen den
  Schlüssel mit ihrer Neuanlage nach dem Stilwechsel: beide lesen aus derselben Ref.

- **Verworfen: Obergrenze für die Zahl der Hörer.** Begrenzt das Leck, lässt aber veraltete
  Stände laufen und verteilt die Ebenenfolge auf Zufall.

### D3 — „Bereit“ heißt: Style-JSON angewandt (Entscheidung, Prüfauftrag aus dem Ticket)

Die Warteschlange gilt als bereit, sobald `map.style?._loaded` wahr ist, nicht erst bei
`isStyleLoaded()`. Geprüft an maplibre 6.11.2 (Context): `addSource`/`addLayer` verlangen nur
`_loaded`, `setData` gar nichts. Alles, was die Anwender tun (`sorgeFuer…Layer`, `setData`,
`moveLayer`), ist damit sicher, sobald `_loaded` steht. `isStyleLoaded()` wartet zusätzlich auf
jede Kachel und jedes `setData` einer anderen Quelle (`_updatedSources`); auf einer schwachen
Leitung kam deshalb weder die Eigenposition noch eine Lageänderung auf die Karte, solange
etwas lud. Das ist dieselbe Unterscheidung, die LFH-825 für den Zonen-Start schon trifft
(„Merker ab `style.load`, nie `isStyleLoaded()`“).

Nach `setStyle(…, { diff: false })` ist das neue `Style` synchron ungeladen, die Warteschlange
wartet also weiter zuverlässig auf den neuen Stil. Nach `map.remove()` fehlt `map.style`; die
Karte gilt nie mehr als bereit, und Ausstehendes verfällt mit der Karte (WeakMap).

- **Verworfen: `isStyleLoaded()` behalten.** Sicherer gegen unbekannte Abhängigkeiten von der
  Kachel-Wartezeit, behält aber den Stillstand der Eigenposition, den der Befund beschreibt.
  Die e2e-Läufe der Lagekarte (Stilwechsel, Zeichnen per Link, Spider) prüfen das Risiko.
- **Verworfen: eigener Merker je Karte ab `style.load`.** Dieselbe Aussage wie `_loaded`, aber
  ein zweiter Zustand, der beim Stilwechsel von Hand zurückgesetzt werden müsste.

### D4 — Bild-Downloads leben unabhängig vom Lauf des Effekts

- Laufende Downloads stehen in einem Ref `imFlug` (Set der Bild-IDs). Ein Lauf startet nur
  Bilder, die weder eine URL haben noch im Flug sind.
- Die Übernahme entscheidet der Stand **bei Ankunft**, nicht der Lauf, der den Download
  startete: Ist das Bild noch in der aktuellen Liste (Ref der aktiven IDs) und der Download nicht
  abgebrochen, wird die URL übernommen, sonst sofort freigegeben. So verwirft ein Refetch der
  Bilderliste keinen Download mehr, der gleich ankommt.
- Ein `AbortController` je `einsatzId` (eigener Effekt) bricht beim Einsatzwechsel und beim
  Aushängen ab. `ladeBildBlobUrl(einsatzId, id, signal?)` kombiniert ihn mit dem bestehenden
  Timeout über `AbortSignal.any`. Ein Abbruch ist kein Fehler für die Meldung.
- Der Unmount-Effekt gibt wie bisher alle übernommenen URLs frei.

- **Verworfen: Abbruch bei jedem Lauf des Effekts.** Jeder Refetch der Bilderliste (Live-Kanal)
  bräche alle laufenden Downloads ab und startete sie neu, über dieselbe schwache Leitung.

### D5 — Abschnittsflächen: stabile Projektion und Inhaltsvergleich

- `LagekartePage`: `useMemo` über `[layer.abschnitt, flaechen]`, leere Liste als
  Modulkonstante `LEER_FLAECHEN`.
- `Kartenflaeche`: der `[flaechen]`-Effekt bildet einen Inhaltsschlüssel
  (`JSON.stringify` der gebauten FeatureCollection: id, label, Polygon) und kehrt bei
  gleichem Schlüssel zurück. `flaechenDatenRef` behält dann denselben Inhalt; die Neuanlage
  nach dem Stilwechsel liest weiter daraus. Abschnittsflächen sind wenige Polygone, der
  Schlüssel kostet weniger als ein `setData` im Worker.

Beide Stufen, weil jede allein nicht reicht: das `useMemo` fängt Renders der Seite, der
Vergleich fängt neue Query-Daten mit gleichem Inhalt (Live-Invalidierung).

### D6 — `gcTime` 5 min für KRITIS und Energie

Benannte Konstante `BBOX_ABFRAGE_GC_MS = 5 * 60_000` in `useFachebenen.ts` mit Begründung: Eine
bbox-Abfrage dient dem gerade sichtbaren Ausschnitt und dem kurzen Zurückschieben;
`keepPreviousData` braucht nur den beobachteten Vorgänger. Die 6-h-`staleTime` für KRITIS
bleibt; innerhalb der 5 min wird ein Rückweg nicht neu abgerufen. Kein `removeQueries` nach
jedem Abruf: die kurze `gcTime` erfüllt die Anforderung, ohne eine zweite Regel.

## Risks / Trade-offs

- [D3 ändert das Timing aller Kartenebenen] → Die Anwendungen sind idempotent (sorgen für
  Quelle und Ebene, setzen Daten). Gegenprobe über die e2e-Specs der Lagekarte, besonders
  `lagekarte-kartengrundlage`, `lagekarte-touch` (Zeichnen per Link, Spider) und
  `fachebenen-*`. Fällt dort etwas, ist der Rückweg ein Einzeiler (Bereitschaftsprüfung).
- [D2 ändert die Signatur von `wendeKartenDatenAn`] → Alle Aufrufer liegen in zwei Dateien;
  TypeScript erzwingt den Schlüssel.
- [D4: ein Bild verlässt die Liste und kommt zurück, während sein Download läuft] → Es steht
  im Flug, also kein zweiter Start; bei Ankunft ist es wieder aktiv und wird übernommen.
- [D6: Rückkehr nach mehr als 5 min ruft KRITIS neu ab] → Bedingte Antwort (ETag, 304) trägt
  den Abruf; `keepPreviousData` verhindert Leer-Blinken.
