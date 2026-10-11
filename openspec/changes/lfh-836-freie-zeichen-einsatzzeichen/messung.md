# Messung Bundle und Precache (LFH-836)

## Vorher (Task 1.1, alpha-Stand mit @einsatzzeichen 4.3.0 und taktische-zeichen-react, 11.10.2026)

Gemessen mit `mise exec -- pnpm -C frontend build` (Node 26.7.0, pnpm 11.10.0).

```
precache  34 entries (6660.63 KiB)
dist/assets/heicWorker-C7ycdFvg.js                          2.26 kB
dist/assets/maplibre-gl-worker-CRiIRpYb.js                509.70 kB
dist/assets/lagezonen-tCyt_sfz.js                           0.34 kB │ gzip:   0.19 kB
dist/assets/rolldown-runtime-hePW80VL.js                    0.71 kB │ gzip:   0.42 kB
dist/assets/dekodiereHeic-Dymt6-Sp.js                       0.99 kB │ gzip:   0.60 kB
dist/assets/GeraetAbschnittKarte-DqaetXOD.js                3.05 kB │ gzip:   1.56 kB
dist/assets/useKartenAnsicht-CxjKnc2K.js                    4.58 kB │ gzip:   1.85 kB
dist/assets/BetroffeneKarte-CY58I5wE.js                     5.08 kB │ gzip:   2.34 kB
dist/assets/workbox-window.prod.es5-Bd17z0YL.js             5.65 kB │ gzip:   2.20 kB
dist/assets/KraefteuebersichtPage-B0aPxAh-.js              18.09 kB │ gzip:   6.55 kB
dist/assets/LagekartePage-BM81N4wZ.js                     129.87 kB │ gzip:  40.48 kB
dist/assets/useBasemap-C9D8HZfh.js                        222.62 kB │ gzip:  59.44 kB
dist/assets/organisation-D0J0oldK.js                      277.44 kB │ gzip:  87.01 kB
dist/assets/HilfePage-C44DwzZY.js                         354.40 kB │ gzip: 103.46 kB
dist/assets/EinsatzSeite-BR5MNJ0t.js                      535.87 kB │ gzip: 171.03 kB
dist/assets/SeitenZustand-D2NGlQEX.js                     730.06 kB │ gzip: 236.86 kB
dist/assets/fachobjektZeichen-CFMOh0en.js               1,189.79 kB │ gzip: 378.83 kB
dist/assets/index-DBEX7dpL.js                           2,709.16 kB │ gzip: 778.11 kB
```

## Nachher (Task 6.3, Branch mit @einsatzzeichen 5.2.0, ohne taktische-zeichen-react, 11.10.2026)

Gemessen mit `mise exec -- pnpm -C frontend build` (Node 26.7.0, pnpm 11.10.0), Stand
`dad371704`.

```
precache  34 entries (6655.61 KiB)
dist/assets/heicWorker-C7ycdFvg.js                          2.26 kB
dist/assets/maplibre-gl-worker-CRiIRpYb.js                509.70 kB
dist/assets/lagezonen-VWxjAjrc.js                           0.34 kB │ gzip:   0.19 kB
dist/assets/rolldown-runtime-hePW80VL.js                    0.71 kB │ gzip:   0.42 kB
dist/assets/dekodiereHeic-Dymt6-Sp.js                       0.99 kB │ gzip:   0.60 kB
dist/assets/GeraetAbschnittKarte-WGHGgFbl.js                3.05 kB │ gzip:   1.56 kB
dist/assets/useKartenAnsicht-6tE42Rpo.js                    4.58 kB │ gzip:   1.85 kB
dist/assets/BetroffeneKarte-CKMY17yz.js                     5.08 kB │ gzip:   2.34 kB
dist/assets/workbox-window.prod.es5-Bd17z0YL.js             5.65 kB │ gzip:   2.20 kB
dist/assets/KraefteuebersichtPage-EOlNhauT.js              18.10 kB │ gzip:   6.57 kB
dist/assets/LagekartePage-DokGQYQX.js                     134.83 kB │ gzip:  42.29 kB
dist/assets/useBasemap-mxo8_63l.js                        214.94 kB │ gzip:  57.15 kB
dist/assets/organisation-BW-MbE7x.js                      277.72 kB │ gzip:  87.04 kB
dist/assets/HilfePage-CJH16OHi.js                         364.70 kB │ gzip: 106.30 kB
dist/assets/EinsatzSeite-Bfzb0p66.js                      536.06 kB │ gzip: 171.09 kB
dist/assets/SeitenZustand-CDqLGjpJ.js                     730.17 kB │ gzip: 236.88 kB
dist/assets/fachobjektZeichen-DZe0u0Hm.js               1,166.93 kB │ gzip: 362.16 kB
dist/assets/index-CXaeTCtQ.js                           2,717.71 kB │ gzip: 780.77 kB
```

