# Großbild: Zeilen

Zeilen im Großbild („Lesbar aus der Entfernung“: „Ein Wert
MUST direkt neben oder unter seiner Bezeichnung stehen“; design.md D4).

`GrossZeilen` ist ein Raster aus zwei Spalten: die erste so breit wie die längste
Bezeichnung, die zweite trägt Wert und Notiz. So beginnt jeder Wert direkt rechts der
Bezeichnungen, nie am anderen Rand der Fläche. `GrossZeile` legt sich mit
`display: contents` in dieses Raster.

Eine Farbmarke (Sichtungskategorie, Warnstufe) steht nur vor einer Bezeichnung, die das Wort
trägt; sie selbst ist für Vorleser stumm.

Quelle: `frontend/src/components/grossbild/GrossZeile.tsx` im Repo `rubenvitt/lifeline-hub`. Die Vorschau ist aus
dem echten Baustein gerendert, mit dem antd-Theme der App, Nacht und Tag, Dichte `kompakt`.
