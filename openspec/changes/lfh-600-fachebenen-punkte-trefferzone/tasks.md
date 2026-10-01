# Tasks

## 1. Klickrangfolge (`klickziel.ts`)

- [x] 1.1 Test zuerst in `klickziel.test.ts`: `ordneKlickebene('fachebene-pegelonline-treffer')` ergibt `fachebeneTreffer`, Kantenebenen (`-kante`, `-buendel-kante`) ergeben `null`, und die Guard-Schleife über `fachebeneClickLayerIds` kennt die Treffer-ID. Rot sehen, dann die Rolle ergänzen, `pnpm vitest run src/pages/lagekarte/klickziel.test.ts` ist grün
- [x] 1.2 Test zuerst: Eine Fachebenen-Zone allein gewinnt als `art: 'fachebene'`. Marker-Zone und Fachebenen-Zone überlappend: das nähere Merkmal gewinnt, in beide Richtungen. Ein gezeichnetes Markerzeichen schlägt die Fachebenen-Zone und kommt nie als `fachebene` zurück. Fachebenen-Zone schlägt eine DWD-Fläche ohne `mehrdeutig`. Danach `entscheideKlickziel` nach D2 umbauen und den Kopfkommentar nachziehen, die Tests sind grün

## 2. Layer (`fachebenenLayer.ts`)

- [x] 2.1 Test zuerst in `fachebenenLayer.test.ts`: `sorgeFuerFachebeneLayer(map, def, daten, farbe, treffer)` legt für Punkt-Ebenen `-treffer` (ohne Filter, Deckkraft 0, Radius `treffer/2`) unter `-kante` unter `-circle` an. Bei gebündelten Ebenen kommt `-buendel-kante` unter `-buendel` dazu. Polygon-Ebenen bekommen keine dieser Ebenen. Ein zweiter Aufruf mit anderem `treffer` zieht den Radius per `setPaintProperty` nach, ohne neue Layer. `entferneFachebeneLayer` räumt alle neuen IDs. Umsetzen, die Tests sind grün
- [x] 2.2 Test zuerst: Die Kantenebene hat Radius Zeichenradius + 4 (`['+', ['coalesce', ['get','radius'], 5], 4]`, beim Bündel `BUENDEL_RADIUS` + 4), Farbe `#000` und denselben `circle-sort-key` wie der Kreis. Der weiße Rand des Kreises und des Bündels ist 2 px breit, und `circle-radius` des Kreises bleibt unverändert `['coalesce', ['get','radius'], 5]`. Umsetzen mit Begründungskommentar (Verweis auf `KANTE_PAINT`), die Tests sind grün
- [x] 2.3 `fachebeneClickLayerIds` liefert für Punkt-Ebenen zusätzlich `fachebene-<key>-treffer`. Den bestehenden Test anpassen, er ist grün

## 3. Verdrahtung (`Kartenflaeche.tsx`)

- [x] 3.1 `token.controlHeight` an beide Aufrufe von `sorgeFuerFachebeneLayer` reichen (nach `style.load` und im Fachebenen-Effekt) und in dessen Abhängigkeiten aufnehmen. Umgesetzt über `AktiveFachebene.treffer` (gesetzt in `useFachebenen` neben der Ebenenfarbe), so tragen alle drei Aufrufer (`Kartenflaeche.tsx` zweimal, `kartenLayer.ts` `reAnlegenAlles`) den Wert ohne eigene Verdrahtung; belegt in `useFachebenen.test.tsx` (Staffelwert 72 aus dem Theme-Token)
- [x] 3.2 Prüfen, dass Klick- und `mouseenter`-Bindung über `fachebeneClickLayerIds` die Treffer-ID mitnehmen und die Wache `gewinner.merkmal.layer.id !== id` je Tipp genau einen Hörer handeln lässt. Belegt durch Gruppe 4 (Klick neben den Punkt öffnet genau eine Detailansicht), `pnpm tsc -b` ist grün

## 4. Browser-Nachweis Trefffläche (`e2e/gate3-trefflaeche.spec.ts`)

- [x] 4.1 Neuer Block „Lagekarte (LFH-600): Punkt-Fachebenen tragen die Trefferzone der Staffel“. Die sieben Punkt-Endpunkte hermetisch per `page.route` (Wire-Form aus `api/types.generated.ts`), alle Ebenen sichtbar, Zoom über `clusterMaxZoom`. Je Dichtestufe und Ebene: am Versatz nichts gezeichnet (`GEZEICHNETE_KLICKEBENEN` um die Fachebenen-Kreise erweitert), Treffer-Merkmal vorhanden, Klick öffnet die Detailansicht der Ebene. In `kompakt` Gegenprobe bei 23 px. Messwerte als Annotation. Mutationsprobe: Treffer-Radius fest auf 5 px setzen, der Block wird rot, dann zurücksetzen
- [x] 4.2 KRITIS-Bündel: Unter `clusterMaxZoom` steht ein Bündel aus zwei Punkten. Im Handschuh-Modus zoomt ein Tipp außerhalb des gezeichneten Bündelkreises, aber innerhalb von 36 px, hinein (Zoom steigt)
- [x] 4.3 Radius-Kanal: Hochwasser und Luftqualität mit je zwei Stufen. Am Versatz zwischen kleinem und großem Zeichenradius meldet `-circle` nur den großen Punkt, in `kompakt` und `handschuh` gleich

## 5. Browser-Nachweis Kontrast

- [x] 5.1 Pixelkern aus `e2e/betroffene-kontrast.spec.ts` (`markerKante`: Ausschnitt, Dekodierung, Luminanz, Strahl) nach `e2e/karten-pixel-kern.ts` ziehen und dort parametrisieren (Zeichenradius, Randbreite, Kantenbreite). `betroffene-kontrast.spec.ts` nutzt den Kern, seine Werte bleiben gleich (Lauf grün, Annotation vorher und nachher verglichen)
- [x] 5.2 Neue Spec `e2e/fachebenen-kontrast.spec.ts`: Je Grundlage (blind hell und dunkel, offline per Fixture-Region, online per Fixture-Stil mit `#ffffff`, `#000000`, `#f5f5f3`, `#0f1115`) und je Punktart (Pegel in Ebenenfarbe, Hochwasser niedrigste und höchste Stufe, KRITIS-Einzelpunkt) gilt: beste Kontur ≥ 3 : 1. Füllfarbe gegen Grund als Annotation. Selbstprobe: Kantenebene per `setLayoutProperty(visibility, none)` ausblenden, auf `#ffffff` fällt die Messung unter 3 : 1

## 6. Regeln und Prüfliste

- [x] 6.1 `frontend/src/pages/lagekarte/AGENTS.md`: Die Regel „Trefferzone `controlHeight`“ nennt Fachebenen-Punkte und -Bündel (`fachebene-<key>-treffer`, Rolle `fachebeneTreffer`) und die Doppelkante, mit Verweis auf diese Change. Prettier (`pnpm prettier --check AGENTS.md` im Frontend) ist grün
- [x] 6.2 `pruefliste.md` in dieser Change: alle 15 Zeilen der Festlegung 7 mit Verdikt, die Zeilen 1, 2 und 5 mit den Messwerten aus 4.1 und 5.2. In `openspec/changes/archive/2026-09-29-fachebene-luftqualitaet-uba/pruefliste.md` bekommen die Zeilen 1, 2 und 5 den Nachtrag „erfüllt durch LFH-600“ mit Pfad

## 7. Abschluss

- [ ] 7.1 `./scripts/check-all.sh` grün (lokal, sonst belegt durch die CI des PRs mit Verweis auf den Lauf)
