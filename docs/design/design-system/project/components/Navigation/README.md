# Navigation im Einsatz (Rail und Modulpanel)

Schmale vertikale Kategorie-Rail, 60 px.

Das Etikett steht SICHTBAR, nicht im Tooltip: auf dem Führungs-Tablet gibt es kein Hover. Es
ist das Kurzetikett (`Kategorie.kurz`); der volle Name bleibt `aria-label` und `title`.
„Einstellungen" (`fuss`) steht abgesetzt unten. Es bleiben SECHS Kategorie-Ziele in EINER
Landmarke; steht ein Modulpanel daneben, kommt im Fuß der Griff „Menü“ dazu.

Quelle: `frontend/src/einsatz/IconRail.tsx` im Repo `rubenvitt/lifeline-hub`. Die Vorschau ist aus
dem echten Baustein gerendert, mit dem antd-Theme der App, Nacht und Tag, Dichte `kompakt`.
