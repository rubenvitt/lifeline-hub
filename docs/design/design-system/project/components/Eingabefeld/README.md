# Eingabefeld (Feld mit Breitenstufe, Pflicht mit Fehlerzeile, FeldFehler)

Feld — ein Formularfeld mit benannter Obergrenze. Hülle um antds
`Form.Item`: Beschriftung, Pflichtzeichen, Hinweis, Prüfung und Fehlerzeile bleiben antds. Das
Steuerelement füllt die Zeile bis zur Obergrenze der Stufe (`FELDBREITE`) und ragt am schmalen
Schirm nie über den Rand. `InputNumber`, `DatePicker` und `TimePicker`, die antd nicht von sich
aus 100 % breit setzt, füllt die Klasse `FELD_KLASSE` in `index.css`.

Bewusst ohne `style`: eine Pixelbreite lässt sich nicht ausdrücken. Ein Sonderfall wird eine
neue Stufe, keine Ausnahme. Regel: `frontend/AGENTS.md`, „Gestaltungssprache“, Bausteine;
Wächter `components/feld.guard.test.ts`.

Aus `frontend/src/components/instrument/FeldFehler.tsx`:

FeldFehler — die Fehlerzeile unter einer Eingabe, auch ohne antd-`Form` (LLH-1101; Nutzer
außerhalb eines `Form.Item`, etwa die feldweise Bearbeitung der Personendaten, LLH-1103).

Quelle: `frontend/src/components/instrument/Feld.tsx` im Repo `rubenvitt/lifeline-hub`. Die Vorschau ist aus
dem echten Baustein gerendert (der Zustand nach einer Bedienung im jsdom), mit dem antd-Theme der App, Nacht und Tag, Dichte `kompakt`.
