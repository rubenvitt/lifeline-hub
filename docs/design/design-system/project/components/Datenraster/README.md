# Datenraster mit DatenfeldEingabe und FeldFehler

Datenraster — die Detail-Optik statt antds `Descriptions`: je Feld eine Augenbraue über dem
Wert, 2–4 Spalten im Fugenraster, Kennungen/Zahlen/Zeiten in Mono.

SEMANTIK: ein `<dl>`; jedes Feld ist ein `<div>` mit `<dt>` (Augenbraue) und `<dd>` — die
zulässige Gruppierung nach HTML, Vorleser hören Begriff und Wert als Paar.

BEARBEITEN AN ORT UND STELLE: im Edit-Modus einer Detailseite steht statt `Datenfeld` eine
`DatenfeldEingabe` (`./DatenfeldEingabe.tsx`, LLH-1101) im selben Raster — mit einem Etikett, das
die Eingabe benennt, und einem `Form.Item` OHNE `noStyle`, damit ein Prüffehler sichtbar unter
der Eingabe steht. Ein `Form.Item noStyle` im `Datenfeld` ist der alte Weg: die Eingabe bliebe
ohne Namen, und eine Regel verhinderte das Speichern still. `mono` setzt die Schrift am `<dd>`.

Quelle: `frontend/src/components/instrument/Datenraster.tsx` im Repo `rubenvitt/lifeline-hub`. Die Vorschau ist aus
dem echten Baustein gerendert, mit dem antd-Theme der App, Nacht und Tag, Dichte `kompakt`.
