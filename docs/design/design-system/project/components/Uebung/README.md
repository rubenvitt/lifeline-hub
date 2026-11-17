# Übungsmarke: Band und Marke

Übungsmarke (`frontend/AGENTS.md`, Rahmen, „Übung“): der EINE
Baustein, an dem man eine Übung erkennt, ohne den Namen zu lesen. Zwei Formen:

- `UebungsMarke`: kompakter Chip vor einem Einsatznamen (Kopf, Liste, Wechsler,
  Lagemonitor).
- `UebungsBand`: Band über die volle Breite unter dem Kopf (Einsatzrahmen, Gerätehülle),
  schräg schraffiert, klebt in jeder Breite.

Beide entscheiden selbst über `isUebung` und rendern sonst nichts, auch keinen
Platzhalter: Aufrufer reichen den Einsatz durch und prüfen nicht. Das Wort steht immer dabei
(WCAG 1.4.1); die Farbe allein zeigt nichts an. Erkennbar an Form und Wort, nicht am Farbton allein
(Violett tragen auch ETB-Entscheidung und Abschnittsflächen der Lagekarte).
Still: kein Ton, kein Blinken (`geraet/AGENTS.md`).

Quelle: `frontend/src/components/instrument/Uebung.tsx` im Repo `rubenvitt/lifeline-hub`. Die Vorschau ist aus
dem echten Baustein gerendert, mit dem antd-Theme der App, Nacht und Tag, Dichte `kompakt`.
