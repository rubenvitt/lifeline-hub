# Knopfreihe (Knöpfe nebeneinander, Abstand md)

Knopfreihe — zwei oder mehr Knöpfe nebeneinander. Der Abstand ist fest die
Rasterstufe `md` der aktiven Dichte (kompakt 12, komfortabel 20, handschuh 24 px): so steht auch
ein roter Knopf nie bündig neben einem neutralen, und kein Aufrufer kann einen anderen Abstand
wählen. Deshalb gibt es weder `style` noch einen Abstand als Prop.

Die Reihe bricht um, statt hinauszulaufen. Als Dialogfuß (`fuss`) steht sie ab `md`
rechtsbündig und unter `md` untereinander in voller Breite: oben der Abbruch, unten am
Daumen der Primärknopf.

Die Reihe ordnet ihre Kinder nicht um: Lese- und Tabfolge sind die sichtbare Folge. Im Kopf,
im Paneel und in der Zeile steht die Primäraktion vorn, im Fuß hinten. Regel:
`frontend/AGENTS.md`, „Aktionen“, „Knopfreihen über `Knopfreihe`“.

Quelle: `frontend/src/components/instrument/Knopfreihe.tsx` im Repo `rubenvitt/lifeline-hub`. Die Vorschau ist aus
dem echten Baustein gerendert, mit dem antd-Theme der App, Nacht und Tag, Dichte `kompakt`.
