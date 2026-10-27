# Ortsfeld (leer, verortet, nur Text; Kartenbild nur in der App)

Ortsangabe mit Adresssuche (LFH-1175, Spec `ortsfeld`; Kern von LFH-1248). Gesucht wird nur auf
Enter oder „Ort suchen“, nie beim Tippen: der öffentliche Nominatim verbietet
Autovervollständigung, und der Takt des Servers gilt für alle (`pages/lagekarte/AGENTS.md`,
Ortssuche). Enter im Feld sucht und sendet das umgebende Formular NICHT ab; gespeichert wird
über dessen Knopf.

Freitext bleibt erlaubt. Eine getippte Koordinate (jede Form der Sprungpalette) wird ohne Server
erkannt (LLH-1108). Mit `karte` stehen darunter die Vorschau mit ziehbarer Nadel, die Ort-Zeile
(Peilung nur im Einsatz) und „Auf Karte wählen“; mit `ohneSuche` ist das Feld reiner Text.

Quelle: `frontend/src/anzeige/Ortsfeld.tsx` im Repo `rubenvitt/lifeline-hub`. Die Vorschau ist aus
dem echten Baustein gerendert (der Zustand nach einer Bedienung im jsdom), mit dem antd-Theme der App, Nacht und Tag, Dichte `kompakt`.
