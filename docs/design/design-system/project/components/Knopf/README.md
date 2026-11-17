# Knopf (primär, Standard, Text, Gefahr, gesperrt, mit Symbol)

Der Boden der kurzen Achse für JEDEN Knopf: `minWidth` = kleine Steuerhöhe der
Stufe, also 24 / 48 / 72 (A1 Gate 3).

antds Polsterung kleiner Knöpfe ist das Literal 7 (`paddingInlineSM`), ohne Dichte: ein „OK“
blieb rund 38 px breit. Ein Boden statt mitwachsender Polsterung wirkt nur, wo der Knopf zu
schmal wäre, und lässt breite Etiketten unberührt.

Am Kontext statt in CSS, damit er auch die Knöpfe erreicht, die antd selbst baut
(Bestätigungsblase, Modal-Fuß, Filter-Dropdown). Ein `style` am einzelnen Knopf schlägt den
Kontext; das ist der Weg für eine benannte Ausnahme, nicht für Neues.

Grenze: als Inline-Stil überstimmt er antds Kreis-`minWidth` und erreicht `FloatButton`. Heute
gibt es keinen Aufrufer von beidem; wer einen einführt, prüft das.

Quelle: `frontend/src/theme/tokens.ts` im Repo `rubenvitt/lifeline-hub`. Die Vorschau ist aus
dem echten Baustein gerendert, mit dem antd-Theme der App, Nacht und Tag, Dichte `kompakt`.