Zwischenstand zum Vergleich (`6c3c35511`, nach Upgrade auf 5.2.0 und Merge von `alpha`, vor
Gruppe 4–6; gebaut mit `vite build`): Precache 6689.14 KiB, `LagekartePage` 130.03 kB (gzip
40.53), `useBasemap` 222.62 kB, `fachobjektZeichen` 1,198.53 kB (gzip 381.29), `index`
2,717.58 kB.

| Größe | Vorher (1.1) | Nachher | Differenz |
| --- | ---: | ---: | ---: |
| Precache | 6660.63 KiB | 6655.61 KiB | −5.02 KiB |
| `LagekartePage` (Lagekarten-Chunk) | 129.87 kB (gzip 40.48) | 134.83 kB (gzip 42.29) | **+4.96 kB (gzip +1.81)** |
| `useBasemap` | 222.62 kB | 214.94 kB | −7.68 kB |
| `fachobjektZeichen` (geteilt, Zeichen) | 1,189.79 kB | 1,166.93 kB | −22.86 kB |
| Summe der drei Chunks der Lagekarte | 1,542.28 kB | 1,516.70 kB | −25.58 kB |

**Befund:** Der Precache ist kleiner, der Chunk `LagekartePage` allein ist größer. Ursache: Der
Katalog des Altpakets lag im geteilten Chunk `fachobjektZeichen` (dort fanden sich die Namen
„Stelle, Einrichtung“ usw.), der neue Picker mit `zeichenWahl.ts` (Vokabular-Aufrufe,
Namen-Tabellen für Grundzeichen und Palettenfarben, Optionen-Merker), `zuletztVerwendet.ts` v2
und der Inspector-Kachel liegt im Chunk `LagekartePage`. Über die Chunks, die die Lagekarte lädt,
ist der Umbau kleiner; die Vorgabe „Lagekarten-Chunk nicht größer“ ist für `LagekartePage` allein
nicht erfüllt. Gemeldet als Blocker.

## Kosten des Vokabulars im Picker (Task 5.2, 11.10.2026)

Gemessen mit `frontend/src/pages/lagekarte/FreiesZeichenPicker.kosten.test.tsx`
(`TZ=Europe/Berlin mise exec -- pnpm exec vitest run … --silent=false`, Node 26.7.0, jsdom,
Cloud-Container mit 4 Kernen; Einzellauf, also kalter Modulzustand). Die Optionen sind je
Entwurfsstand gemerkt (Modul-Merker in `zeichenWahl.ts`, im Picker per `useMemo`).

| Messpunkt | ms |
| --- | ---: |
| Öffnen, Optionen für die Formation (Grundzeichen, Symbole, Details; kalt) | 570 |
| Grundzeichenwechsel Formation → Landfahrzeug (kalt) | 529 |
| derselbe Wechsel noch einmal (gemerkt) | 0,1 |
| Detailwahl Organisation an der Formation (kalt) | 29 |
| Rendern des Pickers beim Öffnen (Person, jsdom, samt Optionen) | 1186 |
| Rendern nach Grundzeichenwechsel Person → Gefahr (jsdom, samt Optionen) | 277 |

