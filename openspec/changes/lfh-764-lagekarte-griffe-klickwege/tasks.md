# Tasks

## 1. Griffwahl (rein)

- [x] 1.1 `scharfeGriffe(modus, punkte, kante)` in `bildGriffe.ts` per TDD (D1): Vitest in `bildGriffe.test.ts` für Quadrat 120 px bei Kante 44/48/72, 45° gedreht, 300 × 60, 30 × 30, Verschieben/Drehen je genau ein Griff, `kantenAusgeblendet`; `griffeFuerModus` bleibt die Artenpartition. Nachweis: Tests grün, vorher rot.
- [x] 1.2 `griffHinweis(modus, { kantenAusgeblendet })` erweitern (D3), Test für beide Fälle in „Größe" und unveränderte Texte der übrigen Modi. Nachweis: `bildGriffe.test.ts` grün.

## 2. Griffe an der Karte

- [x] 2.1 `bildHandles.ts`: `wendeModusAn` über `scharfeGriffe` mit `map.project`-Positionen; `move`-Hörer und Neuentscheidung nach `dragend`, nichts während `ziehend`, DOM nur bei Mengenwechsel, Abmelden in `zerstoeren` (D2). Nachweis: `bildHandles.test.ts` um Fälle „kein Abziehen im Zug", „`dragend` entscheidet neu", „`move` entscheidet neu", „Hörer nach `zerstoeren` weg" erweitert, grün.
- [x] 2.2 Rückruf `onGriffStand` durch `bildHandles` → `Kartenflaeche` (Prop, über Ref) → `LagekartePage` (State) → `Sidebar` (Hinweis) (D3). Nachweis: `Sidebar.test.tsx` zeigt den Kanten-Hinweis bei `kantenAusgeblendet`; `pnpm lint` und `tsc` grün.
- [x] 2.3 e2e in `e2e/lagekarte-touch.spec.ts`: Kartenbild per API anlegen und platzieren, auf rund 120 px zoomen, je Dichte (kompakt, handschuh) und gedreht die Bounding-Boxen aller angehängten `[data-lfh^="bildgriff-"]` paarweise überlappungsfrei; kompakt mit, handschuh ohne Kanten; Hinweistext passt. Nachweis: Spec grün, Mutationsprobe (Kantenregel aus → rot) im Commit-Text festgehalten.

## 3. Klick-Schiedsrichter (rein)

- [x] 3.1 `pages/lagekarte/klickziel.ts` mit `ordneKlickebene` und `entscheideKlickziel` per TDD (D4); die Fälle aus den `personenClusterTreffer`-Tests in `markerLayer.test.ts` wandern nach `klickziel.test.ts`, `personenClusterTreffer` entfällt. Tests für jede Rangstufe, Marker-nächstes-Merkmal, Trefferzone vs. Fachebenen-Punkt/-Bündel, Trefferzone vs. Fläche, zwei Flächen. Nachweis: Vitest grün, vorher rot.
- [x] 3.2 Guard-Test: jede Ebene aus `MARKER_KLICK_LAYER`, `SPIDER_KLICK_LAYER`, `PERSONEN_CLUSTER_KLICK_LAYER`, den Zonen-/Abschnittsebenen und `fachebeneClickLayerIds` aller Fachebenen-Definitionen wird eingeordnet (kein `null`). Nachweis: Test grün; mit einer absichtlich fehlenden Einordnung rot.

## 4. Schiedsrichter verdrahten

- [x] 4.1 `Kartenflaeche.tsx`: `klickzielAm(map, e)` mit `WeakMap`-Cache am `originalEvent` über alle vorhandenen Klickebenen; Marker-, Zonen-, Abschnitts-, Fachebenen- und Personen-Cluster-Hörer handeln nur als Gewinner; `personenClusterAm` ersetzt. Nachweis: bestehende e2e `lagekarte-touch.spec.ts` (Einzelzeichen, Cluster, Spider) und `lagekarte-smoke.spec.ts` grün; Vitest und Lint grün.
- [x] 4.2 e2e KRITIS-Bündel im Ring: Fachebenen-Endpunkt per `page.route` stubben (Traube neben einem Marker), KRITIS sichtbar, Tipp auf den Bündelpunkt innerhalb der Trefferzone hinter `elementFromPoint`-Wache → `getZoom` steigt, kein Marker-Inspector. Dazu Tipp auf ein Markerzeichen in einer Zone → nur Marker-Inspector. Nachweis: grün; Mutationsprobe (Fachebenen-Zweig des Schiedsrichters aus → rot) im Commit-Text festgehalten.

## 5. Dokumentation und Abschluss

- [x] 5.1 CLAUDE.md, Abschnitt „Lagekarte": Eintrag zu Griffregel und Klick-Schiedsrichter mit Verweis auf dieses Design; `data-lfh`-/Prüfspur-Pfade prüfen. Nachweis: Eintrag vorhanden, Pfade existieren.
- [ ] 5.2 Gesamtlauf `./scripts/check-all.sh` (eigenes `CARGO_TARGET_DIR`), Ergebnis je Schritt festhalten. Nachweis: alle Schritte grün oder Abweichung begründet.
