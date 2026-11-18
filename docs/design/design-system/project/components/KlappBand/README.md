# Klappbares Kennzahlenband

Ein Kennzahlenband über einer Liste, das sich einklappen lässt (Change
`z137bgm5-seitenkopf-einzeilig` D3): das Statusband des Meldebilds und die Unterbringung der
Betreuung. In den Stufen 48 und 72 nahm das Band die halbe Höhe vor der ersten Zeile.

- Ohne gemerkte Wahl steht es offen. Eingeklappt bleibt EINE Zeile: der Kopf mit der Kurzform
  der Zahlen, die die Seite hereinreicht. Der Baustein kennt die Zahlen nicht.
- Die Wahl gilt je Seite auf dem Gerät (`lfh:klappband:<seite>`, `GERAETESPEICHER`, „bleibt“),
  erst State, dann Speicher: ohne Browserspeicher wirkt sie für die Sitzung.
- Der Kopf ist ein `<button>` mit `aria-expanded` (APG-Disclosure) und hält die Steuerhöhe der
  Stufe, Muster
  `KlappPaneel` der Lagekarte.

- Im Druck steht das Band immer offen und der Kopf fehlt (`klappBand.css`).

Nicht für die Sichtungszeile der Betroffenen: sie muss am Handschirm im ersten Bild stehen.

Quelle: `frontend/src/components/instrument/KlappBand.tsx` im Repo `rubenvitt/lifeline-hub`. Die Vorschau ist aus
dem echten Baustein gerendert, mit dem antd-Theme der App, Nacht und Tag, Dichte `kompakt`.
