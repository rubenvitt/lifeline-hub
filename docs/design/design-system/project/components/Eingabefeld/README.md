# Eingabefeld (Beschriftung darüber, Pflicht mit Fehlerzeile, FeldFehler)

FeldFehler — die Fehlerzeile unter einer Eingabe, auch ohne antd-`Form` (Nutzer
außerhalb eines `Form.Item`, etwa die feldweise Bearbeitung der Personendaten).

EINE OPTIK MIT ANTDS FORMULARMELDUNG: Farbe `alarmText` (dieselbe Rolle, die `antdKomponenten`
dem `Form`-Token `colorError` gibt, `frontend/AGENTS.md`, „Geerbter Text auf Textrollen“; nie
antds Füllfarbe `colorError`), Schrift und Zeilenhöhe aus `fontSize`/`lineHeight` wie
`.ant-form-item-explain`. Wer in einem `Form.Item` steht, nimmt antds eigene Meldung
(`DatenfeldEingabe`); beide sehen gleich aus.

ZUGANG: die Zeile trägt `id`; die Eingabe verweist per `aria-describedby` darauf und setzt
`aria-invalid`. Kein eigener Live-Bereich: der Grund erscheint nach dem Absenden, und der Fokus
geht ins Feld, dessen Beschreibung der Vorleser dann liest. Die Marke `data-fehler` ist dieselbe
wie an `InlineAngabe` und `BemerkungZelle`.

Ohne Grund rendert sie nichts — kein leerer Abstand unter dem Feld.

Quelle: `frontend/src/components/instrument/FeldFehler.tsx` im Repo `rubenvitt/lifeline-hub`. Die Vorschau ist aus
dem echten Baustein gerendert (der Zustand nach einer Bedienung im jsdom), mit dem antd-Theme der App, Nacht und Tag, Dichte `kompakt`.
