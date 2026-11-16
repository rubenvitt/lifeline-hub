# Großbild: Kennzahl

Eine Kennzahl im Großbild (LLH-1747, Spec `grossbild-ansicht`; design.md D4 in
`openspec/changes/archive/2026-11-16-ckl1wbvz-grossbild-lage/`): Bezeichnung, darunter die Zahl (Mono, feste Ziffern,
96 bzw. 72 px bei 1920 × 1080), darunter die Notiz. Alle Größen aus `grossMass`, also
mitwachsend.

Nur zum Ansehen: kein Ziel, kein Link, kein Tooltip. Eine gesperrte Quelle reicht der Aufrufer als
„—“ mit Grund herein; `laden` und `fehler` sehen aus wie an der `Kennzahl` und behaupten keinen
Ton.

Aus `frontend/src/components/grossbild/grossMass.ts`:

Großbild-Skala (LLH-1747, Spec `grossbild-ansicht`, „Lesbar aus der Entfernung“; design.md D3 in
`openspec/changes/archive/2026-11-16-ckl1wbvz-grossbild-lage/`).

Quelle: `frontend/src/components/grossbild/GrossKennzahl.tsx` im Repo `rubenvitt/lifeline-hub`. Die Vorschau ist aus
dem echten Baustein gerendert, mit dem antd-Theme der App, Nacht und Tag, Dichte `kompakt`.
