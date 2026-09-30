# Tasks

## 1. Geometrie und Quellen

- [x] 1.1 `frontend/src/marke/bildmarkeGeometrie.ts` anlegen: Pfad, Strichstärke, Quadrat und
      enger `viewBox` der Lebenslinie, Farben aus `theme/tokens.ts`. Den `viewBox` im Browser
      mit Strich messen (D1). Prüfung: Ein Render der Marke auf transparentem Grund schneidet
      an keiner Kante ab (Pixelgrenzen gegen `viewBox`).
- [x] 1.2 `scripts/marke/symbol.svg`, `symbol-macos.svg` und `symbol-maskable.svg` nach D2
      anlegen. Sie enthalten nur Pfade und keinen `<text>`. Prüfung: Kontaktbogen der drei
      Quellen in 512/64/32/16 px, maskierbar mit eingezeichnetem sicheren Kreis.

## 2. Guard-Test und Erzeugung (TDD)

- [x] 2.1 `frontend/src/marke/marke.guard.test.ts` nach D6 zuerst rot schreiben. Prüfung: Der
      Test schlägt heute an den 1×1-PWA-Symbolen, am fehlenden maskierbaren Eintrag und am
      alten Favicon fehl.
- [x] 2.2 `frontend/src/marke/pwaManifest.json` herauslösen, `vite.config.ts` liest es ein (D4).
      Einträge any/maskable und Farben `#0c0e11` (D4). `includeAssets` um
      `apple-touch-icon.png` ergänzen, `index.html` um `apple-touch-icon` und `theme-color`.
      Prüfung: Die Manifest-Fälle des Guard-Tests sind grün, `vite build` erzeugt ein
      `manifest.webmanifest` mit drei Symbolen.
- [x] 2.3 `scripts/marke/erzeuge-symbole.sh` nach D3 schreiben und laufen lassen. Prüfung: Der
      Guard-Test ist ganz grün. `git status` zeigt unter `src-tauri/icons/` nur geänderte,
      keine neuen Dateien. `file` meldet 192/512/180/512 px für die PWA-Dateien.

## 3. Oberfläche

- [x] 3.1 `frontend/src/marke/Bildmarke.tsx` nach D5 (per TDD: `aria-hidden`, `focusable`,
      Pfad aus der Konstante, Quadrat in `marke`, Linienfarbe von außen). Prüfung: Eigener
      Komponententest ist grün.
- [x] 3.2 `Markenzelle` in `components/Kopfleiste.tsx` auf die Bildmarke umstellen (22 px,
      `rahmenFarben.text`) und den Dateikopf nachziehen. Prüfung: `Kopfleiste.test.tsx` prüft,
      dass die Bildmarke da ist und das 14-px-Quadrat fehlt (zuerst rot).
- [ ] 3.3 Markenbereich der Anmeldeseite auf die Bildmarke umstellen (20 px,
      `var(--lfh-text)`), `.login-marke__quadrat` entfernen. Prüfung: `LoginPage.test.tsx`
      entsprechend (zuerst rot). Sichtprüfung im Tag- und Nachtbetrieb im Vite-Dev-Server.

## 4. Dokumentation

- [x] 4.1 `docs/design/2026-09-21-neuentwurf/umsetzung.md`: Zeile `marke` („Logo-Quadrat“ →
      Bildmarke) und Rahmen-Abschnitt (Markenzelle) nachziehen, macOS-Ausnahme vom Radius 0
      vermerken. CLAUDE.md, Abschnitt Neuentwurf: ein Punkt „Bildmarke“ mit der Quelle
      (`marke/bildmarkeGeometrie.ts`, `scripts/marke/`, Guard). Prüfung: `grep -n
      "Logo-Quadrat"` findet nichts mehr.
- [x] 4.2 `docs/betrieb/desktop-app.md`: Den Punkt „App-Symbol … Platzhalter“ aus den Grenzen
      streichen und einen Satz zum Neuerzeugen (`scripts/marke/erzeuge-symbole.sh`) ergänzen.
      Prüfung: Die Doku nennt einen Befehl, der so läuft.

## 5. Integration

- [ ] 5.1 Gezielt `e2e/lagekarte-offline-precache.spec.ts` gegen den Prod-Bundle laufen lassen,
      dann `./scripts/check-all.sh` bis grün. Prüfung: Exit-Code 0, kein Schritt
      ÜBERSPRUNGEN ohne Grund.
- [ ] 5.2 Endkontrolle am Kontaktbogen: die gerenderten `pwa-192.png`, `32x32.png` und
      `icon.icns` (32er-Stufe) sowie ein Bildschirmfoto der Kopfleiste und der Anmeldeseite
      (Tag/Nacht) dem Menschen vorlegen. Prüfung: Freigabe des Menschen.
