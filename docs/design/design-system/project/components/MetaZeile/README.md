# MetaZeile (Nebenangaben eines Datensatzes)

MetaZeile — Angaben zu einem Datensatz in einer Zeile („Metazeile in
einer Form", LLH-1810): Teile in `textKlein`/`schwach`, dazwischen „·", den der Vorleser nicht
hört. Ein leerer Teil fällt samt Trenner weg, damit kein „· ·" stehen bleibt. Zahl, Zeit,
Kennzeichen und Nummer stehen mit `mono` in der Stufe `meta` (Zahlenfamilie, gleich breite
Ziffern). Reicht die Breite nicht, bricht die Zeile zwischen den Teilen um.

Steht eine Zeit in einem Wortteil („bis 14:32“), trägt `MetaZeile.Zahl` sie in Mono.

Ersetzt `Text type="secondary" style={{ fontSize: 12 }}` mit Trennern von Hand. Regel:
`frontend/AGENTS.md`, „Gestaltungssprache“, Bausteine.

Quelle: `frontend/src/components/instrument/MetaZeile.tsx` im Repo `rubenvitt/lifeline-hub`. Die Vorschau ist aus
dem echten Baustein gerendert, mit dem antd-Theme der App, Nacht und Tag, Dichte `kompakt`.
