# Text, Stapel, Meta, Feld (18.11.2026)

Entwurf zu LLH-1810 („Text-, Stapel-, Meta- und Feld-Bausteine statt Inline-Stile; danach Wächter
zurückbauen“). Heute stehen 3.553 `style={` in 706 TSX-Dateien; Schriftgrößen, Abstände und
Feldbreiten werden an jeder Stelle neu erfunden und von Wächtern und Regeltext eingefangen.

**Stand dieses Ordners:** die Zeichenflächen des Canvas
https://claude.ai/artifact/7JwMvNyGBTvAoqNytBZpFa (Artifact-Typ „Design“, Design System „Lifeline
Hub“). Die Schriften lädt der Canvas aus `ds/lifeline-hub/`; im Repo fallen die Flächen auf die
Systemschrift zurück. Der Lösungsweg wurde am 18.11.2026 mit Ruben abgestimmt
(Phase-1-Checkpoint), die Change dazu ist `openspec/changes/hzru8iq7-text-stapel-meta-feld/`.

| Datei                       | Zeichenfläche                                         | Dichte      |
| --------------------------- | ----------------------------------------------------- | ----------- |
| `Main.dc.html`              | Die vier Bausteine mit Stufen und Beispielen          | kompakt     |
| `Pilot-Fahrzeug.dc.html`    | Fahrzeug bearbeiten: vorher (Inline) und nachher      | kompakt     |
| `Handy-komfortabel.dc.html` | Handy 390 × 844, dasselbe Formular                    | komfortabel |

## Was der Entwurf vorschlägt

1. **`Textstufe`** setzt Größe, Gewicht, Familie und Sperrung einer Stufe der `schriftskala` und
   einen Ton (`text`, `text2`, `gedaempft`, `schwach`, `alarm`). Neue Stufe `kartentitel` 15/600;
   13 px rastet auf `text` (14) oder `textKlein` (12) ein. Die Größen wachsen nicht mit der Dichte.
2. **`Stapel`** ist ein Flex-Container mit `abstand` als Rasterstufe (`xxs` … `xl`), senkrecht als
   Vorgabe, `richtung="zeile"` waagerecht, `umbruch` erlaubt Umbruch. Eine Zahl nimmt er nicht an.
3. **`MetaZeile`** reiht Teile in `textKlein`/`schwach`, setzt „·“ als Trenner (vor dem
   Screenreader versteckt) und lässt leere Teile samt Trenner weg. `mono` für Zahlen, Zeiten,
   Kennzeichen.
4. **`Feld`** ist ein `Form.Item` mit `breite="kurz|schmal|mittel|voll"` (120 · 200 · 320 · 100 %; 120 und 200 sind die häufigsten Obergrenzen im Verwaltungsteil), immer
   fluid bis zur Obergrenze. Eine Pixelbreite lässt sich nicht ausdrücken; der
   `feldbreiten.guard` wird damit überflüssig.

Bewusst nicht im Entwurf: ein Knopfreihen-Baustein (`aktionsabstand`), Tabellen, der
Lagemonitor.
