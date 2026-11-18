# Stapel (Abstand als Rasterstufe, senkrecht und als Zeile)

Stapel — reiht Elemente senkrecht (Vorgabe) oder waagerecht mit einem Abstand aus dem Raster
der aktiven Dichte („Stapel nehmen nur Rasterstufen", LLH-1810). Der
Abstand ist eine Stufe `xxs`…`xl`, nie eine Zahl; er kommt aus antds Token, die `antdToken()`
je Dichte aus `dichten[*].abstand` setzt, und wächst so mit `komfortabel` und `handschuh`.

Ersetzt `Space direction="vertical"`, `Flex vertical gap` und `flexDirection: 'column'` mit
erfundenem `gap`. Bewusst ohne `style`. Regel: `frontend/AGENTS.md`, „Gestaltungssprache“,
Abstandsraster und Bausteine.

Quelle: `frontend/src/components/instrument/Stapel.tsx` im Repo `rubenvitt/lifeline-hub`. Die Vorschau ist aus
dem echten Baustein gerendert, mit dem antd-Theme der App, Nacht und Tag, Dichte `kompakt`.
