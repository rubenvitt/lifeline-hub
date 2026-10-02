# Tasks

## 1. Anflug an die Genauigkeit (D1)

- [x] 1.1 In `eigenpositionLayer.ts` eine reine Funktion für den Rahmen des Genauigkeitskreises ergänzen (West/Süd/Ost/Nord aus `genauigkeitsKreis`); Vitest in `eigenpositionLayer.test.ts`: Rahmen um 2 km enthält alle Ringpunkte und ist symmetrisch um den Punkt, Radius 0 ergibt einen Punktrahmen
- [x] 1.2 Anflugzoom 15 als benannte Konstante neben `flyToZiel` in `Kartenflaeche.tsx`; neue Prop für den Eigenpositions-Anflug mit `fitBounds(rahmen, { padding, maxZoom })`, verbraucht die Startansicht; Vitest am Karten-Mock: Aufruf mit Rahmen und `maxZoom` = Anflugzoom, kein `flyTo`
- [x] 1.3 `LagekartePage.tsx`: `onErsterFix` setzt den neuen Anflug statt `flyToZiel`; Seitentest in `LagekartePage.test.tsx` (`LFH-712: Eigenposition`) prüft die neue Prop und dass `flyToZiel` unberührt bleibt

## 2. Kein Anflug nach Bedienung (D2)

- [x] 2.1 `Kartenflaeche.tsx`: Prop `onBedienung`, `movestart`-Hörer meldet bei `originalEvent` oder `bedienung: true`; Zoom-Knöpfe, Nordung, Bild einpassen und Bündel-Tipp geben `{ bedienung: true }` als `eventData` mit; Vitest: Hörer meldet je Weg, `resize`/Startansicht/Eigenpositions-Anflug melden nicht (Mutationsprobe: Markierung an einem Weg entfernt → Test rot)
- [x] 2.2 `LagekartePage.tsx`: Merker „seit dem Einschalten bedient“, beim Einschalten zurückgesetzt, gesetzt durch `onBedienung`, neues `flyToZiel` und `exklusiverModusAktiv`; Seitentests: (a) Bedienung vor dem ersten Standort → kein Anflug, Punkt erscheint; (b) Modus vor dem ersten Standort begonnen und beendet → kein Anflug; (c) Aus- und wieder Einschalten setzt den Merker zurück → Anflug
- [x] 2.3 Kommentar an `onErsterFix` in der Seite und an `useEigenposition` (`onErsterFix`-Doku) auf das neue Verhalten ziehen; `pnpm -C frontend lint` grün

## 3. Ebenenfolge unter der Zeichnung (D3)

- [x] 3.1 `sorgeFuerEigenpositionLayer`: `moveLayer(id, vor)` mit der ersten `td-*`-Ebene der Style-Reihenfolge, sonst nach oben; Vitest in `eigenpositionLayer.test.ts`: mit `td-zone-polygon` in der Liste landen alle vier Ebenen davor, ohne `td-*` oben wie bisher; Suchnadel-Test (`suchnadelLayer.test.ts`) bleibt grün
- [x] 3.2 Guard-Test, dass alle terra-draw-`prefixId` der Lagekarte mit `td-` beginnen (`zeichnen.ts`-Vorgabe, `td-abschnitt`, `td-zone`, `messZeichnung.ts`); Mutationsprobe: ein Präfix ohne `td-` → rot
- [x] 3.3 `frontend/src/pages/lagekarte/AGENTS.md`, Abschnitt „Zeichnen und Messen“: `prefixId` beginnt mit `td-`, die Eigenposition liegt unter den `td-*`-Ebenen (Verweis auf diese Change); Prettier über `frontend/` grün

## 4. Nachweis an der echten Karte

- [x] 4.1 `e2e/lagekarte-zeichnen-korrigierbar.spec.ts`, Block „Eigenposition“: erster Standort mit `accuracy: 2000` → alle vier Ecken des Kreisrahmens liegen in `map.getBounds()`; bestehender Anflugtest bleibt grün
- [x] 4.2 Ebenda: Eigenposition an, Zonenzeichnen am eigenen Standort starten, zwei Punkte setzen, neuen Standort melden (`context.setGeolocation`) → in `map.getStyle().layers` steht jede `eigenposition-*`-Ebene vor der ersten `td-*`-Ebene
- [x] 4.3 Ebenda: Ortung verzögert (Init-Skript hält `watchPosition` an, bis der Test sie freigibt), Karte vor dem ersten Standort ziehen → nach dem Standort ist der Mittelpunkt unverändert und der Punkt da
- [x] 4.4 `./scripts/check-all.sh` grün (lokal bzw. im CI-Lauf des PRs) — lokal Bündel `schnell` grün; `frontend` und `e2e` belegt der CI-Lauf des PRs (Sammel-Gate, `.github/workflows/ci.yml`)
