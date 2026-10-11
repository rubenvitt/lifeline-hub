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
