# DokumentEntwurf (Bearbeiten und Lesefassung)

Die Schreibfläche jedes gegliederten Führungsdokuments — Lagebericht, Befehl, Pressemitteilung
(`entwurf/AGENTS.md`, „Gegliederte Dokumente“; Herleitung LLH-1074, vorher LFH-348). EIN
Baustein, damit dasselbe Dokument nicht zwei Bedienformen hat.

- **Paneel „Entwurf“** mit dem Füllstand („5/8 Abschnitte“) und dem Umschalter „Bearbeiten |
  Lesefassung“ für das GANZE Dokument; darunter der Kopfblock der Seite.
- **Gliederung** als Sprungleiste: je Abschnitt Zeichen und Wort „leer“ (zweiter Kanal, WCAG
  1.4.1). Ab `xl` klebt sie links unter dem Rahmen, darunter steht sie oben als eine Zeile, die
  in sich rollt (`dokumentEntwurf.css`). Darüber optional eine Aktion der Seite
  (`gliederungKopf`).
- **Alle Abschnitte offen**, untereinander; der Editor wächst mit dem Inhalt (leer einzeilig,
  `EDITOR_ZEILEN`). Kopf mit Name (h3), Leer-Marke, Hilfetext und Aktion.
- **Lesefassung** aus den aktuellen Formularwerten, so wie gedruckt (`AbschnittsText`). Die
  Editoren bleiben dabei eingehängt (`hidden`): rc-field-form liefert beim Absenden nur
  eingehängte Felder, ein Speichern schickte sonst alle Abschnitte leer.
- **Druck** wie bisher: im Bearbeiten die Druckfassung je Editor (Titelblock LFH-1008), in der
  Lesefassung die Lesefassung; Bedienung weicht (`dokumentEntwurf.css`).

TIPPLATENZ: der Baustein beobachtet das Formular nur über die Leer-Kette (`Form.useWatch` mit
Selektor) und rendert nur, wenn ein Abschnitt kippt; jeder Abschnitt ist `memo`. Tippen rendert
damit nur das eigene `Form.Item` (Messung `e2e/lagebericht-tippen.spec.ts`).

Quelle: `frontend/src/entwurf/DokumentEntwurf.tsx` im Repo `rubenvitt/lifeline-hub`. Die Vorschau ist aus
dem echten Baustein gerendert (der Zustand nach einem Klick im jsdom), mit dem antd-Theme der App, Nacht und Tag, Dichte `kompakt`.
