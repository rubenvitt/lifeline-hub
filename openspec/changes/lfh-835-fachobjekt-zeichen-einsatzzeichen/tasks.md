# Tasks

## 1. Abhängigkeiten

- [x] 1.1 `@einsatzzeichen/core`, `schema`, `react` und `maplibre` exakt `2.1.0` in `frontend/package.json` aufnehmen, per `mise exec -- pnpm -C <abs>/frontend install`. Prüfen mit `pnpm why @einsatzzeichen/core`: genau eine Version im Baum.
- [x] 1.2 Vitest-Guard `zeichen/einsatzzeichenVersionen.guard.test.ts`: Alle `@einsatzzeichen/*` in `package.json` tragen dieselbe exakte Version ohne Bereichszeichen. Der Test ist grün und wird rot, wenn ein Paket testweise auf `^2.1.0` steht (Mutationsprobe).

## 2. Adapter Hub-Vokabular → SymbolSpec (TDD)

- [ ] 2.1 `zeichen/fachobjektZeichen.test.ts` rot anlegen:
  - Pin je Abbildung aus design.md D2: Einheit mit den Größen und Zugtrupp, Fahrzeug LF/RTW/RW/GW-L/ELW, Boot, Heli, Anhänger, Krad, Führungskraft mit und ohne Funktion, Abschnitt, Einsatzort, Schaden mit 5 Ausmaßen, die 4 UHS-Typen, Betreuungsstelle, die 3 umbenannten Organisationen.
  - Jede Abbildung liefert die erwartete wirksame Spec, `drawSymbol` wirft nicht, und das gerenderte SVG enthält kein `<text` (Schrift-Wache).
- [ ] 2.2 `zeichen/fachobjektZeichen.ts` umsetzen: Tabellen, Kaskade nach D3, Cache nach D4, `schluessel = 'ez|' + serializeSpec`. Die Tests aus 2.1 sind grün.
- [ ] 2.3 Rückfall-Tests ergänzen und grün machen:
  - unbekannte Fachaufgabe
  - unbekannte Organisation
  - nicht komponierende Fachaufgabe am Kfz
  - unbekanntes Grundzeichen → `null`
  - Programmfehler-Zweig mit DEV-Warnung
  - gleicher Eingang → gleiches Objekt (Cache)

  Mutationsprobe: Eine Kaskadenstufe entfernt → mindestens ein Test wird rot.
- [ ] 2.4 `baueTzProps` vom accepts-Gating lösen (D3). Die Pins in `taktischesZeichen.test.ts`, die über `erzeugeTaktischesZeichen` Fachobjekte rendern oder das Gating an Fachobjekten prüfen, auf den Adapter umstellen: gleiche fachliche Aussage, neue Belege. Vitest für `pages/lagekarte` ist grün.

## 3. Lagekarte

- [ ] 3.1 `markerIcons.ts`: `markerIconKey(mk)` nach D5. Tests: freies Zeichen → `tz|…`, Fachobjekt → `ez|…`, gleiche wirksame Spec → gleicher Schlüssel, ohne `tz` → `undefined`. `markerLayer.ts` nutzt `markerIconKey`, `markerLayer.test.ts` ist grün.
- [ ] 3.2 `Kartenflaeche.tsx`: Registry `{art:'ez', drawing} | {art:'tz', tz}`. Der `ez|`-Zweig im `styleimagemissing` läuft über `addSymbolImage` (size 34, `pixelRatio = max(1, ceil(devicePixelRatio))`, `hasImage`-Guard, `try/catch`). Der `tz|`-Zweig bleibt unverändert. Belegt über den e2e aus 3.4.
- [ ] 3.3 `Inspector.tsx`: Die Kachel zeigt für Fachobjekte die Data-URL aus `renderSvg`, für freie Zeichen den bisherigen Weg. In `Inspector.test.tsx` ist die Kachel `img` für eine Einheit vorhanden, und ein nicht darstellbares Zeichen bringt den Inspector nicht zum Absturz.
- [ ] 3.4 e2e `lagekarte-smoke.spec.ts` erweitern: Nach dem Laden trägt die Karte ein Bild mit Präfix `ez|`, und `__lfhKarte.getImage(id)` hat die Breite `34 × ceil(devicePixelRatio)`. Nach einem Grundkartenwechsel ist das Bild wieder da. Grün lokal. `gate3-trefflaeche.spec.ts` (UHS-Marker) ist grün.

## 4. Meldebild

- [ ] 4.1 `zeichen/EinsatzZeichen.tsx` (Adapter + `Einsatzzeichen` + `useId`-Präfix, leer bei `null`) und `kraefte/EinheitZeichen.tsx` darauf umstellen.
  - Test: Eine Einheit mit gültigen Werten rendert genau ein `svg`. Eine Einheit mit `tz_fachaufgabe='gibt-es-nicht'` rendert ohne Wurf.
  - Zwei Zeichen in einer Liste haben keine doppelten `id`.
  - `KraefteuebersichtPage.test.tsx` und `meldebildRaster.test.ts` sind grün.

## 5. Nachweise und Abschluss

- [ ] 5.1 Keine Fachobjekt-Datei importiert mehr aus `taktische-zeichen-react`. Prüfen per `grep` in `marker.ts`, `markerIcons.ts`, `EinheitZeichen.tsx`, `Inspector.tsx` (außer im Zweig für freie Zeichen) und `taktischesZeichen.ts` (außer `grundzeichenAkzeptiert` und den Typen). Die verbleibenden Importe stehen mit Verweis auf LFH-836 im Dateikopf.
- [ ] 5.2 Sichtprüfung im Browser (Dev-Stack, Demo-Einsatz) in Tag- und Nachtmodus: Karte mit Einheit, Fahrzeug, Führungskraft, Abschnitt, UHS, Betreuungsstelle, Schaden und Einsatzort, dazu die Inspector-Kachel und die Spalte „TZ“ im Meldebild. Screenshots liegen im Change-Ordner.
- [ ] 5.3 Prüfliste Einsatztauglichkeit (15 Kriterien) für Lagekarte und Meldebild als `pruefliste.md` im Change-Ordner, jede Zeile mit Verdikt.
- [ ] 5.4 Bundle messen: `vite build`, Größe des neuen Chunks und Precache-Summe vorher/nachher in `pruefliste.md` notiert. `e2e/lagekarte-offline-precache.spec.ts` ist grün.
- [ ] 5.5 `./scripts/check-all.sh` ist grün, mit eigenem `CARGO_TARGET_DIR`.
