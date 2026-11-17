# Zustände: Seite und Paneel (laden, leer, Fehler)

Lade-, Leer- und Fehlerzustände einer Seite. Lade- und
Fehlerzweig stehen an den Aufrufstellen unmittelbar untereinander, deshalb eine Datei.

Aus `frontend/src/components/instrument/PaneelZustand.tsx`:

Datenzustand eines Paneel-Körpers. Dieselben vier Werte wie `Datenzustand` in
`pages/lage-dashboard/lagebild.ts` — der Baustein führt sie SELBST, damit er nicht von
einer Seite abhängt. Wer dort umstellt, tauscht den Typ ohne Wertänderung.

Quelle: `frontend/src/components/SeitenZustand.tsx` im Repo `rubenvitt/lifeline-hub`. Die Vorschau ist aus
dem echten Baustein gerendert, mit dem antd-Theme der App, Nacht und Tag, Dichte `kompakt`.
