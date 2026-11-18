# Textstufe (Stufen der Schriftskala und Töne)

Textstufe — Text in einer Stufe der `schriftskala` und einem Ton. Größe, Gewicht, Familie, Sperrung und Versalien kommen aus der Stufe, die Farbe aus
der Rolle des aktiven Modus. Die Größen sind fest und wachsen nicht mit der Dichte: antds
Grundschrift steigt schon, „der Handschuh ändert die Hand, nicht das Auge" (`theme/tokens.ts`).

Bewusst ohne `style`: eine freie Schriftgröße käme sonst durch die Hintertür. Das Element ist
wählbar (`als`), die Optik bleibt dieselbe — die Gliederung gehört in den Baum, nicht ins
Aussehen. Regel: `frontend/AGENTS.md`, „Gestaltungssprache“, Bausteine.

Quelle: `frontend/src/components/instrument/Textstufe.tsx` im Repo `rubenvitt/lifeline-hub`. Die Vorschau ist aus
dem echten Baustein gerendert, mit dem antd-Theme der App, Nacht und Tag, Dichte `kompakt`.
