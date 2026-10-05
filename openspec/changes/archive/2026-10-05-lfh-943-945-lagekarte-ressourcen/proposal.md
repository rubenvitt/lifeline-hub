# Proposal

## Why

Die Lagekarte bleibt in der Führungsstelle und auf Feldtablets 24 bis 72 Stunden offen und
wird ständig mit ETB und anderen Modulen gewechselt. Das Audit vom 01.10.2026 fand im
Lebenszyklus ihrer Ressourcen fünf Befunde. Der schwerste ist ein Absturz im Alltag: Wer mit
laufendem Messen oder Zeichnen ins ETB wechselt, ohne vorher „Beenden“ zu drücken, sieht
„Unexpected Application Error“ statt des Zielmoduls und muss neu laden. Die übrigen vier sind
Ressourcen, die liegen bleiben oder ohne Not neu entstehen: gestapelte `render`-Hörer, solange
Kacheln laden; Bild-URLs eines abgebrochenen Ladevorgangs (bis 25 MiB je Bild); ein `setData`
auf die Abschnittsflächen bei jedem Eigenpositions-Fix; KRITIS- und Energie-Antworten, die je
besuchter Kartenzelle 6 Stunden im Query-Cache liegen.

## What Changes

- **Abbaureihenfolge (LFH-943, L42):** Beim Aushängen der Karte werden die drei
  terra-draw-Controller (Abschnitt, Zone, Messen) und die Bildgriffe **vor** `map.remove()`
  abgebaut, im Cleanup des Karten-Effekts. `zerstoeren()` in `messZeichnung.ts` und
  `zeichnen.ts` übersteht eine schon entfernte Karte. Der Modulwechsel mit laufendem Werkzeug
  zeigt das Zielmodul.
- **Vertagte Kartendaten je Schlüssel (LFH-943, L44):** `wendeKartenDatenAn` bekommt einen
  Schlüssel je Ebene. Je Karte steht höchstens eine ausstehende Anwendung je Schlüssel an, ein
  einziger `render`-Hörer arbeitet die Warteschlange in Reihenfolge ab. **Entscheidung:** Als
  „bereit“ gilt künftig das angewandte Style-JSON (`style._loaded`), nicht mehr
  `isStyleLoaded()`, das zusätzlich auf jede Kachel wartet. Eigenposition und Lageänderungen
  erreichen die Karte dann auch, während Kacheln über eine schwache Leitung laden.
- **Bild-URLs der Hintergrundbilder (LFH-943, L46):** Jede Object-URL aus `ladeBildBlobUrl`
  wird freigegeben, ob übernommen, verworfen oder beim Aushängen. Ein laufender Download wird
  von einem Folgelauf nicht ein zweites Mal gestartet; beim Verlassen der Karte und beim
  Einsatzwechsel bricht er ab.
- **Abschnittsflächen nur bei Änderung (LFH-945, L43):** Die Seite hält die Projektion der
  Flächen stabil (`useMemo`, leere Liste als Modulkonstante), und `Kartenflaeche` vergleicht vor
  `setData` mit dem zuletzt gesetzten Inhalt. Die Re-Anlage nach einem Stilwechsel bleibt.
- **Kurze Liegezeit für KRITIS und Energie (LFH-945, L45):** `gcTime` dieser beiden
  bbox-Abfragen sinkt von 6 h auf 5 min (benannte Konstante). Die 6-h-`staleTime` für KRITIS
  und `keepPreviousData` bleiben.
- **Regel:** `frontend/src/pages/lagekarte/AGENTS.md`, „Zeichnen und Messen“, nennt die
  Abbaureihenfolge „Controller vor `map.remove()`“ und den Schlüssel von `wendeKartenDatenAn`.

## Capabilities

### New Capabilities
- `lagekarte-ressourcen`: Lebenszyklus der Ressourcen der Lagekarte über lange Laufzeiten —
  Abbau beim Modulwechsel, vertagte Datenanwendung, Bild-URLs, unnötige Kartenarbeit und
  Liegezeit der bbox-Abfragen im Client-Cache.

### Modified Capabilities
- keine

## Impact

- `frontend/src/pages/lagekarte/Kartenflaeche.tsx`, `kartenDaten.ts` (+ Test),
  `kartenLayer.ts`, `messZeichnung.ts`, `zeichnen.ts`, `useKartenbilder.ts` (+ Test),
  `useFachebenen.ts` (+ Test), `frontend/src/api/kartenbilder.ts`,
  `frontend/src/pages/LagekartePage.tsx`
- `frontend/e2e/lagekarte-touch.spec.ts` oder eine eigene Spec für den Modulwechsel
- `frontend/src/pages/lagekarte/AGENTS.md`
- Der Lagemonitor der gekoppelten Geräte nutzt dieselbe Kartenfläche und erbt alles.
- Sichtbar: kein Absturz mehr beim Modulwechsel mit laufendem Werkzeug; die Eigenposition
  folgt auch, während Kacheln laden. Sonst keine sichtbare Änderung. Kein Backend, keine API,
  keine Migration.
