# LFH-1010 · Belege der Druckprüfung in Safari

Lauf vom 08.10.2026. Die Verdikte stehen in
`docs/superpowers/specs/2026-09-25-lfh-22-pruefliste.md` (Abschnitt „Browser-Verdikt“), die
Kennzahlen je Datei in `safari/protokoll.json`.

## Wie gedruckt wurde

- **Safari 27.0.1** (22625.1.29.11.28) auf **macOS 27.0.1** (26A434), Apple Silicon.
- **Echter Druckpfad:** Druckdialog über Cmd+P → PDF → „Als PDF sichern …“, gesteuert per
  `osascript`/System Events (Bedienungshilfen). Erzeuger in jedem PDF: „Safari“ / „macOS … Quartz
  PDFContext“, A4. `safaridriver` scheidet aus: Safaris Automation-Protokoll kennt kein Drucken.
- Einstellungen: A4 hoch, 100 %, Kopf- und Fußzeilen des Browsers aus, Hintergrund aus, App im
  Nachtbetrieb (Vorgabe). Autor-Metadaten im Sichern-Dialog geleert.
- **Nicht über den App-Knopf:** „Drucken / als PDF“ öffnet in Safari keinen Dialog, solange eine
  `EventSource` offen ist (WebKit stellt `window.print()` zurück, bis das Dokument „fertig geladen“
  ist; der Live-Strom endet nie). Nachweis: `werkzeug/sse-druckprobe.html`. Folgeticket LFH-1105.
  Beim Meldebild lief der Seitenknopf trotzdem zuerst (er klappt die Mittel auf), dann Cmd+P.

## Daten

Wie LFH-813 (`../lfh-813/werkzeug/saeen.mjs`, seit diesem Lauf mit `von`/`an` an jedem
ETB-Eintrag), gegen ein frisches Backend auf Stand alpha `d25696ab7`.

## Ergebnis in Kürze

| Druckstück | Safari | Firefox (LFH-813) |
| --- | --- | --- |
| Lagebericht lesend | 9 S., vollständig | 9 S. |
| Lagebericht Entwurf, Vorgabe | 8 S., abgeschnitten | 9 S. |
| Lagebericht Entwurf, Split | 9 S., abgeschnitten | 9 S. |
| Befehl lesend | 6 S., abgeschnitten | 6 S. |
| Befehl Entwurf | 7 S., vollständig | 6 S. |
| Meldebild | 6 S., 10 von 40 Kräften | 21 S. |
| ETB | 84 S., bis Nr. 410 von 555 | 64 S. |
| ETB gefiltert | 28 S., bis Nr. 538 | 28 S. |

Gegenproben: `safari/langtest.pdf` (statische Tabelle, 4000 Zeilen) druckt vollständig auf 95
Seiten, das Abschneiden liegt also an der App-Seite (LFH-1108). Bei 800 statt 1271 px
Fensterbreite bleibt es gleich (`*-fenster800.pdf`). Den Tabellenkopf wiederholt Safari auch in
der Gegenprobe nicht (LFH-1110). Minimalprobe `break-after: avoid`: Titel in 4 von 9 Lagen allein
am Seitenende, wie Firefox; in den App-Druckstücken hält der Titelblock.

## Dateien

| Datei | Inhalt |
| --- | --- |
| `safari/*.pdf` | je Druckstück das PDF aus Safari, dazu Minimalprobe und Gegenproben |
| `safari/protokoll.json` | Versionen, Weg, Einstellungen, Befunde, Kennzahlen je Datei |
| `meldebild-safari.png` | Meldebild, Seiten 1–4: oben Safari, unten Firefox |
| `befehl-lesend-safari-ende.png` | Befehl lesend, Seiten 5–6: Ende ohne Endmarke |
| `werkzeug/baue_minimalprobe.mjs`, `werkzeug/minimalprobe.html` | Minimalprobe aus LFH-813 als eine statische Seite |
| `werkzeug/auswerten_safari.py` | Auswertung (pdftotext/pdfinfo/pdfimages, Pillow) |
| `werkzeug/sse-druckprobe.html` | Nachweis: `window.print()` bei offener `EventSource` |

## Nachvollziehen

Backend, Vite und `saeen.mjs` wie in `../lfh-813/README.md`. Dann in Safari je Druckstück
Cmd+P → PDF → „Als PDF sichern“ und `python3 werkzeug/auswerten_safari.py <ordner>`.
`sse-druckprobe.html` unter demselben Ursprung wie die App ausliefern (z. B. aus
`frontend/public/`), angemeldet öffnen und die Knöpfe der Reihe nach drücken.
