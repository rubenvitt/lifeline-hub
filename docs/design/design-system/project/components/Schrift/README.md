# Schrift: Rollen der Skala und Feldetikett

Schrift — Text in einer Rolle der Schriftskala. Die Größe ist
die CSS-Variable der Stufe und wächst mit der Dichte; jede Rolle setzt gleich breite Ziffern.
Für Stellen ohne eigenen Baustein, die eine Größe brauchen: statt `fontSize` mit einer Zahl
(macht `theme/schriftLiteral.guard.test.ts` rot). Ein antd-Element, das nur einen `style`
nimmt, liest `schriftStil(rolle)` bzw. `schriftGroesse(stufe)` aus `./rollenwerte`.

Der Name ist nicht `Text`: viele Dateien importieren antds `Typography.Text` als `Text`.

Quelle: `frontend/src/components/instrument/Schrift.tsx` im Repo `rubenvitt/lifeline-hub`. Die Vorschau ist aus
dem echten Baustein gerendert, mit dem antd-Theme der App, Nacht und Tag, Dichte `kompakt`.
