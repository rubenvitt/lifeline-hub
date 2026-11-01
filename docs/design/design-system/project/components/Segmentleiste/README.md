# Segmentleiste

Segmentleiste — Umschalter im Instrumentenstil (ETB-Filter, Basiskarte, Ansicht). Ersatz für
antds `Segmented`, dessen Pillenform, Schatten und Gleitanimation die Formensprache (Radius 0,
Fugenraster) brechen.

FUGENRASTER: die Segmente stehen mit `gap: 1px` auf `linieStark`; aktiv `flaeche3` + `text`,
inaktiv `flaeche` + `gedaempft`, optional ein 6-px-Farbpunkt (quadratisch). Farben und
Hover/Fokus liegen als Klassen in `theme/sprache.css` (`.lfh-segmente`, `.lfh-segment`), weil
`:hover` und `:focus-visible` inline nicht erreichbar sind; die GEOMETRIE steht inline aus den
Tokens.

ZUGÄNGLICH als `radiogroup` (Vorgabe, eine Wahl unter mehreren) oder als `tablist` (wenn das
Segment eine Fläche darunter umschaltet). Tastatur nach APG: ←/→ (und ↑/↓) wandern und
wählen, Pos1/Ende springen; nur das gewählte Segment liegt in der Tab-Reihenfolge (roving
tabindex).

BEDIENZIEL: jedes Segment ist ein `<button>` ohne antd-Höhe und trägt die ZWEI Angaben aus
LFH-365 (`segmentStil`). Die Staffel 30 / 48 / 72 gilt, nicht die Entwurfsskizze — als
Mindesthöhe und Mindestbreite (LLH-1224), das Wort steht mittig.

WORTLAUT: einzeilig. Ein Zeilenumbruch (`\n`) im `label` ist erlaubt und bricht dort
(`white-space: pre-line` an `.lfh-segment`), mittig in zwei Zeilen. Nur wo die Höhe zwei
Zeilen trägt und einzeilig neben den übrigen Segmenten kein Platz bliebe, etwa
„Ohne\nSchicht“ der Ablösung im Handschuh-Betrieb auf dem Handschirm (72 px, LLH-1128). Der
zugängliche Name bleibt „Ohne Schicht“; wo Platz ist, steht derselbe Wortlaut ohne Umbruch.

ZIELABSTAND (LFH-865, Muster LFH-630, Bedien-Leitlinie Kriterium 2): die Fuge bleibt 1 px,
und jedes Segment steht in einer eigenen Rasterzelle (`data-lfh="segment-zelle"`, Grund
`flaeche`), in der es um `zielEinzug` (0 / 4 / 8 px) von jedem Rand abrückt — auch oben
und unten, weil die Leiste umbricht. Benachbarte Segmente stehen so in `komfortabel` ≥ 8 px,
in `handschuh` ≥ 16 px auseinander. Die waagerechte Polsterung des Segments sinkt um den
Einzug, die Breite bleibt; die Leiste wird um 2 × Einzug höher, die Treffhöhe bleibt
`controlHeight`. Die Zelle hat `role="none"`: Radiogruppe und Tabliste besitzen ihre Segmente
weiter unmittelbar, Pfeiltasten und roving tabindex bleiben am `<button>`. Aktiv-Fläche,
Hover und Fokus liegen auf dem Segment, nicht auf der Zelle: sie zeigen, wo ein Tippen wirkt,
der Rand bleibt still (wie die Kennzahl, LFH-630 D4).

GESPERRT: ein Segment mit `gesperrt` bleibt SICHTBAR und nennt seinen Grund — als Tooltip und
als Beschreibung (`aria-describedby`). Es ist `aria-disabled`, nicht `disabled`: ein natives
`disabled` nähme es aus Fokus und Hilfstechnik, der Grund wäre unerreichbar. Klick und Pfeile
wählen es nicht, die Pfeile springen darüber hinweg. Der Grund ist der zweite Kanal neben
dem Grau (WCAG 1.4.1).

Quelle: `frontend/src/components/instrument/Segmentleiste.tsx` im Repo `rubenvitt/lifeline-hub`. Die Vorschau ist aus
dem echten Baustein gerendert, mit dem antd-Theme der App, Nacht und Tag, Dichte `kompakt`.