Gegenprobe ohne jsdom (Node, `vocabulary()` je Feld am nackten Körper aller 19 Arten): beim
ersten Besuch einer Art 170–590 ms, davon `capabilities` im Mittel 314 ms und `bodyMarks` 55 ms;
danach je Art 36 ms für alle Felder zusammen. Die Bibliothek merkt sich ihre Fassungen je Art und
Fähigkeit; teuer ist also der **erste** Besuch einer Grundzeichenart in der Sitzung, nicht jeder
Wechsel. Ohne Grundzeichen (226 freistehende Optionen) kostet das Vokabular rund 11 ms.

Einordnung: Ein erster Wechsel auf eine noch nicht besuchte Art hält den Picker rund eine halbe
Sekunde an. Das liegt über der Schwelle, ab der ein Klick träge wirkt. Ob die Optionen je Art vorab
berechnet werden (Risiko „Picker-Kosten“ in design.md), ist offen und in der Abschlussmeldung
benannt.

### Bewertung (Main-Loop, 11.10.2026)

Das Akzeptanzkriterium des Tasks ist ein Precache, der nicht größer wird: Er sinkt um 5,02 KiB.
Unter „Lagekarten-Chunk“ verstehen wir alle Chunks, die die Lagekarte lädt (`LagekartePage`,
`useBasemap`, `fachobjektZeichen`). Zusammen sinken sie um 25,58 kB. `LagekartePage` allein
wächst um 4,96 kB, weil die Picker-Logik (`zeichenWahl.ts`, „zuletzt verwendet“ v2,
Inspector-Kachel) dort liegt, während der Katalog des Altpakets im geteilten Zeichen-Chunk lag.
Den Picker in einen eigenen Lazy-Chunk auszulagern, würde die Gesamtmenge nicht senken. Es
brächte nur eine Ladeverzögerung beim ersten Öffnen. Wir verzichten deshalb darauf.

## Kosten des Pickers im echten Browser (Task 7.3, 11.10.2026)

Gemessen im Prod-Bundle (`pnpm run build`, Stand nach `4f6eaad12`), ausgeliefert vom e2e-Backend
wie im Einsatz, mit Playwright-Chromium (headless, Build 1194 / Chromium 141, Cloud-Container mit
4 Kernen, Xeon 2,8 GHz), Viewport 1440 × 1000, Dichte `kompakt`. Sieben Runden, jede in einem
frischen Browserkontext (kalter Modulzustand, Service Worker gesperrt). Gemessen wurde in der
Seite von `click()` auf das Bedienelement bis zum ersten gemalten Bild danach
(`requestAnimationFrame` + `setTimeout 0`), also die Wartezeit, die eine Person sieht. Die Messspec
lag nur temporär im Baum (nicht committet).

| Messpunkt | Median ms | min | max | jsdom (5.2) |
| --- | ---: | ---: | ---: | ---: |
| Öffnen („Taktisches Zeichen platzieren“ → Raster steht) | 829 | 806 | 1026 | 570 (nur Optionen) |
| erster Wechsel Formation → Landfahrzeug | 620 | 590 | 839 | 529 |
| Wechsel zurück auf die Formation (schon besucht) | 21 | 20 | 31 | — |
| wiederholter Wechsel auf das Landfahrzeug | 21 | 20 | 25 | 0,1 |
| „Kein Grundzeichen“ (freistehende Optionen, 226 + Varianten) | 105 | 86 | 120 | ≈ 11 (nur Vokabular) |
| erster Wechsel auf eine weitere Art (Gefahr) | 430 | 418 | 504 | — |

**Befund:** Der erste Wechsel auf eine noch nicht besuchte Grundzeichenart liegt im Browser mit
rund 0,4–0,6 s deutlich über 300 ms, ebenso das Öffnen mit rund 0,8 s. Ein wiederholter Wechsel
ist mit rund 20 ms flüssig. Teuer ist das probeweise Zeichnen der Kandidaten in `vocabulary()`
beim ersten Besuch einer Art (siehe Gegenprobe in 5.2). Nicht umgebaut; die Entscheidung über ein
Vorausberechnen je Art (Risiko „Picker-Kosten“ in design.md) liegt beim Main-Loop.

Nebenbefund Bundle: Mit den beiden Picker-Fixes (zweite Darstellungen, Entwurf ohne Zeichen) liegt
`LagekartePage` bei 135.74 kB (gzip 42.72), Precache 6657.96 KiB (34 Einträge).
