# Verschiebeprobe LFH-1124

Werkzeug: `lauf.sh` mit `probe.tsx` (echte `Bloecke`-Komponente, echtes Druck-CSS, Vite-Dev-Server)
und `verschiebeprobe.mjs` (PDF über den Druckpfad des Browsers, Auswertung per `pdftotext -bbox`).
Platzhalter vor dem Bericht 600–1100 px in 10-px-Schritten (51 Lagen je Fall); die Inhaltshöhe
einer A4-Seite beträgt 1009 px, jede Lage zwischen etwa 860 und 1010 px schiebt den Titel also
über das Seitenende.

- `etb`: Abschnittstitel „Entscheidungen“ (h3 „ETB-Auszug“ + h4) vor 30 Entscheidungen
- `personal`: Blocktitel „Anlage: Personal je Kopf“ (h3) vor 40 Köpfen

Befunde: `ok` (Titel mit erster Zeile), `NUR-KOPF`, `TITEL-ALLEIN`; `/rest<n>px` heißt, der
Titel ist auf die Folgeseite gerückt und hat davor n px frei gelassen.

## Vorher (Stand `alpha`, 10.10.2026)

| Browser | Fall | ok | Treffer |
| --- | --- | --- | --- |
| Firefox 157.0.1 | etb | 44/51 | 870–900 NUR-KOPF, 910–930 TITEL-ALLEIN |
| Firefox 157.0.1 | personal | 43/51 | 890–930 NUR-KOPF, 940–960 TITEL-ALLEIN |
| Chromium 141.0.7390.37 | etb | 51/51 | — (rückt bei ≤ 140 px Rest weiter) |
| Chromium 141.0.7390.37 | personal | 51/51 | — (rückt bei ≤ 110 px Rest weiter) |

In Firefox liegt das Fenster der Treffer genau dort, wo Chromium den Titel mitnimmt: Titel
(und Kopf) passen noch, die erste Zeile nicht mehr.

## Erster Versuch: Deckel als Block

Deckel als Box und Kopie in ihrer Bildlauf-Hülle in allen Engines: Firefox 51/51 in beiden
Fällen, aber Chromium fiel auf 44/51 (etb) und 43/51 (personal), jeweils TITEL-ALLEIN. Zwischen
Titel und Tabelle stand eine Box, `break-after: avoid` am Titel griff in Chromium nicht mehr.
Daraus: Deckel im Markup `display: contents`, Kopie ohne Hülle mit `display: none`; erst der
Firefox-Druck macht beide zu Boxen.

## Nachher (Deckel, Stand dieser Change)

| Browser | Fall | ok | Treffer | größter Rest vor dem Titel |
| --- | --- | --- | --- | --- |
| Firefox 157.0.1 | etb | 51/51 | — | 150 px |
| Firefox 157.0.1 | personal | 51/51 | — | 130 px |
| Chromium 141.0.7390.37 | etb | 51/51 | — | 140 px |
| Chromium 141.0.7390.37 | personal | 51/51 | — | 110 px |

- Firefox rückt den Deckel erst weiter, wenn Titel, Kopf und erste Zeile nicht mehr passen; der
  Rest davor ist höchstens so hoch wie sie (etb: h3 + h4 + Kopf + zweizeilige erste Zeile).
- Jede Tabellenzeile steht in jeder Lage genau einmal im PDF (Prüfung `zaehl`).
- Chromium: die PDF-Textebene ist in allen 102 Lagen byte-gleich zur Vorher-Messung.
- Sichtprüfung (Firefox und Chromium nebeneinander): Naht zwischen Zeile 1 und 2 ohne Spalt,
  Spalten deckungsgleich, auf der Folgeseite der wiederholte Kopf mit Zeile 2.
