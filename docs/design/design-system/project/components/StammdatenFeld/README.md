# StammdatenFeld (aus Stammdaten oder frei)

StammdatenFeld — Vorschlagsfeld „aus Stammdaten oder frei“ (LLH-1144, Spec `stammdaten-feld`,
Regel `frontend/AGENTS.md`, Erfassungs-Norm; Herleitung
`/mnt/project-files/llh-1022/LLH-1144/design.md`).

Tippen filtert die Vorschläge der Quellen in den Gruppen „Im Einsatz“, „Stammdaten“, „Zuletzt
verwendet“, Demo-Einträge dahinter (`stammdaten/demoAuswahl.tsx`). Freitext bleibt erlaubt und
trägt die Marke „frei“, ein gewählter Wert die Herkunft; beides als Wort, die Eingabe verweist
per `aria-describedby` darauf. Neben einem freien Wert steht „In Stammdaten übernehmen“, wenn
eine Quelle einen Katalog zum Anlegen mitbringt; ohne Recht gesperrt mit Grund daneben.

Wertform (D1): `{ text, ref? }`, im Modus `nurText` der reine Text (die Marke leitet sich dann
aus dem Treffer ab).

Tastatur (D3): ↓ öffnet, Enter übernimmt den markierten Vorschlag, sonst den Freitext, Escape
schließt. Enter bei offener Liste sendet nie; bei geschlossener gilt die Erfassungs-Norm. Enter
öffnet die Liste nicht (rc-select täte es, `BaseSelect` `onInternalKeyDown`).

Trefflächen (D6): die Zeilen sind antds Optionen mit `optionHeight = controlHeight`, also
30/48/72 px je Dichte; kein `size`, kein eigenes Maß.

Quelle: `frontend/src/components/StammdatenFeld.tsx` im Repo `rubenvitt/lifeline-hub`. Die Vorschau ist aus
dem echten Baustein gerendert, mit dem antd-Theme der App, Nacht und Tag, Dichte `kompakt`.
