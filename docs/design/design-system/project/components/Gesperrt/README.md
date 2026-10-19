# Frei und gesperrt

**Gesperrt trägt die Sperre ohne Farbe** (LLH-1233): gesperrte antd-Knöpfe und -Felder haben
einen gestrichelten Rand in `steuer-rahmen`, randlose Einträge (Menü, Auswahlliste, antds
`Segmented`) eine Strichlinie nach innen (`index.css`). Gestrichelt heißt nur gesperrt: die
Knopfvariante `dashed` ist gesperrt (`theme/gesperrtZeichen.guard.test.ts`).

Aus `frontend/src/theme/gesperrtZeichen.guard.test.ts`:

Zeichen der Sperre ohne Farbe (LLH-1233, Spec `textstufen-kontrast`): gesperrte antd-Knöpfe,
Felder und Einträge tragen einen GESTRICHELTEN Rand (`index.css`). Damit das Zeichen eindeutig
bleibt, ist gestrichelt für Freies gesperrt: antds Knopfvariante `dashed` kommt im Quelltext
nicht vor.

Quelle: `frontend/src/index.css` im Repo `rubenvitt/lifeline-hub`. Die Vorschau ist aus
dem echten Baustein gerendert, mit dem antd-Theme der App, Nacht und Tag, Dichte `kompakt`.
