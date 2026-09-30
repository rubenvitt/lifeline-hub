# Lagekarte — Regeln

Gilt für `frontend/src/pages/lagekarte/` und `pages/LagekartePage.tsx`, ergänzt `frontend/AGENTS.md`.
Pfade relativ zu `frontend/src/`.

- **Warnstufe trägt der TEXT** (LFH-357, Rangfolge `src/gefahr/repo.rs`): `zonenBeschriftung` (`pages/lagekarte/zonenStil.ts`),
  „Warnstufe: <label>" nur aus `warnstufeKarte`; fehlender Nachschlag = „unbekannt" (die Farbe
  rundet vorsichtshalber auf `keine`/Alarm); „keine" = keine Stufe gesetzt. Kollision des
  `zonen-label` ist nicht abgesichert (eigene Entscheidung).
- **Trefferzone `controlHeight`** an jedem Marker (`KarteMarker.trefferDurchmesser`,
  `marker-einsatzort-treffer`); Personen zusätzlich 2 px schwarze Außenkante. Bild-Ziehgriffe
  (`pages/lagekarte/bildGriffe.ts`) in `max(controlHeight, 44)`, je Modus scharf, Moduswechsel
  wartet auf `dragend`; in „Größe" Ecken immer, eine Kante nur ohne Überlappung mit Ecke oder
  Kante (`scharfeGriffe`, neu bei `move`/`dragend`/`setzeEcken`, nie im Zug; LFH-764).
- **Ein Tipp gehört genau einem Ziel** (LFH-764,
  `openspec/changes/archive/2026-09-30-lfh-764-lagekarte-griffe-klickwege/design.md`): jeder Karten-Klickhörer fragt
  `klickzielAm` (`Kartenflaeche.tsx`, ein Urteil je Originalereignis) → `entscheideKlickziel`
  (`pages/lagekarte/klickziel.ts`): gezeichnetes Punktziel > Trefferzone > Fläche. Eine neue
  Klickebene braucht eine Rolle in `ordneKlickebene` (Guard in `klickziel.test.ts`).
  **Mehrere Flächen am Punkt wählt der Mensch** (LFH-812,
  `openspec/changes/archive/2026-09-30-lfh-812-lagekarte-flaechen-auswahlmenue/design.md`): erst entdoppeln (Zone
  über Füllung + Umriss zählt einmal), ab zwei `mehrdeutig` → `FlaechenwahlMenue` am Tipppunkt,
  eigene vor Fachebenen, Kennung aus `flaechenwahl.ts`; Wahl über dieselben Callbacks, aus im
  exklusiven Modus (Prop `flaechenwahl`). Geschlossen wird nur über `onOpenChange`.
- **Betreuung auf der Karte** (LFH-673, `openspec/changes/archive/2026-09-29-lfh-673-betreuung-auf-der-lagekarte/design.md`):
  Marker-Ebene wie UHS (`alleVerortet`, `?platzieren=betreuungsstelle:<id>`), Sperre an der
  **Datenquelle** (`pages/lagekarte/betreuungEbene.ts`);
  Ort-Vorschau kennt keine Stellen (`src/geocoding/marker.rs`); Verortung ohne ETB, live über
  `Geschrieben::still_geaendert`; Zonentyp `evakuierungsbezirk` (`lage_zone.evakuierungsbezirk_id`).
- **Objektsuche/Zeichenwahl** (LFH-716,
  `openspec/changes/archive/2026-09-29-lfh-716-lagekarte-markersuche-zeichenpicker/design.md`): `MarkerSuche` über
  `suchbareMarker`
  (`pages/lagekarte/objektsuche.ts`) prüft Modulsperre **je Typ**; Enter sendet über `onAbsenden`
  mit Spec; `FreiesZeichenInspector` entprellt (600 ms) mit eigenem Merker, Bezeichnung
  kontrolliert. Enter-Tests über `userEvent.keyboard`.
- **Schwebende Bänder werden gestapelt, nicht per `zIndex` gestaffelt** (LFH-355,
  `pages/lagekarte/KartenFuss.tsx`): ein Rahmen (`pointerEvents: 'none'`), Bänder als
  Flow-Geschwister mit `bandStil(…)` (`'auto'`, nie `position: 'absolute'`). Der Fuß endet vor der
  Knopfspalte (`fussStil(knopfKante)`) und oben an der Karte; kein `overflow` am Rahmen.
- **Die Karte kippt nicht** (`touchPitch: false` **und** `maxPitch: 0` in `Kartenflaeche.tsx`).
- **Unter `lg` gibt jeder Kartenmodus die Karte frei** (LFH-765,
  `openspec/changes/archive/2026-09-30-lfh-765-lagekarte-modi-karte-freigeben/design.md`): abgeleitet aus
  `exklusiverModusAktiv` in `leisteSichtbar` (`lagekarte/leistenWahl.ts`), nie per Aufruf je
  Startweg; nach dem Modus gilt wieder der vorherige Zustand (Entscheidung 29.09.2026).
  „Leiste einblenden" im Modus ist `umschalteImModus` (nie gespeichert). Die Bedienung der
  Leistenmodi (Platzieren, Taktisches Zeichen, Bild) steht unter `lg` im Fuß-Band
  `PlatzierSteuerung`, die Sidebar zeigt dann nur einen Hinweis (`modusBedienungImFuss`) — je
  Breite genau ein Knopf je Handlung. Ab `lg` erzwingen die Leistenmodi die Leiste wie bisher.
- Nachweise: `e2e/lagekarte-smoke.spec.ts`, `e2e/gate1-ueberlauf.spec.ts`,
  `e2e/lagekarte-touch.spec.ts` (LFH-713, `hasTouch`, Trefferwache `elementFromPoint`), `fokus-verdeckung.spec.ts`; Kartenaufbauten sieht
  `e2e/fokus-kern.ts` nur über `zusatzKandidaten`, das Abschneiden der nachgiebigen Zeitachse nur
  über `beschnitt` (LFH-811: Tab/Shift+Tab in jedem Kartenmodus bei 390 und 768 px).

**Zeichnen und Messen**

- **Messwerkzeug**: exklusiver Modus in `useKartenInteraktion`, ohne Schreibrecht, per Escape
  beendbar, Stand über `messQuelle.ts`; `messZeichnung.ts` nimmt nur die gewählte Geometrie.
  **Jede terra-draw-Instanz eigener `prefixId`** (`td-abschnitt`/`td-zone`/`td-mess`);
  Messung vor `setStyle` räumen, nach `style.load` neu.
- **Esc beim Zeichnen ist zweistufig** (LFH-712, Entscheidung 28.09.2026): erstes Esc verwirft
  die Figur mit Quittung, der Modus bleibt; Esc ohne Figur beendet ihn (Messen: ein Esc). Stufe
  aus `lagekarte/zeichnenEsc.ts`, **ein** `keydown`-Zuhörer der Seite, terra-draw-Modi mit
  `keyEvents: { cancel: null }`. Offene antd-Overlays schließen per eigenem `window`-keydown
  **ohne** `preventDefault` → Riegel `escGehoertOverlay`, `defaultPrevented` allein reicht nicht.
  Punktzahl aus terra-draws `history`, nie aus DOM-Klicks (die laufen an terra-draw vorbei).
