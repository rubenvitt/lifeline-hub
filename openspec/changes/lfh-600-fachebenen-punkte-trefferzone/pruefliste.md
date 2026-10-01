# Prüfliste Einsatztauglichkeit — Punkte der Fachebenen auf der Lagekarte (LFH-600)

Angelegt an die geänderte Fläche: die Punkte und Bündel aller Punkt-Fachebenen der Lagekarte (Pegel,
Hochwasser, Luftqualität, ODL, Autobahn, KRITIS, Energie). Kriterien nach Festlegung 7 in
`docs/superpowers/specs/2026-07-25-bedien-leitlinie-einsatzkontexte.md`. Geprüft im Browser am
01.10.2026 (Chromium, 1366 × 768, DPR 1, Fachebenen hermetisch per `page.route`) und in Vitest.
Übernimmt die offenen Zeilen 1, 2 und 5 der LFH-79-Prüfliste
(`openspec/changes/archive/2026-09-29-fachebene-luftqualitaet-uba/pruefliste.md`).

| # | Kriterium | Verdikt | Beleg / Begründung |
|---|---|---|---|
| 1 | Treffläche | erfüllt | Unsichtbare Trefferzone je Punkt und Bündel, Durchmesser `controlHeight`: 30 / 48 / 72 px (Boden 24 px überschritten). Im Browser für alle sieben Ebenen geklickt (`e2e/gate3-trefflaeche.spec.ts`, Block LFH-600): Versatz 13 px (kompakt), 21 px (komfortabel), 32 px (handschuh) neben der Punktmitte, außerhalb alles Gezeichneten, öffnet die Detailansicht der richtigen Ebene. Gegenprobe kompakt: 23 px liegt außerhalb. Überlappen sich Zonen, gewinnt der nächste Punkt, auch gegen Marker (`klickziel.test.ts`). Mutationsproben: Zone fest 5 px → rot; Zone ohne Klickrolle → rot. |
| 2 | Handschuh-Modus | erfüllt | Zone 72 px im Handschuh-Modus, belegt per Klick 32 px neben jedem Punkt; ein Tipp 30 px neben ein KRITIS-Bündel zoomt hinein. Der Abstand ≥ 16 px zwischen Zielen hängt an den Daten, nicht am Layout. Liegen zwei Zonen übereinander, entscheidet der nähere Punkt (Regel aus LFH-711), Hineinzoomen trennt sie. |
| 3 | Rückmeldung vor der Serverantwort | erfüllt | Die Auswahl entsteht lokal aus den Properties des Merkmals (kein Serverabruf). Der Mauszeiger wechselt schon über der Zone auf „pointer“. |
| 4 | Kritische Aktion mit zweiter Handlung | nicht anwendbar | Die Punkte sind read-only; Anwählen öffnet nur die Detailansicht. |
| 5 | Kontrast in beiden Modi | erfüllt | Kontur = Doppelkante (2 px weiß, 2 px schwarz), gegen jeden Grund ≥ √21 ≈ 4,58 : 1 [abgeleitet]. Gemessen aus Pixeln (`e2e/fachebenen-kontrast.spec.ts`), beste Linie gegen den Grund: blind hell (`rgb(232, 232, 232)`) 17,14 · blind dunkel (`rgb(15, 17, 21)`) 18,90 · offline hell (`rgb(245, 245, 243)`) 19,24 · offline dunkel (`rgb(21, 24, 29)`) 17,79 · online `#ffffff` 21,00 · `#000000` 21,00 · `#f5f5f3` 19,24 · `#0f1115` 18,90 — jeweils für Pegel (Ebenenfarbe), Hochwasser „kein Hochwasser“ und „sehr groß“ und KRITIS-Einzelobjekt. Selbstprobe: ohne schwarze Kante auf Weiß 1,00 : 1 → rot. Zum Vergleich die Füllung allein (Messwert, keine Schwelle): auf hellem Grund 4,08–9,85, auf dunklem Grund 1,92–8,34 (KRITIS-Einzelobjekt auf `#0f1115` 1,92, Hochwasser 2,72) — ohne die Kante fiele sie dort unter 3 : 1. |
| 6 | Kein Status allein über Farbe | erfüllt | Der Radius bleibt der zweite Kanal und wächst nicht mit der Dichte: im Browser meldet der Kreis 8 px neben der Mitte bei „sehr groß“/„sehr schlecht“ einen Treffer, bei „kein Hochwasser“/„sehr gut“ keinen, in jeder Stufe gleich. Mutationsprobe: alle Kreise auf Radius 9 → rot. |
| 7 | Eine Farbe = eine Bedeutung | erfüllt | Weiß und Schwarz der Kante sind Kontur, keine Status- oder Ebenenaussage (bewusst `#000` statt eines Tokens, wie bei den Personen-Markern). Füllfarben unverändert. |
| 8 | Helligkeits-/Kontrastregler | nicht anwendbar | App-weit, von dieser Änderung nicht berührt. |
| 9 | Kritische Anzeigen im Blickfeld | nicht anwendbar | Die Ebenen lösen keine kritische Anzeige aus. |
| 10 | Alarmbudget | nicht anwendbar | Keine Meldung, kein Toast. |
| 11 | Warnverhalten | nicht anwendbar | Kein Blinken, kein Ton. |
| 12 | Kein Sprung unter dem Cursor | erfüllt | Die Punktmitte bleibt; die Kreise werden um 2,5 px größer (weißer Rand 2 statt 1,5 px, Kante 2 px), für alle Stufen gleich. Die Zone ist unsichtbar und verschiebt nichts. |
| 13 | Fokus nie verdeckt | nicht anwendbar | Kein neues fixiertes Element; die Leinwand trägt keinen DOM-Fokus je Punkt. |
| 14 | Tabellenseite vollständig | nicht anwendbar | Keine Tabelle. |
| 15 | Erfassungsmaske vollständig | nicht anwendbar | Keine Erfassung. |

**Messbedingung:** Die Online-Karten im Betrieb sind Fremdstile (OpenFreeMap, basemap.de,
TopPlusOpen, Satellit), die e2e nicht laden darf. Gemessen wurde deshalb gegen feste Gründe, die
die Extreme (Weiß, Schwarz) und den hellsten und dunkelsten Flächenton der eigenen Palette
abdecken. Die Doppelkante ist so gebaut, dass sie vom Grund nicht abhängt.
